/**
 * GET /api/get-available-slots?month=YYYY-MM
 * ──────────────────────────────────────────
 * Returns available dates and time slots for a given month.
 * Schedule: Mon-Fri, mornings 09:00-12:00 and evenings 21:00-22:00 SAST
 * (UTC+2). The evening slots serve working clients across SA, the UK and
 * Europe. Times and slots come from the shared _schedule.js source.
 * Min notice: 60 minutes. Preferred notice: 24 hours (flagged, not blocked).
 * Max horizon: 8 weeks ahead.
 */

import { createClient } from '@supabase/supabase-js';
import { TIME_SLOTS, SAST_OFFSET_HOURS } from './_schedule.js';

const MIN_NOTICE_MS     = 60 * 60 * 1000;       // 60 minutes
const MAX_WEEKS_AHEAD   = 8;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { month } = req.query;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'Provide month as YYYY-MM' });
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const [year, monthNum] = month.split('-').map(Number);

  // Get blocked dates this month
  const { data: blocked } = await supabase
    .from('blocked_dates')
    .select('block_date')
    .gte('block_date', `${month}-01`)
    .lte('block_date', `${month}-31`);

  const blockedSet = new Set((blocked || []).map(d => d.block_date));

  // Get booked slots this month (exclude cancelled)
  const { data: booked } = await supabase
    .from('bookings')
    .select('session_date, session_time')
    .gte('session_date', `${month}-01`)
    .lte('session_date', `${month}-31`)
    .not('status', 'eq', 'cancelled')
    .not('session_date', 'is', null)
    .not('session_time', 'is', null);

  // Map: dateStr -> Set of booked times
  const bookedMap = {};
  for (const b of (booked || [])) {
    const d = b.session_date;
    const t = (b.session_time || '').substring(0, 5);
    if (d && t) {
      if (!bookedMap[d]) bookedMap[d] = new Set();
      bookedMap[d].add(t);
    }
  }

  const nowMs       = Date.now();
  const maxMs       = nowMs + MAX_WEEKS_AHEAD * 7 * 24 * 60 * 60 * 1000;
  const daysInMonth = new Date(year, monthNum, 0).getDate();
  const result      = {};

  for (let day = 1; day <= daysInMonth; day++) {
    const dd      = String(day).padStart(2, '0');
    const mm      = String(monthNum).padStart(2, '0');
    const dateStr = `${year}-${mm}-${dd}`;

    // Must be a weekday
    const dow = new Date(`${dateStr}T12:00:00+02:00`).getDay(); // 0=Sun 6=Sat
    if (dow === 0 || dow === 6) continue;

    // Must not be blocked
    if (blockedSet.has(dateStr)) continue;

    // Must be within 8-week horizon
    const dateMs = new Date(`${dateStr}T00:00:00+02:00`).getTime();
    if (dateMs > maxMs) continue;

    // Calculate available slots
    const slots = TIME_SLOTS.filter(slot => {
      // Already booked?
      if (bookedMap[dateStr]?.has(slot)) return false;

      // Minimum notice check
      const [h] = slot.split(':').map(Number);
      const slotUtcH   = h - SAST_OFFSET_HOURS;
      const slotMs     = new Date(`${dateStr}T${String(slotUtcH).padStart(2, '0')}:00:00Z`).getTime();
      if (slotMs - nowMs < MIN_NOTICE_MS) return false;

      return true;
    });

    if (slots.length > 0) {
      // Flag slots with less than 24h notice (still bookable, just shown differently)
      result[dateStr] = slots.map(slot => {
        const [h] = slot.split(':').map(Number);
        const slotUtcH = h - SAST_OFFSET_HOURS;
        const slotMs   = new Date(`${dateStr}T${String(slotUtcH).padStart(2, '0')}:00:00Z`).getTime();
        const shortNotice = (slotMs - nowMs) < 24 * 60 * 60 * 1000;
        return { time: slot, shortNotice };
      });
    }
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ month, availableDates: result });
}
