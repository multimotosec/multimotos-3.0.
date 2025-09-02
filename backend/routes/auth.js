// backend/routes/auth.js
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../database');
const { SECRET } = require('../middleware/auth');
const router = express.Router();

function getUsuario(usuario) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM usuarios WHERE usuario = ? AND activo = 1`, [usuario], (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { usuario, password } = req.body;
    if (!usuario || !password) return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });

    const u = await getUsuario(usuario);
    if (!u) return res.status(401).json({ error: 'Credenciales inválidas' });

    const ok = await bcrypt.compare(password, u.hash_password);
    if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });

    const token = jwt.sign({ id: u.id, usuario: u.usuario, rol: u.rol }, SECRET, { expiresIn: '10h' });
    res.json({ token, usuario: { id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error en login' });
  }
});

module.exports = router;
