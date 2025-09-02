// backend/routes/cxc.js
const express = require('express');
const router = express.Router();
const db = require('../database');

// Helpers SQLite promesas
const run = (sql, params=[]) => new Promise((res, rej)=>db.run(sql, params, function(e){ e?rej(e):res(this); }));
const get = (sql, params=[]) => new Promise((res, rej)=>db.get(sql, params, (e,row)=> e?rej(e):res(row)));
const all = (sql, params=[]) => new Promise((res, rej)=>db.all(sql, params, (e,rows)=> e?rej(e):res(rows)));

const r2 = (n) => Number.isFinite(+n) ? Math.round((+n + Number.EPSILON)*100)/100 : 0;

// ============ IMPORTAR desde Registro Diario ============
// Trae sólo DETALLES con tipo_pago='Pendiente' y tipo_transaccion de ingresos
// Tipos válidos de ingreso: Ingreso, Venta, Mano de Obra, Cuenta Cobrada
router.post('/importar', async (req, res) => {
  try {
    const { desde, hasta } = req.body || {};
    const filtrosFecha = [];
    const params = [];

    if (desde) { filtrosFecha.push('date(c.fecha) >= date(?)'); params.push(desde); }
    if (hasta) { filtrosFecha.push('date(c.fecha) <= date(?)'); params.push(hasta); }

    const where = `
      d.tipo_pago = 'Pendiente'
      AND d.tipo_transaccion IN ('Ingreso','Venta','Mano de Obra','Cuenta Cobrada')
      ${filtrosFecha.length ? `AND ${filtrosFecha.join(' AND ')}` : ''}
    `;

    // Tomamos pendientes y que aún no estén creados en CxC (para no duplicar)
    const sql = `
      SELECT c.id AS cab_id, c.fecha, c.cliente,
             d.id AS det_id, d.descripcion AS concepto, d.valor AS monto
      FROM registro_cabecera c
      JOIN registro_detalle d ON d.id_cabecera = c.id
      WHERE ${where}
      AND NOT EXISTS (
        SELECT 1 FROM cxc x
        WHERE x.origen='registro' AND x.registro_detalle_id = d.id
      )
      ORDER BY c.fecha ASC, d.id ASC
    `;
    const rows = await all(sql, params);

    if (!rows || rows.length === 0) {
      return res.json({ ok:true, importados:0, items: [] });
    }

    await run('BEGIN TRANSACTION');
    try {
      for (const r of rows) {
        const monto = r2(r.monto);
        await run(`
          INSERT INTO cxc (cliente, fecha, concepto, monto, saldo, estado, origen, registro_cabecera_id, registro_detalle_id)
          VALUES (?, ?, ?, ?, ?, 'Pendiente', 'registro', ?, ?)
        `, [r.cliente, r.fecha, r.concepto, monto, monto, r.cab_id, r.det_id]);
      }
      await run('COMMIT');
    } catch (e) {
      await run('ROLLBACK');
      throw e;
    }

    res.json({ ok:true, importados: rows.length, items: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ CRUD básico CxC ============

// Listado con filtros opcionales: estado, cliente, desde, hasta
router.get('/', async (req, res) => {
  try {
    const { estado, cliente, desde, hasta } = req.query;
    const where = [];
    const params = [];

    if (estado) { where.push('estado = ?'); params.push(estado); }
    if (cliente) { where.push('cliente LIKE ?'); params.push(`%${cliente}%`); }
    if (desde) { where.push('date(fecha) >= date(?)'); params.push(desde); }
    if (hasta) { where.push('date(fecha) <= date(?)'); params.push(hasta); }

    const sql = `
      SELECT id, fecha, cliente, concepto, monto, saldo, estado, origen
      FROM cxc
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY date(fecha) DESC, id DESC
    `;

    const rows = await all(sql, params);
    res.json(rows || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Crear CxC manual
router.post('/', async (req, res) => {
  try {
    const { fecha, cliente, concepto, monto, observaciones } = req.body || {};
    if (!fecha || !cliente || !concepto || !monto) {
      return res.status(400).json({ error: 'fecha, cliente, concepto y monto son obligatorios' });
    }
    const val = r2(monto);
    const ins = await run(`
      INSERT INTO cxc (cliente, fecha, concepto, monto, saldo, estado, origen, observaciones)
      VALUES (?, ?, ?, ?, ?, 'Pendiente', 'manual', ?)
    `, [cliente, fecha, concepto, val, val, observaciones || null]);

    res.json({ ok:true, id: ins.lastID });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Obtener detalle de una CxC (con abonos)
router.get('/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const cab = await get(`SELECT * FROM cxc WHERE id = ?`, [id]);
    if (!cab) return res.status(404).json({ error: 'CxC no encontrada' });

    const det = await all(`SELECT * FROM cxc_abonos WHERE cxc_id = ? ORDER BY fecha, id`, [id]);
    res.json({ ...cab, abonos: det });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Registrar abono a una CxC
router.post('/:id/abonos', async (req, res) => {
  try {
    const id = req.params.id;
    const { fecha, monto, tipo_pago, observaciones } = req.body || {};
    if (!fecha || !monto) return res.status(400).json({ error: 'fecha y monto son obligatorios' });

    const cx = await get(`SELECT saldo, estado FROM cxc WHERE id = ?`, [id]);
    if (!cx) return res.status(404).json({ error: 'CxC no encontrada' });

    const val = r2(monto);
    if (val <= 0) return res.status(400).json({ error: 'Monto inválido' });

    await run('BEGIN TRANSACTION');
    try {
      await run(`
        INSERT INTO cxc_abonos (cxc_id, fecha, monto, tipo_pago, observaciones)
        VALUES (?, ?, ?, ?, ?)
      `, [id, fecha, val, tipo_pago || null, observaciones || null]);

      const nuevoSaldo = r2((cx.saldo || 0) - val);
      let nuevoEstado = 'Abonado';
      if (nuevoSaldo <= 0) {
        nuevoEstado = 'Liquidado';
      }
      await run(`UPDATE cxc SET saldo = ?, estado = ? WHERE id = ?`, [Math.max(0, nuevoSaldo), nuevoEstado, id]);

      await run('COMMIT');
    } catch (e) {
      await run('ROLLBACK');
      throw e;
    }

    res.json({ ok:true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// (Opcional) Borrar un abono (recalcula saldo)
router.delete('/:id/abonos/:abonoId', async (req, res) => {
  try {
    const { id, abonoId } = req.params;

    await run('BEGIN TRANSACTION');
    try {
      const ab = await get(`SELECT monto FROM cxc_abonos WHERE id = ? AND cxc_id = ?`, [abonoId, id]);
      if (!ab) {
        await run('ROLLBACK');
        return res.status(404).json({ error: 'Abono no encontrado' });
      }
      await run(`DELETE FROM cxc_abonos WHERE id = ?`, [abonoId]);

      const cab = await get(`SELECT saldo, estado FROM cxc WHERE id = ?`, [id]);
      const nuevoSaldo = r2((cab.saldo || 0) + (ab.monto || 0));
      const nuevoEstado = nuevoSaldo <= 0 ? 'Liquidado' : (nuevoSaldo < (cab.monto || nuevoSaldo) ? 'Abonado' : 'Pendiente');
      await run(`UPDATE cxc SET saldo = ?, estado = ? WHERE id = ?`, [nuevoSaldo, nuevoEstado, id]);

      await run('COMMIT');
      res.json({ ok:true });
    } catch (e) {
      await run('ROLLBACK');
      throw e;
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
