const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const router = express.Router();

// Ruta a la base de datos
const dbPath = path.join(__dirname, '../database/database.db');
const db = new sqlite3.Database(dbPath);

// === RUTA PARA GUARDAR REGISTRO COMPLETO (cabecera + detalle) ===
router.post('/api/guardar_registro', (req, res) => {
  const { fecha, cliente, dia, mes, quincena, detalles } = req.body;

  db.serialize(() => {
    db.run('BEGIN TRANSACTION');

    db.run(
      `INSERT INTO registro_cabecera (fecha, cliente, dia, mes, quincena)
       VALUES (?, ?, ?, ?, ?)`,
      [fecha, cliente, dia, mes, quincena],
      function (err) {
        if (err) {
          db.run('ROLLBACK');
          console.error('❌ Error insertando cabecera:', err.message);
          return res.status(500).json({ error: 'Error insertando cabecera' });
        }

        const cabeceraId = this.lastID;

        const stmt = db.prepare(`
          INSERT INTO registro_detalle (
            id_cabecera, cantidad, descripcion, tipo_transaccion, valor,
            mecanico_id, comision, tipo_pago
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const det of detalles) {
          stmt.run([
            cabeceraId,
            det.cantidad,
            det.descripcion,
            det.tipo_transaccion,
            det.valor,
            det.mecanico_id || null,
            det.comision || 0,
            det.tipo_pago
          ]);
        }

        stmt.finalize((err) => {
          if (err) {
            db.run('ROLLBACK');
            console.error('❌ Error insertando detalles:', err.message);
            return res.status(500).json({ error: 'Error insertando detalles' });
          }

          db.run('COMMIT');
          console.log('✔ Registro guardado con éxito');
          res.status(200).json({ mensaje: 'Registro guardado con éxito' });
        });
      }
    );
  });
});

// === RUTA PARA REPORTE DE MOVIMIENTOS DIARIOS ===
router.get('/api/reportes/movimientos', (req, res) => {
  const sql = `
    SELECT 
      c.fecha,
      c.dia AS numero_dia,
      strftime('%w', c.fecha) AS numero_dia_semana,
      substr('DoLuMaMiJuViSa', (strftime('%w', c.fecha) * 2) + 1, 2) AS dia,
      c.mes,
      CASE c.mes
        WHEN 1 THEN 'ene' WHEN 2 THEN 'feb' WHEN 3 THEN 'mar' WHEN 4 THEN 'abr'
        WHEN 5 THEN 'may' WHEN 6 THEN 'jun' WHEN 7 THEN 'jul' WHEN 8 THEN 'ago'
        WHEN 9 THEN 'sep' WHEN 10 THEN 'oct' WHEN 11 THEN 'nov' WHEN 12 THEN 'dic'
      END AS nombre_mes,
      c.quincena,
      strftime('%W', c.fecha) AS semana,
      d.cantidad,
      d.descripcion,
      d.tipo_transaccion AS clasificacion,
      m.nombre AS mecanico,
      CASE 
        WHEN d.tipo_transaccion IN ('Ingreso', 'Venta', 'Mano de Obra') THEN d.valor
        ELSE NULL
      END AS ingreso,
      d.comision AS com_tecnico,
      CASE 
        WHEN d.tipo_transaccion IN ('Compra', 'Gasto', 'Proveedor', 'Sueldo', 'Trabajo en Curso', 'Cuenta por cobrar', 'Alimentación') 
        THEN d.valor
        ELSE NULL
      END AS salida,
      c.cliente,
      '' AS observacion
    FROM registro_cabecera c
    JOIN registro_detalle d ON c.id = d.id_cabecera
    LEFT JOIN mecanicos m ON d.mecanico_id = m.id
    ORDER BY c.fecha DESC
  `;

  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error('❌ Error al obtener reporte de movimientos:', err.message);
      return res.status(500).json({ error: 'Error al obtener reporte' });
    }
    res.json(rows);
  });
});

// ======== COMISIONES (CALCULO / GUARDAR / HISTORIAL / LIQUIDAR) ========
/*
  Supuestos de datos existentes:
  - registro_cabecera(id, fecha TEXT)
  - registro_detalle(id, id_cabecera, tipo_transaccion TEXT, valor REAL, mecanico_id INTEGER, comision REAL, tipo_pago TEXT)
  - mecanicos(id, nombre, porcentaje_comision, activo)
  - comisiones(id, mecanico_id, fecha_inicio, fecha_fin, total_comision, total_ingresos, total_descuentos, total_a_pagar, estado)
  - rubros_pago(id, nombre, tipo)  // tipo: 'ingreso' | 'descuento'
  - detalle_comisiones(id, comision_id, rubro_id, descripcion, valor, tipo)

  Este bloque implementa:
  - POST /api/comisiones/calcular
  - POST /api/comisiones/guardar
  - GET  /api/comisiones/historial
  - POST /api/comisiones/generar_liquidacion
*/

// Utilidad: asegurar rubros base
function ensureRubrosBase(cb) {
  const rubros = [
    { nombre: 'Comisión Mano de Obra', tipo: 'ingreso' },
    { nombre: 'Sueldo', tipo: 'ingreso' },
    { nombre: 'Alimentación', tipo: 'ingreso' },
    { nombre: 'Bonificación', tipo: 'ingreso' },
    { nombre: 'Crédito', tipo: 'descuento' },
    { nombre: 'Anticipo de comisiones', tipo: 'descuento' },
    { nombre: 'Otros (ingreso)', tipo: 'ingreso' },
    { nombre: 'Otros (descuento)', tipo: 'descuento' },
  ];
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS rubros_pago (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      tipo TEXT NOT NULL
    )`);
    const stmt = db.prepare(`INSERT INTO rubros_pago (nombre, tipo)
      SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM rubros_pago WHERE nombre = ? AND tipo = ?)`);
    rubros.forEach(r => stmt.run(r.nombre, r.tipo, r.nombre, r.tipo));
    stmt.finalize(cb);
  });
}

// Utilidad: obtener rubro_id por nombre y tipo
function getRubroId(nombre, tipo) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT id FROM rubros_pago WHERE nombre = ? AND tipo = ?`, [nombre, tipo], (err, row) => {
      if (err) return reject(err);
      if (!row) return resolve(null);
      resolve(row.id);
    });
  });
}

// POST /api/comisiones/calcular
// body: { mecanicoId, fecha_inicio, fecha_fin }
router.post('/api/comisiones/calcular', (req, res) => {
  const { mecanicoId, fecha_inicio, fecha_fin } = req.body;
  if (!mecanicoId || !fecha_inicio || !fecha_fin) {
    return res.status(400).json({ error: 'Faltan parámetros' });
  }

  // 1) porcentaje del mecánico
  db.get(`SELECT porcentaje_comision, nombre FROM mecanicos WHERE id = ? AND activo = 1`, [mecanicoId], (err, mec) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!mec) return res.status(404).json({ error: 'Mecánico no encontrado o inactivo' });

    // 2) sumar mano de obra del período
    const sql = `
      SELECT SUM(d.valor) AS total_mo
      FROM registro_detalle d
      JOIN registro_cabecera c ON c.id = d.id_cabecera
      WHERE d.mecanico_id = ?
        AND d.tipo_transaccion = 'Mano de Obra'
        AND date(c.fecha) BETWEEN date(?) AND date(?)
    `;
    db.get(sql, [mecanicoId, fecha_inicio, fecha_fin], (err2, row) => {
      if (err2) return res.status(500).json({ error: err2.message });

      const total_mo = row?.total_mo ? Number(row.total_mo) : 0;
      const porcentaje = Number(mec.porcentaje_comision || 0);
      const comision = Number((total_mo * (porcentaje / 100)).toFixed(2));

      res.json({
        mecanico: mec.nombre,
        porcentaje,
        total_mo,
        comision
      });
    });
  });
});

// POST /api/comisiones/guardar
/*
  body esperado:
  {
    mecanicoId, fecha_inicio, fecha_fin,
    comision_mo: number, // opcional si quieres guardar ya la comisión calculada como detalle
    ingresos: [{ rubroNombre, descripcion, valor }...],     // tipo ingreso
    descuentos: [{ rubroNombre, descripcion, valor }...]    // tipo descuento
  }
  Comportamiento:
  - upsert de cabecera comisiones en estado 'pendiente'
  - inserta detalle_comisiones para cada ingreso/descuento y, si viene, para la comisión de MO
*/
router.post('/api/comisiones/guardar', (req, res) => {
  const { mecanicoId, fecha_inicio, fecha_fin, comision_mo, ingresos = [], descuentos = [] } = req.body;
  if (!mecanicoId || !fecha_inicio || !fecha_fin) {
    return res.status(400).json({ error: 'Faltan parámetros' });
  }

  ensureRubrosBase(async () => {
    try {
      // 1) upsert cabecera pendiente
      const cabeceraSql = `
        INSERT INTO comisiones (mecanico_id, fecha_inicio, fecha_fin, estado)
        VALUES (?, ?, ?, 'pendiente')
        ON CONFLICT(id) DO NOTHING
      `;
      // NOTA: SQLite no soporta ON CONFLICT sin UNIQUE. Si no tienes UNIQUE por mec+periodo, creamos/obtenemos manualmente:
      db.get(`
        SELECT id FROM comisiones
        WHERE mecanico_id = ? AND fecha_inicio = ? AND fecha_fin = ? AND estado = 'pendiente'
      `, [mecanicoId, fecha_inicio, fecha_fin], async (err, cRow) => {
        if (err) return res.status(500).json({ error: err.message });

        const createCabecera = () => new Promise((resolve, reject) => {
          db.run(`
            INSERT INTO comisiones (mecanico_id, fecha_inicio, fecha_fin, estado)
            VALUES (?, ?, ?, 'pendiente')
          `, [mecanicoId, fecha_inicio, fecha_fin], function (err2) {
            if (err2) return reject(err2);
            resolve(this.lastID);
          });
        });

        const comision_id = cRow ? cRow.id : await createCabecera();

        // 2) insertar detalles
        async function insertDetalle({ rubroNombre, descripcion, valor, tipo }) {
          const rubro_id = await getRubroId(rubroNombre, tipo);
          return new Promise((resolve, reject) => {
            db.run(`
              INSERT INTO detalle_comisiones (comision_id, rubro_id, descripcion, valor, tipo)
              VALUES (?, ?, ?, ?, ?)
            `, [comision_id, rubro_id, descripcion || rubroNombre, Number(valor || 0), tipo], function (err3) {
              if (err3) return reject(err3);
              resolve(this.lastID);
            });
          });
        }

        // comisión MO (si viene)
        if (typeof comision_mo === 'number' && comision_mo > 0) {
          await insertDetalle({ rubroNombre: 'Comisión Mano de Obra', descripcion: 'Comisión por MO', valor: comision_mo, tipo: 'ingreso' });
        }

        // ingresos adicionales
        for (const it of ingresos) {
          await insertDetalle({ rubroNombre: it.rubroNombre || 'Otros (ingreso)', descripcion: it.descripcion, valor: it.valor, tipo: 'ingreso' });
        }

        // descuentos
        for (const it of descuentos) {
          await insertDetalle({ rubroNombre: it.rubroNombre || 'Otros (descuento)', descripcion: it.descripcion, valor: it.valor, tipo: 'descuento' });
        }

        res.json({ ok: true, comision_id });
      });
    } catch (e) {
      console.error('❌ Error en guardar comisiones:', e);
      res.status(500).json({ error: e.message });
    }
  });
});

// GET /api/comisiones/historial
router.get('/api/comisiones/historial', (req, res) => {
  const sql = `
    SELECT c.id, m.nombre AS mecanico, c.fecha_inicio, c.fecha_fin, c.estado,
           ROUND(c.total_comision,2) AS total_comision,
           ROUND(c.total_ingresos,2) AS total_ingresos,
           ROUND(c.total_descuentos,2) AS total_descuentos,
           ROUND(c.total_a_pagar,2) AS total_a_pagar
    FROM comisiones c
    JOIN mecanicos m ON m.id = c.mecanico_id
    ORDER BY c.id DESC
  `;
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

// POST /api/comisiones/generar_liquidacion
/*
  body: { mecanicoId, fecha_inicio, fecha_fin }
  - Recalcula totales desde detalle_comisiones (pendiente)
  - Actualiza c.total_* y cambia estado a 'liquidado'
  - Devuelve un “número” (simple: LQ-YYYYMMDD-id)
*/
router.post('/api/comisiones/generar_liquidacion', (req, res) => {
  const { mecanicoId, fecha_inicio, fecha_fin } = req.body;
  if (!mecanicoId || !fecha_inicio || !fecha_fin) {
    return res.status(400).json({ error: 'Faltan parámetros' });
  }

  db.get(`
    SELECT id FROM comisiones
    WHERE mecanico_id = ? AND fecha_inicio = ? AND fecha_fin = ? AND estado = 'pendiente'
  `, [mecanicoId, fecha_inicio, fecha_fin], (err, cab) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!cab) return res.status(404).json({ error: 'No hay comisiones pendientes para ese período' });

    const id = cab.id;

    db.get(`
      SELECT
        ROUND(COALESCE(SUM(CASE WHEN tipo='ingreso' THEN valor END),0),2) AS ingresos,
        ROUND(COALESCE(SUM(CASE WHEN tipo='descuento' THEN valor END),0),2) AS descuentos
      FROM detalle_comisiones
      WHERE comision_id = ?
    `, [id], (err2, tot) => {
      if (err2) return res.status(500).json({ error: err2.message });

      const total_ingresos = Number(tot.ingresos || 0);
      const total_descuentos = Number(tot.descuentos || 0);
      const total_a_pagar = Number((total_ingresos - total_descuentos).toFixed(2));

      // Por compatibilidad: guardamos total_comision incluido dentro de ingresos si existe rubro 'Comisión Mano de Obra'
      db.get(`
        SELECT ROUND(COALESCE(SUM(valor),0),2) AS total_comision
        FROM detalle_comisiones dc
        JOIN rubros_pago r ON r.id = dc.rubro_id
        WHERE dc.comision_id = ? AND r.nombre = 'Comisión Mano de Obra' AND r.tipo = 'ingreso'
      `, [id], (err3, rcom) => {
        if (err3) return res.status(500).json({ error: err3.message });
        const total_comision = Number(rcom?.total_comision || 0);

        db.run(`
          UPDATE comisiones
          SET total_comision = ?, total_ingresos = ?, total_descuentos = ?, total_a_pagar = ?, estado = 'liquidado'
          WHERE id = ?
        `, [total_comision, total_ingresos, total_descuentos, total_a_pagar, id], function (err4) {
          if (err4) return res.status(500).json({ error: err4.message });

          const hoy = new Date();
          const numero = `LQ-${hoy.getFullYear()}${String(hoy.getMonth()+1).padStart(2,'0')}${String(hoy.getDate()).padStart(2,'0')}-${id}`;
          // No tenemos campo 'numero' en tu tabla comisiones original; si lo quieres persistir, añade la columna.
          return res.json({
            ok: true,
            numero,
            mecanicoId,
            fecha_inicio,
            fecha_fin,
            total_comision,
            total_ingresos,
            total_descuentos,
            total_a_pagar
          });
        });
      });
    });
  });
});


// ======== COMISIONES (CALCULO / GUARDAR / HISTORIAL / LIQUIDAR) ========
function ensureRubrosBase(cb) {
  const rubros = [
    { nombre: 'Comisión Mano de Obra', tipo: 'ingreso' },
    { nombre: 'Sueldo', tipo: 'ingreso' },
    { nombre: 'Alimentación', tipo: 'ingreso' },
    { nombre: 'Bonificación', tipo: 'ingreso' },
    { nombre: 'Crédito', tipo: 'descuento' },
    { nombre: 'Anticipo de comisiones', tipo: 'descuento' },
    { nombre: 'Otros (ingreso)', tipo: 'ingreso' },
    { nombre: 'Otros (descuento)', tipo: 'descuento' },
  ];
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS rubros_pago (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      tipo TEXT NOT NULL
    )`);
    const stmt = db.prepare(`INSERT INTO rubros_pago (nombre, tipo)
      SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM rubros_pago WHERE nombre = ? AND tipo = ?)`);
    rubros.forEach(r => stmt.run(r.nombre, r.tipo, r.nombre, r.tipo));
    stmt.finalize(cb);
  });
}

function getRubroId(nombre, tipo) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT id FROM rubros_pago WHERE nombre = ? AND tipo = ?`, [nombre, tipo], (err, row) => {
      if (err) return reject(err);
      resolve(row ? row.id : null);
    });
  });
}

// A) CALCULAR (no tocar si ya te funciona; lo dejo igual)
router.post('/api/comisiones/calcular', (req, res) => {
  const { mecanicoId, fecha_inicio, fecha_fin } = req.body;
  if (!mecanicoId || !fecha_inicio || !fecha_fin) {
    return res.status(400).json({ error: 'Faltan parámetros' });
  }

  db.get(`SELECT porcentaje_comision, nombre FROM mecanicos WHERE id = ? AND activo = 1`, [mecanicoId], (err, mec) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!mec) return res.status(404).json({ error: 'Mecánico no encontrado o inactivo' });

    const sql = `
      SELECT SUM(d.valor) AS total_mo
      FROM registro_detalle d
      JOIN registro_cabecera c ON c.id = d.id_cabecera
      WHERE d.mecanico_id = ?
        AND d.tipo_transaccion = 'Mano de Obra'
        AND date(c.fecha) BETWEEN date(?) AND date(?)
    `;
    db.get(sql, [mecanicoId, fecha_inicio, fecha_fin], (err2, row) => {
      if (err2) return res.status(500).json({ error: err2.message });

      const total_mo = row?.total_mo ? Number(row.total_mo) : 0;
      const porcentaje = Number(mec.porcentaje_comision || 0);
      const comision = Number((total_mo * (porcentaje / 100)).toFixed(2));

      res.json({ mecanico: mec.nombre, porcentaje, total_mo, comision });
    });
  });
});

// B) GUARDAR (acepta 'comision' o 'comision_mo' del frontend)
router.post('/api/comisiones/guardar', (req, res) => {
  let { mecanicoId, fecha_inicio, fecha_fin, comision, comision_mo, ingresos = [], descuentos = [], total_ingresos, total_descuentos, total_a_pagar } = req.body;
  if (!mecanicoId || !fecha_inicio || !fecha_fin) {
    return res.status(400).json({ error: 'Faltan parámetros' });
  }
  const comisionValor = Number(comision_mo ?? comision ?? 0);

  ensureRubrosBase(async () => {
    try {
      // ¿Existe cabecera pendiente para ese mecánico y período?
      db.get(`
        SELECT id FROM comisiones
        WHERE mecanico_id = ? AND fecha_inicio = ? AND fecha_fin = ? AND estado = 'pendiente'
      `, [mecanicoId, fecha_inicio, fecha_fin], async (err, cRow) => {
        if (err) return res.status(500).json({ error: err.message });

        const crearCabecera = () => new Promise((resolve, reject) => {
          db.run(`
            INSERT INTO comisiones (mecanico_id, fecha_inicio, fecha_fin, estado)
            VALUES (?, ?, ?, 'pendiente')
          `, [mecanicoId, fecha_inicio, fecha_fin], function (e2) {
            if (e2) return reject(e2);
            resolve(this.lastID);
          });
        });

        const comision_id = cRow ? cRow.id : await crearCabecera();

        async function insertDetalle({ rubroNombre, descripcion, valor, tipo }) {
          const rubro_id = await getRubroId(rubroNombre, tipo);
          return new Promise((resolve, reject) => {
            db.run(`
              INSERT INTO detalle_comisiones (comision_id, rubro_id, descripcion, valor, tipo)
              VALUES (?, ?, ?, ?, ?)
            `, [comision_id, rubro_id, descripcion || rubroNombre, Number(valor || 0), tipo], function (e3) {
              if (e3) return reject(e3);
              resolve(this.lastID);
            });
          });
        }

        if (comisionValor > 0) {
          await insertDetalle({ rubroNombre: 'Comisión Mano de Obra', descripcion: 'Comisión por MO', valor: comisionValor, tipo: 'ingreso' });
        }
        for (const it of ingresos) {
          await insertDetalle({ rubroNombre: it.rubroNombre || 'Otros (ingreso)', descripcion: it.descripcion, valor: it.valor, tipo: 'ingreso' });
        }
        for (const it of descuentos) {
          await insertDetalle({ rubroNombre: it.rubroNombre || 'Otros (descuento)', descripcion: it.descripcion, valor: it.valor, tipo: 'descuento' });
        }

        res.json({ ok: true, comision_id, mensaje: 'Liquidación cargada correctamente' });
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
});

// C) HISTORIAL (incluye el número si existe)
router.get('/api/comisiones/historial', (req, res) => {
  const sql = `
    SELECT c.id, c.numero, m.nombre AS mecanico, c.fecha_inicio, c.fecha_fin, c.estado,
           ROUND(c.total_comision,2) AS total_comision,
           ROUND(c.total_ingresos,2) AS total_ingresos,
           ROUND(c.total_descuentos,2) AS total_descuentos,
           ROUND(c.total_a_pagar,2) AS total_a_pagar
    FROM comisiones c
    JOIN mecanicos m ON m.id = c.mecanico_id
    ORDER BY c.id DESC
  `;
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

// D) GENERAR LIQUIDACIÓN (por IDs seleccionados) — robusto con PRAGMA para columna 'numero'
router.post('/api/comisiones/generar_liquidacion', (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'Debe enviar ids a liquidar' });
  }

  const placeholders = ids.map(() => '?').join(',');
  const sel = `
    SELECT c.id, c.mecanico_id, c.fecha_inicio, c.fecha_fin, c.estado, m.nombre AS mecanico
    FROM comisiones c
    JOIN mecanicos m ON m.id = c.mecanico_id
    WHERE c.id IN (${placeholders})
  `;
  db.all(sel, ids, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!rows || rows.length !== ids.length) return res.status(404).json({ error: 'Algunas comisiones no existen' });

    const mecSet = new Set(rows.map(r => r.mecanico_id));
    if (mecSet.size > 1) return res.status(400).json({ error: 'No se puede liquidar comisiones de distintos mecánicos' });

    const totSql = `
      SELECT
        dc.comision_id,
        ROUND(COALESCE(SUM(CASE WHEN dc.tipo='ingreso'   THEN dc.valor END),0),2) AS ingresos,
        ROUND(COALESCE(SUM(CASE WHEN dc.tipo='descuento' THEN dc.valor END),0),2) AS descuentos,
        ROUND(COALESCE(SUM(CASE WHEN r.nombre='Comisión Mano de Obra' AND dc.tipo='ingreso' THEN dc.valor END),0),2) AS total_comision
      FROM detalle_comisiones dc
      JOIN rubros_pago r ON r.id = dc.rubro_id
      WHERE dc.comision_id IN (${placeholders})
      GROUP BY dc.comision_id
    `;
    db.all(totSql, ids, (e2, dets) => {
      if (e2) return res.status(500).json({ error: e2.message });

      const totalsById = new Map(dets.map(d => [d.comision_id, {
        ingresos: Number(d.ingresos || 0),
        descuentos: Number(d.descuentos || 0),
        total_comision: Number(d.total_comision || 0)
      }]));

      const hoy = new Date();
      const numero = `LQ-${hoy.getFullYear()}${String(hoy.getMonth()+1).padStart(2,'0')}${String(hoy.getDate()).padStart(2,'0')}-${Date.now()}`;

      // Verificar/crear columna 'numero'
      db.all(`PRAGMA table_info(comisiones);`, [], (eInfo, cols) => {
        if (eInfo) return res.status(500).json({ error: eInfo.message });
        const hasNumero = (cols || []).some(c => c.name === 'numero');

        const doUpdate = () => {
          const upd = db.prepare(`
            UPDATE comisiones
            SET total_comision = ?, total_ingresos = ?, total_descuentos = ?, total_a_pagar = ?, estado = 'liquidada' ${hasNumero ? ', numero = ?' : ''}
            WHERE id = ?
          `);

          ids.forEach(id => {
            const t = totalsById.get(id) || { ingresos: 0, descuentos: 0, total_comision: 0 };
            const total_a_pagar = Number((t.ingresos - t.descuentos).toFixed(2));
            const params = hasNumero
              ? [t.total_comision, t.ingresos, t.descuentos, total_a_pagar, numero, id]
              : [t.total_comision, t.ingresos, t.descuentos, total_a_pagar, id];
            upd.run(params);
          });

          upd.finalize((eFin) => {
            if (eFin) return res.status(500).json({ error: eFin.message });
            return res.json({ ok: true, numero, mensaje: 'Liquidación generada correctamente' });
          });
        };

        if (!hasNumero) {
          db.run(`ALTER TABLE comisiones ADD COLUMN numero TEXT`, (eAlt) => {
            // Si falló por columna existente, continuamos igual
            doUpdate();
          });
        } else {
          doUpdate();
        }
      });
    });
  });
});

// E) DETALLE POR NÚMERO (para el modal)
router.get('/api/comisiones/liquidacion/:numero', (req, res) => {
  const { numero } = req.params;
  const sql = `
    SELECT c.id, c.numero, m.nombre AS mecanico, c.fecha_inicio, c.fecha_fin,
           ROUND(c.total_comision,2)  AS total_comision,
           ROUND(c.total_ingresos,2)  AS total_ingresos,
           ROUND(c.total_descuentos,2) AS total_descuentos,
           ROUND(c.total_a_pagar,2)    AS total_a_pagar
    FROM comisiones c
    JOIN mecanicos m ON m.id = c.mecanico_id
    WHERE c.numero = ?
    ORDER BY c.id
  `;
  db.all(sql, [numero], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});



// ===== COMISIONES =====
//const express = require('express');
const comisionesRouter = router;
//const db = require('./database');

// Util: generar número de liquidación incremental LIQ-0001
const nextNumeroLiquidacion = () => new Promise((resolve, reject) => {
  db.get(`SELECT numero FROM liquidaciones ORDER BY id DESC LIMIT 1`, (err, row) => {
    if (err) return reject(err);
    let next = 'LIQ-0001';
    if (row && row.numero) {
      const n = parseInt(row.numero.split('-')[1] || '0', 10) + 1;
      next = `LIQ-${String(n).padStart(4,'0')}`;
    }
    resolve(next);
  });
});

// Mecánicos activos
comisionesRouter.get('/mecanicos', (req, res) => {
  db.all(`SELECT id, nombre, porcentaje_comision FROM mecanicos WHERE activo=1 ORDER BY nombre;`,
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
});

// Cálculo de comisiones pendientes por mecánico y rango
comisionesRouter.get('/calculo', (req, res) => {
  const { mecanico_id, desde, hasta } = req.query;
  if (!mecanico_id || !desde || !hasta) {
    return res.status(400).json({ error: 'Parámetros requeridos: mecanico_id, desde, hasta' });
  }

  const sql = `
    SELECT id, fecha, descripcion, comision_mo
    FROM registro_diario
    WHERE mecanico_id = ? 
      AND fecha BETWEEN ? AND ?
      AND (estado_liquidacion IS NULL OR estado_liquidacion='pendiente')
      AND comision_mo > 0
    ORDER BY fecha ASC, id ASC;
  `;

  db.all(sql, [mecanico_id, desde, hasta], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    const total = rows.reduce((acc, r) => acc + (r.comision_mo || 0), 0);
    res.json({
      registros: rows,
      total_comisiones: total
    });
  });
});

// Crear liquidación
comisionesRouter.post('/liquidar', express.json(), async (req, res) => {
  try {
    const { mecanico_id, desde, hasta, registros, rubros } = req.body;
    if (!mecanico_id || !desde || !hasta) {
      return res.status(400).json({ error: 'mecanico_id, desde, hasta son obligatorios' });
    }
    if (!Array.isArray(registros)) {
      return res.status(400).json({ error: 'registros debe ser un array de IDs de registro_diario' });
    }

    // Recalcular comisiones de esos registros (seguridad)
    const placeholders = registros.map(() => '?').join(',');
    const sqlSel = `
      SELECT id, comision_mo
      FROM registro_diario
      WHERE id IN (${placeholders}) 
        AND mecanico_id = ?
        AND (estado_liquidacion IS NULL OR estado_liquidacion='pendiente')
    `;
    const paramsSel = [...registros, mecanico_id];

    const selRows = await new Promise((resolve, reject) => {
      db.all(sqlSel, paramsSel, (err, rows) => err ? reject(err) : resolve(rows));
    });

    const totalComisiones = selRows.reduce((acc, r) => acc + (r.comision_mo || 0), 0);

    // Rubros (+ ingresos, - descuentos)
    let totalIngresos = 0, totalDescuentos = 0;
    const rubrosSan = Array.isArray(rubros) ? rubros.map(r => ({
      tipo: r.tipo,                 // 'ingreso' | 'descuento'
      descripcion: r.descripcion || '',
      monto: parseFloat(r.monto || 0)
    })) : [];

    rubrosSan.forEach(r => {
      if (r.tipo === 'ingreso') totalIngresos += r.monto;
      else if (r.tipo === 'descuento') totalDescuentos += r.monto;
    });

    const totalNeto = totalComisiones + totalIngresos - totalDescuentos;

    // Crear cabecera de liquidación
    const numero = await nextNumeroLiquidacion();
    const insertCab = `
      INSERT INTO liquidaciones
        (numero, mecanico_id, fecha_inicio, fecha_fin, total_comisiones, total_ingresos, total_descuentos, total_neto)
      VALUES (?,?,?,?,?,?,?,?)
    `;
    const cabParams = [numero, mecanico_id, desde, hasta, totalComisiones, totalIngresos, totalDescuentos, totalNeto];

    const liquidacionId = await new Promise((resolve, reject) => {
      db.run(insertCab, cabParams, function (err) {
        if (err) return reject(err);
        resolve(this.lastID);
      });
    });

    // Detalle: comisiones liquidadas (uno por cada registro_diario)
    const insDet = `INSERT INTO liquidacion_detalle (liquidacion_id, tipo, referencia_id, descripcion, monto) VALUES (?,?,?,?,?)`;
    for (const r of selRows) {
      await new Promise((resolve, reject) => {
        db.run(insDet, [liquidacionId, 'comision', r.id, `Comisión MO registro #${r.id}`, r.comision_mo || 0],
          (err) => err ? reject(err) : resolve());
      });
    }

    // Detalle: rubros adicionales
    for (const r of rubrosSan) {
      await new Promise((resolve, reject) => {
        db.run(insDet, [liquidacionId, r.tipo, null, r.descripcion, r.monto],
          (err) => err ? reject(err) : resolve());
      });
    }


    // LISTA DE MECÁNICOS ACTIVOS PARA COMISIONES
    router.get('/api/comisiones/mecanicos', (req, res) => {
      db.all(`SELECT id, nombre, porcentaje_comision FROM mecanicos WHERE activo=1 ORDER BY nombre;`,
        (err, rows) => err ? res.status(500).json({ error: err.message }) : res.json(rows || []));
    });


    // Marcar registros como liquidados
    if (selRows.length > 0) {
      const ids = selRows.map(x => x.id);
      const ph = ids.map(() => '?').join(',');
      await new Promise((resolve, reject) => {
        db.run(`UPDATE registro_diario SET estado_liquidacion='liquidado' WHERE id IN (${ph})`, ids,
          (err) => err ? reject(err) : resolve());
      });
    }

    res.json({
      mensaje: 'Liquidación generada correctamente',
      numero,
      liquidacion_id: liquidacionId,
      totales: { totalComisiones, totalIngresos, totalDescuentos, totalNeto }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Listado histórico
comisionesRouter.get('/liquidaciones', (req, res) => {
  const sql = `
    SELECT l.id, l.numero, l.fecha_inicio, l.fecha_fin, m.nombre AS mecanico, 
           l.total_comisiones, l.total_ingresos, l.total_descuentos, l.total_neto, l.creado_en
    FROM liquidaciones l
    JOIN mecanicos m ON m.id = l.mecanico_id
    ORDER BY l.id DESC;
  `;
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Detalle por liquidación
comisionesRouter.get('/liquidaciones/:id', (req, res) => {
  const { id } = req.params;
  const infoSql = `
    SELECT l.*, m.nombre AS mecanico
    FROM liquidaciones l
    JOIN mecanicos m ON m.id = l.mecanico_id
    WHERE l.id = ?;
  `;
  const detSql = `
    SELECT id, tipo, referencia_id, descripcion, monto
    FROM liquidacion_detalle
    WHERE liquidacion_id = ?
    ORDER BY id ASC;
  `;

  db.get(infoSql, [id], (e1, cab) => {
    if (e1) return res.status(500).json({ error: e1.message });
    if (!cab) return res.status(404).json({ error: 'No existe la liquidación' });

    db.all(detSql, [id], (e2, det) => {
      if (e2) return res.status(500).json({ error: e2.message });
      res.json({ cabecera: cab, detalle: det });
    });
  });
});

//module.exports = comisionesRouter;



module.exports = router;
