// Works out the bank medians from a list of cached banks. Pure, so it can be
// tested without a database; scripts/compute-bank-medians.js does the I/O.

const { bankRatios } = require('./gradingBank');

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

module.exports = { computeBankMedians, median, MIN_POOL_SIZE };
