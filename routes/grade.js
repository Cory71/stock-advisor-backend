// GET /api/grade/:ticker
// Returns the A-F grade for a ticker, with the 5-criteria breakdown and the
// raw numbers used. Caches results in MongoDB for 24 hours so repeated lookups
// don't hammer Yahoo. Also records the lookup in the user's search history.

const express = require('express');
const verifyToken = require('../middleware/authMiddleware');
const Stock = require('../models/Stock');
const SearchHistory = require('../models/SearchHistory');
const { gradeStock } = require('../lib/grading');
const { getStockData } = require('../providers/yahooProvider');

const router = express.Router();

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

router.get('/:ticker', verifyToken, async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();

    // Record this lookup in the user's history (fire and forget).
    SearchHistory.create({ userId: req.user.id, ticker }).catch((err) => {
      console.error('Failed to record search history:', err.message);
    });

    // Try the cache first.
    const cached = await Stock.findOne({ ticker });
    const isFresh = cached && Date.now() - cached.updatedAt.getTime() < CACHE_TTL_MS;

    if (isFresh) {
      return res.json({
        ticker: cached.ticker,
        grade: cached.grade,
        criteria: cached.criteria,
        rawData: cached.rawData,
        gradedAt: cached.updatedAt,
        cached: true
      });
    }

    // Cache miss or stale — fetch from Yahoo and grade.
    const rawData = await getStockData(ticker);
    const graded = gradeStock(rawData);

    const saved = await Stock.findOneAndUpdate(
      { ticker },
      { ticker, grade: graded.grade, criteria: graded.criteria, rawData },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({
      ticker: saved.ticker,
      grade: saved.grade,
      criteria: saved.criteria,
      rawData: saved.rawData,
      gradedAt: saved.updatedAt,
      cached: false
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
