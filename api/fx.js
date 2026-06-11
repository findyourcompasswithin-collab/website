/**
 * USD to ZAR conversion for Payfast.
 * ──────────────────────────────────
 * Payfast settles only in ZAR and rejects any `currency` field on the payment
 * request. Catalogue prices are in USD, so we convert to ZAR before checkout
 * and send no currency field at all. (Same pattern as AptiAtlas.)
 *
 * The fallback rate only needs to be approximate: foreign buyers can pick
 * their own currency on the Payfast page via multi-currency, and a ZAR charge
 * on a foreign card is converted by the buyer's bank anyway. Keeping the rate
 * static avoids a live FX API as a failure mode on the payment path.
 *
 * Review the rate now and then, or override it at any time without a code
 * change by setting the FX_RATES_JSON environment variable in Vercel, e.g.
 *   FX_RATES_JSON={"USD":16.5}
 */

const FALLBACK_ZAR_RATES = {
  ZAR: 1,
  USD: 16.5,
};

export function zarRate(currency = 'USD') {
  const cur = String(currency).toUpperCase();
  if (cur === 'ZAR') return 1;
  const raw = process.env.FX_RATES_JSON;
  if (raw) {
    try {
      const override = JSON.parse(raw);
      if (override[cur] && override[cur] > 0) return override[cur];
    } catch {
      // Malformed override: fall back to the static table
    }
  }
  return FALLBACK_ZAR_RATES[cur] ?? 1;
}

/** Convert a USD catalogue price to a ZAR amount Payfast will accept. */
export function convertToZar(amount, currency = 'USD') {
  const zar = Number(amount) * zarRate(currency);
  // Two decimals, floored at R5.00, which is Payfast's minimum charge.
  return Math.max(5, Math.round(zar * 100) / 100);
}
