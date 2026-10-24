import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockPayPal } from '../src/paypal/mock.js';
import { Rebuttal } from '../src/engine/pipeline.js';
import { groundResponse, checkableTokens } from '../src/engine/grounding.js';
import { calibratedPrior } from '../src/engine/policy.js';
import { merchant, orders, history } from '../src/data/seed.js';

process.env.REBUTTAL_AI = 'off';
const make = () => new Rebuttal({ paypal: new MockPayPal(), merchant, orders, history });

test('grounding rejects facts that are not in the cited evidence', () => {
  const evidence = [{ id: 'E1', facts: ['Shipped on 2026-10-02 via USPS, tracking number 9400111899223391945721.'] }];
  const good = groundResponse([{ text: 'It shipped on 2026-10-02 with tracking 9400111899223391945721.', cites: ['E1'] }], evidence);
  assert.equal(good.ok, true);
  const wrongDate = groundResponse([{ text: 'It was delivered on 2026-10-09.', cites: ['E1'] }], evidence);
  assert.equal(wrongDate.ok, false);
  const uncited = groundResponse([{ text: 'Tracking 9400111899223391945721 shows delivery.', cites: [] }], evidence);
  assert.equal(uncited.ok, false);
  const ghost = groundResponse([{ text: 'Delivered.', cites: ['E9'] }], evidence);
  assert.equal(ghost.ok, false);
  const closing = groundResponse([{ text: 'We ask PayPal to close this case.', cites: [] }], evidence);
  assert.equal(closing.ok, true);
});

test('money tokens are normalised', () => {
  assert.deepEqual(checkableTokens('a refund of $1,240.00'), ['1240.00']);
});

test('prior is calibrated by merchant history', () => {
  const none = calibratedPrior('UNAUTHORISED', []);
  const bad = calibratedPrior('UNAUTHORISED', [{ reason: 'UNAUTHORISED', outcome: 'LOST' }, { reason: 'UNAUTHORISED', outcome: 'LOST' }]);
  assert.ok(bad.p < none.p);
});

test('every seeded draft passes grounding and recommendations make sense', async () => {
  const r = make();
  const expect = { 'PP-D-1003': 'PARTIAL_OFFER', 'PP-D-1004': 'FIGHT', 'PP-D-1006': 'FIGHT' };
  for (const id of ['PP-D-1001', 'PP-D-1002', 'PP-D-1003', 'PP-D-1004', 'PP-D-1005', 'PP-D-1006']) {
    const a = await r.analyze(id);
    assert.equal(a.grounding.ok, true, `${id} draft not grounded`);
    if (expect[id]) assert.equal(a.plan.id, expect[id], id);
  }
  const vase = await r.analyze('PP-D-1002');
  assert.equal(vase.protection.eligible, false, 'no signature on $1,240 order');
  assert.ok(vase.pWin < 0.5);
});

test('execute sends evidence, messages buyer and pushes missing tracking', async () => {
  const r = make();
  const out = await r.execute('PP-D-1001');
  assert.equal(out.ok, true);
  const paths = r.paypal.calls.map((c) => `${c.method} ${c.path}`);
  assert.ok(paths.includes('POST /v1/customer/disputes/PP-D-1001/provide-evidence'));
  assert.ok(paths.includes('POST /v1/customer/disputes/PP-D-1001/send-message'));
  assert.ok(paths.includes('POST /v1/shipping/trackers-batch'));
  const sent = r.paypal.calls.find((c) => c.path.endsWith('provide-evidence')).payload;
  assert.ok(sent.files[0].bytes > 1000, 'PDF packet attached');
  assert.ok(sent.evidences.some((e) => e.evidence_info?.tracking_info?.[0]?.tracking_number));
});

test('execute refuses an edited response with an unsupported claim', async () => {
  const r = make();
  await assert.rejects(
    r.execute('PP-D-1004', { sentences: [{ text: 'The buyer signed for the package on 2026-01-01.', cites: ['E2'] }] }),
    (err) => err.status === 422,
  );
  assert.equal(r.paypal.calls.filter((c) => c.method === 'POST').length, 0, 'nothing was sent');
});

test('partial refund offer goes through make-offer', async () => {
  const r = make();
  await r.execute('PP-D-1003');
  const offer = r.paypal.calls.find((c) => c.path.endsWith('make-offer'));
  assert.equal(offer.payload.offer_type, 'REFUND');
  assert.equal(offer.payload.offer_amount.value, '28.00');
});

test('refund-not-processed submits refund ids', async () => {
  const r = make();
  await r.execute('PP-D-1006');
  const ev = r.paypal.calls.find((c) => c.path.endsWith('provide-evidence')).payload.evidences;
  assert.ok(ev.some((e) => e.evidence_type === 'PROOF_OF_REFUND' && e.evidence_info.refund_ids[0].refund_id === '8WF10377KU312340N'));
});
