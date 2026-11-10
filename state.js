import { randomUUID } from 'node:crypto';
import { defaultRules, evaluate } from './guardrails.js';
import { getProduct } from './catalog.js';

// In-memory per-session state (fine for a demo; swap for a DB in production).
const sessions = new Map();

export function getSession(id = 'demo') {
  if (!sessions.has(id)) {
    sessions.set(id, { id, rules: { ...defaultRules }, proposals: new Map(), audit: [], history: [] });
  }
  return sessions.get(id);
}

export function resetSession(id = 'demo') {
  sessions.delete(id);
  return getSession(id);
}

export function log(session, type, message, data) {
  const entry = { at: new Date().toISOString(), type, message, data };
  session.audit.push(entry);
  return entry;
}

// Money already committed: approved/paying/paid purchases count against the budget.
export function committed(session) {
  let sum = 0;
  for (const p of session.proposals.values()) {
    if (['approved', 'awaiting_payment', 'paid'].includes(p.status)) sum += p.total;
  }
  return Math.round(sum * 100) / 100;
}

export function propose(session, { product_id, quantity, reason }) {
  const product = getProduct(product_id);
  if (!product) return { ok: false, error: `Unknown product_id "${product_id}"` };
  const qty = Math.max(1, Math.min(10, Math.floor(Number(quantity) || 1)));
  const verdict = evaluate(session.rules, product, qty, committed(session));

  if (verdict.decision === 'blocked') {
    log(session, 'blocked', `Blocked: ${qty} x ${product.name}`, verdict);
    return { ok: false, blocked: true, reasons: verdict.reasons };
  }

  const proposal = {
    id: randomUUID().slice(0, 8),
    product, quantity: qty, total: verdict.total,
    reason: String(reason || '').slice(0, 300),
    decision: verdict.decision,
    reasons: verdict.reasons,
    // auto purchases are pre-approved by the rules; the rest wait for a human
    status: verdict.decision === 'auto' ? 'approved' : 'pending_approval',
    orderId: null, captureId: null,
  };
  session.proposals.set(proposal.id, proposal);
  log(session, verdict.decision === 'auto' ? 'auto_approved' : 'needs_approval',
    `${qty} x ${product.name} ($${verdict.total}): ${verdict.reasons[0]}`, { proposalId: proposal.id });
  return { ok: true, proposal };
}
