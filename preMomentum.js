// preMomentum.js  — paste this script block into your index.html
// OR save as /preMomentum.js and add <script src="/preMomentum.js"></script>
//
// Exports one function: loadPreMomentumStocks(tickers)
// Returns scored stock data for all tickers in ~400ms via parallel fetching
// Results are cached in memory for 5 minutes to avoid hammering Finnhub

// ─── 5-minute in-memory cache ─────────────────────────────────────────────────
const _cache = {};
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes in ms

function fromCache(symbol) {
  const entry = _cache[symbol];
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { delete _cache[symbol]; return null; }
  return entry.data;
}

function toCache(symbol, data) {
  _cache[symbol] = { ts: Date.now(), data };
}

// ─── Fetch one stock (with cache check) ──────────────────────────────────────
async function fetchStockData(symbol) {
  const cached = fromCache(symbol);
  if (cached) return cached;

  try {
    const res = await fetch(`/api/stockdata?symbol=${encodeURIComponent(symbol)}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    toCache(symbol, data);
    return data;
  } catch (e) {
    console.warn(`stockdata failed for ${symbol}:`, e.message);
    return { symbol, error: true, price: null, oppScore: 0 };
  }
}

// ─── Main export: load all tickers in parallel ────────────────────────────────
// Usage:
//   const stocks = await loadPreMomentumStocks(['GOOG','ASML','LLY','CVX','SBUX'])
//   // returns array sorted by oppScore descending, ready to render
//
async function loadPreMomentumStocks(tickers, onProgress) {
  let done = 0;

  // Fire all fetches simultaneously — Promise.all means total time ≈ slowest single call
  const results = await Promise.all(
    tickers.map(async (symbol) => {
      const data = await fetchStockData(symbol);
      done++;
      if (onProgress) onProgress(done, tickers.length, symbol);
      return data;
    })
  );

  // Filter out errors, sort by opportunity score descending
  return results
    .filter(s => !s.error && s.price !== null)
    .sort((a, b) => b.oppScore - a.oppScore);
}

// ─── Utility: invalidate cache for a single ticker (e.g. on manual refresh) ──
function invalidateCache(symbol) {
  delete _cache[symbol];
}

// ─── Utility: how stale is the cache? (for UI "last updated X mins ago") ──────
function cacheAge(symbol) {
  const entry = _cache[symbol];
  if (!entry) return null;
  return Math.round((Date.now() - entry.ts) / 1000); // seconds
}
