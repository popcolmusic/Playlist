require('dotenv').config();
const express = require('express');
const multer = require('multer');
const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Asegurarse de que la carpeta de videos exista en runtime
if (!fs.existsSync(process.env.VIDEOS_DIR)) {
  fs.mkdirSync(process.env.VIDEOS_DIR, { recursive: true });
}

// Carpeta de videos para multer
const upload = multer({ dest: process.env.VIDEOS_DIR });

// Conexión a MySQL
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME
});

// Ruta de prueba
app.get('/', (req, res) => {
  res.send('Panel Radiocentro funcionando!');
});

// Subir video
app.post('/upload', upload.single('video'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).send('No se subió ningún archivo');
  const title = file.originalname;

  try {
    await pool.query('INSERT INTO videos (title, filename, active, position) VALUES (?,?,1,?)',
      [title, file.filename, 0]);
    res.json({ message: 'Video subido correctamente', file });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al guardar en la base de datos');
  }
});

// Listar videos
app.get('/videos', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM videos ORDER BY position ASC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al obtener videos');
  }
});

// Activar / desactivar
app.post('/videos/:id/toggle', async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await pool.query('SELECT active FROM videos WHERE id=?', [id]);
    if (rows.length === 0) return res.status(404).send('Video no encontrado');
    const newStatus = rows[0].active ? 0 : 1;
    await pool.query('UPDATE videos SET active=? WHERE id=?', [newStatus, id]);
    res.json({ message: 'Estado actualizado', active: newStatus });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al actualizar estado');
  }
});

// Generar playlist.txt
app.post('/playlist/update', async (req, res) => {
  try {
    const [videos] = await pool.query('SELECT * FROM videos WHERE active=1 ORDER BY position ASC');
    const playlistContent = videos
      .map(v => `file '${path.join(process.env.VIDEOS_DIR, v.filename)}'`)
      .join('\n');
    fs.writeFileSync(path.join(process.env.VIDEOS_DIR, 'playlist.txt'), playlistContent);
    res.json({ message: 'Playlist actualizada' });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al generar playlist');
  }
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
