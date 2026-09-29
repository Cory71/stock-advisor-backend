// Recompute lib/bankMedians.json from the banks in the cache.
//
// Run with: npm run bank-medians          (add -- --force to skip the size guard)
//
// Normally runs by itself once a year from GitHub Actions
// (.github/workflows/bank-medians.yml), after banks' annual reports are out,
// and commits the result. The medians are a committed file on purpose: if they
// were recalculated live, a bank's grade could change because *other* banks
// moved.
//
// Two safety checks:
//   - Nothing is written when the medians and pool are unchanged, so the yearly
//     job doesn't make an empty commit.
//   - If any median moves more than 25%, it stops with an error instead of
//     writing. A jump that size means bad data, not a new year — GitHub emails
//     the owner, and a person decides.
//
// It only reads the cache and writes the file; it never re-grades anything.

require('dotenv').config();
const fs = require('fs');
const mongoose = require('mongoose');
const Stock = require('../models/Stock');
const { BANK_INDUSTRIES } = require('../lib/selectGrader');
const {
  computeBankMedians, mediansChanged, suspiciousShifts,
} = require('../lib/computeBankMedians');
const { gradeBank } = require('../lib/gradingBank');
const { MEDIANS_FILE } = require('../lib/bankMedians');

const percent = (value, digits = 1) =>
  value == null ? '-' : `${(value * 100).toFixed(digits)}%`;

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

  console.log(`\nGrades that will change on the next daily refresh: ${changes.length}`);
  changes.forEach((c) => console.log(`  ${c.ticker}: ${c.from} -> ${c.to}`));
}

// One line for the automatic commit message, e.g.
// "ROE 10.5% -> 10.8%, ROA 1.00% -> 1.02%, efficiency 60.7% -> 60.1%, pool 14".
function summaryLine(before, after) {
  const pair = (key, digits) => `${percent(before?.[key], digits)} -> ${percent(after[key], digits)}`;
  return `ROE ${pair('roe', 1)}, ROA ${pair('roa', 2)}, efficiency ${pair('efficiency', 1)}, pool ${after.pool.length}`;
}

// Hand the summary to the GitHub Actions workflow, which puts it in the commit.
function shareWithWorkflow(summary) {
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `summary=${summary}\n`);
  }
}

async function main() {
  const force = process.argv.includes('--force');

  await mongoose.connect(process.env.MONGO_URI);
  const banks = await Stock.find({ 'rawData.industry': { $in: BANK_INDUSTRIES } })
    .select('ticker grade rawData')
    .lean();
  await mongoose.disconnect();

  const before = readCurrentMedians();
  const medians = computeBankMedians(banks);
  printComparison(before, medians);

  if (!mediansChanged(before, medians)) {
    console.log('\nNo change from the current medians — nothing written.');
    return;
  }

  const problems = suspiciousShifts(before, medians);
  if (problems.length > 0 && !force) {
    console.error('\nNot writing — a median moved more than expected, which usually means bad data:');
    problems.forEach((line) => console.error(`  ${line}`));
    console.error('Check the cached bank figures. If the change is real, re-run with --force.');
    process.exitCode = 1;
    return;
  }

  printGradeChanges(banks, medians);
  fs.writeFileSync(MEDIANS_FILE, JSON.stringify(medians, null, 2) + '\n');
  const summary = summaryLine(before, medians);
  shareWithWorkflow(summary);
  console.log(`\nWrote ${MEDIANS_FILE}\n${summary}`);
}

main().catch((err) => {
  console.error('Could not compute bank medians:', err.message);
  process.exit(1);
});
