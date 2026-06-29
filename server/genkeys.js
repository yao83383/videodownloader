const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const pubPem = publicKey.export({ type: 'spki', format: 'pem' });

fs.writeFileSync(path.join(__dirname, 'private.pem'), privPem);
fs.writeFileSync(path.join(__dirname, 'public.pem'), pubPem);

console.log('已生成 private.pem 和 public.pem。');
console.log('\n请把下面这段【公钥】整段复制，粘到客户端 src/license.ts 的 LICENSE_PUBLIC_KEY：\n');
console.log(pubPem);
