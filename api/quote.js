// api/quote.js
// Vercel serverless function — runs on Vercel's servers, not in the browser
// Browser calls /api/quote?symbol=NVDA → this function calls Finnhub → returns data
// This completely bypasses CORS because the call is server-to-server

const FINNHUB_KEY = 'd77fes9r01qp6aflfiigd77fes9r01qp6aflfij0';

export default async function handler(req, res) {
  // Allow requests from your own Vercel site
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { symbol } = req.query;

  if (!symbol) {
    return res.status(400).json({ error: 'Missing symbol parameter' });
  }

  // Map TSX stocks to Finnhub format
  const symbolMap = { 'ATZ.TO': 'ATZ:TSX' };
  const fhSymbol = symbolMap[symbol] || symbol;

  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${fhSymbol}&token=${FINNHUB_KEY}`;
    const response = await fetch(url);

    if (!response.ok) {
      return res.status(502).json({ error: 'Finnhub request failed' });
    }

    const data = await response.json();

    // Finnhub returns c=current, pc=prev close, d=change, dp=change%
    if (!data || data.c === 0 || data.c === undefined) {
      return res.status(404).json({ error: 'No data for symbol', symbol });
    }

    // Return clean price object
    return res.status(200).json({
      symbol,
      price:         data.c,
      prev:          data.pc,
      change:        data.d  || (data.c - data.pc),
      changePercent: data.dp || ((data.c - data.pc) / data.pc * 100),
    });

  } catch (error) {
    return res.status(500).json({ error: 'Server error', message: error.message });
  }
}
