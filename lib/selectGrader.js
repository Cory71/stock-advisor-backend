// Decides which grading model a stock gets.
//
// Routing is by Finnhub's industry label from an explicit allowlist — never
// guessed from the shape of the data. A "no free cash flow" rule, for example,
// would also catch a REIT and a biotech, and "Financial Services" would pull in
// Visa and Mastercard, which grade correctly on the general model today.
//
// Widening this list is a deliberate decision: the regression check (every
// currently-graded stock keeps its grade) has to be re-run when it changes.

const BANK_INDUSTRIES = ['Banking'];

// True when a stock should be graded on the bank model.
function isBankIndustry(industry) {
  return BANK_INDUSTRIES.includes(industry);
}

// 'bank' or 'general' for a stock's fetched data.
function selectModel(rawData) {
  return rawData && isBankIndustry(rawData.industry) ? 'bank' : 'general';
}

module.exports = { BANK_INDUSTRIES, isBankIndustry, selectModel };
