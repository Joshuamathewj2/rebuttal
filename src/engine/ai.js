// Two AI steps, each with a deterministic fallback so Rebuttal runs without a key:
//   1. extractSignals - read buyer/seller messages and the listing for facts that
//      move the case (written admission of receipt, partial problem, disclosed trait)
//   2. draftResponse  - write the response to PayPal as sentences that each cite
//      evidence ids, plus a message to the buyer. grounding.js verifies the citations.

import Anthropic from '@anthropic-ai/sdk';
import { REASON_LABELS } from './policy.js';
import { day } from './evidence.js';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
let client = null;
export function aiEnabled() {
  if (process.env.REBUTTAL_AI === 'off') return false;
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return false;
  client ??= new Anthropic();
  return true;
}
export const aiModel = () => (aiEnabled() ? MODEL : 'rules');

async function claudeJSON({ system, user, schema, effort = 'medium' }) {
  const res = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort, format: { type: 'json_schema', schema } },
    system,
    messages: [{ role: 'user', content: user }],
  });
  if (res.stop_reason === 'refusal') throw new Error(`Model declined: ${res.stop_details?.category || 'unknown'}`);
  if (res.stop_reason === 'max_tokens') throw new Error('Model output truncated');
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return JSON.parse(text);
}

// ---------------------------------------------------------------- signals ----

const SIGNAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['admissions', 'partial_issue', 'disclosed_in_listing', 'damage_claim', 'buyer_goal', 'summary'],
  properties: {
    admissions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['quote', 'comm_id', 'meaning'],
        properties: { quote: { type: 'string' }, comm_id: { type: 'string' }, meaning: { type: 'string' } },
      },
    },
    partial_issue: {
      type: 'object',
      additionalProperties: false,
      required: ['value', 'affected_share', 'reason'],
      properties: { value: { type: 'boolean' }, affected_share: { type: 'number' }, reason: { type: 'string' } },
    },
    disclosed_in_listing: {
      type: 'object',
      additionalProperties: false,
      required: ['value', 'reason'],
      properties: { value: { type: 'boolean' }, reason: { type: 'string' } },
    },
    damage_claim: { type: 'boolean' },
    buyer_goal: { type: 'string', enum: ['refund', 'replacement', 'item', 'information', 'unclear'] },
    summary: { type: 'string' },
  },
};

const SIGNAL_SYSTEM = `You analyse e-commerce payment disputes for a small online seller.
You read the buyer's dispute messages, the seller's email history with the buyer, and the product listing, and report facts that matter for the dispute.

- admissions: only messages written by the BUYER, sent after the carrier delivery date, that show the buyer had the item in hand. Copy the quote verbatim (a short exact substring). Leave empty if none.
- partial_issue: true only if the buyer's own words say part of the order is fine and part is affected. affected_share is the affected fraction of the item value (0-1), e.g. 1 of 2 identical mugs = 0.5.
- disclosed_in_listing: true only if the specific problem the buyer complains about is a characteristic the listing explicitly discloses (e.g. "glaze varies"). Physical damage such as chips or cracks is never a disclosed characteristic.
- damage_claim: buyer says the item arrived broken, chipped, cracked or damaged.
- summary: one neutral sentence describing what the buyer is claiming.
Do not speculate about buyer honesty.`;

export async function extractSignals({ dispute, order }) {
  const input = {
    reason: REASON_LABELS[dispute.reason] || dispute.reason,
    carrier_delivered_on: day(order.fulfillment?.delivered_at),
    dispute_messages: dispute.messages.filter((m) => m.posted_by === 'BUYER').map((m) => ({ date: day(m.time_posted), text: m.content })),
    email_history: (order.communications || []).map((c) => ({ comm_id: c.id, date: day(c.at), from: c.from, text: c.text })),
    listing: order.items.map((i) => ({ item: i.name, qty: i.qty, unit_price: i.unit_price, description: i.description })),
  };
  let signals;
  let engine = 'rules';
  if (aiEnabled()) {
    try {
      signals = await claudeJSON({ system: SIGNAL_SYSTEM, user: JSON.stringify(input, null, 2), schema: SIGNAL_SCHEMA, effort: 'medium' });
      engine = MODEL;
    } catch (err) {
      signals = null;
      console.warn(`[ai] signal extraction fell back to rules: ${err.message}`);
    }
  }
  signals ??= ruleSignals({ dispute, order });
  // Never trust a quote the model could have invented: it must appear verbatim in a buyer message.
  signals.admissions = (signals.admissions || []).filter((a) => {
    const c = (order.communications || []).find((x) => x.id === a.comm_id);
    return c && c.from === 'buyer' && c.text.includes(a.quote) && (!order.fulfillment?.delivered_at || c.at >= order.fulfillment.delivered_at);
  });
  return { ...signals, engine };
}

export function ruleSignals({ dispute, order }) {
  const delivered = order.fulfillment?.delivered_at;
  const buyerComms = (order.communications || []).filter((c) => c.from === 'buyer' && (!delivered || c.at >= delivered));
  const admissions = buyerComms
    .filter((c) => /\b(got|received|arrived|came)\b/i.test(c.text) && !/\b(never|not|haven'?t|didn'?t)\b/i.test(c.text))
    .map((c) => ({ quote: c.text.split(/(?<=[.!?])\s/)[0], comm_id: c.id, meaning: 'Buyer confirms the order arrived.' }));
  const complaint = [...dispute.messages.filter((m) => m.posted_by === 'BUYER').map((m) => m.content), ...buyerComms.map((c) => c.text)].join(' ');
  const units = order.items.reduce((s, i) => s + i.qty, 0);
  const partial = /\bone of the (two|\d+)\b|\bthe other (one )?is (fine|lovely|ok|okay|perfect)\b/i.test(complaint) && units > 1;
  const damage = /\b(chip|chipped|crack|cracked|broke|broken|shatter|damaged)\b/i.test(complaint);
  const listing = order.items.map((i) => i.description).join(' ').toLowerCase();
  const traits = [
    ['colour', /\b(colou?r|shade|greener|bluer|darker|lighter)\b/i, /\b(varies|variation|shifts|unique)\b/],
    ['pinholes', /\bpinholes?\b/i, /\bpinholes?\b/],
    ['size', /\b(too (big|small|large)|bigger|smaller)\b/i, /\b\d+(\.\d+)?\s?(in|inch|oz)\b/],
  ];
  const hit = traits.find(([, c, l]) => c.test(complaint) && l.test(listing));
  return {
    admissions,
    partial_issue: { value: partial, affected_share: partial ? 1 / units : 0, reason: partial ? 'Buyer says only part of the order is affected.' : 'No partial-problem language.' },
    disclosed_in_listing: hit && !damage
      ? { value: true, reason: `The listing discloses ${hit[0]} variation, which is what the buyer describes.` }
      : { value: false, reason: damage ? 'Physical damage is not a disclosed characteristic.' : 'Complaint does not match a disclosed characteristic.' },
    damage_claim: damage,
    buyer_goal: /refund/i.test(complaint) ? 'refund' : /where is|still nothing|status/i.test(complaint) ? 'information' : 'unclear',
    summary: dispute.messages[0]?.content ? `Buyer says: "${dispute.messages[0].content.slice(0, 140)}"` : 'No buyer statement; raised as a bank chargeback.',
  };
}

// ----------------------------------------------------------------- drafting ----

const DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['sentences', 'buyer_message', 'offer_note'],
  properties: {
    sentences: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'cites'],
        properties: { text: { type: 'string' }, cites: { type: 'array', items: { type: 'string' } } },
      },
    },
    buyer_message: { type: 'string' },
    offer_note: { type: 'string' },
  },
};

const DRAFT_SYSTEM = `You write dispute responses for a small online seller to submit to PayPal through the Disputes API.

Hard rules:
- Every factual sentence must cite one or more evidence ids from the list provided (e.g. ["E2"]). Use only facts that appear in the cited evidence; copy dates, amounts and tracking numbers exactly as written there.
- Never invent facts, never guess, never accuse the buyer of lying. Neutral, specific, professional.
- 4 to 8 sentences. Lead with the strongest evidence for this dispute reason. A closing request sentence may have no citation if it contains no facts.
- buyer_message: a short, warm message to the buyer that helps resolve the case (e.g. asks them to check with neighbours/building staff, shares tracking, explains the offer). Empty string when the stage is CHARGEBACK (no buyer messaging).
- offer_note: if the chosen plan is a partial refund, a one-sentence note explaining the amount; otherwise empty string.`;

export async function draftResponse(ctx) {
  const { dispute, evidence, checks, signals, plan } = ctx;
  if (aiEnabled()) {
    try {
      const user = JSON.stringify({
        reason: REASON_LABELS[dispute.reason] || dispute.reason,
        stage: dispute.dispute_life_cycle_stage,
        amount: dispute.dispute_amount,
        buyer_statement: dispute.messages.filter((m) => m.posted_by === 'BUYER').map((m) => m.content),
        chosen_plan: plan,
        checks: checks.map((c) => ({ check: c.label, status: c.status, detail: c.detail, evidence: c.evidence })),
        signals: { admissions: signals.admissions, partial_issue: signals.partial_issue, disclosed_in_listing: signals.disclosed_in_listing },
        evidence: evidence.map((e) => ({ id: e.id, title: e.title, facts: e.facts })),
      }, null, 2);
      const out = await claudeJSON({ system: DRAFT_SYSTEM, user, schema: DRAFT_SCHEMA, effort: 'high' });
      return { ...out, engine: MODEL };
    } catch (err) {
      console.warn(`[ai] drafting fell back to templates: ${err.message}`);
    }
  }
  return { ...templateDraft(ctx), engine: 'rules' };
}

export function templateDraft({ dispute, order, evidence, signals, plan }) {
  const E = (kind) => evidence.find((e) => e.kind === kind)?.id;
  const f = order.fulfillment || {};
  const s = [];
  const push = (text, ...cites) => s.push({ text, cites: cites.filter(Boolean) });
  const inv = order.invoice_id;
  const chargeback = dispute.dispute_life_cycle_stage !== 'INQUIRY';

  switch (dispute.reason) {
    case 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED':
      push(`Order ${inv} was placed on ${day(order.created)} and shipped to the address on the PayPal transaction.`, E('order'));
      if (f.tracking_number) push(`It shipped on ${day(f.shipped_at)} via ${f.carrier}, tracking number ${f.tracking_number}.`, E('tracking'));
      if (f.status === 'DELIVERED') push(`The carrier recorded the package as delivered on ${day(f.delivered_at)} to ZIP ${f.delivery_zip}, which matches the ship-to address.`, E('tracking'));
      else if (f.estimated_delivery) push(`The package is in transit with a carrier estimated delivery date of ${day(f.estimated_delivery)}, so it is not yet late.`, E('tracking'));
      if (f.signature) push(`Delivery was signed for on ${day(f.delivered_at)}.`, E('signature'));
      if (E('photos')) push(`A photo of the shipping label with tracking ${f.tracking_number} was taken at drop-off.`, E('photos'));
      break;
    case 'UNAUTHORISED':
      push(`Order ${inv} was placed on ${day(order.created)} and delivered by ${f.carrier} on ${day(f.delivered_at)} to the ship-to address on the PayPal transaction.`, E('order'), E('tracking'));
      if (order.risk?.prior_orders) push(`The buyer has ${order.risk.prior_orders} prior completed orders with this store and 0 prior disputes.`, E('history'));
      if (order.risk?.device_seen_before) push('The checkout device was seen on earlier undisputed orders.', E('history'));
      break;
    case 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED':
      push(`Order ${inv} was delivered on ${day(f.delivered_at)}.`, E('order'), E('tracking'));
      push(`The listing described the item as: "${order.items[0].description}"`, E('listing'));
      if (E('photos')) push('Photos of the items wrapped and boxed were taken before shipment.', E('photos'));
      if (plan.id === 'PARTIAL_OFFER') push(`Because the buyer reports that only part of the order is affected, the seller has offered a partial refund of $${plan.offerAmount.toFixed(2)}.`, 'PLAN');
      break;
    case 'CREDIT_NOT_PROCESSED': {
      const r = order.refunds?.[0];
      if (f.return_received_at) push(`The returned item was received on ${day(f.return_received_at)}.`, E('refund'));
      if (r) push(`Refund ${r.id} for $${r.amount.toFixed(2)} was issued through PayPal on ${day(r.at)}.`, E('refund'));
      break;
    }
    default:
      push(`Order ${inv} was placed on ${day(order.created)} for $${order.amount.toFixed(2)}.`, E('order'));
  }
  for (const a of signals.admissions || []) {
    const c = order.communications.find((x) => x.id === a.comm_id);
    push(`On ${day(c.at)} the buyer wrote to the seller: "${a.quote}"`, E('communications'));
    break;
  }
  if (plan.id === 'FIGHT') push('The seller respectfully asks PayPal to resolve this case in the seller\'s favour.');

  let buyer = '';
  if (!chargeback) {
    if (plan.id === 'PARTIAL_OFFER') buyer = `Hi ${order.buyer.name.split(' ')[0]}, I'm really sorry one piece arrived damaged. I've sent a refund offer of $${plan.offerAmount.toFixed(2)} through PayPal to cover it, and you're welcome to keep the rest of the order. Thank you for your patience.`;
    else if (dispute.reason === 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED' && f.status === 'DELIVERED') buyer = `Hi ${order.buyer.name.split(' ')[0]}, I'm sorry for the worry. ${f.carrier} shows your package delivered on ${day(f.delivered_at)} (${f.delivery_location || 'at your address'}), tracking ${f.tracking_number}. Could you check with neighbours or building staff? If it still hasn't turned up, let me know and I'll help file a claim with the carrier.`;
    else if (dispute.reason === 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED') buyer = `Hi ${order.buyer.name.split(' ')[0]}, your order is on its way: ${f.carrier} tracking ${f.tracking_number}, currently estimated to arrive ${day(f.estimated_delivery)}. You can follow it here: ${f.tracking_url}. Sorry for the wait!`;
    else if (dispute.reason === 'CREDIT_NOT_PROCESSED') buyer = `Hi ${order.buyer.name.split(' ')[0]}, your refund of $${order.refunds?.[0]?.amount.toFixed(2)} was issued through PayPal on ${day(order.refunds?.[0]?.at)} (refund ID ${order.refunds?.[0]?.id}). It can take a few days to show on your card or bank statement.`;
  }
  const offer = plan.id === 'PARTIAL_OFFER' ? `Partial refund for the affected item ($${plan.offerAmount.toFixed(2)}); buyer keeps the rest of the order.` : '';
  return { sentences: s, buyer_message: buyer, offer_note: offer };
}
