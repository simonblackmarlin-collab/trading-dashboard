// api/fundamentals.js
// Fetches earnings date, analyst target, 52wk high/low, volume data,
// and company description from Yahoo Finance — server-side, no CORS issues

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'Missing symbol' });

  try {
    // Added assetProfile to get longBusinessSummary (company description)
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=defaultKeyStatistics,calendarEvents,financialData,summaryDetail,assetProfile`;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return res.status(502).json({ error: 'Yahoo request failed' });
    const data = await r.json();
    const result = data?.quoteSummary?.result?.[0];
    if (!result) return res.status(404).json({ error: 'No data' });

    const fin     = result.financialData || {};
    const cal     = result.calendarEvents || {};
    const stats   = result.defaultKeyStatistics || {};
    const summ    = result.summaryDetail || {};
    const profile = result.assetProfile || {};

    // Analyst data
    const targetPrice    = fin.targetMeanPrice?.raw || null;
    const currentPrice   = fin.currentPrice?.raw || null;
    const analystRating  = fin.recommendationKey || null;
    const numAnalysts    = fin.numberOfAnalystOpinions?.raw || 0;
    const upside         = targetPrice && currentPrice ? ((targetPrice - currentPrice) / currentPrice * 100) : null;

    // Earnings date
    const earningsArr    = cal.earnings?.earningsDate || [];
    const nextEarnings   = earningsArr.length > 0 ? earningsArr[0]?.raw : null;
    const earningsDate   = nextEarnings ? new Date(nextEarnings * 1000).toISOString().split('T')[0] : null;
    const daysToEarnings = nextEarnings ? Math.round((nextEarnings * 1000 - Date.now()) / (1000 * 60 * 60 * 24)) : null;

    // 52-week high/low
    const week52High    = summ.fiftyTwoWeekHigh?.raw || stats.fiftyTwoWeekHigh?.raw || null;
    const week52Low     = summ.fiftyTwoWeekLow?.raw  || stats.fiftyTwoWeekLow?.raw  || null;
    const pctFrom52High = week52High && currentPrice ? ((currentPrice - week52High) / week52High * 100) : null;
    const pctFrom52Low  = week52Low  && currentPrice ? ((currentPrice - week52Low)  / week52Low  * 100) : null;

    // Volume
    const avgVolume   = summ.averageVolume?.raw || summ.averageDailyVolume10Day?.raw || null;
    const todayVolume = summ.volume?.raw || null;
    const volumeRatio = avgVolume && todayVolume ? (todayVolume / avgVolume) : null;

    // Company description — truncated to 300 chars to keep it readable
    const rawDesc   = profile.longBusinessSummary || null;
    const description = rawDesc ? rawDesc.slice(0, 300).replace(/\s+\S*$/, '') + '…' : null;

    return res.status(200).json({
      symbol,
      // Analyst
      targetPrice,
      currentPrice,
      analystRating,
      numAnalysts,
      upside,
      // Earnings
      earningsDate,
      daysToEarnings,
      // 52-week
      week52High,
      week52Low,
      pctFrom52High,
      pctFrom52Low,
      // Volume
      avgVolume,
      todayVolume,
      volumeRatio,
      // Company description (new)
      description,
    });
  } catch(e) {
    return res.status(500).json({ error: 'Failed', detail: e.message });
  }
}
