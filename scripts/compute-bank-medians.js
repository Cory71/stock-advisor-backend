// Recompute lib/bankMedians.json from the banks in the cache.
//
// Run with: node scripts/compute-bank-medians.js
//
// Run it deliberately — roughly quarterly, after banks' annual reports land —
// then review the printed changes and the git diff before committing. The
// medians are a committed file on purpose: if they were recalculated live, a
// bank's grade could change because *other* banks moved.
//
// It only reads the cache and writes the file; it never re-grades anything.

require('dotenv').config();
const fs = require('fs');
const mongoose = require('mongoose');
const Stock = require('../models/Stock');
const { BANK_INDUSTRIES } = require('../lib/selectGrader');
const { computeBankMedians } = require('../lib/computeBankMedians');
const { gradeBank } = require('../lib/gradingBank');
const { MEDIANS_FILE } = require('../lib/bankMedians');

const percent = (value, digits = 1) =>
  value == null ? '  -  ' : `${(value * 100).toFixed(digits)}%`;

// The file as it is now, or null the first time.
function readCurrentMedians() {
  return fs.existsSync(MEDIANS_FILE) ? JSON.parse(fs.readFileSync(MEDIANS_FILE, 'utf8')) : null;
}

function printComparison(before, after) {
  console.log('\nMedian            before      after');
  console.log(`Return on equity  ${percent(before?.roe).padEnd(10)}  ${percent(after.roe)}`);
  console.log(`Return on assets  ${percent(before?.roa, 2).padEnd(10)}  ${percent(after.roa, 2)}`);
  console.log(`Efficiency ratio  ${percent(before?.efficiency).padEnd(10)}  ${percent(after.efficiency)}`);
  console.log(`Pool (${after.pool.length}): ${after.pool.join(' ')}`);
}

// Which banks' grades these medians would move, compared with the cache.
function printGradeChanges(banks, medians) {
  const changes = banks
    .map((bank) => ({ ticker: bank.ticker, from: bank.grade, to: gradeBank(bank.rawData, medians).grade }))
    .filter((c) => c.from !== c.to);

  console.log(`\nGrades that would change on the next re-grade: ${changes.length}`);
  changes.forEach((c) => console.log(`  ${c.ticker}: ${c.from} -> ${c.to}`));
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const banks = await Stock.find({ 'rawData.industry': { $in: BANK_INDUSTRIES } })
    .select('ticker grade rawData')
    .lean();
  await mongoose.disconnect();

  const medians = computeBankMedians(banks);
  printComparison(readCurrentMedians(), medians);
  printGradeChanges(banks, medians);

  fs.writeFileSync(MEDIANS_FILE, JSON.stringify(medians, null, 2) + '\n');
  console.log(`\nWrote ${MEDIANS_FILE}. Review the diff, then commit it.`);
}

main().catch((err) => {
  console.error('Could not compute bank medians:', err.message);
  process.exit(1);
});
