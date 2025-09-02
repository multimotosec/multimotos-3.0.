// backend/routes/ordenes_trabajo.js
const express = require('express');
const router = express.Router();
const db = require('../database'); // debe exportar una instancia sqlite3.Database

// ===== Helpers =====
function r2(n) {
  if (n === null || n === undefined || isNaN(n)) return 0;
  return Math.round((+n + Number.EPSILON) * 100) / 100;
}
function todayISO() {
  return new Date().toISOString().split('T')[0];
}
function splitDateParts(d = new Date()) {
  const fecha = todayISO();
  const dia = d.getDate();
  const mes = d.getMonth() + 1;
  const quincena = dia <= 15 ? 1 : 2;
  // Semana ISO aproximada (para reportes): lunes=1..domingo=7
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const semana = Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
  return { fecha, dia, mes, quincena, semana };
}

// Promesas simples sobre sqlite
const run = (sql, params = []) =>
  new Promise((resolve, reject) => db.run(sql, params, function (err) { err ? reject(err) : resolve(this); }));
const get = (sql, params = []) =>
  new Promise((resolve, reject) => db.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));
const all = (sql, params = []) =>
  new Promise((resolve, reject) => db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows)));

// ===== Recalcular totales de una OT =====
async function recalcularTotalesOrden(ordenId) {
  const rowsDet = await all(
    `SELECT cantidad, precio_unitario FROM orden_trabajo_detalle WHERE orden_id = ?`,
    [ordenId]
  );
  const total = r2(rowsDet.reduce((acc, r) => acc + (r.cantidad || 0) * (r.precio_unitario || 0), 0));

  const rowsAb = await all(
    `SELECT monto FROM orden_trabajo_abonos WHERE orden_id = ?`,
    [ordenId]
  );
  const abonado = r2(rowsAb.reduce((acc, r) => acc + (r.monto || 0), 0));
  const saldo = r2(total - abonado);

  await run(
    `UPDATE ordenes_trabajo SET total = ?, abonado = ?, saldo = ? WHERE id = ?`,
    [total, abonado, saldo, ordenId]
  );

  return { total, abonado, saldo };
}

// ===== Exportar OT a Registro Diario + generar comisiones (al finalizar) =====
async function finalizarYExportar(ordenId) {
  // Traer cabecera orden
  const orden = await get(`SELECT * FROM ordenes_trabajo WHERE id = ?`, [ordenId]);
  if (!orden) throw new Error('Orden no encontrada');

  // Detalle con mecánicos y % comisión
  const items = await all(`
    SELECT d.*, m.nombre AS mecanico_nombre, m.porcentaje_comision
    FROM orden_trabajo_detalle d
    LEFT JOIN mecanicos m ON m.id = d.mecanico_id
    WHERE d.orden_id = ?
  `, [ordenId]);

  // Crear cabecera en registro diario
  const { fecha, dia, mes, quincena, semana } = splitDateParts(new Date());
  const resCab = await run(
    `INSERT INTO registro_cabecera (fecha, cliente, dia, mes, quincena, semana)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [fecha, orden.cliente || 'S/D', dia, mes, quincena, semana]
  );
  const cabeceraId = resCab.lastID;

  // Insertar detalle: Mano de Obra (con comisión) y Venta (repuestos)
  const stmt = await new Promise((ok, ko) => {
    const s = db.prepare(`
      INSERT INTO registro_detalle (
        id_cabecera, cantidad, descripcion, tipo_transaccion, valor,
        mecanico_id, comision, tipo_pago
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, e => e ? ko(e) : ok(s));
  });

  for (const it of items) {
    const cantidad = it.cantidad || 1;
    const valor = r2(cantidad * (it.precio_unitario || 0));
    let tipo_transaccion = it.tipo === 'repuesto' ? 'Venta' : 'Mano de Obra';
    let comision = 0;
    let mecanico_id = null;

    if (it.tipo === 'trabajo' && it.mecanico_id) {
      mecanico_id = it.mecanico_id;
      const pct = it.porcentaje_comision || 0;
      comision = r2((it.precio_unitario || 0) * (pct / 100)) * cantidad;
    }

    await new Promise((ok, ko) =>
      stmt.run(
        [cabeceraId, cantidad, it.descripcion, tipo_transaccion, valor, mecanico_id, comision, 'Pendiente'],
        e => e ? ko(e) : ok()
      )
    );
  }

  await new Promise((ok, ko) => stmt.finalize(e => e ? ko(e) : ok()));

  // Marcar orden como finalizada (si aún no lo está)
  await run(`UPDATE ordenes_trabajo SET estado = 'finalizada' WHERE id = ?`, [ordenId]);

  return { cabeceraId };
}

// =========================
//    ENDPOINTS
// =========================

// Convertir proforma a OT
router.post('/api/ordenes/crear-desde-proforma', async (req, res) => {
  const { proformaId } = req.body;
  if (!proformaId) return res.status(400).json({ error: 'proformaId es requerido' });

  try {
    await run('BEGIN TRANSACTION');

    const proforma = await get(`SELECT * FROM proformas WHERE id = ?`, [proformaId]);
    if (!proforma) {
      await run('ROLLBACK');
      return res.status(404).json({ error: 'Proforma no encontrada' });
    }

    const hoy = todayISO();
    const ins = await run(
      `INSERT INTO ordenes_trabajo (
        proforma_id, fecha_creacion, cliente, vehiculo, placa, modelo,
        kilometraje, total, estado
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'en_curso')`,
      [
        proformaId, hoy, proforma.cliente, proforma.vehiculo, proforma.placa,
        proforma.modelo, proforma.kilometraje, proforma.total || 0
      ]
    );
    const ordenId = ins.lastID;

    const items = await all(`SELECT * FROM proformas_detalle WHERE proforma_id = ? ORDER BY id`, [proformaId]);

    if (items.length > 0) {
      const stmt = await new Promise((ok, ko) => {
        const s = db.prepare(`
          INSERT INTO orden_trabajo_detalle (orden_id, descripcion, tipo, cantidad, precio_unitario)
          VALUES (?, ?, ?, ?, ?)
        `, e => e ? ko(e) : ok(s));
      });

      for (const it of items) {
        const tipo = it.tipo === 'servicio' ? 'trabajo' : 'repuesto';
        await new Promise((ok, ko) =>
          stmt.run([ordenId, it.descripcion, tipo, it.cantidad || 1, it.precio_unitario || 0],
            e => e ? ko(e) : ok())
        );
      }
      await new Promise((ok, ko) => stmt.finalize(e => e ? ko(e) : ok()));
    }

    await run(`UPDATE proformas SET estado = 'aprobado' WHERE id = ?`, [proformaId]);

    // Recalcular totales desde el detalle migrado
    await recalcularTotalesOrden(ordenId);

    await run('COMMIT');
    res.json({ success: true, ordenId, message: 'Orden de trabajo creada exitosamente' });
  } catch (e) {
    try { await run('ROLLBACK'); } catch (_) {}
    res.status(500).json({ error: e.message });
  }
});

// Listado de OT (con filtros)
router.get('/api/ordenes', async (req, res) => {
  try {
    const { estado, desde, hasta, cliente } = req.query;
    const where = [];
    const params = [];

    if (estado) { where.push('o.estado = ?'); params.push(estado); }
    if (desde) { where.push('o.fecha_creacion >= ?'); params.push(desde); }
    if (hasta) { where.push('o.fecha_creacion <= ?'); params.push(hasta); }
    if (cliente) { where.push('o.cliente LIKE ?'); params.push(`%${cliente}%`); }

    const sql = `
      SELECT o.*,
             (SELECT COUNT(*) FROM orden_trabajo_detalle WHERE orden_id = o.id AND estado = 'completado') AS completados,
             (SELECT COUNT(*) FROM orden_trabajo_detalle WHERE orden_id = o.id) AS total_items
      FROM ordenes_trabajo o
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY o.fecha_creacion DESC, o.id DESC
    `;

    const rows = await all(sql, params);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Obtener una OT (cabecera + detalle + abonos + checklist)
router.get('/api/ordenes/:id', async (req, res) => {
  try {
    const id = req.params.id;

    const orden = await get(`SELECT * FROM ordenes_trabajo WHERE id = ?`, [id]);
    if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });

    const detalle = await all(`
      SELECT d.*, m.nombre AS mecanico_nombre
      FROM orden_trabajo_detalle d
      LEFT JOIN mecanicos m ON m.id = d.mecanico_id
      WHERE d.orden_id = ?
      ORDER BY d.id
    `, [id]);

    const abonos = await all(`SELECT * FROM orden_trabajo_abonos WHERE orden_id = ? ORDER BY fecha, id`, [id]);
    const checklist = await all(`SELECT * FROM orden_trabajo_checklist WHERE orden_id = ? ORDER BY id`, [id]);

    const saldo = r2((orden.total || 0) - (orden.abonado || 0));

    res.json({ ...orden, detalle, abonos, checklist, saldo });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Actualizar campos de una OT (incluye estado)
router.put('/api/ordenes/:id', async (req, res) => {
  const id = req.params.id;
  const {
    contacto, modelo, fecha_entrega_estimada,
    estado, observaciones, observaciones_recepcion,
    llaves, matricula, cascos, gasolina
  } = req.body;

  try {
    await run('BEGIN TRANSACTION');

    await run(`
      UPDATE ordenes_trabajo SET
        contacto = COALESCE(?, contacto),
        modelo = COALESCE(?, modelo),
        fecha_entrega_estimada = COALESCE(?, fecha_entrega_estimada),
        estado = COALESCE(?, estado),
        observaciones = COALESCE(?, observaciones),
        observaciones_recepcion = COALESCE(?, observaciones_recepcion),
        llaves = COALESCE(?, llaves),
        matricula = COALESCE(?, matricula),
        cascos = COALESCE(?, cascos),
        gasolina = COALESCE(?, gasolina)
      WHERE id = ?
    `, [
      contacto, modelo, fecha_entrega_estimada,
      estado, observaciones, observaciones_recepcion,
      llaves, matricula, cascos, gasolina, id
    ]);

    // Si se cambió a finalizada: exportar
    if (estado === 'finalizada') {
      await finalizarYExportar(id);
    }

    await run('COMMIT');
    res.json({ success: true });
  } catch (e) {
    try { await run('ROLLBACK'); } catch (_) {}
    res.status(500).json({ error: e.message });
  }
});

// Cambiar estado (alternativa específica)
router.put('/api/ordenes/:id/estado', async (req, res) => {
  const id = req.params.id;
  const { estado } = req.body;

  if (!['en_curso', 'pausada', 'finalizada', 'entregada'].includes(estado)) {
    return res.status(400).json({ error: 'Estado no válido' });
  }

  try {
    await run('BEGIN TRANSACTION');

    await run(`UPDATE ordenes_trabajo SET estado = ? WHERE id = ?`, [estado, id]);

    if (estado === 'finalizada') {
      await finalizarYExportar(id);
    }

    await run('COMMIT');
    res.json({ success: true });
  } catch (e) {
    try { await run('ROLLBACK'); } catch (_) {}
    res.status(500).json({ error: e.message });
  }
});

// ====== DETALLE (Trabajos / Repuestos) ======
router.post('/api/ordenes/:ordenId/detalle', async (req, res) => {
  const ordenId = req.params.ordenId;
  const { tipo, descripcion, cantidad, precio_unitario, mecanico_id, estado } = req.body;

  if (!tipo || !descripcion) return res.status(400).json({ error: 'tipo y descripcion son requeridos' });

  try {
    await run('BEGIN TRANSACTION');

    const ins = await run(`
      INSERT INTO orden_trabajo_detalle
        (orden_id, descripcion, tipo, cantidad, precio_unitario, mecanico_id, estado)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [ordenId, descripcion, tipo, cantidad || 1, precio_unitario || 0, mecanico_id || null, estado || 'pendiente']);

    await recalcularTotalesOrden(ordenId);

    await run('COMMIT');
    res.json({ success: true, id: ins.lastID });
  } catch (e) {
    try { await run('ROLLBACK'); } catch (_) {}
    res.status(500).json({ error: e.message });
  }
});

router.put('/api/ordenes/:ordenId/detalle/:itemId', async (req, res) => {
  const { ordenId, itemId } = req.params;
  const { tipo, descripcion, cantidad, precio_unitario, mecanico_id, estado } = req.body;

  try {
    await run('BEGIN TRANSACTION');

    await run(`
      UPDATE orden_trabajo_detalle
      SET tipo = COALESCE(?, tipo),
          descripcion = COALESCE(?, descripcion),
          cantidad = COALESCE(?, cantidad),
          precio_unitario = COALESCE(?, precio_unitario),
          mecanico_id = COALESCE(?, mecanico_id),
          estado = COALESCE(?, estado)
      WHERE id = ? AND orden_id = ?
    `, [tipo, descripcion, cantidad, precio_unitario, mecanico_id, estado, itemId, ordenId]);

    await recalcularTotalesOrden(ordenId);

    await run('COMMIT');
    res.json({ success: true });
  } catch (e) {
    try { await run('ROLLBACK'); } catch (_) {}
    res.status(500).json({ error: e.message });
  }
});

router.delete('/api/ordenes/:ordenId/detalle/:itemId', async (req, res) => {
  const { ordenId, itemId } = req.params;
  try {
    await run('BEGIN TRANSACTION');

    await run(`DELETE FROM orden_trabajo_detalle WHERE id = ? AND orden_id = ?`, [itemId, ordenId]);
    await recalcularTotalesOrden(ordenId);

    await run('COMMIT');
    res.json({ success: true });
  } catch (e) {
    try { await run('ROLLBACK'); } catch (_) {}
    res.status(500).json({ error: e.message });
  }
});

// ====== ABONOS ======
router.post('/api/ordenes/:ordenId/abonos', async (req, res) => {
  const { ordenId } = req.params;
  const { fecha, monto, tipo_pago, observaciones } = req.body;

  if (!fecha || !monto) return res.status(400).json({ error: 'fecha y monto son requeridos' });

  try {
    await run('BEGIN TRANSACTION');

    const ins = await run(`
      INSERT INTO orden_trabajo_abonos (orden_id, fecha, monto, tipo_pago, observaciones)
      VALUES (?, ?, ?, ?, ?)
    `, [ordenId, fecha, r2(monto), tipo_pago || null, observaciones || null]);

    await recalcularTotalesOrden(ordenId);

    await run('COMMIT');
    res.json({ success: true, id: ins.lastID });
  } catch (e) {
    try { await run('ROLLBACK'); } catch (_) {}
    res.status(500).json({ error: e.message });
  }
});

router.delete('/api/ordenes/:ordenId/abonos/:abonoId', async (req, res) => {
  const { ordenId, abonoId } = req.params;
  try {
    await run('BEGIN TRANSACTION');

    await run(`DELETE FROM orden_trabajo_abonos WHERE id = ? AND orden_id = ?`, [abonoId, ordenId]);
    await recalcularTotalesOrden(ordenId);

    await run('COMMIT');
    res.json({ success: true });
  } catch (e) {
    try { await run('ROLLBACK'); } catch (_) {}
    res.status(500).json({ error: e.message });
  }
});

// ====== CHECKLIST (opcional, si deseas guardar items dinámicos) ======
router.put('/api/ordenes/:ordenId/checklist', async (req, res) => {
  const { ordenId } = req.params;
  const { items = [] } = req.body; // [{item:'llaves', valor:'si'}, ...]
  try {
    await run('BEGIN TRANSACTION');

    // Borrado e inserción simple (si manejas items dinámicos)
    await run(`DELETE FROM orden_trabajo_checklist WHERE orden_id = ?`, [ordenId]);

    if (Array.isArray(items) && items.length) {
      const stmt = await new Promise((ok, ko) => {
        const s = db.prepare(
          `INSERT INTO orden_trabajo_checklist (orden_id, item, valor) VALUES (?, ?, ?)`,
          e => e ? ko(e) : ok(s)
        );
      });
      for (const it of items) {
        await new Promise((ok, ko) => stmt.run([ordenId, it.item, it.valor], e => e ? ko(e) : ok()));
      }
      await new Promise((ok, ko) => stmt.finalize(e => e ? ko(e) : ok()));
    }

    await run('COMMIT');
    res.json({ success: true });
  } catch (e) {
    try { await run('ROLLBACK'); } catch (_) {}
    res.status(500).json({ error: e.message });
  }
});

// Crear OT manual (cabecera)
router.post('/api/ordenes', async (req, res) => {
  try {
    const {
      cliente, contacto, vehiculo, placa, modelo,
      kilometraje, fecha_entrega_estimada, observaciones
    } = req.body;

    if (!cliente || !vehiculo) {
      return res.status(400).json({ error: 'cliente y vehiculo son requeridos' });
    }

    const hoy = new Date().toISOString().split('T')[0];

    const ins = await new Promise((ok, ko) =>
      db.run(
        `INSERT INTO ordenes_trabajo
           (fecha_creacion, cliente, contacto, vehiculo, placa, modelo, kilometraje,
            fecha_entrega_estimada, observaciones, estado, total, abonado, saldo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'en_curso', 0, 0, 0)`,
        [hoy, cliente, contacto || null, vehiculo, placa || null, modelo || null,
         kilometraje || null, fecha_entrega_estimada || null, observaciones || null],
        function (err) { return err ? ko(err) : ok(this); }
      )
    );

    res.json({ success: true, ordenId: ins.lastID });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


module.exports = router;
