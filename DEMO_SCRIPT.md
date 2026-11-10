# Demo video script (target: 2:30, hard limit 3:00)

Record your screen at http://localhost:3111 (or the deployed URL). Keep the header, chat, rules and audit log visible. Don't show PayPal logos beyond what appears naturally on PayPal's own checkout page, and use no music (copyrighted music is not allowed).

Before recording: restart the server (clears state) and set rules to budget 100, cap 60, auto-approve 30.

| Time | On screen | Say |
|---|---|---|
| 0:00–0:15 | App header and the empty page | "AI agents are starting to shop for us, but nobody wants an agent with an open wallet. GuardRail Shopper is an AI shopping agent that pays with PayPal, but only inside rules you set." |
| 0:15–0:30 | Spending rules card | "I set the rules: a $100 budget, $60 max per purchase, anything over $30 needs my approval, and alcohol is blocked. These rules are enforced on the server, so the AI cannot talk its way around them." |
| 0:30–0:55 | Click "Gift under $30" and wait | "I ask for a gift under $30. The AI, running on Groq, searches the catalog and proposes a candle set for $24. It's under my limit, so the server auto-approves it." |
| 0:55–1:20 | Click "Try a blocked item" | "Now I ask for a whisky gift pack. The AI proposes it, but the server blocks it because alcohol is on my blocked list. The agent explains why and suggests an allowed alternative." |
| 1:20–1:45 | Click "Over the cap", then "Coffee kit" | "A keyboard at $89 is over my $60 cap, so it's blocked. A $44 coffee kit is allowed but above my auto-approve limit, so it waits for me." Click Approve. |
| 1:45–2:15 | Click "Pay with PayPal", log in to the sandbox buyer, approve | "I pay through PayPal's sandbox checkout. PayPal Orders creates the order, and when I approve, the app captures the payment." |
| 2:15–2:35 | Back in the app: item shows "paid"; scroll the audit log | "The item is marked paid, and every decision is in the audit log: the search, the approval, the block, the order and the capture." |
| 2:35–2:50 | Header / logo | "GuardRail Shopper: let AI agents shop, with you holding the limits. Built with PayPal Orders and Groq." |

## Tips
- Do one full practice run first so the Groq rate limit (free tier) isn't hit mid-recording. Wait a few seconds between prompts.
- If a step is slow, trim it in editing. Keep total length under 3:00.
- Upload to YouTube as **Public** (not Unlisted) and paste the link in Devpost.
