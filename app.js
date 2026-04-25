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

// Servir frontend
app.use(express.static('public'));

// Carpeta de videos
if (!fs.existsSync(process.env.VIDEOS_DIR)) {
  fs.mkdirSync(process.env.VIDEOS_DIR, { recursive: true });
}
const upload = multer({ dest: process.env.VIDEOS_DIR });

// Conexión a MySQL
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME
});

// Rutas API
app.get('/api', (req, res) => res.send('API Radiocentro funcionando!'));

// ... tus rutas /upload, /videos, /videos/:id/toggle, /playlist/update ...

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
