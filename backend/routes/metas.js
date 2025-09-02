// backend/routes/metas.js
const express = require('express');
const router = express.Router();
const db = require('../database');

// Crea tabla si no existe
db.run(`
  CREATE TABLE IF NOT EXISTS metas_mecanico (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mecanico_id INTEGER NOT NULL,
    anio INTEGER NOT NULL,
    mes INTEGER NOT NULL,
    meta REAL NOT NULL,
    UNIQUE(mecanico_id, anio, mes)
  )
`);

// Lista metas del mes/año
// GET /api/metas?anio=2025&mes=8
router.get('/', (req, res) => {
  const anio = Number(req.query.anio || new Date().getFullYear());
  const mes  = Number(req.query.mes  || (new Date().getMonth()+1));

  const sql = `
    SELECT m.id AS mecanico_id,
           m.nombre AS mecanico,
           COALESCE(mm.meta, 0) AS meta
    FROM mecanicos m
    LEFT JOIN metas_mecanico mm
      ON mm.mecanico_id = m.id AND mm.anio = ? AND mm.mes = ?
    WHERE m.activo = 1
    ORDER BY m.nombre
  `;
  db.all(sql, [anio, mes], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

// Guarda/actualiza una meta
// POST /api/metas  { mecanico_id, anio, mes, meta }
router.post('/', express.json(), (req, res) => {
  const { mecanico_id, anio, mes, meta } = req.body || {};
  if (!mecanico_id || !anio || !mes || typeof meta !== 'number') {
    return res.status(400).json({ error: 'mecanico_id, anio, mes y meta son requeridos' });
  }
  const sql = `
    INSERT INTO metas_mecanico (mecanico_id, anio, mes, meta)
    VALUES (?,?,?,?)
    ON CONFLICT(mecanico_id, anio, mes) DO UPDATE SET meta = excluded.meta
  `;
  db.run(sql, [mecanico_id, anio, mes, meta], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true, id: this.lastID });
  });
});

module.exports = router;
