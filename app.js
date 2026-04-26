require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

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

// Carpeta de datos SQLite
if (!fs.existsSync(path.dirname(process.env.SQLITE_FILE))) {
  fs.mkdirSync(path.dirname(process.env.SQLITE_FILE), { recursive: true });
}

// Conexión SQLite
const db = new Database(process.env.SQLITE_FILE);
db.prepare(`CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  filename TEXT,
  active INTEGER,
  position INTEGER
)`).run();

// Multer para subir videos
const upload = multer({ dest: process.env.VIDEOS_DIR });

// Función para actualizar playlist.txt
function updatePlaylistFile() {
  const videos = db.prepare('SELECT * FROM videos WHERE active=1 ORDER BY position ASC').all();
  const playlistContent = videos.map(v => `file '${path.join(process.env.VIDEOS_DIR, v.filename)}'`).join('\n');
  fs.writeFileSync(path.join(process.env.VIDEOS_DIR, 'playlist.txt'), playlistContent);
  console.log('Playlist actualizada');
}

// Rutas API
app.get('/videos', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM videos ORDER BY position ASC').all();
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al obtener videos');
  }
});

app.post('/upload', upload.single('video'), (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).send('No se subió ningún archivo');
    db.prepare('INSERT INTO videos (title, filename, active, position) VALUES (?, ?, 1, 0)')
      .run(file.originalname, file.filename);
    updatePlaylistFile();
    res.json({ message: 'Video subido y playlist actualizada', file });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al subir video');
  }
});

app.post('/videos/:id/toggle', (req, res) => {
  try {
    const { id } = req.params;
    const video = db.prepare('SELECT active FROM videos WHERE id=?').get(id);
    if (!video) return res.status(404).send('Video no encontrado');
    const newStatus = video.active ? 0 : 1;
    db.prepare('UPDATE videos SET active=? WHERE id=?').run(newStatus, id);
    updatePlaylistFile();
    res.json({ message: 'Estado actualizado', active: newStatus });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al actualizar estado');
  }
});

app.post('/playlist/update', (req, res) => {
  try {
    updatePlaylistFile();
    res.json({ message: 'Playlist actualizada' });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al actualizar playlist');
  }
});

// Iniciar servidor
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
