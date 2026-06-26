/**
 * /api/admin
 * ──────────
 * Protected admin endpoints for managing bookings and blocked dates.
 * All requests must include Authorization: Bearer {ADMIN_PASSWORD}
 *
 * GET  /api/admin?action=bookings          → upcoming bookings list
 * GET  /api/admin?action=blocked           → all blocked dates
 * POST /api/admin  { action:'block',   date, reason }       → block a date
 * POST /api/admin  { action:'unblock', date }               → unblock a date
 * POST /api/admin  { action:'cancel',  bookingId }          → cancel a booking
 * POST /api/admin  { action:'approveTime', bookingId, date, time }
 *                                          → confirm a custom-time request and
 *                                            email the client automatically
 */

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { buildClientConfirmationEmail } from './create-booking.js';
import { fulfillOrder } from './_fulfill.js';
import { PRODUCTS } from './_products.js';
import { makeSessionInvite } from './_ical.js';

function checkAuth(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  return token === process.env.ADMIN_PASSWORD;
}

export default async function handler(req, res) {
  // The cron path is hit by GitHub Actions and validates a separate
  // CRON_SECRET, NOT the admin password. Handled before the admin-auth
  // gate so the scheduler does not need access to the dashboard credentials.
  if (req.method === 'GET' && req.query.action === 'cron') {
    return handleCron(req, res);
  }

  if (!checkAuth(req)) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // ── GET requests ─────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { action } = req.query;

    if (action === 'bookings') {
      const today = new Date().toISOString().split('T')[0];
      const { data, error } = await supabase
        .from('bookings')
        .select(`
          id, client_name, client_email, package_name, sessions_total, sessions_booked,
          session_date, session_time, status, questionnaire_completed, created_at,
          custom_time_request, client_timezone
        `)
        .not('status', 'eq', 'cancelled')
        .order('session_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false });

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ bookings: data || [] });
    }

    if (action === 'blocked') {
      const { data, error } = await supabase
        .from('blocked_dates')
        .select('id, block_date, reason')
        .order('block_date', { ascending: true });

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ blocked: data || [] });
    }

    if (action === 'questionnaire') {
      const { bookingId } = req.query;
      if (!bookingId) return res.status(400).json({ error: 'bookingId required' });

      const { data, error } = await supabase
        .from('questionnaire_responses')
        .select('*')
        .eq('booking_id', bookingId)
        .single();

      if (error || !data) return res.status(404).json({ error: 'Not found' });

      // Look up the booking's product so the admin modal can choose the right
      // label for themed intakes (perimenopause circles vs generic coaching).
      const { data: booking } = await supabase
        .from('bookings')
        .select('package_id')
        .eq('id', bookingId)
        .single();
      const intake = PRODUCTS[booking?.package_id]?.intake || 'general';

      return res.status(200).json({ questionnaire: { ...data, intake } });
    }

    if (action === 'questions') {
      const { data, error } = await supabase
        .from('question_submissions')
        .select('id, name, email, q1, q2, q3, q4, q5, created_at')
        .order('created_at', { ascending: false });

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ questions: data || [] });
    }

    if (action === 'support') {
      const { data, error } = await supabase
        .from('support_messages')
        .select('id, name, email, message, created_at')
        .order('created_at', { ascending: false });

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ support: data || [] });
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  // ── POST requests ─────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { action } = req.body;

    if (action === 'block') {
      const { date, reason = '' } = req.body;
      if (!date) return res.status(400).json({ error: 'Date required' });

      const { error } = await supabase
        .from('blocked_dates')
        .upsert({ block_date: date, reason }, { onConflict: 'block_date' });

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true });
    }

    if (action === 'unblock') {
      const { date } = req.body;
      if (!date) return res.status(400).json({ error: 'Date required' });

      const { error } = await supabase
        .from('blocked_dates')
        .delete()
        .eq('block_date', date);

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true });
    }

    if (action === 'cancel') {
      const { bookingId } = req.body;
      if (!bookingId) return res.status(400).json({ error: 'bookingId required' });

      const { error } = await supabase
        .from('bookings')
        .update({ status: 'cancelled' })
        .eq('id', bookingId);

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true });
    }

    // Approve a custom time request: set the agreed date/time, confirm, and
    // email the client. The time is whatever Mel agreed, so it is not limited
    // to the standard slots.
    if (action === 'approveTime') {
      const { bookingId, date, time } = req.body;
      if (!bookingId || !date || !time) {
        return res.status(400).json({ error: 'bookingId, date and time are required' });
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
        return res.status(400).json({ error: 'Invalid date or time format' });
      }

      const { data: booking, error: fetchError } = await supabase
        .from('bookings')
        .select('id, client_name, client_email, package_name, sessions_booked, questionnaire_token')
        .eq('id', bookingId)
        .single();

      if (fetchError || !booking) return res.status(404).json({ error: 'Booking not found' });

      const { error: updateError } = await supabase
        .from('bookings')
        .update({
          session_date:    date,
          session_time:    time,
          sessions_booked: (booking.sessions_booked || 0) + 1,
          status:          'confirmed',
        })
        .eq('id', bookingId);

      if (updateError) return res.status(500).json({ error: updateError.message });

      const displayDate = new Date(`${date}T12:00:00+02:00`).toLocaleDateString('en-ZA', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Africa/Johannesburg',
      });
      const displayTime = `${time} SAST`;
      const resend      = new Resend(process.env.RESEND_API_KEY);
      const fromAddress = `${process.env.FROM_NAME || 'Find Your Compass Within'} <${process.env.FROM_EMAIL}>`;
      const siteUrl     = process.env.SITE_URL || 'https://findyourcompasswithin.com';
      const meetLink    = process.env.MEET_LINK || '#';

      const invite = makeSessionInvite({
        bookingId:   booking.id,
        date,
        time,
        summary:     `${booking.package_name} with Mel Cooper`,
        description: `Your session with Mel Cooper.\n\nJoin on Google Meet: ${meetLink}\n\nNothing to prepare. Just bring yourself.`,
        meetLink,
        clientName:  booking.client_name,
        clientEmail: booking.client_email,
        ownerEmail:  process.env.FROM_EMAIL,
      });

      try {
        await resend.emails.send({
          from:    fromAddress,
          to:      booking.client_email,
          subject: `Your session is confirmed: ${displayDate}`,
          html:    buildClientConfirmationEmail({
            clientName:  booking.client_name,
            packageName: booking.package_name,
            displayDate, displayTime, meetLink, siteUrl,
            token:       booking.questionnaire_token,
          }),
          attachments: [invite],
        });
      } catch (mailErr) {
        // The booking is confirmed; a mail failure should not undo that.
        console.error('[Admin] approveTime email failed:', mailErr);
        return res.status(200).json({ success: true, emailed: false });
      }

      return res.status(200).json({ success: true, emailed: true, date: displayDate, time: displayTime });
    }

    // Manual sale: create the booking and send the same welcome email (5 Questions
    // + questionnaire/booking links) a real coaching purchase would, no payment.
    if (action === 'invite') {
      const { email, name = '', productId = 'compass-reading' } = req.body;
      if (!email || !String(email).includes('@')) {
        return res.status(400).json({ error: 'A valid email is required' });
      }
      const product = PRODUCTS[productId];
      if (!product || product.type !== 'coaching') {
        return res.status(400).json({ error: 'Please choose a coaching package' });
      }
      const result = await fulfillOrder({
        product,
        productId,
        customerEmail: String(email).toLowerCase().trim(),
        customerName:  String(name).trim(),
        paymentId:     `MANUAL-${Date.now()}`,
        paymentMethod: 'manual',
      });
      if (!result || !result.ok) {
        return res.status(500).json({ error: 'Could not send the invitation' });
      }
      return res.status(200).json({ success: true });
    }

    // recordSale: fires the same fulfillOrder path a real online purchase
    // would, but without going through Payfast. Used for cash, in-person,
    // and off-platform sales. Accepts any product (digital, coaching, group).
    if (action === 'recordSale') {
      const { email, name = '', productId } = req.body;
      if (!email || !String(email).includes('@')) {
        return res.status(400).json({ error: 'A valid email is required' });
      }
      const product = PRODUCTS[productId];
      if (!product) {
        return res.status(400).json({ error: 'Unknown product' });
      }
      const result = await fulfillOrder({
        product,
        productId,
        customerEmail: String(email).toLowerCase().trim(),
        customerName:  String(name).trim() || 'there',
        paymentId:     `SALE-${Date.now()}`,
        paymentMethod: 'cash',
      });
      if (!result || !result.ok) {
        return res.status(500).json({ error: result?.error || 'Sale fulfilment failed' });
      }
      return res.status(200).json({ success: true, duplicate: !!result.duplicate });
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// ─────────────────────────────────────────────────────────────────────────────
// Weekly RSVP reminders for group rounds (Compass Circles).
// Cron is hit daily by GitHub Actions. We find every circle_attendance row
// whose call is 1-3 days away and hasn't been reminded yet, then email the
// member with "I'll be there / Send me the replay / Add to Calendar" buttons.
// ─────────────────────────────────────────────────────────────────────────────

async function handleCron(req, res) {
  if (!process.env.CRON_SECRET) {
    return res.status(500).json({ error: 'CRON_SECRET not configured' });
  }
  if (req.query.secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // SAST window: tomorrow through three days out, inclusive.
  const sastToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [y, m, d] = sastToday.split('-').map(Number);
  const addDays = (n) => {
    const dt = new Date(Date.UTC(y, m - 1, d + n));
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
  };
  const windowStart = addDays(1);
  const windowEnd   = addDays(3);

  // Pull pending reminders + the booking they belong to in one round trip.
  const { data: rows, error } = await supabase
    .from('circle_attendance')
    .select(`
      id, booking_id, week_number, session_date, session_time, rsvp_token,
      bookings:booking_id ( id, client_name, client_email, package_id, package_name, status )
    `)
    .is('reminded_at', null)
    .gte('session_date', windowStart)
    .lte('session_date', windowEnd);

  if (error) {
    console.error('[Cron] circle_attendance fetch failed:', error);
    return res.status(500).json({ error: error.message });
  }

  const resend      = new Resend(process.env.RESEND_API_KEY);
  const fromAddress = `${process.env.FROM_NAME || 'Find Your Compass Within'} <${process.env.FROM_EMAIL}>`;
  const siteUrl     = process.env.SITE_URL || 'https://www.findyourcompasswithin.com';

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of (rows || [])) {
    const booking = row.bookings;
    if (!booking || booking.status === 'cancelled') { skipped++; continue; }
    const product = PRODUCTS[booking.package_id];
    // Only fire reminders once the cohort dates are confirmed real, not
    // placeholders. Lets the system stand built while Mel finalises dates.
    if (!product?.cohort?.confirmed) { skipped++; continue; }
    const totalWeeks = product.sessions || 6;

    try {
      await resend.emails.send({
        from:    fromAddress,
        to:      booking.client_email,
        subject: `Week ${row.week_number} of ${totalWeeks}: ${displaySastDate(row.session_date)} at ${row.session_time.substring(0,5)}`,
        html:    buildCircleReminderEmail({
          clientName:   booking.client_name,
          packageName:  booking.package_name,
          weekNumber:   row.week_number,
          totalWeeks,
          sessionDate:  row.session_date,
          sessionTime:  row.session_time,
          rsvpToken:    row.rsvp_token,
          meetLink:     process.env.MEET_LINK || '#',
          siteUrl,
        }),
      });
      await supabase
        .from('circle_attendance')
        .update({ reminded_at: new Date().toISOString() })
        .eq('id', row.id);
      sent++;
    } catch (e) {
      console.error('[Cron] reminder send failed for row', row.id, e);
      failed++;
    }
  }

  return res.status(200).json({ ok: true, sent, skipped, failed, windowStart, windowEnd });
}

function displaySastDate(dateStr) {
  return new Date(`${dateStr}T12:00:00+02:00`).toLocaleDateString('en-ZA', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Johannesburg',
  });
}

function buildCircleReminderEmail({ clientName, packageName, weekNumber, totalWeeks, sessionDate, sessionTime, rsvpToken, meetLink, siteUrl }) {
  const firstName = escapeHtmlMini(String(clientName).split(' ')[0] || 'there');
  const dayLong   = displaySastDate(sessionDate);
  const timeShort = sessionTime.substring(0, 5);
  const yesUrl    = `${siteUrl}/api/verify-token?token=${encodeURIComponent(rsvpToken)}&format=rsvp&choice=yes`;
  const noUrl     = `${siteUrl}/api/verify-token?token=${encodeURIComponent(rsvpToken)}&format=rsvp&choice=no`;
  const calUrl    = `${siteUrl}/api/verify-token?token=${encodeURIComponent(rsvpToken)}&format=ics`;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F2E8D9;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F2E8D9;padding:40px 20px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
  <tr><td style="background:#2F4F3F;border-radius:10px 10px 0 0;overflow:hidden;">
    <div style="height:3px;background:linear-gradient(90deg,#C2A46F,#A6B695,#C2A46F);"></div>
    <div style="padding:30px 36px 26px;text-align:center;">
      <p style="font-family:'Outfit',sans-serif;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:rgba(194,164,111,0.7);margin:0 0 10px;">${escapeHtmlMini(packageName)}</p>
      <h1 style="font-family:Georgia,serif;font-size:26px;font-weight:400;color:#F5F0E8;margin:0;line-height:1.3;">Week <em style="color:#d9be92;">${weekNumber}</em> of ${totalWeeks}</h1>
      <p style="font-family:'Outfit',sans-serif;font-size:13px;color:rgba(245,240,232,0.65);margin:8px 0 0;">${escapeHtmlMini(dayLong)} &middot; ${timeShort} SAST</p>
    </div>
  </td></tr>
  <tr><td style="background:#fff;padding:32px 36px;border:0.5px solid #E6D8C3;border-top:none;">
    <p style="font-family:'Outfit',sans-serif;font-size:15px;color:#2F4F3F;margin:0 0 14px;">Hi ${firstName},</p>
    <p style="font-family:'Outfit',sans-serif;font-size:14px;color:#5a7a68;line-height:1.75;margin:0 0 20px;">
      A quick note that our next circle is coming up. Whether you can make it live or you need the replay, please let me know below so I can plan the call around the group.
    </p>

    <div style="text-align:center;margin:18px 0 10px;">
      <a href="${yesUrl}" style="display:inline-block;background:#2F4F3F;color:#F2E8D9;text-decoration:none;padding:13px 26px;border-radius:7px;font-family:'Outfit',sans-serif;font-size:13px;font-weight:500;margin:0 6px 8px;">I'll be there</a>
      <a href="${noUrl}"  style="display:inline-block;background:#fff;color:#2F4F3F;text-decoration:none;padding:12px 24px;border:1px solid #C2A46F;border-radius:7px;font-family:'Outfit',sans-serif;font-size:13px;font-weight:500;margin:0 6px 8px;">Send me the replay</a>
    </div>
    <div style="text-align:center;margin:0 0 22px;">
      <a href="${calUrl}" style="font-family:'Outfit',sans-serif;font-size:12px;color:#C2A46F;text-decoration:none;">Add this call to your calendar</a>
    </div>

    <div style="background:#F7EFE4;border:0.5px solid #E6D8C3;border-radius:6px;padding:14px 18px;margin:0 0 22px;">
      <p style="font-family:'Outfit',sans-serif;font-size:12px;color:#5a7a68;margin:0;line-height:1.6;">
        <strong style="color:#2F4F3F;">Join on the day:</strong> <a href="${meetLink}" style="color:#2F4F3F;font-weight:500;">${meetLink.replace(/^https?:\/\//, '')}</a>
      </p>
    </div>

    <p style="font-family:Georgia,serif;font-size:13px;font-style:italic;color:#5a7a68;line-height:1.7;margin:0 0 14px;">
      Whatever this week has been, you do not need to be anywhere except where you are. Come as you are.
    </p>
    <p style="font-family:Georgia,serif;font-size:13px;font-style:italic;color:#C2A46F;margin:16px 0 0;">
      With care,<br>
      <strong style="font-family:Georgia,serif;font-style:normal;color:#2F4F3F;font-size:15px;">Mel</strong>
    </p>
  </td></tr>
  <tr><td style="background:#2F4F3F;padding:18px 36px;border-radius:0 0 10px 10px;text-align:center;">
    <p style="font-family:'Outfit',sans-serif;font-size:11px;color:rgba(245,240,232,0.3);margin:0;">
      <a href="${siteUrl}" style="color:rgba(194,164,111,0.6);text-decoration:none;">findyourcompasswithin.com</a>
    </p>
  </td></tr>
</table></td></tr></table></body></html>`;
}

function escapeHtmlMini(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
