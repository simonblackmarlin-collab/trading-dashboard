// api/quotes.js — bulk quote fetcher using Yahoo Finance
// Accepts: /api/quotes?symbols=AAPL,MSFT,NVDA,TSLA (up to 100 at a time)
// Returns: { quotes: { AAPL: { price, changePercent, prev }, ... } }

const CACHE = {};
const CACHE_TTL = 60 * 1000; // 1 minute cache

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const symbolsParam = req.query.symbols || '';
  if (!symbolsParam) {
    return res.status(400).json({ error: 'symbols param required' });
  }

  const symbols = symbolsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  if (!symbols.length) {
    return res.status(400).json({ error: 'no valid symbols' });
  }

  // Check cache — return cached results for symbols loaded recently
  const now = Date.now();
  const cached = {};
  const toFetch = [];

  symbols.forEach(sym => {
    if (CACHE[sym] && (now - CACHE[sym].ts) < CACHE_TTL) {
      cached[sym] = CACHE[sym].data;
    } else {
      toFetch.push(sym);
    }
  });

  let fetched = {};

  if (toFetch.length > 0) {
    try {
      // Yahoo Finance bulk quote — handles TSX (.TO) and crypto (-USD) symbols too
      const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(toFetch.join(','))}&fields=regularMarketPrice,regularMarketChangePercent,regularMarketPreviousClose,shortName`;

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; StockMate/1.0)',
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        throw new Error(`Yahoo Finance returned ${response.status}`);
      }

      const data = await response.json();
      const results = data?.quoteResponse?.result || [];

      results.forEach(q => {
        if (!q.symbol || !q.regularMarketPrice) return;
        const quote = {
          price: q.regularMarketPrice,
          changePercent: q.regularMarketChangePercent || 0,
          prev: q.regularMarketPreviousClose || q.regularMarketPrice,
          name: q.shortName || q.symbol,
        };
        fetched[q.symbol] = quote;
        // Cache it
        CACHE[q.symbol] = { data: quote, ts: now };
      });

    } catch (err) {
      // If Yahoo fails, return whatever we have from cache
      console.error('Yahoo Finance error:', err.message);
      if (Object.keys(cached).length === 0) {
        return res.status(500).json({ error: err.message, quotes: {} });
      }
    }
  }

  const quotes = { ...cached, ...fetched };

  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
  return res.status(200).json({ quotes, cached: Object.keys(cached).length, fetched: Object.keys(fetched).length });
}
