// api/quotes.js — bulk quote fetcher using parallel Finnhub calls
// Accepts: /api/quotes?symbols=AAPL,MSFT,NVDA (up to 120 at a time)
// Returns: { quotes: { AAPL: { price, changePercent, prev, volume, avgVolume } } }
// Server-side parallel calls — 10x faster than sequential browser calls

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const symbolsParam = req.query.symbols || '';
  if (!symbolsParam) {
    return res.status(400).json({ error: 'symbols param required' });
  }

  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'FINNHUB_API_KEY not configured' });
  }

  const symbols = symbolsParam
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 120); // hard cap

  // Fetch all symbols in parallel — server-side so no browser rate limit concern
  // Batch into groups of 15 with small delay to be respectful to Finnhub
  const BATCH = 15;
  const quotes = {};

  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH);

    const results = await Promise.all(
      batch.map(async (symbol) => {
        try {
          const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`;
          const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
          if (!r.ok) return { symbol, data: null };
          const d = await r.json();
          if (!d || d.c === 0) return { symbol, data: null };
          return {
            symbol,
            data: {
              price: d.c,                                           // current price
              changePercent: d.pc > 0 ? ((d.c - d.pc) / d.pc * 100) : 0,
              prev: d.pc,                                           // previous close
              high: d.h,                                            // day high
              low: d.l,                                             // day low
              open: d.o,                                            // day open
            }
          };
        } catch {
          return { symbol, data: null };
        }
      })
    );

    results.forEach(({ symbol, data }) => {
      if (data) quotes[symbol] = data;
    });

    // Small pause between batches — keeps Finnhub happy
    if (i + BATCH < symbols.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=15');
  return res.status(200).json({
    quotes,
    total: symbols.length,
    returned: Object.keys(quotes).length,
  });
}
