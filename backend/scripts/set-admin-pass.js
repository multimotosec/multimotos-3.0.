// backend/scripts/set-admin-pass.js
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');

const dbPath = path.join(__dirname, '../database/database.db');
const db = new sqlite3.Database(dbPath);

const nuevaClave = process.argv[2];
if (!nuevaClave) {
  console.log('Uso: node backend/scripts/set-admin-pass.js <nueva-clave>');
  process.exit(1);
}

(async () => {
  try {
    const hash = await bcrypt.hash(nuevaClave, 10);

    db.get(`SELECT id FROM usuarios WHERE usuario = ?`, ['admin'], (e, row) => {
      if (e) {
        console.error('Error leyendo usuarios:', e.message);
        process.exit(1);
      }
      if (!row) {
        // No existe admin: lo creamos
        db.run(
          `INSERT INTO usuarios (usuario, nombre, rol, hash_password, activo) VALUES (?, ?, ?, ?, 1)`,
          ['admin', 'Administrador', 'admin', hash],
          function (err) {
            if (err) {
              console.error('Error creando admin:', err.message);
              process.exit(1);
            }
            console.log('✔ Usuario admin creado con nueva clave.');
            process.exit(0);
          }
        );
      } else {
        // Existe: actualizamos contraseña
        db.run(
          `UPDATE usuarios SET hash_password = ? WHERE id = ?`,
          [hash, row.id],
          function (err2) {
            if (err2) {
              console.error('Error actualizando clave de admin:', err2.message);
              process.exit(1);
            }
            console.log('✔ Clave de admin actualizada correctamente.');
            process.exit(0);
          }
        );
      }
    });
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})();
