const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const [marker, mode] = process.argv.slice(2);
const child = spawn(process.execPath, [path.join(__dirname, 'rally-process-tree.cjs'), 'leaf'], { windowsHide: true, stdio: 'ignore' });
fs.writeFileSync(marker, JSON.stringify({ root: process.pid, leaf: child.pid }));
process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
if (mode === 'limit') {
  for (let line = 1; line <= 3; line++) process.stdout.write(JSON.stringify({ type: 'match', data: { path: { text: 'note.txt' }, line_number: line, lines: { text: 'match 中文\n' } } }) + '\n');
}
