# StockGrader — Backend

Express REST API for StockGrader, a web app that grades publicly traded stocks A–F based on five fundamental financial criteria sourced from Yahoo Finance.

## Prerequisites

- Node.js installed
- MongoDB Atlas account and connection string

## Setup

1. Clone the repository
   git clone https://github.com/Cory71/stock-advisor-backend.git

2. Install dependencies
   npm install

3. Create a .env file in the root and add the following:
   PORT=5000
   MONGO_URI=your_mongodb_connection_string
   JWT_SECRET=your_secret_key

4. Start the server
   npm run dev

## API Endpoints

All `/api/*` routes (except `register` and `login`) require a valid JWT in the
`Authorization: Bearer <token>` header.

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/` | Health check |
| POST | `/api/auth/register` | Create a user; returns a signed JWT |
| POST | `/api/auth/login` | Verify email/password; returns a signed JWT |
| GET | `/api/auth/me` | Return the current user |
| GET | `/api/grade/:query` | Grade a stock by ticker **or company name** (resolves names via Yahoo search; caches 24h) |
| GET | `/api/compare?tickers=A,B,C` | Grade 2 or 3 tickers/names in parallel |
| GET | `/api/history` | User's last 20 lookups, enriched with company name |
| GET | `/api/watchlist` | User's watchlist, enriched with name, current grade, last price, currency |
| POST | `/api/watchlist` | Add a ticker/name; freezes current grade as `gradeAtAdd` |
| DELETE | `/api/watchlist/:ticker` | Remove a ticker |

## Data Models

- **`User`** — email, passwordHash (bcrypt), displayName
- **`Stock`** — ticker, name, price, currency, grade, criteria, rawData (shared cache, 24h TTL)
- **`WatchlistItem`** — userId, ticker, gradeAtAdd (compound unique index on user + ticker)
- **`SearchHistory`** — userId, ticker

## Project Layout

```text
backend/
  server.js            # Express app + Mongo connect + route registration
  lib/grading.js       # Pure 5-criteria grading function (unit-tested)
  providers/
    yahooProvider.js   # Yahoo Finance adapter (getStockData, resolveTicker)
  middleware/
    passport.js        # passport-jwt strategy
    authMiddleware.js  # friendly 401 wrapper around passport.authenticate
  models/              # Mongoose schemas
  routes/              # auth, grade, compare, history, watchlist
  tests/               # Mocha + Chai unit tests for grading
```
