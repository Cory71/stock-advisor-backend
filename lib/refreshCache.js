// Re-grades every cached stock that hasn't been graded recently. Run on a
// schedule (see scripts/refresh-cache.js) so grades don't quietly go stale
// between user visits.
//
// Why the whole cache and not per-user watchlists: the Stock collection is
// shared per ticker, so refreshing it once updates every user's watchlist,
// history, and compare page at the same time.

const Stock = require('../models/Stock');
const { gradeAndSave } = require('./gradeAndSave');
// Imported as a namespace (not destructured) so test stubs are actually seen.
const finnhubProvider = require('../providers/finnhubProvider');

// Finnhub's free tier allows 60 calls a minute and each ticker costs 4, so
// 4.5 seconds between tickers keeps a full run safely under the limit.
const DEFAULT_DELAY_MS = 4500;

// Skip anything graded in the last 20 hours — a user already refreshed it by
// hand, or the previous daily run is still fresh.
const DEFAULT_MAX_AGE_MS = 20 * 60 * 60 * 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Tickers whose cached grade is older than the cutoff, oldest first.
async function findStaleTickers(maxAgeMs, now) {
  const cutoff = new Date(now.getTime() - maxAgeMs);
  const stale = await Stock.find({ updatedAt: { $lt: cutoff } })
    .sort({ updatedAt: 1 })
    // The old criteria and TTM quarter are kept so a grade change can be
    // explained, not just reported.
    .select('ticker grade criteria rawData.ttmQuarter')
    .lean();
  return stale;
}

// Fetch fresh data for one ticker, grade it, and save it over the cached copy.
// Returns the saved document so the caller can explain any change.
async function refreshOne(ticker) {
  const rawData = await finnhubProvider.getStockData(ticker);
  return gradeAndSave(ticker, rawData);
}

const passLabel = (passed) => (passed === true ? 'pass' : passed === false ? 'fail' : 'n/a');

// Explain a grade change: which criteria moved, and whether the quarterly
// report behind the TTM figures changed.
//
// Added after 7-9 October 2026, when the daily run changed 18 grades a day
// and many flipped straight back. The log only held letters, so the cause
// couldn't be confirmed afterwards. The evidence pointed at the two TTM
// criteria — they're built from whichever quarterly report Finnhub returns as
// newest — so the TTM quarter is recorded too.
function describeChange(before, saved) {
  const oldByName = new Map((before.criteria || []).map((c) => [c.name, c.passed]));
  const criteria = (saved.criteria || [])
    .filter((c) => oldByName.has(c.name) && oldByName.get(c.name) !== c.passed)
    .map((c) => `${c.name}: ${passLabel(oldByName.get(c.name))} -> ${passLabel(c.passed)}`);

  const ttmBefore = before.rawData?.ttmQuarter ?? null;
  const ttmAfter = saved.rawData?.ttmQuarter ?? null;

  return {
    ticker: before.ticker,
    from: before.grade,
    to: saved.grade,
    criteria,
    ttmQuarter: ttmBefore === ttmAfter ? null : { from: ttmBefore, to: ttmAfter },
  };
}

// Finnhub answers 403 for a symbol our plan doesn't cover (e.g. a foreign
// listing like IEC.AQ). That will never succeed on a retry, so it's reported
// as skipped rather than failed — otherwise it would look like an outage.
function isUnsupportedListing(err) {
  return err && err.status === 403;
}

// Main entry point. One bad ticker never stops the run — its error is recorded
// and the loop moves on. Returns a summary the script prints and exits on.
async function refreshCache({
  delayMs = DEFAULT_DELAY_MS,
  maxAgeMs = DEFAULT_MAX_AGE_MS,
  now = new Date(),
  log = () => {}
} = {}) {
  const stale = await findStaleTickers(maxAgeMs, now);
  const summary = { checked: stale.length, refreshed: 0, skipped: [], failed: [], gradeChanges: [] };

  for (const [index, stock] of stale.entries()) {
    try {
      const saved = await refreshOne(stock.ticker);
      summary.refreshed += 1;
      if (saved.grade !== stock.grade) {
        const change = describeChange(stock, saved);
        summary.gradeChanges.push(change);
        log(`${stock.ticker}: ${stock.grade} -> ${saved.grade}`);
      }
    } catch (err) {
      if (isUnsupportedListing(err)) {
        summary.skipped.push(stock.ticker);
        log(`${stock.ticker}: skipped — not covered by the Finnhub plan`);
      } else {
        summary.failed.push({ ticker: stock.ticker, error: err.message });
        log(`${stock.ticker}: FAILED — ${err.message}`);
      }
    }

    // Pause between tickers, but not after the last one.
    if (index < stale.length - 1) await sleep(delayMs);
  }

  return summary;
}

module.exports = {
  refreshCache, findStaleTickers, describeChange, DEFAULT_DELAY_MS, DEFAULT_MAX_AGE_MS,
};
