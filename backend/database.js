// backend/database.js
const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

/**
 * DATA_DIR:
 * - En producción (Render), configuraremos una variable DATA_DIR que apunte al disco persistente (ej: /var/data).
 * - En tu PC, usará ../database como antes, para que todo siga funcionando localmente.
 */
const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, "../database");

// Crea el directorio si no existe (necesario en el servidor)
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Ruta final del archivo SQLite
const dbPath = path.join(DATA_DIR, "database.db");

// Conexión con SQLite
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("Error abriendo la base de datos:", err.message);
  } else {
    console.log("Base de datos lista en:", dbPath);
  }
});

// --- Creación de tablas si no existen ---
db.serialize(() => {
  // Tabla registro_diario
  db.run(`CREATE TABLE IF NOT EXISTS registro_diario (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha TEXT NOT NULL,
    concepto TEXT,
    tipo_pago TEXT,
    monto REAL
  )`);

  // Tabla caja
  db.run(`CREATE TABLE IF NOT EXISTS caja (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha TEXT,
    monto_apertura REAL,
    hora_apertura TEXT,
    hora_cierre TEXT,
    ingresos_efectivo REAL DEFAULT 0,
    ingresos_banco REAL DEFAULT 0,
    egresos REAL DEFAULT 0,
    total_calculado REAL DEFAULT 0,
    monto_real REAL DEFAULT 0,
    descuadre REAL DEFAULT 0,
    observacion_cierre TEXT
  )`);
});

module.exports = db;
