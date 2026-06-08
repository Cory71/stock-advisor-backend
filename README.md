# StockGrader — Backend

Express REST API for StockGrader, a web app that grades publicly traded stocks A–F based on five fundamental financial criteria sourced from [Finnhub](https://finnhub.io/).

## Live demo

- **API:** <https://stock-advisor-backend-j9gw.onrender.com>
- **Frontend:** <https://stock-advisor-frontend.vercel.app>

> Hosted on Render's free tier — first request after ~15 min of idle may take
> 30–60 seconds to wake the server. After it wakes up it's snappy.

## Prerequisites

- **[Node.js 20](https://nodejs.org/) or newer** (the data provider uses the built-in global `fetch`, stable since Node 18; 20+ is recommended to match the frontend's Vite).
- **[Git](https://git-scm.com/)** for cloning.
- A free **[MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register)** account (5-minute signup, no credit card needed).
- A free **[Finnhub](https://finnhub.io/register)** API key (instant signup, no credit card; free tier allows 60 calls/minute).

To check Node:

```bash
node --version   # should print v20.x.x or higher
```

## Quick start (local development)

> **Order matters:** finish all 7 setup steps here before starting the
> [frontend](https://github.com/Cory71/stock-advisor-frontend). The frontend
> calls this API at `http://localhost:5000` by default.

### 1. Clone the repository

```bash
git clone https://github.com/Cory71/stock-advisor-backend.git
cd stock-advisor-backend
```

### 2. Install dependencies

```bash
npm install
```

### 3. Get a MongoDB connection string

1. Sign up at <https://www.mongodb.com/cloud/atlas/register>.
2. Create a free **M0** cluster (any region is fine; closer = faster).
3. **Database Access** → **Add New Database User** → pick a username + password,
   give the user **Read and write to any database**, click Add.
4. **Network Access** → **Add IP Address** → click **Allow Access from Anywhere**
   (`0.0.0.0/0`). For local dev this is the simplest path; the cluster is still
   protected by your username + password.
5. Back at **Clusters** → **Connect** → **Connect your application** → choose
   **Node.js** → copy the connection string. It looks like:

   ```text
   mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```

6. Replace `<username>` and `<password>` with the ones you created. Append the
   database name (`/stockgrader`) before the `?`:

   ```text
   mongodb+srv://you:yourpassword@cluster0.xxxxx.mongodb.net/stockgrader?retryWrites=true&w=majority
   ```

### 4. Generate a JWT secret

The JWT secret signs auth tokens. It can be any long random string — generate
one with this one-liner:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Copy the output. It looks like a 128-character hex string.

### 5. Get a Finnhub API key

Finnhub provides the stock fundamentals (price, revenue, free cash flow).

1. Sign up at <https://finnhub.io/register> (instant, no credit card).
2. After signing in, your API key is shown on the dashboard. Copy it.

> The free tier allows **60 API calls per minute**, which is plenty for this app
> — each graded stock makes 4 calls, and results are cached for 24 hours.

### 6. Create the `.env` file

Create a file named `.env` in the project root with this content:

```env
PORT=5000
MONGO_URI=mongodb+srv://you:yourpassword@cluster0.xxxxx.mongodb.net/stockgrader?retryWrites=true&w=majority
JWT_SECRET=paste_the_long_hex_string_from_step_4_here
FINNHUB_API_KEY=paste_your_finnhub_key_from_step_5_here

# Optional — skip if you don't want Google sign-in. See "Optional: Google sign-in" below.
# GOOGLE_CLIENT_ID=your-id-here.apps.googleusercontent.com

# Optional — only needed in production. Locks API access to specific frontend domains.
# CORS_ORIGIN=https://your-frontend.vercel.app
```

> The `.env` file is in `.gitignore` so your secrets never reach GitHub.

### 7. Start the server

```bash
npm run dev
```

You should see:

```text
Server running on port 5000
MongoDB connected
```

The API is now live at <http://localhost:5000>. Hit <http://localhost:5000/>
in your browser to see `{"message":"Server is running"}`.

You can now go set up the [frontend](https://github.com/Cory71/stock-advisor-frontend).

## Optional: Google sign-in

If you want the "Sign in with Google" button to work:

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (or reuse one).
3. **APIs & Services** → **OAuth consent screen** → set up for **External**
   users, fill in the basics, save.
4. **APIs & Services** → **Credentials** → **+ Create Credentials** →
   **OAuth client ID** → **Web application**.
5. Under **Authorized JavaScript origins** add `http://localhost:5173`
   (the frontend dev URL).
6. Copy the **Client ID** (looks like `123-abc.apps.googleusercontent.com`),
   paste it into your `.env` as `GOOGLE_CLIENT_ID=...`, and uncomment the line.
7. Restart the server. The frontend also needs `VITE_GOOGLE_CLIENT_ID` set to
   the same value (see frontend README).

Without this set-up, the Google button just hides itself and email/password
sign-in still works.

## Running the tests

```bash
npm test
```

Spins up an in-memory MongoDB (so your real cluster is never touched), stubs
the Finnhub provider, and runs all 65 backend tests in ~5 seconds.

Tests live in `tests/` — 28 unit tests on the pure grading function and 37
Supertest API tests across the 5 routes.

### Warming the cache (optional)

```bash
npm run seed
```

Pre-grades ~10 popular tickers into MongoDB from your local machine. Handy in
production: the deployed backend then serves those grades from cache without a
live Finnhub call. Safe to re-run — it upserts.

## Troubleshooting

| Error you see | Likely cause | Fix |
| --- | --- | --- |
| `MongoServerSelectionError: connection ... refused` | Your IP isn't in Atlas's allowlist | Atlas → Network Access → add your IP, or `0.0.0.0/0` for any |
| `Error: Cannot find module 'express'` | Dependencies didn't install | Run `npm install` again |
| `Error: secretOrPrivateKey must have a value` | `JWT_SECRET` is missing from `.env` | Re-do step 4 |
| Browser shows `Cannot GET /api/grade/AAPL` | You hit the URL directly without auth | This route needs a JWT — sign up via the frontend first |
| `FINNHUB_API_KEY is not set in environment` | The key is missing from `.env` | Re-do step 5, then restart the server |
| Grades come back `N/A` for a well-known stock | Finnhub may lack recent filings, or it's a sector the model doesn't fit (banks, REITs) — the response `reason` explains which | Expected behavior; see [How grading works](#how-grading-works) |
| Port 5000 is already in use | Something else is on that port | Change `PORT=5000` to something free like `PORT=5050` |

## API Endpoints

All `/api/*` routes (except `register` and `login`) require a valid JWT in the
`Authorization: Bearer <token>` header.

| Method | Route | Description |
| --- | --- | --- |
| GET | `/` | Health check |
| POST | `/api/auth/register` | Create a user; returns a signed JWT |
| POST | `/api/auth/login` | Verify email/password; returns a signed JWT |
| POST | `/api/auth/google` | Verify a Google ID token; find-or-create the user and return a signed JWT |
| GET | `/api/auth/me` | Return the current user |
| GET | `/api/grade/:query` | Grade a stock by ticker **or company name** (resolves names via Finnhub search; caches 24h) |
| GET | `/api/compare?tickers=A,B,C` | Grade 2 or 3 tickers/names in parallel |
| GET | `/api/history` | User's last 20 lookups, enriched with company name |
| GET | `/api/watchlist` | User's watchlist, enriched with name, current grade, last price, currency |
| POST | `/api/watchlist` | Add a ticker/name; freezes current grade as `gradeAtAdd` |
| DELETE | `/api/watchlist/:ticker` | Remove a ticker |

## Data Models

- **`User`** — email, passwordHash (bcrypt; optional for Google-only accounts), googleId (sparse-unique), displayName
- **`Stock`** — ticker, name, price, currency, grade, criteria, `reason` (set on N/A), `note` (sector caveat), rawData (shared cache, 24h TTL)
- **`WatchlistItem`** — userId, ticker, gradeAtAdd (compound unique index on user + ticker)
- **`SearchHistory`** — userId, ticker

## Project Layout

```text
backend/
  server.js                # Express app + Mongo connect + route registration
  lib/grading.js           # Pure 5-criteria grading function (unit-tested)
  providers/
    finnhubProvider.js     # Finnhub adapter (getStockData, resolveTicker)
  middleware/
    passport.js            # passport-jwt strategy
    authMiddleware.js      # friendly 401 wrapper around passport.authenticate
  models/                  # Mongoose schemas
  routes/                  # auth, grade, compare, history, watchlist
  scripts/
    seed-popular.js        # warms the cache with ~10 popular tickers (npm run seed)
  tests/
    grading.test.js        # 28 unit tests on the pure grading function
    api/                   # 37 Supertest specs across 5 routes
    helpers/               # in-memory Mongo, JWT helper, Finnhub provider stubs
    setup.js               # mocha --require hook (test env vars)
```

## How grading works

A stock earns one "yes" for each of five criteria, and the count maps to a
letter: **5 = A · 4 = B · 3 = C · 2 = D · 0–1 = F**.

1. **Topline revenue growth (long-term)** — latest annual revenue > earliest
2. **Recent revenue growth (TTM)** — trailing-twelve-month revenue > latest annual
3. **Net positive free cash flow** — most recent FCF > 0
4. **Free cash flow growth (long-term)** — latest annual FCF > earliest
5. **Recent FCF growth (TTM)** — TTM FCF > latest annual

A few details that keep the grades honest:

- **Free cash flow** = operating cash flow − capital expenditure. Finnhub reports
  CapEx as a positive amount, so FCF subtracts its magnitude.
- **Consistent window** — only the most recent 5 annual periods are used, so
  "long-term growth" spans the same range for every stock.
- **TTM** is computed from quarterly (YTD) filings:
  `TTM = current YTD + (prior-year annual − prior-year same-period YTD)`.
- **Freshness guard** — if the most recent annual report is more than ~2 years
  old, the data likely belongs to a defunct filer (e.g. a ticker that changed
  hands), so the stock is returned as **N/A** with an explanatory `reason`.
- **Sector fit** — banks, insurers, and other financial firms have no capital
  expenditure, so free cash flow can't be computed; they return **N/A** with a
  `reason`. REITs, insurers, and utilities that *do* grade carry a `note`
  caveat, because revenue/FCF is only a rough proxy for those business models.
