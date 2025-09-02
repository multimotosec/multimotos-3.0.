// backend/scripts/make-hash.js
const bcrypt = require('bcrypt');

const plain = process.argv[2];
if (!plain) {
  console.log('Uso: node backend/scripts/make-hash.js <clave-plain>');
  process.exit(1);
}

bcrypt.hash(plain, 10).then(h => {
  console.log('\nHash para la clave "' + plain + '":\n');
  console.log(h + '\n');
  console.log('Cópialo y pégalo en initDB.js en la constante hashTemporal.\n');
}).catch(e => {
  console.error('Error generando hash:', e.message);
  process.exit(1);
});
