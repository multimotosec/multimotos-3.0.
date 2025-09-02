let contadorFilas = 0;
let tiposTransaccion = [];
let mecanicos = [];
let tiposPago = [];
let idRegistroEditando = null; // si es null, se guarda nuevo; si tiene valor, se actualiza


document.addEventListener('DOMContentLoaded', async () => {
  const fechaInput = document.getElementById('fecha');
  if (!fechaInput.value) {
    const hoy = new Date();
    const anio = hoy.getFullYear();
    const mes = String(hoy.getMonth() + 1).padStart(2, '0');
    const dia = String(hoy.getDate()).padStart(2, '0');
    fechaInput.value = `${anio}-${mes}-${dia}`;
  }

  calcularDatosFecha();

  const [tipos, tecs, pagos] = await Promise.all([
    fetch('/api/tipos_transaccion').then(res => res.json()),
    fetch('/api/mecanicos').then(res => res.json()),
    fetch('/api/tipos_pago').then(res => res.json())
  ]);
  tiposTransaccion = tipos;
  mecanicos = tecs;
  tiposPago = pagos;

  agregarFila();
});


function calcularDatosFecha() {
  const fecha = new Date(document.getElementById('fecha').value);
  const dia = fecha.getDate();
  const mes = fecha.getMonth() + 1;
  const quincena = dia <= 15 ? 1 : 2;

  document.getElementById('dia').value = dia;
  document.getElementById('mes').value = mes;
  document.getElementById('quincena').value = quincena;
}

function agregarFila() {
  contadorFilas++;
  const fila = document.createElement('tr');
  fila.classList.add('registro-linea');

  fila.innerHTML = `
    <td><input type="number" name="cantidad" value="1" min="1"></td>
    <td><input type="text" name="descripcion"></td>
    <td>
      <select name="transaccion" onchange="verificarTipo(this, ${contadorFilas})">
        <option value="">Selecciona tipo</option>
        ${tiposTransaccion.map(t => `<option value="${t.nombre}">${t.nombre}</option>`).join('')}
      </select>
    </td>
    <td><input type="number" name="valor" step="0.01"></td>
    <td>
      <select id="mecanico-${contadorFilas}" name="mecanico" style="display:none;">
        <option value="">Selecciona mecánico</option>
        ${mecanicos.map(m => `<option value="${m.id}" data-comision="${m.porcentaje_comision}">${m.nombre}</option>`).join('')}
      </select>
    </td>
    <td><input type="text" id="comision-${contadorFilas}" name="comision" readonly style="display:none;"></td>
    <td>
      <select name="tipo_pago">
        <option value="">Tipo de Pago</option>
        ${tiposPago.map(p => `<option value="${p.nombre}">${p.nombre}</option>`).join('')}
      </select>
    </td>
    <td><button type="button" onclick="eliminarFila(this)">➖</button></td>
  `;

  document.getElementById('detalle-movimientos').appendChild(fila);

  const nuevoInputValor = fila.querySelector('input[name="valor"]');
  nuevoInputValor.addEventListener('input', actualizarTotalParcial);

  actualizarTotalParcial();
  fila.querySelector('input[name="descripcion"]').focus();
}

function eliminarFila(boton) {
  const fila = boton.closest('tr');
  fila.remove();
  actualizarTotalParcial(); // Recalcular total si eliminamos una fila
}


function verificarTipo(select, filaId) {
  const tipo = select.value.toLowerCase();
  const fila = select.closest('tr');
  const valorInput = fila.querySelector('input[name="valor"]');
  const mecSelect = document.getElementById(`mecanico-${filaId}`);
  const comInput = document.getElementById(`comision-${filaId}`);

  if (tipo === 'mano de obra') {
    mecSelect.style.display = 'inline';
    comInput.style.display = 'inline';

    mecSelect.onchange = () => {
      const porcentaje = mecSelect.selectedOptions[0]?.getAttribute('data-comision') || 0;
      const valor = parseFloat(valorInput.value || 0);
      const comision = valor * (porcentaje / 100);
      comInput.value = comision.toFixed(2);
    };

    valorInput.oninput = () => {
      if (mecSelect.value) {
        const porcentaje = mecSelect.selectedOptions[0]?.getAttribute('data-comision') || 0;
        const valor = parseFloat(valorInput.value || 0);
        const comision = valor * (porcentaje / 100);
        comInput.value = comision.toFixed(2);
      }
    };
  } else {
    mecSelect.style.display = 'none';
    comInput.style.display = 'none';
  }
}


async function guardarTodo() {
  const fecha = document.getElementById('fecha').value;
  const cliente = document.getElementById('cliente').value;
  const dia = document.getElementById('dia').value;
  const mes = document.getElementById('mes').value;
  const quincena = document.getElementById('quincena').value;

  const cabecera = { fecha, cliente, dia, mes, quincena };
  const detalles = [];
  const filas = document.querySelectorAll('.registro-linea');

  filas.forEach(fila => {
    const cantidadInput = fila.querySelector('input[name="cantidad"]');
    const descripcionInput = fila.querySelector('input[name="descripcion"]');
    const tipoTransaccionInput = fila.querySelector('select[name="transaccion"]');
    const valorInput = fila.querySelector('input[name="valor"]');
    const mecanicoInput = fila.querySelector('select[name="mecanico"]');
    const comisionInput = fila.querySelector('input[name="comision"]');
    const tipoPagoInput = fila.querySelector('select[name="tipo_pago"]');

    const cantidad = parseInt(cantidadInput?.value) || 0;
    const descripcion = descripcionInput?.value || '';
    const tipo_transaccion = tipoTransaccionInput?.value;
    const valor = parseFloat(valorInput?.value) || 0;
    const mecanico_id = (mecanicoInput && mecanicoInput.style.display !== 'none' && mecanicoInput.value) ? parseInt(mecanicoInput.value) : null;
    const comision = (comisionInput && comisionInput.style.display !== 'none') ? parseFloat(comisionInput.value) || 0 : 0;
    const tipo_pago = tipoPagoInput?.value;

    if (!tipo_transaccion || isNaN(valor) || !tipo_pago) return;

    detalles.push({
      cantidad,
      descripcion,
      tipo_transaccion,
      valor,
      mecanico_id,
      comision,
      tipo_pago
    });
  });

  if (detalles.length === 0) {
    alert('❌ No se encontraron filas válidas para guardar.');
    return;
  }

  const payload = { ...cabecera, detalles };

  try {
    let response;

    if (idRegistroEditando) {
      response = await fetch(`/api/registro/${idRegistroEditando}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      response = await fetch('/api/registro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cabecera, detalle: detalles }) // OJO: el endpoint POST usa "detalle", no "detalles"
      });
    }

    const result = await response.json();

    if (response.ok) {
      alert(idRegistroEditando ? '✅ Registro actualizado con éxito' : '✅ Registro guardado con éxito');
      location.reload();
    } else {
      alert('❌ Error: ' + result.error);
    }
  } catch (error) {
    console.error('Error al guardar o actualizar:', error);
    alert('❌ Error en la solicitud');
  }
}


let movimientosData = [];

function cargarMovimientos() {
  fetch('/api/reporte/movimientos')
    .then(response => response.json())
    .then(data => {
      movimientosData = data; // Guardamos para usar en los filtros
      mostrarMovimientosFiltrados(movimientosData);
    })
    .catch(error => {
      console.error('❌ Error al cargar movimientos:', error);
      document.getElementById('contenedor-movimientos').innerHTML =
        '<p>Error al cargar los movimientos.</p>';
    });
}

function mostrarMovimientosFiltrados(data) {
  const contenedor = document.getElementById('contenedor-movimientos');

  if (data.length === 0) {
    contenedor.innerHTML = '<p>No hay movimientos registrados.</p>';
    return;
  }

  let totalPorDia = {};
  data.forEach(row => {
    totalPorDia[row.fecha] = (totalPorDia[row.fecha] || 0) + row.ingreso - row.salida;
  });

  let tablaHTML = `
    <h2>Registro de Movimientos Diarios</h2>
    <table border="1" cellpadding="5" cellspacing="0">
      <thead>
        <tr>
          <th>Fecha</th>
          <th>Cantidad</th>
          <th>Descripción</th>
          <th>Clasificación</th>
          <th>Mecánico M/O</th>
          <th>Ingreso</th>
          <th>Com Técnico</th>
          <th>Salida</th>
          <th>Cliente</th>
          <th>Observación</th>
        </tr>
      </thead>
      <tbody>
  `;

  data.forEach(row => {
    tablaHTML += `
      <tr>
        <td>${row.fecha}</td>
        <td>${row.cantidad}</td>
        <td>${row.descripcion}</td>
        <td>${row.clasificacion}</td>
        <td>${row.mecanico}</td>
        <td>${row.ingreso.toFixed(2)}</td>
        <td>${row.comision.toFixed(2)}</td>
        <td>${row.salida.toFixed(2)}</td>
        <td>${row.cliente || ''}</td>
        <td>${row.observacion || ''}</td>
      </tr>
    `;
  });

  tablaHTML += `
      </tbody>
    </table>
    <br>
    <h3>Totales por Día</h3>
    <ul>
      ${Object.entries(totalPorDia).map(([fecha, total]) => `<li><strong>${fecha}:</strong> ${total.toFixed(2)}</li>`).join('')}
    </ul>
  `;

  contenedor.innerHTML = tablaHTML;
}


function exportarExcel() {
  const cliente = document.getElementById('filtro-cliente').value;
  const fecha = document.getElementById('filtro-fecha').value;
  const mes = document.getElementById('filtro-mes').value;
  const mecanico = document.getElementById('filtro-mecanico').value;

  const queryParams = new URLSearchParams({
    cliente,
    fecha,
    mes,
    mecanico
  });

  fetch(`/api/reporte-excel/movimientos/exportar?${queryParams.toString()}`)
    .then(response => {
      if (!response.ok) throw new Error('No se pudo generar el archivo');
      return response.blob();
    })
    .then(blob => {
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'reporte_filtrado.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    })
    .catch(err => {
      console.error('Error al exportar a Excel:', err);
      alert('❌ No se pudo generar el archivo Excel.');
    });
}


function actualizarTotalParcial() {
  const filas = document.querySelectorAll('.registro-linea');
  let total = 0;

  filas.forEach(fila => {
    const tipo = fila.querySelector('select[name="transaccion"]')?.value?.toLowerCase() || '';
    const valor = parseFloat(fila.querySelector('input[name="valor"]')?.value) || 0;

    // Transacciones que deben restar
    const tiposQueRestan = ['compra', 'gasto', 'proveedor', 'sueldo', 'alimentación', 'cuenta por cobrar'];

    // Transacciones que deben sumar
    const tiposQueSuman = ['venta', 'mano de obra', 'ingreso', 'cuenta cobrada'];

    if (tiposQueRestan.includes(tipo)) {
      total -= valor;
    } else if (tiposQueSuman.includes(tipo)) {
      total += valor;
    } else {
      // Si no está definido, lo dejamos como suma (opcional: podrías excluirlo)
      total += valor;
    }
  });

  document.getElementById('total-parcial').textContent = total.toFixed(2);
}


async function buscarRegistro() {
  const fecha = document.getElementById('fecha').value;
  if (!fecha) {
    alert('⚠️ Por favor, selecciona una fecha para buscar.');
    return;
  }

  try {
    const response = await fetch(`/api/registro?fecha=${fecha}`);
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Error al buscar');
    }

    if (!result || !result.detalle || result.detalle.length === 0) {
      alert('🔎 No se encontró ningún registro con esa fecha.');
      return;
    }

    // Cargar cabecera
    document.getElementById('cliente').value = result.cabecera.cliente || 'Consumidor final';
    document.getElementById('dia').value = result.cabecera.dia;
    document.getElementById('mes').value = result.cabecera.mes;
    document.getElementById('quincena').value = result.cabecera.quincena;


    idRegistroEditando = result.cabecera.id;


    // Limpiar filas anteriores
    document.getElementById('detalle-movimientos').innerHTML = '';
    contadorFilas = 0;

    // Cargar cada fila de detalle
    result.detalle.forEach(item => {
      agregarFila();
      const ultimaFila = document.querySelector('#detalle-movimientos tr:last-child');
      ultimaFila.querySelector('input[name="cantidad"]').value = item.cantidad;
      ultimaFila.querySelector('input[name="descripcion"]').value = item.descripcion;
      ultimaFila.querySelector('select[name="transaccion"]').value = item.tipo_transaccion;
      ultimaFila.querySelector('input[name="valor"]').value = item.valor.toFixed(2);
      ultimaFila.querySelector('select[name="tipo_pago"]').value = item.tipo_pago;

      if (item.tipo_transaccion.toLowerCase() === 'mano de obra' && item.mecanico_id) {
        const mecanicoSelect = ultimaFila.querySelector('select[name="mecanico"]');
        mecanicoSelect.style.display = 'inline';
        mecanicoSelect.value = item.mecanico_id;
        mecanicoSelect.dispatchEvent(new Event('change'));

        const comisionInput = ultimaFila.querySelector('input[name="comision"]');
        comisionInput.style.display = 'inline';
        comisionInput.value = item.comision.toFixed(2);
      }
    });

    actualizarTotalParcial();
    alert('✅ Registro cargado para edición.');
  } catch (error) {
    console.error('❌ Error al buscar:', error);
    alert('❌ Ocurrió un error al buscar el registro.');
  }
}

function limpiarFormulario() {
  document.getElementById('cliente').value = 'Consumidor final';
  document.getElementById('dia').value = '';
  document.getElementById('mes').value = '';
  document.getElementById('quincena').value = '';
  document.getElementById('detalle-movimientos').innerHTML = '';
  document.getElementById('total-parcial').textContent = '0.00';
  contadorFilas = 0;
}


function eliminarRegistro() {
  if (!confirm('¿Estás seguro de eliminar este registro?')) return;

  if (idRegistroEditando === null) {
    // Si es un nuevo registro, solo limpiar el formulario
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
    limpiarFormulario(); // Limpia el formulario tras eliminar
    idRegistroEditando = null;
  })
  .catch(() => {
    alert('❌ No se pudo eliminar el registro');
  });
}

function aplicarFiltros() {
  const cliente = document.getElementById('filtro-cliente').value.toLowerCase();
  const fecha = document.getElementById('filtro-fecha').value;
  const mes = document.getElementById('filtro-mes').value;
  const mecanico = document.getElementById('filtro-mecanico').value.toLowerCase();

  const filtrado = datosOriginales.filter(row => {
    const coincideCliente = !cliente || (row.cliente || '').toLowerCase().includes(cliente);
    const coincideFecha = !fecha || row.fecha === fecha;
    const coincideMes = !mes || parseInt(row.mes) === parseInt(mes);
    const coincideMecanico = !mecanico || (row.mecanico || '').toLowerCase().includes(mecanico);
    return coincideCliente && coincideFecha && coincideMes && coincideMecanico;
  });

  mostrarTablaFiltrada(filtrado);
}



function mostrarTablaFiltrada(data) {
  const contenedor = document.getElementById('contenedor-movimientos');

  if (data.length === 0) {
    contenedor.innerHTML = '<p>No hay movimientos registrados.</p>';
    return;
  }

  let tablaHTML = `
    <h2>Registro de Movimientos Diarios</h2>
    <table border="1" cellpadding="5" cellspacing="0">
      <thead>
        <tr>
          <th>Fecha</th>
          <th>Cantidad</th>
          <th>Descripción</th>
          <th>Clasificación</th>
          <th>Mecánico M/O</th>
          <th>Ingreso</th>
          <th>Com Técnico</th>
          <th>Salida</th>
          <th>Cliente</th>
          <th>Observación</th>
        </tr>
      </thead>
      <tbody>
  `;

  let totalDia = 0;

  data.forEach(row => {
    totalDia += row.ingreso;

    tablaHTML += `
      <tr>
        <td>${row.fecha}</td>
        <td>${row.cantidad}</td>
        <td>${row.descripcion}</td>
        <td>${row.clasificacion}</td>
        <td>${row.mecanico || ''}</td>
        <td>${row.ingreso.toFixed(2)}</td>
        <td>${row.comision.toFixed(2)}</td>
        <td>${row.salida.toFixed(2)}</td>
        <td>${row.cliente || ''}</td>
        <td>${row.observacion || ''}</td>
      </tr>
    `;
  });

  tablaHTML += `
      </tbody>
    </table>
    <p><strong>Total Ingreso del Filtro:</strong> $${totalDia.toFixed(2)}</p>
  `;

  contenedor.innerHTML = tablaHTML;
}


function descargarPlantilla() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["fecha", "cliente", "cantidad", "descripcion", "tipo_transaccion", "valor", "mecanico_id", "comision", "tipo_pago"],
    ["2025-07-31", "Cliente Ejemplo", 1, "Cambio de aceite", "Mano de Obra", 25.00, 1, 5.00, "Pagado (Efectivo)"]
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Plantilla");
  XLSX.writeFile(wb, "plantilla_registro_multimotos.xlsx");
}

function cargarPlantilla() {
  const input = document.getElementById("archivoExcel");
  const archivo = input.files[0];
  if (!archivo) return;

  const lector = new FileReader();
  lector.onload = function(e) {
    const data = new Uint8Array(e.target.result);
    const workbook = XLSX.read(data, { type: "array" });
    const hoja = workbook.Sheets[workbook.SheetNames[0]];
    const registros = XLSX.utils.sheet_to_json(hoja, { raw: true });

    if (registros.length === 0) {
      alert("❌ La plantilla está vacía.");
      return;
    }

    // Agrupar por fecha y cliente
    const agrupado = {};
    for (const fila of registros) {
      const key = fila.fecha + "_" + fila.cliente;
      if (!agrupado[key]) agrupado[key] = [];
      agrupado[key].push(fila);
    }

    const [primero] = Object.values(agrupado)[0];
    const fecha = primero.fecha;
    const cliente = primero.cliente;

    const dia = new Date(fecha).getDate();
    const mes = new Date(fecha).getMonth() + 1;
    const quincena = dia <= 15 ? 1 : 2;

    const cabecera = { fecha, cliente, dia, mes, quincena };
    const detalle = agrupado[`${fecha}_${cliente}`].map(r => ({
      cantidad: r.cantidad,
      descripcion: r.descripcion,
      tipo_transaccion: r.tipo_transaccion,
      valor: r.valor,
      mecanico_id: r.mecanico_id,
      comision: r.comision,
      tipo_pago: r.tipo_pago
    }));

    fetch("/api/registro", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cabecera, detalle })
    })
    .then(res => res.json())
    .then(res => {
      if (res.success) {
        document.getElementById("mensaje-carga").textContent = "✅ Carga realizada con éxito.";
        document.getElementById("mensaje-carga").style.color = "green";
      } else {
        alert("❌ Error: " + (res.error || "desconocido"));
      }
    })
    .catch(err => {
      console.error("❌ Error importando:", err);
      alert("❌ Error al importar");
    });
  };

  lector.readAsArrayBuffer(archivo);
}
