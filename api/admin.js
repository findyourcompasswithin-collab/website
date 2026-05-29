/**
 * /api/admin
 * ──────────
 * Protected admin endpoints for managing bookings and blocked dates.
 * All requests must include Authorization: Bearer {ADMIN_PASSWORD}
 *
 * GET  /api/admin?action=bookings          → upcoming bookings list
 * GET  /api/admin?action=blocked           → all blocked dates
 * POST /api/admin  { action:'block',   date, reason }  → block a date
 * POST /api/admin  { action:'unblock', date }          → unblock a date
 * POST /api/admin  { action:'cancel',  bookingId }     → cancel a booking
 */

import { createClient } from '@supabase/supabase-js';

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
          session_date, session_time, status, questionnaire_completed, created_at
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

    return res.status(400).json({ error: 'Unknown action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
