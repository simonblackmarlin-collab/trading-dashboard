export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300'); // cache 5 mins

  try {
    // Fetch S&P 500 futures, Nasdaq futures, Dow futures + pre-market movers
    // Using Yahoo Finance crumb-free endpoints

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
    };

    // Fetch index futures
    const futuresTickers = ['ES=F', 'NQ=F', 'YM=F', 'CL=F', 'GC=F']; // S&P, Nasdaq, Dow, Oil, Gold
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

    // Fetch pre-market movers — top gainers/losers from Yahoo screener
    const gainersUrl = 'https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=false&scrIds=day_gainers&count=15&start=0';
    const losersUrl = 'https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=false&scrIds=day_losers&count=15&start=0';

    const [gainersRes, losersRes] = await Promise.all([
      fetch(gainersUrl, { headers }),
      fetch(losersUrl, { headers }),
    ]);

    const gainersData = await gainersRes.json();
    const losersData = await losersRes.json();

    const parseMovers = (data) => {
      const quotes = data?.finance?.result?.[0]?.quotes || [];
      return quotes.slice(0, 10).map(q => ({
        symbol: q.symbol,
        name: q.shortName || q.longName || q.symbol,
        price: q.regularMarketPrice,
        changePct: q.regularMarketChangePercent,
        volume: q.regularMarketVolume,
        marketCap: q.marketCap,
      }));
    };

    const gainers = parseMovers(gainersData);
    const losers = parseMovers(losersData);

    // Market status
    const now = new Date();
    const etHour = parseInt(now.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }));
    const etMin = parseInt(now.toLocaleString('en-US', { timeZone: 'America/New_York', minute: 'numeric' }));
    const etDay = parseInt(now.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'narrow' }));
    const totalMins = etHour * 60 + etMin;
    const isWeekday = etDay >= 1 && etDay <= 5;
    let marketPhase = 'closed';
    if (isWeekday) {
      if (totalMins >= 240 && totalMins < 570) marketPhase = 'premarket';      // 4am-9:30am
      else if (totalMins >= 570 && totalMins < 960) marketPhase = 'open';      // 9:30am-4pm
      else if (totalMins >= 960 && totalMins < 1200) marketPhase = 'afterhours'; // 4pm-8pm
    }

    res.status(200).json({ futures, gainers, losers, marketPhase });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
