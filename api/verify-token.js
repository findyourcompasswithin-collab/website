/**
 * GET /api/verify-token?token=UUID
 * ─────────────────────────────────
 * Validates a questionnaire token and returns booking details.
 * Used by questionnaire.html and schedule.html to load context.
 */

import { createClient } from '@supabase/supabase-js';
import { PRODUCTS } from './_products.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token required' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const { data: booking, error } = await supabase
    .from('bookings')
    .select('id, client_name, client_email, package_id, package_name, sessions_total, sessions_booked, status, questionnaire_completed')
    .eq('questionnaire_token', token)
    .single();

  if (error || !booking) {
    return res.status(404).json({ error: 'Invalid or expired token' });
  }

  // Surface the product format so group rounds (Compass Circles) can route
  // around the 1:1 self-serve calendar.
  const product = PRODUCTS[booking.package_id] || {};
  booking.format = product.format || 'individual';
  booking.cohort = product.cohort || null;

  return res.status(200).json({ booking });
}
