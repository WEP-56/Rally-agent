const { spawn } = require('node:child_process');
const { readFileSync, writeFileSync } = require('node:fs');
if (process.argv[2] === 'leaf') {
  process.on('SIGTERM', () => {});
  console.log(JSON.stringify({ leaf: process.pid }));
  setInterval(() => {}, 1000);
} else if (process.argv[2] === 'inspect') {
  const registry = JSON.parse(readFileSync(process.argv[3], 'utf8'));
  console.log(JSON.stringify({ parent: process.ppid, entries: registry.processes, sentinel: process.env.RALLY_TEST_SENTINEL }));
  process.stdout.write('完成 ✓\n'.repeat(20000));
  process.stderr.write('stderr ✓\n');
} else if (process.argv[2] === 'mark') {
  writeFileSync(process.argv[3], 'command ran');
} else {
  process.on('SIGTERM', () => {});
  const child = spawn(process.execPath, [__filename, 'leaf'], { windowsHide: true, stdio: ['ignore', 'pipe', 'inherit'] });
  child.stdout.once('data', data => console.log(JSON.stringify({ root: process.pid, ...JSON.parse(data.toString()) })));
  setInterval(() => {}, 1000);
}
