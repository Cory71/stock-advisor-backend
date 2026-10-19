// Rebuilds the per-industry medians used for sector context on the grade page.
//
// Run with: npm run sector-baselines
//
// The seed script and the daily refresh already run this at the end, so it's
// only needed by hand after changing the cache some other way. Makes no
// Finnhub calls — it only reads what's already cached.

require('dotenv').config();
const mongoose = require('mongoose');
const { refreshSectorBaselines, describeBaselines } = require('../lib/sectorBaselines');

async function main() {
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is missing from .env');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  const baselines = await refreshSectorBaselines();
  console.log(`Sector baselines rebuilt for ${baselines.length} industries:`);
  describeBaselines(baselines).forEach((line) => console.log(line));

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Sector baselines failed:', err);
  process.exit(1);
});
