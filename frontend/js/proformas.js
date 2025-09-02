// Variables globales
let proformaActual = null;
let modalProforma, modalVerProforma;

document.addEventListener('DOMContentLoaded', () => {
  // Inicializar modales cuando el DOM y Bootstrap estén listos
  modalProforma = new bootstrap.Modal(document.getElementById('modalProforma'));
  modalVerProforma = new bootstrap.Modal(document.getElementById('modalVerProforma'));

  cargarProformas();

  const fecha = document.getElementById('fecha');
  if (fecha) fecha.valueAsDate = new Date();
});

// Cargar listado de proformas
async function cargarProformas() {
  try {
    const response = await fetch('/api/proformas');
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const proformas = await response.json();

    const tbody = document.getElementById('tabla-proformas');
    tbody.innerHTML = '';

    proformas.forEach(p => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${p.id}</td>
        <td>${p.fecha}</td>
        <td>${p.cliente}</td>
        <td>${p.vehiculo || '-'}</td>
        <td>$ ${(p.total ?? 0).toFixed(2)}</td>
        <td><span class="estado-${(p.estado || 'pendiente').toLowerCase()}">${p.estado || 'pendiente'}</span></td>
        <td class="d-flex gap-1">
          <button class="btn btn-sm btn-outline-primary" onclick="verProforma(${p.id})">
            <i class="bi bi-eye"></i> Ver
          </button>
          <button class="btn btn-sm btn-outline-secondary" onclick="editarProforma(${p.id})">
            <i class="bi bi-pencil"></i> Editar
          </button>
          <button class="btn btn-sm btn-outline-danger" onclick="eliminarProforma(${p.id})">
            <i class="bi bi-trash"></i> Eliminar
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (error) {
    console.error('Error al cargar proformas:', error);
    alert('Error al cargar proformas');
  }
}

// Mostrar modal para nueva proforma
function mostrarModalNuevaProforma() {
  proformaActual = null;
  document.getElementById('modalProformaTitulo').textContent = 'Nueva Proforma';
  document.getElementById('formProforma').reset();
  document.getElementById('detalle-proforma').innerHTML = '';
  document.getElementById('total-proforma').textContent = '$ 0.00';
  agregarFilaDetalle(); // al menos 1 fila
  modalProforma.show();
}

// Agregar fila al detalle
function agregarFilaDetalle() {
  const tbody = document.getElementById('detalle-proforma');
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="text" class="form-control form-control-sm descripcion" placeholder="Descripción" required></td>
    <td><input type="number" class="form-control form-control-sm cantidad" value="1" min="1" required></td>
    <td><input type="number" step="0.01" class="form-control form-control-sm precio" placeholder="0.00" required></td>
    <td class="subtotal">$ 0.00</td>
    <td><button class="btn btn-sm btn-outline-danger" onclick="eliminarFila(this)"><i class="bi bi-trash"></i></button></td>
  `;
  tbody.appendChild(tr);

  // Escuchar cambios para recalcular
  const inputs = tr.querySelectorAll('.cantidad, .precio, .descripcion');
  inputs.forEach(input => input.addEventListener('input', calcularTotales));
}

// Eliminar fila del detalle
function eliminarFila(boton) {
  boton.closest('tr').remove();
  calcularTotales();
}

// Calcular totales
function calcularTotales() {
  const filas = document.querySelectorAll('#detalle-proforma tr');
  let total = 0;

  filas.forEach(fila => {
    const cantidad = parseFloat(fila.querySelector('.cantidad')?.value) || 0;
    const precio = parseFloat(fila.querySelector('.precio')?.value) || 0;
    const subtotal = cantidad * precio;
    const tdSubtotal = fila.querySelector('.subtotal');
    if (tdSubtotal) tdSubtotal.textContent = `$ ${subtotal.toFixed(2)}`;
    total += subtotal;
  });

  document.getElementById('total-proforma').textContent = `$ ${total.toFixed(2)}`;
}

// Guardar (crear o actualizar)
async function guardarProforma() {
  const form = document.getElementById('formProforma');
  if (!form.checkValidity()) {
    form.classList.add('was-validated');
    return;
  }

  const detalle = [];
  document.querySelectorAll('#detalle-proforma tr').forEach(fila => {
    const desc = fila.querySelector('.descripcion')?.value?.trim();
    const cant = parseFloat(fila.querySelector('.cantidad')?.value) || 1;
    const precio = parseFloat(fila.querySelector('.precio')?.value) || 0;
    if (desc) {
      detalle.push({
        descripcion: desc,
        cantidad: cant,
        precio_unitario: precio,
        tipo: 'servicio' // puedes cambiarlo según tu lógica
      });
    }
  });

  if (detalle.length === 0) {
    alert('Debe agregar al menos un ítem al detalle');
    return;
  }

  const proformaData = {
    fecha: document.getElementById('fecha').value,
    cliente: document.getElementById('cliente').value,
    vehiculo: document.getElementById('vehiculo').value,
    placa: document.getElementById('placa').value,
    kilometraje: document.getElementById('kilometraje').value,
    observaciones: document.getElementById('observaciones').value,
    detalle
  };

  try {
    const url = proformaActual ? `/api/proformas/${proformaActual}` : '/api/proformas';
    const method = proformaActual ? 'PUT' : 'POST';

    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(proformaData)
    });

    if (!response.ok) throw new Error('Error al guardar');

    modalProforma.hide();
    cargarProformas();
    alert('Proforma guardada exitosamente');
  } catch (error) {
    console.error('Error:', error);
    alert('Error al guardar proforma');
  }
}

// Ver proforma
async function verProforma(id) {
  try {
    const response = await fetch(`/api/proformas/${id}`);
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const proforma = await response.json();

    document.getElementById('ver-proforma-id').textContent = id;
    document.getElementById('ver-fecha').textContent = proforma.fecha;
    document.getElementById('ver-cliente').textContent = proforma.cliente;
    document.getElementById('ver-vehiculo').textContent = proforma.vehiculo || '-';
    document.getElementById('ver-placa').textContent = proforma.placa || '-';
    document.getElementById('ver-kilometraje').textContent = proforma.kilometraje || '-';
    document.getElementById('ver-observaciones').textContent = proforma.observaciones || '-';

    const tbody = document.getElementById('ver-detalle');
    tbody.innerHTML = '';

    let total = 0;
    (proforma.detalle || []).forEach(item => {
      const subtotal = (item.cantidad || 0) * (item.precio_unitario || 0);
      total += subtotal;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${item.descripcion}</td>
        <td>${item.cantidad}</td>
        <td>$ ${(item.precio_unitario || 0).toFixed(2)}</td>
        <td>$ ${subtotal.toFixed(2)}</td>
      `;
      tbody.appendChild(tr);
    });

    document.getElementById('ver-total').textContent = `$ ${total.toFixed(2)}`;
    proformaActual = id;
    modalVerProforma.show();
  } catch (error) {
    console.error('Error al cargar proforma:', error);
    alert('Error al cargar proforma');
  }
}

// Cambiar estado
async function aprobarProforma() { await cambiarEstadoProforma('Aprobado'); }
async function rechazarProforma() { await cambiarEstadoProforma('Rechazado'); }

async function cambiarEstadoProforma(estado) {
  if (!confirm(`¿Está seguro de marcar esta proforma como ${estado}?`)) return;

  try {
    const response = await fetch(`/api/proformas/${proformaActual}/estado`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado })
    });

    if (!response.ok) throw new Error('Error al cambiar estado');

    modalVerProforma.hide();
    cargarProformas();
    alert(`Proforma marcada como ${estado}`);
  } catch (error) {
    console.error('Error:', error);
    alert('Error al cambiar estado');
  }
}

// Editar proforma
async function editarProforma(id) {
  try {
    const response = await fetch(`/api/proformas/${id}`);
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const proforma = await response.json();

    proformaActual = id;
    document.getElementById('modalProformaTitulo').textContent = 'Editar Proforma';
    document.getElementById('proformaId').value = id;
    document.getElementById('fecha').value = proforma.fecha;
    document.getElementById('cliente').value = proforma.cliente;
    document.getElementById('vehiculo').value = proforma.vehiculo || '';
    document.getElementById('placa').value = proforma.placa || '';
    document.getElementById('kilometraje').value = proforma.kilometraje || '';
    document.getElementById('observaciones').value = proforma.observaciones || '';

    const tbody = document.getElementById('detalle-proforma');
    tbody.innerHTML = '';

    let total = 0;
    (proforma.detalle || []).forEach(item => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input type="text" class="form-control form-control-sm descripcion" value="${item.descripcion}" required></td>
        <td><input type="number" class="form-control form-control-sm cantidad" value="${item.cantidad}" min="1" required></td>
        <td><input type="number" step="0.01" class="form-control form-control-sm precio" value="${item.precio_unitario}" required></td>
        <td class="subtotal">$ ${(item.cantidad * item.precio_unitario).toFixed(2)}</td>
        <td><button class="btn btn-sm btn-outline-danger" onclick="eliminarFila(this)"><i class="bi bi-trash"></i></button></td>
      `;
      tbody.appendChild(tr);

      const inputs = tr.querySelectorAll('.cantidad, .precio, .descripcion');
      inputs.forEach(input => input.addEventListener('input', calcularTotales));

      total += item.cantidad * item.precio_unitario;
    });

    document.getElementById('total-proforma').textContent = `$ ${total.toFixed(2)}`;
    modalProforma.show();
  } catch (error) {
    console.error('Error al cargar proforma para editar:', error);
    alert('Error al cargar proforma');
  }
}

// Eliminar proforma
async function eliminarProforma(id) {
  if (!confirm('¿Está seguro de eliminar esta proforma?')) return;

  try {
    const response = await fetch(`/api/proformas/${id}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('Error al eliminar');

    cargarProformas();
    alert('Proforma eliminada');
  } catch (error) {
    console.error('Error:', error);
    alert('Error al eliminar proforma');
  }
}
