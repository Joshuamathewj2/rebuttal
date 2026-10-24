// Demo merchant data. Everything here is fictional and is only used in mock mode
// (PAYPAL_MODE=mock) or as the order-side record for sandbox transactions.
// Dates are expressed as offsets from "now" so the demo never goes stale.

const DAY = 86_400_000;
const at = (days, hour = 10) => {
  const d = new Date(Date.now() + days * DAY);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

export const merchant = {
  merchant_id: 'FERNHILL7QX2',
  name: 'Fernhill Ceramics',
  email: 'studio@fernhill.example',
  country: 'US',
  address: { address_line_1: '410 Kiln Rd', admin_area_2: 'Asheville', admin_area_1: 'NC', postal_code: '28801', country_code: 'US' },
  return_policy: {
    window_days: 30,
    url: 'https://fernhill.example/returns',
    text: 'Unused items may be returned within 30 days of delivery for a full refund. Items damaged in transit are replaced or refunded on receipt of a photo within 7 days of delivery.',
  },
  economics: {
    dispute_fee: 15, // PayPal standard dispute fee (USD); configurable
    hourly_rate: 40, // value of the owner's time
    manual_minutes_per_dispute: 75,
    cogs_ratio: 0.38, // cost of goods as a share of price
  },
};

// Order-side records, keyed by PayPal seller transaction id.
export const orders = [
  {
    transaction_id: '4KX19370NB771552H',
    invoice_id: 'FH-20931',
    created: at(-24, 15),
    buyer: { name: 'Dana Whitfield', email: 'dana.w@example.net', payer_id: 'BUYERDW01', account_age_days: 2400 },
    ship_to: { name: 'Dana Whitfield', line1: '1187 Larkin St Apt 4', city: 'San Francisco', state: 'CA', postal: '94109', country: 'US' },
    items: [
      { sku: 'MUG-SAGE-2', name: 'Sage Glaze Mug (set of 2)', qty: 1, unit_price: 72.0, description: 'Two wheel-thrown stoneware mugs, 12 oz, sage celadon glaze. Dishwasher safe. Each piece is unique; glaze varies slightly.', listing_url: 'https://fernhill.example/p/mug-sage-2' },
    ],
    shipping: 14.4,
    amount: 86.4,
    currency: 'USD',
    fulfillment: {
      shipped_at: at(-22, 17), carrier: 'USPS', tracking_number: '9400111899223391945721',
      tracking_url: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899223391945721',
      status: 'DELIVERED', delivered_at: at(-18, 14), delivery_location: 'Front door / porch', delivery_zip: '94109',
      address_matches_transaction: true, signature: false, uploaded_to_paypal: false,
      label_photo: true,
    },
    communications: [
      { id: 'C1', at: at(-22, 18), from: 'merchant', channel: 'email', text: 'Your mugs are on the way! USPS tracking 9400111899223391945721.' },
    ],
    risk: { ip_country: 'US', device_seen_before: true, prior_orders: 2, prior_disputes: 0 },
    refunds: [],
  },
  {
    transaction_id: '7RT55021HJ3390514',
    invoice_id: 'FH-20877',
    created: at(-30, 11),
    buyer: { name: 'Marcus Ilunga', email: 'm.ilunga@example.org', payer_id: 'BUYERMI02', account_age_days: 41 },
    ship_to: { name: 'Marcus Ilunga', line1: '42 W 89th St', city: 'New York', state: 'NY', postal: '10024', country: 'US' },
    items: [
      { sku: 'VASE-FLOOR-XL', name: 'Ashwood Floor Vase, 28 in', qty: 1, unit_price: 1180.0, description: 'Hand-built floor vase, 28 inches, ash glaze. One of a kind. Ships crated.', listing_url: 'https://fernhill.example/p/vase-floor-xl' },
    ],
    shipping: 60.0,
    amount: 1240.0,
    currency: 'USD',
    fulfillment: {
      shipped_at: at(-27, 16), carrier: 'UPS', tracking_number: '1Z999AA10123456784',
      tracking_url: 'https://www.ups.com/track?tracknum=1Z999AA10123456784',
      status: 'DELIVERED', delivered_at: at(-23, 12), delivery_location: 'Left with doorman', delivery_zip: '10024',
      address_matches_transaction: true, signature: false, uploaded_to_paypal: true,
      label_photo: true,
    },
    communications: [
      { id: 'C1', at: at(-27, 17), from: 'merchant', channel: 'email', text: 'Your vase shipped today via UPS, tracking 1Z999AA10123456784. It is crated, so please inspect on arrival.' },
    ],
    risk: { ip_country: 'US', device_seen_before: false, prior_orders: 0, prior_disputes: 0 },
    refunds: [],
  },
  {
    transaction_id: '2MN80412PQ6612093',
    invoice_id: 'FH-20990',
    created: at(-15, 9),
    buyer: { name: 'Priya Raman', email: 'priya.r@example.com', payer_id: 'BUYERPR03', account_age_days: 1650 },
    ship_to: { name: 'Priya Raman', line1: '9 Ellery Sq', city: 'Cambridge', state: 'MA', postal: '02138', country: 'US' },
    items: [
      { sku: 'MUG-SPECK-1', name: 'Speckled Oat Mug', qty: 2, unit_price: 28.0, description: 'Stoneware mug, 14 oz, speckled oatmeal glaze. Small glaze pooling and pinholes are characteristic of the firing and not defects.', listing_url: 'https://fernhill.example/p/mug-speck-1' },
    ],
    shipping: 8.0,
    amount: 64.0,
    currency: 'USD',
    fulfillment: {
      shipped_at: at(-13, 15), carrier: 'USPS', tracking_number: '9400111899223391948813',
      tracking_url: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899223391948813',
      status: 'DELIVERED', delivered_at: at(-9, 13), delivery_location: 'Mailroom', delivery_zip: '02138',
      address_matches_transaction: true, signature: false, uploaded_to_paypal: true,
      label_photo: true, packing_photos: true,
    },
    communications: [
      { id: 'C1', at: at(-8, 20), from: 'buyer', channel: 'email', text: 'Hi, one of the two mugs arrived with a chip on the rim. The other one is lovely. Photo attached.' },
      { id: 'C2', at: at(-7, 9), from: 'merchant', channel: 'email', text: 'So sorry! Could you send one more photo of the box? We will sort it out.' },
    ],
    risk: { ip_country: 'US', device_seen_before: true, prior_orders: 1, prior_disputes: 0 },
    refunds: [],
  },
  {
    transaction_id: '9HB21733LK0045218',
    invoice_id: 'FH-20902',
    created: at(-34, 19),
    buyer: { name: 'Kevin Doyle', email: 'kdoyle@example.net', payer_id: 'BUYERKD04', account_age_days: 3100 },
    ship_to: { name: 'Kevin Doyle', line1: '3301 SE Taylor St', city: 'Portland', state: 'OR', postal: '97214', country: 'US' },
    items: [
      { sku: 'BOWL-SET-4', name: 'Tidepool Serving Bowls (set of 4)', qty: 1, unit_price: 196.0, description: 'Four nesting bowls in tidepool blue. Food safe, oven safe to 400F.', listing_url: 'https://fernhill.example/p/bowl-set-4' },
    ],
    shipping: 16.0,
    amount: 212.0,
    currency: 'USD',
    fulfillment: {
      shipped_at: at(-32, 16), carrier: 'USPS', tracking_number: '9400111899223391950042',
      tracking_url: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899223391950042',
      status: 'DELIVERED', delivered_at: at(-29, 15), delivery_location: 'Front door', delivery_zip: '97214',
      address_matches_transaction: true, signature: false, uploaded_to_paypal: true,
      label_photo: true,
    },
    communications: [
      { id: 'C1', at: at(-28, 21), from: 'buyer', channel: 'email', text: 'Got the bowls today, they are bigger than I expected! Is the blue supposed to look greener in daylight?' },
      { id: 'C2', at: at(-27, 10), from: 'merchant', channel: 'email', text: 'Glad they arrived! Yes, the tidepool glaze shifts toward green in natural light.' },
    ],
    risk: { ip_country: 'US', device_seen_before: true, prior_orders: 6, prior_disputes: 0, same_shipping_address_prior_orders: 6 },
    refunds: [],
  },
  {
    transaction_id: '3DF66019WX2201876',
    invoice_id: 'FH-21011',
    created: at(-9, 8),
    buyer: { name: 'Hannah Okafor', email: 'h.okafor@example.com', payer_id: 'BUYERHO05', account_age_days: 980 },
    ship_to: { name: 'Hannah Okafor', line1: '77 Peachtree Pl NW', city: 'Atlanta', state: 'GA', postal: '30309', country: 'US' },
    items: [
      { sku: 'SPOON-REST', name: 'Moss Spoon Rest', qty: 1, unit_price: 32.0, description: 'Small stoneware spoon rest, moss green.', listing_url: 'https://fernhill.example/p/spoon-rest' },
    ],
    shipping: 6.0,
    amount: 38.0,
    currency: 'USD',
    fulfillment: {
      shipped_at: at(-3, 16), carrier: 'USPS', tracking_number: '9400111899223391952268',
      tracking_url: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899223391952268',
      status: 'IN_TRANSIT', delivered_at: null, estimated_delivery: at(1, 18), delivery_zip: null,
      address_matches_transaction: true, signature: false, uploaded_to_paypal: false,
      label_photo: true,
    },
    communications: [],
    risk: { ip_country: 'US', device_seen_before: false, prior_orders: 0, prior_disputes: 0 },
    refunds: [],
  },
  {
    transaction_id: '6PL40027RE9910335',
    invoice_id: 'FH-20855',
    created: at(-40, 12),
    buyer: { name: 'Tomás Herrera', email: 'tomas.h@example.org', payer_id: 'BUYERTH06', account_age_days: 2200 },
    ship_to: { name: 'Tomás Herrera', line1: '5120 N Broadway', city: 'Chicago', state: 'IL', postal: '60640', country: 'US' },
    items: [
      { sku: 'PLATE-DIN-2', name: 'Dinner Plates (pair)', qty: 1, unit_price: 48.0, description: 'Pair of 10.5 in dinner plates, oat glaze.', listing_url: 'https://fernhill.example/p/plate-din-2' },
    ],
    shipping: 6.0,
    amount: 54.0,
    currency: 'USD',
    fulfillment: {
      shipped_at: at(-38, 15), carrier: 'USPS', tracking_number: '9400111899223391939901',
      tracking_url: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899223391939901',
      status: 'DELIVERED', delivered_at: at(-35, 12), delivery_location: 'Mailbox', delivery_zip: '60640',
      address_matches_transaction: true, signature: false, uploaded_to_paypal: true,
      return_received_at: at(-16, 11), return_tracking_number: '9202190199223300112233',
    },
    communications: [
      { id: 'C1', at: at(-30, 10), from: 'buyer', channel: 'email', text: 'Plates are a bit too large for our cabinets, can I return them?' },
      { id: 'C2', at: at(-30, 15), from: 'merchant', channel: 'email', text: 'Of course. Ship them back and we will refund you in full once they arrive.' },
      { id: 'C3', at: at(-16, 12), from: 'merchant', channel: 'email', text: 'Return received, refund of $54.00 issued to your PayPal account today.' },
    ],
    risk: { ip_country: 'US', device_seen_before: true, prior_orders: 1, prior_disputes: 0 },
    refunds: [{ id: '8WF10377KU312340N', amount: 54.0, at: at(-16, 12) }],
  },
];

// PayPal-shaped disputes (fields mirror GET /v1/customer/disputes/{id}).
function dispute({ id, tx, reason, stage = 'INQUIRY', status = 'WAITING_FOR_SELLER_RESPONSE', created, due, amount, messages, buyerName }) {
  const order = orders.find((o) => o.transaction_id === tx);
  return {
    dispute_id: id,
    create_time: created,
    update_time: created,
    disputed_transactions: [
      {
        seller_transaction_id: tx,
        buyer_transaction_id: tx.split('').reverse().join(''),
        create_time: order.created,
        transaction_status: 'COMPLETED',
        gross_amount: { currency_code: 'USD', value: order.amount.toFixed(2) },
        invoice_number: order.invoice_id,
        buyer: { name: buyerName || order.buyer.name },
        seller: { merchant_id: merchant.merchant_id, name: merchant.name, email: merchant.email },
        items: order.items.map((i) => ({ item_id: i.sku, item_description: i.name, item_quantity: String(i.qty) })),
      },
    ],
    reason,
    status,
    dispute_state: 'REQUIRED_ACTION',
    dispute_amount: { currency_code: 'USD', value: (amount ?? order.amount).toFixed(2) },
    dispute_life_cycle_stage: stage,
    dispute_channel: stage === 'CHARGEBACK' ? 'EXTERNAL' : 'INTERNAL',
    messages: (messages || []).map((m) => ({ posted_by: 'BUYER', time_posted: m.at, content: m.text })),
    seller_response_due_date: due,
    evidences: [],
    links: [],
  };
}

export const disputes = [
  dispute({
    id: 'PP-D-1001', tx: '4KX19370NB771552H', reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
    created: at(-2, 9), due: at(8, 23),
    messages: [{ at: at(-2, 9), text: 'I never received my mugs. Tracking says delivered but there was nothing at my door. I want a refund.' }],
  }),
  dispute({
    id: 'PP-D-1002', tx: '7RT55021HJ3390514', reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
    created: at(-4, 14), due: at(6, 23),
    messages: [{ at: at(-4, 14), text: 'Package never arrived. My building has a doorman and he has no record of it.' }],
  }),
  dispute({
    id: 'PP-D-1003', tx: '2MN80412PQ6612093', reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
    created: at(-5, 11), due: at(5, 23),
    messages: [{ at: at(-5, 11), text: 'One of the two mugs arrived chipped on the rim and is unusable. The other one is fine.' }],
  }),
  dispute({
    id: 'PP-D-1004', tx: '9HB21733LK0045218', reason: 'UNAUTHORISED', stage: 'CHARGEBACK',
    created: at(-3, 16), due: at(4, 23),
    messages: [],
  }),
  dispute({
    id: 'PP-D-1005', tx: '3DF66019WX2201876', reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
    created: at(-1, 7), due: at(1, 6),
    messages: [{ at: at(-1, 7), text: 'Ordered over a week ago and still nothing. Where is my order??' }],
  }),
  dispute({
    id: 'PP-D-1006', tx: '6PL40027RE9910335', reason: 'CREDIT_NOT_PROCESSED',
    created: at(-6, 10), due: at(3, 23),
    messages: [{ at: at(-6, 10), text: 'I returned the plates weeks ago and was promised a refund. Still have not received it.' }],
  }),
];

// Closed disputes from this merchant's history. Used to calibrate win-rate
// priors per reason (Beta-Binomial) so estimates reflect *this* seller.
export const history = [
  { reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', outcome: 'WON', amount: 44 },
  { reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', outcome: 'LOST', amount: 61, cause: 'no tracking uploaded' },
  { reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', outcome: 'LOST', amount: 38, cause: 'missed deadline' },
  { reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', outcome: 'WON', amount: 92 },
  { reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED', outcome: 'LOST', amount: 120, cause: 'no item photos' },
  { reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED', outcome: 'SETTLED', amount: 56 },
  { reason: 'UNAUTHORISED', outcome: 'LOST', amount: 180, cause: 'missed deadline' },
  { reason: 'UNAUTHORISED', outcome: 'WON', amount: 75 },
  { reason: 'CREDIT_NOT_PROCESSED', outcome: 'WON', amount: 30 },
];
