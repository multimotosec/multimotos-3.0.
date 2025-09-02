// backend/routes/proveedores.js
const express = require('express');
const router = express.Router();
const db = require('../database');

// Helpers Promesa
function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
  });
}
function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
  });
}
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

/* ========= PROVEEDORES ========= */
// GET /api/proveedores
router.get('/', async (_req, res) => {
  try {
    const rows = await all(`SELECT * FROM proveedores WHERE activo=1 ORDER BY nombre`);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/proveedores
router.post('/', async (req, res) => {
  try {
    const { nombre, ruc, telefono, email, direccion } = req.body;
    if (!nombre) return res.status(400).json({ error: 'Nombre es obligatorio' });
    const r = await run(
      `INSERT INTO proveedores(nombre, ruc, telefono, email, direccion) VALUES (?,?,?,?,?)`,
      [nombre, ruc || null, telefono || null, email || null, direccion || null]
    );
    const row = await all(`SELECT * FROM proveedores WHERE id=?`, [r.lastID]);
    res.json(row[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/proveedores/:id
router.put('/:id', async (req, res) => {
  try {
    const { nombre, ruc, telefono, email, direccion, activo } = req.body;
    await run(
      `UPDATE proveedores SET nombre=?, ruc=?, telefono=?, email=?, direccion=?, activo=? WHERE id=?`,
      [nombre, ruc, telefono, email, direccion, (activo ?? 1), req.params.id]
    );
    const row = await all(`SELECT * FROM proveedores WHERE id=?`, [req.params.id]);
    res.json(row[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ========= COMPRAS ========= */
// GET /api/proveedores/compras
router.get('/compras', async (_req, res) => {
  try {
    const rows = await all(`
      SELECT c.*, p.nombre AS proveedor
      FROM compras_cabecera c
      LEFT JOIN proveedores p ON p.id = c.proveedor_id
      ORDER BY c.fecha_recepcion DESC, c.id DESC
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/proveedores/compras/:id
router.get('/compras/:id', async (req, res) => {
  try {
    const cab = await get(`
      SELECT c.*, p.nombre AS proveedor
      FROM compras_cabecera c
      LEFT JOIN proveedores p ON p.id = c.proveedor_id
      WHERE c.id=?`, [req.params.id]);
    const det = await all(`SELECT * FROM compras_detalle WHERE compra_id=? ORDER BY id`, [req.params.id]);
    res.json({ cabecera: cab, detalle: det });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/proveedores/compras/:id  (editar solo si estado=pendiente)
router.put('/compras/:id', async (req, res) => {
  try {
    const compra_id = Number(req.params.id);
    const cabAct = await get(`SELECT estado, abonado FROM compras_cabecera WHERE id=?`, [compra_id]);
    if (!cabAct) return res.status(404).json({ error: 'Compra no encontrada' });
    if (String(cabAct.estado).toLowerCase() !== 'pendiente') {
      return res.status(409).json({ error: 'La compra no está pendiente. No se puede editar.' });
    }

    const { proveedor_id, numero_factura, fecha_recepcion, condicion_pago, observaciones, items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Items vacíos' });
    }
    for (const it of items) {
      if ((Number(it.precio_unitario) || 0) < 0) {
        return res.status(400).json({ error: 'Precio de compra inválido' });
      }
    }

    let total = 0;
    for (const it of items) {
      total += (Number(it.cantidad)||0) * (Number(it.precio_unitario)||0);
    }

    const abonado = Number(cabAct.abonado) || 0;
    const saldo = Math.max(total - abonado, 0);
    const estado = saldo <= 0 ? 'pagado' : (abonado > 0 ? 'parcial' : 'pendiente');

    await run(`
      UPDATE compras_cabecera
      SET proveedor_id = COALESCE(?, proveedor_id),
          numero_factura = COALESCE(?, numero_factura),
          fecha_recepcion = COALESCE(?, fecha_recepcion),
          condicion_pago = COALESCE(?, condicion_pago),
          observaciones = COALESCE(?, observaciones),
          total = ?,
          saldo = ?,
          estado = ?
      WHERE id = ?`,
      [proveedor_id ?? null, numero_factura ?? null, fecha_recepcion ?? null, condicion_pago ?? null, observaciones ?? null, total, saldo, estado, compra_id]
    );

    await run(`DELETE FROM compras_detalle WHERE compra_id=?`, [compra_id]);
    for (const it of items) {
      const cant = Number(it.cantidad)||0;
      const precio = Number(it.precio_unitario)||0;
      const subtotal = cant * precio;
      await run(
        `INSERT INTO compras_detalle(compra_id, descripcion, cantidad, precio_unitario, subtotal, origen, registro_detalle_id)
         VALUES (?,?,?,?,?,?,?)`,
        [compra_id, it.descripcion, cant, precio, subtotal, it.origen || 'manual', it.registro_detalle_id || null]
      );
    }

    const cab = await get(`SELECT * FROM compras_cabecera WHERE id=?`, [compra_id]);
    const det = await all(`SELECT * FROM compras_detalle WHERE compra_id=? ORDER BY id`, [compra_id]);
    res.json({ cabecera: cab, detalle: det });

  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/proveedores/compras
router.post('/compras', async (req, res) => {
  const { proveedor_id, numero_factura, fecha_recepcion, condicion_pago, observaciones, items } = req.body;
  try {
    if (!proveedor_id || !fecha_recepcion || !condicion_pago || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Datos incompletos para la compra' });
    }
    for (const it of items) {
      if ((Number(it.precio_unitario) || 0) < 0) {
        return res.status(400).json({ error: 'Precio de compra inválido' });
      }
    }
    let total = 0;
    for (const it of items) {
      total += (Number(it.cantidad)||0) * (Number(it.precio_unitario)||0);
    }
    const contado = String(condicion_pago).toLowerCase() === 'contado';
    const abonado = contado ? total : 0;
    const saldo = total - abonado;
    const estado = saldo <= 0 ? 'pagado' : (abonado > 0 ? 'parcial' : 'pendiente');

    const insCab = await run(
      `INSERT INTO compras_cabecera(proveedor_id, numero_factura, fecha_recepcion, condicion_pago, total, abonado, saldo, estado, observaciones)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [proveedor_id, numero_factura || null, fecha_recepcion, condicion_pago, total, abonado, saldo, estado, observaciones || null]
    );
    const compra_id = insCab.lastID;

    for (const it of items) {
      const cant = Number(it.cantidad) || 0;
      const precio = Number(it.precio_unitario) || 0;
      const subtotal = cant * precio;
      await run(
        `INSERT INTO compras_detalle(compra_id, descripcion, cantidad, precio_unitario, subtotal, origen, registro_detalle_id)
         VALUES (?,?,?,?,?,?,?)`,
        [compra_id, it.descripcion, cant, precio, subtotal, it.origen || 'registro', it.registro_detalle_id || null]
      );
    }

    const cab = await get(`SELECT * FROM compras_cabecera WHERE id=?`, [compra_id]);
    const det = await all(`SELECT * FROM compras_detalle WHERE compra_id=? ORDER BY id`, [compra_id]);
    res.json({ cabecera: cab, detalle: det });

  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ========= ABONOS ========= */
// POST /api/proveedores/abonos
router.post('/abonos', async (req, res) => {
  try {
    const { compra_id, fecha, monto, tipo_pago, observaciones } = req.body;
    if (!compra_id || !fecha || !monto) return res.status(400).json({ error: 'Datos incompletos para el abono' });

    await run(
      `INSERT INTO compras_abonos(compra_id, fecha, monto, tipo_pago, observaciones)
       VALUES (?,?,?,?,?)`,
      [compra_id, fecha, Number(monto), tipo_pago || null, observaciones || null]
    );

    await run(`UPDATE compras_cabecera SET abonado = abonado + ?, saldo = total - abonado WHERE id=?`, [Number(monto), compra_id]);

    await run(
      `UPDATE compras_cabecera
       SET estado = CASE
         WHEN saldo <= 0 THEN 'pagado'
         WHEN abonado > 0 AND saldo > 0 THEN 'parcial'
         ELSE 'pendiente'
       END
       WHERE id=?`,
      [compra_id]
    );

    const cab = await get(`SELECT * FROM compras_cabecera WHERE id=?`, [compra_id]);
    res.json({ ok: true, compra: cab });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/proveedores/compras/:id/abonos
router.get('/compras/:id/abonos', async (req, res) => {
  try {
    const rows = await all(
      `SELECT * FROM compras_abonos WHERE compra_id=? ORDER BY date(fecha) ASC, id ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ========= CXP ========= */
// GET /api/proveedores/cxp
router.get('/cxp', async (_req, res) => {
  try {
    const rows = await all(`
      SELECT c.id AS compra_id, p.nombre AS proveedor, c.numero_factura, c.fecha_recepcion, c.total, c.abonado, c.saldo, c.estado
      FROM compras_cabecera c
      LEFT JOIN proveedores p ON p.id = c.proveedor_id
      WHERE c.saldo > 0
      ORDER BY c.fecha_recepcion DESC, c.id DESC
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ========= CRUCE DE VENTAS ========= */
// GET /api/proveedores/ventas?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
router.get('/ventas', async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    if (!desde || !hasta) return res.status(400).json({ error: 'Faltan fechas desde/hasta' });

    const rows = await all(`
      SELECT 
        d.id AS registro_detalle_id,
        c.fecha AS fecha,
        d.descripcion,
        d.cantidad,
        d.valor,
        d.tipo_transaccion
      FROM registro_detalle d
      JOIN registro_cabecera c ON c.id = d.id_cabecera
      WHERE date(c.fecha) BETWEEN date(?) AND date(?)
        AND LOWER(d.tipo_transaccion) = 'venta'
      ORDER BY c.fecha ASC, d.id ASC
    `, [desde, hasta]);

    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
