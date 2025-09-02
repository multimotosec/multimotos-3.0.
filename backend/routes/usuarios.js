const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../database');
const { authRequired, onlyAdmin } = require('../middleware/auth');
const router = express.Router();

// Listar usuarios (admin)
router.get('/', authRequired, onlyAdmin, (req, res) => {
  db.all(`SELECT id, usuario, nombre, rol, activo, creado_en FROM usuarios ORDER BY id DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Error listando usuarios' });
    res.json(rows);
  });
});

// Crear usuario (admin)
router.post('/', authRequired, onlyAdmin, async (req, res) => {
  const { usuario, nombre, rol = 'operador', password } = req.body;
  if (!usuario || !nombre || !password) return res.status(400).json({ error: 'Campos requeridos: usuario, nombre, password' });

  try {
    const hash = await bcrypt.hash(password, 10);
    db.run(
      `INSERT INTO usuarios (usuario, nombre, rol, hash_password, activo) VALUES (?, ?, ?, ?, 1)`,
      [usuario, nombre, rol, hash],
      function (err) {
        if (err) {
          if (String(err).includes('UNIQUE')) return res.status(409).json({ error: 'Usuario ya existe' });
          return res.status(500).json({ error: 'Error creando usuario' });
        }
        res.json({ id: this.lastID, usuario, nombre, rol, activo: 1 });
      }
    );
  } catch (e) {
    res.status(500).json({ error: 'Error creando usuario' });
  }
});

// Actualizar usuario (admin)
router.put('/:id', authRequired, onlyAdmin, (req, res) => {
  const { nombre, rol, activo } = req.body;
  db.run(
    `UPDATE usuarios SET nombre = COALESCE(?, nombre), rol = COALESCE(?, rol), activo = COALESCE(?, activo) WHERE id = ?`,
    [nombre ?? null, rol ?? null, typeof activo === 'number' ? activo : null, req.params.id],
    function (err) {
      if (err) return res.status(500).json({ error: 'Error actualizando' });
      res.json({ updated: this.changes });
    }
  );
});

// Resetear contraseña (admin)
router.put('/:id/password', authRequired, onlyAdmin, async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password requerido' });
  const hash = await bcrypt.hash(password, 10);
  db.run(`UPDATE usuarios SET hash_password = ? WHERE id = ?`, [hash, req.params.id], function (err) {
    if (err) return res.status(500).json({ error: 'Error reseteando contraseña' });
    res.json({ updated: this.changes });
  });
});

// Eliminar lógico (bloquear) (admin)
router.delete('/:id', authRequired, onlyAdmin, (req, res) => {
  db.run(`UPDATE usuarios SET activo = 0 WHERE id = ?`, [req.params.id], function (err) {
    if (err) return res.status(500).json({ error: 'Error bloqueando usuario' });
    res.json({ blocked: this.changes });
  });
});

module.exports = router;
