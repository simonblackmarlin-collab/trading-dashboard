// api/stockdata.js
// Drop this file into your /api folder on Vercel alongside your existing quote.js
//
// Fetches ALL pre-momentum signals for one stock in a single call:
//   quote  → current price, change %
//   candles → 60 days of closes → RSI(14), distance from 50-day MA
//   earnings → next earnings date
//
// Usage: GET /api/stockdata?symbol=GOOG
// Returns: { symbol, price, changePercent, rsi, vsMA50, earningsDaysAway, eps, analystTarget }

const FINNHUB_KEY = process.env.FINNHUB_KEY || 'd77fes9r01qp6aflfiigd77fes9r01qp6aflfij0'; // set this in Vercel env vars

const SYMBOL_MAP = { 'ATZ.TO': 'ATZ:TSX', 'NOVO.TO': 'NVO' };
function fhSym(t) { return SYMBOL_MAP[t] || t; }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return parseFloat((100 - 100 / (1 + rs)).toFixed(1));
}

function calcMA(closes, period) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

// ─── Finnhub fetchers ─────────────────────────────────────────────────────────

async function getQuote(sym) {
  const r = await fetch(
    `https://finnhub.io/api/v1/quote?symbol=${sym}&token=${FINNHUB_KEY}`,
    { signal: AbortSignal.timeout(6000) }
  );
  if (!r.ok) return null;
  const d = await r.json();
  if (!d || !d.c || d.c === 0) return null;
  return {
    price: d.c,
    prev: d.pc,
    change: d.d || (d.c - d.pc),
    changePercent: parseFloat((d.dp || ((d.c - d.pc) / d.pc * 100)).toFixed(2)),
  };
}

async function getCandles(sym) {
  const to   = Math.floor(Date.now() / 1000);
  const from = to - 90 * 24 * 60 * 60; // 90 days back
  const r = await fetch(
    `https://finnhub.io/api/v1/stock/candle?symbol=${sym}&resolution=D&from=${from}&to=${to}&token=${FINNHUB_KEY}`,
    { signal: AbortSignal.timeout(8000) }
  );
  if (!r.ok) return null;
  const d = await r.json();
  if (!d || d.s !== 'ok' || !d.c || d.c.length < 20) return null;
  return d.c; // array of daily closes
}

async function getEarnings(sym) {
  const today = new Date().toISOString().split('T')[0];
  const future = new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const r = await fetch(
    `https://finnhub.io/api/v1/calendar/earnings?from=${today}&to=${future}&symbol=${sym}&token=${FINNHUB_KEY}`,
    { signal: AbortSignal.timeout(6000) }
  );
  if (!r.ok) return null;
  const d = await r.json();
  if (!d || !d.earningsCalendar || d.earningsCalendar.length === 0) return null;
  const next = d.earningsCalendar[0];
  const daysAway = Math.round((new Date(next.date) - new Date()) / (1000 * 60 * 60 * 24));
  return { date: next.date, daysAway };
}

async function getRecommendation(sym) {
  const r = await fetch(
    `https://finnhub.io/api/v1/stock/recommendation?symbol=${sym}&token=${FINNHUB_KEY}`,
    { signal: AbortSignal.timeout(6000) }
  );
  if (!r.ok) return null;
  const d = await r.json();
  if (!d || d.length === 0) return null;
  const latest = d[0];
  // strongBuy + buy vs sell + strongSell → analyst score 0–100
  const total = latest.strongBuy + latest.buy + latest.hold + latest.sell + latest.strongSell;
  if (total === 0) return null;
  const bullish = ((latest.strongBuy * 2 + latest.buy) / (total * 2)) * 100;
  return { analystScore: Math.round(bullish), period: latest.period };
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate'); // 5-min CDN cache

  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'Missing symbol' });

  const sym = fhSym(symbol);

  // Fire all Finnhub calls in parallel — total time = slowest single call
  const [quote, closes, earnings, rec] = await Promise.all([
    getQuote(sym),
    getCandles(sym),
    getEarnings(sym),
    getRecommendation(sym),
  ]);

  if (!quote) return res.status(502).json({ error: 'Quote unavailable', symbol });

  // Calculate RSI and MA distance from candle data
  let rsi = null, vsMA50 = null, momGap = null;
  if (closes && closes.length >= 20) {
    rsi = calcRSI(closes);
    const ma50 = calcMA(closes, Math.min(50, closes.length));
    if (ma50 && quote.price) {
      vsMA50 = parseFloat(((quote.price - ma50) / ma50 * 100).toFixed(1));
    }
    // Momentum gap score: RSI 40-55 range = highest gap opportunity
    // Stocks very oversold (RSI<30) or overbought (RSI>70) score lower
    if (rsi !== null) {
      const rsiScore = rsi >= 40 && rsi <= 55
        ? 80 + (55 - Math.abs(rsi - 47.5)) // sweet spot around 47-48
        : rsi < 40
          ? Math.max(20, rsi * 1.5)         // oversold — risk, not opportunity
          : Math.max(10, 100 - rsi);         // overbought — momentum already picked up
      momGap = Math.min(100, Math.round(rsiScore));
    }
    // Also factor in MA distance: below 50MA but not crashed = higher gap
    if (vsMA50 !== null && vsMA50 < 0 && vsMA50 > -15) {
      momGap = momGap ? Math.min(100, momGap + 10) : 60;
    }
  }

  // Catalyst score from earnings proximity (nearer = higher urgency)
  let catalystScore = 40; // base score even without known earnings
  let earningsDaysAway = null;
  if (earnings) {
    earningsDaysAway = earnings.daysAway;
    if (earnings.daysAway <= 14)       catalystScore = 95;
    else if (earnings.daysAway <= 30)  catalystScore = 85;
    else if (earnings.daysAway <= 60)  catalystScore = 70;
    else                               catalystScore = 55;
  }

  // Analyst upside score from recommendation data
  const analystUpside = rec ? rec.analystScore : 50;

  // Overall opportunity score — weighted average
  const fundScore = 70; // placeholder — would need financials endpoint for real EPS trend
  const oppScore = momGap && momGap > 0
    ? Math.round(fundScore * 0.25 + momGap * 0.35 + catalystScore * 0.25 + analystUpside * 0.15)
    : Math.round(fundScore * 0.3 + catalystScore * 0.35 + analystUpside * 0.35);

  return res.status(200).json({
    symbol,
    // Price
    price: quote.price,
    changePercent: quote.changePercent,
    // Momentum signals
    rsi,
    vsMA50,
    momGap: momGap ?? 50,
    // Catalyst
    earningsDaysAway,
    earningsDate: earnings?.date ?? null,
    catalystScore,
    // Analyst
    analystUpside,
    // Scores
    fundScore,
    oppScore: Math.min(100, oppScore),
    oppLevel: oppScore >= 80 ? 'high' : oppScore >= 65 ? 'med' : 'low',
  });
}
