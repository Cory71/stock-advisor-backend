// Fetches stock fundamentals from Yahoo Finance and shapes them into the
// input the grading function expects. If yahoo-finance2 ever breaks, we can
// swap this file out for a different provider (e.g. Financial Modeling Prep)
// without touching the grading logic or the route handler.
//
// Notes on the v3 API after Yahoo's Nov-2024 breakage of the old "submodules":
//   - Annual revenue: still works via `quoteSummary → incomeStatementHistory`.
//   - Annual free cash flow: must use `fundamentalsTimeSeries` with the
//     `cash-flow` module. `freeCashFlow` is now a direct field.
//   - TTM numbers: still in the `financialData` module.

const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

// Pull ~6 years of history. Plenty for the long-term growth checks.
const HISTORY_START = '2018-01-01';

async function getStockData(ticker) {
  // Income statement + TTM data come from quoteSummary.
  const summary = await yahooFinance.quoteSummary(ticker, {
    modules: ['incomeStatementHistory', 'financialData']
  });

  // Annual revenues (oldest → newest).
  const incomeRows = (summary.incomeStatementHistory?.incomeStatementHistory ?? [])
    .slice()
    .reverse();
  const annualRevenues = incomeRows
    .map((row) => row.totalRevenue)
    .filter((n) => typeof n === 'number');

  // Annual free cash flow via fundamentalsTimeSeries (oldest → newest).
  const cashflowSeries = await yahooFinance.fundamentalsTimeSeries(ticker, {
    period1: HISTORY_START,
    type: 'annual',
    module: 'cash-flow'
  });
  const annualFreeCashFlows = cashflowSeries
    .filter((row) => typeof row.freeCashFlow === 'number')
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map((row) => row.freeCashFlow);

  // TTM numbers live in financialData.
  const ttmRevenue = typeof summary.financialData?.totalRevenue === 'number'
    ? summary.financialData.totalRevenue
    : null;
  const ttmFreeCashFlow = typeof summary.financialData?.freeCashflow === 'number'
    ? summary.financialData.freeCashflow
    : null;

  return { annualRevenues, ttmRevenue, annualFreeCashFlows, ttmFreeCashFlow };
}

module.exports = { getStockData };
