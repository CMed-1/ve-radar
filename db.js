const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { nanoid } = require('nanoid');
const { calcWeightedAverage } = require('./public/js/score-model');

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
  db.exec(`CREATE TABLE IF NOT EXISTS test_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device TEXT,
    invite_code TEXT,
    avg_score REAL,
    scores TEXT NOT NULL,
    raw_data TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no TEXT UNIQUE NOT NULL,
    mode TEXT NOT NULL,
    channel TEXT NOT NULL,
    amount TEXT NOT NULL,
    product_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'CREATED',
    provider_trade_no TEXT,
    report_token TEXT UNIQUE NOT NULL,
    ref_code TEXT,
    raw_response TEXT,
    raw_notify TEXT,
    paid_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);
  const inviteColumns = db.prepare(`PRAGMA table_info(invite_codes)`).all();
  if (!inviteColumns.some(col => col.name === 'used_at')) {
    db.exec(`ALTER TABLE invite_codes ADD COLUMN used_at TEXT`);
    console.log('[DB] invite_codes 补充 used_at 字段');
  }
  const testResultColumns = db.prepare(`PRAGMA table_info(test_results)`).all();
  if (!testResultColumns.some(col => col.name === 'invite_code')) {
    db.exec(`ALTER TABLE test_results ADD COLUMN invite_code TEXT`);
    console.log('[DB] test_results 补充 invite_code 字段');
  }
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
  db.prepare("UPDATE invite_codes SET used = 1, used_at = datetime('now') WHERE code = ?").run(code.toUpperCase());
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

function saveTestResult({ device, inviteCode, scores, rawData }) {
  const avg = calcWeightedAverage(scores || {}, 1);
  const normalizedInviteCode = typeof inviteCode === 'string' && inviteCode.trim()
    ? inviteCode.trim().toUpperCase()
    : null;
  db.prepare(
    'INSERT INTO test_results (device, invite_code, avg_score, scores, raw_data) VALUES (?, ?, ?, ?, ?)'
  ).run(device || 'unknown', normalizedInviteCode, avg, JSON.stringify(scores || {}), JSON.stringify(rawData || {}));
}

function recalculateTestResultScores() {
  const rows = db.prepare('SELECT id, avg_score, scores FROM test_results').all();
  const update = db.prepare('UPDATE test_results SET avg_score = ? WHERE id = ?');
  const changes = [];

  const run = db.transaction(() => {
    rows.forEach(row => {
      let scores = {};
      try {
        scores = JSON.parse(row.scores || '{}');
      } catch (_) {
        scores = {};
      }
      const nextAvg = calcWeightedAverage(scores, 1);
      const prevAvg = row.avg_score === null || row.avg_score === undefined ? null : Number(row.avg_score);
      if (prevAvg === null || Math.abs(prevAvg - nextAvg) >= 0.05) {
        update.run(nextAvg, row.id);
        changes.push({ id: row.id, before: prevAvg, after: nextAvg });
      }
    });
  });

  run();
  return { total: rows.length, updated: changes.length, changes };
}

function getTestResultCount() {
  return db.prepare('SELECT COUNT(*) AS count FROM test_results').get().count;
}

function getAllTestResults(limit = 300) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 300, 1), 10000);
  return db.prepare(
    `SELECT id, device, invite_code, avg_score, scores, raw_data, created_at
     FROM test_results
     ORDER BY created_at DESC, id DESC
     LIMIT ?`
  ).all(safeLimit);
}

function createPayment({ orderNo, mode, channel, amount, productName, refCode }) {
  const reportToken = 'pay_' + nanoid(32);
  db.prepare(
    `INSERT INTO payments (order_no, mode, channel, amount, product_name, report_token, ref_code)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(orderNo, mode, channel, amount, productName, reportToken, refCode || null);
  return getPaymentByOrderNo(orderNo);
}

function getPaymentByOrderNo(orderNo) {
  return db.prepare('SELECT * FROM payments WHERE order_no = ?').get(orderNo);
}

function getPaymentByToken(token) {
  return db.prepare('SELECT * FROM payments WHERE report_token = ?').get(token);
}

function markPaymentPending({ orderNo, providerTradeNo, rawResponse }) {
  db.prepare(
    `UPDATE payments
     SET status = CASE WHEN status = 'CREATED' THEN 'PENDING' ELSE status END,
         provider_trade_no = COALESCE(?, provider_trade_no),
         raw_response = COALESCE(?, raw_response),
         updated_at = datetime('now')
     WHERE order_no = ?`
  ).run(providerTradeNo || null, rawResponse ? JSON.stringify(rawResponse) : null, orderNo);
  return getPaymentByOrderNo(orderNo);
}

function markPaymentPaid({ orderNo, providerTradeNo, rawNotify }) {
  const existing = getPaymentByOrderNo(orderNo);
  if (!existing) return { updated: false, row: null };
  if (existing.status === 'PAID') return { updated: false, row: existing };

  db.prepare(
    `UPDATE payments
     SET status = 'PAID',
         provider_trade_no = COALESCE(?, provider_trade_no),
         raw_notify = COALESCE(?, raw_notify),
         paid_at = COALESCE(paid_at, datetime('now')),
         updated_at = datetime('now')
     WHERE order_no = ?`
  ).run(providerTradeNo || null, rawNotify ? JSON.stringify(rawNotify) : null, orderNo);

  return { updated: true, row: getPaymentByOrderNo(orderNo) };
}

module.exports = {
  initDB,
  generateCode,
  verifyCode,
  getAllCodes,
  saveContact,
  getAllContacts,
  recordReferralClick,
  recordReferralConversion,
  getReferralStats,
  saveTestResult,
  recalculateTestResultScores,
  getTestResultCount,
  getAllTestResults,
  createPayment,
  getPaymentByOrderNo,
  getPaymentByToken,
  markPaymentPending,
  markPaymentPaid
};
