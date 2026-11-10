const http = require("node:http");
const fs = require("node:fs");
const mode = process.argv[2] || "http";
const gate = process.argv[3];
console.log(`PID ${process.pid}`);
console.log(`CWD ${process.cwd()}`);
console.log(`ENV ${process.env.RALLY_SERVICE_TEST || "unset"}`);
process.on("SIGTERM", () => {});
if (mode === "exit") { console.log("中文 EXIT"); process.exit(7); }
let server;
if (mode === "http" || mode === "pattern-http") {
	server = http.createServer((_request, response) => { response.setHeader("Content-Type", "text/plain; charset=utf-8"); response.end("真实服务 ✓"); });
	const listen = () => server.listen(Number(process.argv[4]) || 0, "127.0.0.1", () => { console.log(`Local: http://127.0.0.1:${server.address().port}/`); });
	if (mode === "pattern-http") { console.log("APP_READY 中文 ✓"); setTimeout(listen, 750); } else listen();
} else if (mode === "pattern") console.log("APP_READY 中文 ✓");
setInterval(() => { if (gate && fs.existsSync(gate)) { console.log("SERVICE_FINISHED"); if (server) server.close(() => process.exit(0)); else process.exit(0); } }, 20);
