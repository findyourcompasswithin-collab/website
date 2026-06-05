/**
 * POST /api/submit-5questions
 * ────────────────────────────
 * Receives { name, email, q1, q2, q3, q4, q5 } from the 5 Questions form.
 * Saves to leads table, emails responses to Mel, sends thank you to client.
 */

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, email, q1, q2, q3, q4, q5 } = req.body || {};

  if (!name || String(name).trim().length < 1) {
    return res.status(400).json({ error: 'Please enter your name.' });
  }
  if (!email || !String(email).includes('@')) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  if (!q1 || !q2 || !q3 || !q4 || !q5) {
    return res.status(400).json({ error: 'Please answer all five questions before submitting.' });
  }

  const cleanName  = String(name).trim();
  const cleanEmail = String(email).toLowerCase().trim();
  const firstName  = cleanName.split(' ')[0];

  try {
    const supabase    = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const resend      = new Resend(process.env.RESEND_API_KEY);
    const fromAddress = `${process.env.FROM_NAME || 'Find Your Compass Within'} <${process.env.FROM_EMAIL}>`;

    // Save lead
    try {
      await supabase.from('leads').insert({
        name:       cleanName,
        email:      cleanEmail,
        source:     '5-questions',
        created_at: new Date().toISOString(),
      });
    } catch (_) {}

    // Email to Mel with full responses
    await resend.emails.send({
      from:    fromAddress,
      to:      process.env.FROM_EMAIL,
      subject: `New 5 Questions submission: ${cleanName}`,
      html: `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:'Outfit',sans-serif;background:#F2E8D9;padding:30px 20px;">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;border:0.5px solid #E6D8C3;">
  <div style="background:#2F4F3F;padding:24px 32px;">
    <div style="height:3px;background:linear-gradient(90deg,#C2A46F,#A6B695,#C2A46F);margin-bottom:16px;border-radius:2px;"></div>
    <div style="font-family:'Georgia',serif;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:rgba(194,164,111,0.7);margin-bottom:6px">Find Your Compass Within</div>
    <div style="font-family:'Georgia',serif;font-size:22px;font-weight:400;color:#F5F0E8;">New 5 Questions Submission</div>
  </div>
  <div style="padding:32px;">
    <p style="font-size:14px;color:#3d5e50;margin-bottom:4px"><strong>${cleanName}</strong> &nbsp;·&nbsp; <a href="mailto:${cleanEmail}" style="color:#C2A46F">${cleanEmail}</a></p>
    <div style="height:1px;background:#E6D8C3;margin:20px 0;"></div>

    <div style="margin-bottom:18px;">
      <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#A6B695;margin-bottom:6px">Q1: Where are you right now?</div>
      <div style="font-size:14px;color:#2F4F3F;background:#F9F5EF;border-left:3px solid #C2A46F;padding:10px 14px;border-radius:0 6px 6px 0;">${q1}</div>
    </div>

    <div style="margin-bottom:18px;">
      <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#A6B695;margin-bottom:6px">Q2: What is weighing on you most?</div>
      <div style="font-size:14px;color:#2F4F3F;background:#F9F5EF;border-left:3px solid #C2A46F;padding:10px 14px;border-radius:0 6px 6px 0;">${q2}</div>
    </div>

    <div style="margin-bottom:18px;">
      <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#A6B695;margin-bottom:6px">Q3: What is getting in the way?</div>
      <div style="font-size:14px;color:#2F4F3F;background:#F9F5EF;border-left:3px solid #C2A46F;padding:10px 14px;border-radius:0 6px 6px 0;">${q3}</div>
    </div>

    <div style="margin-bottom:18px;">
      <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#A6B695;margin-bottom:6px">Q4: What do you most need right now?</div>
      <div style="font-size:14px;color:#2F4F3F;background:#F9F5EF;border-left:3px solid #C2A46F;padding:10px 14px;border-radius:0 6px 6px 0;">${q4}</div>
    </div>

    <div style="margin-bottom:18px;">
      <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#A6B695;margin-bottom:6px">Q5: Commitment to change</div>
      <div style="font-size:14px;color:#2F4F3F;background:#F9F5EF;border-left:3px solid #C2A46F;padding:10px 14px;border-radius:0 6px 6px 0;">${q5}</div>
    </div>

    <div style="height:1px;background:#E6D8C3;margin:24px 0;"></div>
    <p style="font-size:12px;color:#888;text-align:center">Submitted via findyourcompasswithin.com</p>
  </div>
</div>
</body></html>`,
    });

    // Thank you email to client
    await resend.emails.send({
      from:    fromAddress,
      to:      cleanEmail,
      subject: `Thank you, ${firstName}. Your answers are with me.`,
      html: `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:'Outfit',sans-serif;background:#F2E8D9;padding:30px 20px;">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;border:0.5px solid #E6D8C3;">
  <div style="background:#2F4F3F;padding:24px 32px;">
    <div style="height:3px;background:linear-gradient(90deg,#C2A46F,#A6B695,#C2A46F);margin-bottom:16px;border-radius:2px;"></div>
    <div style="font-family:'Georgia',serif;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:rgba(194,164,111,0.7);margin-bottom:6px">Find Your Compass Within</div>
    <div style="font-family:'Georgia',serif;font-size:22px;font-weight:400;color:#F5F0E8;">Thank you, ${firstName}.</div>
  </div>
  <div style="padding:32px;">
    <p style="font-size:15px;color:#3d5e50;line-height:1.8;">Your answers are with me. I have read them, and I want you to know that what you shared takes honesty. That matters.</p>
    <p style="font-size:15px;color:#3d5e50;line-height:1.8;">This is the beginning. You have already done something most people put off indefinitely. You stopped, you reflected, and you were honest about where you are.</p>
    <p style="font-size:15px;color:#3d5e50;line-height:1.8;">If you are ready to take the next step, you can explore the tools at your own pace, or reach out and we can talk about what working together looks like.</p>
    <div style="text-align:center;margin:32px 0;">
      <a href="https://findyourcompasswithin.com" style="background:#C2A46F;color:#fff;text-decoration:none;padding:14px 32px;border-radius:7px;font-size:14px;font-weight:500;letter-spacing:0.3px;">Explore Your Next Step</a>
    </div>
    <div style="height:1px;background:#E6D8C3;margin:24px 0;"></div>
    <p style="font-size:12px;color:#A6A69E;line-height:1.7;text-align:center;">If this email landed in your Promotions or Updates tab, move it to your Primary inbox so you do not miss future messages. You can also add <a href="mailto:melcooper@findyourcompasswithin.com" style="color:#C2A46F;text-decoration:none;">melcooper@findyourcompasswithin.com</a> to your contacts.</p>
    <div style="height:1px;background:#E6D8C3;margin:24px 0;"></div>
    <p style="font-size:13px;color:#3d5e50;line-height:1.8;">With care,<br>
    <strong style="font-family:'Georgia',serif;font-style:normal;color:#2F4F3F;font-size:15px;">Mel</strong><br>
    <span style="font-size:11px;color:#A6A69E;font-weight:300">Find Your Compass Within</span></p>
  </div>
</div>
</body></html>`,
    });

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('[5Questions] Error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
