// api/snapshot.js — server-side price cache using Upstash REST API
// Designed for Vercel Hobby (10s function timeout)
// Each call fetches one batch of 5 stocks and saves to cache
// Repeated calls (via polling) build the cache incrementally

const CACHE_KEY = 'stockmate_prices_v1';
const PROGRESS_KEY = 'stockmate_progress_v1';
const CACHE_TTL = 60; // seconds before prices are considered stale
const BATCH_SIZE = 5; // stocks per call — fits in 10s timeout
const DELAY_MS = 1100; // 1.1s between calls = ~54/min, safe under 60/min limit

async function kvGet(key) {
  try {
    const url = `${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d.result || null;
  } catch { return null; }
}

async function kvSet(key, value, exSeconds = 600) {
  try {
    const url = `${process.env.KV_REST_API_URL}/set/${encodeURIComponent(key)}`;
    await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ value: JSON.stringify(value), ex: exSeconds }),
      signal: AbortSignal.timeout(4000),
    });
  } catch {}
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
  return ['AAPL','MSFT','NVDA','AMZN','GOOGL','META','TSLA','AVGO','JPM','V',
          'XOM','UNH','LLY','MA','HD','MRK','PG','ORCL','COST','ABBV'];
}

async function fetchQuote(symbol, apiKey) {
  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const d = await r.json();
    if (!d || !d.c || d.c === 0) return null;
    return {
      price: d.c,
      changePercent: d.pc > 0 ? ((d.c - d.pc) / d.pc * 100) : 0,
      prev: d.pc,
      open: d.o,
      high: d.h,
      low: d.l,
    };
  } catch { return null; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'FINNHUB_API_KEY not set' });
  if (!process.env.KV_REST_API_URL) return res.status(500).json({ error: 'KV not configured' });

  const symbols = await getSymbols();
  const total = symbols.length;

  // ── Load existing cache ───────────────────────────────────────────────────
  let cacheData = { quotes: {}, ts: 0 };
  let progress = { nextIndex: 0, ts: Date.now() };

  const rawCache = await kvGet(CACHE_KEY);
  if (rawCache) {
    try { cacheData = JSON.parse(rawCache); } catch {}
  }

  const rawProgress = await kvGet(PROGRESS_KEY);
  if (rawProgress) {
    try { progress = JSON.parse(rawProgress); } catch {}
  }

  const cacheAge = (Date.now() - cacheData.ts) / 1000;
  const loaded = Object.keys(cacheData.quotes).length;

  // ── Return cached data immediately if fresh enough ────────────────────────
  if (loaded > 0) {
    // Always return what we have immediately — don't make user wait
    const isFresh = cacheAge < CACHE_TTL;
    const isComplete = loaded >= total * 0.9;

    res.setHeader('X-Cache', isFresh ? 'HIT' : 'STALE');
    res.status(200).json({
      quotes: cacheData.quotes,
      count: loaded,
      total,
      ts: cacheData.ts,
      cached: true,
      stale: !isFresh,
      complete: isComplete,
      progress: Math.round((loaded / total) * 100),
    });

    // If stale, fetch next batch in background
    if (!isFresh) fetchNextBatch(symbols, cacheData, progress, apiKey).catch(() => {});
    return;
  }

  // ── No cache yet — fetch first batch synchronously so user gets something ─
  const firstBatch = symbols.slice(0, BATCH_SIZE);
  for (const symbol of firstBatch) {
    const quote = await fetchQuote(symbol, apiKey);
    if (quote) cacheData.quotes[symbol] = quote;
    await new Promise(r => setTimeout(r, DELAY_MS));
  }
  cacheData.ts = Date.now();
  progress.nextIndex = BATCH_SIZE;

  await kvSet(CACHE_KEY, cacheData);
  await kvSet(PROGRESS_KEY, progress);

  // Kick off next batch in background
  fetchNextBatch(symbols, cacheData, progress, apiKey).catch(() => {});

  const loaded2 = Object.keys(cacheData.quotes).length;
  res.setHeader('X-Cache', 'BUILDING');
  return res.status(200).json({
    quotes: cacheData.quotes,
    count: loaded2,
    total,
    ts: cacheData.ts,
    cached: false,
    loading: true,
    progress: Math.round((loaded2 / total) * 100),
    message: `Loading prices... ${loaded2}/${total} so far`,
  });
}

async function fetchNextBatch(symbols, cacheData, progress, apiKey) {
  const start = progress.nextIndex || 0;
  if (start >= symbols.length) {
    // All done — reset progress for next refresh cycle
    await kvSet(PROGRESS_KEY, { nextIndex: 0, ts: Date.now() });
    return;
  }

  const batch = symbols.slice(start, start + BATCH_SIZE);
  for (const symbol of batch) {
    const quote = await fetchQuote(symbol, apiKey);
    if (quote) cacheData.quotes[symbol] = quote;
    await new Promise(r => setTimeout(r, DELAY_MS));
  }
  cacheData.ts = Date.now();

  await kvSet(CACHE_KEY, cacheData);
  await kvSet(PROGRESS_KEY, { nextIndex: start + BATCH_SIZE, ts: Date.now() });
}
