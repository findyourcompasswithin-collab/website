/**
 * /api/paypal-checkout
 * ─────────────────────
 * POST: receives { productId, email } from the checkout modal, creates a
 *       PayPal order in USD at exactly the catalogue price, and returns the
 *       approval URL the browser should redirect to.
 * GET:  PayPal redirects the buyer here after approval (?token=ORDER_ID).
 *       Captures and fulfils via the shared helper, then redirects to the
 *       thank-you page. The webhook covers buyers who never return.
 */

import { PRODUCTS } from './_products.js';
import { createPayPalOrder, captureAndFulfill } from './_paypal.js';

export default async function handler(req, res) {
  if (req.method === 'POST') return handleCreate(req, res);
  if (req.method === 'GET')  return handleReturn(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleCreate(req, res) {
  const { productId, email } = req.body;

  const product = PRODUCTS[productId];
  if (!product) {
    return res.status(400).json({ error: 'Unknown product' });
  }
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  const siteUrl = process.env.SITE_URL || 'https://www.findyourcompasswithin.com';

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

async function handleReturn(req, res) {
  const siteUrl = process.env.SITE_URL || 'https://www.findyourcompasswithin.com';
  const redirect = (url) => {
    res.statusCode = 302;
    res.setHeader('Location', url);
    res.end();
  };

  const orderId = req.query?.token;
  if (!orderId) return redirect(`${siteUrl}/?payment=failed`);

  try {
    const status = await captureAndFulfill(orderId);
    if (status === 'failed') return redirect(`${siteUrl}/?payment=failed`);
    return redirect(`${siteUrl}/thank-you`);
  } catch (err) {
    console.error('[PayPal] Return capture error:', err);
    return redirect(`${siteUrl}/?payment=failed`);
  }
}
