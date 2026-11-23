import readline from 'node:readline/promises';
import { emitKeypressEvents } from 'node:readline';
import { stdin, stdout } from 'node:process';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { hashPassword } from './passwords.js';

function hiddenPrompt(label) {
    stdout.write(label);
    emitKeypressEvents(stdin);
    stdin.setRawMode(true); stdin.resume();
    return new Promise((resolve, reject) => {
        let value = '';
        const finish = () => { stdin.off('keypress', onKey); stdin.setRawMode(false); stdin.pause(); stdout.write('\n'); };
        function onKey(text, key = {}) {
            if (key.ctrl && key.name === 'c') { finish(); reject(new Error('Cancelled.')); }
            else if (key.name === 'return' || key.name === 'enter') { finish(); resolve(value); }
            else if (key.name === 'backspace') value = [...value].slice(0, -1).join('');
            else if (text && !key.ctrl && !key.meta && !/[\r\n\x00-\x1f\x7f]/.test(text)) value += text;
        }
        stdin.on('keypress', onKey);
    });
}
loadConfig();
if (!stdin.isTTY) throw new Error('Run admin:create in an interactive terminal. Never pass passwords as command arguments.');
const prompt = readline.createInterface({ input: stdin, output: stdout });
const email = (await prompt.question('Administrator email: ')).trim().toLowerCase();
prompt.close();
if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
const password = await hiddenPrompt('Password (15–128 characters, hidden): ');
const confirmation = await hiddenPrompt('Confirm password (hidden): ');
if (password !== confirmation) throw new Error('Passwords do not match.');
const hash = await hashPassword(password);
const pool = createPool();
try {
    const db = await pool.getConnection();
    try {
        const [[lock]] = await db.query("SELECT GET_LOCK('everbright-first-admin', 10) AS acquired");
        if (lock.acquired !== 1) throw new Error('Setup already running.');
        const [[row]] = await db.query('SELECT COUNT(*) AS total FROM admin_users');
        if (Number(row.total) !== 0) throw new Error('An administrator already exists. Initial setup is closed.');
        await db.execute('INSERT INTO admin_users (email, password_hash) VALUES (?, ?)', [email, hash]);
        console.log('Administrator created. Sign in at /admin.');
    } finally { await db.query("SELECT RELEASE_LOCK('everbright-first-admin')"); db.release(); }
} catch { console.error('Administrator setup failed. Check migrations, database access, and whether setup is already complete.'); process.exitCode = 1; }
finally { await pool.end(); }
