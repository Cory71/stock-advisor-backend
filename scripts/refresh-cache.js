// Scheduled job: re-grade every cached stock that's gone stale.
//
// Run with: npm run refresh
// Or directly: node scripts/refresh-cache.js
//
// Meant to run once a day from a scheduler. It talks to MongoDB directly, so
// it doesn't need the web server to be awake or any login token.
//
// Exit code tells the scheduler whether to flag the run:
//   0 — finished (individual ticker failures are listed, not fatal)
//   1 — couldn't connect, or every ticker it tried failed (likely an outage
//       or a bad API key, which someone should look at). Listings Finnhub's
//       plan doesn't cover are skipped and never count as a failure.

require('dotenv').config();
const mongoose = require('mongoose');
const { refreshCache } = require('../lib/refreshCache');

function printSummary(summary, startedAt) {
  const seconds = Math.round((Date.now() - startedAt) / 1000);
  console.log('\n===== Refresh summary =====');
  console.log(`Stale stocks:   ${summary.checked}`);
  console.log(`Refreshed:      ${summary.refreshed}`);
  console.log(`Grade changes:  ${summary.gradeChanges.length}`);
  console.log(`Skipped:        ${summary.skipped.length}  (not covered by the Finnhub plan)`);
  console.log(`Failed:         ${summary.failed.length}`);
  console.log(`Took:           ${seconds}s`);
  for (const change of summary.gradeChanges) {
    console.log(`  ${change.ticker}: ${change.from} -> ${change.to}`);
  }
  for (const failure of summary.failed) {
    console.log(`  FAILED ${failure.ticker}: ${failure.error}`);
  }
}

// Every attempt failing points at something systemic (outage, bad key), not
// one bad symbol. Skipped listings don't count — they can never succeed.
function everythingFailed(summary) {
  return summary.failed.length > 0 && summary.refreshed === 0;
}

async function main() {
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is missing.');
    process.exit(1);
  }

  const startedAt = Date.now();
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected. Looking for stale stocks…');

  const summary = await refreshCache({ log: (line) => console.log(line) });
  printSummary(summary, startedAt);

  await mongoose.disconnect();
  process.exit(everythingFailed(summary) ? 1 : 0);
}

main().catch((err) => {
  console.error('Refresh failed:', err);
  process.exit(1);
});
