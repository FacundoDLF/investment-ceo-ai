const fs = require('fs');
const path = require('path');

function getAllTs(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      results = results.concat(getAllTs(fullPath));
    } else if (file.endsWith('.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

const files = getAllTs('src');
let totalFixed = 0;

for (const file of files) {
  const original = fs.readFileSync(file, 'utf8');
  // Fix \\${ANSI_COLORS...} and \\${LOG_PREFIX...} -> ${ANSI_COLORS...} / ${LOG_PREFIX...}
  // The raw file has the two-char sequence backslash+dollar which causes literal output at runtime
  const fixed = original
    .replace(/\\(?=\$\{ANSI_COLORS\.[A-Z_]+\})/g, '')
    .replace(/\\(?=\$\{LOG_PREFIX\.[A-Z_]+\})/g, '');

  if (original !== fixed) {
    fs.writeFileSync(file, fixed);
    console.log('Fixed:', file);
    totalFixed++;
  }
}
console.log('Done. Files fixed:', totalFixed);
