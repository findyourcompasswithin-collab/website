/**
 * POST /api/payfast-notify
 * ─────────────────────────
 * Payfast calls this endpoint (ITN — Instant Transaction Notification)
 * after every payment attempt, whether successful or not.
 *
 * This function:
 *   1. Verifies the payment signature is genuinely from Payfast
 *   2. Validates the amount matches the product price
 *   3. Checks payment_status === 'COMPLETE'
 *   4. Generates signed Supabase download URLs (expire in 48 hours)
 *   5. Sends a beautiful delivery email via Resend
 *
 * Payfast ITN docs: https://developers.payfast.co.za/docs#itn
 */

import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { PRODUCTS } from './products.js';

// Supabase storage bucket name — create this in your Supabase dashboard
const BUCKET = 'workbooks';

// Signed URL expiry: 48 hours in seconds
const URL_EXPIRY_SECONDS = 172800;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  try {
    const data = req.body; // Vercel parses form body automatically

    // ── STEP 1: Verify Payfast signature ──────────────────────────────────────
    const receivedSignature = data.signature;
    const expectedSignature = generateSignature(data, process.env.PAYFAST_PASSPHRASE);

    if (receivedSignature !== expectedSignature) {
      console.error('[Payfast ITN] Signature mismatch', { received: receivedSignature, expected: expectedSignature });
      return res.status(400).send('Invalid signature');
    }

    // ── STEP 2: Server-to-server validation with Payfast ─────────────────────
    const isSandbox = process.env.PAYFAST_SANDBOX === 'true';
    const validationUrl = isSandbox
      ? 'https://sandbox.payfast.co.za/eng/query/validate'
      : 'https://www.payfast.co.za/eng/query/validate';

    // Rebuild the exact query string Payfast sent (minus signature)
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
      console.error('[Payfast ITN] Validation failed:', validationText);
      return res.status(400).send('Payment validation failed');
    }

    // ── STEP 3: Check payment status ─────────────────────────────────────────
    if (data.payment_status !== 'COMPLETE') {
      console.log('[Payfast ITN] Payment not complete, status:', data.payment_status);
      return res.status(200).send('OK'); // Respond 200 to stop Payfast retrying
    }

    // ── STEP 4: Look up product and verify amount ─────────────────────────────
    const productId = data.custom_str1;
    const customerEmail = data.custom_str2 || data.email_address;
    const product = PRODUCTS[productId];

    if (!product) {
      console.error('[Payfast ITN] Unknown product ID:', productId);
      return res.status(200).send('OK');
    }

    const receivedAmount = parseFloat(data.amount_gross);
    if (Math.abs(receivedAmount - product.price) > 0.01) {
      console.error('[Payfast ITN] Amount mismatch', { received: receivedAmount, expected: product.price });
      return res.status(400).send('Amount mismatch');
    }

    // ── STEP 5: Generate signed Supabase download URLs ────────────────────────
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const downloadLinks = [];

    for (const fileName of product.files) {
      const { data: urlData, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(fileName, URL_EXPIRY_SECONDS);

      if (error) {
        console.error(`[Supabase] Error creating signed URL for ${fileName}:`, error);
        continue;
      }

      downloadLinks.push({
        name: fileDisplayName(fileName),
        url: urlData.signedUrl,
      });
    }

    if (downloadLinks.length === 0) {
      console.error('[Payfast ITN] No download links generated for product:', productId);
      // Still return 200 so Payfast stops retrying; investigate separately
      return res.status(200).send('OK');
    }

    // ── STEP 6: Send delivery email ───────────────────────────────────────────
    const resend = new Resend(process.env.RESEND_API_KEY);
    const customerName = [data.name_first, data.name_last].filter(Boolean).join(' ') || 'there';

    await resend.emails.send({
      from: `${process.env.FROM_NAME || 'Find Your Compass Within'} <${process.env.FROM_EMAIL}>`,
      to: customerEmail,
      subject: `Your download is ready — ${product.displayName}`,
      html: buildEmailHtml({ customerName, product, downloadLinks }),
    });

    console.log(`[Payfast ITN] Delivery sent to ${customerEmail} for ${productId}`);
    return res.status(200).send('OK');

  } catch (err) {
    console.error('[Payfast ITN] Unexpected error:', err);
    return res.status(200).send('OK'); // Always return 200 to stop Payfast retrying
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function fileDisplayName(fileName) {
  const map = {
    'find-your-true-north.pdf':  'Find Your True North Workbook',
    'habit-tracker.pdf':         '90-Day Habit Tracker',
    'gratitude-journal.pdf':     '30-Day Gratitude & Intention Journal',
    'letters-to-future-self.pdf':'Letters to My Future Self',
    'fear-audit.pdf':            'The Fear Audit',
    'confidence-code.pdf':       'The Confidence Code',
    'money-mindset.pdf':         'Money Mindset Workbook',
    'strength-finder.pdf':       'The Strength Finder',
    'boundary-blueprint.pdf':    'The Boundary Blueprint',
    're-entry.pdf':              'The Re-Entry Workbook',
  };
  return map[fileName] || fileName.replace('.pdf', '').replace(/-/g, ' ');
}

function buildEmailHtml({ customerName, product, downloadLinks }) {
  const linkRows = downloadLinks.map(link => `
    <tr>
      <td style="padding: 0 0 12px 0;">
        <a href="${link.url}"
           style="display:block;background:#2F4F3F;color:#F2E8D9;text-decoration:none;
                  padding:14px 20px;border-radius:6px;font-family:'Outfit',sans-serif;
                  font-size:13px;font-weight:400;letter-spacing:0.2px;">
          &#8659;&nbsp; Download — ${link.name}
        </a>
      </td>
    </tr>
  `).join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#F2E8D9;font-family:Georgia,serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F2E8D9;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="background:#2F4F3F;padding:0;border-radius:10px 10px 0 0;overflow:hidden;">
              <div style="height:3px;background:linear-gradient(90deg,#C2A46F,#A6B695,#C2A46F);"></div>
              <div style="padding:32px 36px 28px;text-align:center;">
                <p style="font-family:Georgia,serif;font-size:11px;letter-spacing:3px;text-transform:uppercase;
                           color:rgba(194,164,111,0.7);margin:0 0 10px;">Find Your Compass Within</p>
                <h1 style="font-family:Georgia,serif;font-size:28px;font-weight:400;color:#F5F0E8;
                            margin:0;line-height:1.2;">Your download is <em style="color:#d9be92;">ready</em></h1>
              </div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background:#fff;padding:36px 36px 28px;border:0.5px solid #E6D8C3;border-top:none;">
              <p style="font-family:'Outfit',sans-serif;font-size:15px;color:#2F4F3F;margin:0 0 8px;">
                Hi ${escapeHtmlEmail(customerName)},
              </p>
              <p style="font-family:'Outfit',sans-serif;font-size:14px;color:#5a7a68;line-height:1.7;margin:0 0 24px;">
                Thank you for your purchase of <strong style="color:#2F4F3F;">${escapeHtmlEmail(product.displayName)}</strong>.
                Your file${downloadLinks.length > 1 ? 's are' : ' is'} ready to download below.
              </p>

              <table width="100%" cellpadding="0" cellspacing="0">
                ${linkRows}
              </table>

              <div style="background:#F7EFE4;border:0.5px solid #E6D8C3;border-radius:6px;
                          padding:14px 18px;margin:8px 0 24px;">
                <p style="font-family:'Outfit',sans-serif;font-size:12px;color:#5a7a68;
                           margin:0;line-height:1.6;">
                  &#9651; These download links expire in <strong>48 hours</strong>.
                  Please save your files to your device. If your links expire,
                  reply to this email and we will send fresh ones.
                </p>
              </div>

              <p style="font-family:'Outfit',sans-serif;font-size:13px;color:#5a7a68;
                         line-height:1.7;margin:0 0 6px;">
                Find a quiet space, open your workbook, and begin. You have already done the
                bravest part by choosing to look inward.
              </p>
              <p style="font-family:Georgia,serif;font-size:13px;font-style:italic;
                         color:#C2A46F;margin:16px 0 0;">
                With care,<br>
                <strong style="font-family:Georgia,serif;font-style:normal;color:#2F4F3F;font-size:15px;">
                  Mélanie
                </strong>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#2F4F3F;padding:20px 36px;border-radius:0 0 10px 10px;text-align:center;">
              <p style="font-family:'Outfit',sans-serif;font-size:11px;color:rgba(245,240,232,0.4);
                         margin:0 0 4px;">Find Your Compass Within</p>
              <p style="font-family:'Outfit',sans-serif;font-size:11px;color:rgba(245,240,232,0.3);
                         margin:0;">
                <a href="${process.env.SITE_URL}" style="color:rgba(194,164,111,0.6);text-decoration:none;">
                  findyourcompasswithin.com
                </a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtmlEmail(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
