// Works out the bank medians from a list of cached banks. Pure, so it can be
// tested without a database; scripts/compute-bank-medians.js does the I/O.

const { bankRatios } = require('./gradingBank');

// The yearly job refuses to publish if any median moves more than this much in
// one go. Real shifts across the banking sector are a point or two; a jump this
// size means bad data (a mis-read filing, a half-seeded cache), not a new year.
const MAX_MEDIAN_SHIFT = 0.25;

const MEDIAN_KEYS = ['roe', 'roa', 'efficiency'];

// Refuse to publish medians from a thin pool — a half-seeded cache could
// otherwise produce a "typical bank" from three data points.
const MIN_POOL_SIZE = 8;

// Middle value of a list (the average of the middle two for an even count).
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

// Round to 4 decimal places so the committed file reads cleanly (10.5% -> 0.105).
function round4(value) {
  return Math.round(value * 10_000) / 10_000;
}

// banks: [{ ticker, rawData }]. Only banks with all three ratios readable count.
// Returns the contents of lib/bankMedians.json, or throws if the pool is too small.
function computeBankMedians(banks, today = new Date()) {
  const usable = banks
    .map((bank) => ({ ticker: bank.ticker, ...bankRatios(bank.rawData || {}) }))
    .filter((r) => r.roe !== null && r.roa !== null && r.efficiency !== null);

  if (usable.length < MIN_POOL_SIZE) {
    throw new Error(
      `Only ${usable.length} banks have all three ratios — need at least ${MIN_POOL_SIZE}. Seed more banks first.`
    );
  }

  return {
    computedAt: today.toISOString().slice(0, 10),
    pool: usable.map((r) => r.ticker).sort(),
    roe: round4(median(usable.map((r) => r.roe))),
    roa: round4(median(usable.map((r) => r.roa))),
    efficiency: round4(median(usable.map((r) => r.efficiency))),
  };
}

// True when the new file would say something different from the old one.
// The date alone doesn't count — otherwise every run would make a commit.
function mediansChanged(before, after) {
  if (!before) return true;
  const samePool = JSON.stringify(before.pool) === JSON.stringify(after.pool);
  return !samePool || MEDIAN_KEYS.some((key) => before[key] !== after[key]);
}

// Medians that moved by more than MAX_MEDIAN_SHIFT, as readable lines.
// Empty when everything is within range (or there's nothing to compare with).
function suspiciousShifts(before, after) {
  if (!before) return [];
  return MEDIAN_KEYS
    .filter((key) => before[key] > 0)
    .map((key) => ({ key, change: (after[key] - before[key]) / before[key] }))
    .filter(({ change }) => Math.abs(change) > MAX_MEDIAN_SHIFT)
    .map(({ key, change }) =>
      `${key} moved ${(change * 100).toFixed(0)}% (${before[key]} -> ${after[key]})`
    );
}

module.exports = {
  computeBankMedians, median, mediansChanged, suspiciousShifts,
  MIN_POOL_SIZE, MAX_MEDIAN_SHIFT,
};
