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
  }
}, { timestamps: true }); // createdAt = "added to watchlist at"

// Prevent the same user from adding the same ticker twice.
watchlistItemSchema.index({ userId: 1, ticker: 1 }, { unique: true });

module.exports = mongoose.model('WatchlistItem', watchlistItemSchema);
