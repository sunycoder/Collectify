const fs = require('node:fs'),
    path = require('node:path');
const { generateKeyPairSync, createPublicKey, sign } = require('node:crypto');
const { collectFiles } = require('../src/plugin-system/package');
const { payload, SIGNATURE_FILE } = require('../src/plugin-system/native-signature');
function signPlugin(directory, keyFile, keyId = 'collectify-official-v1') {
    const trustFile = path.resolve(__dirname, '../src/plugin-system/trusted-publishers.json');
    if (!fs.existsSync(keyFile)) {
        const keys = generateKeyPairSync('ed25519', {
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
        });
        fs.mkdirSync(path.dirname(keyFile), { recursive: true });
        fs.writeFileSync(keyFile, keys.privateKey, { mode: 0o600 });
    }
    const privateKey = fs.readFileSync(keyFile),
        publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
    const trusted = JSON.parse(fs.readFileSync(trustFile, 'utf8'));
    if (trusted[keyId] && trusted[keyId] !== publicKey) throw Error('发布者 ID 已绑定其他公钥，请使用原私钥或新 ID');
    const files = collectFiles(directory, { signing: true });
    const signature = { keyId, value: sign(null, payload(files), privateKey).toString('base64') };
    fs.writeFileSync(trustFile, JSON.stringify({ ...trusted, [keyId]: publicKey }, null, 2) + '\n', 'utf8');
    fs.writeFileSync(path.join(directory, SIGNATURE_FILE), JSON.stringify(signature, null, 2) + '\n', 'utf8');
    return signature;
}
if (require.main === module)
    try {
        signPlugin(
            path.resolve(process.argv[2]),
            path.resolve(process.argv[3] || 'build-tools/publisher/collectify-ed25519.pem')
        );
        console.log('原生插件签名完成；私钥仅在本机，不写入插件包或仓库。');
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
module.exports = { signPlugin };
