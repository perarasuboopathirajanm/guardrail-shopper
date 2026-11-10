// Spending-rules engine. Enforced on the server, so the AI cannot bypass it.

export const defaultRules = {
  budget: 100,            // total the agent may commit in this session
  perItemMax: 60,         // hard cap on any single purchase
  approvalThreshold: 30,  // above this, a human must approve
  blockedCategories: ['alcohol', 'gambling', 'weapons'],
};

const round = (n) => Math.round(n * 100) / 100;

export function sanitizeRules(input = {}) {
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
  return {
    budget: num(input.budget, defaultRules.budget),
    perItemMax: num(input.perItemMax, defaultRules.perItemMax),
    approvalThreshold: num(input.approvalThreshold, defaultRules.approvalThreshold),
    blockedCategories: Array.isArray(input.blockedCategories)
      ? input.blockedCategories.map((c) => String(c).toLowerCase().trim()).filter(Boolean)
      : defaultRules.blockedCategories,
  };
}

/**
 * @returns {{decision:'auto'|'needs_approval'|'blocked', total:number, reasons:string[]}}
 */
export function evaluate(rules, product, quantity, committed) {
  const qty = Math.max(1, Math.floor(Number(quantity) || 1));
  const total = round(product.price * qty);

  if (rules.blockedCategories.includes(product.category)) {
    return { decision: 'blocked', total, reasons: [`Category "${product.category}" is blocked by your rules`] };
  }
  if (total > rules.perItemMax) {
    return { decision: 'blocked', total, reasons: [`$${total} exceeds the per-purchase cap of $${rules.perItemMax}`] };
  }
  if (round(committed + total) > rules.budget) {
    const left = round(Math.max(0, rules.budget - committed));
    return { decision: 'blocked', total, reasons: [`$${total} would exceed the remaining budget of $${left}`] };
  }
  if (total > rules.approvalThreshold) {
    return { decision: 'needs_approval', total, reasons: [`$${total} is above the $${rules.approvalThreshold} auto-approve limit`] };
  }
  return { decision: 'auto', total, reasons: [`Within budget and under the $${rules.approvalThreshold} auto-approve limit`] };
}
