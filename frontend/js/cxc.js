// frontend/js/cxc.js
const $ = (id) => document.getElementById(id);
const fmt = (n) => `$${(Number(n||0)).toFixed(2)}`;

let modalCxc;
let modalNueva;
let currentRows = []; // <- para imprimir/totalizar

async function getJSON(url){ const r=await fetch(url); if(!r.ok) throw new Error(await r.text()); return r.json(); }
async function postJSON(url, data){ const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}); if(!r.ok) throw new Error(await r.text()); return r.json(); }
async function del(url){ const r=await fetch(url,{method:'DELETE'}); if(!r.ok) throw new Error(await r.text()); return r.json(); }

function today(){ return new Date().toISOString().slice(0,10); }

function pintarTabla(rows){
  const tb = $('tb-cxc');
  tb.innerHTML = '';
  if(!Array.isArray(rows) || rows.length===0){
    tb.innerHTML = `<tr><td colspan="8" class="text-center py-3">Sin resultados</td></tr>`;
    // limpiar totales
    actualizarTotales([]);
    return;
  }
  rows.forEach(r=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.fecha||''}</td>
      <td>${r.cliente||''}</td>
      <td>${r.concepto||''}</td>
      <td class="text-end">${fmt(r.monto)}</td>
      <td class="text-end">${fmt(r.saldo)}</td>
      <td><span class="badge badge-estado badge-${r.estado}">${r.estado}</span></td>
      <td><span class="pill">${r.origen}</span></td>
      <td class="text-center"><button class="btn btn-sm btn-outline-primary">Ver</button></td>
    `;
    tr.querySelector('button').addEventListener('click', ()=> verCxc(r.id));
    tb.appendChild(tr);
  });

  actualizarTotales(rows);
}

function actualizarTotales(rows){
  currentRows = rows || [];
  const items = currentRows.length;
  const totalMonto = currentRows.reduce((a,b)=> a + Number(b.monto||0), 0);
  const totalSaldo = currentRows.reduce((a,b)=> a + Number(b.saldo||0), 0);
  if ($('t-items')) $('t-items').textContent = String(items);
  if ($('t-monto')) $('t-monto').textContent = fmt(totalMonto);
  if ($('t-saldo')) $('t-saldo').textContent = fmt(totalSaldo);
}

async function cargar(){
  const q = new URLSearchParams();
  const e = $('f-estado').value;
  const c = $('f-cliente').value.trim();
  const d = $('f-desde').value;
  const h = $('f-hasta').value;
  if(e) q.set('estado', e);
  if(c) q.set('cliente', c);
  if(d) q.set('desde', d);
  if(h) q.set('hasta', h);
  const data = await getJSON('/api/cxc' + (q.toString()?`?${q}`:''));
  pintarTabla(data);
}

async function verCxc(id){
  const data = await getJSON(`/api/cxc/${id}`);
  $('d-fecha').textContent = data.fecha||'';
  $('d-cliente').textContent = data.cliente||'';
  const badge = $('d-estado');
  badge.textContent = data.estado||'';
  badge.className = 'badge badge-estado badge-'+(data.estado||'Pendiente');
  $('d-concepto').textContent = data.concepto||'';
  $('d-monto').textContent = fmt(data.monto);
  $('d-obs').textContent = data.observaciones || '-';
  $('d-saldo').textContent = fmt(data.saldo);
  $('a-cxc-id').value = data.id;

  const tb = $('tb-abonos');
  tb.innerHTML = '';
  if(!Array.isArray(data.abonos) || data.abonos.length===0){
    tb.innerHTML = `<tr><td colspan="5" class="text-center py-2">Sin abonos</td></tr>`;
  } else {
    data.abonos.forEach(a=>{
      const tr=document.createElement('tr');
      tr.innerHTML = `
        <td>${a.fecha||''}</td>
        <td class="text-end">${fmt(a.monto)}</td>
        <td>${a.tipo_pago||'-'}</td>
        <td>${a.observaciones||'-'}</td>
        <td class="text-center">
          <button class="btn btn-sm btn-outline-danger" data-id="${a.id}">Borrar</button>
        </td>
      `;
      tr.querySelector('button').addEventListener('click', async (ev)=>{
        const abId = ev.currentTarget.getAttribute('data-id');
        if(!confirm('¿Eliminar este abono?')) return;
        try{
          await del(`/api/cxc/${data.id}/abonos/${abId}`);
          await verCxc(data.id);
          await cargar();
        }catch(e){ alert('Error: '+(e.message||e)); }
      });
      tb.appendChild(tr);
    });
  }

  modalCxc.show();
}

async function importar(){
  const desde = $('f-desde').value || null;
  const hasta = $('f-hasta').value || null;
  try{
    const resp = await postJSON('/api/cxc/importar', { desde, hasta });
    alert(`Importados: ${resp.importados}`);
    await cargar();
  }catch(e){
    alert('Error al importar: '+(e.message||e));
  }
}

function abrirNueva(){
  $('form-nueva').reset();
  $('n-fecha').value = today();
  modalNueva.show();
}

async function guardarNueva(ev){
  ev.preventDefault();
  const payload = {
    fecha: $('n-fecha').value,
    cliente: $('n-cliente').value.trim(),
    concepto: $('n-concepto').value.trim(),
    monto: Number($('n-monto').value||0),
    observaciones: $('n-obs').value.trim() || null
  };
  if(!payload.fecha || !payload.cliente || !payload.concepto || payload.monto<=0){
    alert('Completa los campos obligatorios y monto > 0'); return;
  }
  try{
    await postJSON('/api/cxc', payload);
    modalNueva.hide();
    await cargar();
  }catch(e){ alert('Error: '+(e.message||e)); }
}

async function guardarAbono(ev){
  ev.preventDefault();
  const id = $('a-cxc-id').value;
  const payload = {
    fecha: $('a-fecha').value,
    monto: Number($('a-monto').value||0),
    tipo_pago: $('a-tipo').value.trim(),
    observaciones: $('a-obs').value.trim()
  };
  if(!payload.fecha || payload.monto<=0){
    alert('Fecha y monto (>0) son obligatorios'); return;
  }
  try{
    await postJSON(`/api/cxc/${id}/abonos`, payload);
    $('form-abono').reset();
    $('a-fecha').value = today();
    await verCxc(id);
    await cargar();
  }catch(e){ alert('Error: '+(e.message||e)); }
}

/* =============================
   IMPRESIÓN
   ============================= */

// 1) Imprimir listado (usa los datos filtrados actuales)
function printListado(){
  const d = $('f-desde').value || '';
  const h = $('f-hasta').value || '';
  const c = $('f-cliente').value || '';
  const e = $('f-estado').value || '';

  const totalMonto = currentRows.reduce((a,b)=> a + Number(b.monto||0), 0);
  const totalSaldo = currentRows.reduce((a,b)=> a + Number(b.saldo||0), 0);

  const rowsHTML = currentRows.map(r=>`
    <tr>
      <td>${r.fecha||''}</td>
      <td>${r.cliente||''}</td>
      <td>${r.concepto||''}</td>
      <td class="num">${(Number(r.monto||0)).toFixed(2)}</td>
      <td class="num">${(Number(r.saldo||0)).toFixed(2)}</td>
      <td>${r.estado||''}</td>
      <td>${r.origen||''}</td>
    </tr>
  `).join('');

  const html = `
    <html>
      <head>
        <meta charset="utf-8">
        <title>Listado CxC - Multimotos</title>
        <style>
          body{ font-family: Arial, Helvetica, sans-serif; margin:24px; color:#0c204e; }
          h1{ margin:0 0 6px; }
          .sub{ color:#444; margin-bottom:16px; }
          .box{ border:1px solid #d1d5db; border-radius:10px; padding:12px; }
          table{ width:100%; border-collapse:collapse; }
          th,td{ border:1px solid #e5e7eb; padding:8px 10px; font-size:12px; }
          th{ background:#f3f4f6; text-align:left; }
          .num{ text-align:right; }
          .tot{ font-weight:bold; }
          .meta{ margin:10px 0 16px; font-size:12px; color:#333; }
          @media print{
            @page{ size: A4; margin: 14mm; }
            .no-print{ display:none !important; }
          }
        </style>
      </head>
      <body>
        <h1>Listado de Cuentas por Cobrar</h1>
        <div class="sub">Multimotos — Fecha: ${new Date().toLocaleString()}</div>
        <div class="meta box">
          <div><strong>Filtros:</strong>
            Desde: ${d||'-'} &nbsp; | &nbsp;
            Hasta: ${h||'-'} &nbsp; | &nbsp;
            Cliente: ${c||'Todos'} &nbsp; | &nbsp;
            Estado: ${e||'Todos'}
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Cliente</th>
              <th>Concepto</th>
              <th>Monto</th>
              <th>Saldo</th>
              <th>Estado</th>
              <th>Origen</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHTML || `<tr><td colspan="7" style="text-align:center;">Sin resultados</td></tr>`}
          </tbody>
          <tfoot>
            <tr class="tot">
              <td colspan="3">Totales</td>
              <td class="num">${totalMonto.toFixed(2)}</td>
              <td class="num">${totalSaldo.toFixed(2)}</td>
              <td colspan="2"></td>
            </tr>
          </tfoot>
        </table>
      </body>
    </html>
  `;
  const w = window.open('', '_blank');
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  w.print();
}

// 2) Estado de Cuenta por cliente (requiere tener cliente en el filtro)
async function printEstadoCuenta(){
  const cliente = ($('f-cliente').value || '').trim();
  if(!cliente){
    alert('Para generar el Estado de Cuenta, primero escribe un cliente en el filtro.');
    return;
  }

  // Filtrar registros del cliente actual
  const delCliente = currentRows.filter(r => (r.cliente||'').toLowerCase().includes(cliente.toLowerCase()));

  // Sumar abonos por CxC para mostrar columna "Abonos"
  // (sin cambiar backend, consultamos /api/cxc/:id y sumamos en frontend)
  const abonosSumados = [];
  for (const r of delCliente){
    try{
      const det = await getJSON(`/api/cxc/${r.id}`);
      const abSuma = Array.isArray(det.abonos) ? det.abonos.reduce((a,b)=> a + Number(b.monto||0), 0) : 0;
      abonosSumados.push({ ...r, abonos: abSuma });
    }catch{
      abonosSumados.push({ ...r, abonos: 0 });
    }
  }

  const totalMonto = abonosSumados.reduce((a,b)=> a + Number(b.monto||0), 0);
  const totalAbonos = abonosSumados.reduce((a,b)=> a + Number(b.abonos||0), 0);
  const totalSaldo = abonosSumados.reduce((a,b)=> a + Number(b.saldo||0), 0);

  const rowsHTML = abonosSumados.map(r=>`
    <tr>
      <td>${r.fecha||''}</td>
      <td>${r.concepto||''}</td>
      <td class="num">${(Number(r.monto||0)).toFixed(2)}</td>
      <td class="num">${(Number(r.abonos||0)).toFixed(2)}</td>
      <td class="num">${(Number(r.saldo||0)).toFixed(2)}</td>
      <td>${r.estado||''}</td>
    </tr>
  `).join('');

  const d = $('f-desde').value || '';
  const h = $('f-hasta').value || '';

  const html = `
    <html>
      <head>
        <meta charset="utf-8">
        <title>Estado de Cuenta - ${cliente}</title>
        <style>
          body{ font-family: Arial, Helvetica, sans-serif; margin:24px; color:#0c204e; }
          h1{ margin:0 0 2px; }
          .brand{ color:#102962; font-weight:800; }
          .sub{ color:#444; margin:0 0 14px; }
          .box{ border:1px solid #d1d5db; border-radius:10px; padding:12px; }
          .info{ display:flex; gap:20px; flex-wrap:wrap; margin:10px 0 16px; font-size:12px; }
          table{ width:100%; border-collapse:collapse; margin-top:8px; }
          th,td{ border:1px solid #e5e7eb; padding:8px 10px; font-size:12px; }
          th{ background:#f3f4f6; text-align:left; }
          .num{ text-align:right; }
          .tot{ font-weight:bold; }
          .foot{ margin-top:16px; font-size:12px; color:#333; }
          @media print{
            @page{ size: A4; margin: 14mm; }
          }
        </style>
      </head>
      <body>
        <h1>Estado de Cuenta</h1>
        <div class="sub"><span class="brand">Multimotos</span> — Emitido: ${new Date().toLocaleString()}</div>

        <div class="box">
          <div class="info">
            <div><strong>Cliente:</strong> ${cliente}</div>
            <div><strong>Periodo:</strong> ${d||'-'} a ${h||'-'}</div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Concepto</th>
                <th>Monto</th>
                <th>Abonos</th>
                <th>Saldo</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHTML || `<tr><td colspan="6" style="text-align:center;">Sin movimientos</td></tr>`}
            </tbody>
            <tfoot>
              <tr class="tot">
                <td colspan="2">Totales</td>
                <td class="num">${totalMonto.toFixed(2)}</td>
                <td class="num">${totalAbonos.toFixed(2)}</td>
                <td class="num">${totalSaldo.toFixed(2)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
          <div class="foot">* Documento informativo para cobro. Para cualquier duda, comuníquese con Multimotos.</div>
        </div>
      </body>
    </html>
  `;

  const w = window.open('', '_blank');
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  w.print();
}

function wire(){
  $('btn-filtrar').addEventListener('click', cargar);
  $('btn-importar').addEventListener('click', importar);
  $('btn-nuevo').addEventListener('click', abrirNueva);
  $('form-nueva').addEventListener('submit', guardarNueva);
  $('form-abono').addEventListener('submit', guardarAbono);

  // nuevos eventos
  $('btn-print').addEventListener('click', printListado);
  $('btn-edo-cta').addEventListener('click', printEstadoCuenta);
}

document.addEventListener('DOMContentLoaded', async ()=>{
  modalCxc = new bootstrap.Modal(document.getElementById('modalCxc'));
  modalNueva = new bootstrap.Modal(document.getElementById('modalNueva'));
  $('f-hasta').value = today();
  $('f-desde').value = today().slice(0,8)+'01';
  await cargar();
  wire();
});
