const express = require('express');
const router = express.Router();
const db = require('../database');

// Habilitar claves foráneas
db.run('PRAGMA foreign_keys = ON');

// Crear tablas si no existen
db.run(`CREATE TABLE IF NOT EXISTS proformas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL,
  cliente TEXT NOT NULL,
  vehiculo TEXT,
  placa TEXT,
  kilometraje TEXT,
  observaciones TEXT,
  estado TEXT DEFAULT 'pendiente',
  total REAL DEFAULT 0,
  creado_en TEXT DEFAULT CURRENT_TIMESTAMP
);`);

db.run(`CREATE TABLE IF NOT EXISTS proformas_detalle (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proforma_id INTEGER NOT NULL,
  descripcion TEXT NOT NULL,
  cantidad INTEGER DEFAULT 1,
  precio_unitario REAL NOT NULL,
  tipo TEXT, /* 'producto' o 'servicio' */
  FOREIGN KEY (proforma_id) REFERENCES proformas(id) ON DELETE CASCADE
);`);

// Utilidad: recalcular total de una proforma
function recalcularTotal(proformaId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT COALESCE(SUM(cantidad * precio_unitario), 0) AS total
       FROM proformas_detalle
       WHERE proforma_id = ?`,
      [proformaId],
      (err, row) => {
        if (err) return reject(err);
        const total = row?.total || 0;
        db.run(
          `UPDATE proformas SET total = ? WHERE id = ?`,
          [total, proformaId],
          (err2) => (err2 ? reject(err2) : resolve(total))
        );
      }
    );
  });
}

// Obtener todas las proformas
router.get('/', (req, res) => {
  db.all(
    `SELECT p.*,
            (SELECT COALESCE(SUM(d.cantidad * d.precio_unitario), 0)
             FROM proformas_detalle d
             WHERE d.proforma_id = p.id) AS total
     FROM proformas p
     ORDER BY p.fecha DESC, p.id DESC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// Obtener una proforma con su detalle
router.get('/:id', (req, res) => {
  const { id } = req.params;

  db.serialize(() => {
    db.get('SELECT * FROM proformas WHERE id = ?', [id], (err, proforma) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!proforma) return res.status(404).json({ error: 'Proforma no encontrada' });

      db.all('SELECT * FROM proformas_detalle WHERE proforma_id = ?', [id], (err2, detalle) => {
        if (err2) return res.status(500).json({ error: err2.message });
        res.json({ ...proforma, detalle });
      });
    });
  });
});

// Crear nueva proforma
router.post('/', (req, res) => {
  const { fecha, cliente, vehiculo, placa, kilometraje, observaciones, detalle } = req.body;

  if (!Array.isArray(detalle) || detalle.length === 0) {
    return res.status(400).json({ error: 'El detalle no puede estar vacío' });
  }

  db.serialize(() => {
    db.run('BEGIN TRANSACTION');

    db.run(
      `INSERT INTO proformas (fecha, cliente, vehiculo, placa, kilometraje, observaciones)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [fecha, cliente, vehiculo, placa, kilometraje, observaciones],
      function (err) {
        if (err) {
          db.run('ROLLBACK');
          return res.status(500).json({ error: err.message });
        }

        const proformaId = this.lastID;
        const stmt = db.prepare(
          `INSERT INTO proformas_detalle
           (proforma_id, descripcion, cantidad, precio_unitario, tipo)
           VALUES (?, ?, ?, ?, ?)`
        );

        for (const item of detalle) {
          stmt.run([
            proformaId,
            item.descripcion,
            item.cantidad || 1,
            item.precio_unitario,
            item.tipo || 'servicio'
          ]);
        }

        stmt.finalize(async (err2) => {
          if (err2) {
            db.run('ROLLBACK');
            return res.status(500).json({ error: err2.message });
          }

          try {
            await recalcularTotal(proformaId);
            db.run('COMMIT');
            res.json({ id: proformaId, message: 'Proforma creada exitosamente' });
          } catch (e) {
            db.run('ROLLBACK');
            res.status(500).json({ error: e.message });
          }
        });
      }
    );
  });
});

// Actualizar una proforma (cabecera + detalle)
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const { fecha, cliente, vehiculo, placa, kilometraje, observaciones, detalle } = req.body;

  if (!Array.isArray(detalle) || detalle.length === 0) {
    return res.status(400).json({ error: 'El detalle no puede estar vacío' });
  }

  db.serialize(() => {
    db.run('BEGIN TRANSACTION');

    db.run(
      `UPDATE proformas
       SET fecha = ?, cliente = ?, vehiculo = ?, placa = ?, kilometraje = ?, observaciones = ?
       WHERE id = ?`,
      [fecha, cliente, vehiculo, placa, kilometraje, observaciones, id],
      function (err) {
        if (err) {
          db.run('ROLLBACK');
          return res.status(500).json({ error: err.message });
        }

        // Reemplazar detalle
        db.run(`DELETE FROM proformas_detalle WHERE proforma_id = ?`, [id], (err2) => {
          if (err2) {
            db.run('ROLLBACK');
            return res.status(500).json({ error: err2.message });
          }

          const stmt = db.prepare(
            `INSERT INTO proformas_detalle
             (proforma_id, descripcion, cantidad, precio_unitario, tipo)
             VALUES (?, ?, ?, ?, ?)`
          );

          for (const item of detalle) {
            stmt.run([
              id,
              item.descripcion,
              item.cantidad || 1,
              item.precio_unitario,
              item.tipo || 'servicio'
            ]);
          }

          stmt.finalize(async (err3) => {
            if (err3) {
              db.run('ROLLBACK');
              return res.status(500).json({ error: err3.message });
            }

            try {
              await recalcularTotal(id);
              db.run('COMMIT');
              res.json({ id, message: 'Proforma actualizada exitosamente' });
            } catch (e) {
              db.run('ROLLBACK');
              res.status(500).json({ error: e.message });
            }
          });
        });
      }
    );
  });
});

// Actualizar estado (aprobado / rechazado / pendiente)
router.put('/:id/estado', (req, res) => {
  const { id } = req.params;
  const { estado } = req.body;

  db.run(
    `UPDATE proformas SET estado = ? WHERE id = ?`,
    [estado, id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Estado actualizado' });
    }
  );
});

// Eliminar proforma
router.delete('/:id', (req, res) => {
  const { id } = req.params;

  db.run('DELETE FROM proformas WHERE id = ?', [id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Proforma eliminada' });
  });
});

module.exports = router;
