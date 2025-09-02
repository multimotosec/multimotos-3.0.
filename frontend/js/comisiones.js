// frontend/js/comisiones.js
const $ = (id) => document.getElementById(id);
const fmt = (n) => `$${(Number(n||0)).toFixed(2)}`;

let cacheReg = [];     // registros MO pendientes (del cálculo)
let rubrosPend = [];   // rubros pendientes persistidos en BD para el mecánico seleccionado
let modal;

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
async function postJSON(url, data) {
  const res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
async function del(url) {
  const res = await fetch(url, { method:'DELETE' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function setTodayInputs() {
  const t = new Date().toISOString().slice(0,10);
  if (!$('desde').value) $('desde').value = t.slice(0,8) + '01';
  if (!$('hasta').value) $('hasta').value = t;
  if (!$('rFecha').value) $('rFecha').value = t;
}

async function cargarMecanicos() {
  const data = await getJSON('/api/comisiones/mecanicos');
  const sel = $('mecanico');
  sel.innerHTML = '<option value="">-- Selecciona --</option>';
  data.forEach(m=>{
    const op = document.createElement('option');
    op.value = m.id;
    op.textContent = `${m.nombre} (${Number(m.porcentaje_comision||0)}%)`;
    sel.appendChild(op);
  });
}

async function cargarRubrosPendientes() {
  const mecanico_id = parseInt($('mecanico').value||0,10);
  if (!mecanico_id) { rubrosPend = []; pintarRubros(); return; }
  rubrosPend = await getJSON(`/api/comisiones/pendientes-rubros?mecanico_id=${mecanico_id}`);
  pintarRubros();
}

function pintarRegistros() {
  const tb = $('tbodyRegistros');
  tb.innerHTML = '';
  cacheReg.forEach((r,i)=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${i+1}</td>
      <td>${r.fecha||''}</td>
      <td>${r.descripcion||''}</td>
      <td class="text-end">${fmt(r.base_monto)}</td>
      <td class="text-end">${Number(r.porcentaje_comision||0).toFixed(2)}</td>
      <td class="text-end">${fmt(r.comision_mo)}</td>
    `;
    tb.appendChild(tr);
  });
  actualizarTotales();
}

function pintarRubros() {
  const tb = $('tbodyRubros');
  tb.innerHTML = '';
  rubrosPend.forEach((r,i)=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="pill ${r.tipo==='INGRESO'?'ingreso':'descuento'}">${r.tipo}</span></td>
      <td>${r.concepto}</td>
      <td>${r.descripcion||''}</td>
      <td>${r.fecha}</td>
      <td class="text-end">${fmt(r.monto)}</td>
      <td class="text-end">
        <button class="btn btn-sm btn-link text-danger" data-id="${r.id}">Quitar</button>
      </td>
    `;
    tr.querySelector('button').addEventListener('click', async (e)=>{
      const id = e.currentTarget.getAttribute('data-id');
      try {
        await del(`/api/comisiones/pendientes-rubros/${id}`);
        await cargarRubrosPendientes();
      } catch(err){ alert('Error al quitar: '+(err.message||err)); }
    });
    tb.appendChild(tr);
  });
  actualizarTotales();
}

function actualizarTotales() {
  const tCom = cacheReg.reduce((a,x)=>a+(Number(x.comision_mo)||0),0);
  const tIng = rubrosPend.filter(r=>r.tipo==='INGRESO').reduce((a,x)=>a+(Number(x.monto)||0),0);
  const tDes = rubrosPend.filter(r=>r.tipo==='DESCUENTO').reduce((a,x)=>a+(Number(x.monto)||0),0);
  const tNeto = tCom + tIng - tDes;
  $('tCom').textContent = fmt(tCom);
  $('tIng').textContent = fmt(tIng);
  $('tDes').textContent = fmt(tDes);
  $('tNeto').textContent = fmt(tNeto);
}

async function calcular() {
  const mecanico_id = parseInt($('mecanico').value||0,10);
  const desde = $('desde').value;
  const hasta = $('hasta').value;
  if (!mecanico_id) { alert('Selecciona un mecánico'); return; }
  if (!desde || !hasta) { alert('Selecciona rango de fechas'); return; }
  cacheReg = await getJSON(`/api/comisiones/pendientes?mecanico_id=${mecanico_id}&desde=${desde}&hasta=${hasta}`);
  pintarRegistros();
}

async function agregarRubro() {
  const mecanico_id = parseInt($('mecanico').value||0,10);
  if (!mecanico_id) { alert('Primero selecciona un mecánico'); return; }
  const tipo = $('rTipo').value;
  const concepto = $('rConcepto').value;
  const descripcion = $('rDescripcion').value;
  const fecha = $('rFecha').value;
  const monto = Number($('rMonto').value||0);
  if (monto<=0) { alert('Monto debe ser mayor a 0'); return; }
  try {
    await postJSON('/api/comisiones/pendientes-rubros', { mecanico_id, tipo, concepto, descripcion, monto, fecha });
    $('rMonto').value = '';
    $('rDescripcion').value = '';
    await cargarRubrosPendientes();
  } catch(e){ alert('Error al agregar: '+(e.message||e)); }
}

function abrirModalResumen() {
  const mecanicoTxt = $('mecanico').selectedOptions[0]?.textContent || '';
  const desde = $('desde').value;
  const hasta = $('hasta').value;

  const filasReg = cacheReg.map((r,i)=>`
    <tr>
      <td>${i+1}</td>
      <td>${r.fecha||''}</td>
      <td>${r.descripcion||''}</td>
      <td class="text-end">${fmt(r.base_monto)}</td>
      <td class="text-end">${Number(r.porcentaje_comision||0).toFixed(2)}</td>
      <td class="text-end">${fmt(r.comision_mo)}</td>
    </tr>
  `).join('');

  const filasRub = rubrosPend.map(r=>`
    <tr>
      <td><span class="pill ${r.tipo==='INGRESO'?'ingreso':'descuento'}">${r.tipo}</span></td>
      <td>${r.concepto}</td>
      <td>${r.descripcion||''}</td>
      <td>${r.fecha}</td>
      <td class="text-end">${fmt(r.monto)}</td>
    </tr>
  `).join('');

  $('modalContenido').innerHTML = `
    <div class="mb-2"><strong>Mecánico:</strong> ${mecanicoTxt}</div>
    <div class="mb-3"><strong>Rango:</strong> ${desde} a ${hasta}</div>
    <h6>Comisiones</h6>
    <div class="table-responsive" style="max-height:200px">
      <table class="table table-sm">
        <thead><tr><th>#</th><th>Fecha</th><th>Descripción</th><th class="text-end">Base</th><th class="text-end">%</th><th class="text-end">Comisión</th></tr></thead>
        <tbody>${filasReg || '<tr><td colspan="6">Sin registros</td></tr>'}</tbody>
      </table>
    </div>
    <h6 class="mt-3">Rubros pendientes</h6>
    <div class="table-responsive" style="max-height:200px">
      <table class="table table-sm">
        <thead><tr><th>Tipo</th><th>Concepto</th><th>Descripción</th><th>Fecha</th><th class="text-end">Monto</th></tr></thead>
        <tbody>${filasRub || '<tr><td colspan="5">Sin rubros</td></tr>'}</tbody>
      </table>
    </div>
    <div class="row mt-3">
      <div class="col-md-3"><strong>Comisiones:</strong> ${$('tCom').textContent}</div>
      <div class="col-md-3"><strong>Ingresos:</strong> ${$('tIng').textContent}</div>
      <div class="col-md-3"><strong>Descuentos:</strong> ${$('tDes').textContent}</div>
      <div class="col-md-3"><strong>Neto:</strong> ${$('tNeto').textContent}</div>
    </div>
    <div class="mt-2">
      <strong>Observaciones:</strong>
      <div>${($('observaciones').value||'').replace(/</g,'&lt;')}</div>
    </div>
  `;
  modal.show();
}

async function confirmarLiquidacion() {
  try {
    const mecanico_id = parseInt($('mecanico').value||0,10);
    const desde = $('desde').value;
    const hasta = $('hasta').value;
    if (!mecanico_id) { alert('Selecciona un mecánico'); return; }
    if (cacheReg.length===0) { alert('No hay comisiones de M/O para liquidar'); return; }

    const registros = cacheReg.map(r=>r.registro_detalle_id);
    const observaciones = $('observaciones').value;

    const resp = await postJSON('/api/comisiones/generar', { mecanico_id, desde, hasta, registros, observaciones });
    modal.hide();
    alert(`Liquidación #${resp.liquidacion_id} generada correctamente.`);
    // reset
    cacheReg = [];
    $('observaciones').value = '';
    await cargarRubrosPendientes(); // ya estarán borrados porque se consumieron
    pintarRegistros();
    await cargarHistorial();
  } catch(e){ alert('Error: '+(e.message||e)); }
}

async function cargarHistorial() {
  const data = await getJSON('/api/comisiones/liquidaciones');
  const tb = $('tbodyHistorial');
  tb.innerHTML = '';
  data.forEach(liq=>{
    const tr = document.createElement('tr');
    tr.style.cursor='pointer';
    tr.innerHTML = `
      <td>${liq.id}</td>
      <td>${liq.fecha_liquidacion||''}</td>
      <td>${liq.mecanico||''}</td>
      <td>${liq.fecha_inicio||''}</td>
      <td>${liq.fecha_fin||''}</td>
      <td class="text-end">${fmt(liq.total_comisiones)}</td>
      <td class="text-end">${fmt(liq.total_ingresos)}</td>
      <td class="text-end">${fmt(liq.total_descuentos)}</td>
      <td class="text-end">${fmt(liq.total_neto)}</td>
    `;
    tr.addEventListener('click', async ()=>{
      const det = await getJSON(`/api/comisiones/liquidaciones/${liq.id}`);
      const filasReg = det.detalle.map((r,i)=>`
        <tr>
          <td>${i+1}</td>
          <td>${r.fecha||''}</td>
          <td>${r.descripcion||''}</td>
          <td class="text-end">${fmt(r.base_monto)}</td>
          <td class="text-end">${Number(r.porcentaje_comision||0).toFixed(2)}</td>
          <td class="text-end">${fmt(r.comision_monto)}</td>
        </tr>
      `).join('');
      const filasRub = det.rubros.map(r=>`
        <tr>
          <td><span class="pill ${r.tipo==='INGRESO'?'ingreso':'descuento'}">${r.tipo}</span></td>
          <td>${r.concepto}</td>
          <td>${r.descripcion||''}</td>
          <td>${r.fecha}</td>
          <td class="text-end">${fmt(r.monto)}</td>
        </tr>
      `).join('');
      $('modalContenido').innerHTML = `
        <div class="mb-2"><strong>Mecánico:</strong> ${det.cabecera.mecanico}</div>
        <div class="mb-3"><strong>Rango:</strong> ${det.cabecera.fecha_inicio} a ${det.cabecera.fecha_fin}</div>
        <h6>Comisiones</h6>
        <div class="table-responsive" style="max-height:200px">
          <table class="table table-sm">
            <thead><tr><th>#</th><th>Fecha</th><th>Descripción</th><th class="text-end">Base</th><th class="text-end">%</th><th class="text-end">Comisión</th></tr></thead>
            <tbody>${filasReg || '<tr><td colspan="6">Sin registros</td></tr>'}</tbody>
          </table>
        </div>
        <h6 class="mt-3">Rubros</h6>
        <div class="table-responsive" style="max-height:200px">
          <table class="table table-sm">
            <thead><tr><th>Tipo</th><th>Concepto</th><th>Descripción</th><th>Fecha</th><th class="text-end">Monto</th></tr></thead>
            <tbody>${filasRub || '<tr><td colspan="5">Sin rubros</td></tr>'}</tbody>
          </table>
        </div>
        <div class="row mt-3">
          <div class="col-md-3"><strong>Comisiones:</strong> ${fmt(det.cabecera.total_comisiones)}</div>
          <div class="col-md-3"><strong>Ingresos:</strong> ${fmt(det.cabecera.total_ingresos)}</div>
          <div class="col-md-3"><strong>Descuentos:</strong> ${fmt(det.cabecera.total_descuentos)}</div>
          <div class="col-md-3"><strong>Neto:</strong> ${fmt(det.cabecera.total_neto)}</div>
        </div>
        <div class="mt-2"><strong>Observaciones:</strong><div>${(det.cabecera.observaciones||'').replace(/</g,'&lt;')}</div></div>
      `;
      modal.show();
    });
    tb.appendChild(tr);
  });
}

function wireEvents() {
  $('btnCalcular').addEventListener('click', calcular);
  $('btnAgregarRubro').addEventListener('click', agregarRubro);
  $('btnGenerar').addEventListener('click', ()=>{
    if (cacheReg.length===0) { alert('Primero calcula comisiones pendientes'); return; }
    abrirModalResumen();
  });
  $('mecanico').addEventListener('change', async ()=>{
    await cargarRubrosPendientes();
    // (opcional) puedes recalcular automático si ya hay fechas
    // if ($('desde').value && $('hasta').value) await calcular();
  });
  $('btnConfirmar').addEventListener('click', confirmarLiquidacion);
}

document.addEventListener('DOMContentLoaded', async ()=>{
  setTodayInputs();
  await cargarMecanicos();
  await cargarHistorial();
  modal = new bootstrap.Modal(document.getElementById('modalResumen'));
  wireEvents();
  pintarRegistros();
  await cargarRubrosPendientes(); // por si ya venía un mecánico seleccionado
});
