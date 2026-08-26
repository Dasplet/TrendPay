// Jest writes lcov SF: paths relative to this package's cwd, using the
// OS path separator (backslashes on Windows). Sonar resolves coverage
// against sonar.sources at the repo root, so those paths need to be
// forward-slashed and prefixed with the package's own root-relative path.
const fs = require('node:fs');
const path = require('node:path');

const lcovPath = path.join(__dirname, '..', 'coverage', 'lcov.info');
if (!fs.existsSync(lcovPath)) {
  console.error('lcov.info not found — run the coverage script first.');
  process.exit(1);
}

const fixed = fs
  .readFileSync(lcovPath, 'utf8')
  .split('\n')
  .map((line) => {
    if (!line.startsWith('SF:')) return line;
    const rel = line.slice(3).replace(/\\/g, '/');
    return `SF:packages/api/${rel}`;
  })
  .join('\n');

fs.writeFileSync(lcovPath, fixed);
console.log('Rewrote lcov.info SF: paths to be repo-root-relative.');
