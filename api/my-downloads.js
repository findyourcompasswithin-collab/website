/**
 * POST /api/my-downloads
 * ───────────────────────
 * Receives { email } from the My Downloads page. If that address has
 * purchases on record, fresh download links for everything it owns are
 * emailed to it. The response is identical whether or not purchases exist,
 * so the endpoint can never be used to probe who is a customer.
 */

import { sendLibraryEmail } from './_fulfill.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email } = req.body;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  try {
    const result = await sendLibraryEmail(String(email).trim());
    if (result.ok) console.log(`[Library] Fresh links sent to ${email}`);
  } catch (err) {
    console.error('[Library] Unexpected error:', err);
  }

  // Always the same answer: no customer-list probing possible.
  return res.status(200).json({ ok: true });
}
