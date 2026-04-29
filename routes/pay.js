'use strict';
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const {
  createPayment,
  getPaymentByOrderNo,
  getPaymentByToken,
  markPaymentPending,
  markPaymentPaid,
  recordReferralConversion
} = require('../db');

const router = express.Router();

// ─── EasyPay 配置常量 ─────────────────────────────────────────
const APP_BASE_URL = String(process.env.APP_BASE_URL || '').replace(/\/+$/, '');
const EASYPAY_API_BASE = String(process.env.EASYPAY_API_BASE || 'https://www.liuhao.net').replace(/\/+$/, '');
const EASYPAY_PID = String(process.env.EASYPAY_PID || '').trim();
const EASYPAY_KEY = String(process.env.EASYPAY_KEY || '').trim();
const PAY_BASIC_PRICE = (parseFloat(process.env.PAY_BASIC_PRICE || '4.98') || 4.98).toFixed(2);
const PAY_ADVANCED_PRICE = (parseFloat(process.env.PAY_ADVANCED_PRICE || '14.98') || 14.98).toFixed(2);
const PAY_BASIC_NAME = process.env.PAY_BASIC_NAME || 'VE天赋雷达基础版报告';
const PAY_ADVANCED_NAME = process.env.PAY_ADVANCED_NAME || 'VE天赋雷达进阶版报告';

// ─── EasyPay 工具函数 ─────────────────────────────────────────
function hasEasyPayConfig() {
  return Boolean(APP_BASE_URL && EASYPAY_API_BASE && EASYPAY_PID && EASYPAY_KEY);
}

function getPayProduct(mode) {
  if (mode === 'advanced') {
    return { mode: 'advanced', amount: PAY_ADVANCED_PRICE, name: PAY_ADVANCED_NAME };
  }
  return { mode: 'basic', amount: PAY_BASIC_PRICE, name: PAY_BASIC_NAME };
}

function buildEasyPaySign(params) {
  const text = Object.keys(params)
    .filter(key => !['sign', 'sign_type'].includes(key) && params[key] !== '' && params[key] !== null && params[key] !== undefined)
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('&');
  return crypto.createHash('md5').update(text + EASYPAY_KEY, 'utf8').digest('hex');
}

function verifyEasyPaySign(payload) {
  if (!payload || !payload.sign) return false;
  return buildEasyPaySign(payload) === String(payload.sign).toLowerCase();
}

function normalizeChannel(channel) {
  return channel === 'wxpay' ? 'wxpay' : 'alipay';
}

function buildOrderNo(mode) {
  return `VE${mode === 'advanced' ? 'A' : 'B'}${Date.now()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function parseCookies(req) {
  const jar = {};
  const raw = req.headers.cookie || '';
  raw.split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx <= 0) return;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    jar[key] = decodeURIComponent(value);
  });
  return jar;
}

function setPaymentCookie(res, token) {
  res.cookie('ve_pay_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: APP_BASE_URL.startsWith('https://'),
    maxAge: 1000 * 60 * 60 * 24 * 30,
    path: '/'
  });
}

function clearPaymentCookie(res) {
  res.clearCookie('ve_pay_token', {
    httpOnly: true,
    sameSite: 'lax',
    secure: APP_BASE_URL.startsWith('https://'),
    path: '/'
  });
}

function getClientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const rawIp = forwarded || req.socket.remoteAddress || '';
  const ip = rawIp.replace(/^::ffff:/, '');
  return ip.includes(':') ? '127.0.0.1' : (ip || '127.0.0.1');
}

function detectEasyPayDevice(req) {
  const ua = String(req.headers['user-agent'] || '').toLowerCase();
  if (ua.includes('micromessenger')) return 'wechat';
  if (ua.includes('alipayclient')) return 'alipay';
  if (/iphone|ipad|android|mobile/.test(ua)) return 'mobile';
  return 'pc';
}

function markPaymentAsPaid(orderNo, providerTradeNo, rawPayload) {
  const result = markPaymentPaid({ orderNo, providerTradeNo, rawNotify: rawPayload });
  if (result.updated && result.row?.ref_code) {
    recordReferralConversion(result.row.ref_code, result.row.mode);
  }
  return result.row;
}

async function fetchEasyPayOrder(orderNo) {
  const response = await axios.get(`${EASYPAY_API_BASE}/api.php`, {
    params: { act: 'order', pid: EASYPAY_PID, key: EASYPAY_KEY, out_trade_no: orderNo },
    timeout: 12000
  });
  return typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
}

async function syncPaymentStatus(orderNo) {
  const current = getPaymentByOrderNo(orderNo);
  if (!current) return null;
  if (current.status === 'PAID' || !hasEasyPayConfig()) return current;

  try {
    const remote = await fetchEasyPayOrder(orderNo);
    if (remote && String(remote.code) === '1' && String(remote.status) === '1') {
      const amountMatches = parseFloat(remote.money) === parseFloat(current.amount);
      if (amountMatches) {
        return markPaymentAsPaid(orderNo, remote.trade_no || current.provider_trade_no, remote);
      }
    }
  } catch (err) {
    console.warn('[pay/sync]', err.message);
  }

  return getPaymentByOrderNo(orderNo);
}

// ─── 创建支付订单（易支付 V1）────────────────────────────────
router.post('/pay/create', async (req, res) => {
  try {
    if (!hasEasyPayConfig()) {
      return res.status(500).json({ success: false, message: '支付配置未完成' });
    }

    const mode = req.body?.mode === 'advanced' ? 'advanced' : 'basic';
    const channel = normalizeChannel(req.body?.channel);
    const refCode = typeof req.body?.refCode === 'string' ? req.body.refCode.trim().toUpperCase() : '';
    const sid = typeof req.body?.sid === 'string' ? req.body.sid.trim() : '';
    const product = getPayProduct(mode);
    const orderNo = buildOrderNo(mode);

    createPayment({
      orderNo,
      mode: product.mode,
      channel,
      amount: product.amount,
      productName: product.name,
      refCode,
      sid: sid || null
    });

    const payload = {
      pid: EASYPAY_PID,
      type: channel,
      out_trade_no: orderNo,
      notify_url: `${APP_BASE_URL}/api/pay/notify/easypay`,
      return_url: `${APP_BASE_URL}/pay.html?orderNo=${encodeURIComponent(orderNo)}`,
      name: product.name,
      money: product.amount,
      clientip: getClientIp(req),
      device: detectEasyPayDevice(req),
      param: product.mode
    };
    payload.sign = buildEasyPaySign(payload);
    payload.sign_type = 'MD5';

    const response = await axios.post(
      `${EASYPAY_API_BASE}/mapi.php`,
      new URLSearchParams(payload).toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15000
      }
    );

    const data = typeof response.data === 'string' ? JSON.parse(response.data) : (response.data || {});
    if (String(data.code) !== '1') {
      return res.status(400).json({ success: false, message: data.msg || '创建支付订单失败' });
    }

    const payment = markPaymentPending({
      orderNo,
      providerTradeNo: data.trade_no || null,
      rawResponse: data
    });

    res.json({
      success: true,
      orderNo,
      mode: payment.mode,
      channel: payment.channel,
      amount: payment.amount,
      productName: payment.product_name,
      payurl: data.payurl || '',
      qrcode: data.qrcode || '',
      urlscheme: data.urlscheme || ''
    });
  } catch (err) {
    console.error('[pay/create]', err.message);
    res.status(500).json({ success: false, message: '创建支付订单失败，请稍后再试' });
  }
});

// ─── 查询订单状态（前端轮询 + 回跳兜底）──────────────────────
router.get('/pay/status', async (req, res) => {
  try {
    const orderNo = String(req.query.orderNo || '').trim();
    if (!orderNo) {
      return res.status(400).json({ success: false, message: '缺少订单号' });
    }

    const payment = await syncPaymentStatus(orderNo);
    if (!payment) {
      return res.status(404).json({ success: false, message: '订单不存在' });
    }

    if (payment.status === 'PAID') {
      setPaymentCookie(res, payment.report_token);
    }

    res.json({
      success: true,
      orderNo: payment.order_no,
      status: payment.status,
      paid: payment.status === 'PAID',
      mode: payment.mode,
      channel: payment.channel,
      amount: payment.amount,
      productName: payment.product_name
    });
  } catch (err) {
    console.error('[pay/status]', err.message);
    res.status(500).json({ success: false, message: '查询订单状态失败' });
  }
});

// ─── 支付异步通知（易支付 V1）────────────────────────────────
router.all('/pay/notify/easypay', (req, res) => {
  try {
    const payload = req.method === 'POST' ? req.body : req.query;
    if (!hasEasyPayConfig() || !payload || !payload.out_trade_no) {
      return res.type('text/plain').send('fail');
    }

    const payment = getPaymentByOrderNo(String(payload.out_trade_no).trim());
    if (!payment) {
      return res.type('text/plain').send('fail');
    }

    const amountMatches = parseFloat(payload.money) === parseFloat(payment.amount);
    const pidMatches = String(payload.pid) === EASYPAY_PID;
    const statusOk = payload.trade_status === 'TRADE_SUCCESS';
    const signOk = verifyEasyPaySign(payload);

    if (!amountMatches || !pidMatches || !statusOk || !signOk) {
      return res.type('text/plain').send('fail');
    }

    markPaymentAsPaid(payment.order_no, payload.trade_no || payment.provider_trade_no, payload);
    return res.type('text/plain').send('success');
  } catch (err) {
    console.error('[pay/notify]', err.message);
    return res.type('text/plain').send('fail');
  }
});

// ─── 报告访问状态（服务端支付凭证）──────────────────────────
router.get('/report/access', (req, res) => {
  try {
    const cookies = parseCookies(req);
    const token = cookies.ve_pay_token;
    if (!token) {
      return res.json({ success: true, access: false });
    }

    const payment = getPaymentByToken(token);
    if (!payment || payment.status !== 'PAID') {
      clearPaymentCookie(res);
      return res.json({ success: true, access: false });
    }

    res.json({
      success: true,
      access: true,
      mode: payment.mode,
      orderNo: payment.order_no,
      channel: payment.channel
    });
  } catch (err) {
    console.error('[report/access]', err.message);
    res.status(500).json({ success: false, access: false });
  }
});

module.exports = { router, clearPaymentCookie };
