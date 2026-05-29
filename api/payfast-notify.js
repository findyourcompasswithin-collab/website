/**
 * POST /api/payfast-notify
 * ─────────────────────────
 * Payfast ITN handler. Called after every payment attempt.
 *
 * For digital products:  verifies payment → generates Supabase signed URLs → emails download links
 * For coaching products: verifies payment → creates booking record → emails questionnaire link
 */

import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { PRODUCTS } from './products.js';

const BUCKET = 'workbooks';
const URL_EXPIRY_SECONDS = 172800; // 48 hours

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

    const receivedAmount = parseFloat(data.amount_gross);
    if (Math.abs(receivedAmount - product.price) > 0.01) {
      console.error('[ITN] Amount mismatch', { receivedAmount, expected: product.price });
      return res.status(400).send('Amount mismatch');
    }

    const customerName = [data.name_first, data.name_last].filter(Boolean).join(' ') || 'there';
    const resend       = new Resend(process.env.RESEND_API_KEY);
    const supabase     = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const siteUrl      = process.env.SITE_URL || 'https://findyourcompasswithin.com';
    const fromAddress  = `${process.env.FROM_NAME || 'Find Your Compass Within'} <${process.env.FROM_EMAIL}>`;

    // ── 5a. COACHING: create booking + send questionnaire email ───────────────
    if (product.type === 'coaching') {
      const { data: booking, error: bookingError } = await supabase
        .from('bookings')
        .insert({
          client_name:     customerName,
          client_email:    customerEmail,
          package_id:      productId,
          package_name:    product.displayName,
          sessions_total:  product.sessions,
          sessions_booked: 0,
          payment_id:      data.m_payment_id,
          status:          'pending_questionnaire',
        })
        .select('questionnaire_token')
        .single();

      if (bookingError || !booking) {
        console.error('[ITN] Error creating booking:', bookingError);
        return res.status(200).send('OK');
      }

      const questionnaireUrl = `${siteUrl}/questionnaire?token=${booking.questionnaire_token}`;

      await resend.emails.send({
        from:    fromAddress,
        to:      customerEmail,
        subject: `Welcome to ${product.displayName} — your first step`,
        html:    buildCoachingWelcomeEmail({ customerName, product, questionnaireUrl, siteUrl }),
      });

      await resend.emails.send({
        from:    fromAddress,
        to:      process.env.FROM_EMAIL,
        subject: `New booking: ${product.displayName} — ${customerName}`,
        html:    `<p style="font-family:sans-serif"><strong>Client:</strong> ${escapeHtml(customerName)} (${escapeHtml(customerEmail)})</p>
                  <p style="font-family:sans-serif"><strong>Package:</strong> ${escapeHtml(product.displayName)} — $${product.price}</p>
                  <p style="font-family:sans-serif"><strong>Sessions:</strong> ${product.sessions}</p>
                  <p style="font-family:sans-serif">Questionnaire link sent. You will be notified once completed and a session is booked.</p>`,
      });

      console.log(`[ITN] Coaching booking created for ${customerEmail} — ${productId}`);
      return res.status(200).send('OK');
    }

    // ── 5b. DIGITAL: generate Supabase signed URLs + send download email ──────
    const downloadLinks = [];
    for (const fileName of product.files) {
      const { data: urlData, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(fileName, URL_EXPIRY_SECONDS);

      if (error) {
        console.error(`[Supabase] Signed URL error for ${fileName}:`, error);
        continue;
      }
      downloadLinks.push({ name: fileDisplayName(fileName), url: urlData.signedUrl });
    }

    if (downloadLinks.length === 0) {
      console.error('[ITN] No download links for product:', productId);
      return res.status(200).send('OK');
    }

    await resend.emails.send({
      from:    fromAddress,
      to:      customerEmail,
      subject: `Your download is ready — ${product.displayName}`,
      html:    buildDownloadEmail({ customerName, product, downloadLinks, siteUrl }),
    });

    console.log(`[ITN] Download email sent to ${customerEmail} for ${productId}`);
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function fileDisplayName(fileName) {
  const map = {
    'find-your-true-north.pdf':   'Find Your True North Workbook',
    'habit-tracker.pdf':          '90-Day Habit Tracker',
    'gratitude-journal.pdf':      '30-Day Gratitude & Intention Journal',
    'letters-to-future-self.pdf': 'Letters to My Future Self',
    'fear-audit.pdf':             'The Fear Audit',
    'confidence-code.pdf':        'The Confidence Code',
    'money-mindset.pdf':          'Money Mindset Workbook',
    'strength-finder.pdf':        'The Strength Finder',
    'boundary-blueprint.pdf':     'The Boundary Blueprint',
    're-entry.pdf':               'The Re-Entry Workbook',
  };
  return map[fileName] || fileName.replace('.pdf', '').replace(/-/g, ' ');
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Email templates ───────────────────────────────────────────────────────────

function buildCoachingWelcomeEmail({ customerName, product, questionnaireUrl, siteUrl }) {
  const firstName = escapeHtml(customerName.split(' ')[0]);
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F2E8D9;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F2E8D9;padding:40px 20px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
  <tr><td style="background:#2F4F3F;border-radius:10px 10px 0 0;overflow:hidden;">
    <div style="height:3px;background:linear-gradient(90deg,#C2A46F,#A6B695,#C2A46F);"></div>
    <div style="padding:32px 36px 28px;text-align:center;">
      <p style="font-family:'Outfit',sans-serif;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:rgba(194,164,111,0.7);margin:0 0 10px;">Find Your Compass Within</p>
      <h1 style="font-family:Georgia,serif;font-size:26px;font-weight:400;color:#F5F0E8;margin:0;line-height:1.3;">Welcome, <em style="color:#d9be92;">${firstName}</em></h1>
    </div>
  </td></tr>
  <tr><td style="background:#fff;padding:36px;border:0.5px solid #E6D8C3;border-top:none;">
    <p style="font-family:'Outfit',sans-serif;font-size:14px;color:#2F4F3F;margin:0 0 8px;">Hi ${escapeHtml(customerName)},</p>
    <p style="font-family:'Outfit',sans-serif;font-size:14px;color:#5a7a68;line-height:1.7;margin:0 0 16px;">
      Thank you for investing in <strong style="color:#2F4F3F;">${escapeHtml(product.displayName)}</strong>. I am looking forward to working with you.
    </p>
    <p style="font-family:'Outfit',sans-serif;font-size:14px;color:#5a7a68;line-height:1.7;margin:0 0 24px;">
      Before we meet, please complete your short pre-session questionnaire. It helps me arrive fully prepared so every minute of our time together counts.
    </p>
    <div style="text-align:center;margin:28px 0;">
      <a href="${questionnaireUrl}" style="display:inline-block;background:#2F4F3F;color:#F2E8D9;text-decoration:none;padding:16px 32px;border-radius:7px;font-family:'Outfit',sans-serif;font-size:13px;font-weight:500;letter-spacing:0.3px;">
        Complete Your Questionnaire &rarr;
      </a>
    </div>
    <div style="background:#F7EFE4;border:0.5px solid #E6D8C3;border-radius:6px;padding:14px 18px;margin:0 0 24px;">
      <p style="font-family:'Outfit',sans-serif;font-size:12px;color:#5a7a68;margin:0;line-height:1.6;">
        After submitting, you will be taken directly to the booking calendar to choose your session date and time. The entire process takes about 5 minutes.
      </p>
    </div>
    <p style="font-family:Georgia,serif;font-size:13px;font-style:italic;color:#C2A46F;margin:16px 0 0;">
      With care,<br>
      <strong style="font-family:Georgia,serif;font-style:normal;color:#2F4F3F;font-size:15px;">Mélanie</strong>
    </p>
  </td></tr>
  <tr><td style="background:#2F4F3F;padding:20px 36px;border-radius:0 0 10px 10px;text-align:center;">
    <p style="font-family:'Outfit',sans-serif;font-size:11px;color:rgba(245,240,232,0.3);margin:0;">
      <a href="${siteUrl}" style="color:rgba(194,164,111,0.6);text-decoration:none;">findyourcompasswithin.com</a>
    </p>
  </td></tr>
</table></td></tr></table></body></html>`;
}

function buildDownloadEmail({ customerName, product, downloadLinks, siteUrl }) {
  const linkRows = downloadLinks.map(link => `
    <tr><td style="padding:0 0 12px 0;">
      <a href="${link.url}" style="display:block;background:#2F4F3F;color:#F2E8D9;text-decoration:none;padding:14px 20px;border-radius:6px;font-family:'Outfit',sans-serif;font-size:13px;font-weight:400;">
        &#8659;&nbsp; Download — ${link.name}
      </a>
    </td></tr>`).join('');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F2E8D9;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F2E8D9;padding:40px 20px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
  <tr><td style="background:#2F4F3F;border-radius:10px 10px 0 0;overflow:hidden;">
    <div style="height:3px;background:linear-gradient(90deg,#C2A46F,#A6B695,#C2A46F);"></div>
    <div style="padding:32px 36px 28px;text-align:center;">
      <p style="font-family:'Outfit',sans-serif;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:rgba(194,164,111,0.7);margin:0 0 10px;">Find Your Compass Within</p>
      <h1 style="font-family:Georgia,serif;font-size:28px;font-weight:400;color:#F5F0E8;margin:0;">Your download is <em style="color:#d9be92;">ready</em></h1>
    </div>
  </td></tr>
  <tr><td style="background:#fff;padding:36px;border:0.5px solid #E6D8C3;border-top:none;">
    <p style="font-family:'Outfit',sans-serif;font-size:15px;color:#2F4F3F;margin:0 0 8px;">Hi ${escapeHtml(customerName)},</p>
    <p style="font-family:'Outfit',sans-serif;font-size:14px;color:#5a7a68;line-height:1.7;margin:0 0 24px;">
      Thank you for purchasing <strong style="color:#2F4F3F;">${escapeHtml(product.displayName)}</strong>. Your file${downloadLinks.length > 1 ? 's are' : ' is'} ready below.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0">${linkRows}</table>
    <div style="background:#F7EFE4;border:0.5px solid #E6D8C3;border-radius:6px;padding:14px 18px;margin:8px 0 24px;">
      <p style="font-family:'Outfit',sans-serif;font-size:12px;color:#5a7a68;margin:0;line-height:1.6;">
        &#9651; Links expire in <strong>48 hours</strong>. Please save your files immediately. If links expire, reply to this email for new ones.
      </p>
    </div>
    <p style="font-family:Georgia,serif;font-size:13px;font-style:italic;color:#C2A46F;margin:16px 0 0;">
      With care,<br>
      <strong style="font-family:Georgia,serif;font-style:normal;color:#2F4F3F;font-size:15px;">Mélanie</strong>
    </p>
  </td></tr>
  <tr><td style="background:#2F4F3F;padding:20px 36px;border-radius:0 0 10px 10px;text-align:center;">
    <p style="font-family:'Outfit',sans-serif;font-size:11px;color:rgba(245,240,232,0.3);margin:0;">
      <a href="${siteUrl}" style="color:rgba(194,164,111,0.6);text-decoration:none;">findyourcompasswithin.com</a>
    </p>
  </td></tr>
</table></td></tr></table></body></html>`;
}
