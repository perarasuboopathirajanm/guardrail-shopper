import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, defaultRules, sanitizeRules } from './guardrails.js';

const rules = { ...defaultRules }; // budget 100, cap 60, approval 30
const item = (price, category = 'home') => ({ price, category });

test('auto-approves small purchases', () => {
  assert.equal(evaluate(rules, item(20), 1, 0).decision, 'auto');
});
test('requires approval above threshold', () => {
  assert.equal(evaluate(rules, item(45), 1, 0).decision, 'needs_approval');
});
test('blocks over per-purchase cap', () => {
  assert.equal(evaluate(rules, item(89), 1, 0).decision, 'blocked');
});
test('blocks blocked categories', () => {
  assert.equal(evaluate(rules, item(10, 'alcohol'), 1, 0).decision, 'blocked');
});
test('blocks when budget would be exceeded', () => {
  assert.equal(evaluate(rules, item(25), 1, 80).decision, 'blocked');
});
test('quantity multiplies the total', () => {
  const v = evaluate(rules, item(20), 3, 0);
  assert.equal(v.total, 60);
  assert.equal(v.decision, 'needs_approval');
});
test('sanitizeRules rejects junk values', () => {
  const r = sanitizeRules({ budget: 'abc', perItemMax: -5, approvalThreshold: '12' });
  assert.equal(r.budget, defaultRules.budget);
  assert.equal(r.perItemMax, defaultRules.perItemMax);
  assert.equal(r.approvalThreshold, 12);
});
