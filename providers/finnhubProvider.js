// Fetches stock fundamentals from Finnhub and shapes them into the input
// the grading function expects — same exported shape as yahooProvider.js so
// the routes and tests can swap providers without changing business logic.
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
  'us-gaap_CapitalExpendituresIncurringObligation',
  'CapitalExpendituresIncurringObligation',
  'us-gaap_PurchaseOfPropertyPlantAndEquipment',
  'PurchaseOfPropertyPlantAndEquipment',
];

// Return the first matching XBRL concept value from an array of { concept, value } items.
function findValue(items, ...concepts) {
  for (const concept of concepts) {
    const found = items.find((i) => i.concept === concept);
    if (found && typeof found.value === 'number') return found.value;
  }
  return null;
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
  if (!res.ok) throw new Error(`Finnhub returned ${res.status} for ${path}`);
  return res.json();
}

// Parse 10-K annual reports into { year, revenue, fcf } objects, sorted oldest → newest.
// Annual filings are full-year totals — no YTD de-cumulation needed.
function parseAnnualReports(reports) {
  const annuals = [];
  for (const report of reports) {
    const ic = report.report?.ic ?? [];
    const cf = report.report?.cf ?? [];

    const revenue = findValue(ic, ...REVENUE_CONCEPTS);
    const ocf     = findValue(cf, ...OCF_CONCEPTS);
    const capex   = findValue(cf, ...CAPEX_CONCEPTS);
    const fcf     = ocf !== null && capex !== null ? ocf - Math.abs(capex) : null;

    if (revenue !== null) {
      annuals.push({ year: report.year, revenue, fcf });
    }
  }
  return annuals.sort((a, b) => a.year - b.year);
}

// Parse 10-Q quarterly reports into { year, quarter, revenue, fcf } objects.
// Values here are cumulative YTD — used only for TTM calculation.
function parseQuarterlyYTD(reports) {
  const quarters = [];
  for (const report of reports) {
    const ic = report.report?.ic ?? [];
    const cf = report.report?.cf ?? [];

    const revenue = findValue(ic, ...REVENUE_CONCEPTS);
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

  // An empty profile means Finnhub doesn't recognise this ticker.
  if (!profile || !profile.name) {
    throw new Error(`Finnhub has no data for "${ticker}"`);
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

  // The year of the most recent annual report. The grader uses this to detect
  // stale data (a ticker whose fundamentals belong to a defunct filer).
  const latestAnnualYear = annualData.length
    ? annualData[annualData.length - 1].year
    : null;

  // quote.c is the current price; 0 means no data, so treat it as null.
  const price    = typeof quote.c === 'number' && quote.c > 0 ? quote.c : null;
  const currency = profile.currency || null;
  const longName = profile.name    || null;

  return {
    annualRevenues,
    ttmRevenue,
    annualFreeCashFlows,
    ttmFreeCashFlow,
    latestAnnualYear,
    longName,
    price,
    currency,
  };
}

// Resolve a user query (company name or partial ticker) to { symbol, name }.
// Returns null when no common-stock match is found.
async function resolveTicker(query) {
  const data  = await finnhubGet('/search', { q: query });
  const match = data.result?.find((r) => r.type === 'Common Stock');
  if (!match) return null;
  return { symbol: match.symbol, name: match.description || null };
}

module.exports = { getStockData, resolveTicker };
