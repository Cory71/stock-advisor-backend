// Guards the rule that only lib/gradeAndSave.js grades a stock.
//
// Five places used to repeat "grade, then save" by hand. If one of them kept its
// own copy, a new grading model (like bank grading) could reach the grade page
// but miss the watchlist or the daily refresh. This test reads the source files
// and fails if anything else starts calling gradeStock directly.

const { expect } = require('chai');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FOLDERS = ['lib', 'routes', 'scripts', 'providers', 'middleware', 'models'];

// For each grader: the only files allowed to call it — where it's defined, and
// the one place that uses it.
const GRADERS = {
  'gradeStock(': ['lib/grading.js', 'lib/gradeAndSave.js'],
  'gradeBank(': [
    'lib/gradingBank.js',
    'lib/gradeAndSave.js',
    // Only previews which grades new medians would move; it never saves a grade.
    'scripts/compute-bank-medians.js',
  ],
};

// Every .js file in the given folders, as paths relative to the backend root.
function listSourceFiles() {
  const files = [];
  for (const folder of FOLDERS) {
    const dir = path.join(ROOT, folder);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (name.endsWith('.js')) files.push(`${folder}/${name}`);
    }
  }
  files.push('server.js');
  return files;
}

describe('single grading path', () => {
  for (const [call, allowed] of Object.entries(GRADERS)) {
    it(`only lib/gradeAndSave.js calls ${call.slice(0, -1)}`, () => {
      const offenders = listSourceFiles()
        .filter((file) => !allowed.includes(file))
        .filter((file) => fs.readFileSync(path.join(ROOT, file), 'utf8').includes(call));

      expect(offenders, 'grade through lib/gradeAndSave.js instead').to.deep.equal([]);
    });
  }
});
