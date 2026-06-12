/**
 * PayPal REST API helpers.
 * ────────────────────────
 * PayPal charges natively in USD, so dollar buyers pay exactly the listed
 * catalogue price. Used alongside Payfast (which settles in ZAR).
 *
 * Env vars: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_SANDBOX,
 * PAYPAL_WEBHOOK_ID (for webhook signature verification)
 */

import { PRODUCTS } from './_products.js';
import { fulfillOrder } from './_fulfill.js';

const BASE = process.env.PAYPAL_SANDBOX === 'true'
  ? 'https://api-m.sandbox.paypal.com'
  : 'https://api-m.paypal.com';

async function getAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret   = process.env.PAYPAL_CLIENT_SECRET;
  const credentials = Buffer.from(`${clientId}:${secret}`).toString('base64');

  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  const data = await res.json();
  if (!data.access_token) {
    console.error('[PayPal] Token error:', data);
    throw new Error('PayPal authentication failed');
  }
  return data.access_token;
}

/** Create a PayPal order for a catalogue product. Returns PayPal's order object. */
export async function createPayPalOrder({ product, productId, email, siteUrl }) {
  const token = await getAccessToken();

  const res = await fetch(`${BASE}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: productId,
          // The capture handler reads productId and email back out of custom_id
          custom_id: `${productId}|${email}`.slice(0, 127),
          description: String(product.displayName).slice(0, 127),
          amount: {
            currency_code: 'USD',
            value: product.price.toFixed(2),
          },
        },
      ],
      application_context: {
        return_url: `${siteUrl}/api/paypal-checkout`,
        cancel_url: `${siteUrl}/?payment=cancelled`,
        brand_name: 'Find Your Compass Within',
        shipping_preference: 'NO_SHIPPING',
        user_action: 'PAY_NOW',
      },
    }),
  });

  return res.json();
}

/** Capture an approved PayPal order. Returns PayPal's capture object. */
export async function capturePayPalOrder(orderId) {
  const token = await getAccessToken();

  const res = await fetch(`${BASE}/v2/checkout/orders/${orderId}/capture`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  return res.json();
}

/**
 * Capture an approved order and deliver it. Called from both the buyer's
 * return redirect and the webhook; whichever arrives second receives
 * ORDER_ALREADY_CAPTURED from PayPal and skips, so delivery happens once.
 * Returns 'fulfilled', 'already', or 'failed'.
 */
export async function captureAndFulfill(orderId) {
  const capture = await capturePayPalOrder(orderId);

  const alreadyCaptured = capture.name === 'UNPROCESSABLE_ENTITY' &&
    Array.isArray(capture.details) &&
    capture.details.some((d) => d.issue === 'ORDER_ALREADY_CAPTURED');
  if (alreadyCaptured) return 'already';

  if (capture.status !== 'COMPLETED') {
    console.error('[PayPal] Capture not completed:', capture);
    return 'failed';
  }

  const unit = capture.purchase_units?.[0];
  const cap  = unit?.payments?.captures?.[0];

  const customId = cap?.custom_id || unit?.custom_id || '';
  const [productId, checkoutEmail] = customId.split('|');
  const product = PRODUCTS[productId];

  const customerEmail = checkoutEmail || capture.payer?.email_address;
  if (!product || !customerEmail) {
    console.error('[PayPal] Missing product or email after capture:', { customId, orderId });
    return 'failed';
  }

  // PayPal charges exactly the USD catalogue price; verify it arrived.
  const paid = parseFloat(cap?.amount?.value ?? '0');
  if (cap?.amount?.currency_code !== 'USD' || paid < product.price - 0.01) {
    console.error('[PayPal] Amount mismatch', { paid, expected: product.price });
    return 'failed';
  }

  const customerName = [capture.payer?.name?.given_name, capture.payer?.name?.surname]
    .filter(Boolean).join(' ') || 'there';

  const result = await fulfillOrder({
    product,
    productId,
    customerEmail,
    customerName,
    paymentId: cap?.id || orderId,
    paymentMethod: 'paypal',
  });

  if (result.ok) console.log(`[PayPal] Fulfilled ${productId} for ${customerEmail}`);
  return 'fulfilled';
}

/** Verify that a webhook event genuinely came from PayPal. */
export async function verifyWebhookSignature({ headers, event }) {
  const token = await getAccessToken();

  const res = await fetch(`${BASE}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      auth_algo:         headers['paypal-auth-algo'],
      cert_url:          headers['paypal-cert-url'],
      transmission_id:   headers['paypal-transmission-id'],
      transmission_sig:  headers['paypal-transmission-sig'],
      transmission_time: headers['paypal-transmission-time'],
      webhook_id:        process.env.PAYPAL_WEBHOOK_ID,
      webhook_event:     event,
    }),
  });

  const data = await res.json();
  return data.verification_status === 'SUCCESS';
}
