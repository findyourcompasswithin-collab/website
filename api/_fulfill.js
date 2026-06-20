/**
 * Shared order fulfilment.
 * ────────────────────────
 * Called by both payment lanes (Payfast ITN and PayPal capture) after a
 * verified payment:
 *   digital products  → generates Supabase signed URLs → emails download links
 *   coaching products → creates booking record → emails questionnaire link
 */

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { PRODUCTS } from './_products.js';

const BUCKET = 'workbooks';
const URL_EXPIRY_SECONDS = 31536000; // 12 months

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

  const downloadLinks = [];
  const attachments   = [];
  // Single-file products are attached to the email; multi-file bundles (esp. the
  // 13-PDF Complete Collection) stay link-only to keep the email small and deliverable.
  const attachFiles   = product.files.length <= 1;
  for (const fileName of product.files) {
    // download:true makes the signed URL force a download instead of opening
    // the (ugly) Supabase URL in the browser.
    const { data: urlData, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(fileName, URL_EXPIRY_SECONDS, { download: true });

    if (error) {
      console.error(`[Supabase] Signed URL error for ${fileName}:`, error);
      continue;
    }
    downloadLinks.push({ name: fileDisplayName(fileName), url: urlData.signedUrl });
    if (attachFiles) attachments.push({ filename: fileName, path: urlData.signedUrl });
  }

  if (downloadLinks.length === 0) {
    console.error('[Fulfill] No download links for product:', productId);
    return { ok: false, error: 'no_links' };
  }

  await resend.emails.send({
    from:        fromAddress,
    to:          customerEmail,
    subject:     `Your download is ready: ${product.displayName}`,
    html:        buildDownloadEmail({ customerName: name, product, downloadLinks, siteUrl, attached: attachments.length > 0 }),
    attachments: attachments.length ? attachments : undefined,
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

function buildDownloadEmail({ customerName, product, downloadLinks, siteUrl, attached }) {
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
      <h1 style="font-family:Georgia,serif;font-size:28px;font-weight:400;color:#F5F0E8;margin:0;">Your download is <em style="color:#d9be92;">ready</em></h1>
    </div>
  </td></tr>
  <tr><td style="background:#fff;padding:36px;border:0.5px solid #E6D8C3;border-top:none;">
    <p style="font-family:'Outfit',sans-serif;font-size:15px;color:#2F4F3F;margin:0 0 8px;">Hi ${firstName},</p>
    <p style="font-family:'Outfit',sans-serif;font-size:14px;color:#5a7a68;line-height:1.7;margin:0 0 24px;">
      Thank you for purchasing <strong style="color:#2F4F3F;">${escapeHtml(product.displayName)}</strong>. Your file${downloadLinks.length > 1 ? 's are' : ' is'} ready below.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0">${linkRows}</table>
    <div style="background:#F7EFE4;border:0.5px solid #E6D8C3;border-radius:6px;padding:14px 18px;margin:8px 0 24px;">
      <p style="font-family:'Outfit',sans-serif;font-size:12px;color:#5a7a68;margin:0;line-height:1.6;">
        &#9651; ${attached ? 'Your workbook is also attached to this email, so it is yours to keep. ' : ''}Your download link${downloadLinks.length > 1 ? 's are' : ' is'} valid for <strong>12 months</strong>, so you can return whenever you need it. If a link ever stops working, you can request fresh links for everything you own at <a href="${siteUrl}/downloads" style="color:#2F4F3F;font-weight:500;">${siteUrl.replace('https://','')}/downloads</a>, or simply reply to this email.
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
