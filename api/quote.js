// api/quote.js
// Vercel serverless function — fetches stock prices server-side (no CORS issues)
// Strategy:
//   1. Try Finnhub (fast, reliable for US stocks)
//   2. Fall back to Yahoo Finance (covers TSX, ETFs, international)

const FINNHUB_KEY = 'd78nrmhr01qp0fl5u07gd78nrmhr01qp0fl5u080';

// Stocks that Finnhub free tier doesn't cover — go straight to Yahoo
const YAHOO_ONLY = ['NOVO.TO', 'ATZ.TO', 'SHOP.TO'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'Missing symbol' });

  // Try Finnhub first (unless known Yahoo-only)
  if (!YAHOO_ONLY.includes(symbol)) {
    const finnhubResult = await tryFinnhub(symbol);
    if (finnhubResult) return res.status(200).json(finnhubResult);
  }

  // Fall back to Yahoo Finance (server-to-server — no CORS issue)
  const yahooResult = await tryYahoo(symbol);
  if (yahooResult) return res.status(200).json(yahooResult);

  return res.status(404).json({ error: 'No data found', symbol });
}

// ── FINNHUB ──────────────────────────────────────────────────────────────────
async function tryFinnhub(symbol) {
  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_KEY}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const d = await r.json();
    if (!d || !d.c || d.c === 0) return null;
    return {
      symbol,
      price:         d.c,
      prev:          d.pc,
      change:        d.d  || (d.c - d.pc),
      changePercent: d.dp || ((d.c - d.pc) / d.pc * 100),
      source:        'finnhub',
    };
  } catch { return null; }
}

// ── YAHOO FINANCE ─────────────────────────────────────────────────────────────
// Runs server-side on Vercel — no CORS restrictions here
async function tryYahoo(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=2d`;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const data   = await r.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;
    const meta   = result.meta;
    const price  = meta.regularMarketPrice || meta.previousClose;
    const prev   = meta.chartPreviousClose || meta.previousClose;
    if (!price || !prev) return null;
    return {
      symbol,
      price,
      prev,
      change:        price - prev,
      changePercent: ((price - prev) / prev) * 100,
      source:        'yahoo',
      currency:      meta.currency || 'CAD',
    };
  } catch { return null; }
}
