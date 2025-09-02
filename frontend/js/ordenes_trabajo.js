// frontend/js/ordenes_trabajo.js

let ordenActual = null;
let mecanicos = [];

document.addEventListener('DOMContentLoaded', () => {
  cargarMecanicos();
  cargarOrdenes();
  actualizarContadores();

  const estadoEl = document.getElementById('orden-estado');
  if (estadoEl) {
    estadoEl.addEventListener('change', function () {
      if (this.value === 'finalizada' && ordenActual) {
        const ok = confirm(
          '¿Estás seguro de marcar esta orden como FINALIZADA?\n' +
          '- Se exportará al Registro Diario.\n' +
          '- Se calcularán comisiones de mano de obra.\n' +
          'Esta acción no se puede deshacer.'
        );
        if (!ok) this.value = ordenActual.estado;
      }
    });
  }
});

// Utils
function formatDate(dateStr){ if(!dateStr) return ''; return new Date(dateStr).toLocaleDateString('es-EC'); }
function formatEstado(s){ return ({en_curso:'En Curso', pausada:'Pausada', finalizada:'Finalizada', entregada:'Entregada'})[s]||s; }
function getItemEstadoColor(s){ return ({pendiente:'secondary', en_progreso:'warning', completado:'success'})[s]||'light'; }
function parseNumber(v, d=0){ const n=Number(v); return Number.isFinite(n)?n:d; }
function setValue(id,v,ro=false){ const el=document.getElementById(id); if(!el)return; el.value=v??''; if(ro) el.setAttribute('readonly','readonly'); }
function setText(id,t){ const el=document.getElementById(id); if(el) el.textContent=t??''; }
function setSelect(id,v){ const el=document.getElementById(id); if(el) el.value=v??''; }

// Base
function cargarMecanicos(){
  fetch('/api/mecanicos').then(r=>r.json()).then(data=>{
    mecanicos = Array.isArray(data)?data:[];
    const sel = document.getElementById('item-mecanico'); if(!sel) return;
    sel.innerHTML = '<option value="">Seleccionar...</option>';
    mecanicos.forEach(m=> sel.innerHTML += `<option value="${m.id}">${m.nombre}</option>`);
  }).catch(err=>console.error('Error cargando mecánicos:',err));
}

function cargarOrdenes(filtros={}){
  let url='/api/ordenes';
  const qs=new URLSearchParams(filtros).toString();
  if(qs) url+=`?${qs}`;
  fetch(url).then(r=>r.json()).then(data=>{
    const tbody=document.getElementById('tabla-ordenes'); if(!tbody) return;
    tbody.innerHTML='';
    if(!Array.isArray(data)||data.length===0){
      tbody.innerHTML=`<tr><td colspan="9" class="text-center py-4">No hay órdenes registradas</td></tr>`;
      actualizarContadores(); return;
    }
    data.forEach(o=>{
      const tot=parseNumber(o.total), abo=parseNumber(o.abonado);
      const totalItems=parseNumber(o.total_items,0), comp=parseNumber(o.completados,0);
      const progreso= totalItems>0 ? Math.round((comp/totalItems)*100) : 0;
      const tr=document.createElement('tr');
      tr.innerHTML=`
        <td>${o.id}</td>
        <td>${formatDate(o.fecha_creacion)}</td>
        <td>${o.cliente||''}</td>
        <td>${o.vehiculo||''}</td>
        <td class="text-end">$${tot.toFixed(2)}</td>
        <td class="text-end">$${(tot-abo).toFixed(2)}</td>
        <td><div class="progress"><div class="progress-bar" style="width:${progreso}%"></div></div></td>
        <td><span class="badge-estado badge-${o.estado}">${formatEstado(o.estado)}</span></td>
        <td class="text-center">
          <button class="btn btn-sm btn-outline-primary" onclick="verOrden(${o.id})" title="Ver / Editar">
            <i class="bi bi-eye"></i>
          </button>
        </td>`;
      tbody.appendChild(tr);
    });
    actualizarContadores();
  }).catch(err=>console.error('Error cargando órdenes:',err));
}

function actualizarContadores(){
  ['en_curso','pausada','finalizada','entregada'].forEach(e=>{
    fetch(`/api/ordenes?estado=${e}`).then(r=>r.json()).then(data=>{
      const el=document.getElementById(`cont-${e}`); if(el) el.textContent=Array.isArray(data)?data.length:0;
    }).catch(()=>{ const el=document.getElementById(`cont-${e}`); if(el) el.textContent='0'; });
  });
}

// Ver / cargar una OT
function verOrden(id){
  fetch(`/api/ordenes/${id}`).then(r=>r.json()).then(o=>{
    if(!o||o.error){ alert('No se pudo cargar la orden.'); return; }
    ordenActual=o;

    setValue('orden-id', o.id, true);
    setValue('orden-cliente', o.cliente, true);
    setValue('orden-contacto', o.contacto||'');
    setValue('orden-vehiculo', o.vehiculo, true);
    setValue('orden-placa', o.placa||'', true);
    setValue('orden-modelo', o.modelo||'');
    setValue('orden-kilometraje', o.kilometraje||'', true);
    setValue('orden-fecha-creacion', o.fecha_creacion, true);
    setValue('orden-fecha-entrega', o.fecha_entrega_estimada||'');
    setSelect('orden-estado', o.estado);
    setValue('orden-observaciones', o.observaciones||'');
    setValue('orden-observaciones-recepcion', o.observaciones_recepcion||'');

    const total=parseNumber(o.total), abonado=parseNumber(o.abonado), saldo=parseNumber(o.saldo);
    setText('orden-total', `$${total.toFixed(2)}`);
    setText('orden-abonado', `$${abonado.toFixed(2)}`);
    setText('orden-saldo', `$${saldo.toFixed(2)}`);

    document.getElementById('check-llaves').checked = parseNumber(o.llaves)===1;
    document.getElementById('check-matricula').checked = parseNumber(o.matricula)===1;
    document.getElementById('check-cascos').value = String(parseNumber(o.cascos,0));
    document.getElementById('check-gasolina').value = String(parseNumber(o.gasolina,0));

    cargarDetalleOrden(o.detalle);
    cargarAbonosOrden(o.abonos);

    new bootstrap.Modal(document.getElementById('modalOrden')).show();
  }).catch(err=>{ console.error('Error cargando orden:',err); alert('Error cargando la orden.'); });
}

function cargarDetalleOrden(det){
  const tbody=document.getElementById('detalle-orden'); if(!tbody) return;
  tbody.innerHTML='';
  if(!Array.isArray(det)||det.length===0){
    tbody.innerHTML=`<tr><td colspan="8" class="text-center py-3">No hay items registrados</td></tr>`; return;
  }
  det.forEach(it=>{
    const c=parseNumber(it.cantidad,0), p=parseNumber(it.precio_unitario,0), sub=c*p;
    const tr=document.createElement('tr');
    tr.innerHTML=`
      <td>${it.tipo==='trabajo' ? 'Trabajo' : 'Repuesto'}</td>
      <td>${it.descripcion||''}</td>
      <td>${c}</td>
      <td>$${p.toFixed(2)}</td>
      <td>$${sub.toFixed(2)}</td>
      <td>${it.mecanico_nombre||'-'}</td>
      <td><span class="badge bg-${getItemEstadoColor(it.estado)}">${({pendiente:'Pendiente',en_progreso:'En Progreso',completado:'Completado'})[it.estado]||it.estado}</span></td>
      <td class="text-center">
        <button class="btn btn-sm btn-outline-primary" title="Editar" onclick="editarItem(${it.id})"><i class="bi bi-pencil"></i></button>
      </td>`;
    tbody.appendChild(tr);
  });
}

function cargarAbonosOrden(abonos){
  const tbody=document.getElementById('abonos-orden'); if(!tbody) return;
  tbody.innerHTML='';
  if(!Array.isArray(abonos)||abonos.length===0){
    tbody.innerHTML=`<tr><td colspan="5" class="text-center py-3">No hay abonos registrados</td></tr>`; return;
    }
  abonos.forEach(a=>{
    const tr=document.createElement('tr');
    tr.innerHTML=`
      <td>${formatDate(a.fecha)}</td>
      <td>$${parseNumber(a.monto).toFixed(2)}</td>
      <td>${a.tipo_pago||'-'}</td>
      <td>${a.observaciones||'-'}</td>
      <td class="text-center">
        <button class="btn btn-sm btn-outline-danger" title="Eliminar" onclick="eliminarAbono(${a.id})"><i class="bi bi-trash"></i></button>
      </td>`;
    tbody.appendChild(tr);
  });
}

// Crear OT — Manual
function crearOrdenManual(){
  const form=document.getElementById('formNuevaOT');
  if(!form.checkValidity()){
    form.classList.add('was-validated');
    return;
  }
  const payload={
    cliente: document.getElementById('nvo-cliente').value.trim(),
    contacto: document.getElementById('nvo-contacto').value.trim() || null,
    vehiculo: document.getElementById('nvo-vehiculo').value.trim(),
    placa: document.getElementById('nvo-placa').value.trim() || null,
    modelo: document.getElementById('nvo-modelo').value.trim() || null,
    kilometraje: document.getElementById('nvo-km').value.trim() || null,
    fecha_entrega_estimada: document.getElementById('nvo-fecha-entrega').value || null,
    observaciones: document.getElementById('nvo-observaciones').value.trim() || null
  };

  fetch('/api/ordenes',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(payload)
  }).then(r=>r.json()).then(resp=>{
    if(resp && resp.success){
      bootstrap.Modal.getInstance(document.getElementById('modalNuevaOrden')).hide();
      cargarOrdenes(); // refresca lista
      verOrden(resp.ordenId); // abre la nueva
    }else{
      alert(resp.error || 'No se pudo crear la orden.');
    }
  }).catch(err=>{
    console.error('Error creando orden:',err);
    alert('Error creando la orden.');
  });
}

// Crear OT — Desde Proforma
function crearDesdeProforma(){
  const id = Number(document.getElementById('pf-id').value);
  if(!id){ alert('Ingrese un ID de proforma válido.'); return; }
  fetch('/api/ordenes/crear-desde-proforma',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ proformaId:id })
  }).then(r=>r.json()).then(resp=>{
    if(resp && resp.success){
      bootstrap.Modal.getInstance(document.getElementById('modalProforma')).hide();
      cargarOrdenes();
      verOrden(resp.ordenId);
    }else{
      alert(resp.error || 'No se pudo crear la OT desde la proforma.');
    }
  }).catch(err=>{
    console.error('Error creando desde proforma:',err);
    alert('Error creando desde proforma.');
  });
}

// CRUD Items
function agregarItemDetalle(){
  if(!ordenActual) return alert('Primero seleccione una orden.');
  document.getElementById('formItem').reset();
  setValue('item-orden-id', ordenActual.id);
  setValue('item-id','');
  new bootstrap.Modal(document.getElementById('modalItem')).show();
}
function editarItem(itemId){
  if(!ordenActual||!Array.isArray(ordenActual.detalle)) return;
  const it=ordenActual.detalle.find(i=>i.id==itemId); if(!it) return;
  setValue('item-orden-id', ordenActual.id);
  setValue('item-id', it.id);
  setSelect('item-tipo', it.tipo);
  setValue('item-descripcion', it.descripcion||'');
  setValue('item-cantidad', parseNumber(it.cantidad,1));
  setValue('item-precio', parseNumber(it.precio_unitario,0));
  setSelect('item-mecanico', it.mecanico_id||'');
  setSelect('item-estado', it.estado||'pendiente');
  new bootstrap.Modal(document.getElementById('modalItem')).show();
}
function guardarItem(){
  const form=document.getElementById('formItem'); if(!form) return;
  if(!form.checkValidity()){ form.classList.add('was-validated'); return; }
  const item={
    orden_id: document.getElementById('item-orden-id').value,
    id: document.getElementById('item-id').value,
    tipo: document.getElementById('item-tipo').value,
    descripcion: document.getElementById('item-descripcion').value.trim(),
    cantidad: parseNumber(document.getElementById('item-cantidad').value,1),
    precio_unitario: parseNumber(document.getElementById('item-precio').value,0),
    mecanico_id: document.getElementById('item-mecanico').value ? Number(document.getElementById('item-mecanico').value) : null,
    estado: document.getElementById('item-estado').value
  };
  const isUpdate=!!item.id;
  const url=isUpdate? `/api/ordenes/${item.orden_id}/detalle/${item.id}` : `/api/ordenes/${item.orden_id}/detalle`;
  const method=isUpdate? 'PUT':'POST';
  fetch(url,{ method, headers:{'Content-Type':'application/json'}, body:JSON.stringify(item) })
    .then(r=>r.json()).then(resp=>{
      if(resp&&resp.success){
        bootstrap.Modal.getInstance(document.getElementById('modalItem')).hide();
        verOrden(item.orden_id); cargarOrdenes();
      }else{ alert('No se pudo guardar el ítem.'); }
    }).catch(err=>{ console.error('Error guardando item:',err); alert('Error guardando el ítem.'); });
}

// Abonos
function registrarAbono(){
  if(!ordenActual) return alert('Primero seleccione una orden.');
  const form=document.getElementById('formAbono'); if(form) form.reset();
  setValue('abono-orden-id', ordenActual.id);
  setValue('abono-fecha', new Date().toISOString().split('T')[0]);
  new bootstrap.Modal(document.getElementById('modalAbono')).show();
}
function guardarAbono(){
  const form=document.getElementById('formAbono'); if(!form) return;
  if(!form.checkValidity()){ form.classList.add('was-validated'); return; }
  const abono={
    orden_id: document.getElementById('abono-orden-id').value,
    fecha: document.getElementById('abono-fecha').value,
    monto: parseNumber(document.getElementById('abono-monto').value,0),
    tipo_pago: document.getElementById('abono-tipo-pago').value,
    observaciones: document.getElementById('abono-observaciones').value.trim()
  };
  fetch(`/api/ordenes/${abono.orden_id}/abonos`,{
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(abono)
  }).then(r=>r.json()).then(resp=>{
    if(resp&&resp.success){
      bootstrap.Modal.getInstance(document.getElementById('modalAbono')).hide();
      verOrden(abono.orden_id); cargarOrdenes();
    }else{ alert('No se pudo registrar el abono.'); }
  }).catch(err=>{ console.error('Error guardando abono:',err); alert('Error guardando el abono.'); });
}
function eliminarAbono(abonoId){
  if(!ordenActual) return;
  if(!confirm('¿Eliminar este abono?')) return;
  fetch(`/api/ordenes/${ordenActual.id}/abonos/${abonoId}`,{method:'DELETE'})
    .then(r=>r.json()).then(resp=>{
      if(resp&&resp.success){ verOrden(ordenActual.id); cargarOrdenes(); }
      else{ alert('No se pudo eliminar el abono.'); }
    }).catch(err=>{ console.error('Error eliminando abono:',err); alert('Error eliminando el abono.'); });
}

// Guardar cambios de la orden
function guardarOrden(){
  if(!ordenActual) return;
  const payload={
    contacto: document.getElementById('orden-contacto').value.trim(),
    modelo: document.getElementById('orden-modelo').value.trim(),
    fecha_entrega_estimada: document.getElementById('orden-fecha-entrega').value || null,
    estado: document.getElementById('orden-estado').value,
    observaciones: document.getElementById('orden-observaciones').value.trim(),
    observaciones_recepcion: document.getElementById('orden-observaciones-recepcion').value.trim(),
    llaves: document.getElementById('check-llaves').checked ? 1 : 0,
    matricula: document.getElementById('check-matricula').checked ? 1 : 0,
    cascos: parseNumber(document.getElementById('check-cascos').value,0),
    gasolina: parseNumber(document.getElementById('check-gasolina').value,0)
  };
  fetch(`/api/ordenes/${ordenActual.id}`,{
    method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)
  }).then(r=>r.json()).then(resp=>{
    if(resp&&resp.success){ cargarOrdenes(); bootstrap.Modal.getInstance(document.getElementById('modalOrden')).hide(); }
    else{ alert('No se pudieron guardar los cambios de la orden.'); }
  }).catch(err=>{ console.error('Error guardando orden:',err); alert('Error guardando la orden.'); });
}

// Filtros
function aplicarFiltros(){
  const filtros={
    estado: document.getElementById('filtro-estado').value,
    desde: document.getElementById('filtro-desde').value,
    hasta: document.getElementById('filtro-hasta').value,
    cliente: document.getElementById('filtro-cliente').value.trim()
  };
  cargarOrdenes(filtros);
  const modal=bootstrap.Modal.getInstance(document.getElementById('modalFiltros')); if(modal) modal.hide();
}

// Exponer
window.verOrden=verOrden;
window.agregarItemDetalle=agregarItemDetalle;
window.editarItem=editarItem;
window.guardarItem=guardarItem;
window.registrarAbono=registrarAbono;
window.guardarAbono=guardarAbono;
window.eliminarAbono=eliminarAbono;
window.guardarOrden=guardarOrden;
window.aplicarFiltros=aplicarFiltros;
window.crearOrdenManual=crearOrdenManual;
window.crearDesdeProforma=crearDesdeProforma;
