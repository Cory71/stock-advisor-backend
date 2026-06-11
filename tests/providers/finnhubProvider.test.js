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
