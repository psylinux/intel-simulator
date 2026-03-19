const fs = require('fs');
const path = require('path');

const jsDir = path.join(__dirname, '../js');
const files = fs.readdirSync(jsDir).filter(f => f.endsWith('.js'));

const contents = files.map(f => fs.readFileSync(path.join(jsDir, f), 'utf-8'));
const allCode = contents.join('\n');

const functionRegex = /(?:function|const|let)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?:=|=>|\()/g;
const declares = new Set();
let match;
while ((match = functionRegex.exec(allCode)) !== null) {
  declares.add(match[1]);
}

const unusedVars = [];
for (const fn of declares) {
  // Check how many times it's used
  const uses = allCode.split(new RegExp('\\b' + fn + '\\b')).length - 1;
  if (uses === 1) { // 1 means only definition
    unusedVars.push(fn);
  }
}
console.log('Potentially unused definitions:', unusedVars.join(', '));
