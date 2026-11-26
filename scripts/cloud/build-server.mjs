import { build } from "vite";
import { cpSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const dest='out/server'; mkdirSync(dest,{recursive:true});
// Preserve the module layout: worker_threads and process hosts resolve their siblings by URL.
for(const dir of ['shared','main/supervisor','main/cloud','main/agent-browser'])cpSync(`src/${dir}`,`${dest}/src/${dir}`,{recursive:true});
for(const file of readdirSync('src/main'))if(file.endsWith('.ts')&&!/^(application-shutdown|branding|browser|connection-host|desktop-.*|identity-avatar|index|ipc|notifications|shutdown-guard.*|smoke|terminal.*)\.ts$/.test(file))cpSync(`src/main/${file}`,join(dest,'src/main',file));
const consoleDir=dest+'/src/main/cloud/console';cpSync('src/console',consoleDir,{recursive:true});cpSync('src/renderer/src/assets/rally-mark.png',consoleDir+'/mark.png');writeFileSync(consoleDir+'/console.css',readFileSync('src/shared/theme.css','utf8')+'\n'+readFileSync('src/console/console.css','utf8'));
writeFileSync(dest+'/package.json',JSON.stringify({type:'module',version:JSON.parse(readFileSync('package.json')).version}));

// Bundle the standalone console with the client's color generator and spring
// presets. Assets remain local and compatible with the control server CSP.
await build({
  configFile: false,
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: consoleDir,
    emptyOutDir: false,
    lib: { entry: "src/console/console.js", name: "RallyConsole", formats: ["iife"], fileName: () => "console.js" },
  },
});
