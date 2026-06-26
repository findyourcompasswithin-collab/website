/**
 * GET /api/verify-token?token=UUID
 * ─────────────────────────────────
 * Default: validates a questionnaire token and returns booking details as
 *          JSON. Used by questionnaire.html and schedule.html to load context.
 *
 * ?format=ics: returns the booking's session as an .ics calendar file
 *              with Content-Type: text/calendar. Used by the "Add to
 *              Calendar" button in confirmation emails. The booking must
 *              be confirmed (session_date + session_time populated).
 *
 * Endpoints are merged here to stay under the Vercel Hobby 12-function cap.
 */

import { createClient } from '@supabase/supabase-js';
import { PRODUCTS } from './_products.js';
import { makeSessionInvite } from './_ical.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { token, format } = req.query;
  if (!token) return res.status(400).json({ error: 'Token required' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

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
