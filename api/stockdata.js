// api/stockdata.js — pre-momentum signals for one stock
// GET /api/stockdata?symbol=GOOG

const FINNHUB_KEY = process.env.FINNHUB_KEY || 'd77fes9r01qp6aflfiigd77fes9r01qp6aflfij0';
const BASE = 'https://finnhub.io/api/v1';

function calcRSI(closes, period) {
  period = period || 14;
  if (!closes || closes.length < period + 1) return null;
  var gains = 0, losses = 0;
  for (var i = closes.length - period; i < closes.length; i++) {
    var diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  var avgGain = gains / period;
  var avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  var rs = avgGain / avgLoss;
  return parseFloat((100 - 100 / (1 + rs)).toFixed(1));
}

function calcMA(closes, period) {
  if (!closes || closes.length < period) return null;
  var slice = closes.slice(-period);
  return slice.reduce(function(a, b) { return a + b; }, 0) / period;
}

async function fhFetch(path) {
  try {
    var url = BASE + path + (path.includes('?') ? '&' : '?') + 'token=' + FINNHUB_KEY;
    var r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300');

  var symbol = req.query && req.query.symbol;
  if (!symbol) return res.status(400).json({ error: 'Missing symbol' });

  var sym = symbol;
  if (symbol === 'ATZ.TO') sym = 'ATZ:TSX';
  if (symbol === 'NOVO.TO') sym = 'NVO';

  // Fetch quote, candles, earnings, recommendation in parallel
  var to = Math.floor(Date.now() / 1000);
  var from = to - 90 * 24 * 60 * 60;

  var results = await Promise.all([
    fhFetch('/quote?symbol=' + sym),
    fhFetch('/stock/candle?symbol=' + sym + '&resolution=D&from=' + from + '&to=' + to),
    fhFetch('/calendar/earnings?from=' + new Date().toISOString().split('T')[0] + '&to=' + new Date(Date.now() + 90*24*60*60*1000).toISOString().split('T')[0] + '&symbol=' + sym),
    fhFetch('/stock/recommendation?symbol=' + sym),
  ]);

  var quote = results[0];
  var candles = results[1];
  var earningsData = results[2];
  var recData = results[3];

  // Quote check
  if (!quote || !quote.c || quote.c === 0) {
    return res.status(502).json({ error: 'Quote unavailable', symbol: symbol });
  }

  var price = quote.c;
  var changePercent = parseFloat((quote.dp || ((quote.c - quote.pc) / quote.pc * 100)).toFixed(2));

  // RSI + MA from candles
  var rsi = null, vsMA50 = null, momGap = 50;
  var closes = (candles && candles.s === 'ok' && candles.c) ? candles.c : null;
  if (closes && closes.length >= 15) {
    rsi = calcRSI(closes);
    var ma = calcMA(closes, Math.min(50, closes.length));
    if (ma) vsMA50 = parseFloat(((price - ma) / ma * 100).toFixed(1));

    if (rsi !== null) {
      momGap = (rsi >= 40 && rsi <= 55) ? Math.round(70 + (10 - Math.abs(rsi - 47.5))) : rsi < 40 ? Math.round(rsi * 1.2) : Math.round(Math.max(10, 100 - rsi));
      momGap = Math.min(100, Math.max(0, momGap));
    }
    if (vsMA50 !== null && vsMA50 < 0 && vsMA50 > -15) momGap = Math.min(100, momGap + 10);
  }

  // Earnings
  var earningsDaysAway = null, earningsDate = null, catalystScore = 40;
  if (earningsData && earningsData.earningsCalendar && earningsData.earningsCalendar.length > 0) {
    var next = earningsData.earningsCalendar[0];
    earningsDaysAway = Math.round((new Date(next.date) - new Date()) / (1000 * 60 * 60 * 24));
    earningsDate = next.date;
    catalystScore = earningsDaysAway <= 14 ? 95 : earningsDaysAway <= 30 ? 85 : earningsDaysAway <= 60 ? 70 : 55;
  }

  // Analyst recommendation
  var analystUpside = 50;
  if (recData && recData.length > 0) {
    var rec = recData[0];
    var total = rec.strongBuy + rec.buy + rec.hold + rec.sell + rec.strongSell;
    if (total > 0) analystUpside = Math.round(((rec.strongBuy * 2 + rec.buy) / (total * 2)) * 100);
  }

  var fundScore = 70;
  var oppScore = Math.min(100, Math.round(fundScore * 0.25 + momGap * 0.35 + catalystScore * 0.25 + analystUpside * 0.15));
  var oppLevel = oppScore >= 80 ? 'high' : oppScore >= 65 ? 'med' : 'low';

  return res.status(200).json({
    symbol: symbol,
    price: price,
    changePercent: changePercent,
    rsi: rsi,
    vsMA50: vsMA50,
    momGap: momGap,
    earningsDaysAway: earningsDaysAway,
    earningsDate: earningsDate,
    catalystScore: catalystScore,
    analystUpside: analystUpside,
    fundScore: fundScore,
    oppScore: oppScore,
    oppLevel: oppLevel,
  });
}
