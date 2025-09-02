// frontend/js/caja.js
(function () {
  // ===== Utilidades =====
  const $  = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const fmt = (n) =>
    Number(n || 0).toLocaleString('es-EC', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    });
  const today = () => {
    const d = new Date();
    const tzOff = d.getTimezoneOffset() * 60000;
    return new Date(Date.now() - tzOff).toISOString().slice(0, 10);
  };

  // ===== Elementos =====
  const inFechaApertura = $('#fecha_apertura');
  const inMontoApertura = $('#monto_apertura');
  const inMontoFisico   = $('#monto_fisico');
  const inObs           = $('#observaciones');

  const btnAperturar = $('#btn_aperturar');
  const btnCerrar    = $('#btn_cerrar');

  const spInicial = $('#r_monto_inicial');
  const spEfec    = $('#r_ingresos_efectivo');
  const spBanco   = $('#r_ingresos_banco');
  const spCxC     = $('#r_cuentas_cobrar');
  const spGastos  = $('#r_gastos');
  const spTotal   = $('#r_total');

  const tbHistorial = $('#tabla_historial');

  // Cache del total calculado del día (para comparar en cierre)
  let totalCalculadoCache = 0;

  // ===== Networking =====
  async function getJSON(url) {
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }
  async function postJSON(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  // ===== UI Helpers =====
  function setLoading(button, loading) {
    if (!button) return;
    if (loading) {
      button.disabled = true;
      button.dataset._txt = button.textContent;
      button.textContent = 'Procesando...';
    } else {
      button.disabled = false;
      if (button.dataset._txt) button.textContent = button.dataset._txt;
    }
  }

  function pintarResumen(data) {
    spInicial.textContent = fmt(data.monto_inicial);
    spEfec.textContent    = fmt(data.ingresos_efectivo);
    spBanco.textContent   = fmt(data.ingresos_banco);
    spCxC.textContent     = fmt(data.cuentas_cobrar);
    spGastos.textContent  = fmt(data.gastos);
    spTotal.textContent   = fmt(data.total_calculado);
    totalCalculadoCache   = Number(data.total_calculado || 0);
  }

  // --- Util para clasificar gastos (Gasto / Salida / Egreso)
  function esGasto(tipoTransaccion) {
    const t = String(tipoTransaccion || '').trim().toLowerCase();
    return t === 'gasto' || t === 'salida' || t === 'egreso';
  }

  async function calcularIngGastPorFecha(fecha) {
    // Usa /api/caja/movimientos?fecha=YYYY-MM-DD
    try {
      const movs = await getJSON(`/api/caja/movimientos?fecha=${encodeURIComponent(fecha)}`);
      let ingreso = 0;
      let gasto   = 0;
      for (const m of movs) {
        const val = Number(m?.monto || 0);
        if (esGasto(m?.tipo_transaccion)) gasto += val;
        else ingreso += val; // todo lo que no es gasto, lo consideramos ingreso del día
      }
      return { ingreso, gasto };
    } catch (e) {
      console.error('Error calculando ingresos/gastos para', fecha, e);
      return { ingreso: 0, gasto: 0 };
    }
  }

  async function pintarHistorial(rows) {
    tbHistorial.innerHTML = '';

    for (const r of rows) {
      const tr = document.createElement('tr');
      // Placeholder mientras calculamos totales
      tr.innerHTML = `
        <td>${r.fecha || ''}</td>
        <td class="text-end">${fmt(r.monto_inicial)}</td>
        <td class="text-end">—</td><!-- Total ingreso -->
        <td class="text-end">—</td><!-- Total gasto -->
        <td class="text-end">${r.monto_final != null ? fmt(r.monto_final) : '-'}</td>
        <td>${r.observaciones ? r.observaciones : ''}</td>
      `;
      tbHistorial.appendChild(tr);

      // Calcular totales por fecha (asíncrono) y actualizar celdas
      const { ingreso, gasto } = await calcularIngGastPorFecha(r.fecha);
      const tds = tr.querySelectorAll('td');
      // Índices: 0 fecha, 1 inicial, 2 ingreso, 3 gasto, 4 final, 5 obs
      if (tds[2]) tds[2].textContent = fmt(ingreso);
      if (tds[3]) tds[3].textContent = fmt(gasto);
    }
  }

  // ===== Lógica =====
  async function cargarResumen() {
    const fecha = inFechaApertura?.value || today();
    try {
      const data = await getJSON(`/api/caja/resumen?fecha=${encodeURIComponent(fecha)}`);
      pintarResumen(data);
    } catch (e) {
      console.error('Resumen error:', e);
      alert('No fue posible cargar el resumen. Revisa la consola.');
      // Mantener UI estable (no romper)
      pintarResumen({
        monto_inicial: 0, ingresos_efectivo: 0, ingresos_banco: 0,
        cuentas_cobrar: 0, gastos: 0, total_calculado: 0
      });
    }
  }

  async function cargarHistorial() {
    try {
      const rows = await getJSON('/api/caja/historial');
      await pintarHistorial(rows);
    } catch (e) {
      console.error('Historial error:', e);
      alert('No fue posible cargar el historial. Revisa la consola.');
      tbHistorial.innerHTML = '';
    }
  }

  async function onAperturar() {
    const fecha = inFechaApertura?.value || today();
    const monto = Number(inMontoApertura?.value);

    if (!fecha) { alert('Selecciona la fecha de apertura.'); return; }
    if (Number.isNaN(monto)) { alert('Ingresa un monto inicial válido.'); return; }
    if (monto < 0) { alert('El monto inicial no puede ser negativo.'); return; }

    try {
      setLoading(btnAperturar, true);
      const resp = await postJSON('/api/caja/apertura', { fecha, monto_inicial: monto });
      alert(resp.mensaje || `Se ha aperturado la caja para la fecha ${fecha} con el valor ${fmt(monto)}.`);
      await cargarResumen();
      await cargarHistorial();
    } catch (e) {
      console.error('Apertura error:', e);
      let msg = 'No fue posible aperturar la caja.';
      try { msg = JSON.parse(e.message).error || msg; } catch (_) {}
      alert(msg);
    } finally {
      setLoading(btnAperturar, false);
    }
  }

  async function onCerrar() {
    const fecha = inFechaApertura?.value || today();
    const montoFisico = Number(inMontoFisico?.value);
    const obs = (inObs?.value || '').trim();

    if (!fecha) { alert('Selecciona la fecha.'); return; }
    if (Number.isNaN(montoFisico)) { alert('Ingresa un monto físico válido.'); return; }
    if (montoFisico < 0) { alert('El monto físico no puede ser negativo.'); return; }

    const diferencia = +(montoFisico - totalCalculadoCache).toFixed(2);
    if (diferencia !== 0 && !obs) {
      alert('Hay diferencia entre el monto físico y el calculado. Debes ingresar el motivo en Observaciones.');
      return;
    }

    try {
      setLoading(btnCerrar, true);
      const resp = await postJSON('/api/caja/cierre', {
        fecha,
        monto_fisico: montoFisico,
        observaciones: obs || null
      });

      const d = resp.detalle || {};
      alert(
        `Caja cerrada.\n\n` +
        `Monto digital: ${fmt(d.monto_digital)}\n` +
        `Monto físico: ${fmt(d.monto_fisico)}\n` +
        `Diferencia: ${fmt(d.diferencia)}\n` +
        `Motivo: ${d.motivo || '-'}`
      );

      // Refrescar vista
      inMontoFisico.value = '';
      inObs.value = '';
      await cargarResumen();
      await cargarHistorial();
    } catch (e) {
      console.error('Cierre error:', e);
      let msg = 'No fue posible cerrar la caja.';
      try { msg = JSON.parse(e.message).error || msg; } catch (_) {}
      alert(msg);
    } finally {
      setLoading(btnCerrar, false);
    }
  }

  // ===== Eventos / Inicialización =====
  function wire() {
    if (inFechaApertura && !inFechaApertura.value) inFechaApertura.value = today();

    btnAperturar?.addEventListener('click', onAperturar);
    btnCerrar?.addEventListener('click', onCerrar);

    // Al cambiar la fecha, refresca el resumen sin exigir reapertura
    inFechaApertura?.addEventListener('change', cargarResumen);
  }

  (async function init() {
    wire();
    await cargarResumen();
    await cargarHistorial();
  })();
})();
