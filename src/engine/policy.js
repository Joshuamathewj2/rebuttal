// Reason-specific checks modelled on PayPal Seller Protection requirements and
// common representment practice. Each check carries a log-odds weight so the win
// estimate is fully explainable: prior (from this seller's history) + factors.
//
// These rules are a simplified model of public PayPal policy, not legal advice;
// thresholds live in one place so a merchant can adjust them.

import { findEvidence } from './evidence.js';

export const RULES = {
  signatureThresholdUSD: 750,
  shipWithinDays: 7,
};

export const REASON_LABELS = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: 'Item not received',
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: 'Not as described',
  UNAUTHORISED: 'Unauthorized transaction',
  CREDIT_NOT_PROCESSED: 'Refund not processed',
  DUPLICATE_TRANSACTION: 'Duplicate charge',
  INCORRECT_AMOUNT: 'Incorrect amount',
  PAYMENT_BY_OTHER_MEANS: 'Paid by other means',
  CANCELED_RECURRING_BILLING: 'Cancelled subscription',
  OTHER: 'Other',
};

// Population priors (alpha, beta) per reason, before this merchant's history.
const PRIORS = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: [3, 4],
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: [2, 6],
  UNAUTHORISED: [2, 5],
  CREDIT_NOT_PROCESSED: [4, 3],
  DUPLICATE_TRANSACTION: [3, 3],
};

export function calibratedPrior(reason, history) {
  const [a0, b0] = PRIORS[reason] || [2, 4];
  const relevant = history.filter((h) => h.reason === reason && h.outcome !== 'SETTLED');
  const wins = relevant.filter((h) => h.outcome === 'WON').length;
  const losses = relevant.length - wins;
  return { p: (a0 + wins) / (a0 + b0 + wins + losses), wins, losses, alpha: a0 + wins, beta: b0 + losses };
}

const check = (id, label, status, detail, weight, evidence = []) => ({ id, label, status, detail, weight, evidence });
const daysBetween = (a, b) => (new Date(b) - new Date(a)) / 86_400_000;

export function runChecks({ dispute, order, evidence, signals }) {
  const reason = dispute.reason;
  const amount = Number(dispute.dispute_amount.value);
  const f = order.fulfillment || {};
  const tracking = findEvidence(evidence, 'tracking');
  const comms = findEvidence(evidence, 'communications');
  const history = findEvidence(evidence, 'history');
  const refund = findEvidence(evidence, 'refund');
  const photos = findEvidence(evidence, 'photos');
  const listing = evidence.filter((e) => e.kind === 'listing').map((e) => e.id);
  const ids = (...xs) => xs.filter(Boolean).map((x) => x.id);
  const out = [];

  const shippingChecks = (strict) => {
    if (!f.tracking_number) {
      out.push(check('tracking', 'Online tracking exists', 'fail', 'No tracking number on file. Seller Protection requires trackable proof of delivery.', -2.2));
      return;
    }
    out.push(check('tracking', 'Online tracking exists', 'pass', `${f.carrier} ${f.tracking_number}`, 0.4, ids(tracking)));
    if (f.status === 'DELIVERED') {
      out.push(check('delivered', 'Carrier confirms delivery', 'pass', `Delivered ${f.delivered_at.slice(0, 10)}`, strict ? 1.6 : 1.0, ids(tracking)));
    } else if (f.estimated_delivery && new Date(f.estimated_delivery) > new Date(dispute.create_time)) {
      out.push(check('delivered', 'Carrier confirms delivery', 'warn', `In transit; carrier estimate ${f.estimated_delivery.slice(0, 10)} is still in the future, so the order is not late.`, 0.6, ids(tracking)));
    } else {
      out.push(check('delivered', 'Carrier confirms delivery', 'fail', `Carrier status is ${f.status}.`, -1.5, ids(tracking)));
    }
    out.push(f.address_matches_transaction
      ? check('address', 'Delivered to the address on the PayPal transaction', 'pass', 'Delivery ZIP matches Transaction Details.', 0.5, ids(tracking))
      : check('address', 'Delivered to the address on the PayPal transaction', 'fail', 'Shipping to an address other than the one on Transaction Details voids Seller Protection.', -2.0, ids(tracking)));
    const shipDays = daysBetween(order.created, f.shipped_at);
    out.push(shipDays <= RULES.shipWithinDays
      ? check('ship_time', `Shipped within ${RULES.shipWithinDays} days of payment`, 'pass', `Shipped ${shipDays.toFixed(1)} days after payment.`, 0.2, ids(tracking))
      : check('ship_time', `Shipped within ${RULES.shipWithinDays} days of payment`, 'warn', `Shipped ${shipDays.toFixed(1)} days after payment.`, -0.6, ids(tracking)));
    if (amount >= RULES.signatureThresholdUSD) {
      out.push(f.signature
        ? check('signature', `Signature confirmation (orders >= $${RULES.signatureThresholdUSD})`, 'pass', 'Signed for at delivery.', 0.8, ids(findEvidence(evidence, 'signature')))
        : check('signature', `Signature confirmation (orders >= $${RULES.signatureThresholdUSD})`, 'fail', `$${amount.toFixed(2)} order shipped without signature confirmation, so it is not covered by Seller Protection.`, -3.5, ids(tracking)));
    }
    out.push(f.uploaded_to_paypal
      ? check('uploaded', 'Tracking uploaded to PayPal before the dispute', 'pass', 'PayPal already had this tracking.', 0.3, ids(tracking))
      : check('uploaded', 'Tracking uploaded to PayPal before the dispute', 'warn', 'Not uploaded. Rebuttal will attach it now and push future tracking automatically.', -0.2, ids(tracking)));
  };

  if (reason === 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED') {
    shippingChecks(true);
  } else if (reason === 'UNAUTHORISED') {
    shippingChecks(false);
    const r = order.risk || {};
    if ((r.same_shipping_address_prior_orders || r.prior_orders || 0) >= 2) {
      out.push(check('repeat_customer', 'Prior undisputed orders from the same customer', 'pass', `${r.prior_orders} earlier orders, ${r.prior_disputes || 0} disputes.`, 1.0, ids(history)));
    }
    if (r.device_seen_before) out.push(check('device', 'Checkout device seen on earlier orders', 'pass', 'Same device as earlier undisputed orders.', 0.4, ids(history)));
    if (order.buyer.account_age_days < 60) out.push(check('new_account', 'Established buyer account', 'warn', `Account is ${order.buyer.account_age_days} days old.`, -0.4, ids(history)));
  } else if (reason === 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED') {
    out.push(check('snad_coverage', 'Seller Protection coverage', 'warn', '"Not as described" claims are not covered by PayPal Seller Protection; the case is decided on the listing and photos.', -0.8));
    out.push(photos
      ? check('photos', 'Photos of item before shipment', 'pass', 'Packing/label photos on file.', 0.5, ids(photos))
      : check('photos', 'Photos of item before shipment', 'fail', 'No pre-shipment photos.', -0.5));
    out.push(listing.length
      ? check('listing', 'Listing description on file', 'pass', 'Listing text captured at time of sale.', 0.2, listing)
      : check('listing', 'Listing description on file', 'fail', 'No listing snapshot.', -0.4));
  } else if (reason === 'CREDIT_NOT_PROCESSED') {
    out.push(refund
      ? check('refund', 'Refund already issued through PayPal', 'pass', refund.facts[0], 3.0, ids(refund))
      : check('refund', 'Refund already issued through PayPal', 'fail', 'No refund on record.', -2.5));
  } else {
    out.push(check('order', 'Order record on file', 'pass', 'Order details available.', 0.2, ids(findEvidence(evidence, 'order'))));
  }

  // Signals extracted from buyer/seller messages (AI or rule-based).
  for (const a of signals.admissions || []) {
    out.push(check('admission', 'Buyer acknowledged receipt in writing', 'pass', `"${a.quote}"`, reason === 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED' ? 0.2 : 1.5, ids(comms)));
    break;
  }
  if (reason === 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED') {
    if (signals.disclosed_in_listing?.value) {
      out.push(check('disclosed', 'Complaint matches something the listing disclosed', 'pass', signals.disclosed_in_listing.reason, 0.9, listing));
    } else {
      out.push(check('disclosed', 'Complaint matches something the listing disclosed', 'fail', signals.disclosed_in_listing?.reason || 'The reported problem is not a disclosed characteristic of the item.', -0.6, listing));
    }
    if (signals.damage_claim) out.push(check('damage', 'Buyer reports transit damage', 'warn', 'Damage claims usually end in a refund or replacement.', -0.6, ids(comms)));
  }

  const hoursLeft = (new Date(dispute.seller_response_due_date) - Date.now()) / 3_600_000;
  out.push(hoursLeft > 0
    ? check('deadline', 'Response deadline', hoursLeft < 48 ? 'warn' : 'pass', `${formatHours(hoursLeft)} left to respond.`, 0)
    : check('deadline', 'Response deadline', 'fail', 'Deadline passed. PayPal decides for the buyer when the seller does not respond.', -9));

  return out;
}

export function formatHours(h) {
  if (h < 1) return `${Math.max(0, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} days`;
}

export function winProbability(prior, checks) {
  const logit = Math.log(prior.p / (1 - prior.p)) + checks.reduce((s, c) => s + c.weight, 0);
  const p = 1 / (1 + Math.exp(-logit));
  return Math.min(0.97, Math.max(0.02, p));
}

export function sellerProtectionStatus(reason, checks) {
  if (!['MERCHANDISE_OR_SERVICE_NOT_RECEIVED', 'UNAUTHORISED'].includes(reason)) return { eligible: false, label: 'Not covered for this reason' };
  const blocking = checks.filter((c) => ['tracking', 'address', 'signature'].includes(c.id) && c.status === 'fail');
  if (blocking.length) return { eligible: false, label: 'Not eligible', why: blocking.map((c) => c.label) };
  const delivered = checks.find((c) => c.id === 'delivered');
  if (delivered?.status !== 'pass') return { eligible: null, label: 'Pending delivery scan' };
  return { eligible: true, label: 'Likely eligible' };
}
