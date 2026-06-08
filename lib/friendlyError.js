// Turns a provider/lookup error into a user-facing message, so internal details
// (the data provider's name, raw HTTP codes) never reach the UI. Shared by the
// grade, compare, and watchlist routes so they all fail the same friendly way.

function friendlyStockError(err, symbol) {
  // 403 = the data provider doesn't cover this symbol on our plan — e.g. a
  // non-US listing like a Toronto ".TO" ticker.
  if (err && err.status === 403) {
    return `StockGrader currently only supports U.S.-listed stocks (NYSE and Nasdaq). Data isn't available for "${symbol}".`;
  }
  // Pass through messages we already wrote to be user-friendly.
  if (err && /^Couldn't find a stock for/.test(err.message || '')) {
    return err.message;
  }
  // Anything else (provider quirks, timeouts on a single ticker) gets a safe,
  // generic message rather than leaking the raw error text.
  return `Couldn't find a stock for "${symbol}".`;
}

module.exports = { friendlyStockError };
