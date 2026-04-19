const Database = require('better-sqlite3');
const path = require('path');
const { nanoid } = require('nanoid');

const DB_PATH = path.join(__dirname, 've_radar.db');
const db = new Database(DB_PATH);

function initDB() {
  db.exec(`CREATE TABLE IF NOT EXISTS invite_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    used INTEGER DEFAULT 0,
    used_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    note TEXT
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS contacts (
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

function generateCode(note = '') {
  const code = 'VE-' + nanoid(8).toUpperCase();
  db.prepare('INSERT INTO invite_codes (code, note) VALUES (?, ?)').run(code, note);
  return code;
}

function verifyCode(code) {
  const row = db.prepare('SELECT * FROM invite_codes WHERE code = ?').get(code.toUpperCase());
  if (!row) return { success: false, message: '邀请码无效' };
  if (row.used) return { success: false, message: '邀请码已使用' };
  db.prepare('UPDATE invite_codes SET used = 1, used_at = datetime("now") WHERE code = ?').run(code.toUpperCase());
  return { success: true, message: '验证成功' };
}

function getAllCodes() {
  return db.prepare('SELECT * FROM invite_codes ORDER BY created_at DESC').all();
}

function saveContact({ name, contact, contactType, rating, scores }) {
  db.prepare(
    'INSERT INTO contacts (name, contact, contact_type, rating, scores) VALUES (?, ?, ?, ?, ?)'
  ).run(name, contact, contactType, rating, JSON.stringify(scores));
}

function getAllContacts() {
  return db.prepare('SELECT * FROM contacts ORDER BY created_at DESC').all();
}

module.exports = { initDB, generateCode, verifyCode, getAllCodes, saveContact, getAllContacts };
