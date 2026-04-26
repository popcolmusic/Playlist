require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Carpetas y archivos de configuración
if (!process.env.VIDEOS_DIR) process.env.VIDEOS_DIR = path.join(__dirname, 'videos');
if (!process.env.SQLITE_FILE) process.env.SQLITE_FILE = path.join(__dirname, 'data', 'playlist.db');

if (!fs.existsSync(process.env.VIDEOS_DIR)) fs.mkdirSync(process.env.VIDEOS_DIR, { recursive: true });
const dataDir = path.dirname(process.env.SQLITE_FILE);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// Sirve archivos estáticos desde public
app.use(express.static(path.join(__dirname, 'public')));

// Multer para subir videos
const upload = multer({ dest: process.env.VIDEOS_DIR });

// Conexión a SQLite
const db = new Database(process.env.SQLITE_FILE);
db.prepare(`
  CREATE TABLE IF NOT EXISTS videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    filename TEXT,
    active INTEGER DEFAULT 1,
    position INTEGER DEFAULT 0
  )
`).run();

// Función para actualizar playlist.txt
function updatePlaylistFile() {
  const videos = db.prepare('SELECT * FROM videos WHERE active=1 ORDER BY position ASC').all();
  const playlistContent = videos.map(v => `file '${path.join(process.env.VIDEOS_DIR, v.filename)}'`).join('\n');
  fs.writeFileSync(path.join(process.env.VIDEOS_DIR, 'playlist.txt'), playlistContent);
}

// Rutas
app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.send('Servidor de videos funcionando correctamente');
  }
});

app.get('/videos', (req, res) => {
  const videos = db.prepare('SELECT * FROM videos ORDER BY position ASC').all();
  res.json(videos);
});

app.post('/upload', upload.single('video'), (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).send('No se subió ningún archivo');

  db.prepare('INSERT INTO videos (title, filename, active, position) VALUES (?,?,1,0)').run(file.originalname, file.filename);
  updatePlaylistFile();
  res.json({ message: 'Video subido y playlist actualizada', file });
});

app.post('/videos/:id/toggle', (req, res) => {
  const { id } = req.params;
  const video = db.prepare('SELECT active FROM videos WHERE id=?').get(id);
  if (!video) return res.status(404).send('Video no encontrado');

  const newStatus = video.active ? 0 : 1;
  db.prepare('UPDATE videos SET active=? WHERE id=?').run(newStatus, id);
  updatePlaylistFile();
  res.json({ message: 'Estado actualizado', active: newStatus });
});

app.post('/playlist/update', (req, res) => {
  updatePlaylistFile();
  res.json({ message: 'Playlist actualizada' });
});

// Iniciar servidor
app.listen(PORT, () => console.log(`Servidor corriendo en http://localhost:${PORT}`));
