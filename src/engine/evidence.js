// Turns the merchant's own order record into a numbered list of evidence items.
// Every fact the AI is later allowed to state must come from one of these items,
// which is what makes the grounding check in grounding.js possible.

export const day = (iso) => (iso ? iso.slice(0, 10) : null);
const money = (n) => `$${Number(n).toFixed(2)}`;

export function buildEvidence(order, merchant) {
  const items = [];
  const add = (e) => items.push({ id: `E${items.length + 1}`, ...e });
  const f = order.fulfillment || {};
  const addr = order.ship_to;
  const addrLine = `${addr.name}, ${addr.line1}, ${addr.city}, ${addr.state} ${addr.postal}, ${addr.country}`;

  add({
    kind: 'order',
    evidence_type: 'ORDER_DETAILS',
    title: `Order ${order.invoice_id}`,
    facts: [
      `Invoice ${order.invoice_id} was placed on ${day(order.created)} for ${money(order.amount)} ${order.currency}.`,
      ...order.items.map((i) => `Item: ${i.qty} x ${i.name} (SKU ${i.sku}) at ${money(i.unit_price)}.`),
      `Shipping charged: ${money(order.shipping)}.`,
      `Ship-to address on the PayPal transaction: ${addrLine}.`,
    ],
  });

  if (f.tracking_number) {
    const status = f.status === 'DELIVERED'
      ? `Carrier status DELIVERED on ${day(f.delivered_at)} (${f.delivery_location || 'location not given'}, ZIP ${f.delivery_zip}).`
      : `Carrier status ${f.status}; estimated delivery ${day(f.estimated_delivery)}.`;
    add({
      kind: 'tracking',
      evidence_type: f.status === 'DELIVERED' ? 'PROOF_OF_FULFILLMENT' : 'ONLINE_TRACKING_INFORMATION',
      title: `${f.carrier} tracking ${f.tracking_number}`,
      facts: [
        `Shipped on ${day(f.shipped_at)} via ${f.carrier}, tracking number ${f.tracking_number}.`,
        status,
        f.address_matches_transaction
          ? `Delivery ZIP matches the ship-to address on the PayPal transaction (${addr.postal}).`
          : `Delivery location does NOT match the ship-to address on the PayPal transaction.`,
        f.signature ? 'Signature confirmation was captured at delivery.' : 'No signature confirmation was purchased.',
        f.uploaded_to_paypal ? 'Tracking was uploaded to PayPal before the dispute.' : 'Tracking had not been uploaded to PayPal.',
      ],
      tracking: { carrier_name: f.carrier, tracking_number: f.tracking_number, tracking_url: f.tracking_url },
    });
  }

  if (f.signature) {
    add({ kind: 'signature', evidence_type: 'PROOF_OF_DELIVERY_SIGNATURE', title: 'Signature confirmation', facts: [`Signed for at delivery on ${day(f.delivered_at)}.`] });
  }

  if (f.packing_photos || f.label_photo) {
    add({
      kind: 'photos',
      evidence_type: 'PHOTOS_OF_SHIPPED_ITEM',
      title: 'Packing and label photos',
      facts: [
        f.packing_photos ? 'Photos of the items wrapped and boxed were taken before shipment.' : null,
        f.label_photo ? `Photo of the shipping label showing tracking ${f.tracking_number} was taken at drop-off.` : null,
      ].filter(Boolean),
    });
  }

  for (const i of order.items) {
    add({ kind: 'listing', evidence_type: 'ITEM_DESCRIPTION', title: `Listing: ${i.name}`, facts: [`Listing text: "${i.description}"`, `Listing URL: ${i.listing_url}`] });
  }

  if (order.communications?.length) {
    add({
      kind: 'communications',
      evidence_type: 'OTHER',
      title: 'Customer correspondence',
      facts: order.communications.map((c) => `${day(c.at)} ${c.from === 'buyer' ? 'Buyer' : 'Seller'} (${c.channel}): "${c.text}"`),
      raw: order.communications,
    });
  }

  const r = order.risk || {};
  if (r.prior_orders || r.device_seen_before || order.buyer.account_age_days) {
    add({
      kind: 'history',
      evidence_type: 'OTHER',
      title: 'Customer history',
      facts: [
        `Buyer has ${r.prior_orders || 0} prior completed orders with this store and ${r.prior_disputes || 0} prior disputes.`,
        r.same_shipping_address_prior_orders ? `${r.same_shipping_address_prior_orders} prior orders shipped to the same address without dispute.` : null,
        r.device_seen_before ? 'The checkout device was seen on earlier undisputed orders.' : 'The checkout device was new to this store.',
        `Buyer PayPal account age: ${order.buyer.account_age_days} days.`,
      ].filter(Boolean),
    });
  }

  if (order.refunds?.length) {
    add({
      kind: 'refund',
      evidence_type: 'PROOF_OF_REFUND',
      title: 'Refund issued through PayPal',
      facts: order.refunds.map((x) => `Refund ${x.id} for ${money(x.amount)} was issued through PayPal on ${day(x.at)}.`)
        .concat(f.return_received_at ? [`Returned item received on ${day(f.return_received_at)} (return tracking ${f.return_tracking_number}).`] : []),
      refund_ids: order.refunds.map((x) => ({ refund_id: x.id })),
    });
  }

  add({
    kind: 'policy',
    evidence_type: 'RETURN_POLICY',
    title: 'Store return policy',
    facts: [`Return policy (${merchant.return_policy.url}): "${merchant.return_policy.text}"`],
  });

  return items;
}

export const findEvidence = (items, kind) => items.find((e) => e.kind === kind);
