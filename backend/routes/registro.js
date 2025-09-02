const express = require('express');
const router = express.Router();
const db = require('../database');

// Ruta para guardar el registro diario
router.post('/', (req, res) => {
  const { cabecera, detalle } = req.body;

  if (!cabecera || !detalle || detalle.length === 0) {
    return res.status(400).json({ error: 'Datos incompletos' });
  }

  const { fecha, cliente, dia, mes, quincena } = cabecera;

  // Calcular número de semana del mes
  //const fechaObj = new Date(fecha);
  const [año, mesNum, diaNum] = fecha.split('-').map(Number);
  const fechaObj = new Date(año, mesNum - 1, diaNum);
  const primerDiaDelMes = new Date(fechaObj.getFullYear(), fechaObj.getMonth(), 1);
  const primerLunes = new Date(primerDiaDelMes);
  while (primerLunes.getDay() !== 1 && primerLunes.getMonth() === fechaObj.getMonth()) {
    primerLunes.setDate(primerLunes.getDate() + 1);
  }
  const diffDias = Math.floor((fechaObj - primerLunes) / (1000 * 60 * 60 * 24));
  const semana = diffDias >= 0 ? Math.floor(diffDias / 7) + 1 : 1;

  if (!fecha || !cliente) {
    return res.status(400).json({ error: 'Fecha y cliente son obligatorios' });
  }

  db.serialize(() => {
    db.run(
      `INSERT INTO registro_cabecera (fecha, cliente, dia, mes, quincena, semana) VALUES (?, ?, ?, ?, ?, ?)`,
      [fecha, cliente, dia, mes, quincena, semana],
      function (err) {
        if (err) {
          console.error('❌ Error al insertar cabecera:', err.message);
          return res.status(500).json({ error: 'Error al guardar cabecera' });
        }

        const idCabecera = this.lastID;

        const stmt = db.prepare(`
          INSERT INTO registro_detalle 
            (id_cabecera, cantidad, descripcion, tipo_transaccion, valor, mecanico_id, comision, tipo_pago)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (let item of detalle) {
          stmt.run([
            idCabecera,
            item.cantidad || 0,
            item.descripcion || '',
            item.tipo_transaccion || '',
            item.valor || 0,
            item.mecanico_id || null,
            item.comision || 0,
            item.tipo_pago || ''
          ]);
        }

        stmt.finalize((err) => {
          if (err) {
            console.error('❌ Error al insertar detalle:', err.message);
            return res.status(500).json({ error: 'Error al guardar detalle' });
          }

          console.log('✔ Registro diario guardado con éxito');
          res.json({ success: true, id: idCabecera });
        });
      }
    );
  });
});

// === RUTA PARA CONSULTAR REGISTRO POR FECHA ===
router.get('/', (req, res) => {
  const fecha = req.query.fecha;

  if (!fecha) {
    return res.status(400).json({ error: 'Se requiere la fecha' });
  }

  // Primero obtener la cabecera
  db.get(
    `SELECT id, fecha, cliente, dia, mes, quincena FROM registro_cabecera WHERE fecha = ?`,
    [fecha],
    (err, cabecera) => {
      if (err) {
        console.error('❌ Error al obtener cabecera:', err.message);
        return res.status(500).json({ error: 'Error al consultar cabecera' });
      }

      if (!cabecera) {
        return res.status(404).json({ error: 'No se encontró cabecera con esa fecha' });
      }

      const idCabecera = cabecera.id;

      // Luego obtener el detalle
      db.all(
        `SELECT cantidad, descripcion, tipo_transaccion, valor, mecanico_id, comision, tipo_pago
         FROM registro_detalle WHERE id_cabecera = ?`,
        [idCabecera],
        (err, detalles) => {
          if (err) {
            console.error('❌ Error al obtener detalle:', err.message);
            return res.status(500).json({ error: 'Error al consultar detalles' });
          }

          res.json({
            cabecera,
            detalle: detalles
          });
        }
      );
    }
  );
});


// === RUTA PARA ACTUALIZAR REGISTRO EXISTENTE POR ID ===
router.put('/:id', (req, res) => {
  const idCabecera = req.params.id;
  const { fecha, cliente, dia, mes, quincena, detalles } = req.body;

  db.serialize(() => {
    db.run('BEGIN TRANSACTION');

    db.run(
      `UPDATE registro_cabecera
       SET fecha = ?, cliente = ?, dia = ?, mes = ?, quincena = ?
       WHERE id = ?`,
      [fecha, cliente, dia, mes, quincena, idCabecera],
      function (err) {
        if (err) {
          db.run('ROLLBACK');
          console.error('❌ Error actualizando cabecera:', err.message);
          return res.status(500).json({ error: 'Error actualizando cabecera' });
        }

        db.run(`DELETE FROM registro_detalle WHERE id_cabecera = ?`, [idCabecera], function (err) {
          if (err) {
            db.run('ROLLBACK');
            console.error('❌ Error borrando detalles antiguos:', err.message);
            return res.status(500).json({ error: 'Error limpiando detalles anteriores' });
          }

          const stmt = db.prepare(`
            INSERT INTO registro_detalle (
              id_cabecera, cantidad, descripcion, tipo_transaccion, valor,
              mecanico_id, comision, tipo_pago
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `);

          for (const det of detalles) {
            stmt.run([
              idCabecera,
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
              console.error('❌ Error insertando nuevos detalles:', err.message);
              return res.status(500).json({ error: 'Error actualizando detalles' });
            }

            db.run('COMMIT');
            console.log(`✔ Registro ${idCabecera} actualizado correctamente`);
            res.status(200).json({ mensaje: 'Registro actualizado correctamente' });
          });
        });
      }
    );
  });
});


function eliminarRegistro() {
  if (!confirm('¿Estás seguro de eliminar este registro?')) return;

  if (idRegistroEditando === null) {
    // Si no se ha guardado aún, solo limpia el formulario
    limpiarFormulario();
    alert('Registro nuevo eliminado (no se había guardado aún).');
    return;
  }

  fetch(`/api/registro/${idRegistroEditando}`, {
    method: 'DELETE'
  })
  .then(res => {
    if (!res.ok) throw new Error('Error al eliminar');
    return res.json();
  })
  .then(() => {
    alert('✅ Registro eliminado con éxito');
    limpiarFormulario();
    idRegistroEditando = null;
  })
  .catch(() => {
    alert('❌ No se pudo eliminar el registro');
  });
}


router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    await db.run('DELETE FROM movimientos WHERE id = ?', id);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error al eliminar registro:', error.message);
    res.status(500).json({ error: 'Error al eliminar registro' });
  }
});


module.exports = router;
