// Thin client for the PayPal REST APIs Rebuttal uses:
//   Disputes v1  - list/show/provide-evidence/send-message/make-offer/accept-claim
//   Tracking v1  - trackers-batch (push shipment tracking to prevent INR disputes)
// Sandbox-only helpers (require-evidence, adjudicate) are exposed for demos.

const BASES = {
  sandbox: 'https://api-m.sandbox.paypal.com',
  live: 'https://api-m.paypal.com',
};

export class PayPalError extends Error {
  constructor(status, body, path) {
    super(`PayPal ${status} on ${path}: ${body?.message || body?.error_description || JSON.stringify(body).slice(0, 300)}`);
    this.status = status;
    this.body = body;
    this.debugId = body?.debug_id;
  }
}

export class PayPalClient {
  constructor({ clientId, clientSecret, env = 'sandbox' }) {
    if (!clientId || !clientSecret) throw new Error('PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are required for sandbox mode');
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.base = BASES[env] || BASES.sandbox;
    this.mode = env;
    this.token = null;
    this.tokenExpires = 0;
  }

  async accessToken() {
    if (this.token && Date.now() < this.tokenExpires - 60_000) return this.token;
    const res = await fetch(`${this.base}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    const body = await res.json();
    if (!res.ok) throw new PayPalError(res.status, body, '/v1/oauth2/token');
    this.token = body.access_token;
    this.tokenExpires = Date.now() + body.expires_in * 1000;
    return this.token;
  }

  async request(method, path, { json, form } = {}) {
    const headers = { Authorization: `Bearer ${await this.accessToken()}` };
    let body;
    if (json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(json);
    } else if (form) {
      body = form; // fetch sets the multipart boundary
    }
    const res = await fetch(this.base + path, { method, headers, body });
    const text = await res.text();
    const parsed = text ? safeJson(text) : {};
    if (!res.ok) throw new PayPalError(res.status, parsed, path);
    return parsed;
  }

  // ---- Disputes ----
  async listDisputes() {
    const out = await this.request('GET', '/v1/customer/disputes?page_size=50');
    // The list endpoint returns summaries; fetch full details for actionable ones.
    const items = out.items || [];
    return Promise.all(items.map((d) => this.getDispute(d.dispute_id)));
  }

  getDispute(id) {
    return this.request('GET', `/v1/customer/disputes/${encodeURIComponent(id)}`);
  }

  // evidences: [{evidence_type, evidence_info?, notes?}], files: [{name, buffer, type}]
  provideEvidence(id, evidences, files = []) {
    const form = new FormData();
    form.append('input', new Blob([JSON.stringify({ evidences })], { type: 'application/json' }));
    for (const f of files) form.append('evidence-file', new Blob([f.buffer], { type: f.type }), f.name);
    return this.request('POST', `/v1/customer/disputes/${encodeURIComponent(id)}/provide-evidence`, { form });
  }

  sendMessage(id, message) {
    const form = new FormData();
    form.append('input', new Blob([JSON.stringify({ message })], { type: 'application/json' }));
    return this.request('POST', `/v1/customer/disputes/${encodeURIComponent(id)}/send-message`, { form });
  }

  makeOffer(id, { note, amount, currency = 'USD', offerType = 'REFUND', returnAddress }) {
    return this.request('POST', `/v1/customer/disputes/${encodeURIComponent(id)}/make-offer`, {
      json: {
        note,
        offer_type: offerType,
        offer_amount: { currency_code: currency, value: Number(amount).toFixed(2) },
        ...(returnAddress ? { return_shipping_address: returnAddress } : {}),
      },
    });
  }

  acceptClaim(id, { note }) {
    const form = new FormData();
    form.append('input', new Blob([JSON.stringify({ note })], { type: 'application/json' }));
    return this.request('POST', `/v1/customer/disputes/${encodeURIComponent(id)}/accept-claim`, { form });
  }

  // ---- Tracking (prevention) ----
  addTracking(trackers) {
    return this.request('POST', '/v1/shipping/trackers-batch', {
      json: {
        trackers: trackers.map((t) => ({
          transaction_id: t.transaction_id,
          tracking_number: t.tracking_number,
          status: t.status === 'DELIVERED' ? 'DELIVERED' : 'SHIPPED',
          carrier: t.carrier,
        })),
      },
    });
  }

  // ---- Sandbox-only demo helpers ----
  requireSellerEvidence(id) {
    return this.request('POST', `/v1/customer/disputes/${encodeURIComponent(id)}/require-evidence`, { json: { action: 'SELLER_EVIDENCE' } });
  }

  adjudicate(id, outcome) {
    return this.request('POST', `/v1/customer/disputes/${encodeURIComponent(id)}/adjudicate`, { json: { adjudication_outcome: outcome } });
  }
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}
