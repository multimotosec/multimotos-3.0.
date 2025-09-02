// backend/routes/caja.js
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const router = express.Router();

// ================== CONFIG DB ==================
const dbPath = path.resolve(__dirname, '../../database/database.db');
const db = new sqlite3.Database(dbPath);

// Helpers promisificados
const all = (sql, params = []) =>
  new Promise((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));
const get = (sql, params = []) =>
  new Promise((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row))));
const run = (sql, params = []) =>
  new Promise((resolve, reject) => db.run(sql, params, function (err) { if (err) reject(err); else resolve(this); }));

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ================== Constantes de negocio ==================
const PAGO_EFECTIVO  = 'Pagado (Efectivo)';
const PAGO_TRANSFER  = 'Pagado (Transferencia)';
const PAGO_PENDIENTE = 'Pendiente';

// Aceptamos varios nombres para gasto/salida
const TX_GASTO_VARIANTES = ['Gasto', 'Salida', 'Egreso', 'Alimentación', 'Compra', 'Cuenta por Cobrar', 'Proveedor', 'Sueldo'];

// ================== Introspección de esquema ==================
async function tableExists(name) {
  try {
    const row = await get(
      `SELECT name FROM sqlite_master WHERE type='table' AND lower(name)=lower(?)`,
      [name]
    );
    return !!row;
  } catch { return false; }
}

async function columnExists(table, column) {
  try {
    const rows = await all(`PRAGMA table_info(${table})`);
    return rows.some(c => c.name?.toLowerCase() === String(column).toLowerCase());
  } catch { return false; }
}

// Aseguramos tabla caja
db.serialize(() => {
  db.run(
    `CREATE TABLE IF NOT EXISTS caja (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha              TEXT NOT NULL,
      monto_apertura     REAL NOT NULL DEFAULT 0,
      hora_apertura      TEXT,
      monto_real         REAL,
      total_calculado    REAL,
      descuadre          REAL,
      observacion_cierre TEXT,
      hora_cierre        TEXT
    );`
  );
  db.run(`CREATE INDEX IF NOT EXISTS idx_caja_fecha ON caja (fecha);`);
});

// ================== Sumas seguras ==================
async function getSumSafe(sql, params = []) {
  try { const row = await get(sql, params); return Number(row?.total || 0); }
  catch { return 0; }
}

// Detecta qué columna de monto usar en registro_detalle
async function pickDetalleMontoCol() {
  if (await columnExists('registro_detalle', 'valor')) return 'rd.valor';
  if (await columnExists('registro_detalle', 'monto')) return 'rd.monto';
  return null;
}

// ================== Sumas DIRECTAS desde registro_detalle ==================
// IMPORTANTE: Excluimos gastos/salidas de "ingresos" (antes se sumaban).
async function sumDetallePorPago(fecha, etiquetaPago) {
  const hasRD = await tableExists('registro_detalle');
  const hasRC = await tableExists('registro_cabecera');
  if (!hasRD || !hasRC) return 0;

  const colMonto = await pickDetalleMontoCol();
  if (!colMonto) return 0;

  const hasTipoPago = await columnExists('registro_detalle', 'tipo_pago');
  const rdIdCab = await columnExists('registro_detalle', 'id_cabecera');
  const rcFecha = await columnExists('registro_cabecera', 'fecha');
  const hasTipoTx = await columnExists('registro_detalle', 'tipo_transaccion');

  if (!(hasTipoPago && rdIdCab && rcFecha)) return 0;

  // Construimos filtro para EXCLUIR gastos en cualquier suma por tipo de pago
  let filtroGastos = '';
  let params = [fecha, etiquetaPago];

  if (hasTipoTx) {
    const placeholders = TX_GASTO_VARIANTES.map(() => '?').join(',');
    const lowerList = TX_GASTO_VARIANTES.map(v => v.toLowerCase());
    filtroGastos = ` AND (rd.tipo_transaccion IS NULL OR lower(rd.tipo_transaccion) NOT IN (${placeholders}))`;
    params = [fecha, etiquetaPago, ...lowerList];
  }

  const sql = `
    SELECT SUM(${colMonto}) total
      FROM registro_detalle rd
      JOIN registro_cabecera rc ON rc.id = rd.id_cabecera
     WHERE date(rc.fecha) = date(?)
       AND rd.tipo_pago = ? ${filtroGastos}
  `;

  return await getSumSafe(sql, params);
}

async function sumDetalleGastos(fecha) {
  const hasRD = await tableExists('registro_detalle');
  const hasRC = await tableExists('registro_cabecera');
  if (!hasRD || !hasRC) return 0;

  const colMonto = await pickDetalleMontoCol();
  if (!colMonto) return 0;

  const hasTipoTx = await columnExists('registro_detalle', 'tipo_transaccion');
  const rdIdCab = await columnExists('registro_detalle', 'id_cabecera');
  const rcFecha = await columnExists('registro_cabecera', 'fecha');

  if (!(hasTipoTx && rdIdCab && rcFecha)) return 0;

  const placeholders = TX_GASTO_VARIANTES.map(() => '?').join(',');
  const lowerList = TX_GASTO_VARIANTES.map(v => v.toLowerCase());

  return await getSumSafe(
    `
    SELECT SUM(${colMonto}) total
      FROM registro_detalle rd
      JOIN registro_cabecera rc ON rc.id = rd.id_cabecera
     WHERE date(rc.fecha) = date(?)
       AND lower(rd.tipo_transaccion) IN (${placeholders})
    `,
    [fecha, ...lowerList]
  );
}

// ================== Cálculo principal ==================
async function calcularResumen(fecha) {
  // Monto inicial desde caja
  const apertura = await get(`SELECT monto_apertura FROM caja WHERE date(fecha) = date(?)`, [fecha]);
  const montoInicial = apertura ? Number(apertura.monto_apertura || 0) : 0;

  // SUMAS (ya corrigen la sobrestimación de ingresos en efectivo)
  const ingresosEfectivo = await sumDetallePorPago(fecha, PAGO_EFECTIVO);
  const ingresosBanco    = await sumDetallePorPago(fecha, PAGO_TRANSFER);
  const cuentasCobrar    = await sumDetallePorPago(fecha, PAGO_PENDIENTE);

  // GASTOS (incluye pagados y pendientes)
  const gastos           = await sumDetalleGastos(fecha);

  const totalCalculado = r2(montoInicial + ingresosEfectivo + ingresosBanco - gastos);

  return {
    monto_inicial: montoInicial,
    ingresos_efectivo: ingresosEfectivo,
    ingresos_banco: ingresosBanco,
    cuentas_cobrar: cuentasCobrar,
    gastos,
    total_calculado: totalCalculado,
  };
}

async function getResumenInterno(fecha) {
  const tieneApertura = await get(`SELECT 1 FROM caja WHERE date(fecha) = date(?)`, [fecha]);
  if (!tieneApertura) return null;
  const r = await calcularResumen(fecha);
  return { total_calculado: r.total_calculado };
}

// ================== Rutas existentes ==================

// Apertura
router.post('/apertura', async (req, res) => {
  try {
    const { fecha, monto_inicial } = req.body;
    if (!fecha || monto_inicial === undefined) {
      return res.status(400).json({ error: 'Datos incompletos' });
    }
    const existe = await get(`SELECT id FROM caja WHERE date(fecha) = date(?)`, [fecha]);
    if (existe) {
      return res.status(400).json({ error: `Ya existe una caja aperturada para ${fecha}` });
    }
    await run(
      `INSERT INTO caja (fecha, monto_apertura, hora_apertura)
       VALUES (date(?), ?, time('now','localtime'))`,
      [fecha, Number(monto_inicial)]
    );
    res.json({ ok: true, mensaje: `Se ha aperturado la caja para la fecha ${fecha} con el valor ${monto_inicial}.` });
  } catch (err) {
    console.error('ERROR /apertura:', err);
    res.status(500).json({ error: err.message });
  }
});

// Resumen
router.get('/resumen', async (req, res) => {
  try {
    const { fecha } = req.query;
    if (!fecha) return res.status(400).json({ error: 'Fecha requerida' });

    const apertura = await get(`SELECT 1 FROM caja WHERE date(fecha) = date(?)`, [fecha]);
    if (!apertura) {
      return res.json({
        monto_inicial: 0,
        ingresos_efectivo: 0,
        ingresos_banco: 0,
        cuentas_cobrar: 0,
        gastos: 0,
        total_calculado: 0,
      });
    }

    const resumen = await calcularResumen(fecha);
    res.json(resumen);
  } catch (err) {
    console.error('ERROR /resumen:', err);
    res.json({
      monto_inicial: 0,
      ingresos_efectivo: 0,
      ingresos_banco: 0,
      cuentas_cobrar: 0,
      gastos: 0,
      total_calculado: 0,
      _warning: err.message
    });
  }
});

// Cierre
router.post('/cierre', async (req, res) => {
  try {
    const { fecha, monto_fisico, observaciones } = req.body;
    if (!fecha || monto_fisico === undefined) {
      return res.status(400).json({ error: 'Datos incompletos' });
    }

    const resumen = await getResumenInterno(fecha);
    if (!resumen) {
      return res.status(400).json({ error: 'No hay caja aperturada para esa fecha' });
    }

    const montoDigital = Number(resumen.total_calculado || 0);
    const montoFisico  = Number(monto_fisico);
    const diferencia   = r2(montoFisico - montoDigital);

    if (diferencia !== 0 && !observaciones) {
      return res.status(400).json({ error: 'Debe indicar el motivo en observaciones si hay diferencia' });
    }

    await run(
      `UPDATE caja
          SET monto_real = ?,
              descuadre = ?,
              observacion_cierre = ?,
              total_calculado = ?,
              hora_cierre = time('now','localtime')
        WHERE date(fecha) = date(?)`,
      [montoFisico, diferencia, observaciones || null, montoDigital, fecha]
    );

    res.json({
      ok: true,
      mensaje: 'Caja cerrada correctamente.',
      detalle: {
        monto_digital: montoDigital,
        monto_fisico: montoFisico,
        diferencia,
        motivo: observaciones || '',
      },
    });
  } catch (err) {
    console.error('ERROR /cierre:', err);
    res.status(500).json({ error: err.message });
  }
});

// Historial (solo cerradas)
router.get('/historial', async (req, res) => {
  try {
    const rows = await all(
      `SELECT fecha, monto_apertura, monto_real, total_calculado, descuadre, observacion_cierre
         FROM caja
        WHERE hora_cierre IS NOT NULL
        ORDER BY date(fecha) DESC`
    );
    const mapped = rows.map(r => ({
      fecha: r.fecha,
      monto_inicial: Number(r.monto_apertura || 0),
      monto_final: (r.monto_real != null) ? Number(r.monto_real) : null,
      observaciones: r.observacion_cierre || ''
    }));
    res.json(mapped);
  } catch (err) {
    console.error('ERROR /historial:', err);
    res.status(500).json({ error: err.message });
  }
});

// ================== RUTAS NUEVAS ==================

// ESTADO de la caja por fecha: 'abierta' | 'cerrada' | 'sin_apertura'
router.get('/estado', async (req, res) => {
  try {
    const { fecha } = req.query;
    if (!fecha) return res.status(400).json({ error: 'Fecha requerida' });

    const row = await get(`SELECT hora_cierre FROM caja WHERE date(fecha) = date(?)`, [fecha]);
    if (!row) return res.json({ estado: 'sin_apertura' });
    if (row.hora_cierre) return res.json({ estado: 'cerrada' });
    return res.json({ estado: 'abierta' });
  } catch (err) {
    console.error('ERROR /estado:', err);
    res.status(500).json({ error: err.message });
  }
});

// MOVIMIENTOS del día (para modal del historial)
router.get('/movimientos', async (req, res) => {
  try {
    const { fecha } = req.query;
    if (!fecha) return res.status(400).json({ error: 'Fecha requerida' });

    const hasRD = await tableExists('registro_detalle');
    const hasRC = await tableExists('registro_cabecera');
    if (!hasRD || !hasRC) return res.json([]);

    const rdIdCab = await columnExists('registro_detalle', 'id_cabecera');
    const rcFecha = await columnExists('registro_cabecera', 'fecha');
    if (!(rdIdCab && rcFecha)) return res.json([]);

    const colMonto = await pickDetalleMontoCol();
    if (!colMonto) return res.json([]);

    const hasTipoTx = await columnExists('registro_detalle', 'tipo_transaccion');
    const hasTipoPago = await columnExists('registro_detalle', 'tipo_pago');
    const hasDesc = await columnExists('registro_detalle', 'descripcion');
    const hasDetalle = await columnExists('registro_detalle', 'detalle');

    // Selección dinámica de descripción
    const descExpr = hasDesc ? 'rd.descripcion'
                    : hasDetalle ? 'rd.detalle'
                    : `' '`; // vacío

    const rows = await all(
      `
      SELECT rd.id as id_detalle,
             ${hasTipoTx ? 'rd.tipo_transaccion' : `' '`} as tipo_transaccion,
             ${hasTipoPago ? 'rd.tipo_pago' : `' '`} as tipo_pago,
             ${descExpr} as descripcion,
             ${colMonto} as monto
        FROM registro_detalle rd
        JOIN registro_cabecera rc ON rc.id = rd.id_cabecera
       WHERE date(rc.fecha) = date(?)
       ORDER BY rd.id ASC
      `,
      [fecha]
    );

    res.json(rows);
  } catch (err) {
    console.error('ERROR /movimientos:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
