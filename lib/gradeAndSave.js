// The one place a stock gets graded and written to the cache.
//
// Every path that grades — the grade page, watchlist, compare, the daily
// refresh and the seed script — fetches its data its own way (some fall back to
// a name search), then hands it here. Keeping grade-and-save in one function
// means the choice of grading model lives in exactly one spot, so the bank
// model can't reach some pages and miss others. A test
// (singleGradingPath.test.js) fails if anything else calls a grader directly.

const Stock = require('../models/Stock');
const { gradeStock } = require('./grading');
const { gradeBank } = require('./gradingBank');
const { selectModel } = require('./selectGrader');
const { loadBankMedians } = require('./bankMedians');

// Grade with whichever model the stock's industry calls for.
function gradeWithModel(rawData) {
  const model = selectModel(rawData);
  const graded = model === 'bank'
    ? gradeBank(rawData, loadBankMedians())
    : gradeStock(rawData);
  return { model, graded };
}

// The fields written to a cached Stock document.
function buildStockUpdate(ticker, rawData, model, graded, fallbackName) {
  return {
    ticker,
    name: rawData.longName || fallbackName || null,
    price: rawData.price ?? null,
    currency: rawData.currency ?? null,
    model,
    grade: graded.grade,
    criteria: graded.criteria,
    reason: graded.reason ?? null,
    note: graded.note ?? null,
    rawData
  };
}

// Grade fetched data and save it over the cached copy (creating it if new).
// `fallbackName` is used when the provider returned no company name — e.g. the
// name a search found when the user typed "Apple" instead of "AAPL".
// Returns the saved Stock document.
async function gradeAndSave(ticker, rawData, { fallbackName = null } = {}) {
  const { model, graded } = gradeWithModel(rawData);

  return Stock.findOneAndUpdate(
    { ticker },
    buildStockUpdate(ticker, rawData, model, graded, fallbackName),
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
}

module.exports = { gradeAndSave };
