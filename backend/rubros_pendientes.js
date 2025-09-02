// backend/migrate_rubros_pendientes.js
// Ejecuta: node backend/migrate_rubros_pendientes.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const db = new sqlite3.Database(path.resolve(__dirname, '../database/database.db'));

db.serialize(() => {
  db.run(`
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
  `, (err) => {
    if (err) { console.error('❌ Error:', err.message); process.exit(1); }
    console.log('✅ Tabla rubros_pendientes lista.');
    db.close();
  });
});
