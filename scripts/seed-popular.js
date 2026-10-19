// One-off script that pre-caches grades for popular tickers into MongoDB.
//
// Why: Finnhub's free tier allows 60 API calls per minute. Each ticker requires
// 3 parallel calls (quote, profile, financials), so we wait 4 seconds between
// tickers to stay safely under the limit. Pre-caching from your local machine
// writes grades into MongoDB so the deployed backend serves them without a
// live Finnhub call.
//
// Run with: npm run seed           (popular stocks)
//           npm run seed:banks     (the bank pool used for bank medians)
//           npm run seed:sectors   (industry pools for sector context)
// Or directly: node scripts/seed-popular.js [banks|sectors]
//
// Safe to re-run — it upserts and refreshes the cache timestamp.

require('dotenv').config();
const mongoose = require('mongoose');
const { gradeAndSave } = require('../lib/gradeAndSave');
const { getStockData } = require('../providers/finnhubProvider');
const { refreshSectorBaselines, describeBaselines } = require('../lib/sectorBaselines');

const TICKERS = [
  'AAPL',   // Apple
  'MSFT',   // Microsoft
  'GOOG',   // Alphabet
  'AMZN',   // Amazon
  'TSLA',   // Tesla
  'META',   // Meta
  'NVDA',   // Nvidia
  'JPM',    // JPMorgan
  'DIS',    // Disney
  'WMT'     // Walmart
];

// Every stock Finnhub labels "Banking" that we grade on the bank model. These
// set the bank medians (scripts/compute-bank-medians.js), so seed them before
// computing. The daily refresh keeps them current afterwards.
const BANK_TICKERS = [
  'JPM', 'BAC', 'WFC', 'C',                 // money-centre banks
  'USB', 'PNC', 'TFC', 'FITB', 'KEY',       // large regionals
  'RF', 'MTB', 'HBAN', 'CFG', 'ZION'
];

// Stocks that fill out industry pools for sector context on the grade page,
// which needs at least 8 graded stocks per industry. Grouped by the label
// Finnhub gives them (checked before adding). Industries that would stay
// under 8 even with seeding (pharma, telecom, ...) are left out on purpose —
// every cached stock adds time to the daily refresh.
const SECTOR_TICKERS = [
  'INTC', 'QCOM', 'AVGO', 'TXN', 'MU', 'ADI', 'AMAT',      // Semiconductors
  'LRCX', 'KLAC', 'MRVL', 'ON', 'MCHP', 'NXPI',
  'SBUX', 'CMG', 'YUM', 'MAR', 'HLT', 'DRI', 'RCL',        // Hotels, Restaurants & Leisure
  'CCL', 'LVS', 'BKNG',
  'COST', 'TGT', 'HD', 'LOW', 'TJX', 'BBY', 'DG',          // Retail
  'DLTR', 'ROST',
  'COP', 'EOG', 'SLB', 'PSX', 'MPC', 'VLO', 'OXY',         // Energy
  'KMI', 'WMB',
  'CVS', 'CI', 'ELV', 'HCA', 'HUM', 'ABT', 'MDT',          // Health Care
  'SYK', 'ISRG',
  'DE', 'PH', 'ITW', 'CMI', 'PCAR', 'OTIS', 'DOV',         // Machinery
  'LMT', 'RTX', 'NOC', 'GD', 'LHX', 'HWM', 'TDG',          // Aerospace & Defense
  'ORCL', 'CRM', 'ADBE', 'IBM', 'INTU', 'NOW', 'ACN',      // Technology
  'CHTR'                                                   // Media
];

// `node scripts/seed-popular.js banks` or `... sectors` seeds that list instead.
const LISTS = { banks: BANK_TICKERS, sectors: SECTOR_TICKERS };
const TICKERS_TO_SEED = LISTS[process.argv[2]] || TICKERS;

async function seedOne(ticker) {
  process.stdout.write(`  ${ticker} … `);
  try {
    const rawData = await getStockData(ticker);
    const saved = await gradeAndSave(ticker, rawData);
    console.log(`${saved.grade}  ($${rawData.price?.toFixed(2)} ${rawData.currency})`);
  } catch (err) {
    console.log(`SKIPPED — ${err.message}`);
  }
}

async function main() {
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is missing from .env');
    process.exit(1);
  }

  console.log(`Connecting to MongoDB …`);
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Connected.\n`);

  console.log(`Seeding ${TICKERS_TO_SEED.length} tickers:`);
  // Run sequentially with a delay between tickers to stay under Finnhub's
  // 60-calls-per-minute free-tier limit (each ticker makes 4 parallel calls).
  for (const ticker of TICKERS_TO_SEED) {
    await seedOne(ticker);
    // 5 s gap — 4 parallel calls per ticker, stays well under 60 calls/min.
    await new Promise((r) => setTimeout(r, 5000));
  }

  console.log(`\nDone. ${TICKERS_TO_SEED.length} tickers attempted.`);

  // New stocks change the industry pools, so rebuild the sector medians.
  const baselines = await refreshSectorBaselines();
  console.log(`\nSector baselines rebuilt for ${baselines.length} industries:`);
  describeBaselines(baselines).forEach((line) => console.log(line));

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
