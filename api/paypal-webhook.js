/**
 * POST /api/paypal-webhook
 * ─────────────────────────
 * PayPal calls this the moment an order is approved, independently of
 * whether the buyer ever returns to the site. Guarantees delivery even if
 * a guest closes PayPal's "purchase complete" page without clicking back.
 *
 * Requires PAYPAL_WEBHOOK_ID (from the webhook created on the Live app at
 * developer.paypal.com) for signature verification.
 */

import { verifyWebhookSignature, captureAndFulfill } from './_paypal.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  try {
    const event = req.body;

    const genuine = await verifyWebhookSignature({ headers: req.headers, event });
    if (!genuine) {
      console.error('[PayPal Webhook] Signature verification failed');
      return res.status(400).send('Invalid signature');
    }

    if (event.event_type === 'CHECKOUT.ORDER.APPROVED') {
      const orderId = event.resource?.id;
      if (orderId) {
        const status = await captureAndFulfill(orderId);
        console.log(`[PayPal Webhook] Order ${orderId}: ${status}`);
      }
    }

    return res.status(200).send('OK');
  } catch (err) {
    console.error('[PayPal Webhook] Error:', err);
    return res.status(200).send('OK');
  }
}
