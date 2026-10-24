import { PayPalClient } from './client.js';
import { MockPayPal } from './mock.js';

export function createPayPal(env = process.env) {
  const mode = (env.PAYPAL_MODE || (env.PAYPAL_CLIENT_ID ? 'sandbox' : 'mock')).toLowerCase();
  if (mode === 'mock') return new MockPayPal();
  return new PayPalClient({ clientId: env.PAYPAL_CLIENT_ID, clientSecret: env.PAYPAL_CLIENT_SECRET, env: mode });
}
