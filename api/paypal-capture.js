/**
 * GET /api/paypal-capture
 * ────────────────────────
 * PayPal redirects the buyer here after they approve the payment
 * (?token=ORDER_ID). Captures the order, verifies the amount, fulfils via
 * the shared module, then sends the buyer to the thank-you page.
 */

import { PRODUCTS } from './_products.js';
import { capturePayPalOrder } from './_paypal.js';
import { fulfillOrder } from './_fulfill.js';

export default async function handler(req, res) {
  const siteUrl = process.env.SITE_URL || 'https://www.findyourcompasswithin.com';
  const redirect = (url) => {
    res.statusCode = 302;
    res.setHeader('Location', url);
    res.end();
  };

  const orderId = req.query?.token;
  if (!orderId) return redirect(`${siteUrl}/?payment=failed`);

  try {
    const capture = await capturePayPalOrder(orderId);

    // Buyer refreshed the return page: the order was already captured and
    // fulfilled on the first pass, so just show the thank-you page again.
    const alreadyCaptured = capture.name === 'UNPROCESSABLE_ENTITY' &&
      Array.isArray(capture.details) &&
      capture.details.some((d) => d.issue === 'ORDER_ALREADY_CAPTURED');
    if (alreadyCaptured) return redirect(`${siteUrl}/thank-you`);

    if (capture.status !== 'COMPLETED') {
      console.error('[PayPal] Capture not completed:', capture);
      return redirect(`${siteUrl}/?payment=failed`);
    }

    const unit = capture.purchase_units?.[0];
    const cap  = unit?.payments?.captures?.[0];

    const customId = cap?.custom_id || unit?.custom_id || '';
    const [productId, checkoutEmail] = customId.split('|');
    const product = PRODUCTS[productId];

    const customerEmail = checkoutEmail || capture.payer?.email_address;
    if (!product || !customerEmail) {
      console.error('[PayPal] Missing product or email after capture:', { customId, orderId });
      return redirect(`${siteUrl}/?payment=failed`);
    }

    // PayPal charges exactly the USD catalogue price; verify it arrived.
    const paid = parseFloat(cap?.amount?.value ?? '0');
    if (cap?.amount?.currency_code !== 'USD' || paid < product.price - 0.01) {
      console.error('[PayPal] Amount mismatch', { paid, expected: product.price });
      return redirect(`${siteUrl}/?payment=failed`);
    }

    const customerName = [capture.payer?.name?.given_name, capture.payer?.name?.surname]
      .filter(Boolean).join(' ') || 'there';

    const result = await fulfillOrder({
      product,
      productId,
      customerEmail,
      customerName,
      paymentId: cap?.id || orderId,
    });

    if (result.ok) {
      console.log(`[PayPal] Fulfilled ${productId} for ${customerEmail}`);
    }
    return redirect(`${siteUrl}/thank-you`);

  } catch (err) {
    console.error('[PayPal] Capture error:', err);
    return redirect(`${siteUrl}/?payment=failed`);
  }
}
