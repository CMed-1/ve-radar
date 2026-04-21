const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { nanoid } = require('nanoid');

// Render 持久化磁盘挂载在 /var/data（由 Render 负责创建该目录）
// 本地开发回退到项目目录
const DB_PATH = process.env.RENDER
  ? '/var/data/ve_radar.db'
  : path.join(__dirname, 've_radar.db');

// 防御性：确保目录存在（Render 磁盘未挂载时 fallback 到临时存储）
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
  console.warn('[DB] 目录不存在，已自动创建:', dbDir);
}

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
  db.exec(`CREATE TABLE IF NOT EXISTS referral_clicks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL,
    clicked_at TEXT DEFAULT (datetime('now'))
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS referral_conversions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL,
    mode TEXT,
    converted_at TEXT DEFAULT (datetime('now'))
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

function recordReferralClick(code) {
  db.prepare('INSERT INTO referral_clicks (code) VALUES (?)').run(code.toUpperCase());
}

function recordReferralConversion(code, mode) {
  db.prepare('INSERT INTO referral_conversions (code, mode) VALUES (?, ?)').run(code.toUpperCase(), mode || 'unknown');
}

function getReferralStats() {
  // Per-code stats: clicks + conversions
  const clicks = db.prepare(
    'SELECT code, COUNT(*) as clicks FROM referral_clicks GROUP BY code ORDER BY clicks DESC'
  ).all();
  const convs = db.prepare(
    'SELECT code, COUNT(*) as conversions, mode FROM referral_conversions GROUP BY code, mode'
  ).all();
  // Merge into map
  const map = {};
  clicks.forEach(r => { map[r.code] = { code: r.code, clicks: r.clicks, conversions: 0, modes: {} }; });
  convs.forEach(r => {
    if (!map[r.code]) map[r.code] = { code: r.code, clicks: 0, conversions: 0, modes: {} };
    map[r.code].conversions += r.conversions;
    map[r.code].modes[r.mode] = r.conversions;
  });
  return Object.values(map).sort((a, b) => b.clicks - a.clicks);
}

module.exports = { initDB, generateCode, verifyCode, getAllCodes, saveContact, getAllContacts, recordReferralClick, recordReferralConversion, getReferralStats };
