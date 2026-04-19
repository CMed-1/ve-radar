const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { nanoid } = require('nanoid');

const DB_PATH = path.join(__dirname, 've_radar.db');
const db = new sqlite3.Database(DB_PATH);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err); else resolve(this);
    });
  });
}
function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => { if (err) reject(err); else resolve(row); });
  });
}
function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => { if (err) reject(err); else resolve(rows); });
  });
}

async function initDB() {
  await run(`CREATE TABLE IF NOT EXISTS invite_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    used INTEGER DEFAULT 0,
    used_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    note TEXT
  )`);
  await run(`CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    contact TEXT NOT NULL,
    contact_type TEXT,
    rating TEXT,
    scores TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  console.log('数据库初始化完成');
}

async function generateCode(note = '') {
  const code = 'VE-' + nanoid(8).toUpperCase();
  await run('INSERT INTO invite_codes (code, note) VALUES (?, ?)', [code, note]);
  return code;
}

async function verifyCode(code) {
  const row = await get('SELECT * FROM invite_codes WHERE code = ?', [code.toUpperCase()]);
  if (!row) return { success: false, message: '邀请码无效' };
  if (row.used) return { success: false, message: '邀请码已使用' };
  await run('UPDATE invite_codes SET used = 1, used_at = datetime("now") WHERE code = ?', [code.toUpperCase()]);
  return { success: true, message: '验证成功' };
}

async function getAllCodes() {
  return all('SELECT * FROM invite_codes ORDER BY created_at DESC');
}

async function saveContact({ name, contact, contactType, rating, scores }) {
  await run(
    'INSERT INTO contacts (name, contact, contact_type, rating, scores) VALUES (?, ?, ?, ?, ?)',
    [name, contact, contactType, rating, JSON.stringify(scores)]
  );
}

async function getAllContacts() {
  return all('SELECT * FROM contacts ORDER BY created_at DESC');
}

module.exports = { initDB, generateCode, verifyCode, getAllCodes, saveContact, getAllContacts };
