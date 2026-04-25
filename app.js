require('dotenv').config();
const express = require('express');
const multer = require('multer');
const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors()); // Habilita CORS para subdominios si es necesario
app.use(express.static('public'));

// Carpeta de videos
if (!fs.existsSync(process.env.VIDEOS_DIR)) {
  fs.mkdirSync(process.env.VIDEOS_DIR, { recursive: true });
}

// Multer para subida de videos
const upload = multer({ dest: process.env.VIDEOS_DIR });

// Conexión MySQL
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'db', // Nombre del servicio MySQL en Docker
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'radiouser',
  password: process.env.DB_PASS || 'pass1234',
  database: process.env.DB_NAME || 'radiocentro',
  waitForConnections: true,
  connectionLimit: 10
});

// Health check para Coolify
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.send('OK');
  } catch (err) {
    console.error('Healthcheck DB failed:', err);
    res.status(500).send('DB connection failed');
  }
});

// Función para actualizar playlist.txt
async function updatePlaylistFile() {
  try {
    const [videos] = await pool.query('SELECT * FROM videos WHERE active=1 ORDER BY position ASC');
    const playlistContent = videos.length
      ? videos.map(v => `file '${path.join(process.env.VIDEOS_DIR, v.filename)}'`).join('\n')
      : '';
    fs.writeFileSync(path.join(process.env.VIDEOS_DIR, 'playlist.txt'), playlistContent);
    console.log('Playlist actualizada');
  } catch (err) {
    console.error('Error al actualizar playlist:', err);
  }
}

// Endpoints API

// Obtener lista de videos
app.get('/videos', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM videos ORDER BY position ASC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al obtener videos');
  }
});

// Subir video
app.post('/upload', upload.single('video'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).send('No se subió ningún archivo');
    const title = file.originalname;
    await pool.query('INSERT INTO videos (title, filename, active, position) VALUES (?,?,1,0)', [title, file.filename]);
    await updatePlaylistFile();
    res.json({ message: 'Video subido y playlist actualizada', file });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al subir video');
  }
});

// Activar / desactivar video
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

// Forzar actualización de playlist
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
