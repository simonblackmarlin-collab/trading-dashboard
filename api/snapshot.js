// api/snapshot.js — server-side price cache using Vercel KV
// Returns all stock prices instantly from cache (< 1 second)
// Cache is built server-side using Finnhub, refreshed every 60 seconds
// First cold start takes ~8 mins — all subsequent calls are instant

const CACHE_KEY = 'stockmate_prices_v1';
const CACHE_TTL = 60; // seconds — refresh every 60s during market hours

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'FINNHUB_API_KEY not set' });
  }

  // ── Try to get from KV cache first ──────────────────────────────────────
  let cached = null;
  try {
    const kv = await getKV();
    if (kv) {
      const raw = await kv.get(CACHE_KEY);
      if (raw) {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const age = (Date.now() - parsed.ts) / 1000;
        if (age < CACHE_TTL) {
          // Fresh cache — return instantly
          res.setHeader('Cache-Control', `s-maxage=${Math.round(CACHE_TTL - age)}`);
          res.setHeader('X-Cache', 'HIT');
          res.setHeader('X-Cache-Age', `${age.toFixed(1)}s`);
          return res.status(200).json({
            quotes: parsed.quotes,
            count: Object.keys(parsed.quotes).length,
            ts: parsed.ts,
            cached: true,
          });
        }
        // Stale but usable — return stale while refreshing
        cached = parsed;
      }
    }
  } catch (e) {
    console.error('KV read error:', e.message);
  }

  // ── Cache miss or stale — fetch from Finnhub ─────────────────────────────
  // If we have stale data, return it immediately and refresh in background
  if (cached) {
    res.setHeader('X-Cache', 'STALE');
    res.status(200).json({
      quotes: cached.quotes,
      count: Object.keys(cached.quotes).length,
      ts: cached.ts,
      cached: true,
      stale: true,
    });
    // Refresh cache in background (don't await)
    refreshCache(apiKey).catch(console.error);
    return;
  }

  // No cache at all — must build it now (first cold start)
  // Return a "loading" response with progress endpoint
  const symbols = await getSymbols();
  const total = symbols.length;

  // Start building cache in background
  refreshCache(apiKey).catch(console.error);

  // Return what we have (empty for now)
  res.setHeader('X-Cache', 'MISS');
  return res.status(202).json({
    quotes: {},
    count: 0,
    loading: true,
    total,
    message: `Building price cache for ${total} stocks — check back in 60 seconds`,
  });
}

async function refreshCache(apiKey) {
  const symbols = await getSymbols();
  const quotes = {};
  const BATCH = 5;
  const DELAY = 5000; // 5s between batches = 5 calls/5s = 60/min

  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH);
    await Promise.all(batch.map(async (symbol) => {
      try {
        const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`;
        const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) return;
        const d = await r.json();
        if (d && d.c && d.c > 0) {
          quotes[symbol] = {
            price: d.c,
            changePercent: d.pc > 0 ? ((d.c - d.pc) / d.pc * 100) : 0,
            prev: d.pc,
            open: d.o,
            high: d.h,
            low: d.l,
          };
        }
      } catch {}
    }));

    if (i + BATCH < symbols.length) {
      await new Promise(r => setTimeout(r, DELAY));
    }
  }

  // Store in KV
  try {
    const kv = await getKV();
    if (kv && Object.keys(quotes).length > 0) {
      await kv.set(CACHE_KEY, JSON.stringify({ quotes, ts: Date.now() }), { ex: 600 });
      console.log(`Cache refreshed: ${Object.keys(quotes).length} stocks`);
    }
  } catch (e) {
    console.error('KV write error:', e.message);
  }

  return quotes;
}

async function getKV() {
  // Vercel KV — automatically available via @vercel/kv when KV is linked to project
  try {
    const { kv } = await import('@vercel/kv');
    return kv;
  } catch {
    return null;
  }
}

async function getSymbols() {
  // Fetch candidates.json to get the symbol list
  try {
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000';
    const r = await fetch(`${baseUrl}/candidates.json`, { signal: AbortSignal.timeout(5000) });
    if (r.ok) {
      const candidates = await r.json();
      return candidates.map(c => c.t).filter(Boolean);
    }
  } catch {}
  // Fallback: core S&P 500 tickers
  return ['AAPL','MSFT','NVDA','AMZN','GOOGL','META','TSLA','AVGO','JPM','V',
          'XOM','UNH','LLY','MA','HD','COST','PG','ORCL','MRK','ABBV'];
}
