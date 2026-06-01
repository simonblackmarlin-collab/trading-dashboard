// api/quotes.js — bulk quote fallback using parallel Finnhub calls
// Only called when Yahoo Finance direct browser fetch fails
// Accepts: /api/quotes?symbols=AAPL,MSFT,NVDA (up to 75 at a time)
// Returns: { quotes: { AAPL: { price, changePercent, prev } } }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'FINNHUB_API_KEY not set', quotes: {} });
  }

  const symbolsParam = req.query.symbols || '';
  const symbols = symbolsParam
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 75); // cap — Vercel function timeout is 10s on free tier

  if (!symbols.length) {
    return res.status(400).json({ error: 'symbols param required', quotes: {} });
  }

  // Fire all calls in parallel — server-side so network is fast
  const results = await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`;
        const r = await fetch(url, { signal: AbortSignal.timeout(7000) });
        if (!r.ok) return { symbol, data: null };
        const d = await r.json();
        if (!d || !d.c || d.c === 0) return { symbol, data: null };
        return {
          symbol,
          data: {
            price: d.c,
            changePercent: d.pc > 0 ? ((d.c - d.pc) / d.pc * 100) : 0,
            prev: d.pc,
            open: d.o,
            high: d.h,
            low: d.l,
          }
        };
      } catch {
        return { symbol, data: null };
      }
    })
  );

  const quotes = {};
  results.forEach(({ symbol, data }) => {
    if (data) quotes[symbol] = data;
  });

  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=15');
  return res.status(200).json({
    quotes,
    total: symbols.length,
    returned: Object.keys(quotes).length,
  });
}
