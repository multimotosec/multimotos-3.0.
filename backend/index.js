const express = require('express');
const app = express();
const path = require('path');

// Conexión con la base de datos
const db = require('./database');

require('./initDB'); // crea/migra tablas al arrancar

// Middleware
app.use(express.json());

// Servir frontend
//app.use(express.static(path.join(__dirname, '../frontend')));
app.use(express.static(path.join(__dirname, '../interfaz')));

// === Proformas === //
const proformasRoutes = require('./routes/proformas');
app.use('/api/proformas', proformasRoutes);

// === Ordenes de Trabajo === //
const ordenesRoutes = require('./routes/ordenes_trabajo');
app.use(ordenesRoutes);

// === Proveedores === //
const proveedoresRoutes = require('./routes/proveedores');
app.use('/api/proveedores', proveedoresRoutes);

// === Metas de Mecánicos === //
const metasRoutes = require('./routes/metas');
app.use('/api/metas', metasRoutes);

// === Comisiones == //
const comisionesRoutes = require('./routes/comisiones');
app.use('/api/comisiones', comisionesRoutes);

// === Caja === //
const cajaRoutes = require('./routes/caja');
app.use('/api/caja', cajaRoutes);

// === Cuentas por Cobrar CXC === //
const cxcRoutes = require('./routes/cxc');
app.use('/api/cxc', cxcRoutes);

// === Auth & Usuarios === //
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

const usuariosRoutes = require('./routes/usuarios');
app.use('/api/usuarios', usuariosRoutes);

// === Rutas de la API ===
const mecanicosRoutes = require('./routes/mecanicos');
app.use('/api/mecanicos', mecanicosRoutes);

const transaccionRoutes = require('./routes/tipos_transaccion');
app.use('/api/tipos_transaccion', transaccionRoutes);

const tiposPagoRoutes = require('./routes/tipos_pago');
app.use('/api/tipos_pago', tiposPagoRoutes);

const registroRoutes = require('./routes/registro');
const reporteExcelRoutes = require('./routes/reporte_excel');
app.use('/api/registro', registroRoutes);
app.use('/api/reporte-excel', reporteExcelRoutes);

// Rutas nuevas de reportes (asegúrate que exista backend/routes/reporte.js)
const reporteRoutes = require('./routes/reporte');
app.use('/api/reporte', reporteRoutes); // <-- ESTA ES LA QUE DA ACCESO A MOVIMIENTOS

// Rutas antiguas agrupadas en api.js (opcional, si las usas)
const apiRoutes = require('./api');
app.use(apiRoutes);

// Página principal
app.get('/', (req, res) => {
  //res.sendFile(path.join(__dirname, '../frontend/index.html'));
  res.sendFile(path.join(__dirname, '../interfaz/index.html'));
});

// Iniciar servidor
// const PORT = 3000;
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});

