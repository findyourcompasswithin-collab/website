/**
 * POST /api/create-payment
 * ─────────────────────────
 * Receives { productId, email } from the website.
 * Builds a signed Payfast payment form and returns it.
 * The browser renders and auto-submits this form to Payfast.
 *
 * Payfast docs: https://developers.payfast.co.za/docs
 */

import crypto from 'crypto';
import { PRODUCTS } from './products.js';

const PAYFAST_SANDBOX_URL = 'https://sandbox.payfast.co.za/eng/process';
const PAYFAST_LIVE_URL    = 'https://www.payfast.co.za/eng/process';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { productId, email, firstName = '', lastName = '' } = req.body;

  // Validate product exists
  const product = PRODUCTS[productId];
  if (!product) {
    return res.status(400).json({ error: 'Unknown product' });
  }

  // Validate email
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  const isSandbox = process.env.PAYFAST_SANDBOX === 'true';
  const siteUrl   = process.env.SITE_URL || 'https://findyourcompasswithin.com';

  // Build Payfast data object (order matters for signature)
  const payfastData = {
    // Merchant details
    merchant_id:   process.env.PAYFAST_MERCHANT_ID,
    merchant_key:  process.env.PAYFAST_MERCHANT_KEY,

    // Redirect URLs
    return_url:    `${siteUrl}/thank-you`,
    cancel_url:    `${siteUrl}/?payment=cancelled`,
    notify_url:    `${siteUrl}/api/payfast-notify`,

    // Buyer info (pre-fills Payfast form)
    name_first:    firstName,
    name_last:     lastName,
    email_address: email,

    // Transaction details
    m_payment_id:  `FYCW-${productId}-${Date.now()}`, // unique reference
    amount:        product.price.toFixed(2),
    item_name:     product.name,
    item_description: `Digital download — ${product.displayName}`,

    // Pass the product ID through so the notify handler knows what to deliver
    custom_str1:   productId,
    custom_str2:   email,
  };

  // Generate MD5 signature
  payfastData.signature = generateSignature(payfastData, process.env.PAYFAST_PASSPHRASE);

  const payfastUrl = isSandbox ? PAYFAST_SANDBOX_URL : PAYFAST_LIVE_URL;

  // Build hidden form HTML that auto-submits
  const formFields = Object.entries(payfastData)
    .map(([key, value]) => `<input type="hidden" name="${key}" value="${escapeHtml(value)}">`)
    .join('\n    ');

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Redirecting to payment...</title>
  <style>
    body { font-family: 'Outfit', sans-serif; background: #2F4F3F; color: #F2E8D9;
           display: flex; align-items: center; justify-content: center;
           min-height: 100vh; margin: 0; text-align: center; }
    .msg { max-width: 340px; }
    h2 { font-family: Georgia, serif; font-size: 22px; font-weight: 400; margin-bottom: 10px; }
    p  { font-size: 13px; opacity: 0.6; line-height: 1.7; }
    .spinner { width: 32px; height: 32px; border: 2px solid rgba(194,164,111,0.3);
               border-top-color: #C2A46F; border-radius: 50%;
               animation: spin 0.8s linear infinite; margin: 20px auto; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="msg">
    <div class="spinner"></div>
    <h2>Taking you to secure payment</h2>
    <p>You are being redirected to Payfast.<br>This should only take a moment.</p>
  </div>
  <form id="pf" method="post" action="${payfastUrl}">
    ${formFields}
  </form>
  <script>document.getElementById('pf').submit();</script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html');
  return res.status(200).send(html);
}

/**
 * Generate Payfast MD5 signature.
 * Sort keys alphabetically, build query string, MD5 hash it.
 */
function generateSignature(data, passphrase = '') {
  // Remove signature field if present
  const { signature: _sig, ...fields } = data;

  // Build query string from all non-empty fields
  const queryString = Object.entries(fields)
    .filter(([, v]) => v !== '' && v !== null && v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v)).replace(/%20/g, '+')}`)
    .join('&');

  const toHash = passphrase
    ? `${queryString}&passphrase=${encodeURIComponent(passphrase).replace(/%20/g, '+')}`
    : queryString;

  return crypto.createHash('md5').update(toHash).digest('hex');
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
