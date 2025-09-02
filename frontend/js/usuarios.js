const API_BASE = '/api/usuarios';

function getToken() {
  return localStorage.getItem('token');
}

async function fetchUsuarios() {
  const res = await fetch(API_BASE, { headers: { 'Authorization': 'Bearer ' + getToken() } });
  if (!res.ok) {
    alert('No autorizado o error listando usuarios');
    if (res.status === 401) { localStorage.clear(); location.href='login.html'; }
    return [];
  }
  return await res.json();
}

function renderUsuarios(rows) {
  const tbody = document.querySelector('#tblUsuarios tbody');
  tbody.innerHTML = '';
  rows.forEach(u => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${u.id}</td>
      <td>${u.usuario}</td>
      <td>${u.nombre}</td>
      <td>${u.rol}</td>
      <td>${u.activo ? 'Sí' : 'No'}</td>
      <td>${u.creado_en || ''}</td>
      <td class="text-end">
        <button class="btn btn-sm btn-outline-primary me-1" onclick="toggleActivo(${u.id}, ${u.activo ? 0 : 1})">${u.activo ? 'Bloquear' : 'Activar'}</button>
        <button class="btn btn-sm btn-outline-warning me-1" onclick="resetPass(${u.id})">Reset Pass</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function cargar() {
  const data = await fetchUsuarios();
  renderUsuarios(data);
}

async function crearUsuario() {
  const msg = document.getElementById('nu_msg');
  msg.textContent = '';
  const payload = {
    usuario: document.getElementById('nu_usuario').value.trim(),
    nombre: document.getElementById('nu_nombre').value.trim(),
    rol: document.getElementById('nu_rol').value,
    password: document.getElementById('nu_password').value
  };
  if (!payload.usuario || !payload.nombre || !payload.password) {
    msg.textContent = 'Completa usuario, nombre y contraseña';
    return;
  }
  const res = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) {
    msg.textContent = data?.error || 'Error creando';
    return;
  }
  document.querySelector('#mdlNuevo .btn-secondary').click();
  await cargar();
}

async function toggleActivo(id, nuevoEstado) {
  const res = await fetch(`${API_BASE}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() },
    body: JSON.stringify({ activo: nuevoEstado })
  });
  if (!res.ok) { alert('Error actualizando'); return; }
  await cargar();
}

async function resetPass(id) {
  const np = prompt('Nueva contraseña:');
  if (!np) return;
  const res = await fetch(`${API_BASE}/${id}/password`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() },
    body: JSON.stringify({ password: np })
  });
  if (!res.ok) { alert('Error reseteando'); return; }
  alert('Contraseña actualizada.');
}

window.addEventListener('DOMContentLoaded', cargar);
