const express = require('express');
const router = express.Router();
const db = require('../database');

// Obtener todos los mecánicos activos
router.get('/', (req, res) => {
  db.all('SELECT * FROM mecanicos WHERE activo = 1', [], (err, rows) => {
    if (err) return res.status(500).send(err.message);
    res.json(rows);
  });
});

// Agregar un nuevo mecánico
router.post('/', (req, res) => {
  const { nombre, porcentaje_comision } = req.body;
  db.run('INSERT INTO mecanicos (nombre, porcentaje_comision) VALUES (?, ?)', [nombre, porcentaje_comision], function (err) {
    if (err) return res.status(500).send(err.message);
    res.json({ id: this.lastID });
  });
});

// Editar comisión
router.put('/:id', (req, res) => {
  const { porcentaje_comision } = req.body;
  const id = req.params.id;
  db.run('UPDATE mecanicos SET porcentaje_comision = ? WHERE id = ?', [porcentaje_comision, id], function (err) {
    if (err) return res.status(500).send(err.message);
    res.sendStatus(200);
  });
});

// Desactivar mecánico
router.delete('/:id', (req, res) => {
  const id = req.params.id;
  db.run('UPDATE mecanicos SET activo = 0 WHERE id = ?', [id], function (err) {
    if (err) return res.status(500).send(err.message);
    res.sendStatus(200);
  });
});

module.exports = router;
