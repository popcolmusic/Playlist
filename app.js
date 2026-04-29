require('dotenv').config();

const express = require('express');
const multer = require('multer');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');

const app = express();

const PORT = process.env.PORT || 3001;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';
const VIDEO_DIR = process.env.VIDEO_DIR || '/var/www/media/videos';
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/var/www/media/uploads_tmp';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const SQLITE_FILE = process.env.SQLITE_FILE || path.join(DATA_DIR, 'playlist.db');
const RTMP_URL = process.env.RTMP_URL || 'rtmp://127.0.0.1/live/abc123';
const LOGO_PATH = process.env.LOGO_PATH || (
  fs.existsSync('/var/www/media/assets/logo-transparente.png')
    ? '/var/www/media/assets/logo-transparente.png'
    : '/var/www/media/assets/logo.png'
);
const AUTO_START = String(process.env.AUTO_START || 'false').toLowerCase() === 'true';
const SESSION_SECRET = process.env.SESSION_SECRET || 'playlist-radio-centro-secret';

let ffmpegProcess = null;

// Carpetas necesarias
for (const dir of [VIDEO_DIR, UPLOAD_DIR, DATA_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// SQLite
const db = new Database(SQLITE_FILE);
db.pragma('journal_mode = WAL');
db.prepare(`
  CREATE TABLE IF NOT EXISTS videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT UNIQUE NOT NULL,
    active INTEGER DEFAULT 1,
    position INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`).run();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax'
  }
}));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const cleanName = file.originalname
      .replace(/\s+/g, '-')
      .replace(/[^a-zA-Z0-9._-]/g, '');
    cb(null, Date.now() + '-' + cleanName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 1024 * 1024 * 3000 },
  fileFilter: (req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith('.mp4')) {
      return cb(new Error('Solo se permiten videos MP4'));
    }
    cb(null, true);
  }
});

function auth(req, res, next) {
  if (req.session && req.session.auth) return next();
  res.redirect('/login');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function ffmpegConcatEscape(filePath) {
  return filePath.replace(/'/g, "'\\''");
}

function syncVideosToDb() {
  const files = fs.readdirSync(VIDEO_DIR).filter(file => file.toLowerCase().endsWith('.mp4'));
  const insert = db.prepare('INSERT OR IGNORE INTO videos (filename, active, position) VALUES (?, 1, ?)');

  files.forEach((file, index) => insert.run(file, index));

  // Limpia de SQLite los videos que ya no existen en carpeta
  const rows = db.prepare('SELECT filename FROM videos').all();
  const fileSet = new Set(files);
  const del = db.prepare('DELETE FROM videos WHERE filename = ?');
  rows.forEach(row => {
    if (!fileSet.has(row.filename)) del.run(row.filename);
  });
}

function getVideos({ onlyActive = false } = {}) {
  syncVideosToDb();

  const rows = onlyActive
    ? db.prepare('SELECT * FROM videos WHERE active = 1 ORDER BY position ASC, id ASC').all()
    : db.prepare('SELECT * FROM videos ORDER BY position ASC, id ASC').all();

  return rows
    .map(row => {
      const fullPath = path.join(VIDEO_DIR, row.filename);
      if (!fs.existsSync(fullPath)) return null;
      const stat = fs.statSync(fullPath);
      return {
        id: row.id,
        name: row.filename,
        active: Number(row.active) === 1,
        position: row.position,
        size: (stat.size / 1024 / 1024).toFixed(2),
        date: stat.mtime.toLocaleString()
      };
    })
    .filter(Boolean);
}

function layout(content) {
  return `
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Playlist Radio Centro</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
*{box-sizing:border-box}
body{
  margin:0;
  font-family:Arial,Helvetica,sans-serif;
  background:radial-gradient(circle at top,#172554,#020617 55%,#000);
  color:#fff;
}
.wrap{max-width:1100px;margin:auto;padding:35px 18px}
.card{
  background:rgba(255,255,255,.08);
  border:1px solid rgba(255,255,255,.12);
  border-radius:24px;
  padding:26px;
  box-shadow:0 20px 60px rgba(0,0,0,.35);
  backdrop-filter:blur(12px);
}
h1{font-size:38px;margin:0 0 10px}
h2{margin-top:0}
p{color:#cbd5e1}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.btn{
  display:inline-block;
  border:0;
  padding:14px 20px;
  border-radius:999px;
  font-weight:800;
  color:#04111f;
  background:#22c55e;
  text-decoration:none;
  cursor:pointer;
  margin:6px 6px 6px 0;
}
.btn.red{background:#ef4444;color:white}
.btn.blue{background:#38bdf8}
.btn.orange{background:#f59e0b;color:#111827}
.btn.dark{background:#111827;color:white;border:1px solid #334155}
input{
  width:100%;
  padding:15px;
  border-radius:14px;
  border:1px solid #334155;
  background:#020617;
  color:#fff;
  margin:8px 0;
}
table{width:100%;border-collapse:collapse;margin-top:18px}
td,th{padding:14px;border-bottom:1px solid rgba(255,255,255,.12);text-align:left;vertical-align:middle}
.badge{padding:8px 12px;border-radius:999px;background:#111827;color:#93c5fd;font-weight:bold;display:inline-block}
.badge.green{background:rgba(34,197,94,.15);color:#86efac;border:1px solid rgba(34,197,94,.35)}
.badge.red{background:rgba(239,68,68,.15);color:#fecaca;border:1px solid rgba(239,68,68,.35)}
.status{font-size:18px;margin:16px 0}
.small{font-size:13px;color:#94a3b8}
@media(max-width:800px){.grid{grid-template-columns:1fr}h1{font-size:30px}table{font-size:14px}.btn{padding:11px 14px}}
</style>
</head>
<body>
<div class="wrap">${content}</div>
</body>
</html>`;
}

function buildFfmpegArgs(listPath) {
  const hasLogo = fs.existsSync(LOGO_PATH);

  if (hasLogo) {
    return [
      '-re',
      '-stream_loop', '-1',
      '-f', 'concat',
      '-safe', '0',
      '-i', listPath,

      '-loop', '1',
      '-i', LOGO_PATH,

      '-filter_complex',
      "[0:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1[base];" +
      "[1:v]scale=260:-1[logo];" +
      "[base][logo]overlay=10:10[tmp1];" +
      "[tmp1]drawbox=x=0:y=650:w=1280:h=70:color=black@0.65:t=fill[tmp2];" +
      "[tmp2]drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='%{localtime\\:%H\\\\\\:%M\\\\\\:%S}':x=1080:y=672:fontsize=30:fontcolor=white[tmp3];" +
      "[tmp3]drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='RADIO CENTRO TV  •  Música, noticias, artistas y entretenimiento  •  Síguenos en radiocentro.net':x=w-mod(t*180\\,w+tw):y=672:fontsize=28:fontcolor=white[outv]",

      '-map', '[outv]',
      '-map', '0:a?',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-b:v', '2500k',
      '-maxrate', '2500k',
      '-bufsize', '5000k',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', '44100',
      '-ac', '2',
      '-f', 'flv',
      RTMP_URL
    ];
  }

  // Si no existe logo, transmite igual sin fallar
  return [
    '-re',
    '-stream_loop', '-1',
    '-f', 'concat',
    '-safe', '0',
    '-i', listPath,
    '-vf', "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,drawbox=x=0:y=650:w=1280:h=70:color=black@0.65:t=fill,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='RADIO CENTRO TV  •  Música, noticias, artistas y entretenimiento  •  Síguenos en radiocentro.net':x=w-mod(t*180\\,w+tw):y=672:fontsize=28:fontcolor=white",
    '-map', '0:v',
    '-map', '0:a?',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-b:v', '2500k',
    '-maxrate', '2500k',
    '-bufsize', '5000k',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '44100',
    '-ac', '2',
    '-f', 'flv',
    RTMP_URL
  ];
}

function startStream() {
  if (ffmpegProcess) return { ok: true, message: 'Ya está transmitiendo' };
  desiredLive = true;

  const videos = getVideos({ onlyActive: true });

  if (!videos.length) {
    return { ok: false, message: 'No hay videos activos en la playlist' };
  }

  const listPath = '/tmp/radiocentro-playlist.txt';
  const listContent = videos
    .map(video => `file '${ffmpegConcatEscape(path.join(VIDEO_DIR, video.name))}'`)
    .join('\n');

  fs.writeFileSync(listPath, listContent);

  ffmpegProcess = spawn('ffmpeg', buildFfmpegArgs(listPath));

  ffmpegProcess.stderr.on('data', data => {
    console.log(data.toString());
  });

  ffmpegProcess.on('close', code => {
    console.log('FFmpeg detenido:', code);
    ffmpegProcess = null;

    // Si AUTO_START=true, intenta levantar nuevamente la transmisión.
    // Esto ayuda a que la playlist permanezca activa si FFmpeg se cae.
    if (AUTO_START && desiredLive) {
      setTimeout(() => {
        const result = startStream();
        console.log('Auto reinicio FFmpeg:', result.message);
      }, 5000);
    }
  });

  return { ok: true, message: 'Transmisión iniciada' };
}

function stopStream() {
  desiredLive = false;

  if (ffmpegProcess) {
    ffmpegProcess.kill('SIGTERM');
    ffmpegProcess = null;
  }

  try {
    spawn('pkill', ['-f', 'ffmpeg']);
  } catch (e) {}
}

app.get('/login', (req, res) => {
  res.send(layout(`
    <div class="card" style="max-width:480px;margin:80px auto;">
      <h1>Radio Centro Playlist</h1>
      <p>Acceso privado para administrar videos y transmisión.</p>
      <form method="POST" action="/login">
        <input name="user" placeholder="Usuario" required>
        <input name="pass" type="password" placeholder="Contraseña" required>
        <button class="btn" type="submit">Entrar</button>
      </form>
    </div>
  `));
});

app.post('/login', (req, res) => {
  const { user, pass } = req.body;
  if (user === ADMIN_USER && pass === ADMIN_PASS) {
    req.session.auth = true;
    return res.redirect('/');
  }
  res.send(layout(`<div class="card"><h1>Acceso denegado</h1><a class="btn" href="/login">Volver</a></div>`));
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.get('/', auth, (req, res) => {
  const videos = getVideos();
  const activeVideos = videos.filter(v => v.active);
  const isLive = !!ffmpegProcess;

  res.send(layout(`
    <div class="card">
      <h1>Panel Playlist Radio Centro</h1>
      <p>Sube videos MP4, administra tu lista y transmite automáticamente hacia Owncast.</p>

      <div class="status">
        Estado: ${isLive ? '<span class="badge green">Transmitiendo</span>' : '<span class="badge red">Detenido</span>'}
      </div>

      <a class="btn" href="/start">Iniciar transmisión</a>
      <a class="btn red" href="/stop">Detener transmisión</a>
      <a class="btn dark" href="/logout">Cerrar sesión</a>
    </div>

    <br>

    <div class="grid">
      <div class="card">
        <h2>Subir video MP4</h2>
        <form method="POST" action="/upload" enctype="multipart/form-data">
          <input type="file" name="video" accept="video/mp4" required>
          <button class="btn blue" type="submit">Subir video</button>
        </form>
        <p>Carpeta: ${escapeHtml(VIDEO_DIR)}</p>
      </div>

      <div class="card">
        <h2>Resumen</h2>
        <p>Videos cargados: <b>${videos.length}</b></p>
        <p>Videos activos: <b>${activeVideos.length}</b></p>
        <p>Destino RTMP: <b>Owncast local</b></p>
        <p class="small">SQLite: ${escapeHtml(SQLITE_FILE)}</p>
      </div>
    </div>

    <br>

    <div class="card">
      <h2>Videos en playlist</h2>
      <p class="small">Solo los videos marcados como activos entran en la transmisión. La playlist se repite automáticamente.</p>
      ${videos.length === 0 ? '<p>No hay videos todavía.</p>' : `
      <table>
        <tr>
          <th>Archivo</th>
          <th>Tamaño MB</th>
          <th>Fecha</th>
          <th>Estado</th>
          <th>Acción</th>
        </tr>
        ${videos.map(v => `
          <tr>
            <td>${escapeHtml(v.name)}</td>
            <td>${v.size}</td>
            <td>${escapeHtml(v.date)}</td>
            <td>${v.active ? '<span class="badge green">Activo</span>' : '<span class="badge red">Inactivo</span>'}</td>
            <td>
              <a class="btn orange" href="/toggle/${encodeURIComponent(v.name)}">${v.active ? 'Pausar' : 'Activar'}</a>
              <a class="btn red" href="/delete/${encodeURIComponent(v.name)}" onclick="return confirm('¿Borrar este video?')">Borrar</a>
            </td>
          </tr>
        `).join('')}
      </table>`}
    </div>
  `));
});

app.post('/upload', auth, upload.single('video'), (req, res) => {
  if (!req.file) {
    return res.send(layout(`<div class="card"><h1>Error</h1><p>No se subió ningún video.</p><a class="btn" href="/">Volver</a></div>`));
  }

  const inputPath = req.file.path;
  const outputName = path.parse(req.file.filename).name + '_OPT.mp4';
  const outputPath = path.join(VIDEO_DIR, outputName);

  const convert = spawn('ffmpeg', [
    '-y',
    '-i', inputPath,
    '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '28',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '96k',
    '-ar', '44100',
    '-ac', '2',
    outputPath
  ]);

  convert.stderr.on('data', data => {
    console.log(data.toString());
  });

  convert.on('close', code => {
    try {
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    } catch (e) {}

    if (code === 0) {
      db.prepare('INSERT OR IGNORE INTO videos (filename, active, position) VALUES (?, 1, ?)')
        .run(outputName, Date.now());
      console.log('Video optimizado:', outputPath);
    } else {
      console.log('Error optimizando video:', code);
      try {
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      } catch (e) {}
    }
  });

  res.send(layout(`
    <div class="card">
      <h1>Video recibido</h1>
      <p>El video se está optimizando. Espera unos minutos antes de iniciar transmisión.</p>
      <a class="btn" href="/">Volver al panel</a>
    </div>
  `));
});

app.get('/toggle/:file', auth, (req, res) => {
  const file = path.basename(req.params.file);
  const row = db.prepare('SELECT active FROM videos WHERE filename = ?').get(file);

  if (row) {
    const nextActive = Number(row.active) === 1 ? 0 : 1;
    db.prepare('UPDATE videos SET active = ? WHERE filename = ?').run(nextActive, file);
  }

  res.redirect('/');
});

app.get('/delete/:file', auth, (req, res) => {
  const file = path.basename(req.params.file);
  const fullPath = path.join(VIDEO_DIR, file);

  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
  }

  db.prepare('DELETE FROM videos WHERE filename = ?').run(file);

  res.redirect('/');
});

app.get('/start', auth, (req, res) => {
  const result = startStream();

  if (!result.ok) {
    return res.send(layout(`<div class="card"><h1>${escapeHtml(result.message)}</h1><a class="btn" href="/">Volver</a></div>`));
  }

  res.redirect('/');
});

app.get('/stop', auth, (req, res) => {
  stopStream();
  res.redirect('/');
});

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    live: !!ffmpegProcess,
    videos: getVideos().length,
    activeVideos: getVideos({ onlyActive: true }).length
  });
});

app.listen(PORT, () => {
  console.log(`Playlist Radio Centro corriendo en puerto ${PORT}`);
  console.log(`SQLite: ${SQLITE_FILE}`);

  if (AUTO_START) {
    setTimeout(() => {
      const result = startStream();
      console.log('AUTO_START:', result.message);
    }, 3000);
  }
});
