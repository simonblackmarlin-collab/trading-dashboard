// api/chart.js
// Returns 30 days of daily close prices for a ticker
// Uses Yahoo Finance v8 chart endpoint

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'Missing symbol' });

  try {
    // Yahoo Finance chart API — 3 months of daily data
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=3mo`;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return res.status(502).json({ error: 'Yahoo request failed' });

    const data = await r.json();
    const result = data?.chart?.result?.[0];
    if (!result) return res.status(404).json({ error: 'No chart data' });

    const timestamps = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];

    // Zip timestamps + closes, filter out nulls, return last 30 days
    const points = timestamps
      .map((ts, i) => ({
        date: new Date(ts * 1000).toISOString().split('T')[0],
        close: closes[i] ? Math.round(closes[i] * 100) / 100 : null,
      }))
      .filter(p => p.close !== null)
      .slice(-30);

    if (!points.length) return res.status(404).json({ error: 'No valid points' });

    return res.status(200).json({
      symbol,
      points,
      min: Math.min(...points.map(p => p.close)),
      max: Math.max(...points.map(p => p.close)),
      first: points[0].close,
      last: points[points.length - 1].close,
      pct: ((points[points.length - 1].close - points[0].close) / points[0].close * 100).toFixed(1),
    });
  } catch (e) {
    return res.status(500).json({ error: 'Failed', detail: e.message });
  }
}
