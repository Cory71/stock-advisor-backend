// Sector context: how a stock's numbers compare with the other stocks in its
// industry. Pure — no database — so it can be tested on its own;
// lib/sectorBaselines.js does the reading and writing.
//
// It never changes the letter grade. It's shown beside the grade so a 2% free
// cash flow margin can be judged against grocers rather than software firms.
//
// Why a median and not a percentile: industry pools here are small (often
// 8–15 stocks), so "72nd percentile" would claim more precision than the data
// has. "Above the median of 9 Technology stocks" says exactly what we know.

const { median } = require('./computeBankMedians');

// Below this many peers we show nothing at all — a comparison built from
// three stocks would be a weak claim dressed up as a fact.
const MIN_PEERS = 8;

// Within one percentage point of the median counts as "about the median", so a
// stock isn't called above or below over a rounding-sized difference.
const ABOUT_MEDIAN_BAND = 0.01;

// The metrics compared, in the order they're shown.
const METRICS = [
  { key: 'revenueCagr', label: 'Revenue growth per year' },
  { key: 'fcfMargin', label: 'Free cash flow margin' },
  { key: 'fcfCagr', label: 'Free cash flow growth per year' },
];

// ---------- Working out one stock's metrics ----------

// Compound yearly growth between the first and last value. Null when it can't
// mean anything: fewer than two values, less than a year apart, or a start or
// end at or below zero (growth from a loss has no sensible percentage).
function yearlyGrowth(values = [], years = []) {
  if (values.length < 2 || years.length !== values.length) return null;
  const first = values[0];
  const last = values[values.length - 1];
  const span = years[years.length - 1] - years[0];
  if (span < 1 || first <= 0 || last <= 0) return null;
  return (last / first) ** (1 / span) - 1;
}

// Latest free cash flow as a share of that same year's revenue. Uses the
// matching year so a gap in one series can't pair two different years.
function fcfMargin(rawData) {
  const fcfs = rawData.annualFreeCashFlows || [];
  const fcfYears = rawData.annualFcfYears || [];
  if (!fcfs.length || fcfYears.length !== fcfs.length) return null;

  const year = fcfYears[fcfYears.length - 1];
  const revenueIndex = (rawData.annualYears || []).indexOf(year);
  const revenue = (rawData.annualRevenues || [])[revenueIndex];
  if (revenueIndex === -1 || !(revenue > 0)) return null;
  return fcfs[fcfs.length - 1] / revenue;
}

// The three compared metrics for one stock. Any of them can be null.
function stockMetrics(rawData = {}) {
  return {
    revenueCagr: yearlyGrowth(rawData.annualRevenues, rawData.annualYears),
    fcfMargin: fcfMargin(rawData),
    fcfCagr: yearlyGrowth(rawData.annualFreeCashFlows, rawData.annualFcfYears),
  };
}

// ---------- Building baselines ----------

// Round to 4 decimal places so stored medians read cleanly (0.1234 = 12.34%).
function round4(value) {
  return Math.round(value * 10_000) / 10_000;
}

// One industry's baseline: for each metric, the median and how many stocks it
// came from. A metric only some stocks have gets its own, smaller count.
function buildBaseline(industry, stocks) {
  const metrics = {};
  for (const { key } of METRICS) {
    const values = stocks.map((s) => stockMetrics(s.rawData)[key]).filter((v) => v != null);
    metrics[key] = values.length ? { median: round4(median(values)), peers: values.length } : null;
  }
  return { industry, peerCount: stocks.length, metrics };
}

// Keep one stock per company. Some companies list more than one share class
// (Alphabet as GOOG and GOOGL) with identical numbers; counting both would
// weigh that company twice in a small pool.
function onePerCompany(stocks) {
  const seen = new Set();
  return stocks.filter((stock) => {
    const company = stock.name || stock.ticker;
    if (!company) return true;              // nothing to match on, so keep it
    if (seen.has(company)) return false;
    seen.add(company);
    return true;
  });
}

// stocks: [{ ticker, name, industry, rawData }] — graded, general-model
// stocks only. Returns one baseline per industry. Thin industries are kept
// (with their counts) so it's visible how close they are; buildSectorContext
// hides them.
function computeBaselines(stocks) {
  const byIndustry = new Map();
  for (const stock of onePerCompany(stocks)) {
    if (!stock.industry) continue;
    if (!byIndustry.has(stock.industry)) byIndustry.set(stock.industry, []);
    byIndustry.get(stock.industry).push(stock);
  }
  return [...byIndustry.entries()]
    .map(([industry, group]) => buildBaseline(industry, group))
    .sort((a, b) => b.peerCount - a.peerCount);
}

// ---------- Comparing one stock with its baseline ----------

// 'above', 'about' or 'below' the median.
function position(value, medianValue) {
  if (Math.abs(value - medianValue) <= ABOUT_MEDIAN_BAND) return 'about';
  return value > medianValue ? 'above' : 'below';
}

// What the grade page shows. Null when there's nothing honest to say: no
// baseline, or no metric that both this stock has and enough peers share.
function buildSectorContext(rawData, baseline) {
  if (!baseline || !baseline.metrics) return null;
  const mine = stockMetrics(rawData);

  const metrics = METRICS
    .map(({ key, label }) => ({ key, label, value: mine[key], base: baseline.metrics[key] }))
    .filter(({ value, base }) => value != null && base && base.peers >= MIN_PEERS)
    .map(({ key, label, value, base }) => ({
      key,
      label,
      value: round4(value),
      median: base.median,
      peers: base.peers,
      position: position(value, base.median),
    }));

  return metrics.length ? { industry: baseline.industry, metrics } : null;
}

module.exports = {
  stockMetrics, yearlyGrowth, computeBaselines, buildSectorContext,
  MIN_PEERS, ABOUT_MEDIAN_BAND, METRICS,
};
