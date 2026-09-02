// Fetches stock fundamentals from Finnhub and shapes them into the input
// the grading function expects. Exposes getStockData + resolveTicker behind a
// thin provider interface, so the routes and tests don't depend on the source.
//
// Endpoints used:
//   /quote                          — current share price
//   /stock/profile2                 — company name and currency
//   /stock/financials-reported (annual)   — full-year revenue + FCF from 10-K filings
//   /stock/financials-reported (quarterly)— YTD figures used to compute TTM
//   /search                         — resolves company names to canonical tickers
//
// Why two financials calls?
//   10-Q quarterly filings report *cumulative YTD* figures, not single-quarter.
//   Summing the four quarterly rows would overcount. 10-K annual filings are
//   already full-year totals, so we use those for the annual arrays.
//   TTM uses the standard formula:
//     TTM = CurrentYTD + (PriorYearAnnual − SamePeriodPriorYearYTD)

const BASE_URL = 'https://finnhub.io/api/v1';

// How many recent annual periods to grade on. Finnhub returns wildly different
// history lengths per stock (Apple ~16 years, Alphabet ~11), so we cap to the
// most recent N years. This makes "long-term growth" mean the same span for
// every stock instead of comparing a 15-year trend against a 5-year one.
const ANNUAL_LOOKBACK_YEARS = 5;

// Finnhub's financials-reported endpoint maps a ticker to whichever SEC filer
// (CIK) currently or historically held that symbol. For a few tickers that map
// is stale — it points at a defunct filer instead of the live company:
//   GOOG  -> "Google Inc." (frozen at 2015); Alphabet now files under GOOGL.
// We fetch fundamentals under the corrected symbol while still using the
// original ticker for the live price and profile (same underlying company).
const FINANCIALS_SYMBOL_ALIASES = {
  GOOG: 'GOOGL',
};

// Finnhub's search indexes companies by their legal name, so the everyday name
// people type doesn't match (searching "Google" returns nothing — it's listed
// as "Alphabet"; "Facebook" is listed as "Meta"). Map those common names
// straight to the canonical ticker so a name search still works.
const NAME_ALIASES = {
  GOOGLE: 'GOOGL',
  FACEBOOK: 'META',
  SNAPCHAT: 'SNAP',
  MCDONALDS: 'MCD',
};

// Finnhub XBRL concepts vary by company: some file with a "us-gaap_" prefix
// (e.g. Apple), others use bare names (e.g. Alphabet/Google). List both forms
// so the same code works across different filers.
const REVENUE_CONCEPTS = [
  'us-gaap_RevenueFromContractWithCustomerExcludingAssessedTax',
  'RevenueFromContractWithCustomerExcludingAssessedTax',
  'us-gaap_Revenues',
  'Revenues',
  'us-gaap_SalesRevenueNet',
  'SalesRevenueNet',
  'us-gaap_NetRevenues',
  'NetRevenues',
  'us-gaap_RevenuesNetOfInterestExpense',
  'RevenuesNetOfInterestExpense',
  // Regulated utilities (e.g. Duke Energy) report no standard revenue line at
  // all — only this consolidated operating-revenue concept. Without it their
  // recent filings parse as "no revenue", which made the whole company look
  // like it stopped reporting years ago.
  'us-gaap_RegulatedAndUnregulatedOperatingRevenue',
  'RegulatedAndUnregulatedOperatingRevenue',
];

// Fallback revenue concept. Used ONLY when none of the standard net-revenue
// concepts above are present (e.g. refiners like Valero, and Kraft Heinz, which
// report revenue solely under the "including assessed tax" tag). It is kept
// separate so companies that report BOTH a net line and this gross line (e.g.
// tobacco, where the gross figure includes large pass-through excise taxes)
// still grade on the more accurate net revenue.
const REVENUE_FALLBACK_CONCEPTS = [
  'us-gaap_RevenueFromContractWithCustomerIncludingAssessedTax',
  'RevenueFromContractWithCustomerIncludingAssessedTax',
];

const OCF_CONCEPTS = [
  'us-gaap_NetCashProvidedByUsedInOperatingActivities',
  'NetCashProvidedByUsedInOperatingActivities',
  // Some filers (e.g. Disney) report operating cash flow under the
  // "continuing operations" variant in years with discontinued segments.
  'us-gaap_NetCashProvidedByUsedInOperatingActivitiesContinuingOperations',
  'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations',
];

// Capital expenditure concepts. Finnhub reports the payment as a positive
// number (the outflow magnitude), so free cash flow subtracts it:
//   FCF = OCF - |CapEx|
// Using the absolute value keeps it correct even if a filer signs CapEx
// negative instead.
const CAPEX_CONCEPTS = [
  'us-gaap_PaymentsToAcquirePropertyPlantAndEquipment',
  'PaymentsToAcquirePropertyPlantAndEquipment',
  'us-gaap_PaymentsToAcquireProductiveAssets',   // NVIDIA and similar
  'PaymentsToAcquireProductiveAssets',
  'us-gaap_PaymentsToAcquireOtherPropertyPlantAndEquipment',  // Eli Lilly
  'PaymentsToAcquireOtherPropertyPlantAndEquipment',
  'us-gaap_PaymentsToAcquireOtherProductiveAssets',           // Verizon
  'PaymentsToAcquireOtherProductiveAssets',
  'us-gaap_PaymentsForCapitalImprovements',                   // REITs (e.g. Realty Income)
  'PaymentsForCapitalImprovements',
  'us-gaap_PaymentsToAcquireMachineryAndEquipment',           // Dow and other chemicals
  'PaymentsToAcquireMachineryAndEquipment',
  'us-gaap_CapitalExpendituresIncurringObligation',
  'CapitalExpendituresIncurringObligation',
  'us-gaap_PurchaseOfPropertyPlantAndEquipment',
  'PurchaseOfPropertyPlantAndEquipment',
];

// Return the first matching XBRL concept value from an array of { concept, value } items.
// Used for cash-flow lines, where filers report a single relevant figure.
function findValue(items, ...concepts) {
  for (const concept of concepts) {
    const found = items.find((i) => i.concept === concept);
    if (found && typeof found.value === 'number') return found.value;
  }
  return null;
}

// Return the LARGEST value across every matching concept. Used for revenue:
// some filers (e.g. Pfizer) report a small sub-line under one revenue concept
// and the consolidated total under another, so picking by priority order can
// grab the wrong one. Total revenue is always >= any component line, so the
// maximum is the reliable choice.
function findMaxValue(items, ...concepts) {
  let max = null;
  for (const concept of concepts) {
    for (const item of items) {
      if (item.concept === concept && typeof item.value === 'number') {
        if (max === null || item.value > max) max = item.value;
      }
    }
  }
  return max;
}

// Pick a company's total revenue. Prefers the standard net-revenue concepts
// (largest wins, to skip sub-lines); only if none are present does it fall back
// to the gross "including assessed tax" concept. See REVENUE_FALLBACK_CONCEPTS.
function findRevenue(items) {
  const net = findMaxValue(items, ...REVENUE_CONCEPTS);
  if (net !== null) return net;
  return findMaxValue(items, ...REVENUE_FALLBACK_CONCEPTS);
}

// Make an authenticated GET request to Finnhub. Throws on non-2xx responses.
async function finnhubGet(path, params = {}) {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new Error('FINNHUB_API_KEY is not set in environment');

  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set('token', key);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15000) });
  if (!res.ok) {
    // Expose the status so callers can tell "no access to this symbol" (403 —
    // e.g. a non-US listing outside our plan) from a transient outage.
    const err = new Error(`Finnhub returned ${res.status} for ${path}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// Parse 10-K annual reports into { year, revenue, fcf } objects, sorted oldest → newest.
// Annual filings are full-year totals — no YTD de-cumulation needed.
//
// Some companies file a *combined* 10-K covering the parent plus its subsidiary
// registrants (common for utilities: Duke, AEP, Southern, Dominion). Finnhub
// returns one report per registrant, so the same year arrives several times.
// Keeping them all made "5 annual values" really mean 5 rows of one year, so
// long-term growth compared a year against itself and always failed. We keep
// one report per year — the largest revenue, which is the parent's consolidated
// figure — and take its cash-flow numbers too, so revenue and free cash flow
// always come from the same filing.
function parseAnnualReports(reports) {
  const bestByYear = new Map();

  for (const report of reports) {
    const ic = report.report?.ic ?? [];
    const cf = report.report?.cf ?? [];

    const revenue = findRevenue(ic);
    if (revenue === null) continue;

    const ocf   = findValue(cf, ...OCF_CONCEPTS);
    const capex = findValue(cf, ...CAPEX_CONCEPTS);
    const fcf   = ocf !== null && capex !== null ? ocf - Math.abs(capex) : null;

    const existing = bestByYear.get(report.year);
    if (!existing || revenue > existing.revenue) {
      bestByYear.set(report.year, {
        year: report.year,
        endDate: report.endDate ?? null,
        revenue,
        fcf
      });
    }
  }

  return [...bestByYear.values()].sort((a, b) => a.year - b.year);
}

// Parse 10-Q quarterly reports into { year, quarter, revenue, fcf } objects.
// Values here are cumulative YTD — used only for TTM calculation.
function parseQuarterlyYTD(reports) {
  const quarters = [];
  for (const report of reports) {
    const ic = report.report?.ic ?? [];
    const cf = report.report?.cf ?? [];

    const revenue = findRevenue(ic);
    const ocf     = findValue(cf, ...OCF_CONCEPTS);
    const capex   = findValue(cf, ...CAPEX_CONCEPTS);
    const fcf     = ocf !== null && capex !== null ? ocf - Math.abs(capex) : null;

    if (revenue !== null) {
      quarters.push({ year: report.year, quarter: report.quarter, revenue, fcf });
    }
  }
  return quarters.sort((a, b) => a.year - b.year || a.quarter - b.quarter);
}

// Compute TTM for a given field using the standard formula:
//   TTM = CurrentYTD + (PriorYearAnnual − SamePeriodPriorYearYTD)
//
// Example: most recent 10-Q is Q2 FY2026 (Jan–Jun 2026 YTD).
//   TTM = H1_2026 + (Full_Year_2025 − H1_2025)
//       = Jul_2025_to_Jun_2026  ✓
function computeTTM(annuals, quartersYTD, field) {
  if (quartersYTD.length === 0 || annuals.length === 0) return null;

  // Use the most recent quarterly filing.
  const latest     = quartersYTD[quartersYTD.length - 1];
  const currentYTD = latest[field];
  if (currentYTD === null) return null;

  // Find the prior year's annual total.
  const priorAnnual = annuals.find((a) => a.year === latest.year - 1);
  if (!priorAnnual || priorAnnual[field] === null) return null;

  // Find the same YTD period for the prior year (same quarter number).
  const priorYTD = quartersYTD.find(
    (q) => q.year === latest.year - 1 && q.quarter === latest.quarter
  );
  if (!priorYTD || priorYTD[field] === null) return null;

  return currentYTD + (priorAnnual[field] - priorYTD[field]);
}

async function getStockData(ticker) {
  // Price and profile use the ticker as-is; fundamentals use the corrected
  // symbol when the ticker maps to a stale SEC filer (see the alias map above).
  const finSymbol = FINANCIALS_SYMBOL_ALIASES[ticker] || ticker;

  // Four requests fire in parallel to keep latency low.
  const [quote, profile, annualFin, quarterlyFin] = await Promise.all([
    finnhubGet('/quote',                     { symbol: ticker }),
    finnhubGet('/stock/profile2',            { symbol: ticker }),
    finnhubGet('/stock/financials-reported', { symbol: finSymbol, freq: 'annual' }),
    finnhubGet('/stock/financials-reported', { symbol: finSymbol, freq: 'quarterly' }),
  ]);

  // An empty profile means the provider doesn't recognise this ticker.
  if (!profile || !profile.name) {
    throw new Error(`No data available for "${ticker}".`);
  }

  // Full history is kept for the TTM calculation (it needs the prior year),
  // but the graded arrays are capped to the most recent few years.
  const annualData    = parseAnnualReports(annualFin.data ?? []);
  const quarterlyData = parseQuarterlyYTD(quarterlyFin.data ?? []);
  const recentAnnual  = annualData.slice(-ANNUAL_LOOKBACK_YEARS);

  const annualRevenues      = recentAnnual.map((a) => a.revenue);
  const annualFreeCashFlows = recentAnnual.filter((a) => a.fcf !== null).map((a) => a.fcf);

  const ttmRevenue      = computeTTM(annualData, quarterlyData, 'revenue');
  const ttmFreeCashFlow = computeTTM(annualData, quarterlyData, 'fcf');

  // The most recent annual report's year and period-end date. The grader uses
  // these to detect stale data (a ticker whose fundamentals belong to a defunct
  // filer, or that Finnhub simply hasn't refreshed). The end date is preferred
  // for precision; the year is a fallback.
  const latestAnnual = annualData.length ? annualData[annualData.length - 1] : null;
  const latestAnnualYear = latestAnnual ? latestAnnual.year : null;
  const latestAnnualEndDate = latestAnnual ? latestAnnual.endDate : null;

  // quote.c is the current price; 0 means no data, so treat it as null.
  const price    = typeof quote.c === 'number' && quote.c > 0 ? quote.c : null;
  const currency = profile.currency || null;
  const longName = profile.name    || null;
  // Finnhub's industry label (e.g. "Real Estate", "Insurance"). The grader uses
  // it to add a caveat when revenue/FCF is only a rough proxy for the sector.
  const industry = profile.finnhubIndustry || null;

  return {
    annualRevenues,
    ttmRevenue,
    annualFreeCashFlows,
    ttmFreeCashFlow,
    latestAnnualYear,
    latestAnnualEndDate,
    industry,
    longName,
    price,
    currency,
  };
}

// Resolve a user query (company name or partial ticker) to { symbol, name }.
// Returns null when no common-stock match is found.
// A U.S.-listed symbol is plain letters, optionally with a single-letter share
// class (AAPL, NKE, BRK.A). Foreign listings carry a 2+ letter exchange suffix
// or digits (NIKE.WA, VISA.RO, 402340.KS). The Finnhub free tier only covers
// U.S. stocks, so a foreign symbol would 403 when we try to grade it.
function isUsListing(symbol) {
  return /^[A-Z]+(\.[A-Z])?$/.test(symbol);
}

// Pick the best symbol from Finnhub /search results. Finnhub mixes foreign
// listings in (and often returns them first — e.g. "Nike" lists NIKE.WA before
// NKE), so prefer the first U.S.-listed common stock, falling back to the first
// common stock when none look U.S.-listed. Returns null when there's no match.
// Exported for unit testing.
function pickResolvedSymbol(results) {
  const stocks = (results || []).filter((r) => r.type === 'Common Stock');
  if (stocks.length === 0) return null;
  const match = stocks.find((r) => isUsListing(r.symbol)) || stocks[0];
  return { symbol: match.symbol, name: match.description || null };
}

async function resolveTicker(query) {
  // Common-name shortcut: "Google" → GOOGL, "Facebook" → META, etc. These don't
  // match Finnhub's search (it indexes the legal name), so resolve them
  // directly. The real company name gets filled in later from the profile.
  const alias = NAME_ALIASES[query.trim().toUpperCase()];
  if (alias) return { symbol: alias, name: null };

  const data = await finnhubGet('/search', { q: query });
  return pickResolvedSymbol(data.result);
}

module.exports = { getStockData, resolveTicker, pickResolvedSymbol, parseAnnualReports };
