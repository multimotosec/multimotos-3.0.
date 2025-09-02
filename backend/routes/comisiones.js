// backend/routes/comisiones.js
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const router = express.Router();
const dbPath = path.resolve(__dirname, '../../database/database.db');
const db = new sqlite3.Database(dbPath);

function all(sql, params=[]) { return new Promise((res, rej)=>db.all(sql, params, (e, r)=>e?rej(e):res(r))); }
function get(sql, params=[]) { return new Promise((res, rej)=>db.get(sql, params, (e, r)=>e?rej(e):res(r))); }
function run(sql, params=[]) { return new Promise((res, rej)=>db.run(sql, params, function(e){e?rej(e):res(this);})); }
const r2 = (n)=>Math.round((Number(n)||0)*100)/100;

async function ensureSchema() {
  await run(`
    CREATE TABLE IF NOT EXISTS liquidaciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mecanico_id INTEGER NOT NULL,
      fecha_inicio TEXT NOT NULL,
      fecha_fin TEXT NOT NULL,
      fecha_liquidacion TEXT NOT NULL DEFAULT (date('now','localtime')),
      total_comisiones REAL NOT NULL DEFAULT 0,
      total_ingresos REAL NOT NULL DEFAULT 0,
      total_descuentos REAL NOT NULL DEFAULT 0,
      total_neto REAL NOT NULL DEFAULT 0,
      observaciones TEXT,
      creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (mecanico_id) REFERENCES mecanicos(id)
    );
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS rubros_liquidacion (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      liquidacion_id INTEGER NOT NULL,
      tipo TEXT NOT NULL CHECK (tipo IN ('INGRESO','DESCUENTO')),
      concepto TEXT NOT NULL,
      descripcion TEXT,
      monto REAL NOT NULL,
      fecha TEXT NOT NULL,
      FOREIGN KEY (liquidacion_id) REFERENCES liquidaciones(id)
    );
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS liquidacion_detalle (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      liquidacion_id INTEGER NOT NULL,
      registro_detalle_id INTEGER NOT NULL,
      base_monto REAL NOT NULL,
      porcentaje_comision REAL NOT NULL,
      comision_monto REAL NOT NULL,
      FOREIGN KEY (liquidacion_id) REFERENCES liquidaciones(id)
    );
  `);
  // columnas en registro_detalle
  const cols = await all(`PRAGMA table_info(registro_detalle)`);
  const names = cols.map(c=>c.name.toLowerCase());
  if (!names.includes('liquidacion_id')) await run(`ALTER TABLE registro_detalle ADD COLUMN liquidacion_id INTEGER;`);
  if (!names.includes('comision'))       await run(`ALTER TABLE registro_detalle ADD COLUMN comision REAL DEFAULT 0;`);
  // tabla rubros_pendientes (por si no corrieron migración)
  await run(`
    CREATE TABLE IF NOT EXISTS rubros_pendientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mecanico_id INTEGER NOT NULL,
      tipo TEXT NOT NULL CHECK (tipo IN ('INGRESO','DESCUENTO')),
      concepto TEXT NOT NULL,
      descripcion TEXT,
      monto REAL NOT NULL,
      fecha TEXT NOT NULL,
      creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (mecanico_id) REFERENCES mecanicos(id)
    );
  `);
}
ensureSchema().catch(e=>console.error('Schema ensure error:', e.message));

// --- MECÁNICOS
router.get('/mecanicos', async (req,res)=>{
  try {
    const rows = await all(`SELECT id, nombre, porcentaje_comision FROM mecanicos WHERE activo=1 ORDER BY nombre;`);
    res.json(rows);
  } catch(e){ res.status(500).json({error:e.message}); }
});

// --- PENDIENTES DE M/O
router.get('/pendientes', async (req,res)=>{
  try {
    const mecanico_id = parseInt(req.query.mecanico_id||0,10);
    const desde = String(req.query.desde||'').slice(0,10);
    const hasta = String(req.query.hasta||'').slice(0,10);
    if (!mecanico_id || !desde || !hasta) return res.status(400).json({error:'Parámetros inválidos'});
    const sql = `
      SELECT d.id AS registro_detalle_id, c.fecha, d.descripcion,
             d.valor AS base_monto, m.porcentaje_comision,
             ROUND(d.valor*(m.porcentaje_comision/100.0),2) AS comision_mo
      FROM registro_detalle d
      JOIN registro_cabecera c ON c.id=d.id_cabecera
      JOIN mecanicos m ON m.id=d.mecanico_id
      WHERE d.mecanico_id=? 
        AND d.tipo_transaccion='Mano de Obra'
        AND date(c.fecha) BETWEEN date(?) AND date(?)
        AND (d.liquidacion_id IS NULL OR d.liquidacion_id=0)
      ORDER BY c.fecha ASC, d.id ASC;
    `;
    const rows = await all(sql, [mecanico_id, desde, hasta]);
    res.json(rows);
  } catch(e){ res.status(500).json({error:e.message}); }
});

// --- RUBROS PENDIENTES (persistencia por mecánico)
router.get('/pendientes-rubros', async (req,res)=>{
  try {
    const mecanico_id = parseInt(req.query.mecanico_id||0,10);
    if (!mecanico_id) return res.status(400).json({error:'mecanico_id requerido'});
    const rows = await all(`
      SELECT id, tipo, concepto, descripcion, monto, fecha
      FROM rubros_pendientes
      WHERE mecanico_id=?
      ORDER BY fecha ASC, id ASC;
    `,[mecanico_id]);
    res.json(rows);
  } catch(e){ res.status(500).json({error:e.message}); }
});

router.post('/pendientes-rubros', async (req,res)=>{
  try {
    const b = req.body||{};
    const mecanico_id = parseInt(b.mecanico_id||0,10);
    const tipo = (String(b.tipo||'INGRESO').toUpperCase()==='DESCUENTO')?'DESCUENTO':'INGRESO';
    const concepto = String(b.concepto||'Otros').slice(0,80);
    const descripcion = String(b.descripcion||'').slice(0,200);
    const monto = r2(b.monto);
    const fecha = String(b.fecha||new Date().toISOString().slice(0,10)).slice(0,10);
    if (!mecanico_id || !monto || monto<=0) return res.status(400).json({error:'Datos inválidos'});
    const ins = await run(`
      INSERT INTO rubros_pendientes (mecanico_id, tipo, concepto, descripcion, monto, fecha)
      VALUES (?, ?, ?, ?, ?, ?);
    `,[mecanico_id, tipo, concepto, descripcion, monto, fecha]);
    res.json({ok:true, id: ins.lastID});
  } catch(e){ res.status(500).json({error:e.message}); }
});

router.delete('/pendientes-rubros/:id', async (req,res)=>{
  try {
    const id = parseInt(req.params.id||0,10);
    await run(`DELETE FROM rubros_pendientes WHERE id=?;`, [id]);
    res.json({ok:true});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// --- GENERAR LIQUIDACIÓN (consume rubros_pendientes del mecánico)
router.post('/generar', async (req, res) => {
  const b = req.body||{};
  const mecanico_id = parseInt(b.mecanico_id||0,10);
  const desde = String(b.desde||'').slice(0,10);
  const hasta = String(b.hasta||'').slice(0,10);
  const registros = Array.isArray(b.registros)?b.registros.map(n=>parseInt(n,10)).filter(Boolean):[];
  const observaciones = String(b.observaciones||'').slice(0,1000);
  if (!mecanico_id || !desde || !hasta || registros.length===0) return res.status(400).json({error:'Datos incompletos'});

  db.serialize(async ()=>{
    try {
      await run('BEGIN TRANSACTION');

      // Validar y calcular comisiones
      const ph = registros.map(()=>'?').join(',');
      const regRows = await all(`
        SELECT d.id AS registro_detalle_id, d.valor AS base_monto,
               IFNULL(d.comision,0) AS comision_guardada,
               m.porcentaje_comision
        FROM registro_detalle d
        JOIN mecanicos m ON m.id=d.mecanico_id
        WHERE d.id IN (${ph}) AND d.mecanico_id=?;
      `,[...registros, mecanico_id]);
      if (regRows.length!==registros.length) throw new Error('Registros no válidos para este mecánico');
      const detalles = regRows.map(r=>{
        const pct = Number(r.porcentaje_comision||0);
        const base = Number(r.base_monto||0);
        const comi = r2(base*pct/100);
        return { id:r.registro_detalle_id, base, pct, comi };
      });
      const totalComisiones = r2(detalles.reduce((a,x)=>a+x.comi,0));

      // Traer rubros pendientes de este mecánico (todos, cualquier fecha)
      const pend = await all(`
        SELECT id, tipo, concepto, descripcion, monto, fecha
        FROM rubros_pendientes
        WHERE mecanico_id=?
        ORDER BY fecha ASC, id ASC;
      `,[mecanico_id]);

      const totalIngresos = r2(pend.filter(r=>r.tipo==='INGRESO').reduce((a,x)=>a+Number(x.monto||0),0));
      const totalDescuentos = r2(pend.filter(r=>r.tipo==='DESCUENTO').reduce((a,x)=>a+Number(x.monto||0),0));
      const totalNeto = r2(totalComisiones + totalIngresos - totalDescuentos);

      // Cabecera
      const ins = await run(`
        INSERT INTO liquidaciones (mecanico_id, fecha_inicio, fecha_fin,
          total_comisiones, total_ingresos, total_descuentos, total_neto, observaciones)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?);
      `,[mecanico_id, desde, hasta, totalComisiones, totalIngresos, totalDescuentos, totalNeto, observaciones]);
      const liquidacion_id = ins.lastID;

      // Detalle snapshot
      const stmtDet = db.prepare(`
        INSERT INTO liquidacion_detalle (liquidacion_id, registro_detalle_id, base_monto, porcentaje_comision, comision_monto)
        VALUES (?, ?, ?, ?, ?);
      `);
      for (const d of detalles) await new Promise((ok,ko)=>stmtDet.run([liquidacion_id, d.id, d.base, d.pct, d.comi], e=>e?ko(e):ok()));
      stmtDet.finalize();

      // Rubros (mover pendientes -> rubros_liquidacion)
      const stmtRub = db.prepare(`
        INSERT INTO rubros_liquidacion (liquidacion_id, tipo, concepto, descripcion, monto, fecha)
        VALUES (?, ?, ?, ?, ?, ?);
      `);
      for (const r of pend) await new Promise((ok,ko)=>stmtRub.run([liquidacion_id, r.tipo, r.concepto, r.descripcion, r.monto, r.fecha], e=>e?ko(e):ok()));
      stmtRub.finalize();

      // Borrar pendientes consumidos
      await run(`DELETE FROM rubros_pendientes WHERE mecanico_id=?;`, [mecanico_id]);

      // Marcar registros como liquidados
      const stmtUpd = db.prepare(`UPDATE registro_detalle SET liquidacion_id=?, comision=? WHERE id=?;`);
      for (const d of detalles) await new Promise((ok,ko)=>stmtUpd.run([liquidacion_id, d.comi, d.id], e=>e?ko(e):ok()));
      stmtUpd.finalize();

      await run('COMMIT');
      res.json({ ok:true, liquidacion_id, totalComisiones, totalIngresos, totalDescuentos, totalNeto });
    } catch(err){
      await run('ROLLBACK');
      res.status(500).json({error:err.message});
    }
  });
});

// --- HISTÓRICO
router.get('/liquidaciones', async (req,res)=>{
  try {
    const rows = await all(`
      SELECT l.id, l.fecha_liquidacion, l.fecha_inicio, l.fecha_fin, m.nombre AS mecanico,
             l.total_comisiones, l.total_ingresos, l.total_descuentos, l.total_neto
      FROM liquidaciones l
      JOIN mecanicos m ON m.id=l.mecanico_id
      ORDER BY l.id DESC;
    `);
    res.json(rows);
  } catch(e){ res.status(500).json({error:e.message}); }
});

router.get('/liquidaciones/:id', async (req,res)=>{
  try {
    const id = parseInt(req.params.id||0,10);
    const cab = await get(`
      SELECT l.*, m.nombre AS mecanico
      FROM liquidaciones l
      JOIN mecanicos m ON m.id=l.mecanico_id
      WHERE l.id=?;
    `,[id]);
    if (!cab) return res.status(404).json({error:'No existe la liquidación'});
    const det = await all(`
      SELECT d.registro_detalle_id, d.base_monto, d.porcentaje_comision, d.comision_monto,
             rc.fecha, rd.descripcion
      FROM liquidacion_detalle d
      LEFT JOIN registro_detalle rd ON rd.id=d.registro_detalle_id
      LEFT JOIN registro_cabecera rc ON rc.id=rd.id_cabecera
      WHERE d.liquidacion_id=?
      ORDER BY rc.fecha ASC, d.registro_detalle_id ASC;
    `,[id]);
    const rub = await all(`
      SELECT tipo, concepto, descripcion, monto, fecha
      FROM rubros_liquidacion
      WHERE liquidacion_id=?
      ORDER BY id ASC;
    `,[id]);
    res.json({cabecera:cab, detalle:det, rubros:rub});
  } catch(e){ res.status(500).json({error:e.message}); }
});

module.exports = router;
