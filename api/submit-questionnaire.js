/**
 * POST /api/submit-questionnaire
 * ───────────────────────────────
 * Saves questionnaire responses, marks booking as questionnaire_complete,
 * emails responses to Mel, and returns the schedule URL to the client.
 */

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { PRODUCTS } from './_products.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token, responses } = req.body;
  if (!token || !responses) return res.status(400).json({ error: 'Token and responses required' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // Validate token and get booking
  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('id, client_name, client_email, package_id, package_name, sessions_total, questionnaire_completed')
    .eq('questionnaire_token', token)
    .single();

  if (bookingError || !booking) {
    return res.status(404).json({ error: 'Invalid token' });
  }

  const siteUrl = process.env.SITE_URL || 'https://findyourcompasswithin.com';
  // Group rounds (Compass Circles) have fixed dates: skip the 1:1 calendar and
  // send them straight to the cohort confirmation page.
  const product  = PRODUCTS[booking.package_id] || {};
  const isGroup  = product.format === 'group';
  const intake   = product.intake || 'general';
  const nextUrl  = isGroup
    ? `${siteUrl}/circle-confirmed?token=${token}`
    : `${siteUrl}/schedule?token=${token}`;

  if (booking.questionnaire_completed) {
    // Already submitted - just return the next URL
    return res.status(200).json({ scheduleUrl: nextUrl });
  }

  // Save responses
  const { error: saveError } = await supabase
    .from('questionnaire_responses')
    .insert({
      booking_id:          booking.id,
      client_name:         booking.client_name,
      client_email:        booking.client_email,
      brought_to_coaching: responses.broughtToCoaching,
      stuck_areas:         responses.stuckAreas,
      desired_outcome:     responses.desiredOutcome,
      already_tried:       responses.alreadyTried,
      readiness_score:     responses.readinessScore,
      current_challenges:  responses.currentChallenges,
      success_vision:      responses.successVision,
      additional_notes:    responses.additionalNotes,
    });

  if (saveError) {
    console.error('[Questionnaire] Save error:', saveError);
    return res.status(500).json({ error: 'Could not save responses' });
  }

  // Mark questionnaire as complete
  await supabase
    .from('bookings')
    .update({ questionnaire_completed: true, status: 'questionnaire_complete' })
    .eq('id', booking.id);

  // Email responses to Mel
  const resend      = new Resend(process.env.RESEND_API_KEY);
  const fromAddress = `${process.env.FROM_NAME || 'Find Your Compass Within'} <${process.env.FROM_EMAIL}>`;

  const areasText = Array.isArray(responses.stuckAreas)
    ? responses.stuckAreas.join(', ')
    : responses.stuckAreas || '';

  await resend.emails.send({
    from:    fromAddress,
    to:      process.env.FROM_EMAIL,
    subject: `Questionnaire received: ${booking.client_name}, ${booking.package_name}`,
    html: `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:'Outfit',sans-serif;background:#F2E8D9;padding:30px 20px;">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;border:0.5px solid #E6D8C3;">
  <div style="background:#2F4F3F;padding:24px 32px;">
    <div style="height:3px;background:linear-gradient(90deg,#C2A46F,#A6B695,#C2A46F);margin-bottom:16px;border-radius:2px;"></div>
    <h2 style="color:#F5F0E8;font-family:Georgia,serif;font-weight:400;margin:0;">Pre-Session Questionnaire</h2>
    <p style="color:rgba(194,164,111,0.8);font-size:13px;margin:6px 0 0;">${escapeHtml(booking.client_name)} &nbsp;·&nbsp; ${escapeHtml(booking.package_name)}</p>
  </div>
  <div style="padding:28px 32px;">
    ${buildResponseRow('What brought them to coaching', responses.broughtToCoaching)}
    ${buildResponseRow(intake === 'perimenopause' ? 'Where they are + what hits hardest' : 'Areas feeling most stuck', areasText)}
    ${buildResponseRow('Desired outcome', responses.desiredOutcome)}
    ${buildResponseRow('What they have already tried', responses.alreadyTried)}
    ${buildResponseRow('Readiness to change (1-10)', responses.readinessScore)}
    ${buildResponseRow('Current challenges', responses.currentChallenges)}
    ${buildResponseRow('Success in 3-6 months', responses.successVision)}
    ${buildResponseRow('Additional notes', responses.additionalNotes)}
  </div>
  <div style="background:#F7EFE4;padding:16px 32px;border-top:0.5px solid #E6D8C3;">
    <p style="font-size:12px;color:#5a7a68;margin:0;">${isGroup
      ? 'This is a group round member. No 1:1 booking needed: confirm they have the cohort dates and the private group link.'
      : 'Client will schedule their session shortly. You will receive a booking confirmation once they choose a date and time.'}</p>
  </div>
</div>
</body></html>`,
  });

  return res.status(200).json({ scheduleUrl: nextUrl });
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildResponseRow(label, value) {
  if (!value && value !== 0) return '';
  return `<div style="margin-bottom:20px;padding-bottom:16px;border-bottom:0.5px solid #F0E6D8;">
    <p style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#C2A46F;margin:0 0 6px;">${escapeHtml(label)}</p>
    <p style="font-size:14px;color:#2F4F3F;line-height:1.7;margin:0;">${escapeHtml(String(value))}</p>
  </div>`;
}
