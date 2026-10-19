// SectorBaseline model
// One document per industry: the median of each compared metric across the
// graded stocks in that industry, and how many stocks each median came from.
// Rebuilt by lib/sectorBaselines.js after every seed and daily refresh.

const mongoose = require('mongoose');

// One metric's median and the number of stocks behind it. Null when no stock
// in the industry has a usable value for that metric.
const metricSchema = new mongoose.Schema({
  median: { type: Number, required: true },  // e.g. 0.12 = 12%
  peers:  { type: Number, required: true }   // stocks the median came from
}, { _id: false });

const sectorBaselineSchema = new mongoose.Schema({
  industry:  { type: String, required: true, unique: true },  // Finnhub label
  peerCount: { type: Number, required: true },                // graded stocks in the industry
  metrics: {
    revenueCagr: { type: metricSchema, default: null },  // revenue growth per year
    fcfMargin:   { type: metricSchema, default: null },  // free cash flow / revenue
    fcfCagr:     { type: metricSchema, default: null }   // free cash flow growth per year
  },
  computedAt: { type: Date, required: true }
});

module.exports = mongoose.model('SectorBaseline', sectorBaselineSchema);
