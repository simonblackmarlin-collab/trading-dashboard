// api/fundamentals.js
// Fetches earnings date, analyst target, 52wk high/low, and volume data
// from Yahoo Finance — server-side, no CORS issues

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'Missing symbol' });

  try {
    // Yahoo Finance v10 quoteSummary — gets everything in one call
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=defaultKeyStatistics,calendarEvents,financialData,summaryDetail`;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return res.status(502).json({ error: 'Yahoo request failed' });
    const data = await r.json();
    const result = data?.quoteSummary?.result?.[0];
    if (!result) return res.status(404).json({ error: 'No data' });

    const fin   = result.financialData || {};
    const cal   = result.calendarEvents || {};
    const stats = result.defaultKeyStatistics || {};
    const summ  = result.summaryDetail || {};

    // Analyst data
    const targetPrice    = fin.targetMeanPrice?.raw || null;
    const currentPrice   = fin.currentPrice?.raw || null;
    const analystRating  = fin.recommendationKey || null; // 'buy','hold','sell','strong_buy','strong_sell'
    const numAnalysts    = fin.numberOfAnalystOpinions?.raw || 0;
    const upside         = targetPrice && currentPrice ? ((targetPrice - currentPrice) / currentPrice * 100) : null;

    // Earnings date (next earnings)
    const earningsArr    = cal.earnings?.earningsDate || [];
    const nextEarnings   = earningsArr.length > 0 ? earningsArr[0]?.raw : null; // unix timestamp
    const earningsDate   = nextEarnings ? new Date(nextEarnings * 1000).toISOString().split('T')[0] : null;
    const daysToEarnings = nextEarnings ? Math.round((nextEarnings * 1000 - Date.now()) / (1000 * 60 * 60 * 24)) : null;

    // 52-week high/low
    const week52High = summ.fiftyTwoWeekHigh?.raw || stats.fiftyTwoWeekHigh?.raw || null;
    const week52Low  = summ.fiftyTwoWeekLow?.raw  || stats.fiftyTwoWeekLow?.raw  || null;
    const pctFrom52High = week52High && currentPrice ? ((currentPrice - week52High) / week52High * 100) : null;
    const pctFrom52Low  = week52Low  && currentPrice ? ((currentPrice - week52Low)  / week52Low  * 100) : null;

    // Volume
    const avgVolume    = summ.averageVolume?.raw || summ.averageDailyVolume10Day?.raw || null;
    const todayVolume  = summ.volume?.raw || null;
    const volumeRatio  = avgVolume && todayVolume ? (todayVolume / avgVolume) : null;

    return res.status(200).json({
      symbol,
      // Analyst
      targetPrice,
      currentPrice,
      analystRating,    // 'strong_buy','buy','hold','sell','strong_sell'
      numAnalysts,
      upside,           // % upside to analyst target
      // Earnings
      earningsDate,
      daysToEarnings,
      // 52-week
      week52High,
      week52Low,
      pctFrom52High,    // negative = % below 52wk high (0 = at high)
      pctFrom52Low,     // positive = % above 52wk low
      // Volume
      avgVolume,
      todayVolume,
      volumeRatio,      // >1.5 = above average volume
    });
  } catch(e) {
    return res.status(500).json({ error: 'Failed', detail: e.message });
  }
}
