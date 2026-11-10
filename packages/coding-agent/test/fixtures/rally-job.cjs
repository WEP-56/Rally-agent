const { existsSync, readFileSync } = require('node:fs');
const gate = process.argv[2];
console.log(`READY ${process.pid}`);
console.log(`ENV ${process.env.RALLY_TASK_ID || ''} ${process.env.RALLY_OUTPUT_DIR || ''}`);
process.on('SIGTERM', () => {});
let pulse;
setInterval(() => {
  if (existsSync(`${gate}.pulse`)) {
    const next = readFileSync(`${gate}.pulse`, 'utf8');
    if (next !== pulse) { pulse = next; console.log(`PULSE ${pulse}`); }
  }
  if (!existsSync(gate)) return;
  const result = JSON.parse(readFileSync(gate, 'utf8'));
  for (let i = 1; i <= 250; i++) console.log(`line-${i} 中文`);
  console.log('JOB_FINISHED_SENTINEL');
  process.exit(result.exitCode || 0);
}, 20);
