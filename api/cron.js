// api/cron.js — Vercel cron job to keep price cache warm
// Add to vercel.json: { "crons": [{ "path": "/api/cron", "schedule": "* * * * *" }] }
// Runs every minute during market hours, refreshes the Finnhub cache proactively
// This means users ALWAYS get instant prices — cache is pre-built before anyone asks

export default async function handler(req, res) {
  // Only allow Vercel cron calls (has Authorization header)
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    // Still allow manual trigger for testing
    if (process.env.NODE_ENV !== 'development') {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'FINNHUB_API_KEY not set' });

  // Only refresh during market hours + pre/after market (4am-8pm ET)
  const now = new Date();
  const etHour = parseInt(now.toLocaleString('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', hour12: false
  }));
  if (etHour < 4 || etHour >= 20) {
    return res.status(200).json({ skipped: true, reason: 'outside market hours', etHour });
  }

  // Trigger a snapshot refresh
  try {
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000';
    // Just call snapshot to trigger refresh if stale
    const r = await fetch(`${baseUrl}/api/snapshot`, { signal: AbortSignal.timeout(5000) });
    const d = await r.json();
    return res.status(200).json({
      ok: true,
      cached: d.cached,
      stale: d.stale,
      count: d.count,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
