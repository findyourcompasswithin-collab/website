/**
 * GET /api/verify-token?token=UUID
 * ─────────────────────────────────
 * Default: validates a questionnaire token and returns booking details as
 *          JSON. Used by questionnaire.html and schedule.html to load context.
 *
 * ?format=ics: returns a one-event .ics calendar file with Content-Type:
 *              text/calendar. Token can be either a booking's
 *              questionnaire_token (returns the 1:1 session) or a
 *              circle_attendance row's rsvp_token (returns that week's
 *              circle call).
 *
 * ?format=rsvp&choice=yes|no: records an RSVP against a circle_attendance
 *              row identified by its rsvp_token, then renders a friendly
 *              HTML confirmation page.
 *
 * Endpoints are merged here to stay under the Vercel Hobby 12-function cap.
 */

import { createClient } from '@supabase/supabase-js';
import { PRODUCTS } from './_products.js';
import { makeSessionInvite } from './_ical.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { token, format, choice } = req.query;
  if (!token) return res.status(400).json({ error: 'Token required' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // RSVP: token is a circle_attendance.rsvp_token. Update the row and render
  // a small confirmation page back to the member.
  if (format === 'rsvp') {
    return handleRsvp(req, res, supabase, token, choice);
  }

  // Smart token lookup for the .ics path: if the token matches a circle
  // attendance row, generate the .ics for THAT call; otherwise fall through
  // to the existing booking-by-questionnaire-token path.
  if (format === 'ics') {
    const circleIcs = await tryCircleIcs(supabase, token);
    if (circleIcs) {
      res.setHeader('Content-Type',        'text/calendar; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="circle-call.ics"');
      res.setHeader('Cache-Control',       'no-store');
      return res.status(200).send(circleIcs);
    }
  }

  const COLS = 'id, client_name, client_email, package_id, package_name, sessions_total, sessions_booked, status, questionnaire_completed, session_date, session_time';

  const { data: booking, error } = await supabase
    .from('bookings')
    .select(COLS)
    .eq('questionnaire_token', token)
    .single();

  if (error || !booking) {
    return res.status(404).json(format === 'ics' ? { error: 'Not found' } : { error: 'Invalid or expired token' });
  }

  // Calendar invite: serve the .ics file for an already-confirmed session.
  if (format === 'ics') {
    if (!booking.session_date || !booking.session_time) {
      return res.status(400).send('This booking does not have a confirmed date and time yet');
    }
    const meetLink = process.env.MEET_LINK || '#';
    const invite = makeSessionInvite({
      bookingId:   booking.id,
      date:        booking.session_date,
      time:        booking.session_time,
      summary:     `${booking.package_name} with Mel Cooper`,
      description: `Your session with Mel Cooper.\n\nJoin on Google Meet: ${meetLink}\n\nNothing to prepare. Just bring yourself.`,
      meetLink,
      clientName:  booking.client_name,
      clientEmail: booking.client_email,
      ownerEmail:  process.env.FROM_EMAIL,
    });
    const ics = Buffer.from(invite.content, 'base64').toString('utf8');
    res.setHeader('Content-Type',        'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="session.ics"');
    res.setHeader('Cache-Control',       'no-store');
    return res.status(200).send(ics);
  }

  // Default: JSON booking details. Surface the product format so group rounds
  // (Compass Circles) can route around the 1:1 self-serve calendar. Surface
  // intake so the questionnaire knows which step 2 variant to render.
  const product = PRODUCTS[booking.package_id] || {};
  booking.format = product.format || 'individual';
  booking.cohort = product.cohort || null;
  booking.intake = product.intake || 'general';

  return res.status(200).json({ booking });
}

// ─────────────────────────────────────────────────────────────────────────────
// Circle RSVP + per-call .ics helpers (Phase C).
// ─────────────────────────────────────────────────────────────────────────────

async function handleRsvp(req, res, supabase, rsvpToken, choice) {
  if (choice !== 'yes' && choice !== 'no') {
    return res.status(400).send('choice must be yes or no');
  }
  const status      = choice === 'yes' ? 'attending' : 'replay';
  const respondedAt = new Date().toISOString();

  const { data: row, error } = await supabase
    .from('circle_attendance')
    .update({ status, responded_at: respondedAt })
    .eq('rsvp_token', rsvpToken)
    .select('week_number, session_date, session_time, bookings:booking_id ( client_name, package_name )')
    .single();

  if (error || !row) {
    return res.status(404).send(rsvpPage({
      title: 'Link not recognised',
      heading: 'We could not find that RSVP',
      body:  'The link may have expired or been used. If you meant to confirm or change your RSVP, just reply to the reminder email and I will update it for you.',
    }));
  }

  const firstName = String(row.bookings?.client_name || '').split(' ')[0] || 'there';
  const day = new Date(`${row.session_date}T12:00:00+02:00`).toLocaleDateString('en-ZA', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Johannesburg',
  });
  const time = String(row.session_time || '').substring(0, 5);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (status === 'attending') {
    return res.status(200).send(rsvpPage({
      title: 'See you there',
      heading: `Got it, ${firstName}`,
      body:   `I have you down for Week ${row.week_number} on ${day} at ${time} SAST. Looking forward to it.`,
    }));
  }
  return res.status(200).send(rsvpPage({
    title: 'Noted',
    heading: `Thanks, ${firstName}`,
    body:    `I have you marked for the replay of Week ${row.week_number} (${day} at ${time} SAST). I will send it through once the call is done.`,
  }));
}

function rsvpPage({ title, heading, body }) {
  const site = process.env.SITE_URL || 'https://www.findyourcompasswithin.com';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title>
<style>
body{margin:0;background:#F2E8D9;font-family:'Outfit','Helvetica Neue',sans-serif;color:#2F4F3F;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:32px 20px;box-sizing:border-box}
.card{max-width:520px;width:100%;background:#fff;border:0.5px solid #E6D8C3;border-radius:12px;overflow:hidden}
.bar{height:3px;background:linear-gradient(90deg,#C2A46F,#A6B695,#C2A46F)}
.head{background:#2F4F3F;padding:32px 36px;text-align:center}
.head .eyebrow{font-size:11px;letter-spacing:3px;text-transform:uppercase;color:rgba(194,164,111,0.7);margin:0 0 10px}
.head h1{font-family:Georgia,serif;font-size:26px;font-weight:400;color:#F5F0E8;margin:0;line-height:1.3}
.body{padding:28px 36px 32px;text-align:center}
.body p{font-size:14px;color:#5a7a68;line-height:1.7;margin:0 0 20px}
.body a{color:#C2A46F;text-decoration:none;font-size:12px;letter-spacing:1px;text-transform:uppercase}
</style></head>
<body><div class="card"><div class="bar"></div>
<div class="head"><p class="eyebrow">Find Your Compass Within</p><h1>${heading}</h1></div>
<div class="body"><p>${body}</p><a href="${site}">Back to the site</a></div>
</div></body></html>`;
}

async function tryCircleIcs(supabase, token) {
  const { data: row, error } = await supabase
    .from('circle_attendance')
    .select('id, week_number, session_date, session_time, bookings:booking_id ( id, client_name, client_email, package_name )')
    .eq('rsvp_token', token)
    .single();
  if (error || !row || !row.bookings) return null;

  const meetLink = process.env.MEET_LINK || '#';
  const invite = makeSessionInvite({
    bookingId:   `${row.bookings.id}-w${row.week_number}`,
    date:        row.session_date,
    time:        row.session_time,
    summary:     `${row.bookings.package_name} – Week ${row.week_number}`,
    description: `Week ${row.week_number} circle with Mel Cooper.\n\nJoin on Google Meet: ${meetLink}`,
    meetLink,
    clientName:  row.bookings.client_name,
    clientEmail: row.bookings.client_email,
    ownerEmail:  process.env.FROM_EMAIL,
  });
  return Buffer.from(invite.content, 'base64').toString('utf8');
}
