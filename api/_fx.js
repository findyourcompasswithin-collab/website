/**
 * USD to ZAR conversion for Payfast.
 * ──────────────────────────────────
 * Payfast settles only in ZAR and rejects any `currency` field on the payment
 * request. Catalogue prices are in USD, so we convert to ZAR before checkout
 * and send no currency field at all.
 *
 * Rate priority, so the payment path can never fail on a rate lookup:
 *   1. FX_RATES_JSON env var: a manual override that always wins when set,
 *      e.g. FX_RATES_JSON={"USD":16.5}
 *   2. Live daily rate fetched from open.er-api.com, cached for 12 hours
 *   3. The most recent cached rate, even if older than 12 hours
 *   4. The static fallback below, used only if everything else fails
 */

const FALLBACK_ZAR_RATES = {
  ZAR: 1,
  USD: 16.5,
};

const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // refresh the live rate twice a day
const FETCH_TIMEOUT_MS = 2500; // never hold up checkout waiting on a rate API

const liveCache = {}; // per warm serverless instance: { USD: { rate, fetchedAt } }

function overrideRate(cur) {
  const raw = process.env.FX_RATES_JSON;
  if (!raw) return null;
  try {
    const override = JSON.parse(raw);
    if (override[cur] && override[cur] > 0) return override[cur];
  } catch {
    // Malformed override: ignore it and use the live rate instead
  }
  return null;
}

async function fetchLiveRate(cur) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`https://open.er-api.com/v6/latest/${cur}`, {
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = await res.json();
    const rate = json && json.rates && json.rates.ZAR;
    return typeof rate === 'number' && rate > 0 ? rate : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function zarRate(currency = 'USD') {
  const cur = String(currency).toUpperCase();
  if (cur === 'ZAR') return 1;

  const manual = overrideRate(cur);
  if (manual) return manual;

  const cached = liveCache[cur];
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.rate;

  const live = await fetchLiveRate(cur);
  if (live) {
    liveCache[cur] = { rate: live, fetchedAt: Date.now() };
    return live;
  }

  // A stale cached rate is still closer to reality than the static fallback
  if (cached) return cached.rate;

  return FALLBACK_ZAR_RATES[cur] ?? 1;
}

/** Convert a USD catalogue price to a ZAR amount Payfast will accept. */
export async function convertToZar(amount, currency = 'USD') {
  const rate = await zarRate(currency);
  const zar = Number(amount) * rate;
  // Two decimals, floored at R5.00, which is Payfast's minimum charge.
  return Math.max(5, Math.round(zar * 100) / 100);
}
