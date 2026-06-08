// Stock model
// Shared cache of graded results. The underlying numbers grade the same way for
// everyone, so we cache per-ticker (not per-user). When we re-grade a stock,
// Mongoose's `updatedAt` doubles as the "last graded" timestamp.

const mongoose = require('mongoose');

// Each criterion is one of the 5 yes/no checks in the grading algorithm.
// `passed` can be null when we don't have enough data to judge that criterion
// (e.g. TTM data is missing — the long-term growth checks still work).
const criterionSchema = new mongoose.Schema({
  name:   { type: String, required: true },                       // e.g. "Topline revenue growth"
  passed: { type: Boolean, default: null },                       // yes / no / null = N/A
  value:  { type: Number },                                        // the actual number used
  prior:  { type: Number },                                        // the comparison number
  source: { type: String }                                         // e.g. "income statement"
}, { _id: false }); // sub-docs don't need their own _id

const stockSchema = new mongoose.Schema({
  ticker: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true
  },

  grade: {
    type: String,
    enum: ['A', 'B', 'C', 'D', 'F', 'N/A'],
    required: true
  },

  // Exactly 5 criteria per the grading algorithm.
  criteria: {
    type: [criterionSchema],
    required: true
  },

  // Short explanation shown when a stock can't be graded normally (N/A) — e.g.
  // data too old, or a business type the revenue/FCF model doesn't fit. Optional;
  // only set for N/A results.
  reason: {
    type: String
  },

  // Caveat shown alongside a real grade when free cash flow is only a rough
  // proxy for the sector (e.g. REITs, insurers, utilities). Optional.
  note: {
    type: String
  },

  // Company name as the provider reports it (e.g. "Apple Inc."). Optional —
  // older cached entries from before this field was added won't have it.
  name: {
    type: String
  },

  // Last known share price (from Finnhub's `/quote`). Optional — older cached
  // docs won't have it. Refreshes whenever the stock is regraded.
  price: {
    type: Number
  },

  // ISO currency code the price is quoted in (e.g. "USD", "CAD", "EUR").
  // Finnhub returns this with the company profile — we never convert, just label.
  currency: {
    type: String
  },

  // Raw revenue + free cash flow snapshots from Finnhub, including TTM.
  // Stored as a flexible object so the UI can show the exact numbers used.
  rawData: {
    type: Object
  }
}, { timestamps: true }); // adds createdAt (first graded) + updatedAt (last regraded)

module.exports = mongoose.model('Stock', stockSchema);
