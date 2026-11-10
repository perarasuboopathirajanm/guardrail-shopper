import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeRules } from './guardrails.js';
import { getSession, log, committed, resetSession } from './state.js';
import { chat, aiLive, aiProvider } from './agent.js';
import { createOrder, captureOrder, verifyWebhook, paypalLive } from './paypal.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
// On Render, RENDER_EXTERNAL_URL is the public https address; PayPal needs it for return URLs.
const BASE_URL = (process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const sid = () => 'demo'; // single shared demo session

const app = express();
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const view = (s) => ({
  rules: s.rules,
  committed: committed(s),
  proposals: [...s.proposals.values()],
  audit: s.audit.slice(-100),
});

app.get('/api/state', (_req, res) => {
  res.json({ ...view(getSession(sid())), modes: { ai: aiLive(), provider: aiProvider(), paypal: paypalLive() } });
});

// Clears proposals, audit log, rules and chat memory (handy before recording a demo).
app.post('/api/reset', (_req, res) => {
  res.json(view(resetSession(sid())));
});

app.post('/api/rules', (req, res) => {
  const s = getSession(sid());
  s.rules = sanitizeRules(req.body);
  log(s, 'rules', 'Spending rules updated', s.rules);
  res.json(view(s));
});

app.post('/api/chat', async (req, res) => {
  const message = String(req.body?.message || '').trim().slice(0, 1000);
  if (!message) return res.status(400).json({ error: 'message required' });
  const s = getSession(sid());
  try {
    const reply = await chat(s, message);
    res.json({ reply, ...view(s) });
  } catch (e) {
    log(s, 'error', e.message);
    res.status(502).json({ error: `Agent error: ${e.message}`, ...view(s) });
  }
});

// Human approval for proposals above the auto-approve limit.
app.post('/api/proposals/:id/approve', (req, res) => {
  const s = getSession(sid());
  const p = s.proposals.get(req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  if (p.status !== 'pending_approval') return res.status(409).json({ error: `status is ${p.status}` });
  p.status = 'approved';
  log(s, 'human_approved', `You approved ${p.quantity} x ${p.product.name} ($${p.total})`, { proposalId: p.id });
  res.json(view(s));
});

app.post('/api/proposals/:id/reject', (req, res) => {
  const s = getSession(sid());
  const p = s.proposals.get(req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  if (!['pending_approval', 'approved'].includes(p.status)) return res.status(409).json({ error: `status is ${p.status}` });
  p.status = 'rejected';
  log(s, 'human_rejected', `You rejected ${p.product.name}`, { proposalId: p.id });
  res.json(view(s));
});

// Creates the PayPal order. Only approved proposals can be paid for.
app.post('/api/proposals/:id/checkout', async (req, res) => {
  const s = getSession(sid());
  const p = s.proposals.get(req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  if (p.status !== 'approved') return res.status(409).json({ error: `Cannot pay: status is ${p.status}` });
  try {
    const order = await createOrder({
      proposalId: p.id, name: `${p.quantity} x ${p.product.name}`, amount: p.total, baseUrl: BASE_URL,
    });
    p.orderId = order.id;
    p.status = 'awaiting_payment';
    log(s, 'order_created', `PayPal order ${order.id} created for $${p.total}${order.mock ? ' (mock)' : ''}`, { proposalId: p.id });
    res.json({ approveUrl: order.approveUrl, ...view(s) });
  } catch (e) {
    log(s, 'error', e.message);
    res.status(502).json({ error: e.message });
  }
});

async function finishCapture(orderId) {
  const s = getSession(sid());
  const p = [...s.proposals.values()].find((x) => x.orderId === orderId);
  if (!p || p.status === 'paid') return p;
  const cap = await captureOrder(orderId);
  if (cap.status === 'COMPLETED') {
    p.status = 'paid';
    p.captureId = cap.captureId;
    log(s, 'paid', `Payment captured for ${p.product.name} ($${p.total}), capture ${cap.captureId}`, { proposalId: p.id });
  } else {
    log(s, 'error', `Capture for ${orderId} returned ${cap.status}`);
  }
  return p;
}

app.get('/paypal/return', async (req, res) => {
  try { await finishCapture(String(req.query.token || '')); } catch (e) { log(getSession(sid()), 'error', e.message); }
  res.redirect('/?checkout=done');
});

app.get('/paypal/cancel', (req, res) => {
  const s = getSession(sid());
  const p = [...s.proposals.values()].find((x) => x.orderId === String(req.query.token || ''));
  if (p && p.status === 'awaiting_payment') {
    p.status = 'approved'; // buyer backed out; can retry
    log(s, 'cancelled', `Checkout cancelled for ${p.product.name}`);
  }
  res.redirect('/?checkout=cancelled');
});

// Stand-in approval page used only when PayPal credentials are absent.
app.get('/mock-paypal', (req, res) => {
  if (paypalLive()) return res.status(404).end();
  const order = String(req.query.order || '').replace(/[^A-Za-z0-9-]/g, '');
  res.type('html').send(`<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>Mock PayPal</title>
<body style="font-family:system-ui;max-width:420px;margin:15vh auto;padding:0 16px;text-align:center">
<h2>Mock PayPal checkout</h2><p>No PayPal sandbox keys are configured, so this page stands in for PayPal's approval screen.</p>
<a href="/paypal/return?token=${order}" style="display:inline-block;padding:12px 20px;background:#0070e0;color:#fff;border-radius:8px;text-decoration:none">Approve payment</a>
<p><a href="/paypal/cancel?token=${order}">Cancel</a></p></body>`);
});

app.post('/api/webhook/paypal', async (req, res) => {
  const s = getSession(sid());
  const verified = await verifyWebhook(req.headers, req.body);
  if (verified === false) {
    log(s, 'webhook_rejected', 'Webhook signature verification failed');
    return res.status(400).end();
  }
  const type = req.body?.event_type;
  log(s, 'webhook', `PayPal webhook ${type}${verified === null ? ' (signature not verified: no PAYPAL_WEBHOOK_ID)' : ' (verified)'}`);
  if (type === 'CHECKOUT.ORDER.APPROVED' && verified) {
    try { await finishCapture(req.body?.resource?.id); } catch (e) { log(s, 'error', e.message); }
  }
  res.status(200).end();
});

app.listen(PORT, () => {
  console.log(`GuardRail Shopper on ${BASE_URL}`);
  console.log(`  AI agent : ${aiLive() ? `${aiProvider()} (live)` : 'demo mode (set GROQ_API_KEY or ANTHROPIC_API_KEY)'}`);
  console.log(`  PayPal   : ${paypalLive() ? 'sandbox (live)' : 'mock checkout (set PAYPAL_CLIENT_ID/SECRET)'}`);
});
