// api/news.js
// Fetches relevant stock news via Yahoo Finance quoteSummary
// More reliable and relevant than Finnhub free tier news

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'Missing symbol' });

  try {
    // Yahoo Finance v11 returns news in quoteSummary
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=assetProfile,recommendationTrend`;
    
    // Use Yahoo search news endpoint instead — more reliable for news
    const newsUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;

    // Yahoo Finance news search — best free option
    const searchUrl = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&newsCount=6&quotesCount=0&enableFuzzyQuery=false`;
    
    const r = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Referer': 'https://finance.yahoo.com',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!r.ok) {
      // Fallback: try Finnhub but filter to symbol-specific news
      return await fallbackFinnhub(symbol, res);
    }

    const data = await r.json();
    const rawNews = data?.news || [];

    if (!rawNews.length) {
      return await fallbackFinnhub(symbol, res);
    }

    // Clean and return news with proper URLs
    const news = rawNews.slice(0, 4).map(n => ({
      headline: n.title,
      summary:  n.summary || '',
      source:   n.publisher || 'Yahoo Finance',
      url:      n.link || `https://finance.yahoo.com/quote/${symbol}/news/`,
      datetime: n.providerPublishTime || Math.floor(Date.now() / 1000),
    }));

    return res.status(200).json({ symbol, news, source: 'yahoo' });
  } catch(e) {
    return await fallbackFinnhub(symbol, res);
  }
}

// ── FINNHUB FALLBACK ──────────────────────────────────────────────────────────
const FINNHUB_KEY = 'd78nrmhr01qp0fl5u07gd78nrmhr01qp0fl5u080';

async function fallbackFinnhub(symbol, res) {
  try {
    const to   = new Date().toISOString().split('T')[0];
    const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const url  = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&token=${FINNHUB_KEY}`;
    const r    = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return res.status(502).json({ error: 'News unavailable' });
    const data = await r.json();
    if (!Array.isArray(data) || !data.length) return res.status(404).json({ error: 'No news found' });

    // Filter to only news that mentions the symbol in headline (improves relevance)
    const symLower = symbol.toLowerCase();
    const filtered = data
      .filter(n => n.url && !n.url.includes('finnhub.io')) // exclude bad URLs
      .filter(n => {
        const h = (n.headline || '').toLowerCase();
        // Accept if headline mentions symbol/company name or is clearly financial news
        return h.includes(symLower) || n.category === 'company news';
      })
      .slice(0, 4);

    // If nothing relevant found, just take first 4 regardless
    const final = filtered.length > 0 ? filtered : data.filter(n => n.url && !n.url.includes('finnhub.io')).slice(0, 4);

    const news = final.map(n => ({
      headline: n.headline,
      summary:  n.summary || '',
      source:   n.source,
      url:      n.url,
      datetime: n.datetime,
    }));

    return res.status(200).json({ symbol, news, source: 'finnhub' });
  } catch(e) {
    return res.status(500).json({ error: 'News unavailable', detail: e.message });
  }
}
