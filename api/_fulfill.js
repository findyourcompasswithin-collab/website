/**
 * Shared order fulfilment.
 * ────────────────────────
 * Called by both payment lanes (Payfast ITN and PayPal capture) after a
 * verified payment:
 *   digital products  → records purchase, attaches PDFs from Supabase, sends delivery email (BCC OWNER_BCC)
 *   coaching products → creates booking record, sends questionnaire email
 *
 * sendLibraryEmail() is the safety net for buyers who lost their files:
 * it looks up their purchases and emails fresh signed links (links only, no attachments).
 */

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { PRODUCTS } from './_products.js';

const BUCKET = 'workbooks';
const URL_EXPIRY_SECONDS = 31536000; // 12 months (used by attachments + sendLibraryEmail fallback)
const OWNER_BCC = process.env.OWNER_BCC_EMAIL || 'melcooper@findyourcompasswithin.com';

export async function fulfillOrder({ product, productId, customerEmail, customerName, paymentId, paymentMethod }) {
  const resend      = new Resend(process.env.RESEND_API_KEY);
  const supabase    = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const siteUrl     = process.env.SITE_URL || 'https://www.findyourcompasswithin.com';
  const fromAddress = `${process.env.FROM_NAME || 'Find Your Compass Within'} <${process.env.FROM_EMAIL}>`;
  const name        = customerName || 'there';

  // ── COACHING: create booking + send questionnaire email ─────────────────────
  if (product.type === 'coaching') {
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .insert({
        client_name:     name,
        client_email:    customerEmail,
        package_id:      productId,
        package_name:    product.displayName,
        sessions_total:  product.sessions,
        sessions_booked: 0,
        payment_id:      paymentId,
        status:          'pending_questionnaire',
      })
      .select('questionnaire_token')
      .single();

    if (bookingError || !booking) {
      // Unique payment_id: the other delivery path already created this
      // booking, so stay silent instead of double-emailing.
      if (bookingError && bookingError.code === '23505') {
        console.log(`[Fulfill] Booking for payment ${paymentId} already exists; skipping duplicate`);
        return { ok: true, duplicate: true };
      }
      console.error('[Fulfill] Error creating booking:', bookingError);
      return { ok: false, error: 'booking_failed' };
    }

    const questionnaireUrl = `${siteUrl}/questionnaire?token=${booking.questionnaire_token}`;
    const isGroup = product.format === 'group';

    await resend.emails.send({
      from:    fromAddress,
      to:      customerEmail,
      subject: isGroup
        ? `Welcome to ${product.displayName}: your seat is saved`
        : `Welcome to ${product.displayName}: your first step`,
      html:    isGroup
        ? buildCircleWelcomeEmail({ customerName: name, product, questionnaireUrl, siteUrl })
        : buildCoachingWelcomeEmail({ customerName: name, product, questionnaireUrl, siteUrl }),
    });

    await resend.emails.send({
      from:    fromAddress,
      to:      process.env.FROM_EMAIL,
      subject: `New ${isGroup ? 'Circle seat' : 'booking'}: ${product.displayName}, ${name}`,
      html:    `<p style="font-family:sans-serif"><strong>Client:</strong> ${escapeHtml(name)} (${escapeHtml(customerEmail)})</p>
                <p style="font-family:sans-serif"><strong>${isGroup ? 'Round' : 'Package'}:</strong> ${escapeHtml(product.displayName)} · $${product.price}</p>
                <p style="font-family:sans-serif"><strong>${isGroup ? 'Live calls' : 'Sessions'}:</strong> ${product.sessions}</p>
                <p style="font-family:sans-serif">${isGroup
                  ? 'Group round seat taken. Intake questionnaire sent. Remember to email this member the cohort dates and private group link.'
                  : 'Questionnaire link sent. You will be notified once completed and a session is booked.'}</p>`,
    });

    return { ok: true };
  }

  // ── DIGITAL: record first, then deliver ──────────────────────────────────────
  // Recording before sending makes delivery idempotent: the unique
  // payment_id means that when the buyer's return redirect and the webhook
  // race to fulfil the same order, only the one that records first emails.
  const { error: recordError } = await supabase.from('purchases').insert({
    email:          customerEmail,
    customer_name:  name,
    product_id:     productId,
    product_name:   product.displayName,
    payment_id:     paymentId,
    payment_method: paymentMethod || null,
  });
  if (recordError) {
    if (recordError.code === '23505') {
      console.log(`[Fulfill] Payment ${paymentId} already fulfilled; skipping duplicate email`);
      return { ok: true, duplicate: true };
    }
    // A bookkeeping failure must never block delivery
    console.error('[Fulfill] Could not record purchase:', recordError);
  }

  // Workbooks are delivered as PDF attachments. Resend fetches each signed URL
  // server-side via `path`, so the file streams straight from Supabase to the
  // email without passing through this function as a base64 payload.
  const attachments = [];
  const fileNames   = [];
  for (const fileName of product.files) {
    const { data: urlData, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(fileName, URL_EXPIRY_SECONDS, { download: true });

    if (error) {
      console.error(`[Supabase] Signed URL error for ${fileName}:`, error);
      continue;
    }
    const displayName = fileDisplayName(fileName);
    attachments.push({ filename: `${displayName}.pdf`, path: urlData.signedUrl });
    fileNames.push(displayName);
  }

  if (attachments.length === 0) {
    console.error('[Fulfill] No attachments built for product:', productId);
    return { ok: false, error: 'no_attachments' };
  }

  const firstName = String(name).split(' ')[0];
  await resend.emails.send({
    from:        fromAddress,
    to:          customerEmail,
    bcc:         OWNER_BCC,
    subject:     `You said yes to yourself, ${firstName}`,
    html:        buildDownloadEmail({ customerName: name, product, fileNames, siteUrl }),
    attachments,
  });

  return { ok: true };
}

/**
 * My Downloads: look up every purchase for an email address and send fresh
 * signed links for all of it. Links are only ever emailed to the original
 * purchase address, never returned to the browser, so owning the inbox is
 * the proof of ownership.
 */
export async function sendLibraryEmail(email) {
  const resend      = new Resend(process.env.RESEND_API_KEY);
  const supabase    = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const siteUrl     = process.env.SITE_URL || 'https://www.findyourcompasswithin.com';
  const fromAddress = `${process.env.FROM_NAME || 'Find Your Compass Within'} <${process.env.FROM_EMAIL}>`;

  const { data: purchases, error } = await supabase
    .from('purchases')
    .select('product_id, customer_name')
    .ilike('email', email);

  if (error) {
    console.error('[Library] Purchase lookup failed:', error);
    return { ok: false };
  }
  if (!purchases || purchases.length === 0) return { ok: false };

  // Collect the unique files across everything they have bought, using the
  // live catalogue so bundle contents stay current.
  const fileSet = new Set();
  for (const p of purchases) {
    const prod = PRODUCTS[p.product_id];
    if (prod && Array.isArray(prod.files)) prod.files.forEach((f) => fileSet.add(f));
  }
  if (fileSet.size === 0) return { ok: false };

  const downloadLinks = [];
  for (const fileName of fileSet) {
    const { data: urlData, error: urlError } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(fileName, URL_EXPIRY_SECONDS, { download: true });
    if (urlError) {
      console.error(`[Library] Signed URL error for ${fileName}:`, urlError);
      continue;
    }
    downloadLinks.push({ name: fileDisplayName(fileName), url: urlData.signedUrl });
  }
  if (downloadLinks.length === 0) return { ok: false };

  const customerName = purchases.find((p) => p.customer_name)?.customer_name || 'there';

  await resend.emails.send({
    from:    fromAddress,
    to:      email,
    subject: 'Your fresh download links: Find Your Compass Within',
    html:    buildLibraryEmail({ customerName, downloadLinks, siteUrl }),
  });

  return { ok: true };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fileDisplayName(fileName) {
  const map = {
    'find-your-true-north.pdf':   'The Compass Workbook',
    'habit-tracker.pdf':          '90-Day Habit Tracker',
    'gratitude-journal.pdf':      '30-Day Gratitude & Intention Journal',
    'letters-to-future-self.pdf': 'Letters to My Future Self',
    'fear-audit.pdf':             'The Fear Audit',
    'confidence-code.pdf':        'The Confidence Code',
    'money-mindset.pdf':          'Money Mindset Workbook',
    'strength-finder.pdf':        'The Strength Finder',
    'boundary-blueprint.pdf':     'The Boundary Blueprint',
    're-entry.pdf':               'The Re-Entry Workbook',
    'still-me.pdf':               'Still Me: Finding Your Compass as a Parent',
    'mother-behind-the-role.pdf': 'The Mother Behind the Role',
    'perimenopause-pivot.pdf':    'The Perimenopause Pivot',
  };
  return map[fileName] || fileName.replace('.pdf', '').replace(/-/g, ' ');
}

export function escapeHtml(str) {
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
    <p style="font-family:'Outfit',sans-serif;font-size:14px;color:#2F4F3F;margin:0 0 8px;">Hi ${firstName},</p>
    <p style="font-family:'Outfit',sans-serif;font-size:14px;color:#5a7a68;line-height:1.7;margin:0 0 20px;">
      Thank you for investing in <strong style="color:#2F4F3F;">${escapeHtml(product.displayName)}</strong>. I am looking forward to working with you.
    </p>
    <p style="font-family:'Outfit',sans-serif;font-size:13px;font-weight:500;color:#2F4F3F;margin:0 0 12px;letter-spacing:0.3px;text-transform:uppercase;">Before your first session, please complete two short steps:</p>

    <div style="background:#F7EFE4;border-left:3px solid #C2A46F;border-radius:0 6px 6px 0;padding:14px 18px;margin:0 0 12px;">
      <p style="font-family:'Outfit',sans-serif;font-size:12px;font-weight:600;color:#2F4F3F;margin:0 0 4px;">Step 1: The 5 Questions</p>
      <p style="font-family:'Outfit',sans-serif;font-size:12px;color:#5a7a68;margin:0 0 10px;line-height:1.6;">If you have not already answered the 5 Questions on the website, please take 2 minutes to do that now. Your answers give me important context before we even speak.</p>
      <a href="${siteUrl}/?questions=1" style="font-family:'Outfit',sans-serif;font-size:12px;color:#C2A46F;text-decoration:none;font-weight:500;">Answer the 5 Questions &rarr;</a>
    </div>

    <div style="background:#F7EFE4;border-left:3px solid #2F4F3F;border-radius:0 6px 6px 0;padding:14px 18px;margin:0 0 24px;">
      <p style="font-family:'Outfit',sans-serif;font-size:12px;font-weight:600;color:#2F4F3F;margin:0 0 4px;">Step 2: Pre-Session Questionnaire and Calendar Booking</p>
      <p style="font-family:'Outfit',sans-serif;font-size:12px;color:#5a7a68;margin:0 0 10px;line-height:1.6;">Complete your short pre-session questionnaire. Once submitted, you will be taken directly to the booking calendar to choose your session date and time.</p>
      <a href="${questionnaireUrl}" style="display:inline-block;background:#2F4F3F;color:#F2E8D9;text-decoration:none;padding:12px 24px;border-radius:7px;font-family:'Outfit',sans-serif;font-size:12px;font-weight:500;letter-spacing:0.3px;">Complete Your Questionnaire &rarr;</a>
    </div>
    <p style="font-family:Georgia,serif;font-size:13px;font-style:italic;color:#C2A46F;margin:16px 0 0;">
      With care,<br>
      <strong style="font-family:Georgia,serif;font-style:normal;color:#2F4F3F;font-size:15px;">Mel</strong>
    </p>
  </td></tr>
  <tr><td style="background:#2F4F3F;padding:20px 36px;border-radius:0 0 10px 10px;text-align:center;">
    <p style="font-family:'Outfit',sans-serif;font-size:11px;color:rgba(245,240,232,0.3);margin:0;">
      <a href="${siteUrl}" style="color:rgba(194,164,111,0.6);text-decoration:none;">findyourcompasswithin.com</a>
    </p>
  </td></tr>
</table></td></tr></table></body></html>`;
}

function buildCircleWelcomeEmail({ customerName, product, questionnaireUrl, siteUrl }) {
  const firstName = escapeHtml(customerName.split(' ')[0]);
  const cohort = product.cohort || {};
  const dates  = Array.isArray(cohort.dates) ? cohort.dates : [];
  const calls  = product.sessions || dates.length || 6;

  const datesBlock = dates.length
    ? `<p style="font-family:'Outfit',sans-serif;font-size:12px;color:#5a7a68;margin:0 0 8px;line-height:1.6;">Here are our ${calls} weekly calls. Pop them in your calendar now:</p>
       <ul style="font-family:'Outfit',sans-serif;font-size:12px;color:#2F4F3F;margin:0;padding-left:18px;line-height:1.9;">
         ${dates.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}
       </ul>`
    : `<p style="font-family:'Outfit',sans-serif;font-size:12px;color:#5a7a68;margin:0;line-height:1.6;">I will email you the ${calls} weekly call dates and your private group space shortly, so you can set them aside. Nothing for you to book: the whole circle moves together.</p>`;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F2E8D9;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F2E8D9;padding:40px 20px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
  <tr><td style="background:#2F4F3F;border-radius:10px 10px 0 0;overflow:hidden;">
    <div style="height:3px;background:linear-gradient(90deg,#C2A46F,#A6B695,#C2A46F);"></div>
    <div style="padding:32px 36px 28px;text-align:center;">
      <p style="font-family:'Outfit',sans-serif;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:rgba(194,164,111,0.7);margin:0 0 10px;">Find Your Compass Within</p>
      <h1 style="font-family:Georgia,serif;font-size:26px;font-weight:400;color:#F5F0E8;margin:0;line-height:1.3;">Your seat is <em style="color:#d9be92;">saved</em>, ${firstName}</h1>
    </div>
  </td></tr>
  <tr><td style="background:#fff;padding:36px;border:0.5px solid #E6D8C3;border-top:none;">
    <p style="font-family:'Outfit',sans-serif;font-size:14px;color:#2F4F3F;margin:0 0 8px;">Hi ${firstName},</p>
    <p style="font-family:'Outfit',sans-serif;font-size:14px;color:#5a7a68;line-height:1.7;margin:0 0 20px;">
      Welcome to <strong style="color:#2F4F3F;">${escapeHtml(product.displayName)}</strong>. You are one of a small circle of women walking through this together, and I am really glad you are here. You will not be doing this alone.
    </p>

    <div style="background:#F7EFE4;border-left:3px solid #C2A46F;border-radius:0 6px 6px 0;padding:14px 18px;margin:0 0 12px;">
      <p style="font-family:'Outfit',sans-serif;font-size:12px;font-weight:600;color:#2F4F3F;margin:0 0 8px;">Your weekly calls</p>
      ${datesBlock}
    </div>

    <div style="background:#F7EFE4;border-left:3px solid #2F4F3F;border-radius:0 6px 6px 0;padding:14px 18px;margin:0 0 24px;">
      <p style="font-family:'Outfit',sans-serif;font-size:12px;font-weight:600;color:#2F4F3F;margin:0 0 4px;">One thing to do now: your short intake</p>
      <p style="font-family:'Outfit',sans-serif;font-size:12px;color:#5a7a68;margin:0 0 10px;line-height:1.6;">It takes about 5 minutes and helps me shape the circle around what you and the others actually need. There are no right answers, just honest ones.</p>
      <a href="${questionnaireUrl}" style="display:inline-block;background:#2F4F3F;color:#F2E8D9;text-decoration:none;padding:12px 24px;border-radius:7px;font-family:'Outfit',sans-serif;font-size:12px;font-weight:500;letter-spacing:0.3px;">Complete Your Intake &rarr;</a>
    </div>
    <p style="font-family:Georgia,serif;font-size:13px;font-style:italic;color:#C2A46F;margin:16px 0 0;">
      With care,<br>
      <strong style="font-family:Georgia,serif;font-style:normal;color:#2F4F3F;font-size:15px;">Mel</strong>
    </p>
  </td></tr>
  <tr><td style="background:#2F4F3F;padding:20px 36px;border-radius:0 0 10px 10px;text-align:center;">
    <p style="font-family:'Outfit',sans-serif;font-size:11px;color:rgba(245,240,232,0.3);margin:0;">
      <a href="${siteUrl}" style="color:rgba(194,164,111,0.6);text-decoration:none;">findyourcompasswithin.com</a>
    </p>
  </td></tr>
</table></td></tr></table></body></html>`;
}

function buildDownloadEmail({ customerName, product, fileNames, siteUrl }) {
  const firstName = escapeHtml(String(customerName).split(' ')[0]);
  const plural = fileNames.length > 1;
  const fileRows = fileNames.map(name => `
    <div style="background:#F7EFE4;border-left:3px solid #C2A46F;border-radius:0 6px 6px 0;padding:11px 16px;margin:0 0 8px;font-family:'Outfit',sans-serif;font-size:13px;color:#2F4F3F;">
      ${escapeHtml(name)} <span style="color:#a89878;font-size:11px;">&nbsp;&middot;&nbsp; PDF attached</span>
    </div>`).join('');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F2E8D9;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F2E8D9;padding:40px 20px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

  <tr><td style="background:#2F4F3F;border-radius:10px 10px 0 0;overflow:hidden;">
    <div style="height:3px;background:linear-gradient(90deg,#C2A46F,#A6B695,#C2A46F);"></div>
    <div style="padding:34px 36px 30px;text-align:center;">
      <p style="font-family:'Outfit',sans-serif;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:rgba(194,164,111,0.7);margin:0 0 12px;">Find Your Compass Within</p>
      <h1 style="font-family:Georgia,serif;font-size:27px;font-weight:400;color:#F5F0E8;margin:0;line-height:1.3;">You said yes to <em style="color:#d9be92;">yourself</em></h1>
    </div>
  </td></tr>

  <tr><td style="background:#fff;padding:36px;border:0.5px solid #E6D8C3;border-top:none;">
    <p style="font-family:'Outfit',sans-serif;font-size:15px;color:#2F4F3F;margin:0 0 16px;">Hi ${firstName},</p>

    <p style="font-family:'Outfit',sans-serif;font-size:14px;color:#5a7a68;line-height:1.75;margin:0 0 16px;">
      Before you open a single page, pause for a moment. What you just did matters more than it might seem. Choosing to invest in your own growth is not a small thing. It is you listening to the quiet voice that has been with you all along, the one that knows you are meant to live more honestly, more fully, more like yourself.
    </p>
    <p style="font-family:'Outfit',sans-serif;font-size:14px;color:#5a7a68;line-height:1.75;margin:0 0 22px;">
      That voice is your authenticity. Today you chose to follow it, and that is worth celebrating.
    </p>

    <div style="height:1px;background:#E6D8C3;margin:0 0 22px;"></div>

    <p style="font-family:'Outfit',sans-serif;font-size:14px;color:#2F4F3F;font-weight:600;margin:0 0 4px;">Your workbook${plural ? 's are' : ' is'} attached to this email.</p>
    <p style="font-family:'Outfit',sans-serif;font-size:13px;color:#5a7a68;line-height:1.7;margin:0 0 16px;">${plural ? 'They are yours to keep, for life. Here is what is included:' : 'It is yours to keep, for life.'}</p>

    ${fileRows}

    <p style="font-family:'Outfit',sans-serif;font-size:12px;color:#8a7d66;line-height:1.7;margin:6px 0 22px;">
      Save ${plural ? 'them' : 'it'} somewhere you will find ${plural ? 'them' : 'it'} again. If you ever need another copy, you can re-download everything you own at <a href="${siteUrl}/downloads" style="color:#2F4F3F;font-weight:500;">findyourcompasswithin.com/downloads</a>, or simply reply to this email.
    </p>

    <p style="font-family:Georgia,serif;font-size:14px;font-style:italic;color:#5a7a68;line-height:1.7;margin:0 0 26px;">
      There is no right pace, and no finish line to race toward. Open the first page when you feel ready, and let it meet you where you are.
    </p>

    <div style="border:0.5px solid #E6D8C3;border-radius:8px;overflow:hidden;margin:0 0 26px;">
      <div style="background:#2F4F3F;padding:12px 18px;">
        <p style="font-family:'Outfit',sans-serif;font-size:12px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;color:#d9be92;margin:0;">Would you like a printed copy?</p>
      </div>
      <div style="padding:16px 18px;background:#fff;">
        <p style="font-family:'Outfit',sans-serif;font-size:12px;color:#5a7a68;line-height:1.6;margin:0 0 12px;">
          These workbooks are designed to be written in. If you would like to work on paper, hand the specifications below to any print shop for a beautiful, lasting result.
        </p>
        <table cellpadding="0" cellspacing="0" style="width:100%;font-family:'Outfit',sans-serif;font-size:12px;color:#2F4F3F;line-height:1.5;">
          <tr><td style="padding:3px 0;color:#a89878;width:130px;vertical-align:top;">Size</td><td style="padding:3px 0;">A4, 210 &times; 297 mm, portrait</td></tr>
          <tr><td style="padding:3px 0;color:#a89878;vertical-align:top;">Print</td><td style="padding:3px 0;">Single-sided, full colour, at 100% / actual size (do not "fit to page" or scale)</td></tr>
          <tr><td style="padding:3px 0;color:#a89878;vertical-align:top;">Resolution</td><td style="padding:3px 0;">300 DPI</td></tr>
          <tr><td style="padding:3px 0;color:#a89878;vertical-align:top;">Interior paper</td><td style="padding:3px 0;">120gsm uncoated matte (takes pen well, minimal show-through)</td></tr>
          <tr><td style="padding:3px 0;color:#a89878;vertical-align:top;">Binding</td><td style="padding:3px 0;">Spiral / coil bound, so it lies flat for writing</td></tr>
          <tr><td style="padding:3px 0;color:#a89878;vertical-align:top;">Front cover</td><td style="padding:3px 0;">Clear gloss (transparent) cover sheet</td></tr>
          <tr><td style="padding:3px 0;color:#a89878;vertical-align:top;">Back cover</td><td style="padding:3px 0;">250 to 300gsm card</td></tr>
          <tr><td style="padding:3px 0;color:#a89878;vertical-align:top;">Note</td><td style="padding:3px 0;">Files are A4 with no bleed, so a thin white border is normal. Ask for edge-to-edge if you prefer.</td></tr>
        </table>
      </div>
    </div>

    <div style="background:#F7EFE4;border:0.5px solid #E6D8C3;border-radius:8px;padding:22px 24px;margin:0 0 4px;">
      <p style="font-family:'Outfit',sans-serif;font-size:10px;letter-spacing:2.5px;text-transform:uppercase;color:#C2A46F;margin:0 0 12px;text-align:center;">Before you begin</p>
      <p style="font-family:Georgia,serif;font-size:14.5px;font-style:italic;color:#2F4F3F;line-height:1.8;margin:0 0 12px;text-align:center;">
        There is a version of you already waiting on the other side of this work. Calmer. Clearer. More rooted in what is true for you. Not someone you have to become, but someone you are coming home to.
      </p>
      <p style="font-family:Georgia,serif;font-size:14.5px;font-style:italic;color:#2F4F3F;line-height:1.8;margin:0;text-align:center;">
        Every page you open and every honest sentence you write is one step closer. So begin when you are ready. Begin small if you need to. But begin. You have been waiting.
      </p>
    </div>

    <p style="font-family:Georgia,serif;font-size:13px;font-style:italic;color:#C2A46F;margin:26px 0 0;">
      With care,<br>
      <strong style="font-family:Georgia,serif;font-style:normal;color:#2F4F3F;font-size:15px;">Mel</strong>
    </p>
  </td></tr>

  <tr><td style="background:#2F4F3F;padding:20px 36px;border-radius:0 0 10px 10px;text-align:center;">
    <p style="font-family:'Outfit',sans-serif;font-size:11px;color:rgba(245,240,232,0.3);margin:0;">
      <a href="${siteUrl}" style="color:rgba(194,164,111,0.6);text-decoration:none;">findyourcompasswithin.com</a>
    </p>
  </td></tr>

</table></td></tr></table></body></html>`;
}

function buildLibraryEmail({ customerName, downloadLinks, siteUrl }) {
  const firstName = escapeHtml(String(customerName).split(' ')[0]);
  const linkRows = downloadLinks.map(link => `
    <tr><td style="padding:0 0 12px 0;">
      <a href="${link.url}" style="display:block;background:#2F4F3F;color:#F2E8D9;text-decoration:none;padding:14px 20px;border-radius:6px;font-family:'Outfit',sans-serif;font-size:13px;font-weight:400;">
        &#8659;&nbsp; Download: ${link.name}
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
      <h1 style="font-family:Georgia,serif;font-size:28px;font-weight:400;color:#F5F0E8;margin:0;">Welcome <em style="color:#d9be92;">back</em></h1>
    </div>
  </td></tr>
  <tr><td style="background:#fff;padding:36px;border:0.5px solid #E6D8C3;border-top:none;">
    <p style="font-family:'Outfit',sans-serif;font-size:15px;color:#2F4F3F;margin:0 0 8px;">Hi ${firstName},</p>
    <p style="font-family:'Outfit',sans-serif;font-size:14px;color:#5a7a68;line-height:1.7;margin:0 0 24px;">
      Here are fresh download links for everything you have purchased from Find Your Compass Within. Your workbooks are yours: come back to them as often as you need.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0">${linkRows}</table>
    <div style="background:#F7EFE4;border:0.5px solid #E6D8C3;border-radius:6px;padding:14px 18px;margin:8px 0 24px;">
      <p style="font-family:'Outfit',sans-serif;font-size:12px;color:#5a7a68;margin:0;line-height:1.6;">
        &#9651; These links are valid for <strong>12 months</strong>, and you can request fresh ones any time at <a href="${siteUrl}/downloads" style="color:#2F4F3F;font-weight:500;">${siteUrl.replace('https://','')}/downloads</a>.
      </p>
    </div>
    <p style="font-family:Georgia,serif;font-size:13px;font-style:italic;color:#C2A46F;margin:16px 0 0;">
      With care,<br>
      <strong style="font-family:Georgia,serif;font-style:normal;color:#2F4F3F;font-size:15px;">Mel</strong>
    </p>
  </td></tr>
  <tr><td style="background:#2F4F3F;padding:20px 36px;border-radius:0 0 10px 10px;text-align:center;">
    <p style="font-family:'Outfit',sans-serif;font-size:11px;color:rgba(245,240,232,0.3);margin:0;">
      <a href="${siteUrl}" style="color:rgba(194,164,111,0.6);text-decoration:none;">findyourcompasswithin.com</a>
    </p>
  </td></tr>
</table></td></tr></table></body></html>`;
}
