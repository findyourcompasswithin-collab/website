/**
 * PayPal REST API helpers.
 * ────────────────────────
 * PayPal charges natively in USD, so dollar buyers pay exactly the listed
 * catalogue price. Used alongside Payfast (which settles in ZAR).
 *
 * Env vars: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_SANDBOX
 */

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
        return_url: `${siteUrl}/api/paypal-capture`,
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
