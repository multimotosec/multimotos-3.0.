const express = require('express');
const router = express.Router();
const db = require('../database');

router.get('/movimientos', (req, res) => {
  const query = `
    SELECT 
      rc.fecha,
      rc.dia AS numero_dia,
      rc.mes,
      rc.quincena,
      rc.semana,
      rd.cantidad,
      rd.descripcion,
      rd.tipo_transaccion,
      rd.valor,
      m.nombre AS mecanico_nombre,
      rd.comision,
      rd.tipo_pago,
      rc.cliente
    FROM registro_cabecera rc
    JOIN registro_detalle rd ON rc.id = rd.id_cabecera
    LEFT JOIN mecanicos m ON rd.mecanico_id = m.id
    ORDER BY rc.fecha DESC, rd.id ASC
  `;

  db.all(query, [], (err, rows) => {
    if (err) {
      console.error('❌ Error al consultar movimientos:', err.message);
      return res.status(500).json({ error: 'Error al obtener movimientos' });
    }

    const resultado = rows.map(row => {
      // rc.fecha viene como YYYY-MM-DD
      const [yyyy, mm, dd] = String(row.fecha || '').split('-');
      const fechaFormateada = (yyyy && mm && dd) ? `${dd}/${mm}/${yyyy}` : '';

      const clasif = String(row.tipo_transaccion || '').toLowerCase().trim();

      // Ingresos válidos
      const ES_INGRESO = ['ingreso', 'venta', 'mano de obra'].includes(clasif);

      // Salidas válidas (agrego las que suelen faltar en cálculos)
      const ES_SALIDA = [
        'compra',
        'proveedor',
        'gasto',
        'alimentación',
        'sueldo',
        'trabajo en curso',
        'cuenta por cobrar'
      ].includes(clasif);

      return {
        fecha: fechaFormateada,
        numero_dia: row.numero_dia?.toString().padStart(2, '0') || '',
        dia: '',                // opcional
        mes: '',                // opcional
        quincena: row.quincena === 1 ? '1 Qcna' : '2 Qcna',
        semana: row.semana ? `Sem ${row.semana}` : '',
        cantidad: row.cantidad,
        descripcion: row.descripcion,
        clasificacion: row.tipo_transaccion,
        mecanico: row.mecanico_nombre || '',
        ingreso: ES_INGRESO ? Number(row.valor || 0) : 0,
        salida:  ES_SALIDA  ? Number(row.valor || 0) : 0,
        comision: Number(row.comision || 0),
        tipo_pago: row.tipo_pago || '',     // ← NECESARIO para CxC
        cliente: row.cliente,
        observacion: ''
      };
    });

    res.json(resultado);
  });
});

module.exports = router;
