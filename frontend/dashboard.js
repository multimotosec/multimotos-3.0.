document.addEventListener("DOMContentLoaded", () => {
  cargarTarjetasResumenCaja();
});

async function cargarTarjetasResumenCaja() {
  try {
    const res = await fetch("/api/caja/actual");
    const caja = await res.json();

    document.getElementById("fecha_caja").textContent = caja.fecha || "-";
    document.getElementById("hora_apertura").textContent = caja.hora_apertura || "-";
    document.getElementById("ingresos_efectivo").textContent = `$${(caja.ingresos_efectivo || 0).toFixed(2)}`;
    document.getElementById("ingresos_banco").textContent = `$${(caja.ingresos_banco || 0).toFixed(2)}`;
    document.getElementById("egresos").textContent = `$${(caja.egresos || 0).toFixed(2)}`;
    document.getElementById("total_calculado").textContent = `$${(caja.total_calculado || 0).toFixed(2)}`;
    document.getElementById("monto_real").textContent = `$${(caja.monto_real || 0).toFixed(2)}`;
    document.getElementById("descuadre").textContent = `$${(caja.descuadre || 0).toFixed(2)}`;
  } catch (error) {
    console.error("❌ Error al cargar resumen de caja en Dashboard:", error);
  }
}
