import { createServer } from 'node:http';
import { join } from 'node:path';
import { AgentBrowserService } from '../../src/main/agent-browser/service.ts';
import { WebsiteAccounts } from '../../src/main/website-accounts.ts';
import { browserCommand } from '../../src/main/agent-browser/commands.ts';
import { readBody, reply, failure } from '../../src/main/cloud/http.ts';

const page = createServer((_req, res) => res.end('<button>Device test</button>'));
await new Promise(resolve => page.listen(0, '127.0.0.1', resolve));
const browser = new AgentBrowserService(join(process.env.RALLY_FIXTURE, 'profile'), new WebsiteAccounts(join(process.env.RALLY_FIXTURE, 'accounts.txt')));
await browser.open('fixture-task', 'fixture-run', `http://127.0.0.1:${page.address().port}`);
const server = createServer(async (req, res) => {
  try {
    const body = await readBody(req);
    const result = req.url === '/v1/device-revoked' ? browser.disconnect(body.device) : await browserCommand(browser, body.device, body.channel, body.args);
    reply(res, 200, result);
  } catch (error) { failure(res, error); }
});
await new Promise(resolve => server.listen(process.env.RALLY_SOCKET, resolve));
console.log('fixture ready');
async function stop() { server.closeAllConnections(); server.close(); await browser.dispose(); page.closeAllConnections(); page.close(); }
process.stdin.resume(); process.stdin.once('end', () => void stop());
process.once('SIGTERM', () => void stop());
process.once('SIGINT', () => void stop());
