// backend/routes/proveedores.js
const express = require('express');
const router = express.Router();
const db = require('../database'); // usa la conexión existente (sqlite3.Database)

// ===== Utils =====
const run = (sql, params = []) =>
  new Promise((ok, ko) => db.run(sql, params, function (e) { e ? ko(e) : ok(this); }));
const get = (sql, params = []) =>
  new Promise((ok, ko) => db.get(sql, params, (e, r) => e ? ko(e) : ok(r)));
const all = (sql, params = []) =>
  new Promise((ok, ko) => db.all(sql, params, (e, r) => e ? ko(e) : ok(r)));
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ===== Ajustes anti-bloqueos SQLite (WAL + busy_timeout) =====
db.serialize(() => {
  // Modo WAL reduce bloqueos entre lecturas/escrituras
  db.run(`PRAGMA journal_mode=WAL`);
  // Reintentar mientras la DB esté ocupada (5 segundos)
  db.run(`PRAGMA busy_timeout=5000`);
});

// ===== Migraciones idempotentes (tablas/columnas que podrían faltar) =====
async function ensureTablesAndColumns() {
  await run(`
    CREATE TABLE IF NOT EXISTS proveedores(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL UNIQUE,
      ruc TEXT,
      telefono TEXT,
      email TEXT,
      direccion TEXT,
      observaciones TEXT,
      creado_en TEXT DEFAULT (datetime('now','localtime'))
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS compras(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proveedor_id INTEGER NOT NULL,
      fecha TEXT NOT NULL,
      num_factura TEXT,
      observaciones TEXT,
      total REAL NOT NULL DEFAULT 0,
      abonado REAL NOT NULL DEFAULT 0,
      saldo REAL NOT NULL DEFAULT 0,
      estado TEXT NOT NULL DEFAULT 'abierta',
      creado_en TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY(proveedor_id) REFERENCES proveedores(id)
    )
  `);

  // En instalaciones antiguas esta tabla podría no tener las columnas nuevas.
  await run(`
    CREATE TABLE IF NOT EXISTS compras_detalle(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      compra_id INTEGER NOT NULL,
      descripcion TEXT NOT NULL,
      cantidad REAL NOT NULL DEFAULT 1,
      FOREIGN KEY(compra_id) REFERENCES compras(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS compras_pagos(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      compra_id INTEGER NOT NULL,
      fecha TEXT NOT NULL,
      monto REAL NOT NULL,
      forma_pago TEXT,
      observaciones TEXT,
      creado_en TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY(compra_id) REFERENCES compras(id)
    )
  `);

  // Asegurar columnas faltantes en compras_detalle
  async function ensureColumn(table, column, definition) {
    const cols = await all(`PRAGMA table_info(${table});`);
    const exists = (cols || []).some(c => c.name === column);
    if (!exists) await run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
  }
  await ensureColumn('compras_detalle', 'costo_unitario', 'REAL NOT NULL DEFAULT 0');
  await ensureColumn('compras_detalle', 'subtotal', 'REAL NOT NULL DEFAULT 0');
  await ensureColumn('compras_detalle', 'registro_detalle_id', 'INTEGER');

  // Índices útiles
  await run(`CREATE INDEX IF NOT EXISTS idx_compra_prov ON compras(proveedor_id);`);
  await run(`CREATE INDEX IF NOT EXISTS idx_compra_estado ON compras(estado);`);
}

// Construye dinámicamente el INSERT a compras_detalle según columnas existentes.
// Evita fallos si existe una antigua "precio_unitario" con NOT NULL.
async function buildDetalleInsertSpec() {
  const cols = await all(`PRAGMA table_info(compras_detalle);`);
  const hasCosto    = cols.some(c => c.name === 'costo_unitario');
  const hasPrecio   = cols.some(c => c.name === 'precio_unitario'); // legado
  const hasSubtotal = cols.some(c => c.name === 'subtotal');
  const hasRegId    = cols.some(c => c.name === 'registro_detalle_id');

  const fields = ['compra_id', 'descripcion', 'cantidad'];
  if (hasCosto)    fields.push('costo_unitario');
  if (hasSubtotal) fields.push('subtotal');
  if (hasRegId)    fields.push('registro_detalle_id');
  if (hasPrecio)   fields.push('precio_unitario'); // espejo para columna legada

  const placeholders = fields.map(() => '?').join(',');
  const sql = `INSERT INTO compras_detalle(${fields.join(',')}) VALUES (${placeholders})`;

  const values = (compra_id, item, sub) => {
    const v = [compra_id, item.descripcion || '', Number(item.cantidad || 0)];
    if (hasCosto)    v.push(Number(item.costo_unitario || 0));
    if (hasSubtotal) v.push(r2(sub));
    if (hasRegId)    v.push(item.registro_detalle_id || null);
    if (hasPrecio)   v.push(Number(item.costo_unitario || 0)); // espejo
    return v;
  };

  return { sql, values };
}

// Ejecutar migraciones al cargar el router
db.serialize(() => { ensureTablesAndColumns().catch(console.error); });

// ===== Proveedores =====
router.get('/proveedores', async (req, res) => {
  try {
    const rows = await all(`
      SELECT p.*,
             COALESCE((SELECT COUNT(*) FROM compras c WHERE c.proveedor_id=p.id AND c.estado='abierta'),0) AS facturas_abiertas,
             COALESCE((SELECT SUM(saldo) FROM compras c WHERE c.proveedor_id=p.id),0) AS saldo_total
      FROM proveedores p
      ORDER BY p.nombre ASC
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/proveedores', async (req, res) => {
  try {
    const b = req.body || {};
    const nombre = String(b.nombre || '').trim();
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });

    await run(
      `INSERT INTO proveedores(nombre, ruc, telefono, email, direccion, observaciones)
       VALUES (?,?,?,?,?,?)`,
      [nombre, b.ruc || null, b.telefono || null, b.email || null, b.direccion || null, b.observaciones || null]
    );
    const row = await get(`SELECT * FROM proveedores WHERE nombre=?`, [nombre]);
    res.json(row);
  } catch (e) {
    if (String(e.message || '').toLowerCase().includes('unique')) {
      return res.status(409).json({ error: 'Ya existe un proveedor con ese nombre' });
    }
    res.status(500).json({ error: e.message });
  }
});

// ===== Compras (listar/crear) =====
router.get('/compras', async (req, res) => {
  try {
    const { proveedor_id, estado, desde, hasta } = req.query;
    const where = [];
    const params = [];
    if (proveedor_id) { where.push('c.proveedor_id = ?'); params.push(proveedor_id); }
    if (estado) { where.push('c.estado = ?'); params.push(estado); }
    if (desde) { where.push('date(c.fecha) >= date(?)'); params.push(desde); }
    if (hasta) { where.push('date(c.fecha) <= date(?)'); params.push(hasta); }

    const rows = await all(`
      SELECT c.*, p.nombre AS proveedor
      FROM compras c
      JOIN proveedores p ON p.id=c.proveedor_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY c.fecha DESC, c.id DESC
    `, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/compras', async (req, res) => {
  // body: { proveedor_id, fecha, num_factura, observaciones,
  //         detalle:[{descripcion, cantidad, costo_unitario, registro_detalle_id?}],
  //         pago_inicial?: {monto, forma_pago, observaciones} }
  try {
    const b = req.body || {};
    if (!b.proveedor_id || !b.fecha || !Array.isArray(b.detalle) || b.detalle.length === 0) {
      return res.status(400).json({ error: 'Datos incompletos' });
    }

    // IMMEDIATE para reservar escritura desde el inicio (reduce carreras)
    await run('BEGIN IMMEDIATE');
    const tot = b.detalle.reduce((a, x) => a + (Number(x.cantidad || 0) * Number(x.costo_unitario || 0)), 0);
    const pagoIni = Number(b.pago_inicial?.monto || 0);
    const abonado = pagoIni > 0 ? pagoIni : 0;
    const saldo = r2(tot - abonado);
    const estado = saldo <= 0 ? 'pagada' : 'abierta';

    const ins = await run(`
      INSERT INTO compras(proveedor_id, fecha, num_factura, observaciones, total, abonado, saldo, estado)
      VALUES (?,?,?,?,?,?,?,?)`,
      [b.proveedor_id, b.fecha, b.num_factura || null, b.observaciones || null, r2(tot), r2(abonado), r2(saldo), estado]
    );
    const compra_id = ins.lastID;

    const spec = await buildDetalleInsertSpec();
    const stmt = await new Promise((ok, ko) => {
      const s = db.prepare(spec.sql, e => e ? ko(e) : ok(s));
    });

    try {
      for (const it of b.detalle) {
        const sub = Number(it.cantidad || 0) * Number(it.costo_unitario || 0);
        await new Promise((ok, ko) =>
          stmt.run(spec.values(compra_id, it, sub), e => e ? ko(e) : ok())
        );
      }
    } finally {
      await new Promise((ok, ko) => stmt.finalize(e => e ? ko(e) : ok()));
    }

    if (pagoIni > 0) {
      await run(`
        INSERT INTO compras_pagos(compra_id, fecha, monto, forma_pago, observaciones)
        VALUES (?,?,?,?,?)`,
        [compra_id, b.fecha, r2(pagoIni), (b.pago_inicial.forma_pago || 'Pagado (Efectivo)'), b.pago_inicial.observaciones || null]
      );
    }

    await run('COMMIT');
    const row = await get(
      `SELECT c.*, p.nombre AS proveedor
       FROM compras c JOIN proveedores p ON p.id=c.proveedor_id
       WHERE c.id=?`,
      [compra_id]
    );
    res.json(row);
  } catch (e) {
    try { await run('ROLLBACK'); } catch (_) { }
    res.status(500).json({ error: e.message });
  }
});

// ===== Pagos a una compra =====
router.post('/compras/:id/pagos', async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    const b = req.body || {};
    if (!id || !b.fecha || !Number(b.monto)) return res.status(400).json({ error: 'Datos inválidos' });

    await run('BEGIN IMMEDIATE');
    await run(
      `INSERT INTO compras_pagos(compra_id, fecha, monto, forma_pago, observaciones) VALUES (?,?,?,?,?)`,
      [id, b.fecha, r2(b.monto), b.forma_pago || 'Pagado (Efectivo)', b.observaciones || null]
    );

    const tot = await get(`SELECT total, abonado FROM compras WHERE id=?`, [id]);
    const abonadoNuevo = r2(Number(tot?.abonado || 0) + r2(b.monto));
    const saldoNuevo = r2(Number(tot?.total || 0) - abonadoNuevo);
    const estado = saldoNuevo <= 0 ? 'pagada' : 'abierta';
    await run(`UPDATE compras SET abonado=?, saldo=?, estado=? WHERE id=?`, [abonadoNuevo, saldoNuevo, estado, id]);

    await run('COMMIT');
    res.json({ ok: true, abonado: abonadoNuevo, saldo: saldoNuevo, estado });
  } catch (e) {
    try { await run('ROLLBACK'); } catch (_) { }
    res.status(500).json({ error: e.message });
  }
});

// ===== Buscar VENTAS en Registro Diario (para cruzar) =====
router.get('/ventas', async (req, res) => {
  try {
    const { desde, hasta, desc } = req.query;
    if (!desde || !hasta) return res.status(400).json({ error: 'Rango de fechas requerido' });

    const params = [desde, hasta];
    let extra = '';
    if (desc && String(desc).trim()) {
      extra = ` AND LOWER(d.descripcion) LIKE LOWER(?) `;
      params.push(`%${String(desc).trim()}%`);
    }

    const rows = await all(`
      SELECT d.id AS registro_detalle_id, c.fecha, d.descripcion, d.cantidad,
             d.valor AS precio_publico
      FROM registro_detalle d
      JOIN registro_cabecera c ON c.id=d.id_cabecera
      WHERE d.tipo_transaccion='Venta'
        AND date(c.fecha) BETWEEN date(?) AND date(?)
        ${extra}
      ORDER BY c.fecha ASC, d.id ASC
    `, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== Cruce: crear una compra a partir de VENTAS seleccionadas =====
router.post('/cruce', async (req, res) => {
  /*
    body: {
      proveedor_id, fecha, num_factura?, observaciones?,
      items:[ { registro_detalle_id, descripcion, cantidad, costo_unitario }... ]
    }
  */
  try {
    const b = req.body || {};
    if (!b.proveedor_id || !b.fecha || !Array.isArray(b.items) || b.items.length === 0) {
      return res.status(400).json({ error: 'Datos incompletos' });
    }

    const detalle = b.items.map(x => ({
      descripcion: x.descripcion,
      cantidad: Number(x.cantidad || 1),
      costo_unitario: Number(x.costo_unitario || 0),
      registro_detalle_id: x.registro_detalle_id || null
    }));
    const tot = detalle.reduce((a, x) => a + (Number(x.cantidad || 0) * Number(x.costo_unitario || 0)), 0);

    await run('BEGIN IMMEDIATE');
    const ins = await run(`
      INSERT INTO compras(proveedor_id, fecha, num_factura, observaciones, total, abonado, saldo, estado)
      VALUES (?,?,?,?,?,?,?,?)`,
      [b.proveedor_id, b.fecha, b.num_factura || null, b.observaciones || null, r2(tot), 0, r2(tot), 'abierta']
    );
    const compra_id = ins.lastID;

    const spec = await buildDetalleInsertSpec();
    const stmt = await new Promise((ok, ko) => {
      const s = db.prepare(spec.sql, e => e ? ko(e) : ok(s));
    });

    try {
      for (const it of detalle) {
        const sub = Number(it.cantidad || 0) * Number(it.costo_unitario || 0);
        await new Promise((ok, ko) =>
          stmt.run(spec.values(compra_id, it, sub), e => e ? ko(e) : ok())
        );
      }
    } finally {
      await new Promise((ok, ko) => stmt.finalize(e => e ? ko(e) : ok()));
    }

    await run('COMMIT');

    const row = await get(
      `SELECT c.*, p.nombre AS proveedor
       FROM compras c JOIN proveedores p ON p.id=c.proveedor_id
       WHERE c.id=?`, [compra_id]
    );
    res.json(row);
  } catch (e) {
    try { await run('ROLLBACK'); } catch (_) { }
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
