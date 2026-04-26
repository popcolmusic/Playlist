require('dotenv').config();
const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Carpeta de videos
if (!fs.existsSync(process.env.VIDEOS_DIR)) {
  fs.mkdirSync(process.env.VIDEOS_DIR, { recursive: true });
}

// Multer para subida de videos
const upload = multer({ dest: process.env.VIDEOS_DIR });

// SQLite
const dbPath = process.env.SQLITE_FILE || './data/playlist.db';
const db = new sqlite3.Database(dbPath);

// Crear tabla si no existe
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      filename TEXT,
      active INTEGER DEFAULT 1,
      position INTEGER DEFAULT 0
    )
  `);
});

// Health check
app.get('/health', async (req, res) => res.send('OK'));

// Actualizar playlist.txt
async function updatePlaylistFile() {
  db.all(`SELECT * FROM videos WHERE active=1 ORDER BY position ASC`, [], (err, rows) => {
    if (err) return console.error('Error al leer videos:', err);
    const playlistContent = rows.map(v => `file '${path.join(process.env.VIDEOS_DIR, v.filename)}'`).join('\n');
    fs.writeFileSync(path.join(process.env.VIDEOS_DIR, 'playlist.txt'), playlistContent);
    console.log('Playlist actualizada');
  });
}

// Obtener lista de videos
app.get('/videos', (req, res) => {
  db.all('SELECT * FROM videos ORDER BY position ASC', [], (err, rows) => {
    if (err) return res.status(500).send('Error al obtener videos');
    res.json(rows);
  });
});

// Subir video
app.post('/upload', upload.single('video'), (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).send('No se subió ningún archivo');
  const title = file.originalname;
  db.run('INSERT INTO videos (title, filename) VALUES (?, ?)', [title, file.filename], (err) => {
    if (err) return res.status(500).send('Error al guardar video');
    updatePlaylistFile();
    res.json({ message: 'Video subido y playlist actualizada', file });
  });
});

// Activar / desactivar video
app.post('/videos/:id/toggle', (req, res) => {
  const { id } = req.params;
  db.get('SELECT active FROM videos WHERE id=?', [id], (err, row) => {
    if (err || !row) return res.status(404).send('Video no encontrado');
    const newStatus = row.active ? 0 : 1;
    db.run('UPDATE videos SET active=? WHERE id=?', [newStatus, id], (err) => {
      if (err) return res.status(500).send('Error al actualizar estado');
      updatePlaylistFile();
      res.json({ message: 'Estado actualizado', active: newStatus });
    });
  });
});

// Forzar actualización de playlist
app.post('/playlist/update', (req, res) => {
  updatePlaylistFile();
  res.json({ message: 'Playlist actualizada' });
});

// Iniciar servidor
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
