// api/history.js
// Returns ~3 months of daily closes for a symbol via Yahoo Finance
// Called server-side so no CORS issues

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'Missing symbol' });

  const now = Math.floor(Date.now() / 1000);
  const threeMonthsAgo = now - (90 * 24 * 60 * 60);

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&period1=${threeMonthsAgo}&period2=${now}`;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return res.status(502).json({ error: 'Yahoo request failed' });
    const data = await r.json();
    const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
    if (!closes || closes.length < 2) return res.status(404).json({ error: 'No data' });
    const first = closes.find(v => v != null);
    const last  = [...closes].reverse().find(v => v != null);
    if (!first || !last) return res.status(404).json({ error: 'No valid closes' });
    return res.status(200).json({ symbol, first, last, pct: ((last - first) / first) * 100 });
  } catch(e) {
    return res.status(500).json({ error: 'Failed', detail: e.message });
  }
}
