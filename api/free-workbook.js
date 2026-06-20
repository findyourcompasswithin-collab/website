/**
 * POST /api/free-workbook
 * ────────────────────────
 * Two modes (kept in one endpoint to stay within the Vercel function limit):
 *
 *   default 'checkin':   { name, email, newsletter? }
 *     Emails the free Compass Check-In PDF and saves a lead. If newsletter is
 *     true, the person is also added to the marketing list.
 *
 *   'newsletter':        { email, name?, mode:'newsletter', source? }
 *     Subscribes to the newsletter only (no PDF). Used by the footer "Join the
 *     list" form and the checkout opt-in. Sends a short welcome (skipped for
 *     source:'checkout', since those buyers already receive purchase emails).
 *
 * Newsletter consent is always explicit and opt-in. Consenters are stored in
 * the `leads` table (newsletter_consent=true, consent_at) and added to the
 * Resend Audience (RESEND_AUDIENCE_ID) so they can receive broadcasts.
 * Non-consenters still get whatever they asked for; they are simply not added
 * to the marketing list.
 */

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const BUCKET      = 'workbooks';
const FILE        = 'compass-checkin.pdf';
const URL_EXPIRY  = 604800; // 7 days (generous - it's free)

// The marketing audience to add opted-in subscribers to. Prefer an explicit
// RESEND_AUDIENCE_ID env var; otherwise auto-discover the account's first
// audience (so no manual ID lookup is needed). Cached across warm invocations.
let cachedAudienceId = process.env.RESEND_AUDIENCE_ID || null;
async function resolveAudienceId(resend) {
  if (cachedAudienceId) return cachedAudienceId;
  try {
    const result = await resend.audiences.list();
    const list   = result?.data?.data || result?.data || [];
    if (Array.isArray(list) && list.length) cachedAudienceId = list[0].id;
  } catch (e) {
    console.error('[Lead] Could not list Resend audiences:', e);
  }
  return cachedAudienceId;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, email, newsletter, mode, source } = req.body || {};
  const isNewsletterOnly = mode === 'newsletter';

  // ── Validate ──────────────────────────────────────────────────────────────
  if (!email || !String(email).includes('@')) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  if (!isNewsletterOnly && (!name || String(name).trim().length < 1)) {
    return res.status(400).json({ error: 'Please enter your name.' });
  }

  const cleanName  = String(name || '').trim();
  const cleanEmail = String(email).toLowerCase().trim();
  const firstName  = cleanName.split(' ')[0] || 'there';
  const consented  = isNewsletterOnly || newsletter === true || newsletter === 'true';
  const leadSource = source || (isNewsletterOnly ? 'newsletter' : 'compass-checkin');

  try {
    const supabase    = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const resend      = new Resend(process.env.RESEND_API_KEY);
    const siteUrl     = process.env.SITE_URL || 'https://findyourcompasswithin.com';
    const fromAddress = `${process.env.FROM_NAME || 'Find Your Compass Within'} <${process.env.FROM_EMAIL}>`;

    // ── CONTACT: save the Get in Touch message + notify Mel, then done ────────
    // Folded into this endpoint (not a new one) to stay within the Vercel limit.
    if (mode === 'contact') {
      const cleanMessage = String(req.body.message || '').trim();
      if (!cleanMessage) {
        return res.status(400).json({ error: 'Please enter a message.' });
      }
      try {
        await supabase.from('support_messages').insert({
          name:       cleanName || null,
          email:      cleanEmail,
          message:    cleanMessage,
          created_at: new Date().toISOString(),
        });
      } catch (_) {
        // Non-blocking - table may not exist yet
      }
      await resend.emails.send({
        from:    fromAddress,
        to:      process.env.FROM_EMAIL,
        replyTo: cleanEmail,
        subject: `New message from ${cleanName || cleanEmail}`,
        html:    buildSupportEmail({ name: cleanName, email: cleanEmail, message: cleanMessage }),
      });
      console.log(`[Support] Message from ${cleanEmail}`);
      return res.status(200).json({ success: true });
    }

    // ── Save lead (silent fail if table doesn't exist yet) ───────────────────
    try {
      await supabase.from('leads').insert({
        name:               cleanName || null,
        email:              cleanEmail,
        source:             leadSource,
        newsletter_consent: consented,
        consent_at:         consented ? new Date().toISOString() : null,
        created_at:         new Date().toISOString(),
      });
    } catch (_) {
      // Non-blocking - table may not exist yet
    }

    // ── Add to the Resend Audience if they opted in ─────────────────────────
    if (consented) {
      const audienceId = await resolveAudienceId(resend);
      if (audienceId) {
        try {
          await resend.contacts.create({
            email:        cleanEmail,
            firstName:    firstName === 'there' ? undefined : firstName,
            unsubscribed: false,
            audienceId,
          });
        } catch (e) {
          console.error('[Lead] Resend audience add failed (non-blocking):', e);
        }
      }
    }

    // ── NEWSLETTER-ONLY: subscribe, optional welcome, done ───────────────────
    if (isNewsletterOnly) {
      if (leadSource !== 'checkout') {
        await resend.emails.send({
          from:    fromAddress,
          to:      cleanEmail,
          subject: 'You are on the list',
          html:    buildWelcomeEmail({ firstName, siteUrl }),
        });
      }
      console.log(`[Newsletter] Subscribed ${cleanEmail} (source: ${leadSource})`);
      return res.status(200).json({ success: true });
    }

    // ── CHECK-IN: generate signed download URL and email the PDF ─────────────
    const { data: urlData, error: urlError } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(FILE, URL_EXPIRY, { download: true });

    if (urlError || !urlData?.signedUrl) {
      console.error('[FreeWorkbook] Supabase URL error:', urlError);
      return res.status(500).json({ error: 'Could not generate your download link. Please try again.' });
    }

    await resend.emails.send({
      from:        fromAddress,
      to:          cleanEmail,
      subject:     'Your Compass Check-In is ready',
      html:        buildEmail({ firstName, downloadUrl: urlData.signedUrl, siteUrl, consented }),
      attachments: [{ filename: 'compass-checkin.pdf', path: urlData.signedUrl }],
    });

    console.log(`[FreeWorkbook] Sent to ${cleanEmail}${consented ? ' (newsletter opt-in)' : ''}`);
    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('[FreeWorkbook] Unexpected error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}

// ── Email templates ─────────────────────────────────────────────────────────

function buildWelcomeEmail({ firstName, siteUrl }) {
  const first = escapeHtml(firstName);
  const greeting = (firstName && firstName !== 'there') ? `Hi ${first}` : 'Hello';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F2E8D9;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F2E8D9;padding:40px 20px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
  <tr><td style="background:#2F4F3F;border-radius:10px 10px 0 0;overflow:hidden;">
    <div style="height:3px;background:linear-gradient(90deg,#A6B695,#C2A46F,#b8c8b0);"></div>
    <div style="padding:32px 36px 28px;text-align:center;">
      <p style="font-family:'Outfit',sans-serif;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:rgba(166,182,149,0.7);margin:0 0 10px;font-weight:300;">Find Your Compass Within</p>
      <h1 style="font-family:Georgia,serif;font-size:26px;font-weight:400;color:#F5F0E8;margin:0;line-height:1.3;">You are <em style="color:#d9be92;">on the list</em></h1>
    </div>
  </td></tr>
  <tr><td style="background:#fff;padding:36px;border:0.5px solid #E6D8C3;border-top:none;">
    <p style="font-family:'Outfit',sans-serif;font-size:15px;color:#2F4F3F;margin:0 0 8px;">${greeting},</p>
    <p style="font-family:'Outfit',sans-serif;font-size:14px;color:#5a7a68;line-height:1.75;margin:0 0 18px;font-weight:300;">
      Thank you for joining me. I will send you the occasional note, when there is a new workbook, a Circle opening, or something genuinely worth pausing for. No noise, no spam, and you can unsubscribe from any email in one click.
    </p>
    <p style="font-family:'Outfit',sans-serif;font-size:14px;color:#5a7a68;line-height:1.75;margin:0 0 22px;font-weight:300;">
      If you have not taken it yet, the free <strong style="color:#2F4F3F;">Compass Check-In</strong> is a lovely place to start. You will find it, and everything else, at <a href="${siteUrl}" style="color:#2F4F3F;font-weight:500;">findyourcompasswithin.com</a>.
    </p>
    <p style="font-family:Georgia,serif;font-size:13px;font-style:italic;color:#C2A46F;margin:16px 0 0;">
      With care,<br>
      <strong style="font-family:Georgia,serif;font-style:normal;color:#2F4F3F;font-size:15px;">Mel</strong>
    </p>
  </td></tr>
  <tr><td style="background:#2F4F3F;padding:20px 36px;border-radius:0 0 10px 10px;text-align:center;">
    <p style="font-family:'Outfit',sans-serif;font-size:11px;color:rgba(245,240,232,0.3);margin:0;">
      <a href="${siteUrl}" style="color:rgba(166,182,149,0.6);text-decoration:none;">findyourcompasswithin.com</a>
    </p>
  </td></tr>
</table></td></tr></table></body></html>`;
}

function buildSupportEmail({ name, email, message }) {
  const safe = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:'Outfit',sans-serif;background:#F2E8D9;padding:30px 20px;">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;border:0.5px solid #E6D8C3;">
  <div style="background:#2F4F3F;padding:24px 32px;">
    <div style="height:3px;background:linear-gradient(90deg,#C2A46F,#A6B695,#C2A46F);margin-bottom:16px;border-radius:2px;"></div>
    <div style="font-family:'Georgia',serif;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:rgba(194,164,111,0.7);margin-bottom:6px">Find Your Compass Within</div>
    <div style="font-family:'Georgia',serif;font-size:22px;font-weight:400;color:#F5F0E8;">New Contact Message</div>
  </div>
  <div style="padding:32px;">
    <p style="font-size:14px;color:#3d5e50;margin-bottom:4px"><strong>${safe(name)}</strong> &nbsp;&middot;&nbsp; <a href="mailto:${safe(email)}" style="color:#C2A46F">${safe(email)}</a></p>
    <div style="height:1px;background:#E6D8C3;margin:20px 0;"></div>
    <div style="font-size:14px;color:#2F4F3F;background:#F9F5EF;border-left:3px solid #C2A46F;padding:14px 16px;border-radius:0 6px 6px 0;line-height:1.7;white-space:pre-wrap;">${safe(message)}</div>
    <div style="height:1px;background:#E6D8C3;margin:24px 0;"></div>
    <p style="font-size:12px;color:#888;text-align:center">Submitted via findyourcompasswithin.com. Reply directly to respond.</p>
  </div>
</div>
</body></html>`;
}

function buildEmail({ firstName, downloadUrl, siteUrl, consented }) {
  const first = escapeHtml(firstName);
  const consentLine = consented
    ? `<p style="font-family:'Outfit',sans-serif;font-size:12px;color:#8a9e94;line-height:1.65;margin:0 0 20px;font-weight:300;">You also asked to hear from me now and then. I will keep it occasional and worthwhile, and you can unsubscribe from any email in one click.</p>`
    : '';
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
      Your <strong style="color:#2F4F3F;font-weight:500;">Compass Check-In</strong> is ready to download. This is your starting point: an honest look at where you are across eight areas of life, and a visual map of what you discover.
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
        &#9651; Your Compass Check-In is <strong>attached to this email</strong>, so it is yours to keep. The button above downloads it too.
      </p>
    </div>

    <!-- What to do next -->
    <p style="font-family:'Outfit',sans-serif;font-size:13px;font-weight:500;color:#2F4F3F;margin:0 0 10px;">What to do with your map</p>
    <p style="font-family:'Outfit',sans-serif;font-size:13px;color:#5a7a68;line-height:1.75;margin:0 0 20px;font-weight:300;">
      Once you have scored each area and plotted your Compass Map, sit with the three reflection questions on the final page. They will show you not just where you are, but where the real work is waiting.
    </p>
    <p style="font-family:'Outfit',sans-serif;font-size:13px;color:#5a7a68;line-height:1.75;margin:0 0 20px;font-weight:300;">
      When you are ready to go deeper, each area of your map has a workbook built specifically around it, designed to take you from awareness into real, lasting change. You can find the full collection at <a href="${siteUrl}" style="color:#2F4F3F;font-weight:500;">findyourcompasswithin.com</a>.
    </p>
    ${consentLine}

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
