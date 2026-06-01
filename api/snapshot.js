// api/snapshot.js — server-side price cache using Upstash Redis
// Returns all stock prices instantly from cache (< 1 second)
// Cache built server-side using Finnhub, refreshed every 60 seconds

const CACHE_KEY = 'stockmate_prices_v1';
const CACHE_TTL = 60; // seconds

// Upstash REST API — uses env vars injected by Vercel
async function kvGet(key) {
  const url = `${process.env.KV_REST_API_URL}/get/${key}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) return null;
  const d = await r.json();
  return d.result || null;
}

async function kvSet(key, value, exSeconds) {
  const url = `${process.env.KV_REST_API_URL}/set/${key}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ value, ex: exSeconds }),
    signal: AbortSignal.timeout(5000),
  });
  return r.ok;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'FINNHUB_API_KEY not set' });
  if (!process.env.KV_REST_API_URL) return res.status(500).json({ error: 'KV not configured' });

  // ── Try cache first ───────────────────────────────────────────────────────
  try {
    const raw = await kvGet(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const age = (Date.now() - parsed.ts) / 1000;

      if (age < CACHE_TTL) {
        // Fresh — return instantly
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

      // Stale — return immediately and refresh in background
      res.setHeader('X-Cache', 'STALE');
      res.status(200).json({
        quotes: parsed.quotes,
        count: Object.keys(parsed.quotes).length,
        ts: parsed.ts,
        cached: true,
        stale: true,
      });
      refreshCache(apiKey).catch(console.error);
      return;
    }
  } catch (e) {
    console.error('KV read error:', e.message);
  }

  // ── No cache — cold start ─────────────────────────────────────────────────
  const symbols = await getSymbols();
  refreshCache(apiKey).catch(console.error);

  res.setHeader('X-Cache', 'MISS');
  return res.status(202).json({
    quotes: {},
    count: 0,
    loading: true,
    total: symbols.length,
    message: `Building price cache for ${symbols.length} stocks — polls every 10s until ready`,
  });
}

async function refreshCache(apiKey) {
  const symbols = await getSymbols();
  const quotes = {};
  const BATCH = 5;
  const DELAY = 5000; // 5 calls per 5s = 60/min — safe for Finnhub free tier

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

    // Save partial progress to KV every 50 stocks so polls return data sooner
    if (i > 0 && i % 50 === 0 && Object.keys(quotes).length > 0) {
      await kvSet(CACHE_KEY, JSON.stringify({ quotes: { ...quotes }, ts: Date.now() }), 600)
        .catch(() => {});
    }

    if (i + BATCH < symbols.length) {
      await new Promise(r => setTimeout(r, DELAY));
    }
  }

  // Final save
  if (Object.keys(quotes).length > 0) {
    await kvSet(CACHE_KEY, JSON.stringify({ quotes, ts: Date.now() }), 600);
    console.log(`Cache built: ${Object.keys(quotes).length}/${symbols.length} stocks`);
  }

  return quotes;
}

async function getSymbols() {
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
  return ['AAPL','MSFT','NVDA','AMZN','GOOGL','META','TSLA','AVGO','JPM','V'];
}
