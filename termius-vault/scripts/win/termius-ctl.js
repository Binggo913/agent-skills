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
 *   export  [--secrets|--keys] - read + decrypt the local vault -> JSON on stdout
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
function die(msg) { throw new Error(msg); }
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
      { encoding: 'utf8', windowsHide: true });
  } catch { die('failed to read Termius credential (details withheld)'); }
  const m = out.match(/LOCALKEY_B64=([A-Za-z0-9+/=]+)/);
  if (!m) die('Termius/localKey not found in Windows Credential Manager');
  return m[1].trim();
}

// ---------------------------------------------------------------- process
function termiusPids() {
  try {
    const o = execFileSync('tasklist', ['/FI', 'IMAGENAME eq Termius.exe', '/NH', '/FO', 'CSV'], { encoding: 'utf8', windowsHide: true });
    return o.split(/\r?\n/)
      .map((l) => { const m = l.match(/^"Termius\.exe","(\d+)"/); return m ? Number(m[1]) : null; })
      .filter((x) => x && x !== process.pid);
  } catch { throw new Error('Cannot inspect Termius processes; refusing to assume the database is closed'); }
}
function termiusRunning() { return termiusPids().length > 0; }
function killTermius() {
  for (const pid of termiusPids()) {
    try { execFileSync('taskkill', ['/PID', String(pid), '/F'], { stdio: 'ignore', windowsHide: true }); } catch (e) {}
  }
}
function launchTermius(exe, dbg) {
  const args = dbg ? ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + CDP_PORT] : [];
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  // Never pass windowsHide for Termius.exe. It makes libuv set
  // STARTUPINFO(dwFlags |= STARTF_USESHOWWINDOW, wShowWindow = SW_HIDE), Windows
  // then substitutes SW_HIDE for the process' first ShowWindow call, so Chromium
  // creates the main window invisible. The app still owns the single-instance
  // lock, so later manual launches only signal the hidden instance and no window
  // ever appears. Termius.exe is a GUI binary, so it creates no console window
  // that would need hiding.
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, guiSpawnOptions(env));
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(child.pid); });
  });
}
// Exported so tests can assert the GUI launch never requests a hidden startup
// window; see launchTermius for why `windowsHide` is forbidden here.
function guiSpawnOptions(env) {
  return { detached: true, stdio: 'ignore', env };
}

// ---------------------------------------------------------------- cdp
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (r) => {
      let data = '';
      r.on('data', (chunk) => { data += chunk; });
      r.on('error', reject);
      r.on('end', () => r.statusCode === 200 ? resolve(data) : reject(new Error('HTTP ' + r.statusCode)));
    });
    req.setTimeout(1500, () => req.destroy(new Error('CDP HTTP timeout')));
    req.on('error', reject);
  });
}
async function cdpTargets() {
  const targets = JSON.parse(await httpGet('http://127.0.0.1:' + CDP_PORT + '/json'));
  if (!Array.isArray(targets)) throw new Error('Invalid CDP target list');
  return targets;
}

class Conn {
  constructor(ws, timeout = 30000) {
    this.ws = ws; this.id = 0; this.pend = new Map(); this.timeout = timeout;
    ws.onmessage = (ev) => {
      let message;
      try { message = JSON.parse(ev.data); } catch { return; }
      const pending = this.pend.get(message.id);
      if (!pending) return;
      this.pend.delete(message.id); clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message);
    };
    ws.onclose = () => this.rejectPending(new Error('CDP connection closed'));
    ws.onerror = () => this.rejectPending(new Error('CDP WebSocket error'));
  }
  rejectPending(error) {
    for (const pending of this.pend.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pend.clear();
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      const timer = setTimeout(() => {
        this.pend.delete(id); reject(new Error('CDP timeout: ' + method));
      }, this.timeout);
      this.pend.set(id, { resolve, reject, timer });
      try { this.ws.send(JSON.stringify({ id, method, params })); }
      catch (error) { clearTimeout(timer); this.pend.delete(id); reject(error); }
    });
  }
  async eval(expression) {
    const response = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.result?.exceptionDetails) {
      // Page exception details can contain the evaluated source, including secrets.
      throw new Error('Vault operation failed in Termius; details withheld because they may contain credentials');
    }
    if (!response.result?.result || !('value' in response.result.result)) throw new Error('Missing CDP evaluation result');
    return response.result.result.value;
  }
  close() { this.rejectPending(new Error('CDP connection closed')); this.ws.close(); }
}
async function connectBackground(target, exe) {
  const url = new URL(target.webSocketDebuggerUrl);
  if (!['ws:', 'wss:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || Number(url.port) !== CDP_PORT) {
    throw new Error('Refusing non-local CDP WebSocket');
  }
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.close(); reject(new Error('CDP WebSocket connection timeout')); }, 5000);
    ws.onopen = () => { clearTimeout(timer); resolve(); };
    ws.onerror = () => { clearTimeout(timer); reject(new Error('CDP WebSocket connection failed')); };
  });
  const connection = new Conn(ws);
  try {
    await connection.send('Runtime.enable');
    const executable = await connection.eval('typeof process !== \'undefined\' ? process.execPath : null');
    if (!executable || path.resolve(executable).toLowerCase() !== path.resolve(exe).toLowerCase()) throw new Error('CDP target is not the configured Termius executable');
    return connection;
  }
  catch (error) { connection.close(); throw error; }
}

// A batch owns ONE lifecycle. Never restart a borrowed debugging instance merely
// for reads. Only close the application at a backup boundary or final cleanup.
class VaultSession {
  constructor(exe, opts, deps = {}) {
    this.exe = exe; this.opts = opts;
    this.d = { running: termiusRunning, kill: killTermius, launch: launchTermius,
      targets: cdpTargets, connect: connectBackground, backup: backupDataDir, sleep, ...deps };
    this.connection = null; this.backup = null;
    this.owned = false; this.wasRunning = false; this.dirty = false;
  }
  async waitStopped() {
    for (let i = 0; i < 100; i++) {
      if (!this.d.running()) return;
      await this.d.sleep(100);
    }
    throw new Error('Termius did not exit; refusing to copy a live database');
  }
  async stop() {
    if (this.connection) {
      const connection = this.connection; this.connection = null;
      try { await connection.send('Browser.close'); } catch { /* Electron may not support this browser command */ }
      finally { connection.close(); }
      for (let i = 0; i < 20; i++) {
        if (!this.d.running()) return;
        await this.d.sleep(100);
      }
    }
    if (this.d.running()) this.d.kill();
    await this.waitStopped();
  }
  async open(write = false) {
    this.wasRunning = this.d.running();
    let targets = null;
    try { targets = await this.d.targets(); } catch { /* no listener yet */ }
    const target = targets?.find((t) => t.type === 'page' && /^file:\/\//.test(t.url) && /background-process/.test(t.url));
    if (targets && !target) throw new Error('CDP port is occupied or Termius is not ready; refusing to restart it');
    if (target && this.wasRunning) {
      this.connection = await this.d.connect(target, this.exe);
      return;
    }
    if (target) throw new Error('CDP target exists but the expected Termius process is missing');
    if (this.wasRunning) {
      if (!this.opts.restart) throw new Error('Termius is running without CDP. Use --restart only if closing active SSH sessions is acceptable.');
      this.owned = true;
      await this.stop();
    }
    if (write) this.backup = this.d.backup();
    this.owned = true;
    await this.startDebug();
  }
  async startDebug() {
    log('starting one Termius debugging instance on loopback port ' + CDP_PORT);
    await this.d.launch(this.exe, true);
    for (let i = 0; i < 100; i++) {
      let target;
      try {
        const targets = await this.d.targets();
        target = targets.find((t) => t.type === 'page' && /^file:\/\//.test(t.url) && /background-process/.test(t.url));
      } catch { /* app is still starting */ }
      if (target) { this.connection = await this.d.connect(target, this.exe); return; }
      await this.d.sleep(300);
    }
    throw new Error('Termius background target did not become ready');
  }
  async prepareWrite() {
    if (this.backup) return false;
    // An already-running CDP instance can be read without interruption, but a
    // physical IndexedDB backup requires a confirmed stop, and explicit consent.
    if (!this.owned && !this.opts.restart) throw new Error('Writing needs a stopped-database backup. Re-run with --restart if closing active SSH sessions is acceptable.');
    this.owned = true;
    await this.stop();
    this.backup = this.d.backup(); // fail closed: no backup, no writes
    await this.startDebug();
    return true;
  }
  async finish() {
    if (!this.owned || this.opts.keepDebug) {
      if (this.connection) { this.connection.close(); this.connection = null; }
      if (this.owned) log('Leaving CDP enabled by request; it exposes vault access to local processes.');
      return;
    }
    await this.stop();
    // Reads restore the original closed/running state. Writes start normal mode
    // once, at the END of the batch, to let Termius refresh/sync the new records.
    if (this.wasRunning || this.dirty) await this.d.launch(this.exe, false);
  }
}

// ---------------------------------------------------------------- crypto (in-page helpers)
function pageHelpers(localKey, nativePath) {
  return `const __native=require(${JSON.stringify(nativePath)});const __c=__native.crypto;__c.init();
const __sys=__c.systems.FromEncryptionKey(Buffer.from(${JSON.stringify(localKey)},'base64'));
const enc=s=>__sys.encrypt(Buffer.from(s==null?'':s,'utf8')).toString('base64');
const dec=v=>{if(v==null)return v;try{const r=__sys.decrypt(Buffer.from(v,'base64'));if(!r)throw new Error('Decryption failed');return r.toString('utf8');}catch(e){throw new Error('Vault field could not be decrypted');}};
const openDb=db=>new Promise((res,rej)=>{const rq=indexedDB.open(db);rq.onupgradeneeded=()=>{rq.transaction.abort();rej(new Error('Missing vault database'));};rq.onsuccess=()=>res(rq.result);rq.onerror=()=>rej(new Error('Cannot open vault database'));rq.onblocked=()=>rej(new Error('Vault database blocked'));});
const all=async(db,st)=>{const conn=await openDb(db);try{return await new Promise((res,rej)=>{const tx=conn.transaction(st,'readonly');const rq=tx.objectStore(st).getAll();let rows;rq.onsuccess=()=>{rows=rq.result;};tx.oncomplete=()=>res(rows);tx.onerror=tx.onabort=()=>rej(new Error('Vault read failed'));});}finally{conn.close();}};
const add=async(db,st,rec)=>{const conn=await openDb(db);try{return await new Promise((res,rej)=>{const tx=conn.transaction(st,'readwrite');const rq=tx.objectStore(st).add(rec);let id;rq.onsuccess=()=>{id=rq.result;};tx.oncomplete=()=>res(id);tx.onerror=tx.onabort=()=>rej(new Error('Vault write failed'));});}finally{conn.close();}};`;
}

function exportExpr(localKey, nativePath, withSecrets, withKeys = false) {
  return `(async()=>{${pageHelpers(localKey, nativePath)}
const hosts=await all('hosts','hosts'),cfgs=await all('ssh_configs','ssh_configs'),idents=await all('ssh_identities','ssh_identities'),keys=await all('keys','keys'),known=await all('known_hosts','known_hosts');
const cfgBy=Object.fromEntries(cfgs.map(x=>[x.local_id,x])),idBy=Object.fromEntries(idents.map(x=>[x.local_id,x])),keyBy=Object.fromEntries(keys.map(x=>[x.local_id,x]));
const out=hosts.map(h=>{const cfg=cfgBy[h.ssh_config&&h.ssh_config.local_id]||{};const idn=idBy[cfg.identity&&cfg.identity.local_id]||{};const kk=idn.ssh_key?keyBy[idn.ssh_key.local_id]:null;
  const it={label:dec(h.label),address:dec(h.address),port:cfg.port==null?null:cfg.port,user:dec(idn.username),host_id:h.id==null?null:h.id,
    auth:kk?'key':((dec(idn.password)||'')?'password':'none')};
  if(kk)it.key_label=dec(kk.label);
  if(${withSecrets ? 'true' : 'false'})it.password=dec(idn.password)||'';
  if(${withSecrets || withKeys ? 'true' : 'false'}&&kk){it.private_key=dec(kk.private_key);it.public_key=dec(kk.public_key);}
  if(${withSecrets ? 'true' : 'false'}&&kk)it.passphrase=dec(kk.passphrase);
  return it;});
const nk=known.map(k=>({hostnames:dec(k.hostnames),key:dec(k.key)}));
return JSON.stringify({hosts:out,known_hosts:nk});})()`;
}

function verifyExpr(localKey, nativePath) {
  return `(async()=>{${pageHelpers(localKey, nativePath)}
const hosts=await all('hosts','hosts'),cfgs=await all('ssh_configs','ssh_configs'),idents=await all('ssh_identities','ssh_identities'),keys=await all('keys','keys');
const cfgBy=Object.fromEntries(cfgs.map(x=>[x.local_id,x])),idBy=Object.fromEntries(idents.map(x=>[x.local_id,x])),keyBy=Object.fromEntries(keys.map(x=>[x.local_id,x]));
return JSON.stringify(hosts.map(h=>{const cfg=cfgBy[h.ssh_config&&h.ssh_config.local_id]||{};const idn=idBy[cfg.identity&&cfg.identity.local_id]||{};const kk=idn.ssh_key?keyBy[idn.ssh_key.local_id]:null;
  return {label:dec(h.label),address:dec(h.address),port:cfg.port,user:dec(idn.username),auth:kk?('key:'+(dec(kk.label)||'')):((dec(idn.password)||'')?'password':'none'),id:h.id,status:h.status};}));})()`;
}

function pushExpr(localKey, nativePath, desired) {
  return `(async()=>{${pageHelpers(localKey, nativePath)}
const D=JSON.parse(${JSON.stringify(JSON.stringify(desired))});
const now=new Date().toISOString().slice(0,19);
const log=[];
const keyLid=Object.create(null);
const existingKeys=await all('keys','keys');
for(const k of existingKeys){const l=dec(k.label);if(l&&l!=='__E__')keyLid[l]=k.local_id;}
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
  if(isKey&&keyLid[h.key]==null)throw new Error('Missing referenced key');
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
  labels.add(h.label);log.push('host '+h.label+' CREATED host#'+hostLid+' cfg#'+cfgLid+' ident#'+identLid);}
return JSON.stringify(log);})()`;
}

// ---------------------------------------------------------------- commands
function backupDataDir() {
  if (!DATA_DIR || !fs.existsSync(path.join(DATA_DIR, 'IndexedDB'))) throw new Error('IndexedDB directory missing; cannot back up safely');
  const dst = path.join(path.dirname(DATA_DIR), 'Termius-backup-' + Date.now() + '-' + process.pid);
  fs.cpSync(path.join(DATA_DIR, 'IndexedDB'), path.join(dst, 'IndexedDB'), { recursive: true, force: false, errorOnExist: true });
  log('backup -> ' + dst);
  return dst;
}

function cmdDoctor(exe) {
  const nat = nativeModule(exe);
  const key = readLocalKey();
  const ok = { termius: exe, nativeExists: fs.existsSync(nat), dataDirExists: !!(DATA_DIR && fs.existsSync(DATA_DIR)), localKeyFound: !!key };
  try {
    const crypto = require(nat).crypto; crypto.init();
    ok.cryptoOk = !!crypto.systems.FromEncryptionKey(Buffer.from(key, 'base64'));
  } catch { ok.cryptoOk = false; }
  ok.termiusRunning = termiusRunning();
  return ok;
}

function validateDesired(desired) {
  if (!desired || !Array.isArray(desired.hosts) || !desired.keys || typeof desired.keys !== 'object' || Array.isArray(desired.keys)) throw new Error('Spec requires hosts array and keys object');
  const labels = new Set();
  for (const host of desired.hosts) {
    if (!host || typeof host.label !== 'string' || !host.label || typeof host.address !== 'string' || !host.address) throw new Error('Each host needs a nonempty label and address');
    if (labels.has(host.label)) throw new Error('Duplicate host label in spec');
    labels.add(host.label);
    if (host.port == null) host.port = 22;
    if (!Number.isInteger(host.port) || host.port < 1 || host.port > 65535) throw new Error('Invalid host port');
    for (const field of ['user', 'key', 'password']) {
      if (host[field] != null && typeof host[field] !== 'string') throw new Error('Host credential fields must be strings');
    }
    if (host.key && !Object.hasOwn(desired.keys, host.key)) throw new Error('Host references a key absent from spec');
    if (host.key && host.password) throw new Error('Use key OR password authentication, not both');
  }
  for (const key of Object.values(desired.keys)) {
    if (!key || typeof key.private_key !== 'string' || !key.private_key.trim()) throw new Error('Key needs private_key material');
    for (const field of ['public_key', 'passphrase']) {
      if (key[field] != null && typeof key[field] !== 'string') throw new Error('Key fields must be strings');
    }
  }
  return desired;
}

function planPush(desired, current) {
  const have = new Set(current.map((host) => host.label));
  const hosts = desired.hosts.filter((host) => !have.has(host.label));
  const used = new Set(hosts.map((host) => host.key).filter(Boolean));
  return { hosts, keys: Object.fromEntries(Object.entries(desired.keys).filter(([name]) => used.has(name))) };
}

async function runOperations(exe, opts, operations, deps = {}) {
  if (!operations.length) throw new Error('Batch must contain at least one operation');
  for (const op of operations) {
    if (!op || !['export', 'verify', 'push'].includes(op.command)) throw new Error('Unsupported batch operation');
    const allowed = op.command === 'push' ? ['command', 'desired', 'dryRun', 'secrets'] : (op.command === 'export' ? ['command', 'secrets', 'keys'] : ['command', 'secrets']);
    if (Object.keys(op).some((key) => !allowed.includes(key))) throw new Error('Unsupported operation field');
    for (const field of ['secrets', 'dryRun', 'keys']) {
      if (op[field] != null && typeof op[field] !== 'boolean') throw new Error('Operation flags must be boolean');
    }
    if (op.command === 'push') validateDesired(op.desired);
    if (op.keys && op.command !== 'export') throw new Error('--keys is only valid for export');
    if (op.secrets && op.command !== 'export') throw new Error('--secrets is only valid for export');
  }
  // Read the Windows credential once, before changing app state.
  const localKey = (deps.readKey || readLocalKey)();
  const nat = nativeModule(exe);
  const session = new VaultSession(exe, opts, deps);
  const out = [];
  let failure;
  try {
    // If the app already has to start, snapshot once before that first start.
    // Borrowed CDP instances defer disruption until a missing host is found.
    await session.open(operations.some((op) => op.command === 'push' && !op.dryRun));
    for (const op of operations) {
      const evaluate = async (expr) => JSON.parse(await session.connection.eval(expr));
      if (op.command === 'export') out.push(await evaluate(exportExpr(localKey, nat, !!op.secrets, !!op.keys)));
      else if (op.command === 'verify') out.push(await evaluate(verifyExpr(localKey, nat)));
      else {
        const current = await evaluate(verifyExpr(localKey, nat));
        let pending = planPush(op.desired, current);
        if (op.dryRun) {
          out.push({ existing: current.map((h) => h.label), toCreate: pending.hosts.map((h) => h.label), keys: Object.keys(pending.keys) });
          continue;
        }
        if (!pending.hosts.length) { out.push({ inserted: [], verified: [], backup: null }); continue; }
        if (await session.prepareWrite()) {
          // Re-read only when a backup/restart could have changed the database.
          pending = planPush(op.desired, await evaluate(verifyExpr(localKey, nat)));
        }
        if (!pending.hosts.length) { out.push({ inserted: [], verified: [], backup: session.backup }); continue; }
        session.dirty = true; // partial writes also need final refresh; no rollback is implied
        const inserted = await evaluate(pushExpr(localKey, nat, pending));
        const labels = new Set(pending.hosts.map((h) => h.label));
        const verified = (await evaluate(verifyExpr(localKey, nat))).filter((h) => labels.has(h.label));
        const valid = pending.hosts.every((host) => {
          const row = verified.find((item) => item.label === host.label);
          const auth = host.key ? 'key:' + host.key : (host.password ? 'password' : 'none');
          return row && row.address === host.address && row.port === host.port && row.user === (host.user || '') && row.auth === auth;
        });
        if (verified.length !== pending.hosts.length || !valid) throw new Error('Post-write verification failed; retain backup for recovery');
        out.push({ inserted, verified, backup: session.backup });
      }
    }
    return out;
  } catch (error) {
    // An opt-in reusable session must not strand a failed startup/write in debug mode.
    session.opts = { ...session.opts, keepDebug: false };
    failure = error;
    throw error;
  } finally {
    try { await session.finish(); } catch (cleanupError) {
      if (failure) throw new Error(failure.message + '; cleanup also failed: ' + cleanupError.message);
      throw cleanupError;
    }
  }
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = { restart: false, keepDebug: false, secrets: false, keys: false, dryRun: false };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === '--restart') opts.restart = true;
    else if (flag === '--keep-debug') opts.keepDebug = true;
    else if (flag === '--keys') opts.keys = true;
    else if (flag === '--secrets') opts.secrets = true;
    else if (flag === '--dry-run') opts.dryRun = true;
    else if (flag === '--desired' || flag === '--file') {
      if (!rest[i + 1] || rest[i + 1].startsWith('--')) throw new Error('Missing value for ' + flag);
      opts[flag.slice(2)] = rest[++i];
    } else throw new Error('Unknown option: ' + flag);
  }
  if (!['doctor', 'export', 'verify', 'push', 'batch'].includes(command)) throw new Error('Use doctor|export|verify|push|batch');
  if (opts.keys && command !== 'export') throw new Error('--keys is only valid for export');
  if (opts.secrets && command !== 'export') throw new Error('--secrets is only valid for export');
  if (opts.dryRun && command !== 'push') throw new Error('--dry-run is only valid for push/import');
  if (command === 'push' && !opts.desired) throw new Error('push requires --desired');
  if (command === 'batch' && !opts.file) throw new Error('batch requires --file');
  if (opts.file && command !== 'batch') throw new Error('--file is only valid for batch');
  if (opts.desired && command !== 'push') throw new Error('--desired is only valid for push');
  if (command === 'doctor' && rest.length) throw new Error('doctor takes no options');
  return { command, opts };
}

function operationsFor(command, opts, readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))) {
  if (command === 'batch') return readJson(opts.file).operations;
  if (command === 'push') return [{ command, dryRun: opts.dryRun, desired: readJson(opts.desired) }];
  if (command === 'export') return [{ command, secrets: opts.secrets, keys: opts.keys }];
  return [{ command }];
}

async function main(argv = process.argv.slice(2)) {
  const { command, opts } = parseArgs(argv);
  if (!Number.isInteger(CDP_PORT) || CDP_PORT < 1 || CDP_PORT > 65535) throw new Error('Invalid TERMIUS_CDP_PORT');
  const exe = findTermius();
  if (command === 'doctor') { process.stdout.write(JSON.stringify(cmdDoctor(exe), null, 2) + '\n'); return; }
  const operations = operationsFor(command, opts);
  if (!Array.isArray(operations)) throw new Error('Batch requires operations array');
  // Prevent two skill invocations from restarting each other's instance or
  // taking overlapping snapshots. Never auto-delete an unknown/stale lock.
  const lock = path.join(DATA_DIR, '.termius-vault-lock');
  try { fs.mkdirSync(lock); } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Another vault operation may be active (.termius-vault-lock). See troubleshooting before removing the lock.');
    throw error;
  }
  try {
    const out = await runOperations(exe, opts, operations);
    process.stdout.write(JSON.stringify(command === 'batch' ? out : out[0], null, 2) + '\n');
  } finally { fs.rmdirSync(lock); }
}

module.exports = { Conn, VaultSession, exportExpr, verifyExpr, pushExpr, validateDesired, planPush, runOperations, parseArgs, operationsFor, guiSpawnOptions };
if (require.main === module) main().catch((error) => {
  console.error('ERROR: ' + error.message); process.exitCode = 1;
});
