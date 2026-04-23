const jwt = require('jsonwebtoken');
const fs = require('fs');

// Настройки (проверьте, что имя файла совпадает!)
const TEAM_ID = 'T59BVP7L9H';
const KEY_ID = 'SZG247VG98';
const CLIENT_ID = 'com.zamkovoi.harmonizer.app.signin';
const KEY_PATH = './Apple_AuthKey_SZG247VG98.p8'; // Скрипт сам найдет этот файл в папке

try {
  const privateKey = fs.readFileSync(KEY_PATH);

  const token = jwt.sign({}, privateKey, {
    algorithm: 'ES256',
    expiresIn: '180d', // Токен будет жить 6 месяцев
    audience: 'https://appleid.apple.com',
    issuer: TEAM_ID,
    subject: CLIENT_ID,
    keyid: KEY_ID,
  });

  console.log('\n--- СКОПИРУЙТЕ СТРОКУ НИЖЕ (БЕЗ ПРОБЕЛОВ) --- \n');
  console.log(token); 
  console.log('\n--- КОНЕЦ ТОКЕНА ---');

} catch (err) {
  console.error('Ошибка: проверьте, что файл ключа лежит в той же папке, что и скрипт!');
  console.error(err.message);
}