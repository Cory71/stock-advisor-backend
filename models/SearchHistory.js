// SearchHistory model
// Records every grade lookup so the Home page can show each user's
// last 20 tickers. One row per lookup (duplicates allowed — the user
// may grade the same ticker many times).

const mongoose = require('mongoose');

const searchHistorySchema = new mongoose.Schema({
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
}, { timestamps: true }); // createdAt = "searched at"

module.exports = mongoose.model('SearchHistory', searchHistorySchema);
