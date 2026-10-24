// In-memory stand-in for the PayPal APIs with the same method surface as
// PayPalClient. It validates request shapes against the Disputes v1 enums so a
// payload that works here is the payload that is sent in sandbox mode.

import { disputes as seedDisputes } from '../data/seed.js';

const EVIDENCE_TYPES = new Set([
  'PROOF_OF_FULFILLMENT', 'PROOF_OF_REFUND', 'PROOF_OF_DELIVERY_SIGNATURE', 'PROOF_OF_RECEIPT_COPY', 'RETURN_POLICY',
  'ITEM_DESCRIPTION', 'PROOF_OF_RESHIPMENT', 'ORDER_DETAILS', 'ONLINE_TRACKING_INFORMATION', 'DELIVERY_RECEIPT',
  'PHOTOS_OF_SHIPPED_ITEM', 'MERCHANT_RESPONSE', 'PROOF_OF_SHIPMENT_POSTAGE', 'LISTING_URL', 'OTHER',
  'PROOF_OF_RETURN', 'CANCELLATION_DETAILS', 'DETAILS_OF_PURCHASE', 'ITEM_DETAILS', 'MERCHANT_CONTACT_DETAILS',
]);
const OFFER_TYPES = new Set(['REFUND', 'REFUND_WITH_RETURN', 'REFUND_WITH_REPLACEMENT', 'REPLACEMENT_WITHOUT_REFUND']);

export class MockPayPal {
  constructor() {
    this.mode = 'mock';
    this.reset();
  }

  reset() {
    this.disputes = new Map(structuredClone(seedDisputes).map((d) => [d.dispute_id, d]));
    this.trackers = [];
    this.calls = [];
  }

  log(method, path, payload) {
    const entry = { at: new Date().toISOString(), method, path, payload };
    this.calls.push(entry);
    return entry;
  }

  async listDisputes() {
    this.log('GET', '/v1/customer/disputes');
    return [...this.disputes.values()].map((d) => structuredClone(d));
  }

  async getDispute(id) {
    this.log('GET', `/v1/customer/disputes/${id}`);
    const d = this.disputes.get(id);
    if (!d) throw Object.assign(new Error(`Dispute ${id} not found`), { status: 404 });
    return structuredClone(d);
  }

  requireOpen(id) {
    const d = this.disputes.get(id);
    if (!d) throw Object.assign(new Error(`Dispute ${id} not found`), { status: 404 });
    if (d.status === 'RESOLVED') throw Object.assign(new Error(`Dispute ${id} is already resolved`), { status: 422 });
    return d;
  }

  async provideEvidence(id, evidences, files = []) {
    const d = this.requireOpen(id);
    if (!Array.isArray(evidences) || !evidences.length) throw Object.assign(new Error('evidences must be a non-empty array'), { status: 400 });
    for (const e of evidences) {
      if (!EVIDENCE_TYPES.has(e.evidence_type)) throw Object.assign(new Error(`Unknown evidence_type ${e.evidence_type}`), { status: 400 });
    }
    const totalBytes = files.reduce((n, f) => n + f.buffer.length, 0);
    if (totalBytes > 50 * 1024 * 1024) throw Object.assign(new Error('Evidence files exceed 50MB'), { status: 400 });
    this.log('POST', `/v1/customer/disputes/${id}/provide-evidence`, { evidences, files: files.map((f) => ({ name: f.name, bytes: f.buffer.length })) });
    d.evidences.push(...evidences.map((e) => ({ ...e, date: new Date().toISOString(), source: 'SUBMITTED_BY_SELLER', documents: files.map((f) => ({ name: f.name })) })));
    d.status = 'UNDER_REVIEW';
    d.dispute_state = 'UNDER_PAYPAL_REVIEW';
    d.update_time = new Date().toISOString();
    return { links: [{ rel: 'self', href: `/v1/customer/disputes/${id}` }] };
  }

  async sendMessage(id, message) {
    const d = this.requireOpen(id);
    if (!message || message.length > 2000) throw Object.assign(new Error('message must be 1-2000 chars'), { status: 400 });
    this.log('POST', `/v1/customer/disputes/${id}/send-message`, { message });
    d.messages.push({ posted_by: 'SELLER', time_posted: new Date().toISOString(), content: message });
    return { links: [] };
  }

  async makeOffer(id, { note, amount, currency = 'USD', offerType = 'REFUND', returnAddress }) {
    const d = this.requireOpen(id);
    if (!OFFER_TYPES.has(offerType)) throw Object.assign(new Error(`Unknown offer_type ${offerType}`), { status: 400 });
    if (offerType === 'REFUND_WITH_RETURN' && !returnAddress) throw Object.assign(new Error('return_shipping_address is required for REFUND_WITH_RETURN'), { status: 400 });
    if (!note) throw Object.assign(new Error('note is required'), { status: 400 });
    if (!(amount > 0) || amount > Number(d.dispute_amount.value)) throw Object.assign(new Error('offer_amount must be > 0 and <= dispute amount'), { status: 400 });
    const payload = { note, offer_type: offerType, offer_amount: { currency_code: currency, value: Number(amount).toFixed(2) } };
    this.log('POST', `/v1/customer/disputes/${id}/make-offer`, payload);
    d.offer = { seller_offered_amount: payload.offer_amount, offer_type: offerType };
    d.status = 'WAITING_FOR_BUYER_RESPONSE';
    d.dispute_state = 'REQUIRED_OTHER_PARTY_ACTION';
    return { links: [] };
  }

  async acceptClaim(id, { note }) {
    const d = this.requireOpen(id);
    this.log('POST', `/v1/customer/disputes/${id}/accept-claim`, { note });
    d.status = 'RESOLVED';
    d.dispute_state = 'RESOLVED';
    d.dispute_outcome = { outcome_code: 'RESOLVED_BUYER_FAVOUR', amount_refunded: d.dispute_amount };
    return { links: [] };
  }

  async addTracking(trackers) {
    this.log('POST', '/v1/shipping/trackers-batch', { trackers });
    this.trackers.push(...trackers);
    return { tracker_identifiers: trackers.map((t) => ({ transaction_id: t.transaction_id, tracking_number: t.tracking_number })), errors: [] };
  }

  async requireSellerEvidence(id) {
    const d = this.requireOpen(id);
    d.status = 'WAITING_FOR_SELLER_RESPONSE';
    return {};
  }

  async adjudicate(id, outcome) {
    const d = this.requireOpen(id);
    d.status = 'RESOLVED';
    d.dispute_state = 'RESOLVED';
    d.dispute_outcome = { outcome_code: outcome === 'SELLER_FAVOR' ? 'RESOLVED_SELLER_FAVOUR' : 'RESOLVED_BUYER_FAVOUR' };
    return {};
  }
}
