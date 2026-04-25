require('dotenv').config();
const express = require('express');
const multer = require('multer');
const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Carpeta de videos
if (!fs.existsSync(process.env.VIDEOS_DIR)) {
  fs.mkdirSync(process.env.VIDEOS_DIR, { recursive: true });
}
const upload = multer({ dest: process.env.VIDEOS_DIR });

// Conexión MySQL
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME
});

// Health check para Coolify
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.send('OK');
  } catch (err) {
    res.status(500).send('DB connection failed');
  }
});

// Actualizar playlist
async function updatePlaylistFile() {
  try {
    const [videos] = await pool.query(
      'SELECT * FROM videos WHERE active=1 ORDER BY position ASC'
    );
    const playlistContent = videos.length
      ? videos.map(v => `file '${path.join(process.env.VIDEOS_DIR, v.filename)}'`).join('\n')
      : '';
    fs.writeFileSync(path.join(process.env.VIDEOS_DIR, 'playlist.txt'), playlistContent);
    console.log('Playlist actualizada');
  } catch (err) {
    console.error('Error al actualizar playlist:', err);
  }
}

// Opcional: FFmpeg stream a Owncast
function startFFmpegStream() {
  const playlistPath = path.join(process.env.VIDEOS_DIR, 'playlist.txt');
  if (!fs.existsSync(playlistPath)) {
    console.warn('No hay playlist.txt para iniciar FFmpeg');
    return;
  }
  const command = `ffmpeg -re -f concat -safe 0 -i ${playlistPath} -c copy -f flv rtmp://<TU_DOMINIO_OWNCAST>/live`;
  const ffmpegProcess = exec(command);
  ffmpegProcess.stdout.on('data', d => console.log('[FFmpeg]', d.toString()));
  ffmpegProcess.stderr.on('data', d => console.error('[FFmpeg ERR]', d.toString()));
  ffmpegProcess.on('close', code => console.log(`FFmpeg finalizó con código ${code}`));
}

// Rutas API
app.get('/videos', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM videos ORDER BY position ASC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al obtener videos');
  }
});

app.post('/upload', upload.single('video'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).send('No se subió ningún archivo');
    const title = file.originalname;
    await pool.query(
      'INSERT INTO videos (title, filename, active, position) VALUES (?,?,1,0)',
      [title, file.filename]
    );
    await updatePlaylistFile();
    res.json({ message: 'Video subido y playlist actualizada', file });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al subir video');
  }
});

app.post('/videos/:id/toggle', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query('SELECT active FROM videos WHERE id=?', [id]);
    if (rows.length === 0) return res.status(404).send('Video no encontrado');
    const newStatus = rows[0].active ? 0 : 1;
    await pool.query('UPDATE videos SET active=? WHERE id=?', [newStatus, id]);
    await updatePlaylistFile();
    res.json({ message: 'Estado actualizado', active: newStatus });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al actualizar estado');
  }
});

app.post('/playlist/update', async (req, res) => {
  try {
    await updatePlaylistFile();
    res.json({ message: 'Playlist actualizada' });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al actualizar playlist');
  }
});

// Iniciar servidor
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
