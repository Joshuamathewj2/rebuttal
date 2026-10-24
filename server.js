import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPayPal } from './src/paypal/index.js';
import { Rebuttal } from './src/engine/pipeline.js';
import { aiModel } from './src/engine/ai.js';
import { merchant, orders, history } from './src/data/seed.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp(env = process.env) {
  const paypal = createPayPal(env);
  let rebuttal = new Rebuttal({ paypal, merchant, orders, history });
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(path.join(here, 'public')));

  const route = (fn) => async (req, res) => {
    try {
      res.json(await fn(req, res));
    } catch (err) {
      const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
      if (status >= 500) console.error(err);
      res.status(status).json({ error: err.message, ...(err.extra || {}), debugId: err.debugId });
    }
  };

  app.get('/api/status', route(() => ({
    paypalMode: paypal.mode,
    ai: aiModel(),
    merchant: { name: merchant.name, merchant_id: merchant.merchant_id },
  })));
  app.get('/api/disputes', route(() => rebuttal.queue()));
  app.get('/api/disputes/:id/analysis', route((req) => rebuttal.analyze(req.params.id, { option: req.query.option })));
  app.post('/api/disputes/:id/execute', route((req) => rebuttal.execute(req.params.id, req.body || {})));
  app.get('/api/disputes/:id/packet.pdf', async (req, res) => {
    try {
      const pdf = await rebuttal.packet(req.params.id, { option: req.query.option });
      res.type('application/pdf').set('Content-Disposition', `inline; filename="evidence-${req.params.id}.pdf"`).send(pdf);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });
  app.get('/api/audit', route(() => rebuttal.audit));
  app.get('/api/prevention', route(() => rebuttal.prevention()));
  app.post('/api/prevention/sync', route(() => rebuttal.syncTracking()));
  app.get('/api/insights', route(() => rebuttal.insights()));
  app.post('/api/orders', route((req) => rebuttal.importOrder(req.body)));
  app.get('/api/paypal-calls', route(() => (paypal.calls || []).slice(-50).reverse()));

  // Sandbox/mock helpers for demos.
  app.post('/api/demo/reset', route(() => {
    if (paypal.mode !== 'mock') throw Object.assign(new Error('Reset is only available in mock mode'), { status: 400 });
    paypal.reset();
    rebuttal = new Rebuttal({ paypal, merchant, orders, history });
    return { ok: true };
  }));
  app.post('/api/demo/:id/adjudicate', route((req) => paypal.adjudicate(req.params.id, req.body?.outcome === 'BUYER_FAVOR' ? 'BUYER_FAVOR' : 'SELLER_FAVOR')));

  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, () => {
    console.log(`Rebuttal running on http://localhost:${port}  (PayPal: ${process.env.PAYPAL_MODE || (process.env.PAYPAL_CLIENT_ID ? 'sandbox' : 'mock')}, AI: ${aiModel()})`);
  });
}
