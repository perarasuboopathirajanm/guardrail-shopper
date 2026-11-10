// Thin PayPal Orders v2 client (sandbox). Falls back to a clearly-labelled mock
// checkout when no credentials are configured so the demo still runs.

const BASE = 'https://api-m.sandbox.paypal.com';
export const paypalLive = () => Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);

let tokenCache = { value: null, exp: 0 };

async function accessToken() {
  if (tokenCache.value && Date.now() < tokenCache.exp) return tokenCache.value;
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`PayPal auth failed (${res.status})`);
  const json = await res.json();
  tokenCache = { value: json.access_token, exp: Date.now() + (json.expires_in - 60) * 1000 };
  return tokenCache.value;
}

async function api(path, init = {}) {
  const token = await accessToken();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`PayPal ${path} failed (${res.status}): ${json.message || json.name || 'error'}`);
  return json;
}

export async function createOrder({ proposalId, name, amount, baseUrl }) {
  const value = amount.toFixed(2);
  if (!paypalLive()) {
    const id = `MOCK-${proposalId}`;
    return { id, approveUrl: `${baseUrl}/mock-paypal?order=${id}&proposal=${proposalId}`, mock: true };
  }
  const order = await api('/v2/checkout/orders', {
    method: 'POST',
    headers: { 'PayPal-Request-Id': `gs-${proposalId}` },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: proposalId,
        description: name.slice(0, 120),
        amount: { currency_code: 'USD', value },
      }],
      payment_source: {
        paypal: {
          experience_context: {
            return_url: `${baseUrl}/paypal/return`,
            cancel_url: `${baseUrl}/paypal/cancel`,
            user_action: 'PAY_NOW',
            shipping_preference: 'NO_SHIPPING',
          },
        },
      },
    }),
  });
  const link = order.links.find((l) => l.rel === 'payer-action') || order.links.find((l) => l.rel === 'approve');
  return { id: order.id, approveUrl: link.href, mock: false };
}

export async function captureOrder(orderId) {
  if (orderId.startsWith('MOCK-')) return { status: 'COMPLETED', captureId: `${orderId}-CAPTURE`, mock: true };
  const res = await api(`/v2/checkout/orders/${orderId}/capture`, { method: 'POST', body: '{}' });
  const cap = res.purchase_units?.[0]?.payments?.captures?.[0];
  return { status: res.status, captureId: cap?.id, mock: false };
}

// Verifies a webhook with PayPal. Returns true/false, or null when no webhook id is configured.
export async function verifyWebhook(headers, event) {
  if (!paypalLive() || !process.env.PAYPAL_WEBHOOK_ID) return null;
  try {
    const out = await api('/v1/notifications/verify-webhook-signature', {
      method: 'POST',
      body: JSON.stringify({
        auth_algo: headers['paypal-auth-algo'],
        cert_url: headers['paypal-cert-url'],
        transmission_id: headers['paypal-transmission-id'],
        transmission_sig: headers['paypal-transmission-sig'],
        transmission_time: headers['paypal-transmission-time'],
        webhook_id: process.env.PAYPAL_WEBHOOK_ID,
        webhook_event: event,
      }),
    });
    return out.verification_status === 'SUCCESS';
  } catch {
    return false;
  }
}
