/**
 * POST /api/create-booking
 * ──────────────────────────
 * Books a session slot. Validates availability, saves booking,
 * and sends confirmation emails to both client and Mel.
 */

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { TIME_SLOTS, SAST_OFFSET_HOURS as SAST_OFFSET } from './_schedule.js';
import { makeSessionInvite } from './_ical.js';

const MIN_NOTICE_MS   = 60 * 60 * 1000; // 60 minutes

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token, date, time, preferredTimes, timezone } = req.body;
  if (!token) return res.status(400).json({ error: 'Token is required' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // Branch: a client outside the listed time zones requesting a custom time.
  // Handled inside this endpoint (rather than its own) to stay within Vercel's
  // 12-function limit.
  if (preferredTimes && preferredTimes.trim()) {
    return handleTimeRequest({ supabase, res, token, timezone, preferredTimes });
  }

  // Otherwise this is a normal slot booking.
  if (!date || !time) {
    return res.status(400).json({ error: 'Date and time are required' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Invalid date format' });
  }
  if (!TIME_SLOTS.includes(time)) {
    return res.status(400).json({ error: 'Invalid time slot' });
  }

  // Validate token
  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('id, client_name, client_email, package_name, sessions_total, sessions_booked, questionnaire_completed')
    .eq('questionnaire_token', token)
    .single();

  if (bookingError || !booking) {
    return res.status(404).json({ error: 'Invalid token' });
  }

  if (!booking.questionnaire_completed) {
    return res.status(400).json({ error: 'Please complete the questionnaire first' });
  }

  // Check minimum notice
  const [h] = time.split(':').map(Number);
  const slotUtcH = h - SAST_OFFSET;
  const slotMs   = new Date(`${date}T${String(slotUtcH).padStart(2, '0')}:00:00Z`).getTime();
  if (slotMs - Date.now() < MIN_NOTICE_MS) {
    return res.status(400).json({ error: 'This slot is no longer available, please choose another time' });
  }

  // Check slot not blocked
  const { data: blocked } = await supabase
    .from('blocked_dates')
    .select('id')
    .eq('block_date', date)
    .maybeSingle();

  if (blocked) {
    return res.status(400).json({ error: 'This date is not available, please choose another' });
  }

  // Check slot not already booked
  const { data: existing } = await supabase
    .from('bookings')
    .select('id')
    .eq('session_date', date)
    .eq('session_time', time)
    .not('status', 'eq', 'cancelled')
    .maybeSingle();

  if (existing) {
    return res.status(409).json({ error: 'This slot was just taken, please choose another time' });
  }

  // Confirm booking
  const { error: updateError } = await supabase
    .from('bookings')
    .update({
      session_date:    date,
      session_time:    time,
      sessions_booked: (booking.sessions_booked || 0) + 1,
      status:          'confirmed',
    })
    .eq('id', booking.id);

  if (updateError) {
    console.error('[Booking] Update error:', updateError);
    return res.status(500).json({ error: 'Could not confirm booking, please try again' });
  }

  // Format display date/time
  const displayDate = new Date(`${date}T12:00:00+02:00`).toLocaleDateString('en-ZA', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Africa/Johannesburg',
  });
  const displayTime = `${time} SAST`;

  const resend      = new Resend(process.env.RESEND_API_KEY);
  const siteUrl     = process.env.SITE_URL || 'https://findyourcompasswithin.com';
  const fromAddress = `${process.env.FROM_NAME || 'Find Your Compass Within'} <${process.env.FROM_EMAIL}>`;
  const meetLink    = process.env.MEET_LINK || '#';

  // Calendar invite attached to both emails so the client and Mel can accept
  // straight from their inbox. One .ics, two recipients.
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

  // Confirmation email to client
  await resend.emails.send({
    from:    fromAddress,
    to:      booking.client_email,
    subject: `Your session is confirmed: ${displayDate}`,
    html:    buildClientConfirmationEmail({
      clientName: booking.client_name,
      packageName: booking.package_name,
      displayDate,
      displayTime,
      meetLink,
      siteUrl,
      bookingId: booking.id,
      token,
    }),
    attachments: [invite],
  });

  // Notification to Mel
  await resend.emails.send({
    from:    fromAddress,
    to:      process.env.FROM_EMAIL,
    subject: `Session booked: ${booking.client_name}, ${displayDate} at ${time}`,
    html: `<div style="font-family:'Outfit',sans-serif;padding:20px;">
      <h3 style="color:#2F4F3F;">New session booked</h3>
      <p><strong>Client:</strong> ${escapeHtml(booking.client_name)} (${escapeHtml(booking.client_email)})</p>
      <p><strong>Package:</strong> ${escapeHtml(booking.package_name)}</p>
      <p><strong>Date:</strong> ${displayDate}</p>
      <p><strong>Time:</strong> ${displayTime}</p>
      <p><strong>Google Meet:</strong> <a href="${meetLink}">${meetLink}</a></p>
    </div>`,
    attachments: [invite],
  });

  return res.status(200).json({ success: true, date: displayDate, time: displayTime });
}

// Custom-time request: a client whose timezone is outside SA/UK/Europe, or who
// cannot make any listed slot, sends their timezone and preferred times. We flag
// the booking 'time_requested' and email Mel to approve a time from admin.
async function handleTimeRequest({ supabase, res, token, timezone = '', preferredTimes }) {
  const { data: booking, error } = await supabase
    .from('bookings')
    .select('id, client_name, client_email, package_name, questionnaire_completed')
    .eq('questionnaire_token', token)
    .single();

  if (error || !booking) return res.status(404).json({ error: 'Invalid token' });
  if (!booking.questionnaire_completed) {
    return res.status(400).json({ error: 'Please complete the questionnaire first' });
  }

  const { error: updateError } = await supabase
    .from('bookings')
    .update({
      custom_time_request: preferredTimes.trim(),
      client_timezone:     (timezone || '').trim() || null,
      status:              'time_requested',
    })
    .eq('id', booking.id);

  if (updateError) {
    console.error('[Booking] Time request error:', updateError);
    return res.status(500).json({ error: 'Could not send your request, please try again' });
  }

  const resend      = new Resend(process.env.RESEND_API_KEY);
  const fromAddress = `${process.env.FROM_NAME || 'Find Your Compass Within'} <${process.env.FROM_EMAIL}>`;

  await resend.emails.send({
    from:    fromAddress,
    to:      process.env.FROM_EMAIL,
    subject: `Time request: ${booking.client_name}, ${booking.package_name}`,
    html: `<div style="font-family:'Outfit',sans-serif;padding:20px;color:#2F4F3F">
      <h3 style="color:#2F4F3F;">A client has requested another time</h3>
      <p><strong>Client:</strong> ${escapeHtml(booking.client_name)} (${escapeHtml(booking.client_email)})</p>
      <p><strong>Package:</strong> ${escapeHtml(booking.package_name)}</p>
      <p><strong>Their timezone:</strong> ${escapeHtml(timezone || 'Not given')}</p>
      <p><strong>Times that suit them:</strong><br>${escapeHtml(preferredTimes).replace(/\n/g, '<br>')}</p>
      <p style="margin-top:16px;color:#5a7a68">Open your admin dashboard to approve a time. Confirming it there will email them automatically.</p>
    </div>`,
  });

  return res.status(200).json({ success: true });
}

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function buildClientConfirmationEmail({ clientName, packageName, displayDate, displayTime, meetLink, siteUrl, bookingId, token }) {
  const firstName = escapeHtml(clientName.split(' ')[0]);
  const calendarUrl = bookingId && token
    ? `${siteUrl}/api/calendar-invite?bookingId=${encodeURIComponent(bookingId)}&token=${encodeURIComponent(token)}`
    : null;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F2E8D9;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F2E8D9;padding:40px 20px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
  <tr><td style="background:#2F4F3F;border-radius:10px 10px 0 0;overflow:hidden;">
    <div style="height:3px;background:linear-gradient(90deg,#C2A46F,#A6B695,#C2A46F);"></div>
    <div style="padding:32px 36px 28px;text-align:center;">
      <p style="font-family:'Outfit',sans-serif;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:rgba(194,164,111,0.7);margin:0 0 10px;">Find Your Compass Within</p>
      <h1 style="font-family:Georgia,serif;font-size:26px;font-weight:400;color:#F5F0E8;margin:0;">Your session is <em style="color:#d9be92;">confirmed</em></h1>
    </div>
  </td></tr>
  <tr><td style="background:#fff;padding:36px;border:0.5px solid #E6D8C3;border-top:none;">
    <p style="font-family:'Outfit',sans-serif;font-size:14px;color:#2F4F3F;margin:0 0 20px;">Hi ${firstName},</p>

    <div style="background:#F7EFE4;border:0.5px solid #E6D8C3;border-radius:8px;padding:20px 24px;margin:0 0 24px;">
      <p style="font-family:'Outfit',sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#C2A46F;margin:0 0 12px;">Session Details</p>
      <p style="font-family:'Outfit',sans-serif;font-size:14px;color:#2F4F3F;margin:0 0 6px;"><strong>Package:</strong> ${escapeHtml(packageName)}</p>
      <p style="font-family:'Outfit',sans-serif;font-size:14px;color:#2F4F3F;margin:0 0 6px;"><strong>Date:</strong> ${displayDate}</p>
      <p style="font-family:'Outfit',sans-serif;font-size:14px;color:#2F4F3F;margin:0 0 6px;"><strong>Time:</strong> ${displayTime}</p>
      <p style="font-family:'Outfit',sans-serif;font-size:14px;color:#2F4F3F;margin:0;"><strong>Duration:</strong> 60 minutes</p>
    </div>

    <div style="text-align:center;margin:24px 0;">
      <a href="${meetLink}" style="display:inline-block;background:#2F4F3F;color:#F2E8D9;text-decoration:none;padding:14px 28px;border-radius:7px;font-family:'Outfit',sans-serif;font-size:13px;font-weight:500;margin:0 6px 8px;">
        Join Google Meet &rarr;
      </a>
      ${calendarUrl ? `<a href="${calendarUrl}" style="display:inline-block;background:#fff;color:#2F4F3F;text-decoration:none;padding:13px 26px;border:1px solid #C2A46F;border-radius:7px;font-family:'Outfit',sans-serif;font-size:13px;font-weight:500;margin:0 6px 8px;">
        Add to Calendar
      </a>` : ''}
    </div>

    <div style="background:#F7EFE4;border:0.5px solid #E6D8C3;border-radius:6px;padding:14px 18px;margin:0 0 24px;">
      <p style="font-family:'Outfit',sans-serif;font-size:12px;color:#5a7a68;margin:0;line-height:1.6;">
        Please save this email. To reschedule or cancel, reply to this email at least 24 hours in advance.
      </p>
    </div>

    <p style="font-family:'Outfit',sans-serif;font-size:14px;color:#5a7a68;line-height:1.7;margin:0 0 16px;">
      I have read through your questionnaire and I am already looking forward to our conversation.
      Come as you are.
    </p>
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
