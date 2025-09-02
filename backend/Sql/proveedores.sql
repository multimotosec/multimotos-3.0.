
-- === PROVEEDORES: MIGRACIÓN INICIAL ===
-- Crea tablas si no existen. Ejecuta esto una sola vez contra database.db

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS proveedores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  ruc TEXT,
  telefono TEXT,
  email TEXT,
  direccion TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Cabecera de compra (factura o compra sin proveedor asignado todavía)
CREATE TABLE IF NOT EXISTS compras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proveedor_id INTEGER NULL,
  fecha_recepcion TEXT NOT NULL,
  condicion_pago TEXT CHECK(condicion_pago IN ('contado','credito')) NOT NULL DEFAULT 'credito',
  total REAL NOT NULL DEFAULT 0,
  estado TEXT CHECK(estado IN ('pendiente','parcial','cancelada')) NOT NULL DEFAULT 'pendiente',
  observaciones TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (proveedor_id) REFERENCES proveedores(id) ON DELETE SET NULL
);

-- Detalle de compra (ítems)
CREATE TABLE IF NOT EXISTS compras_detalle (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  compra_id INTEGER NOT NULL,
  descripcion TEXT NOT NULL,
  cantidad REAL NOT NULL DEFAULT 1,
  precio_unitario REAL NOT NULL DEFAULT 0,
  subtotal AS (cantidad * precio_unitario) STORED,
  registro_detalle_id INTEGER NULL, -- para "Cruce de Ventas" (traza)
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (compra_id) REFERENCES compras(id) ON DELETE CASCADE
);

-- Pagos (abonos) a una compra específica
CREATE TABLE IF NOT EXISTS compras_pagos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  compra_id INTEGER NOT NULL,
  fecha_pago TEXT NOT NULL,
  monto REAL NOT NULL,
  metodo_pago TEXT,            -- efectivo, transferencia, etc.
  observaciones TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (compra_id) REFERENCES compras(id) ON DELETE CASCADE
);

-- Liquidaciones: aplicar un pago a varias facturas del mismo proveedor
CREATE TABLE IF NOT EXISTS liquidaciones_proveedor (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proveedor_id INTEGER NOT NULL,
  fecha TEXT NOT NULL,
  total REAL NOT NULL,
  metodo_pago TEXT,
  observaciones TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (proveedor_id) REFERENCES proveedores(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS liquidaciones_detalle (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  liquidacion_id INTEGER NOT NULL,
  compra_id INTEGER NOT NULL,
  monto_aplicado REAL NOT NULL,
  FOREIGN KEY (liquidacion_id) REFERENCES liquidaciones_proveedor(id) ON DELETE CASCADE,
  FOREIGN KEY (compra_id) REFERENCES compras(id) ON DELETE CASCADE
);

-- Vistas de apoyo
CREATE VIEW IF NOT EXISTS vw_compras_con_saldo AS
SELECT
  c.id AS compra_id,
  c.proveedor_id,
  c.fecha_recepcion,
  c.condicion_pago,
  c.total,
  c.estado,
  IFNULL(SUM(p.monto), 0) AS total_pagado,
  (c.total - IFNULL(SUM(p.monto), 0)) AS saldo
FROM compras c
LEFT JOIN compras_pagos p ON p.compra_id = c.id
GROUP BY c.id;

