#!/usr/bin/env node
'use strict';
/*
 * termius-ctl.js - Windows-side controller for the `termius-vault` skill.
 *
 * Runs ON WINDOWS. It is normally launched as:
 *   ELECTRON_RUN_AS_NODE=1 Termius.exe termius-ctl.js <command> [args]
 * which guarantees a Node runtime able to `require` Termius' own native
 * crypto module (termius.node, libsodium) without a separate Node install.
 *
 * Commands:
 *   doctor                    - environment sanity check (no app interaction)
 *   export  [--secrets]       - read + decrypt the local vault -> JSON on stdout
 *   verify                    - print host -> identity -> key/port table
 *   push --desired <file.json> [--dry-run] [--restart]
 *
 * All structured output is JSON on stdout. Diagnostics go to stderr.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFileSync, spawn } = require('child_process');

const CDP_PORT = Number(process.env.TERMIUS_CDP_PORT || 9222);
const DATA_DIR = process.env.APPDATA ? path.join(process.env.APPDATA, 'Termius') : null;

function log(...a) { console.error('[termius]', ...a); }
function die(msg, code = 1) { console.error('ERROR: ' + msg); process.exit(code); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- paths
function findTermius() {
  const cands = [
    process.env.TERMIUS_EXE,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Termius', 'Termius.exe'),
  ].filter(Boolean);
  for (const c of cands) if (fs.existsSync(c)) return c;
  die('Termius.exe not found. Set TERMIUS_EXE to its full path.');
}
function nativeModule(exe) {
  return path.join(path.dirname(exe), 'resources', 'app.asar.unpacked', 'node_modules',
    '@termius', 'libtermius', 'win-x64', 'termius.node');
}

// ---------------------------------------------------------------- localKey
function readLocalKey() {
  const ps1 = path.join(__dirname, 'cred-read.ps1');
  let out;
  try {
    out = execFileSync('powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1],
      { encoding: 'utf8' });
  } catch (e) { die('failed to run cred-read.ps1: ' + e.message); }
  const m = out.match(/LOCALKEY_B64=([A-Za-z0-9+/=]+)/);
  if (!m) die('Termius/localKey not found in Windows Credential Manager');
  return m[1].trim();
}

// ---------------------------------------------------------------- process
function termiusPids() {
  try {
    const o = execFileSync('tasklist', ['/FI', 'IMAGENAME eq Termius.exe', '/NH', '/FO', 'CSV'], { encoding: 'utf8' });
    return o.split(/\r?\n/)
      .map((l) => { const m = l.match(/^"Termius\.exe","(\d+)"/); return m ? Number(m[1]) : null; })
      .filter((x) => x && x !== process.pid);
  } catch (e) { return []; }
}
function termiusRunning() { return termiusPids().length > 0; }
function killTermius() {
  for (const pid of termiusPids()) {
    try { execFileSync('taskkill', ['/PID', String(pid), '/F'], { stdio: 'ignore' }); } catch (e) {}
  }
}
function launchTermius(exe, dbg) {
  const args = dbg ? ['--remote-debugging-port=' + CDP_PORT, '--remote-allow-origins=*'] : [];
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;   // otherwise the child just runs as Node
  spawn(exe, args, { detached: true, stdio: 'ignore', env }).unref();
}

// ---------------------------------------------------------------- cdp
function httpGet(url) {
  return new Promise((res, rej) => {
    http.get(url, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(d)); }).on('error', rej);
  });
}
async function cdpTargets() { return JSON.parse(await httpGet('http://127.0.0.1:' + CDP_PORT + '/json')); }
async function cdpAlive() { try { await cdpTargets(); return true; } catch (e) { return false; } }

class Conn {
  constructor(ws) {
    this.id = 0; this.pend = new Map();
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); const p = this.pend.get(m.id); if (p) { this.pend.delete(m.id); p(m); } };
  }
  send(method, params) { return new Promise((res) => { const i = ++this.id; this.pend.set(i, res); this.ws.send(JSON.stringify({ id: i, method, params })); }); }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) throw new Error('page exception: ' + JSON.stringify(r.result.exceptionDetails));
    return r.result.result.value;
  }
}
async function connectBackground() {
  const targets = await cdpTargets();
  const t = targets.find((x) => /background-process/.test(x.url));
  if (!t) die('no background-process CDP target (is Termius fully started?)');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = (e) => rej(new Error('ws error')); });
  const c = new Conn(ws); c.ws = ws; await c.send('Runtime.enable', {});
  return c;
}
async function ensureCdp(exe, allowRestart) {
  if (await cdpAlive()) return false;
  if (termiusRunning()) {
    if (!allowRestart) die('Termius is running without CDP. Re-run with --restart (this closes and reopens it).');
    log('closing Termius to enable CDP...'); killTermius(); await sleep(2500);
  }
  log('launching Termius with CDP on port ' + CDP_PORT);
  launchTermius(exe, true);
  for (let i = 0; i < 60; i++) { await sleep(500); if (await cdpAlive()) return true; }
  die('Termius did not open CDP port ' + CDP_PORT);
}

async function restoreNormal(exe) {
  log('restoring Termius to normal mode...');
  killTermius(); await sleep(2500); launchTermius(exe, false);
}

// ---------------------------------------------------------------- crypto (in-page helpers)
function pageHelpers(localKey, nativePath) {
  return `const __native=require(${JSON.stringify(nativePath)});const __c=__native.crypto;__c.init();
const __sys=__c.systems.FromEncryptionKey(Buffer.from(${JSON.stringify(localKey)},'base64'));
const enc=s=>__sys.encrypt(Buffer.from(s==null?'':s,'utf8')).toString('base64');
const dec=v=>{if(v==null)return v;try{const r=__sys.decrypt(Buffer.from(v,'base64'));return r?r.toString('utf8'):'';}catch(e){return null;}};
const all=(db,st)=>new Promise(res=>{const rq=indexedDB.open(db);rq.onsuccess=()=>{try{const r=rq.result.transaction(st,'readonly').objectStore(st).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>res([]);}catch(e){res([]);}};rq.onerror=()=>res([]);});
const add=(db,st,rec)=>new Promise((res,rej)=>{const rq=indexedDB.open(db);rq.onsuccess=()=>{const tx=rq.result.transaction(st,'readwrite');const q=tx.objectStore(st).add(rec);q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error);};rq.onerror=()=>rej(rq.error);});`;
}

function exportExpr(localKey, nativePath, withSecrets) {
  return `(async()=>{${pageHelpers(localKey, nativePath)}
const hosts=await all('hosts','hosts'),cfgs=await all('ssh_configs','ssh_configs'),idents=await all('ssh_identities','ssh_identities'),keys=await all('keys','keys'),known=await all('known_hosts','known_hosts');
const cfgBy=Object.fromEntries(cfgs.map(x=>[x.local_id,x])),idBy=Object.fromEntries(idents.map(x=>[x.local_id,x])),keyBy=Object.fromEntries(keys.map(x=>[x.local_id,x]));
const out=hosts.map(h=>{const cfg=cfgBy[h.ssh_config&&h.ssh_config.local_id]||{};const idn=idBy[cfg.identity&&cfg.identity.local_id]||{};const kk=idn.ssh_key?keyBy[idn.ssh_key.local_id]:null;
  const it={label:dec(h.label),address:dec(h.address),port:cfg.port==null?null:cfg.port,user:dec(idn.username),host_id:h.id==null?null:h.id};
  if(${withSecrets ? 'true' : 'false'}){it.password=dec(idn.password)||'';if(kk){it.key_label=dec(kk.label);it.private_key=dec(kk.private_key);it.public_key=dec(kk.public_key);it.passphrase=dec(kk.passphrase);}}
  return it;});
const nk=known.map(k=>({hostnames:dec(k.hostnames),key:dec(k.key)}));
return JSON.stringify({hosts:out,known_hosts:nk});})()`;
}

function verifyExpr(localKey, nativePath) {
  return `(async()=>{${pageHelpers(localKey, nativePath)}
const hosts=await all('hosts','hosts'),cfgs=await all('ssh_configs','ssh_configs'),idents=await all('ssh_identities','ssh_identities'),keys=await all('keys','keys');
const cfgBy=Object.fromEntries(cfgs.map(x=>[x.local_id,x])),idBy=Object.fromEntries(idents.map(x=>[x.local_id,x])),keyBy=Object.fromEntries(keys.map(x=>[x.local_id,x]));
return JSON.stringify(hosts.map(h=>{const cfg=cfgBy[h.ssh_config&&h.ssh_config.local_id]||{};const idn=idBy[cfg.identity&&cfg.identity.local_id]||{};const kk=idn.ssh_key?keyBy[idn.ssh_key.local_id]:null;
  return {label:dec(h.label),address:dec(h.address),port:cfg.port,user:dec(idn.username),auth:kk?('key:'+(dec(kk.label)||'')).replace(/\\n/g,''):((dec(idn.password)||'')?('password:'+dec(idn.password)):'none'),id:h.id,status:h.status};}));})()`;
}

function pushExpr(localKey, nativePath, desired) {
  return `(async()=>{${pageHelpers(localKey, nativePath)}
const D=${JSON.stringify(desired)};
const now=new Date().toISOString().slice(0,19);
const log=[];
const keyLid={};
const existingKeys=await all('keys','keys');
for(const k of existingKeys){const l=dec(k.label);if(l&&l!=='__E__')keyLid[l.replace(/\\n/g,'')]=k.local_id;}
for(const kn of Object.keys(D.keys||{})){
  if(keyLid[kn]!=null){log.push('key '+kn+' exists #'+keyLid[kn]);continue;}
  const k=D.keys[kn];
  const lid=await add('keys','keys',{updated_at:now,encrypted_with:null,is_shared:false,
    content:enc(JSON.stringify({passphrase:k.passphrase||'',private_key:k.private_key,public_key:k.public_key,label:kn,version:1})),
    passphrase:enc(k.passphrase||''),private_key:enc(k.private_key),public_key:enc(k.public_key),label:enc(kn),status:'CREATE_FAILED'});
  keyLid[kn]=lid;log.push('key '+kn+' CREATED #'+lid);}
const existingHosts=await all('hosts','hosts');
const labels=new Set(existingHosts.map(h=>dec(h.label)));
for(const h of (D.hosts||[])){
  if(labels.has(h.label)){log.push('host '+h.label+' exists');continue;}
  const isKey=!!h.key;
  const identLid=await add('ssh_identities','ssh_identities',{updated_at:now,ssh_key:isKey?{local_id:keyLid[h.key]}:null,encrypted_with:null,
    content:enc(JSON.stringify({version:1,label:'',password:h.password||'',username:h.user,is_visible:false})),sshid_mode:null,is_shared:false,
    username:enc(h.user),password:enc(h.password||''),is_visible:false,label:enc(''),status:'CREATE_FAILED'});
  const cfgLid=await add('ssh_configs','ssh_configs',{updated_at:now,identity:{local_id:identLid},proxycommand:null,startup_snippet:null,encrypted_with:null,pam:null,
    content:enc(JSON.stringify({version:1,env_variables:'{}',charset:null,port:h.port,mosh_server_command:'mosh-server new -s -l LANG=en_US.UTF-8',use_mosh:false})),
    is_shared:false,env_variables:enc('{}'),charset:null,mosh_server_command:enc('mosh-server new -s -l LANG=en_US.UTF-8'),use_mosh:false,port:h.port,status:'CREATE_FAILED'});
  const hostLid=await add('hosts','hosts',{updated_at:now,ssh_config:{local_id:cfgLid},group:null,telnet_config:null,encrypted_with:null,
    content:enc(JSON.stringify({version:1,address:h.address,label:h.label,backspace:'default',ip_version:'AUTO',os_name:''})),credentials_mode:null,is_shared:false,
    address:enc(h.address),label:enc(h.label),backspace:'default',ip_version:'AUTO',os_name:'',status:'CREATE_FAILED'});
  await add('ssh_config_identities','ssh_config_identities',{updated_at:now,identity:{local_id:identLid},ssh_config:{local_id:cfgLid},status:'CREATE_FAILED'});
  log.push('host '+h.label+' CREATED host#'+hostLid+' cfg#'+cfgLid+' ident#'+identLid);}
return JSON.stringify(log);})()`;
}

// ---------------------------------------------------------------- commands
function backupDataDir() {
  if (!DATA_DIR || !fs.existsSync(DATA_DIR)) { log('no data dir to back up'); return; }
  const dst = path.join(path.dirname(DATA_DIR), 'Termius-backup-' + Date.now());
  try {
    fs.cpSync(path.join(DATA_DIR, 'IndexedDB'), path.join(dst, 'IndexedDB'), { recursive: true, force: true, errorOnExist: false });
    log('backup -> ' + dst);
  } catch (e) { log('backup warning: ' + e.message); }
}

function cmdDoctor(exe) {
  const nat = nativeModule(exe);
  const key = readLocalKey();
  const ok = { termius: exe, native: nat, nativeExists: fs.existsSync(nat), dataDir: DATA_DIR, dataDirExists: !!(DATA_DIR && fs.existsSync(DATA_DIR)), localKeyFound: !!key, localKeyLength: key.length };
  let cryptoOk = false;
  try {
    const c = require(nat).crypto; c.init();
    const sys = c.systems.FromEncryptionKey(Buffer.from(key, 'base64'));
    cryptoOk = !!sys;
    ok.cryptoSystems = Object.keys(c.systems || {});
    ok.versions = c.versions;
  } catch (e) { ok.cryptoError = e.message; }
  ok.cryptoOk = cryptoOk;
  ok.termiusRunning = termiusRunning();
  ok.cdpAlive = null;
  process.stdout.write(JSON.stringify(ok, null, 2));
}

async function cmdExport(exe, opts) {
  const nat = nativeModule(exe);
  const launched = await ensureCdp(exe, opts.restart);
  const c = await connectBackground();
  const out = await c.eval(exportExpr(readLocalKey(), nat, opts.secrets));
  c.ws.close();
  if (launched && !opts.keepDebug) await restoreNormal(exe);
  process.stdout.write(out);
}

async function cmdVerify(exe, opts) {
  const nat = nativeModule(exe);
  const launched = await ensureCdp(exe, opts.restart);
  const c = await connectBackground();
  const out = await c.eval(verifyExpr(readLocalKey(), nat));
  c.ws.close();
  if (launched && !opts.keepDebug) await restoreNormal(exe);
  process.stdout.write(out);
}

async function cmdPush(exe, opts) {
  if (!opts.desired) die('push requires --desired <file.json>');
  const desired = JSON.parse(fs.readFileSync(opts.desired, 'utf8'));
  if (opts.dryRun) {
    const launched = await ensureCdp(exe, opts.restart);
    const c = await connectBackground();
    const cur = JSON.parse(await c.eval(verifyExpr(readLocalKey(), nativeModule(exe))));
    c.ws.close();
    if (launched && !opts.keepDebug) await restoreNormal(exe);
    const have = new Set(cur.map((x) => x.label));
    const add = (desired.hosts || []).filter((h) => !have.has(h.label)).map((h) => h.label);
    process.stdout.write(JSON.stringify({ existing: [...have], toCreate: add, keys: Object.keys(desired.keys || {}) }, null, 2));
    return;
  }
  // 1) close, 2) backup, 3) launch with CDP, 4) insert, 5) restart normally to sync
  if (termiusRunning()) { log('closing Termius'); killTermius(); await sleep(2500); }
  backupDataDir();
  await ensureCdp(exe, true);
  const c = await connectBackground();
  const log2 = JSON.parse(await c.eval(pushExpr(readLocalKey(), nativeModule(exe), desired)));
  c.ws.close();
  log('restarting Termius to sync...');
  killTermius(); await sleep(2500); launchTermius(exe, false);
  process.stdout.write(JSON.stringify({ inserted: log2 }, null, 2));
}

// ---------------------------------------------------------------- main
(async () => {
  const [cmd, ...rest] = process.argv.slice(2);
  const opts = { secrets: false, restart: false, dryRun: false, keepDebug: false, desired: null };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--secrets') opts.secrets = true;
    else if (rest[i] === '--restart') opts.restart = true;
    else if (rest[i] === '--dry-run') opts.dryRun = true;
    else if (rest[i] === '--keep-debug') opts.keepDebug = true;
    else if (rest[i] === '--desired') opts.desired = rest[++i];
  }
  const exe = findTermius();
  try {
    if (cmd === 'doctor') cmdDoctor(exe);
    else if (cmd === 'export') await cmdExport(exe, opts);
    else if (cmd === 'verify') await cmdVerify(exe, opts);
    else if (cmd === 'push') await cmdPush(exe, opts);
    else die('unknown command: ' + cmd + ' (use doctor|export|verify|push)');
  } catch (e) { die(e.message); }
})();
