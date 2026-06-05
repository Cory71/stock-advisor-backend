// Entry point for the StockGrader Express API.
// The Express app is built and exported so tests can require it without
// starting a real HTTP server or connecting to the production database.
// Real start-up (listen + Mongo connect) only happens when this file is
// run directly with `node server.js`.

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config();

// Configure passport-jwt before any route imports so the strategy is registered.
const passport = require('./middleware/passport');

const app = express();

// Middleware
// CORS: in production, lock the allowlist down to the deployed frontend(s)
// via the CORS_ORIGIN env var (comma-separated for multiple). In local dev
// (no env var set) we allow any origin so localhost ports work without setup.
const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim())
  : true;
app.use(cors({ origin: corsOrigin }));
app.use(express.json());
app.use(passport.initialize());

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/watchlist', require('./routes/watchlist'));
app.use('/api/grade', require('./routes/grade'));
app.use('/api/history', require('./routes/history'));
app.use('/api/compare', require('./routes/compare'));

// Health check — proves the server is alive
app.get('/', (req, res) => {
  res.json({ message: 'Server is running' });
});

// Only connect to Mongo + start listening when run directly. When this file
// is `require()`d from a test, we skip both — the test sets up its own
// in-memory database and uses supertest instead of a real network port.
if (require.main === module) {
  mongoose
    .connect(process.env.MONGO_URI)
    .then(() => console.log('MongoDB connected'))
    .catch((err) => console.error('MongoDB connection error:', err));

  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;
