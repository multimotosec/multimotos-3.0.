const express = require('express');
const router = express.Router();
const db = require('../database');

// Obtener todos los tipos activos
router.get('/', (req, res) => {
  db.all('SELECT * FROM tipos_transaccion WHERE activo = 1', [], (err, rows) => {
    if (err) return res.status(500).send(err.message);
    res.json(rows);
  });
});

// Agregar tipo de transacción
router.post('/', (req, res) => {
  const { nombre, descripcion } = req.body;
  db.run('INSERT INTO tipos_transaccion (nombre, descripcion) VALUES (?, ?)', [nombre, descripcion], function (err) {
    if (err) return res.status(500).send(err.message);
    res.json({ id: this.lastID });
  });
});

// Editar tipo de transacción
router.put('/:id', (req, res) => {
  const { nombre, descripcion } = req.body;
  db.run('UPDATE tipos_transaccion SET nombre = ?, descripcion = ? WHERE id = ?', [nombre, descripcion, req.params.id], function (err) {
    if (err) return res.status(500).send(err.message);
    res.sendStatus(200);
  });
});

// Desactivar
router.delete('/:id', (req, res) => {
  db.run('UPDATE tipos_transaccion SET activo = 0 WHERE id = ?', [req.params.id], function (err) {
    if (err) return res.status(500).send(err.message);
    res.sendStatus(200);
  });
});

module.exports = router;
