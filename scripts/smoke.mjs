// Exercises every API route in mock mode and prints a readable trace.
import { createApp } from '../server.js';
const s = createApp({ PAYPAL_MODE: 'mock' }).listen(3911);
const j = (p, o) => fetch('http://localhost:3911' + p, o).then(async (r) => ({ s: r.status, b: r.headers.get('content-type')?.includes('json') ? await r.json() : (await r.arrayBuffer()).byteLength }));
const post = (p, body) => j(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
const q = await j('/api/disputes');
console.log(q.b.open.map((r) => [r.dispute_id, r.reason_label, r.amount, Math.round(r.pWin * 100) + '%', r.recommended, r.ev, r.timeLeft, r.protection.label].join(' | ')).join('\n'));
for (const r of q.b.open) {
  const a = await j(`/api/disputes/${r.dispute_id}/analysis`);
  if (a.s !== 200) { console.log(r.dispute_id, a.s, a.b); continue; }
  console.log('\n==', r.dispute_id, a.b.plan.id, 'grounded', a.b.grounding.ok, `${a.b.grounding.failed}/${a.b.grounding.total}`, 'signals', a.b.signals.engine);
  a.b.draft.sentences.forEach((x) => console.log('  -', x.text, x.cites.join(','), x.grounded ? '' : '!! ' + x.issues));
  console.log('  msg:', a.b.draft.buyer_message.slice(0, 100));
  console.log('  actions:', a.b.actions.map((x) => x.label).join('; '));
}
const p = await j('/api/disputes/PP-D-1001/packet.pdf'); console.log('\npdf', p.s, p.b, 'bytes');
const e = await post('/api/disputes/PP-D-1001/execute'); console.log('exec', e.s, JSON.stringify(e.b.results.map((r) => [r.label, r.ok])));
const o = await post('/api/disputes/PP-D-1003/execute'); console.log('offer', o.s, JSON.stringify(o.b.results.map((r) => [r.label, r.ok])));
const bad = await post('/api/disputes/PP-D-1004/execute', { sentences: [{ text: 'The buyer signed for delivery on 2026-01-01.', cites: ['E2'] }] }); console.log('tampered', bad.s, bad.b.error, bad.b.sentences?.[0]?.issues);
console.log('prevention', JSON.stringify((await j('/api/prevention')).b));
console.log('sync', JSON.stringify((await post('/api/prevention/sync')).b.pushed));
console.log('calls', (await j('/api/paypal-calls')).b.map((c) => c.method + ' ' + c.path).join('\n  '));
s.close();
