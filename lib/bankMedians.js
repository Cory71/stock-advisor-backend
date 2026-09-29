// Loads the bank medians that the bank model compares against.
//
// They live in a committed file (lib/bankMedians.json), written by
// scripts/compute-bank-medians.js and updated on purpose — roughly quarterly —
// rather than recalculated live. Live medians would let a bank's grade change
// because *other* banks moved, with nothing in its own filings changing.

const fs = require('fs');
const path = require('path');

const MEDIANS_FILE = path.join(__dirname, 'bankMedians.json');

let cached; // undefined until first read; null means "no file"

// { computedAt, pool, roe, roa, efficiency }, or null if the file doesn't exist
// yet — in which case banks grade as N/A rather than against made-up numbers.
function loadBankMedians() {
  if (cached !== undefined) return cached;
  cached = fs.existsSync(MEDIANS_FILE)
    ? JSON.parse(fs.readFileSync(MEDIANS_FILE, 'utf8'))
    : null;
  return cached;
}

module.exports = { loadBankMedians, MEDIANS_FILE };
