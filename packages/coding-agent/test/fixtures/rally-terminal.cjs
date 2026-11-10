const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const report = value => process.stdout.write(`RALLY_PTY:${JSON.stringify(value)}\r\n`);
report({ ready: true, pid: process.pid, cwd: process.cwd(), tty: !!process.stdin.isTTY, cols: process.stdout.columns, rows: process.stdout.rows, electron: process.env.ELECTRON_RUN_AS_NODE });
process.stdin.setRawMode(true);
process.stdout.on('resize', () => report({ resize: true, cols: process.stdout.columns, rows: process.stdout.rows }));
let line = '';
process.stdin.on('data', data => {
  for (const ch of data.toString('utf8')) {
    if (ch === '\x03') { line = ''; report({ interrupted: true }); continue; }
    if (ch !== '\r' && ch !== '\n') { line += ch; continue; }
    const command = line; line = ''; if (!command) continue;
    if (command === 'exit') { report({ final: true }); process.exit(7); }
    if (command === 'spawn') {
      const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { windowsHide: true, stdio: 'ignore' });
      writeFileSync(join(process.cwd(), 'descendant.pid'), String(child.pid)); report({ descendant: child.pid });
    } else if (command === 'flood') {
      process.stdout.write('X'.repeat(512000), () => report({ floodDone: true }));
    } else report({ echo: command });
  }
});
setInterval(() => {}, 60000);
