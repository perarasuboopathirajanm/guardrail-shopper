import Anthropic from '@anthropic-ai/sdk';
import { searchProducts } from './catalog.js';
import { propose, committed, log } from './state.js';

// Provider order: Groq (free tier) -> Anthropic Claude -> keyword demo agent.
export const aiProvider = () =>
  process.env.GROQ_API_KEY ? 'groq' : process.env.ANTHROPIC_API_KEY ? 'claude' : null;
export const aiLive = () => aiProvider() !== null;

const TOOLS = [
  {
    name: 'search_products',
    description: 'Search the product catalog. Returns up to 6 products with id, name, price (USD), category and rating.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keywords, e.g. "coffee gift"' },
        max_price: { type: 'number', description: 'Optional max unit price in USD' },
      },
      required: ['query'],
    },
  },
  {
    name: 'propose_purchase',
    description: 'Propose buying a product. The server checks the user\'s spending rules: it may auto-approve, require human approval, or block. Never claim a purchase is done; payment happens separately through PayPal.',
    input_schema: {
      type: 'object',
      properties: {
        product_id: { type: 'string' },
        quantity: { type: 'integer', minimum: 1, maximum: 10 },
        reason: { type: 'string', description: 'One sentence on why this fits the request' },
      },
      required: ['product_id', 'quantity', 'reason'],
    },
  },
];

function systemPrompt(session) {
  const r = session.rules;
  return `You are GuardRail Shopper, an AI shopping agent that buys on the user's behalf through PayPal.
The user's spending rules (enforced by the server, not by you):
- Total budget: $${r.budget} (already committed: $${committed(session)})
- Max per purchase: $${r.perItemMax}
- Purchases above $${r.approvalThreshold} need the user's approval
- Blocked categories: ${r.blockedCategories.join(', ') || 'none'}
Workflow: search the catalog (do NOT set max_price unless the user gave a price limit), pick the best match for what the user asked, then call propose_purchase for it. Always propose what the user actually asked for, even if it might break a rule: the server enforces the rules and reports back. If nothing in the catalog matches the request, say so plainly and stop: NEVER propose unrelated items just to have something. If a proposal is blocked, explain why and mention at most one allowed alternative in text only; do not propose it unless the user asks for it. Search at most twice. Keep replies to 2-3 short sentences. Never say an item was bought; say it was proposed and what the rules decided.`;
}

async function runTool(session, name, input) {
  if (name === 'search_products') {
    const results = searchProducts(input);
    log(session, 'search', `Searched "${input.query}"${input.max_price ? ` under $${input.max_price}` : ''}: ${results.length} results`);
    return results.map(({ id, name, price, category, rating }) => ({ id, name, price, category, rating }));
  }
  if (name === 'propose_purchase') {
    const out = propose(session, input);
    if (!out.ok) return { status: out.blocked ? 'blocked' : 'error', reasons: out.reasons, error: out.error };
    const p = out.proposal;
    return { status: p.status, decision: p.decision, proposal_id: p.id, total: p.total, reasons: p.reasons };
  }
  return { error: `Unknown tool ${name}` };
}

async function runClaude(session, message) {
  const client = new Anthropic();
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
  const messages = [...session.history, { role: 'user', content: message }];

  for (let i = 0; i < 8; i++) {
    const res = await client.messages.create({
      model, max_tokens: 1024, system: systemPrompt(session), tools: TOOLS, messages,
    });
    messages.push({ role: 'assistant', content: res.content });
    if (res.stop_reason !== 'tool_use') {
      session.history = messages.slice(-20);
      return res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    }
    const results = [];
    for (const block of res.content.filter((b) => b.type === 'tool_use')) {
      const out = await runTool(session, block.name, block.input);
      results.push({ type: 'tool_result', tool_use_id: block.tool_use_id ?? block.id, content: JSON.stringify(out) });
    }
    messages.push({ role: 'user', content: results });
  }
  session.history = messages.slice(-20);
  return 'I hit my step limit. Please try a more specific request.';
}

// Groq exposes an OpenAI-compatible chat API with tool calling.
async function runGroq(session, message) {
  const model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
  const tools = TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));
  const messages = [{ role: 'system', content: systemPrompt(session) }, ...(session.groqHistory || []), { role: 'user', content: message }];
  let proposeCalls = 0;
  let searchCalls = 0;
  let nudged = false;

  for (let i = 0; i < 8; i++) {
    let res, json;
    for (let attempt = 0; attempt < 4; attempt++) {
      res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, tools, tool_choice: 'auto', max_tokens: 700, temperature: 0.2 }),
      });
      json = await res.json().catch(() => ({}));
      if (res.status !== 429 || attempt === 3) break;
      // Free tier is token-per-minute limited: wait as long as Groq asks, then retry.
      const wait = Number((json.error?.message || '').match(/try again in ([\d.]+)s/)?.[1]) || 5;
      await new Promise((r) => setTimeout(r, Math.min(wait + 1, 20) * 1000));
    }
    if (!res.ok) throw new Error(`Groq ${res.status}: ${json.error?.message || 'request failed'}`);
    const msg = json.choices?.[0]?.message;
    if (!msg) throw new Error('Groq returned no message');
    messages.push(msg);

    if (!msg.tool_calls?.length) {
      const reply = (msg.content || '').trim();
      // Honesty check: the model must never claim a proposal/approval/block that the server didn't record.
      if (!proposeCalls && !nudged && /propos|auto-?approv|approved|blocked/i.test(reply)) {
        nudged = true;
        log(session, 'guard', 'Agent described a purchase decision without calling propose_purchase; asking it to act or correct itself');
        messages.push({ role: 'user', content: 'System check: you described a purchase decision but never called propose_purchase, so nothing was recorded. Call propose_purchase now for the item you chose, or reply that nothing was proposed.' });
        continue;
      }
      // Keep only plain user/assistant text between turns: smaller prompts, and no orphaned tool messages.
      session.groqHistory = [...(session.groqHistory || []), { role: 'user', content: message }, { role: 'assistant', content: reply }].slice(-6);
      return reply;
    }
    for (const call of msg.tool_calls) {
      if (call.function.name === 'propose_purchase') proposeCalls++;
      let input = {};
      try { input = JSON.parse(call.function.arguments || '{}'); } catch { /* model sent bad JSON; tool will reject */ }
      // Hard cap on searching so a no-match request can't spiral into random guesses.
      const tooManySearches = call.function.name === 'search_products' && ++searchCalls > 3;
      const out = tooManySearches
        ? { error: 'Search limit reached. Stop searching and tell the user what you found, or that nothing matched.' }
        : await runTool(session, call.function.name, input);
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(out) });
    }
  }
  return 'I hit my step limit. Please try a more specific request.';
}

// No API key: a simple keyword agent so judges can still run the full flow.
async function runDemoAgent(session, message) {
  const max = Number((message.match(/\$?\s?(\d+(?:\.\d+)?)\s*(?:usd|dollars|\$)?/i) || [])[1]) || undefined;
  const found = searchProducts({ query: message, max_price: max });
  log(session, 'search', `[demo mode] Searched "${message}"${max ? ` under $${max}` : ''}: ${found.length} results`);
  if (!found.length) return '[demo mode] I found nothing matching that. Try "a gift under $40" or "coffee stuff".';

  const lines = [];
  for (const product of found.slice(0, 2)) {
    const out = propose(session, { product_id: product.id, quantity: 1, reason: 'Best match for your request' });
    lines.push(out.ok
      ? `• ${product.name} ($${product.price}): ${out.proposal.reasons[0]}.`
      : `• ${product.name} ($${product.price}): blocked. ${out.reasons?.[0] || out.error}`);
  }
  return `[demo mode: add GROQ_API_KEY or ANTHROPIC_API_KEY for the real AI agent]\nHere is what I found:\n${lines.join('\n')}`;
}

export async function chat(session, message) {
  log(session, 'user', message);
  const provider = aiProvider();
  const reply = provider === 'groq' ? await runGroq(session, message)
    : provider === 'claude' ? await runClaude(session, message)
    : await runDemoAgent(session, message);
  log(session, 'agent', reply);
  return reply;
}
