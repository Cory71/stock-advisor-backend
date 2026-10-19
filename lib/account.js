// Account-level actions: changing a display name, exporting a user's data,
// clearing their history, and deleting their account.
//
// The boundary that matters: a user's own data lives in three collections —
// User, WatchlistItem and SearchHistory. The Stock collection is a cache of
// grades keyed by ticker and shared by everyone, so it is never touched here.
// Deleting "my" AAPL grade would delete it for every other user too.

const User = require('../models/User');
const WatchlistItem = require('../models/WatchlistItem');
const SearchHistory = require('../models/SearchHistory');
const Stock = require('../models/Stock');

const MAX_DISPLAY_NAME_LENGTH = 50;

// Clean up a display name typed by the user. Returns { value } on success —
// value is null when they cleared it, so the navbar falls back to their email —
// or { error } with a message to show.
function cleanDisplayName(raw) {
  if (raw !== undefined && raw !== null && typeof raw !== 'string') {
    return { error: 'Display name must be text.' };
  }
  const trimmed = (raw || '').trim();
  if (trimmed.length > MAX_DISPLAY_NAME_LENGTH) {
    return { error: `Display name must be ${MAX_DISPLAY_NAME_LENGTH} characters or fewer.` };
  }
  return { value: trimmed || null };
}

// True when the email typed to confirm a delete matches the account. Ignores
// case and surrounding spaces, since emails are stored lowercase.
function confirmEmailMatches(typed, accountEmail) {
  if (typeof typed !== 'string' || !accountEmail) return false;
  return typed.trim().toLowerCase() === accountEmail.toLowerCase();
}

// Everything the app stores about one user, as a plain object they can keep.
// Never includes the password hash or Google ID — only whether each sign-in
// method is set up.
async function buildExport(userId, now = new Date()) {
  const user = await User.findById(userId).lean();
  const watchlist = await WatchlistItem.find({ userId }).sort({ createdAt: 1 }).lean();
  const history = await SearchHistory.find({ userId }).sort({ createdAt: -1 }).lean();

  // Today's grade for each watched stock, read from the shared stock cache
  // (one query, no new data fetched), so the export can show what changed.
  const stocks = await Stock.find({ ticker: { $in: watchlist.map((i) => i.ticker) } })
    .select('ticker grade')
    .lean();
  const currentGrade = new Map(stocks.map((s) => [s.ticker, s.grade]));

  return {
    exportedAt: now.toISOString(),
    account: {
      email: user.email,
      displayName: user.displayName || null,
      createdAt: user.createdAt,
      signInMethods: {
        password: Boolean(user.passwordHash),
        google: Boolean(user.googleId),
      },
    },
    watchlist: watchlist.map((item) => ({
      ticker: item.ticker,
      gradeWhenAdded: item.gradeAtAdd ?? null,
      currentGrade: currentGrade.get(item.ticker) ?? null,
      addedAt: item.createdAt,
    })),
    searchHistory: history.map((row) => ({
      ticker: row.ticker,
      searchedAt: row.createdAt,
    })),
  };
}

// Remove a user's search history. Returns how many rows were removed.
async function clearHistory(userId) {
  const result = await SearchHistory.deleteMany({ userId });
  return result.deletedCount;
}

// Permanently remove a user and everything that belongs only to them.
// The user document goes last, so if anything fails part-way the account still
// exists and the person can simply try again.
async function deleteAccount(userId) {
  const watchlist = await WatchlistItem.deleteMany({ userId });
  const history = await SearchHistory.deleteMany({ userId });
  await User.deleteOne({ _id: userId });
  return { watchlistRows: watchlist.deletedCount, historyRows: history.deletedCount };
}

module.exports = {
  cleanDisplayName, confirmEmailMatches, buildExport, clearHistory, deleteAccount,
  MAX_DISPLAY_NAME_LENGTH,
};
