const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Ruta hacia la base de datos
const dbPath = path.join(__dirname, '../database/database.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // ========== USUARIOS ==========
  db.run(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario TEXT UNIQUE NOT NULL,
      nombre TEXT NOT NULL,
      rol TEXT NOT NULL DEFAULT 'operador',
      hash_password TEXT NOT NULL,
      activo INTEGER NOT NULL DEFAULT 1,
      creado_en TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `, (err) => {
    if (err) {
      console.error("❌ Error creando tabla usuarios:", err.message);
    } else {
      console.log("✔ Tabla usuarios lista.");
      // Semilla admin si no existe
      db.get(`SELECT COUNT(*) AS c FROM usuarios WHERE usuario = ?`, ['admin'], (e, row) => {
        if (e) return console.error('❌ Error verificando admin:', e.message);
        if (row && row.c === 0) {
          // ⚠️ Reemplaza ESTE hash por el real en el Paso 6
          const hashTemporal = '$2b$10$srwOEg0iYrdMeOAVLR4mZeaCi2RG01Zv0WoCJUtk9AUDYqka3poPW';
          db.run(
            `INSERT INTO usuarios (usuario, nombre, rol, hash_password, activo) VALUES (?, ?, ?, ?, 1)`,
            ['admin', 'Administrador', 'admin', hashTemporal],
            (insErr) => insErr ? console.error('❌ Error insertando admin:', insErr.message) : console.log('✔ Usuario admin creado.')
          );
        }
      });
    }
  });

  // ========== TIPOS DE PAGO ==========
  db.run(`
    CREATE TABLE IF NOT EXISTS tipos_pago (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL
    )
  `, (err) => {
    if (err) {
      console.error("❌ Error al crear la tabla tipos_pago:", err.message);
      return;
    }

    db.get('SELECT COUNT(*) as total FROM tipos_pago', (err2, row) => {
      if (err2) {
        console.error("❌ Error al consultar la tabla tipos_pago:", err2.message);
        return;
      }

      if (row.total === 0) {
        const tipos = ['Pendiente', 'Pagado (Efectivo)', 'Pagado (Transferencia)', 'Tarjeta', 'Yape', 'Plin'];
        const stmt = db.prepare('INSERT INTO tipos_pago (nombre) VALUES (?)');
        tipos.forEach(tipo => stmt.run(tipo));
        stmt.finalize(() => {
          console.log("✔ Tipos de pago insertados.");
          crearTablasAdicionales();
        });
      } else {
        console.log("✔ Tipos de pago ya existen.");
        crearTablasAdicionales();
      }
    });
  });
});

function crearTablasAdicionales() {
  db.run(`
    CREATE TABLE IF NOT EXISTS registro_cabecera (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha TEXT NOT NULL,
      cliente TEXT NOT NULL,
      dia INTEGER,
      mes INTEGER,
      quincena INTEGER
    )
  `, (err) => {
    if (err) console.error("❌ Error al crear tabla registro_cabecera:", err.message);
    else console.log("✔ Tabla registro_cabecera creada.");
  });

  db.run(`
    CREATE TABLE IF NOT EXISTS registro_detalle (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      id_cabecera INTEGER,
      cantidad INTEGER,
      descripcion TEXT,
      tipo_transaccion TEXT,
      valor REAL,
      mecanico_id INTEGER,
      comision REAL,
      tipo_pago TEXT,
      FOREIGN KEY (id_cabecera) REFERENCES registro_cabecera(id)
    )
  `, (err) => {
    if (err) console.error("❌ Error al crear tabla registro_detalle:", err.message);
    else console.log("✔ Tabla registro_detalle creada.");

    db.run(`
      CREATE TABLE IF NOT EXISTS apertura_caja (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fecha TEXT NOT NULL,
        monto REAL NOT NULL
      )
    `, (err2) => {
      if (err2) console.error("❌ Error al crear tabla apertura_caja:", err2.message);
      else console.log("✔ Tabla apertura_caja creada.");
    });

    db.run(`
      CREATE TABLE IF NOT EXISTS cierre_caja (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fecha TEXT NOT NULL,
        apertura REAL NOT NULL,
        ingresos_efectivo REAL,
        ingresos_transferencia REAL,
        egresos REAL,
        descuadre REAL,
        total_efectivo REAL,
        total_banco REAL,
        total_cierre REAL
      )
    `, (err3) => {
      if (err3) console.error("❌ Error al crear tabla cierre_caja:", err3.message);
      else console.log("✔ Tabla cierre_caja creada.");

      // ✅ Tablas para el módulo de COMISIONES
      db.run(`CREATE TABLE IF NOT EXISTS rubros_pago (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        tipo TEXT NOT NULL  -- 'ingreso' o 'descuento'
      );`);

      db.run(`CREATE TABLE IF NOT EXISTS comisiones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mecanico_id INTEGER NOT NULL,
        fecha_inicio TEXT NOT NULL,
        fecha_fin TEXT NOT NULL,
        total_comision REAL DEFAULT 0,
        total_ingresos REAL DEFAULT 0,
        total_descuentos REAL DEFAULT 0,
        total_a_pagar REAL DEFAULT 0,
        estado TEXT DEFAULT 'pendiente',
        numero TEXT, -- opcional
        FOREIGN KEY (mecanico_id) REFERENCES mecanicos(id)
      );`);

      db.run(`CREATE TABLE IF NOT EXISTS detalle_comisiones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        comision_id INTEGER NOT NULL,
        rubro_id INTEGER NOT NULL,
        descripcion TEXT,
        valor REAL NOT NULL,
        tipo TEXT NOT NULL,  -- 'ingreso' o 'descuento'
        FOREIGN KEY (comision_id) REFERENCES comisiones(id),
        FOREIGN KEY (rubro_id) REFERENCES rubros_pago(id)
      );`);

      // ===== CxC (Cuentas por Cobrar) =====
      db.run(`CREATE TABLE IF NOT EXISTS cxc (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cliente TEXT NOT NULL,
        fecha TEXT NOT NULL,
        concepto TEXT NOT NULL,
        monto REAL NOT NULL,
        saldo REAL NOT NULL,
        estado TEXT NOT NULL DEFAULT 'Pendiente',
        origen TEXT NOT NULL DEFAULT 'manual',
        registro_cabecera_id INTEGER,
        registro_detalle_id INTEGER,
        observaciones TEXT
      );`);

      db.run(`CREATE TABLE IF NOT EXISTS cxc_abonos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cxc_id INTEGER NOT NULL,
        fecha TEXT NOT NULL,
        monto REAL NOT NULL,
        tipo_pago TEXT,
        observaciones TEXT,
        FOREIGN KEY (cxc_id) REFERENCES cxc(id)
      );`);

      // ===== PROVEEDORES / COMPRAS =====
      db.run(`CREATE TABLE IF NOT EXISTS proveedores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        ruc TEXT,
        telefono TEXT,
        email TEXT,
        direccion TEXT,
        activo INTEGER DEFAULT 1
      );`);

      db.run(`CREATE TABLE IF NOT EXISTS compras_cabecera (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        proveedor_id INTEGER,
        fecha_recepcion TEXT NOT NULL,
        condicion_pago TEXT NOT NULL,
        total REAL DEFAULT 0,
        abonado REAL DEFAULT 0,
        saldo REAL DEFAULT 0,
        estado TEXT DEFAULT 'pendiente',
        observaciones TEXT,
        numero_factura TEXT,
        FOREIGN KEY (proveedor_id) REFERENCES proveedores(id)
      );`);

      db.run(`CREATE INDEX IF NOT EXISTS idx_compras_cabecera_proveedor_id ON compras_cabecera(proveedor_id);`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_compras_cabecera_estado ON compras_cabecera(estado);`);

      db.run(`CREATE TABLE IF NOT EXISTS compras_detalle (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        compra_id INTEGER NOT NULL,
        descripcion TEXT NOT NULL,
        cantidad INTEGER DEFAULT 1,
        precio_unitario REAL NOT NULL,
        subtotal REAL NOT NULL,
        origen TEXT,
        registro_detalle_id INTEGER,
        FOREIGN KEY (compra_id) REFERENCES compras_cabecera(id)
      );`);

      db.run(`CREATE INDEX IF NOT EXISTS idx_compras_detalle_compra_id ON compras_detalle(compra_id);`);

      db.run(`CREATE TABLE IF NOT EXISTS compras_abonos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        compra_id INTEGER NOT NULL,
        fecha TEXT NOT NULL,
        monto REAL NOT NULL,
        tipo_pago TEXT,
        observaciones TEXT,
        FOREIGN KEY (compra_id) REFERENCES compras_cabecera(id)
      );`);

      // ===== ORDENES DE TRABAJO =====
      db.run(`CREATE TABLE IF NOT EXISTS ordenes_trabajo (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        proforma_id INTEGER,
        fecha_creacion TEXT NOT NULL,
        fecha_entrega_estimada TEXT,
        fecha_entrega_real TEXT,
        cliente TEXT NOT NULL,
        contacto TEXT,
        vehiculo TEXT NOT NULL,
        placa TEXT,
        modelo TEXT,
        kilometraje TEXT,
        llaves INTEGER DEFAULT 0,
        matricula INTEGER DEFAULT 0,
        cascos INTEGER DEFAULT 0,
        gasolina INTEGER DEFAULT 0,
        observaciones_recepcion TEXT,
        estado TEXT DEFAULT 'en_curso',
        total REAL DEFAULT 0,
        abonado REAL DEFAULT 0,
        saldo REAL DEFAULT 0,
        FOREIGN KEY (proforma_id) REFERENCES proformas(id)
      );`);

      db.run(`CREATE TABLE IF NOT EXISTS orden_trabajo_detalle (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        orden_id INTEGER NOT NULL,
        descripcion TEXT NOT NULL,
        tipo TEXT NOT NULL,
        cantidad INTEGER DEFAULT 1,
        precio_unitario REAL NOT NULL,
        mecanico_id INTEGER,
        comision REAL DEFAULT 0,
        estado TEXT DEFAULT 'pendiente',
        FOREIGN KEY (orden_id) REFERENCES ordenes_trabajo(id),
        FOREIGN KEY (mecanico_id) REFERENCES mecanicos(id)
      );`);

      db.run(`CREATE TABLE IF NOT EXISTS orden_trabajo_abonos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        orden_id INTEGER NOT NULL,
        fecha TEXT NOT NULL,
        monto REAL NOT NULL,
        tipo_pago TEXT,
        observaciones TEXT,
        FOREIGN KEY (orden_id) REFERENCES ordenes_trabajo(id)
      );`);

      db.run(`CREATE TABLE IF NOT EXISTS orden_trabajo_checklist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        orden_id INTEGER NOT NULL,
        item TEXT NOT NULL,
        valor TEXT NOT NULL,
        FOREIGN KEY (orden_id) REFERENCES ordenes_trabajo(id)
      );`);

      console.log('✔ Tablas adicionales listas.');
    });
  });
}

// ===== MIGRACIONES PARA COMISIONES =====
const ensureColumn = async (table, column, definition) => {
  return new Promise((resolve, reject) => {
    db.all(`PRAGMA table_info(${table});`, (err, rows) => {
      if (err) return reject(err);
      const exists = rows.some(r => r.name === column);
      if (exists) return resolve();
      db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`, (e) => {
        if (e) return reject(e);
        resolve();
      });
    });
  });
};

(async () => {
  try {
    await ensureColumn('compras_cabecera', 'numero_factura', 'TEXT');
    await ensureColumn('registro_diario', 'mecanico_id', 'INTEGER');
    await ensureColumn('registro_diario', 'comision_mo', 'REAL DEFAULT 0');
    await ensureColumn('registro_diario', 'estado_liquidacion', "TEXT DEFAULT 'pendiente'");
    console.log('Migración de columnas para registro_diario OK');
    await ensureColumn('compras_detalle', 'origen', 'TEXT');
    await ensureColumn('compras_detalle', 'registro_detalle_id', 'INTEGER');
  } catch (e) {
    console.error('Error en migración de Comisiones:', e.message);
  }
})();

