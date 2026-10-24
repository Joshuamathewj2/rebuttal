// Orchestrates one dispute end to end:
//   PayPal dispute + order record -> evidence -> signals -> checks -> win estimate
//   -> option economics -> grounded draft -> concrete PayPal API actions.
// Nothing is sent to PayPal until the seller approves; execution re-runs the
// grounding check on whatever text the seller edited.

import { buildEvidence } from './evidence.js';
import { runChecks, calibratedPrior, winProbability, sellerProtectionStatus, REASON_LABELS, formatHours } from './policy.js';
import { compareOptions } from './economics.js';
import { extractSignals, ruleSignals, draftResponse } from './ai.js';
import { groundResponse } from './grounding.js';
import { renderPacket } from './packet.js';

export class Rebuttal {
  constructor({ paypal, merchant, orders, history }) {
    this.paypal = paypal;
    this.merchant = merchant;
    this.orders = new Map(orders.map((o) => [o.transaction_id, structuredClone(o)]));
    this.history = structuredClone(history);
    this.audit = [];
    this.signalCache = new Map();
    this.outcomes = [];
  }

  orderFor(dispute) {
    return this.orders.get(dispute.disputed_transactions?.[0]?.seller_transaction_id);
  }

  core(dispute, order, signals) {
    const evidence = buildEvidence(order, this.merchant);
    const prior = calibratedPrior(dispute.reason, this.history);
    const checks = runChecks({ dispute, order, evidence, signals });
    const pWin = winProbability(prior, checks);
    const economics = compareOptions({ dispute, order, pWin, signals, merchant: this.merchant });
    const hoursLeft = (new Date(dispute.seller_response_due_date) - Date.now()) / 3_600_000;
    return { evidence, prior, checks, pWin, economics, hoursLeft, protection: sellerProtectionStatus(dispute.reason, checks) };
  }

  summary(dispute) {
    const order = this.orderFor(dispute);
    const base = {
      dispute_id: dispute.dispute_id,
      reason: dispute.reason,
      reason_label: REASON_LABELS[dispute.reason] || dispute.reason,
      amount: Number(dispute.dispute_amount.value),
      currency: dispute.dispute_amount.currency_code,
      stage: dispute.dispute_life_cycle_stage,
      status: dispute.status,
      buyer: dispute.disputed_transactions?.[0]?.buyer?.name,
      due: dispute.seller_response_due_date,
      outcome: dispute.dispute_outcome?.outcome_code || null,
    };
    if (!order) return { ...base, needsOrder: true };
    const signals = this.signalCache.get(dispute.dispute_id) || ruleSignals({ dispute, order });
    const c = this.core(dispute, order, signals);
    const best = c.economics.options[0];
    return {
      ...base,
      items: order.items.map((i) => i.name).join(', '),
      pWin: c.pWin,
      hoursLeft: c.hoursLeft,
      timeLeft: formatHours(Math.max(0, c.hoursLeft)),
      recommended: best.id,
      recommendedLabel: best.label,
      ev: best.ev,
      protection: c.protection,
      // Urgency blends money at stake with time pressure so a $1,200 case due in
      // 6 days and a $38 case due tonight both surface near the top.
      // Anything due within a day jumps the queue regardless of size.
      urgency: (best.ev + 1) / Math.max(4, c.hoursLeft) + (c.hoursLeft < 24 ? 1e6 : 0),
    };
  }

  async queue() {
    const disputes = await this.paypal.listDisputes();
    const rows = disputes.map((d) => this.summary(d));
    const open = rows.filter((r) => r.status !== 'RESOLVED' && !r.needsOrder).sort((a, b) => b.urgency - a.urgency);
    return { open, other: rows.filter((r) => r.status === 'RESOLVED' || r.needsOrder) };
  }

  async analyze(id, { option } = {}) {
    const dispute = await this.paypal.getDispute(id);
    const order = this.orderFor(dispute);
    if (!order) return { dispute, needsOrder: true };
    let signals = this.signalCache.get(id);
    if (!signals) {
      signals = await extractSignals({ dispute, order });
      this.signalCache.set(id, signals);
    }
    const c = this.core(dispute, order, signals);
    const plan = c.economics.options.find((o) => o.id === (option || c.economics.recommended)) || c.economics.options[0];
    const groundingEvidence = withPlanFacts(c.evidence, plan);
    const draft = await draftResponse({ dispute, order, evidence: groundingEvidence, checks: c.checks, signals, plan });
    const grounding = groundResponse(draft.sentences, groundingEvidence);
    return {
      dispute: { ...this.summary(dispute), messages: dispute.messages, evidences: dispute.evidences, offer: dispute.offer || null },
      order,
      signals,
      ...c,
      plan,
      draft: { ...draft, sentences: grounding.sentences },
      grounding: { ok: grounding.ok, failed: grounding.failed, total: grounding.total },
      actions: this.actionsFor({ dispute, plan, evidence: c.evidence, draft }).map(describeAction),
    };
  }

  actionsFor({ dispute, plan, evidence, draft }) {
    const chargeback = dispute.dispute_life_cycle_stage !== 'INQUIRY';
    const narrative = draft.sentences.map((s) => s.text).join(' ');
    const actions = [];
    if (plan.id === 'FIGHT') {
      const cited = new Set(draft.sentences.flatMap((s) => s.cites));
      const chosen = evidence.filter((e) => cited.has(e.id) || ['tracking', 'refund'].includes(e.kind));
      const evidences = chosen.map((e, i) => ({
        evidence_type: e.evidence_type,
        notes: (i === 0 ? narrative : `${e.id}: ${e.title}`).slice(0, 2000),
        ...(e.tracking ? { evidence_info: { tracking_info: [e.tracking] } } : {}),
        ...(e.refund_ids ? { evidence_info: { refund_ids: e.refund_ids } } : {}),
      }));
      actions.push({ type: 'provide_evidence', evidences, attach: true });
    } else if (plan.id === 'PARTIAL_OFFER') {
      actions.push({ type: 'make_offer', offerType: 'REFUND', amount: plan.offerAmount, note: draft.offer_note || narrative.slice(0, 2000) });
    } else if (plan.id === 'REFUND_WITH_RETURN') {
      actions.push({ type: 'make_offer', offerType: 'REFUND_WITH_RETURN', amount: Number(dispute.dispute_amount.value), note: 'Full refund once the item is returned.', returnAddress: this.merchant.address });
    } else if (plan.id === 'ACCEPT') {
      actions.push({ type: 'accept_claim', note: 'Seller accepts the claim and refunds the buyer.' });
    }
    if (!chargeback && draft.buyer_message?.trim() && plan.id !== 'ACCEPT') actions.push({ type: 'send_message', message: draft.buyer_message.trim().slice(0, 2000) });
    return actions;
  }

  async packet(id, { option } = {}) {
    const a = await this.analyze(id, { option });
    const dispute = await this.paypal.getDispute(id);
    return renderPacket({ dispute, order: a.order, merchant: this.merchant, evidence: a.evidence, response: a.draft });
  }

  // Seller approved. `edits` may replace the drafted sentences or buyer message.
  async execute(id, { option, sentences, buyer_message, offer_note } = {}) {
    const a = await this.analyze(id, { option });
    if (a.needsOrder) throw httpError(409, 'No order record for this transaction');
    if (a.hoursLeft <= 0) throw httpError(409, 'The response deadline has passed');
    const draft = {
      sentences: sentences || a.draft.sentences.map(({ text, cites }) => ({ text, cites })),
      buyer_message: buyer_message ?? a.draft.buyer_message,
      offer_note: offer_note ?? a.draft.offer_note,
    };
    const grounding = groundResponse(draft.sentences, withPlanFacts(a.evidence, a.plan));
    if (!grounding.ok) {
      throw httpError(422, 'Response failed the grounding check', { sentences: grounding.sentences.filter((s) => !s.grounded) });
    }
    const dispute = await this.paypal.getDispute(id);
    const actions = this.actionsFor({ dispute, plan: a.plan, evidence: a.evidence, draft });
    const results = [];
    for (const act of actions) {
      const started = Date.now();
      try {
        let res;
        if (act.type === 'provide_evidence') {
          const pdf = await renderPacket({ dispute, order: a.order, merchant: this.merchant, evidence: a.evidence, response: draft });
          res = await this.paypal.provideEvidence(id, act.evidences, [{ name: `evidence-${id}.pdf`, buffer: pdf, type: 'application/pdf' }]);
        } else if (act.type === 'make_offer') {
          res = await this.paypal.makeOffer(id, act);
        } else if (act.type === 'accept_claim') {
          res = await this.paypal.acceptClaim(id, act);
        } else if (act.type === 'send_message') {
          res = await this.paypal.sendMessage(id, act.message);
        }
        results.push({ ...describeAction(act), ok: true, ms: Date.now() - started, response: res });
      } catch (err) {
        results.push({ ...describeAction(act), ok: false, ms: Date.now() - started, error: err.message, debugId: err.debugId });
        break; // do not message the buyer if the main action failed
      }
    }
    // Prevention side effect: make sure PayPal has this order's tracking.
    const f = a.order.fulfillment;
    if (f?.tracking_number && !f.uploaded_to_paypal) {
      try {
        await this.paypal.addTracking([{ transaction_id: a.order.transaction_id, tracking_number: f.tracking_number, carrier: f.carrier, status: f.status }]);
        f.uploaded_to_paypal = true;
        results.push({ type: 'add_tracking', label: `Pushed ${f.carrier} tracking to PayPal`, endpoint: 'POST /v1/shipping/trackers-batch', ok: true });
      } catch (err) {
        results.push({ type: 'add_tracking', label: 'Push tracking to PayPal', endpoint: 'POST /v1/shipping/trackers-batch', ok: false, error: err.message });
      }
    }
    const entry = {
      at: new Date().toISOString(),
      dispute_id: id,
      plan: a.plan.id,
      amount: a.dispute.amount,
      pWin: a.pWin,
      ev: a.plan.ev,
      engine: a.draft.engine,
      results: results.map(({ response, ...r }) => r),
    };
    this.audit.unshift(entry);
    this.signalCache.delete(id);
    return { ok: results.every((r) => r.ok), entry, results };
  }

  prevention() {
    const untracked = [];
    const unsigned = [];
    for (const o of this.orders.values()) {
      const f = o.fulfillment || {};
      if (f.tracking_number && !f.uploaded_to_paypal) untracked.push({ transaction_id: o.transaction_id, invoice_id: o.invoice_id, buyer: o.buyer.name, carrier: f.carrier, tracking_number: f.tracking_number, status: f.status, amount: o.amount });
      if (o.amount >= 750 && !f.signature) unsigned.push({ transaction_id: o.transaction_id, invoice_id: o.invoice_id, amount: o.amount, buyer: o.buyer.name });
    }
    return { untracked, unsigned };
  }

  async syncTracking() {
    const { untracked } = this.prevention();
    if (!untracked.length) return { pushed: 0 };
    const res = await this.paypal.addTracking(untracked);
    for (const u of untracked) this.orders.get(u.transaction_id).fulfillment.uploaded_to_paypal = true;
    this.audit.unshift({ at: new Date().toISOString(), dispute_id: null, plan: 'PREVENTION', results: [{ type: 'add_tracking', label: `Pushed ${untracked.length} tracking numbers to PayPal`, endpoint: 'POST /v1/shipping/trackers-batch', ok: true }] });
    return { pushed: untracked.length, response: res };
  }

  insights() {
    const byReason = {};
    for (const h of this.history) {
      const r = (byReason[h.reason] ??= { reason: h.reason, label: REASON_LABELS[h.reason], won: 0, lost: 0, settled: 0, lostAmount: 0 });
      if (h.outcome === 'WON') r.won++;
      else if (h.outcome === 'LOST') { r.lost++; r.lostAmount += h.amount; } else r.settled++;
    }
    const causes = {};
    for (const h of this.history.filter((x) => x.cause)) causes[h.cause] = (causes[h.cause] || 0) + h.amount;
    return {
      byReason: Object.values(byReason),
      lossCauses: Object.entries(causes).map(([cause, amount]) => ({ cause, amount })).sort((a, b) => b.amount - a.amount),
      session: {
        handled: this.audit.filter((e) => e.dispute_id).length,
        expectedRecovered: Math.round(this.audit.filter((e) => e.dispute_id).reduce((s, e) => s + Math.max(0, e.ev || 0), 0) * 100) / 100,
      },
    };
  }

  importOrder(order) {
    if (!order?.transaction_id || !order.items?.length || !order.ship_to) throw httpError(400, 'order needs transaction_id, items and ship_to');
    this.orders.set(order.transaction_id, { communications: [], refunds: [], risk: {}, fulfillment: {}, currency: 'USD', shipping: 0, buyer: { name: order.ship_to.name, account_age_days: 0 }, ...order });
    return this.orders.get(order.transaction_id);
  }
}

function withPlanFacts(evidence, plan) {
  if (plan.id !== 'PARTIAL_OFFER') return evidence;
  return [...evidence, { id: 'PLAN', kind: 'plan', title: 'Proposed resolution', facts: [`Seller is offering a partial refund of $${plan.offerAmount.toFixed(2)}.`] }];
}

function describeAction(a) {
  const labels = {
    provide_evidence: () => [`Submit ${a.evidences.length} evidence items + PDF packet`, 'POST /v1/customer/disputes/{id}/provide-evidence'],
    make_offer: () => [`Offer ${a.offerType === 'REFUND' ? 'refund' : a.offerType.toLowerCase().replaceAll('_', ' ')} of $${Number(a.amount).toFixed(2)}`, 'POST /v1/customer/disputes/{id}/make-offer'],
    accept_claim: () => ['Accept claim and refund buyer', 'POST /v1/customer/disputes/{id}/accept-claim'],
    send_message: () => ['Message the buyer', 'POST /v1/customer/disputes/{id}/send-message'],
  };
  const [label, endpoint] = labels[a.type]();
  const preview = a.type === 'send_message' ? a.message : a.type === 'provide_evidence' ? a.evidences.map((e) => e.evidence_type) : a.note;
  return { type: a.type, label, endpoint, preview };
}

export function httpError(status, message, extra) {
  return Object.assign(new Error(message), { status, extra });
}
