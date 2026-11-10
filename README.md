# GuardRail Shopper

An AI shopping agent that buys through **PayPal**, but only inside spending rules you set. The agent proposes purchases; a server-side rules engine auto-approves, escalates to a human, or blocks them. Every decision lands in an audit log.

Built for the PayPal AI Hackathon (Agentic Commerce).

## How it works

1. You chat: "find a gift under $30".
2. The agent (Groq `openai/gpt-oss-120b` with tool calling; Claude is an optional fallback) searches the catalog and calls `propose_purchase`.
3. `guardrails.js` decides, outside the model's control:
   - **blocked**: blocked category, over the per-purchase cap, or over budget
   - **needs approval**: above the auto-approve limit, so you click Approve
   - **auto**: within all limits
4. Approved items are paid with **PayPal Orders v2** (sandbox). The order is captured when the buyer returns, and PayPal webhooks are logged and signature-verified.

## Run it

```bash
npm install
cp .env.example .env   # then fill in the keys below
npm start              # http://localhost:3000
npm test               # rules-engine tests
```

| Variable | Where to get it |
|---|---|
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | developer.paypal.com → Apps & Credentials → Sandbox |
| `PAYPAL_WEBHOOK_ID` (optional) | Same app → Webhooks (point it at `/api/webhook/paypal`) |
| `GROQ_API_KEY` (free tier; default model `openai/gpt-oss-120b`) | console.groq.com/keys |
| `ANTHROPIC_API_KEY` (used only if no Groq key) | console.anthropic.com |

**No keys?** It still runs. Without PayPal keys a clearly-labelled mock checkout page stands in for PayPal. With neither a Groq nor an Anthropic key, a simple keyword agent runs instead of the AI model. The header shows which mode is active.

## Deploy (Render)

1. Fork or connect this repo on [render.com](https://render.com) via **New → Blueprint**.
2. Render reads `render.yaml` and asks for `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and `GROQ_API_KEY`.
3. The public URL is picked up automatically (`RENDER_EXTERNAL_URL`) for PayPal return URLs.

The free tier sleeps after inactivity, so the first request can take about a minute.

## Layout

- `server.js` Express API and PayPal return/webhook routes
- `agent.js` AI tool-calling loop on Groq (Claude fallback, plus the no-key demo agent)
- `guardrails.js` spending rules engine (unit tested)
- `paypal.js` PayPal Orders v2 + webhook verification
- `catalog.js` mock product catalog (swap for a real product API)
- `public/index.html` chat UI, rules editor, approvals, audit log

## Limitations

Single shared in-memory demo session, sandbox only, mock catalog.

## License

MIT
