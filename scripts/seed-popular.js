// One-off script that pre-caches grades for popular tickers into MongoDB.
//
// Why: Finnhub's free tier allows 60 API calls per minute. Each ticker requires
// 3 parallel calls (quote, profile, financials), so we wait 4 seconds between
// tickers to stay safely under the limit. Pre-caching from your local machine
// writes grades into MongoDB so the deployed backend serves them without a
// live Finnhub call.
//
// Run with: npm run seed
// Or directly: node scripts/seed-popular.js
//
// Safe to re-run — it upserts and refreshes the cache timestamp.

require('dotenv').config();
const mongoose = require('mongoose');
const Stock = require('../models/Stock');
const { gradeStock } = require('../lib/grading');
const { getStockData } = require('../providers/finnhubProvider');

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

async function seedOne(ticker) {
  process.stdout.write(`  ${ticker} … `);
  try {
    const rawData = await getStockData(ticker);
    const graded = gradeStock(rawData);
    await Stock.findOneAndUpdate(
      { ticker },
      {
        ticker,
        name: rawData.longName || null,
        price: rawData.price ?? null,
        currency: rawData.currency ?? null,
        grade: graded.grade,
        criteria: graded.criteria,
        rawData
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    console.log(`${graded.grade}  ($${rawData.price?.toFixed(2)} ${rawData.currency})`);
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

  console.log(`Seeding ${TICKERS.length} tickers:`);
  // Run sequentially with a small delay between calls so we look like a
  // normal user rather than a bot to Yahoo.
  for (const ticker of TICKERS) {
    await seedOne(ticker);
    // 5 s gap — 4 parallel calls per ticker, stays well under 60 calls/min.
    await new Promise((r) => setTimeout(r, 5000));
  }

  console.log(`\nDone. ${TICKERS.length} tickers attempted.`);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
