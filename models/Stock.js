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

  // Raw revenue + free cash flow snapshots from Yahoo, including TTM.
  // Stored as a flexible object so the UI can show the exact numbers used.
  rawData: {
    type: Object
  }
}, { timestamps: true }); // adds createdAt (first graded) + updatedAt (last regraded)

module.exports = mongoose.model('Stock', stockSchema);
