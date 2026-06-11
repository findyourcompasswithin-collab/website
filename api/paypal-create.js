/**
 * POST /api/paypal-create
 * ────────────────────────
 * Receives { productId, email } from the checkout modal.
 * Creates a PayPal order in USD at exactly the catalogue price and returns
 * the approval URL the browser should redirect to.
 */

import { PRODUCTS } from './products.js';
import { createPayPalOrder } from './paypal.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { productId, email } = req.body;

  const product = PRODUCTS[productId];
  if (!product) {
    return res.status(400).json({ error: 'Unknown product' });
  }
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  const siteUrl = process.env.SITE_URL || 'https://findyourcompasswithin.com';

  try {
    const order = await createPayPalOrder({ product, productId, email, siteUrl });

    const approvalUrl = Array.isArray(order.links)
      ? order.links.find((l) => l.rel === 'approve')?.href
      : null;

    if (!approvalUrl) {
      console.error('[PayPal] No approval URL:', order);
      return res.status(500).json({ error: 'PayPal is unavailable right now. Please use the Payfast option.' });
    }

    return res.status(200).json({ approvalUrl });
  } catch (err) {
    console.error('[PayPal] Create order error:', err);
    return res.status(500).json({ error: 'PayPal is unavailable right now. Please use the Payfast option.' });
  }
}
