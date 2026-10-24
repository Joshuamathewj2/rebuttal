// Expected-value comparison of the ways a seller can respond. Values are dollars
// recovered relative to simply losing the dispute, so "Accept" is the 0 line.

const REBUTTAL_MINUTES = 4; // review + approve in Rebuttal

export function compareOptions({ dispute, order, pWin, signals, merchant }) {
  const A = Number(dispute.dispute_amount.value);
  const { dispute_fee: fee, hourly_rate: rate, manual_minutes_per_dispute: manualMin, cogs_ratio: cogs } = merchant.economics;
  const timeCost = (min) => (min / 60) * rate;
  const isInquiry = dispute.dispute_life_cycle_stage === 'INQUIRY';
  const options = [];

  const fightEV = pWin * A - (1 - pWin) * fee - timeCost(REBUTTAL_MINUTES);
  options.push({
    id: 'FIGHT',
    label: 'Fight with evidence',
    ev: fightEV,
    detail: `${pct(pWin)} x $${A.toFixed(2)} recovered - ${pct(1 - pWin)} x $${fee} fee if lost - ${REBUTTAL_MINUTES} min of your time`,
  });

  // A partial refund only makes sense when part of the order is genuinely affected.
  if (isInquiry && signals.partial_issue?.value && dispute.reason !== 'UNAUTHORISED') {
    const share = clamp(signals.partial_issue.affected_share ?? 0.5, 0.1, 0.9);
    const itemsTotal = order.items.reduce((s, i) => s + i.qty * i.unit_price, 0);
    const offer = round2(itemsTotal * share);
    const pAccept = 0.72; // partial offers on a clearly partial problem are usually accepted
    const ev = pAccept * (A - offer) + (1 - pAccept) * fightEV - timeCost(REBUTTAL_MINUTES);
    options.push({
      id: 'PARTIAL_OFFER',
      label: `Offer partial refund of $${offer.toFixed(2)}`,
      ev,
      offerAmount: offer,
      detail: `${pct(pAccept)} chance buyer accepts and you keep $${(A - offer).toFixed(2)}; otherwise it proceeds as a fight`,
    });
  }

  if (isInquiry && dispute.reason === 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED' && !signals.damage_claim) {
    const returnLabel = Math.max(order.shipping, 8);
    const ev = A * cogs * 0.85 - returnLabel - timeCost(REBUTTAL_MINUTES);
    options.push({
      id: 'REFUND_WITH_RETURN',
      label: 'Refund after item is returned',
      ev,
      detail: `Recover resellable stock (~$${(A * cogs * 0.85).toFixed(2)} at cost) minus a $${returnLabel.toFixed(2)} return label`,
    });
  }

  options.push({ id: 'ACCEPT', label: 'Accept and refund', ev: 0, detail: 'Buyer keeps the refund; no dispute fee in the inquiry stage' });

  options.sort((a, b) => b.ev - a.ev);
  const best = options[0];
  return {
    options: options.map((o) => ({ ...o, ev: round2(o.ev) })),
    recommended: best.id,
    manualCost: round2(timeCost(manualMin)),
    timeSavedMin: manualMin - REBUTTAL_MINUTES,
  };
}

const pct = (x) => `${Math.round(x * 100)}%`;
const round2 = (x) => Math.round(x * 100) / 100;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
