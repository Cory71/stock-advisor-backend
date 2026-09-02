// Unit tests for the Finnhub provider's name-alias shortcut in resolveTicker.
// Some companies are widely known by a name that doesn't match Finnhub's search
// index, which lists the legal name — "Google" is "Alphabet", "Facebook" is
// "Meta". The alias path returns before any network call, so these tests are
// fully offline and deterministic.

const { expect } = require('chai');
const { resolveTicker, pickResolvedSymbol } = require('../../providers/finnhubProvider');

describe('finnhubProvider.resolveTicker — name aliases', () => {
  it('maps "Google" to GOOGL (Finnhub lists it as Alphabet)', async () => {
    const result = await resolveTicker('Google');
    expect(result).to.deep.equal({ symbol: 'GOOGL', name: null });
  });

  it('maps "Facebook" to META (Finnhub lists it as Meta)', async () => {
    const result = await resolveTicker('Facebook');
    expect(result).to.deep.equal({ symbol: 'META', name: null });
  });

  it('maps "Snapchat" to SNAP and "McDonalds" to MCD', async () => {
    expect((await resolveTicker('Snapchat')).symbol).to.equal('SNAP');
    expect((await resolveTicker('McDonalds')).symbol).to.equal('MCD');
  });

  it('is case-insensitive and ignores surrounding whitespace', async () => {
    const result = await resolveTicker('  google  ');
    expect(result.symbol).to.equal('GOOGL');
  });
});

describe('finnhubProvider.pickResolvedSymbol — prefers U.S. listings', () => {
  it('skips a foreign listing for the U.S. one (Nike: NIKE.WA → NKE)', () => {
    const results = [
      { symbol: 'NIKE.WA', type: 'Common Stock', description: 'NIKE INC -CL B' },
      { symbol: 'NKE', type: 'Common Stock', description: 'Nike Inc' }
    ];
    expect(pickResolvedSymbol(results).symbol).to.equal('NKE');
  });

  it('keeps a U.S. single-letter share class (Berkshire: BRK.A)', () => {
    const results = [
      { symbol: 'BRK.A', type: 'Common Stock', description: 'Berkshire Hathaway' },
      { symbol: 'BKSH', type: 'Common Stock', description: 'Something else' }
    ];
    expect(pickResolvedSymbol(results).symbol).to.equal('BRK.A');
  });

  it('finds the U.S. listing further down the list (Visa: V)', () => {
    const results = [
      { symbol: 'VISA.TO', type: 'Canadian DR', description: 'Visa Inc' },
      { symbol: 'VISA.RO', type: 'Common Stock', description: 'Visa Inc' },
      { symbol: 'V', type: 'Common Stock', description: 'Visa Inc' }
    ];
    expect(pickResolvedSymbol(results).symbol).to.equal('V');
  });

  it('falls back to the first common stock when none look U.S.-listed', () => {
    const results = [
      { symbol: '402340.KS', type: 'Common Stock', description: 'SK Square Co Ltd' }
    ];
    expect(pickResolvedSymbol(results).symbol).to.equal('402340.KS');
  });

  it('returns null when there is no common stock', () => {
    expect(pickResolvedSymbol([])).to.equal(null);
    expect(pickResolvedSymbol([{ symbol: 'X.L', type: 'ETP' }])).to.equal(null);
  });
});

// --- Annual report parsing -------------------------------------------------
// Two bugs found while re-grading Duke Energy (DUK), which returned five
// identical revenue values and a "latest annual" of 2016 despite Finnhub
// carrying a 2025 10-K:
//   1. Regulated utilities report revenue under concepts the list didn't cover.
//   2. Companies filing a combined 10-K (parent + subsidiary registrants) get
//      one Finnhub report per registrant, so the same year appeared many times.
const { parseAnnualReports } = require('../../providers/finnhubProvider');

// Build a minimal Finnhub-shaped annual report.
function makeReport(year, incomeLines, cashFlowLines = []) {
  return {
    year,
    endDate: `${year}-12-31 00:00:00`,
    report: { ic: incomeLines, cf: cashFlowLines }
  };
}

// Standard operating cash flow + capex lines, so fcf = ocf - |capex|.
function cashFlow(ocf, capex) {
  return [
    { concept: 'us-gaap_NetCashProvidedByUsedInOperatingActivities', value: ocf },
    { concept: 'us-gaap_PaymentsToAcquirePropertyPlantAndEquipment', value: capex }
  ];
}

describe('parseAnnualReports — regulated utility revenue concepts', () => {
  it('reads revenue from RegulatedAndUnregulatedOperatingRevenue (Duke Energy)', () => {
    const reports = [
      makeReport(2025, [
        { concept: 'us-gaap_RegulatedOperatingRevenueElectricNonNuclear', value: 29_060_000_000 },
        { concept: 'us-gaap_RegulatedOperatingRevenueGas',               value:  2_870_000_000 },
        { concept: 'us-gaap_UnregulatedOperatingRevenue',                value:    310_000_000 },
        { concept: 'us-gaap_RegulatedAndUnregulatedOperatingRevenue',    value: 32_240_000_000 }
      ])
    ];
    const parsed = parseAnnualReports(reports);
    expect(parsed).to.have.lengthOf(1);
    // The consolidated total, not one of the component lines.
    expect(parsed[0].revenue).to.equal(32_240_000_000);
  });

  it('still ignores a utility year that reports no revenue at all', () => {
    const reports = [makeReport(2025, [{ concept: 'us-gaap_SomethingElse', value: 1 }])];
    expect(parseAnnualReports(reports)).to.have.lengthOf(0);
  });
});

describe('parseAnnualReports — combined filings (one report per registrant)', () => {
  it('collapses duplicate years into a single entry', () => {
    const reports = [
      makeReport(2024, [{ concept: 'us-gaap_Revenues', value: 30_000_000_000 }]),  // parent
      makeReport(2024, [{ concept: 'us-gaap_Revenues', value:  9_000_000_000 }]),  // subsidiary
      makeReport(2024, [{ concept: 'us-gaap_Revenues', value:  4_000_000_000 }]),  // subsidiary
      makeReport(2023, [{ concept: 'us-gaap_Revenues', value: 28_000_000_000 }])
    ];
    const parsed = parseAnnualReports(reports);
    expect(parsed.map((a) => a.year)).to.deep.equal([2023, 2024]);
  });

  it('keeps the parent (largest) revenue for a duplicated year', () => {
    const reports = [
      makeReport(2024, [{ concept: 'us-gaap_Revenues', value:  9_000_000_000 }]),
      makeReport(2024, [{ concept: 'us-gaap_Revenues', value: 30_000_000_000 }]),
      makeReport(2024, [{ concept: 'us-gaap_Revenues', value:  4_000_000_000 }])
    ];
    expect(parseAnnualReports(reports)[0].revenue).to.equal(30_000_000_000);
  });

  it('takes free cash flow from the same report the revenue came from', () => {
    const reports = [
      // Subsidiary: smaller revenue, distinctive FCF that must NOT be picked.
      makeReport(2024, [{ concept: 'us-gaap_Revenues', value: 9_000_000_000 }], cashFlow(999, 0)),
      // Parent: largest revenue — its FCF is the one that should survive.
      makeReport(2024, [{ concept: 'us-gaap_Revenues', value: 30_000_000_000 }], cashFlow(5_000, 1_000))
    ];
    const parsed = parseAnnualReports(reports);
    expect(parsed[0].revenue).to.equal(30_000_000_000);
    expect(parsed[0].fcf).to.equal(4_000);   // 5000 - |1000|, from the parent report
  });

  it('leaves single-report years untouched (Apple, Exxon and similar)', () => {
    const reports = [
      makeReport(2023, [{ concept: 'us-gaap_Revenues', value: 380_000_000_000 }], cashFlow(110_000, 10_000)),
      makeReport(2024, [{ concept: 'us-gaap_Revenues', value: 391_000_000_000 }], cashFlow(120_000, 9_000)),
    ];
    const parsed = parseAnnualReports(reports);
    expect(parsed.map((a) => a.revenue)).to.deep.equal([380_000_000_000, 391_000_000_000]);
    expect(parsed[1].fcf).to.equal(111_000);
  });
});

// --- Per-company capital expenditure ------------------------------------
// A few filers report no consolidated capex line, only segment lines under
// their own XBRL prefix. NextEra splits it between Florida Power & Light and
// its clean-energy arm; using only one of them roughly halves the total and
// flips free cash flow from negative to positive.
const { findCapex } = require('../../providers/finnhubProvider');

const NEE_FPL  = 'nee_CapitalExpendituresOfFPL';
const NEE_NEER = 'nee_IndependentPowerInvestments';
const NEE_OTHER = 'nee_OtherCapitalExpenditures';

describe('findCapex — per-company segment capex', () => {
  it('sums NextEra\'s segment lines into one total', () => {
    const cf = [
      { concept: NEE_FPL,   value:  8_720_000_000 },
      { concept: NEE_NEER,  value: 15_330_000_000 },
      { concept: NEE_OTHER, value:              0 },
    ];
    expect(findCapex(cf, 'NEE')).to.equal(24_050_000_000);
  });

  it('returns null when a required segment is missing (NextEra 2021)', () => {
    // The 2021 filing has no FPL line. Adding up what remains would understate
    // capex by ~$9B and invent an improving free-cash-flow trend.
    const cf = [
      { concept: NEE_NEER,  value: 8_250_000_000 },
      { concept: NEE_OTHER, value:   150_000_000 },
    ];
    expect(findCapex(cf, 'NEE')).to.equal(null);
  });

  it('ignores the duplicate label NextEra reports for the same money', () => {
    // nee_CapitalExpendituresOfPublicUtility repeats the FPL figure. It is not
    // in `parts`, so it must not be added a second time.
    const cf = [
      { concept: NEE_FPL,  value:  8_720_000_000 },
      { concept: NEE_NEER, value: 15_330_000_000 },
      { concept: 'nee_CapitalExpendituresOfPublicUtility', value: 8_720_000_000 },
    ];
    expect(findCapex(cf, 'NEE')).to.equal(24_050_000_000);
  });

  it('prefers a standard concept when the filer reports one', () => {
    const cf = [
      { concept: 'us-gaap_PaymentsToAcquirePropertyPlantAndEquipment', value: 5_000 },
      { concept: NEE_FPL,  value: 999 },
      { concept: NEE_NEER, value: 999 },
    ];
    expect(findCapex(cf, 'NEE')).to.equal(5_000);
  });

  it('returns null for a company with no rule and no standard concept', () => {
    expect(findCapex([{ concept: 'foo_Something', value: 1 }], 'AAPL')).to.equal(null);
    expect(findCapex([{ concept: 'foo_Something', value: 1 }], null)).to.equal(null);
  });
});

// --- Lookback window ------------------------------------------------------
// The cap exists so "long-term growth" spans the same number of years for every
// stock. Taking the last N entries breaks that when a year is missing, which
// happens whenever a filing's revenue concept can't be matched.
const { withinLookback } = require('../../providers/finnhubProvider');

const yearsOf = (rows) => rows.map((r) => r.year);
const annuals = (years) => years.map((year) => ({ year, revenue: 1, fcf: 1 }));

describe('withinLookback', () => {
  it('keeps five consecutive years unchanged', () => {
    expect(yearsOf(withinLookback(annuals([2021, 2022, 2023, 2024, 2025]))))
      .to.deep.equal([2021, 2022, 2023, 2024, 2025]);
  });

  it('keeps only the most recent five calendar years', () => {
    expect(yearsOf(withinLookback(annuals([2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]))))
      .to.deep.equal([2021, 2022, 2023, 2024, 2025]);
  });

  // Coupa parses to 2012, 2013, 2022, 2024, 2025. Taking the last five entries
  // spans thirteen years, so its long-term growth compared 2012 with 2025.
  it('drops years far outside the window even when that leaves fewer rows', () => {
    expect(yearsOf(withinLookback(annuals([2012, 2013, 2022, 2024, 2025]))))
      .to.deep.equal([2022, 2024, 2025]);
  });

  // Duke Energy: 2022 and 2023 are missing, but the rest are inside the window.
  it('keeps a gapped run when every year is still inside the window', () => {
    expect(yearsOf(withinLookback(annuals([2019, 2020, 2021, 2024, 2025]))))
      .to.deep.equal([2021, 2024, 2025]);
  });

  it('handles fewer years than the window and an empty list', () => {
    expect(yearsOf(withinLookback(annuals([2024, 2025])))).to.deep.equal([2024, 2025]);
    expect(withinLookback([])).to.deep.equal([]);
  });
});
