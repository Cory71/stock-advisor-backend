// Watchlist routes — the user's saved tickers.
// All routes here require a valid JWT in the Authorization header.

const express = require('express');
const WatchlistItem = require('../models/WatchlistItem');
const verifyToken = require('../middleware/authMiddleware');

const router = express.Router();

// Every route in this file is protected — apply the middleware once.
router.use(verifyToken);

// GET /api/watchlist
// Returns the current user's saved tickers, newest first.
router.get('/', async (req, res) => {
  try {
    const items = await WatchlistItem
      .find({ userId: req.user.id })
      .sort({ createdAt: -1 });
    res.json(items);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// POST /api/watchlist
// Body: { ticker }
// Adds a ticker to the current user's watchlist.
router.post('/', async (req, res) => {
  try {
    const { ticker } = req.body;

    if (!ticker) {
      return res.status(400).json({ message: 'Ticker is required' });
    }

    const item = await WatchlistItem.create({
      userId: req.user.id,
      ticker
    });

    res.status(201).json(item);
  } catch (err) {
    // The compound unique index on (userId, ticker) throws this code
    // when the user tries to add the same ticker twice.
    if (err.code === 11000) {
      return res
        .status(409)
        .json({ message: 'Ticker is already in your watchlist' });
    }
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// DELETE /api/watchlist/:ticker
// Removes a ticker from the current user's watchlist.
router.delete('/:ticker', async (req, res) => {
  try {
    // Normalise — tickers are stored uppercase.
    const ticker = req.params.ticker.toUpperCase();

    const deleted = await WatchlistItem.findOneAndDelete({
      userId: req.user.id,
      ticker
    });

    if (!deleted) {
      return res
        .status(404)
        .json({ message: 'Ticker not found in your watchlist' });
    }

    res.json({ message: 'Removed', ticker });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
