/**
 * GET /api/calendar-invite?bookingId=UUID&token=UUID
 * ──────────────────────────────────────────────────
 * Generates a one-event .ics file for a confirmed 1:1 session and serves it
 * with Content-Type: text/calendar. Triggered by the "Add to Calendar" button
 * in the booking confirmation email.
 *
 * Auth is the existing questionnaire_token on the booking, so only someone
 * who already received the email (or owns the inbox it went to) can pull
 * down the invite. The booking must be confirmed (session_date + session_time
 * populated).
 */

import { createClient } from '@supabase/supabase-js';
import { makeSessionInvite } from './_ical.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).send('Method not allowed');

  const { bookingId, token } = req.query;
  if (!bookingId || !token) return res.status(400).send('bookingId and token required');

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const { data: booking, error } = await supabase
    .from('bookings')
    .select('id, client_name, client_email, package_name, session_date, session_time, status')
    .eq('id', bookingId)
    .eq('questionnaire_token', token)
    .single();

  if (error || !booking) return res.status(404).send('Not found');
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

  // makeSessionInvite returns base64-encoded content for Resend. For HTTP
  // delivery we want the raw .ics string.
  const ics = Buffer.from(invite.content, 'base64').toString('utf8');

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="session.ics"`);
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).send(ics);
}
