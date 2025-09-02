// backend/index.js
const express = require('express');
const path = require('path');
const app = express();

// DB y migraciones
require('./database');
require('./initDB');

// Middleware
app.use(express.json());

// Servir la carpeta de la interfaz (ajusta si tu carpeta se llama distinto)
app.use(express.static(path.join(__dirname, '../interfaz')));

// --- Rutas que SÍ existen en tu repo ---
try {
  const registroRoutes = require('./routes/registro');
  app.use('/api/registro', registroRoutes);
} catch (e) {
  console.warn('Ruta /api/registro no cargada:', e.message);
}

try {
  const tiposPagoRoutes = require('./routes/tipos_pago');
  app.use('/api/tipos_pago', tiposPagoRoutes);
} catch (e) {
  console.warn('Ruta /api/tipos_pago no cargada:', e.message);
}

try {
  const tiposTransaccionRoutes = require('./routes/tipos_transaccion');
  app.use('/api/tipos_transaccion', tiposTransaccionRoutes);
} catch (e) {
  console.warn('Ruta /api/tipos_transaccion no cargada:', e.message);
}

// Healthcheck (para verificar que el servidor está vivo)
app.get('/health', (_req, res) => {
  res.json({ ok: true, msg: 'Multimotos 3.0 up' });
});

// Página principal
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '../interfaz/index.html'));
});

// Puerto para Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});



