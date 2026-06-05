/**
 * POST /api/free-workbook
 * ────────────────────────
 * Accepts { name, email } from the free workbook modal.
 * Generates a Supabase signed URL for compass-checkin.pdf
 * and emails it to the user via Resend.
 *
 * Optionally saves to a `leads` table — silent fail if it doesn't exist yet.
 */

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const BUCKET      = 'workbooks';
const FILE        = 'compass-checkin.pdf';
const URL_EXPIRY  = 604800; // 7 days (generous — it's free)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, email } = req.body || {};

  // ── Validate ──────────────────────────────────────────────────────────────
  if (!name || String(name).trim().length < 1) {
    return res.status(400).json({ error: 'Please enter your name.' });
  }
  if (!email || !String(email).includes('@')) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  const cleanName  = String(name).trim();
  const cleanEmail = String(email).toLowerCase().trim();
  const firstName  = cleanName.split(' ')[0];

  try {
    const supabase    = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const resend      = new Resend(process.env.RESEND_API_KEY);
    const siteUrl     = process.env.SITE_URL || 'https://findyourcompasswithin.com';
    const fromAddress = `${process.env.FROM_NAME || 'Find Your Compass Within'} <${process.env.FROM_EMAIL}>`;

    // ── Generate signed download URL ─────────────────────────────────────────
    const { data: urlData, error: urlError } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(FILE, URL_EXPIRY);

    if (urlError || !urlData?.signedUrl) {
      console.error('[FreeWorkbook] Supabase URL error:', urlError);
      return res.status(500).json({ error: 'Could not generate your download link. Please try again.' });
    }

    // ── Save lead (silent fail if table doesn't exist yet) ───────────────────
    try {
      await supabase.from('leads').insert({
        name:       cleanName,
        email:      cleanEmail,
        source:     'compass-checkin',
        created_at: new Date().toISOString(),
      });
    } catch (_) {
      // Non-blocking — table may not exist yet
    }

    // ── Send download email ───────────────────────────────────────────────────
    await resend.emails.send({
      from:    fromAddress,
      to:      cleanEmail,
      subject: 'Your Compass Check-In is ready',
      html:    buildEmail({ firstName, downloadUrl: urlData.signedUrl, siteUrl }),
    });

    console.log(`[FreeWorkbook] Sent to ${cleanEmail}`);
    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('[FreeWorkbook] Unexpected error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}

// ── Email template ────────────────────────────────────────────────────────────

function buildEmail({ firstName, downloadUrl, siteUrl }) {
  const first = escapeHtml(firstName);
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F2E8D9;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F2E8D9;padding:40px 20px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

  <!-- Header -->
  <tr><td style="background:#2F4F3F;border-radius:10px 10px 0 0;overflow:hidden;">
    <div style="height:3px;background:linear-gradient(90deg,#A6B695,#C2A46F,#b8c8b0);"></div>
    <div style="padding:32px 36px 28px;text-align:center;">
      <p style="font-family:'Outfit',sans-serif;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:rgba(166,182,149,0.7);margin:0 0 10px;font-weight:300;">Find Your Compass Within</p>
      <h1 style="font-family:Georgia,serif;font-size:26px;font-weight:400;color:#F5F0E8;margin:0;line-height:1.3;">
        Here is your <em style="color:#d9be92;">free check-in</em>
      </h1>
    </div>
  </td></tr>

  <!-- Body -->
  <tr><td style="background:#fff;padding:36px;border:0.5px solid #E6D8C3;border-top:none;">
    <p style="font-family:'Outfit',sans-serif;font-size:15px;color:#2F4F3F;margin:0 0 8px;font-weight:400;">Hi ${first},</p>
    <p style="font-family:'Outfit',sans-serif;font-size:14px;color:#5a7a68;line-height:1.75;margin:0 0 20px;font-weight:300;">
      Your <strong style="color:#2F4F3F;font-weight:500;">Compass Check-In</strong> is ready to download. This is your starting point — an honest look at where you are across eight areas of life, and a visual map of what you discover.
    </p>

    <!-- Download button -->
    <div style="text-align:center;margin:28px 0;">
      <a href="${downloadUrl}" style="display:inline-block;background:#2F4F3F;color:#F2E8D9;text-decoration:none;padding:16px 36px;border-radius:7px;font-family:'Outfit',sans-serif;font-size:14px;font-weight:500;letter-spacing:0.3px;">
        &#8659;&nbsp; Download Your Compass Check-In
      </a>
    </div>

    <!-- Note -->
    <div style="background:#F7EFE4;border:0.5px solid #E6D8C3;border-radius:6px;padding:14px 18px;margin:0 0 24px;">
      <p style="font-family:'Outfit',sans-serif;font-size:12px;color:#5a7a68;margin:0;line-height:1.65;">
        &#9651; This link is valid for <strong>7 days</strong>. Save your PDF to your device so you can return to it any time.
      </p>
    </div>

    <!-- What to do next -->
    <p style="font-family:'Outfit',sans-serif;font-size:13px;font-weight:500;color:#2F4F3F;margin:0 0 10px;">What to do with your map</p>
    <p style="font-family:'Outfit',sans-serif;font-size:13px;color:#5a7a68;line-height:1.75;margin:0 0 20px;font-weight:300;">
      Once you have scored each area and plotted your Compass Map, sit with the three reflection questions on the final page. They will show you not just where you are — but where the real work is waiting.
    </p>
    <p style="font-family:'Outfit',sans-serif;font-size:13px;color:#5a7a68;line-height:1.75;margin:0 0 24px;font-weight:300;">
      When you are ready to go deeper, each area of your map has a workbook built specifically around it — designed to take you from awareness into real, lasting change. You can find the full collection at <a href="${siteUrl}" style="color:#2F4F3F;font-weight:500;">findyourcompasswithin.com</a>.
    </p>

    <!-- Sign-off -->
    <p style="font-family:Georgia,serif;font-size:13px;font-style:italic;color:#C2A46F;margin:16px 0 0;">
      With care,<br>
      <strong style="font-family:Georgia,serif;font-style:normal;color:#2F4F3F;font-size:15px;">Mel</strong>
    </p>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#2F4F3F;padding:20px 36px;border-radius:0 0 10px 10px;text-align:center;">
    <p style="font-family:'Outfit',sans-serif;font-size:11px;color:rgba(245,240,232,0.3);margin:0;">
      <a href="${siteUrl}" style="color:rgba(166,182,149,0.6);text-decoration:none;">findyourcompasswithin.com</a>
    </p>
  </td></tr>

</table></td></tr></table></body></html>`;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
