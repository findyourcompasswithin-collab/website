/**
 * POST /api/payfast-notify
 * ─────────────────────────
 * Payfast ITN handler. Called after every payment attempt.
 *
 * Verifies the payment (signature, server validation, amount), then hands
 * delivery to the shared fulfilment module (api/fulfill.js), which is also
 * used by the PayPal lane.
 */

import crypto from 'crypto';
import { PRODUCTS } from './_products.js';
import { convertToZar } from './_fx.js';
import { fulfillOrder } from './_fulfill.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  try {
    const data = req.body;

    // ── 1. Verify signature ───────────────────────────────────────────────────
    const receivedSignature = data.signature;
    const expectedSignature = generateSignature(data, process.env.PAYFAST_PASSPHRASE);
    if (receivedSignature !== expectedSignature) {
      console.error('[ITN] Signature mismatch');
      return res.status(400).send('Invalid signature');
    }

    // ── 2. Server-to-server validation ───────────────────────────────────────
    const isSandbox = process.env.PAYFAST_SANDBOX === 'true';
    const validationUrl = isSandbox
      ? 'https://sandbox.payfast.co.za/eng/query/validate'
      : 'https://www.payfast.co.za/eng/query/validate';

    const { signature: _sig, ...dataWithoutSig } = data;
    const queryString = Object.entries(dataWithoutSig)
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v ?? '')).replace(/%20/g, '+')}`)
      .join('&');

    const validationResponse = await fetch(validationUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: queryString,
    });
    const validationText = await validationResponse.text();
    if (validationText !== 'VALID') {
      console.error('[ITN] Validation failed:', validationText);
      return res.status(400).send('Payment validation failed');
    }

    // ── 3. Check payment status ───────────────────────────────────────────────
    if (data.payment_status !== 'COMPLETE') {
      return res.status(200).send('OK');
    }

    // ── 4. Look up product and verify amount ──────────────────────────────────
    const productId     = data.custom_str1;
    const customerEmail = data.custom_str2 || data.email_address;
    const product       = PRODUCTS[productId];

    if (!product) {
      console.error('[ITN] Unknown product:', productId);
      return res.status(200).send('OK');
    }

    // Payfast charges the ZAR conversion of the USD catalogue price. Allow
    // headroom for exchange-rate updates between checkout and notification;
    // the signature check above already blocks tampering.
    const receivedAmount = parseFloat(data.amount_gross);
    const expectedZar = await convertToZar(product.price, 'USD');
    if (receivedAmount < expectedZar * 0.9) {
      console.error('[ITN] Amount mismatch', { receivedAmount, expectedZar });
      return res.status(400).send('Amount mismatch');
    }

    // ── 5. Fulfil the order (booking or download delivery) ────────────────────
    const customerName = [data.name_first, data.name_last].filter(Boolean).join(' ') || 'there';
    const result = await fulfillOrder({
      product,
      productId,
      customerEmail,
      customerName,
      paymentId: data.m_payment_id,
    });

    if (result.ok) {
      console.log(`[ITN] Fulfilled ${productId} for ${customerEmail} via Payfast`);
    }
    return res.status(200).send('OK');

  } catch (err) {
    console.error('[ITN] Unexpected error:', err);
    return res.status(200).send('OK');
  }
}

// ── Signature ─────────────────────────────────────────────────────────────────

function generateSignature(data, passphrase = '') {
  const { signature: _sig, ...fields } = data;
  const queryString = Object.entries(fields)
    .filter(([, v]) => v !== '' && v !== null && v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v)).replace(/%20/g, '+')}`)
    .join('&');
  const toHash = passphrase
    ? `${queryString}&passphrase=${encodeURIComponent(passphrase).replace(/%20/g, '+')}`
    : queryString;
  return crypto.createHash('md5').update(toHash).digest('hex');
}
