const express = require("express");
const router = express.Router();
const ExcelJS = require("exceljs");
const db = require("../database");

router.get("/api/exportar_excel", async (req, res) => {
  try {
    const { fecha } = req.query;

    const query = `
      SELECT 
        rd.fecha,
        rd.descripcion,
        rd.tipo_transaccion AS clasificacion,
        m.nombre AS mecanico,
        rd.valor AS monto,
        rd.tipo_pago AS metodo_pago,
        rd.comision AS comision
      FROM registro_diario rd
      LEFT JOIN mecanicos m ON rd.mecanico_id = m.id
      WHERE rd.fecha = ?
    `;

    db.all(query, [fecha], async (err, rows) => {
      if (err) {
        console.error("Error en consulta SQL:", err);
        return res.status(500).json({ error: err.message });
      }

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Caja");

      worksheet.columns = [
        { header: "Fecha", key: "fecha", width: 15 },
        { header: "Descripción", key: "descripcion", width: 30 },
        { header: "Clasificación", key: "clasificacion", width: 20 },
        { header: "Mecánico", key: "mecanico", width: 20 },
        { header: "Monto", key: "monto", width: 15 },
        { header: "Método de Pago", key: "metodo_pago", width: 20 },
        { header: "Comisión", key: "comision", width: 15 }
      ];

      rows.forEach(row => {
        worksheet.addRow(row);
      });

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", "attachment; filename=caja.xlsx");

      await workbook.xlsx.write(res);
      res.end();
    });
  } catch (error) {
    console.error("❌ Error al generar Excel:", error);
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

module.exports = router;
