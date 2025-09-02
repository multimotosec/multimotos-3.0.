const express = require('express');
const router = express.Router();
const db = require('../database');

// Obtener tipos de pago activos
router.get('/', (req, res) => {
  db.all('SELECT * FROM tipos_pago WHERE activo = 1', [], (err, rows) => {
    if (err) return res.status(500).send(err.message);
    res.json(rows);
  });
});

// Agregar tipo de pago
router.post('/', (req, res) => {
  const { nombre } = req.body;
  db.run('INSERT INTO tipos_pago (nombre) VALUES (?)', [nombre], function (err) {
    if (err) return res.status(500).send(err.message);
    res.json({ id: this.lastID });
  });
});

// Editar tipo de pago
router.put('/:id', (req, res) => {
  const { nombre } = req.body;
  db.run('UPDATE tipos_pago SET nombre = ? WHERE id = ?', [nombre, req.params.id], function (err) {
    if (err) return res.status(500).send(err.message);
    res.sendStatus(200);
  });
});

// Desactivar tipo de pago
router.delete('/:id', (req, res) => {
  db.run('UPDATE tipos_pago SET activo = 0 WHERE id = ?', [req.params.id], function (err) {
    if (err) return res.status(500).send(err.message);
    res.sendStatus(200);
  });
});

module.exports = router;
