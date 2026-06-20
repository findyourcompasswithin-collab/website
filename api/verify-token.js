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

  const COLS = 'id, client_name, client_email, package_id, package_name, sessions_total, sessions_booked, status, questionnaire_completed';

  // Reusable, no-payment test link: /questionnaire?token=test
  // Ensures a single fixed test booking exists, and resets it each load so the
  // form always shows and the questionnaire can be re-submitted for testing.
  const TEST_TOKEN = '00000000-0000-0000-0000-000000000000';
  if (token === 'test' || token === TEST_TOKEN) {
    let { data: tb } = await supabase.from('bookings').select(COLS).eq('questionnaire_token', TEST_TOKEN).maybeSingle();
    if (!tb) {
      const ins = await supabase.from('bookings').insert({
        client_name:             'Questionnaire Test',
        client_email:            process.env.FROM_EMAIL,
        package_id:              'test-consult',
        package_name:            'Consult Connection Test',
        sessions_total:          1,
        sessions_booked:         0,
        status:                  'pending_questionnaire',
        payment_id:              'TEST-QUESTIONNAIRE',
        questionnaire_token:     TEST_TOKEN,
        questionnaire_completed: false,
      }).select(COLS).single();
      tb = ins.data;
    } else if (tb.questionnaire_completed) {
      await supabase.from('bookings').update({ questionnaire_completed: false }).eq('id', tb.id);
      tb.questionnaire_completed = false;
    }
    if (tb) {
      const tp = PRODUCTS['test-consult'] || {};
      tb.format = tp.format || 'individual';
      tb.cohort = tp.cohort || null;
      return res.status(200).json({ booking: tb });
    }
  }

  const { data: booking, error } = await supabase
    .from('bookings')
    .select(COLS)
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
