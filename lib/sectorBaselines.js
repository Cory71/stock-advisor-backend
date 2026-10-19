// Reads graded stocks from the cache, works out each industry's medians
// (lib/sectorContext.js does the maths), and saves them as SectorBaseline
// documents. Also looks up the comparison for one stock on the grade page.

const Stock = require('../models/Stock');
const SectorBaseline = require('../models/SectorBaseline');
const { computeBaselines, buildSectorContext, MIN_PEERS } = require('./sectorContext');

// Stocks cached before the `industry` field existed only have it inside
// rawData. Copy it out so they can be grouped. Cheap once everything is filled.
async function backfillIndustry() {
  const result = await Stock.updateMany(
    // `industry: null` matches both a missing field and an explicit null.
    { industry: null, 'rawData.industry': { $type: 'string' } },
    // A pipeline update, so the new field can be set from another field.
    [{ $set: { industry: '$rawData.industry' } }],
    { updatePipeline: true }
  );
  return result.modifiedCount;
}

// The pool: stocks with a real letter from the general model. Banks are
// already compared with other banks inside their own grade, and N/A stocks
// have no numbers worth comparing.
async function loadPool() {
  return Stock.find({ model: 'general', grade: { $ne: 'N/A' }, industry: { $ne: null } })
    .select('ticker name industry rawData')
    .lean();
}

// Rebuild every baseline from the current cache. Industries that no longer
// have any graded stocks are removed. Returns the baselines it saved.
async function refreshSectorBaselines(now = new Date()) {
  await backfillIndustry();
  const baselines = computeBaselines(await loadPool());

  for (const baseline of baselines) {
    await SectorBaseline.findOneAndUpdate(
      { industry: baseline.industry },
      { ...baseline, computedAt: now },
      { upsert: true }
    );
  }
  await SectorBaseline.deleteMany({ industry: { $nin: baselines.map((b) => b.industry) } });
  return baselines;
}

// The comparison for one cached stock, or null when there's nothing to show.
// Only general-model stocks with a real grade get one (see loadPool).
async function sectorContextFor(stock) {
  const industry = stock.industry || stock.rawData?.industry;
  if (!industry || stock.grade === 'N/A' || (stock.model || 'general') !== 'general') return null;

  const baseline = await SectorBaseline.findOne({ industry }).lean();
  return buildSectorContext(stock.rawData || {}, baseline);
}

// One line per industry for the scripts' output, e.g.
// "Technology            12 stocks  (shown)".
function describeBaselines(baselines) {
  return baselines.map((b) => {
    const peers = Math.max(...Object.values(b.metrics).map((m) => m?.peers ?? 0));
    const status = peers >= MIN_PEERS ? 'shown' : `hidden — needs ${MIN_PEERS}`;
    return `  ${b.industry.padEnd(34)}${String(b.peerCount).padStart(3)} stocks  (${status})`;
  });
}

module.exports = { refreshSectorBaselines, sectorContextFor, backfillIndustry, describeBaselines };
