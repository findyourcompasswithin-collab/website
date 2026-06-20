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

function checkAuth(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  return token === process.env.ADMIN_PASSWORD;
}

export default async function handler(req, res) {
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
      return res.status(200).json({ questionnaire: data });
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
        .select('id, client_name, client_email, package_name, sessions_booked')
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

      try {
        await resend.emails.send({
          from:    fromAddress,
          to:      booking.client_email,
          subject: `Your session is confirmed: ${displayDate}`,
          html:    buildClientConfirmationEmail({
            clientName:  booking.client_name,
            packageName: booking.package_name,
            displayDate, displayTime, meetLink, siteUrl,
          }),
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

    return res.status(400).json({ error: 'Unknown action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
