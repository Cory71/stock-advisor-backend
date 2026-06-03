// WatchlistItem model
// One row per (user, ticker) pair. A user can save many tickers; same ticker
// can't be added twice for the same user (compound unique index below).

const mongoose = require('mongoose');

const watchlistItemSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  ticker: {
    type: String,
    required: true,
    uppercase: true,
    trim: true
  },

  // Letter grade at the moment the user added this ticker. Frozen — we never
  // overwrite it. The "current" grade comes from the live Stock cache so the
  // UI can show upgrades/downgrades. Optional because rows added before this
  // field existed won't have one.
  gradeAtAdd: {
    type: String
  }
}, { timestamps: true }); // createdAt = "added to watchlist at"

// Prevent the same user from adding the same ticker twice.
watchlistItemSchema.index({ userId: 1, ticker: 1 }, { unique: true });

module.exports = mongoose.model('WatchlistItem', watchlistItemSchema);
