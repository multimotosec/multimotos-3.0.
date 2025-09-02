-- ===========================
-- MODULO: COMISIONES
-- Nuevas tablas
-- ===========================

-- Tabla de liquidaciones (cabecera)
CREATE TABLE IF NOT EXISTS liquidaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero TEXT NOT NULL UNIQUE,                -- Ej: LIQ-0001
  mecanico_id INTEGER NOT NULL,
  fecha_inicio TEXT NOT NULL,                 -- ISO YYYY-MM-DD
  fecha_fin TEXT NOT NULL,                    -- ISO YYYY-MM-DD
  total_comisiones REAL NOT NULL DEFAULT 0,
  total_ingresos REAL NOT NULL DEFAULT 0,     -- + ingresos extras
  total_descuentos REAL NOT NULL DEFAULT 0,   -- - descuentos/anticipos
  total_neto REAL NOT NULL DEFAULT 0,         -- total_comisiones + total_ingresos - total_descuentos
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (mecanico_id) REFERENCES mecanicos(id)
);

-- Detalle de liquidación (rubros y comisiones liquidadas)
-- tipo: 'comision' | 'ingreso' | 'descuento'
-- referencia_id: si es 'comision', guarda el id del registro_diario
CREATE TABLE IF NOT EXISTS liquidacion_detalle (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  liquidacion_id INTEGER NOT NULL,
  tipo TEXT NOT NULL,
  referencia_id INTEGER,          -- id de registro_diario cuando tipo='comision'
  descripcion TEXT NOT NULL,
  monto REAL NOT NULL,
  FOREIGN KEY (liquidacion_id) REFERENCES liquidaciones(id)
);

-- ===========================
-- AJUSTES SUGERIDOS EN registro_diario (si hiciera falta)
-- NOTA: SOLO aplicar si no existen estos campos
-- SQLite no soporta IF NOT EXISTS en ADD COLUMN, por eso se sugiere hacerlo por código (ver PASO 2).
-- Campos sugeridos:
--   mecanico_id INTEGER (cuando el movimiento es Mano de Obra)
--   comision_mo REAL (comisión ya calculada por cada MO)
--   estado_liquidacion TEXT DEFAULT 'pendiente'  -- 'pendiente' | 'liquidado'
-- ===========================
