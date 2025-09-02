// frontend/js/proveedores.js
let ventasCargadas = [];
let itemsSeleccionados = [];
let modalCruce, modalNuevaCompra, modalCompraDetalle, modalPagos;
let modoManual = false; // true = compra manual (sin cruce)
let toastOk, toastErr;

document.addEventListener('DOMContentLoaded', () => {
  modalCruce = new bootstrap.Modal(document.getElementById('modalCruce'));
  modalNuevaCompra = new bootstrap.Modal(document.getElementById('modalNuevaCompra'));
  modalCompraDetalle = new bootstrap.Modal(document.getElementById('modalCompraDetalle'));
  modalPagos = new bootstrap.Modal(document.getElementById('modalPagos'));
  toastOk = new bootstrap.Toast(document.getElementById('toastOk'));
  toastErr = new bootstrap.Toast(document.getElementById('toastErr'));

  cargarProveedores();
  cargarCompras();
  cargarCXP();

  // crear proveedor
  document.getElementById('formProveedor')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd.entries());
    const res = await fetch('/api/proveedores', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    if (!res.ok) return showErr('Error guardando proveedor');
    e.target.reset();
    cargarProveedores(true);
    showOk('Proveedor guardado');
  });

  // === NUEVA COMPRA (manual) ===
  document.getElementById('btnNuevaCompra')?.addEventListener('click', async () => {
    modoManual = true;
    itemsSeleccionados = [];
    await poblarProveedoresSelect();
    limpiarFormularioCompra();
    renderItemsCompra();
    modalNuevaCompra.show();
  });

  // Agregar ítem manual (modal NuevaCompra)
  document.getElementById('btnAddItem')?.addEventListener('click', () => {
    itemsSeleccionados.push({ descripcion: '', cantidad: 1, precio_unitario: 0, origen: 'manual', registro_detalle_id: null });
    renderItemsCompra(true);
  });

  // === CRUCE DE VENTAS ===
  document.getElementById('btnCruceVentas')?.addEventListener('click', () => {
    modoManual = false;
    ventasCargadas = [];
    itemsSeleccionados = [];
    qs('#tablaVentas tbody').innerHTML = '';
    id('chkTodos').checked = false;
    modalCruce.show();
  });

  // traer ventas
  document.getElementById('btnTraerVentas')?.addEventListener('click', async () => {
    const desde = id('fDesde').value;
    const hasta = id('fHasta').value;
    if (!desde || !hasta) return showErr('Selecciona el rango de fechas');

    const res = await fetch(`/api/proveedores/ventas?desde=${desde}&hasta=${hasta}`);
    if (!res.ok) return showErr('Error consultando ventas');
    ventasCargadas = await res.json();

    const tbody = qs('#tablaVentas tbody');
    tbody.innerHTML = '';
    ventasCargadas.forEach(v => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input type="checkbox" class="chkVenta" data-id="${v.registro_detalle_id}"></td>
        <td>${v.fecha ?? ''}</td>
        <td><input class="form-control form-control-sm desc-edit" value="${(v.descripcion||'').replace(/"/g,'&quot;')}"></td>
        <td><input class="form-control form-control-sm cant-edit" type="number" step="0.01" value="${v.cantidad ?? 1}"></td>
        <td><input class="form-control form-control-sm precio-edit" type="number" step="0.01" value="0"></td>
      `;
      tbody.appendChild(tr);
    });
  });

  // seleccionar todo
  document.getElementById('chkTodos')?.addEventListener('change', (e) => {
    qsa('.chkVenta').forEach(chk => chk.checked = e.target.checked);
  });

  // cargar a factura (desde cruce)
  document.getElementById('btnCargarAFactura')?.addEventListener('click', async () => {
    const rows = Array.from(qsa('#tablaVentas tbody tr'));
    itemsSeleccionados = rows
      .filter(r => r.querySelector('.chkVenta')?.checked)
      .map(r => {
        const id = Number(r.querySelector('.chkVenta').dataset.id);
        const desc = r.querySelector('.desc-edit').value.trim();
        const cant = Number(r.querySelector('.cant-edit').value) || 0;
        const precio = Number(r.querySelector('.precio-edit').value) || 0;
        return { registro_detalle_id: id, descripcion: desc, cantidad: cant, precio_unitario: precio, origen: 'registro' };
      });

    if (itemsSeleccionados.length === 0) return showErr('Selecciona al menos un rubro');

    await poblarProveedoresSelect();
    limpiarFormularioCompra();
    renderItemsCompra();
    modalCruce.hide();
    modalNuevaCompra.show();
    showOk('La información ha sido cargada con éxito');
  });

  // guardar compra (manual o cruce)
  document.getElementById('btnGuardarCompra')?.addEventListener('click', async () => {
    const form = id('formCompra');
    const fd = new FormData(form);
    const body = Object.fromEntries(fd.entries());
    body.proveedor_id = Number(body.proveedor_id);

    const items = leerItemsDesdeTabla('#tablaItemsCompra tbody');
    if (items.length === 0) return showErr('Agrega al menos un ítem con cantidad y precio.');

    body.items = items;

    const res = await fetch('/api/proveedores/compras', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    const ok = res.ok;
    let data = {};
    try { data = await res.json(); } catch {}
    if (!ok) return showErr('Error guardando compra: ' + (data?.error || res.status));

    form.reset();
    itemsSeleccionados = [];
    qs('#tablaItemsCompra tbody').innerHTML = '';
    id('totalCompra').textContent = '$0.00';
    modalNuevaCompra.hide();
    cargarCompras(true);
    cargarCXP(true);
    showOk('Compra guardada');
  });

  // Abrir pagos desde modal de nueva compra (requiere que exista la compra)
  document.getElementById('btnAbrirPagosDesdeCompra')?.addEventListener('click', async () => {
    const compraId = id('compraEditId')?.value; // si vienes desde editar, habrá valor
    if (!compraId) return showErr('Primero guarda la compra para registrar pagos.');
    abrirPagos(Number(compraId));
  });

  // ====== COMPRAS: Ver/Editar/Pagar ======
  qs('#tablaCompras tbody')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.btn-ver');
    if (!btn) return;
    const idCompra = Number(btn.dataset.id);
    abrirDetalleCompra(idCompra);
  });

  // Guardar cambios en compra existente
  document.getElementById('btnGuardarEdit')?.addEventListener('click', async () => {
    const compraId = Number(id('compraEditId').value);
    const body = {
      proveedor_id: Number(id('selProveedorEdit').value) || null,
      numero_factura: id('numeroFacturaEdit').value || null,
      fecha_recepcion: id('fechaEdit').value || null,
      condicion_pago: id('condicionEdit').value || null,
      observaciones: id('obsEdit').value || null,
      items: leerItemsDesdeTabla('#tablaItemsEdit tbody')
    };
    if (body.items.length === 0) return showErr('Agrega al menos un ítem.');

    const res = await fetch(`/api/proveedores/compras/${compraId}`, {
      method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)
    });
    const ok = res.ok;
    let data = {};
    try { data = await res.json(); } catch {}
    if (!ok) return showErr('No se pudo guardar: ' + (data?.error || res.status));

    renderTablaItemsEdit(data.detalle);
    id('totalEdit').textContent = fmt(sumDetalle(data.detalle));
    cargarCompras(true);
    cargarCXP(true);
    showOk('Compra actualizada');
  });

  // Agregar ítem en edición
  document.getElementById('btnAddItemEdit')?.addEventListener('click', () => {
    const tbody = qs('#tablaItemsEdit tbody');
    const tr = document.createElement('tr');
    tr.innerHTML = filaItemEditable();
    tbody.appendChild(tr);
    ligarEventosFilaEdit(tr);
    recalcTotalEdit();
  });

  // Abrir pagos desde detalle
  document.getElementById('btnAbrirPagosDesdeDetalle')?.addEventListener('click', () => {
    const compraId = Number(id('compraEditId').value);
    abrirPagos(compraId);
  });

  // ====== PAGOS modal ======
  document.getElementById('btnGuardarPagoModal')?.addEventListener('click', async () => {
    const form = id('formPagoModal');
    const fd = new FormData(form);
    const body = Object.fromEntries(fd.entries());
    body.compra_id = Number(body.compra_id);
    body.monto = Number(body.monto);

    const res = await fetch('/api/proveedores/abonos', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    if (!res.ok) return showErr('Error guardando pago');

    await cargarAbonos(body.compra_id);
    cargarCompras(true);
    cargarCXP(true);
    showOk('Pago registrado');
    form.reset();
  });

  // === sección Pagos (existente) ===
  id('formPago')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd.entries());
    body.compra_id = Number(body.compra_id);
    body.monto = Number(body.monto);
    const res = await fetch('/api/proveedores/abonos', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    if (!res.ok) return showErr('Error guardando pago');
    e.target.reset();
    cargarCompras(true);
    cargarCXP(true);
    showOk('Pago registrado');
  });
});

// ===== Helpers UI/Fetch =====
async function cargarProveedores(){
  const res = await fetch('/api/proveedores');
  if (!res.ok) return;
  const data = await res.json();

  // tabla proveedores
  const tbody = qs('#tablaProveedores tbody');
  if (tbody){
    tbody.innerHTML = '';
    data.forEach((p,i)=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${i+1}</td><td>${p.nombre||''}</td><td>${p.ruc||''}</td><td>${p.telefono||''}</td><td>${p.email||''}</td><td>${p.direccion||''}</td>`;
      tbody.appendChild(tr);
    });
  }
  // selects
  const sel = id('selProveedor');
  if (sel){
    sel.innerHTML = `<option value="">Seleccione...</option>`;
    data.forEach(p => sel.appendChild(new Option(p.nombre, p.id)));
  }
  const selEdit = id('selProveedorEdit');
  if (selEdit){
    selEdit.innerHTML = `<option value="">Seleccione...</option>`;
    data.forEach(p => selEdit.appendChild(new Option(p.nombre, p.id)));
  }
}

async function poblarProveedoresSelect(){ await cargarProveedores(); }

async function cargarCompras(){
  const res = await fetch('/api/proveedores/compras');
  if (!res.ok) return;
  const data = await res.json();
  const tbody = qs('#tablaCompras tbody');
  if (!tbody) return;

  tbody.innerHTML = '';
  data.forEach(c=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${c.id}</td>
      <td>${c.proveedor||''}</td>
      <td>${c.numero_factura||''}</td>
      <td>${c.fecha_recepcion||''}</td>
      <td>${c.condicion_pago||''}</td>
      <td>${fmt(c.total)}</td>
      <td>${fmt(c.abonado)}</td>
      <td>${fmt(c.saldo)}</td>
      <td><span class="badge-soft">${c.estado||''}</span></td>
      <td class="text-end tbl-actions">
        <button class="btn btn-sm btn-outline-primary btn-ver" data-id="${c.id}">Ver / Editar</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function cargarCXP(){
  const res = await fetch('/api/proveedores/cxp');
  if (!res.ok) return;
  const data = await res.json();
  const tbody = qs('#tablaCXP tbody');
  if (!tbody) return;

  tbody.innerHTML = '';
  data.forEach(c=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${c.compra_id}</td>
      <td>${c.proveedor||''}</td>
      <td>${c.numero_factura||''}</td>
      <td>${c.fecha_recepcion||''}</td>
      <td>${fmt(c.total)}</td>
      <td>${fmt(c.abonado)}</td>
      <td>${fmt(c.saldo)}</td>
      <td>${c.estado||''}</td>
    `;
    tbody.appendChild(tr);
  });
}

function limpiarFormularioCompra(){
  id('formCompra')?.reset();
  qs('#tablaItemsCompra tbody').innerHTML = '';
  id('totalCompra').textContent = '$0.00';
}

function renderItemsCompra(scrollAlFinal=false){
  const tbody = qs('#tablaItemsCompra tbody');
  tbody.innerHTML = '';
  itemsSeleccionados.forEach((it, idx)=>{
    const tr = document.createElement('tr');
    tr.dataset.registroId = it.registro_detalle_id ?? '';
    tr.dataset.origen = it.origen || 'manual';
    tr.innerHTML = `
      <td><input class="form-control form-control-sm it-desc" value="${esc(it.descripcion)}" placeholder="Descripción"></td>
      <td style="max-width:120px;"><input class="form-control form-control-sm it-cant" type="number" step="0.01" value="${num(it.cantidad)}"></td>
      <td style="max-width:150px;"><input class="form-control form-control-sm it-precio" type="number" step="0.01" value="${num(it.precio_unitario)}"></td>
      <td class="it-subtotal fw-semibold">$0.00</td>
      <td class="text-end"><button class="btn btn-outline-danger btn-sm" data-del="${idx}">✕</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.it-desc,.it-cant,.it-precio').forEach(inp => inp.addEventListener('input', recalcTotal));
  tbody.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', (e)=>{
    const i = Number(e.currentTarget.dataset.del);
    itemsSeleccionados.splice(i,1);
    renderItemsCompra();
  }));

  recalcTotal();
  if (scrollAlFinal) setTimeout(()=>{ tbody.parentElement?.scrollTo({ top: tbody.parentElement.scrollHeight, behavior: 'smooth' }); }, 0);
}

function recalcTotal(){
  const rows = Array.from(qsa('#tablaItemsCompra tbody tr'));
  let total = 0;
  rows.forEach(r=>{
    const cant = Number(r.querySelector('.it-cant')?.value) || 0;
    const precio = Number(r.querySelector('.it-precio')?.value) || 0;
    const sub = cant * precio;
    r.querySelector('.it-subtotal').textContent = fmt(sub);
    total += sub;
  });
  id('totalCompra').textContent = fmt(total);
}

function leerItemsDesdeTabla(selectorTbody){
  const rows = Array.from(qs(selectorTbody).querySelectorAll('tr'));
  return rows.map(r => {
    const desc = r.querySelector('.it-desc')?.value?.trim() ?? '';
    const cant = Number(r.querySelector('.it-cant')?.value) || 0;
    const precio = Number(r.querySelector('.it-precio')?.value) || 0;
    const rid = r.dataset.registroId ? Number(r.dataset.registroId) : null;
    const origen = r.dataset.origen || 'manual';
    return { descripcion: desc, cantidad: cant, precio_unitario: precio, registro_detalle_id: rid, origen };
  }).filter(it => it.descripcion !== '' && it.cantidad > 0);
}

// ===== Detalle de compra existente =====
async function abrirDetalleCompra(compraId){
  // Asegura que los selects estén poblados antes de setear el value
  await cargarProveedores();

  const res = await fetch(`/api/proveedores/compras/${compraId}`);
  if (!res.ok) return showErr('No se pudo cargar la compra');
  const data = await res.json();

  // Cabecera
  id('compraEditId').value = compraId;
  id('selProveedorEdit').value = data.cabecera?.proveedor_id ?? '';
  id('numeroFacturaEdit').value = data.cabecera?.numero_factura ?? '';
  id('fechaEdit').value = data.cabecera?.fecha_recepcion ?? '';
  id('condicionEdit').value = data.cabecera?.condicion_pago ?? 'Crédito';
  id('obsEdit').value = data.cabecera?.observaciones ?? '';
  id('estadoEdit').textContent = data.cabecera?.estado || '';

  // Ítems
  renderTablaItemsEdit(data.detalle);
  id('totalEdit').textContent = fmt(sumDetalle(data.detalle));

  // Bloquear edición si no está pendiente
  const esPendiente = String(data.cabecera?.estado || '').toLowerCase() === 'pendiente';
  toggleEditableDetalle(esPendiente);

  modalCompraDetalle.show();
}

function toggleEditableDetalle(pendiente){
  // Inputs de cabecera
  ['selProveedorEdit','numeroFacturaEdit','fechaEdit','condicionEdit','obsEdit'].forEach(cid=>{
    const el = id(cid);
    if (!el) return;
    el.disabled = !pendiente;
  });

  // Botones de edición
  id('btnAddItemEdit').style.display = pendiente ? '' : 'none';
  id('btnGuardarEdit').style.display = pendiente ? '' : 'none';

  // Filas de ítems
  qsa('#tablaItemsEdit tbody input').forEach(inp => inp.disabled = !pendiente);
  qsa('#tablaItemsEdit .btn-del-row').forEach(btn => btn.style.display = pendiente ? '' : 'none');
}

function renderTablaItemsEdit(detalle){
  const tbody = qs('#tablaItemsEdit tbody');
  tbody.innerHTML = '';
  detalle.forEach(d=>{
    const tr = document.createElement('tr');
    tr.innerHTML = filaItemEditable(d.descripcion, d.cantidad, d.precio_unitario, d.registro_detalle_id, d.origen);
    tbody.appendChild(tr);
  });
  qsa('#tablaItemsEdit tbody tr').forEach(tr => ligarEventosFilaEdit(tr));
  recalcTotalEdit();
}

function filaItemEditable(desc='', cant=1, precio=0, registroId=null, origen='manual'){
  // (registroId y origen no se muestran, pero mantenemos la estructura homogénea)
  return `
    <td><input class="form-control form-control-sm it-desc" value="${esc(desc)}" placeholder="Descripción"></td>
    <td style="max-width:120px;"><input class="form-control form-control-sm it-cant" type="number" step="0.01" value="${num(cant)}"></td>
    <td style="max-width:150px;"><input class="form-control form-control-sm it-precio" type="number" step="0.01" value="${num(precio)}"></td>
    <td class="it-subtotal fw-semibold">$0.00</td>
    <td class="text-end"><button class="btn btn-outline-danger btn-sm btn-del-row">✕</button></td>
  `;
}

function ligarEventosFilaEdit(tr){
  tr.querySelectorAll('.it-desc,.it-cant,.it-precio').forEach(inp => inp.addEventListener('input', recalcTotalEdit));
  tr.querySelector('.btn-del-row')?.addEventListener('click', ()=>{ tr.remove(); recalcTotalEdit(); });
}

function recalcTotalEdit(){
  const rows = Array.from(qsa('#tablaItemsEdit tbody tr'));
  let total = 0;
  rows.forEach(r=>{
    const cant = Number(r.querySelector('.it-cant')?.value) || 0;
    const precio = Number(r.querySelector('.it-precio')?.value) || 0;
    const sub = cant * precio;
    r.querySelector('.it-subtotal').textContent = fmt(sub);
    total += sub;
  });
  id('totalEdit').textContent = fmt(total);
}

function sumDetalle(det){ return det.reduce((acc,d)=> acc + (Number(d.subtotal)||((Number(d.cantidad)||0)*(Number(d.precio_unitario)||0))), 0); }

// ===== Pagos embebidos =====
async function abrirPagos(compraId){
  id('pagosCompraId').textContent = `#${compraId}`;
  id('pagoCompraIdHidden').value = compraId;
  id('pagoFecha').value = (new Date()).toISOString().slice(0,10);
  id('pagoTipo').value = '';
  id('pagoMonto').value = '';
  id('pagoObs').value = '';
  await cargarAbonos(compraId);
  modalPagos.show();
}

async function cargarAbonos(compraId){
  const res = await fetch(`/api/proveedores/compras/${compraId}/abonos`);
  if (!res.ok) return showErr('No se pudieron cargar los pagos');
  const data = await res.json();
  const tbody = qs('#tablaAbonos tbody');
  tbody.innerHTML = '';
  data.forEach((a,i)=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${i+1}</td><td>${a.fecha||''}</td><td>${fmt(a.monto)}</td><td>${a.tipo_pago||''}</td><td>${a.observaciones||''}</td>`;
    tbody.appendChild(tr);
  });
}

// ===== util =====
function fmt(n){ const num = Number(n)||0; return '$' + num.toFixed(2); }
function num(n){ return Number(n)||0; }
function id(s){ return document.getElementById(s); }
function qs(s){ return document.querySelector(s); }
function qsa(s){ return document.querySelectorAll(s); }
function esc(s){ return String(s||'').replace(/"/g,'&quot;'); }
function showOk(msg){ id('toastOkMsg').textContent = msg; toastOk.show(); }
function showErr(msg){ id('toastErrMsg').textContent = msg; toastErr.show(); }
