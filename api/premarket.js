export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300'); // cache 5 mins

  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
    };

    // Fetch index futures
    const futuresTickers = ['ES=F', 'NQ=F', 'YM=F', 'CL=F', 'GC=F'];
    const futuresUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${futuresTickers.join(',')}&fields=symbol,shortName,regularMarketPrice,regularMarketChange,regularMarketChangePercent,preMarketPrice,preMarketChange,preMarketChangePercent`;

    const futuresRes = await fetch(futuresUrl, { headers });
    const futuresData = await futuresRes.json();
    const futuresQuotes = futuresData?.quoteResponse?.result || [];

    const futures = futuresQuotes.map(q => ({
      symbol: q.symbol,
      name: q.shortName || q.symbol,
      price: q.regularMarketPrice,
      change: q.regularMarketChange,
      changePct: q.regularMarketChangePercent,
    }));

    // Fetch pre-market movers
    const gainersUrl = 'https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=false&scrIds=day_gainers&count=15&start=0';
    const losersUrl  = 'https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=false&scrIds=day_losers&count=15&start=0';

    const [gainersRes, losersRes] = await Promise.all([
      fetch(gainersUrl, { headers }),
      fetch(losersUrl,  { headers }),
    ]);

    const gainersData = await gainersRes.json();
    const losersData  = await losersRes.json();

    const parseMovers = (data) => {
      const quotes = data?.finance?.result?.[0]?.quotes || [];
      return quotes.slice(0, 10).map(q => ({
        symbol:    q.symbol,
        name:      q.shortName || q.longName || q.symbol,
        price:     q.regularMarketPrice,
        changePct: q.regularMarketChangePercent,
        volume:    q.regularMarketVolume,
        marketCap: q.marketCap,
      }));
    };

    const gainers = parseMovers(gainersData);
    const losers  = parseMovers(losersData);

    // ── Market phase — Intl.DateTimeFormat.formatToParts (DST-safe, no string parsing) ──
    const now = new Date();
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',   // "Mon" "Tue" etc — NOT 'narrow' which gives "M","T"
      hour:    'numeric',
      minute:  '2-digit',
      hour12:  false,
    });
    const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]));
    const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const etDay  = dayMap[parts.weekday] ?? -1;
    const etHour = parseInt(parts.hour,   10);
    const etMin  = parseInt(parts.minute, 10);
    const totalMins = etHour * 60 + etMin;
    const isWeekday = etDay >= 1 && etDay <= 5;

    let marketPhase = 'closed';
    if (isWeekday) {
      if (totalMins >= 240 && totalMins < 570)  marketPhase = 'premarket';  // 4:00–9:30 AM
      else if (totalMins >= 570 && totalMins < 960)  marketPhase = 'open';       // 9:30 AM–4:00 PM
      else if (totalMins >= 960 && totalMins < 1200) marketPhase = 'afterhours'; // 4:00–8:00 PM
    }

    res.status(200).json({ futures, gainers, losers, marketPhase });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
