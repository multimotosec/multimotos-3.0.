let movimientosOriginales = [];

window.addEventListener("DOMContentLoaded", () => {
  cargarMovimientos(); // Carga por defecto todos los datos al abrir la ventana
});

async function cargarMovimientos() {
  try {
    const res = await fetch('/api/reporte/movimientos');
    const data = await res.json();
    movimientosOriginales = data || [];
    mostrarMovimientos(movimientosOriginales);
  } catch (error) {
    console.error('❌ Error al cargar movimientos:', error);
  }
}

function mostrarMovimientos(movimientos) {
  const contenedor = document.getElementById('contenedor-movimientos');
  if (!contenedor) return;

  if (movimientos.length === 0) {
    contenedor.innerHTML = `<p>No se encontraron movimientos para mostrar.</p>`;
    return;
  }

  let html = `
    <table>
      <thead>
        <tr>
          <th>Fecha</th>
          <th>Cant.</th>
          <th>Descripción</th>
          <th>Clasificación</th>
          <th>Mecánico</th>
          <th>Ingreso</th>
          <th>Com. Técnico</th>
          <th>Salida</th>
          <th>Cliente</th>
          <th>Observación</th>
        </tr>
      </thead>
      <tbody>
  `;

    movimientos.forEach(item => {
    const formatoDecimal = (valor) => {
      if (valor == null || valor === "") return "";
      return parseFloat(valor).toFixed(2).replace(".", ",");
    };

    html += `
      <tr>
        <td>${item.fecha || ''}</td>
        <td>${item.cantidad || ''}</td>
        <td>${item.descripcion || ''}</td>
        <td>${item.clasificacion || ''}</td>
        <td>${item.mecanico || ''}</td>
        <td class="text-end">${formatoDecimal(item.ingreso)}</td>
        <td class="text-end">${formatoDecimal(item.com_tecnico)}</td>
        <td class="text-end">${formatoDecimal(item.salida)}</td>
        <td>${item.cliente || ''}</td>
        <td>${item.observacion || ''}</td>
      </tr>
    `;
  });


  html += `</tbody></table>`;
  contenedor.innerHTML = html;
}

function aplicarFiltros() {
  const cliente = document.getElementById('filtro-cliente').value.toLowerCase();
  const fecha = document.getElementById('filtro-fecha').value;
  const mes = document.getElementById('filtro-mes').value;
  const mecanico = document.getElementById('filtro-mecanico').value.toLowerCase();

  const filtrados = movimientosOriginales.filter(item => {
    const coincideCliente = cliente === '' || (item.cliente || '').toLowerCase().includes(cliente);
    const coincideFecha = fecha === '' || (item.fecha || '').includes(fecha.split('-').reverse().join('/'));
    const coincideMes = mes === '' || parseInt(item.fecha?.split('/')[1]) === parseInt(mes);
    const coincideMecanico = mecanico === '' || (item.mecanico || '').toLowerCase().includes(mecanico);

    return coincideCliente && coincideFecha && coincideMes && coincideMecanico;
  });

  mostrarMovimientos(filtrados);
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

  const url = `/api/reporte-excel/movimientos/exportar?${queryParams.toString()}`;
  window.open(url, '_blank');
}
