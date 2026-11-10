const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const [marker, registry, mode, ...args] = process.argv.slice(2);
let leaf;
if (mode === 'tree') {
  leaf = spawn(process.execPath, [path.join(__dirname, 'rally-process-tree.cjs'), 'leaf'], { windowsHide: true, stdio: 'ignore' });
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 1000);
}
fs.writeFileSync(marker, JSON.stringify({ root: process.pid, parent: process.ppid, leaf: leaf?.pid, entries: JSON.parse(fs.readFileSync(registry, 'utf8')).processes, cwd: process.cwd(), args, value: process.env.RALLY_MCP_VALUE }));
const input = readline.createInterface({ input: process.stdin });
input.on('line', line => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  let result = {};
  if (request.method === 'initialize') result = { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'managed', version: '1' } };
  if (request.method === 'tools/list') result = { tools: [{ name: 'echo', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] };
  if (request.method === 'tools/call') result = { content: [{ type: 'text', text: request.params.arguments.text }] };
  const data = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
  const split = data.indexOf(Buffer.from('中')) + 1;
  process.stdout.write(data.subarray(0, Math.max(1, split)));
  process.stdout.write(data.subarray(Math.max(1, split)));
});
input.on('close', () => { if (mode !== 'tree') process.exit(0); });
