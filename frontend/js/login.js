// frontend/js/login.js
const API = '/api/auth/login';

document.getElementById('btnLogin').addEventListener('click', async () => {
  const usuario = document.getElementById('usuario').value.trim();
  const password = document.getElementById('password').value;
  const msg = document.getElementById('msg');
  msg.textContent = '';

  if (!usuario || !password) {
    msg.textContent = 'Completa usuario y contraseña.';
    return;
  }

  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, password })
    });
    const data = await res.json();
    if (!res.ok) {
      msg.textContent = data?.error || 'No se pudo iniciar sesión';
      return;
    }
    localStorage.setItem('token', data.token);
    localStorage.setItem('usuario', JSON.stringify(data.usuario));
    window.location.href = 'index.html';
  } catch (e) {
    msg.textContent = 'Error de conexión';
  }
});
