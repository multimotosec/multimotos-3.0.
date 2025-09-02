// frontend/js/proveedores.js
(() => {
  const $  = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const fmt = (n) => Number(n||0).toLocaleString('es-EC',{style:'currency', currency:'USD'});
  const today = () => {
    const d = new Date(); return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);
  };

  // --- API helpers ---
  async function getJSON(url){ const r=await fetch(url); if(!r.ok) throw new Error(await r.text()); return r.json(); }
  async function postJSON(url, body){ const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); if(!r.ok) throw new Error(await r.text()); return r.json(); }

  // --- Estado ---
  let proveedores = [];
  let compras = [];
  let ventasCache = [];

  // --- Modales básicos ---
  function abrirModal(id){ const m = $('#'+id); if(m){ m.style.display='block'; } }
  function cerrarModal(id){ const m = $('#'+id); if(m){ m.style.display='none'; } }
  window.cerrarModal = cerrarModal;

  // --- INIT ---
  document.addEventListener('DOMContentLoaded', () => {
    // Botones cabecera
    $('#btnNuevoProv')?.addEventListener('click', ()=> abrirModal('modalProv'));
    $('#btnNuevaCompra')?.addEventListener('click', abrirModalCompra);
    $('#btnImportar')?.addEventListener('click', ()=> abrirModal('modalImportar'));
    $('#btnCruzarVentas')?.addEventListener('click', abrirModalCruce);

    // Proveedor
    $('#btnGuardarProv')?.addEventListener('click', guardarProveedor);
    // Compra
    $('#btnAddItem')?.addEventListener('click', addItemDetalle);
    $('#btnGuardarCompra')?.addEventListener('click', guardarCompra);
    // Compras filtros
    $('#btnFiltrar')?.addEventListener('click', cargarCompras);

    // Importar (dejamos tus endpoints ya existentes)
    $('#btnBuscarImportables')?.addEventListener('click', buscarImportables);
    $('#btnImportarSel')?.addEventListener('click', importarSeleccionados);

    // Cruce
    $('#btnBuscarVentas')?.addEventListener('click', buscarVentas);
    $('#btnPrepararCruce')?.addEventListener('click', prepararCruce);
    $('#btnGuardarCruce') && ($('#btnGuardarCruce').onclick = guardarCruce);

    // Filtro en tiempo real (descripción) dentro del modal de ventas
    $('#vFiltroDesc')?.addEventListener('input', renderVentasFiltradas);

    // Defaults de fechas
    $('#fDesde') && ($('#fDesde').value = today().slice(0,8)+'01');
    $('#fHasta') && ($('#fHasta').value = today());
    $('#iDesde') && ($('#iDesde').value = today().slice(0,8)+'01');
    $('#iHasta') && ($('#iHasta').value = today());
    $('#vDesde') && ($('#vDesde').value = today().slice(0,8)+'01');
    $('#vHasta') && ($('#vHasta').value = today());

    cargarProveedores();
    cargarCompras();
  });

  // -------- Proveedores --------
  async function cargarProveedores(){
    proveedores = await getJSON('/api/proveedores/proveedores');
    // tabla
    const tb = $('#tbProveedores');
    if (tb){
      tb.innerHTML = '';
      const filtro = ($('#filtroNombre')?.value||'').toLowerCase();
      (proveedores||[]).filter(p => !filtro || (p.nombre||'').toLowerCase().includes(filtro)).forEach(p=>{
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${p.nombre}</td>
          <td>${p.ruc||'-'}</td>
          <td>${p.telefono||'-'}</td>
          <td>${p.facturas_abiertas||0}</td>
          <td class="right">${fmt(p.saldo_total||0)}</td>
          <td class="right"><button class="btn outline btnVerCompras" data-id="${p.id}">Ver</button></td>
        `;
        tb.appendChild(tr);
      });
      $$('.btnVerCompras').forEach(b=>b.addEventListener('click', (e)=>{
        const id = e.currentTarget.getAttribute('data-id');
        $('#selProv').value = id;
        cargarCompras();
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      }));
      $('#filtroNombre')?.addEventListener('input', cargarProveedores, { once:true });
    }
    // selects
    const selProv = $('#selProv'), cProv = $('#cProv'), xProv = $('#xProv');
    if (selProv){ selProv.innerHTML = `<option value="">Todos</option>${proveedores.map(p=>`<option value="${p.id}">${p.nombre}</option>`).join('')}`; }
    if (cProv){   cProv.innerHTML   = `<option value="">-- Selecciona --</option>${proveedores.map(p=>`<option value="${p.id}">${p.nombre}</option>`).join('')}`; }
    if (xProv){   xProv.innerHTML   = `<option value="">-- Selecciona --</option>${proveedores.map(p=>`<option value="${p.id}">${p.nombre}</option>`).join('')}`; }
  }

  async function guardarProveedor(){
    const body = {
      nombre: $('#provNombre').value.trim(),
      ruc: $('#provRuc').value.trim(),
      telefono: $('#provTel').value.trim(),
      email: $('#provEmail').value.trim(),
      direccion: $('#provDir').value.trim(),
      observaciones: $('#provObs').value.trim()
    };
    if (!body.nombre){ alert('El nombre es obligatorio'); return; }
    try{
      await postJSON('/api/proveedores/proveedores', body);
      ['provNombre','provRuc','provTel','provEmail','provDir','provObs'].forEach(id=>{ const el=$('#'+id); if(el) el.value=''; });
      cerrarModal('modalProv');
      await cargarProveedores();
    }catch(e){
      let msg = 'No se pudo guardar.';
      try{ msg = JSON.parse(e.message)?.error || msg; }catch(_){}
      alert(msg);
    }
  }

  // -------- Compras --------
  function addItemDetalle(desc='', cant=1, pu=0){
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input class="input it-desc" value="${desc}"></td>
      <td class="right"><input type="number" step="0.01" class="input it-cant" value="${cant}"></td>
      <td class="right"><input type="number" step="0.01" class="input it-pu"   value="${pu}"></td>
      <td class="right"><span class="it-sub">$0.00</span></td>
      <td class="right"><button class="btn outline it-del">Quitar</button></td>
    `;
    const recalc = ()=>{
      const c = Number(tr.querySelector('.it-cant').value||0);
      const p = Number(tr.querySelector('.it-pu').value||0);
      tr.querySelector('.it-sub').textContent = fmt(c*p);
      setCompTotal();
    };
    tr.querySelector('.it-cant').addEventListener('input', recalc);
    tr.querySelector('.it-pu').addEventListener('input', recalc);
    tr.querySelector('.it-del').addEventListener('click', ()=>{ tr.remove(); setCompTotal(); });
    $('#tbDetalle').appendChild(tr);
    recalc();
  }

  function setCompTotal(){
    let tot=0;
    $$('#tbDetalle tr').forEach(tr=>{
      const c = Number(tr.querySelector('.it-cant').value||0);
      const p = Number(tr.querySelector('.it-pu').value||0);
      tot += c*p;
    });
    $('#compTotal').textContent = fmt(tot);
  }

  function abrirModalCompra(){
    $('#cProv').value = '';
    $('#cFecha').value = today();
    $('#cNum').value = '';
    $('#cFP').value = '';
    $('#cPago').value = '';
    $('#cObs').value = '';
    $('#tbDetalle').innerHTML = '';
    addItemDetalle();
    abrirModal('modalCompra');
  }

  async function guardarCompra(){
    const proveedor_id = Number($('#cProv').value||0);
    const fecha = $('#cFecha').value;
    if(!proveedor_id){ alert('Selecciona un proveedor'); return; }
    if(!fecha){ alert('Fecha requerida'); return; }

    const detalle = $$('#tbDetalle tr').map(tr => ({
      descripcion: tr.querySelector('.it-desc').value.trim(),
      cantidad: Number(tr.querySelector('.it-cant').value||0),
      costo_unitario: Number(tr.querySelector('.it-pu').value||0)
    })).filter(x=> x.descripcion && x.cantidad>0);

    if (detalle.length === 0){ alert('Agrega al menos un ítem'); return; }

    const body = {
      proveedor_id,
      fecha,
      num_factura: $('#cNum').value.trim() || null,
      observaciones: $('#cObs').value.trim() || null,
      detalle,
      pago_inicial: ($('#cFP').value && Number($('#cPago').value||0)>0)
        ? { monto: Number($('#cPago').value||0), forma_pago: $('#cFP').value, observaciones: 'Pago inicial' }
        : undefined
    };

    try{
      await postJSON('/api/proveedores/compras', body);
      cerrarModal('modalCompra');
      await cargarCompras();
      await cargarProveedores();
    }catch(e){
      alert('No se pudo guardar la compra. ' + (e.message||''));
    }
  }

  async function cargarCompras(){
    const qs = new URLSearchParams({
      proveedor_id: $('#selProv')?.value || '',
      estado: $('#selEstado')?.value || '',
      desde: $('#fDesde')?.value || '',
      hasta: $('#fHasta')?.value || ''
    });
    compras = await getJSON('/api/proveedores/compras?'+qs.toString());
    const tb = $('#tbCompras'); if(!tb) return;
    tb.innerHTML = '';
    compras.forEach(c=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${c.fecha}</td>
        <td>${c.proveedor}</td>
        <td>${c.num_factura || '-'}</td>
        <td>${c.observaciones || ''}</td>
        <td class="right">${fmt(c.total)}</td>
        <td class="right">${fmt(c.abonado)}</td>
        <td class="right"><strong>${fmt(c.saldo)}</strong></td>
        <td class="right"><button class="btn outline btnPago" data-id="${c.id}">Pagos</button></td>
      `;
      tb.appendChild(tr);
    });

    $$('.btnPago').forEach(b => b.addEventListener('click', (e)=>{
      const id = Number(e.currentTarget.getAttribute('data-id'));
      abrirModalPago(id);
    }));
  }

  // -------- Pagos --------
  function abrirModalPago(compra_id){
    $('#pFecha').value = today();
    $('#pMonto').value = '';
    $('#pFP').value = 'Pagado (Efectivo)';
    $('#pObs').value = '';

    $('#btnGuardarPago').onclick = async ()=>{
      const body = {
        fecha: $('#pFecha').value,
        monto: Number($('#pMonto').value||0),
        forma_pago: $('#pFP').value,
        observaciones: $('#pObs').value.trim()
      };
      if(!body.fecha || !body.monto){ alert('Fecha y monto son obligatorios'); return; }
      try{
        await postJSON(`/api/proveedores/compras/${compra_id}/pagos`, body);
        cerrarModal('modalPago');
        await cargarCompras();
        await cargarProveedores();
      }catch(_e){
        alert('No se pudo registrar el pago.');
      }
    };

    abrirModal('modalPago');
  }

  // -------- Importar (deja tus endpoints existentes) --------
  async function buscarImportables(){
    // Deja tu flujo actual; no se cambia lógica.
  }
  async function importarSeleccionados(){ /* idem */ }

  // -------- Cruce con ventas --------
  function abrirModalCruce(){
    $('#vDesde').value = $('#vDesde').value || (today().slice(0,8)+'01');
    $('#vHasta').value = $('#vHasta').value || today();
    $('#xFecha').value = today();
    $('#xNum').value = '';
    $('#xObs').value = '';
    $('#xProv').innerHTML = `<option value="">-- Selecciona --</option>${(proveedores||[]).map(p=>`<option value="${p.id}">${p.nombre}</option>`).join('')}`;
    $('#tbVentas').innerHTML = '';
    $('#tbCruce').innerHTML = '';
    $('#cruceTotal').textContent = fmt(0);
    // reset filtro descripción
    if ($('#vFiltroDesc')) $('#vFiltroDesc').value = '';
    abrirModal('modalCruzarVentas');
  }

  // Render auxiliar para aplicar filtro por descripción en memoria
  function renderVentasFiltradas(){
    const tb = $('#tbVentas'); if (!tb) return;
    tb.innerHTML = '';
    const term = ($('#vFiltroDesc')?.value || '').trim().toLowerCase();
    ventasCache
      .filter(v => !term || String(v.descripcion||'').toLowerCase().includes(term))
      .forEach(v=>{
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><input type="checkbox" class="ven-check" data-id="${v.registro_detalle_id}"></td>
          <td>${v.fecha}</td>
          <td>${v.descripcion||''}</td>
          <td class="right">${v.cantidad||1}</td>
          <td class="right">${fmt(v.precio_publico||0)}</td>
        `;
        tb.appendChild(tr);
      });
  }

  async function buscarVentas(){
    const d = $('#vDesde').value, h = $('#vHasta').value;
    const desc = ($('#vFiltroDesc')?.value || '').trim();
    if(!d || !h){ alert('Selecciona rango'); return; }
    const qs = new URLSearchParams({ desde: d, hasta: h });
    if (desc) qs.set('desc', desc);
    ventasCache = await getJSON(`/api/proveedores/ventas?${qs.toString()}`);
    renderVentasFiltradas();
  }

  function prepararCruce(){
    const marcadas = $$('.ven-check:checked').map(chk=>{
      const id = Number(chk.getAttribute('data-id'));
      return ventasCache.find(v=>v.registro_detalle_id===id);
    }).filter(Boolean);

    if(marcadas.length===0){ alert('Marca al menos una venta'); return; }

    const tb = $('#tbCruce'); tb.innerHTML = '';
    marcadas.forEach(v=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${v.fecha}</td>
        <td><input class="input cv-desc" value="${(v.descripcion||'').replaceAll('"','&quot;')}"></td>
        <td class="right"><input type="number" step="0.01" class="input cv-cant"  value="${v.cantidad||1}"></td>
        <td class="right"><input type="number" step="0.01" class="input cv-costo" value="0"></td>
        <td class="right"><span class="cv-sub">$0.00</span></td>
        <td style="display:none"><span class="cv-id">${v.registro_detalle_id}</span></td>
      `;
      const recalc = ()=>{
        const c = Number(tr.querySelector('.cv-cant').value||0);
        const u = Number(tr.querySelector('.cv-costo').value||0);
        tr.querySelector('.cv-sub').textContent = fmt(c*u);
        recalcTotalCruce();
      };
      tr.querySelector('.cv-cant').addEventListener('input', recalc);
      tr.querySelector('.cv-costo').addEventListener('input', recalc);
      $('#tbCruce').appendChild(tr);
      recalc();
    });
    recalcTotalCruce();
  }

  function recalcTotalCruce(){
    let t=0;
    $$('#tbCruce tr').forEach(tr=>{
      const c = Number(tr.querySelector('.cv-cant').value||0);
      const u = Number(tr.querySelector('.cv-costo').value||0);
      t += c*u;
    });
    $('#cruceTotal').textContent = fmt(t);
  }

  async function guardarCruce(){
    const proveedor_id = Number($('#xProv').value||0);
    const fecha = $('#xFecha').value;
    if(!proveedor_id){ alert('Selecciona proveedor'); return; }
    if(!fecha){ alert('Fecha requerida'); return; }

    const items = $$('#tbCruce tr').map(tr=>({
      registro_detalle_id: Number(tr.querySelector('.cv-id')?.textContent||0),
      descripcion: (tr.querySelector('.cv-desc')?.value||'').trim(),
      cantidad: Number(tr.querySelector('.cv-cant')?.value||0),
      costo_unitario: Number(tr.querySelector('.cv-costo')?.value||0)
    })).filter(x=> x.descripcion && x.cantidad>0);

    if(items.length===0){ alert('No hay ítems válidos'); return; }

    const body = {
      proveedor_id,
      fecha,
      num_factura: $('#xNum').value.trim(),
      observaciones: $('#xObs').value.trim(),
      items
    };

    try{
      await postJSON('/api/proveedores/cruce', body);
      cerrarModal('modalCruzarVentas');
      await cargarCompras();
      await cargarProveedores();
      alert('Cruce creado como COMPRA.');
    }catch(e){
      // Mostramos mensaje crudo para depurar (incluye "database is locked" si ocurriera)
      alert('No se pudo guardar el cruce. ' + (e.message||''));
    }
  }

})();
