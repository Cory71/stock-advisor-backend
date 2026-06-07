// Sinon stubs for the Finnhub provider so tests never hit the real API.
// Each spec calls `installStubs(...)` in a beforeEach with whatever responses
// it wants, then `restore()` in afterEach to clean up. This keeps tests fast,
// deterministic, and offline-safe.

const sinon = require('sinon');
const finnhubProvider = require('../../providers/finnhubProvider');

// A reasonable default for happy-path tests — Apple-shaped numbers that
// produce a B grade (passes 4 of 5 criteria).
const DEFAULT_STOCK_DATA = {
  annualRevenues:      [200_000, 250_000, 300_000, 350_000, 400_000],
  ttmRevenue:          420_000,
  annualFreeCashFlows: [80_000, 90_000, 95_000, 100_000, 98_000],
  ttmFreeCashFlow:     95_000,
  longName:            'Apple Inc.',
  price:               310.61,
  currency:            'USD'
};

function installStubs({
  stockData = DEFAULT_STOCK_DATA,
  resolved = { symbol: 'AAPL', name: 'Apple Inc.' },
  stockDataError = null,
  resolvedNull = false
} = {}) {
  const stockDataStub = sinon.stub(finnhubProvider, 'getStockData');
  if (stockDataError) {
    stockDataStub.rejects(stockDataError);
  } else {
    stockDataStub.resolves(stockData);
  }

  const resolveStub = sinon.stub(finnhubProvider, 'resolveTicker');
  if (resolvedNull) {
    resolveStub.resolves(null);
  } else {
    resolveStub.resolves(resolved);
  }

  return { stockDataStub, resolveStub };
}

function restore() {
  sinon.restore();
}

module.exports = { installStubs, restore, DEFAULT_STOCK_DATA };
