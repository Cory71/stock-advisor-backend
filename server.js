// Entry point for the StockGrader Express API.
// Real routes (auth, grade, watchlist) get added in Week 2.
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
// app.use('/api/auth', require('./routes/auth'));

// Health check — proves the server is alive
app.get('/', (req, res) => {
  res.json({ message: 'Server is running' });
});

// Database connection
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch((err) => console.error('MongoDB connection error:', err));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
