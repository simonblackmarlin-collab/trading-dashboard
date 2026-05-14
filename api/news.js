// api/news.js
// Fetches latest news headlines for a stock from Finnhub
// Server-side to avoid CORS issues

const FINNHUB_KEY = 'd78nrmhr01qp0fl5u07gd78nrmhr01qp0fl5u080';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'Missing symbol' });

  try {
    // Date range: last 7 days
    const to   = new Date().toISOString().split('T')[0];
    const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&token=${FINNHUB_KEY}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return res.status(502).json({ error: 'Finnhub request failed' });

    const data = await r.json();
    if (!Array.isArray(data)) return res.status(404).json({ error: 'No news data' });

    // Return top 4 most recent, clean fields only
    const news = data.slice(0, 4).map(n => ({
      headline: n.headline,
      summary:  n.summary,
      source:   n.source,
      url:      n.url,
      datetime: n.datetime, // unix timestamp
    }));

    return res.status(200).json({ symbol, news });
  } catch(e) {
    return res.status(500).json({ error: 'Failed', detail: e.message });
  }
}
