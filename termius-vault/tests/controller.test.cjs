const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { runOperations, verifyExpr, exportExpr, pushExpr, operationsFor } = require('../scripts/win/termius-ctl.js');

const target = { type: 'page', url: 'file:///app/background-process.html' };
function fixture({ running = false, debug = false, backupError = false } = {}) {
  const events = [], records = Object.fromEntries(['hosts', 'ssh_configs', 'ssh_identities', 'keys', 'known_hosts', 'ssh_config_identities'].map((name) => [name, []]));
  let credentialReads = 0;
  const indexedDB = {
    open(name) {
      const request = {};
      setImmediate(() => {
        if (!records[name]) { request.onerror?.(); return; }
        request.result = {
          close() {},
          transaction(store, mode) {
            assert.equal(name, store);
            const tx = { objectStore() { return {
              getAll() {
                const q = {};
                setImmediate(() => { q.result = structuredClone(records[name]); q.onsuccess(); tx.oncomplete(); });
                return q;
              },
              add(row) {
                assert.equal(mode, 'readwrite');
                const q = {};
                setImmediate(() => {
                  q.result = records[name].length + 1;
                  q.onsuccess();
                  // Commit AFTER request success, matching the real IDB distinction.
                  setImmediate(() => { records[name].push({ ...row, local_id: q.result }); tx.oncomplete(); });
                });
                return q;
              },
            }; } };
            return tx;
          },
        };
        request.onsuccess();
      });
      return request;
    },
  };
  const context = { indexedDB, Buffer, require: () => ({ crypto: {
    init() {}, systems: { FromEncryptionKey: () => ({ encrypt: (value) => value, decrypt: (value) => value }) },
  } }) };
  const deps = {
    readKey() { credentialReads++; return 'local-key'; },
    running: () => running,
    kill() { events.push('kill'); running = debug = false; },
    async launch(exe, dbg) {
      events.push(dbg ? 'start-debug' : 'start-normal');
      running = true; debug = dbg;
    },
    async targets() { if (!debug) throw new Error('no listener'); return [target]; },
    async connect() {
      events.push('connect');
      return {
        async eval(expression) {
          return vm.runInNewContext(expression, context);
        },
        async send(method) { assert.equal(method, 'Browser.close'); events.push('close-app'); running = debug = false; },
        close() { events.push('disconnect'); },
      };
    },
    backup() { assert.equal(running, false); events.push('backup'); if (backupError) throw new Error('backup failed'); return '/backup'; },
    async sleep() {},
  };
  return { deps, events, records, state: () => ({ running, debug, credentialReads }), context };
}
const secret = 'do-not-print-this-password';
const desired = () => ({ keys: {}, hosts: [{ label: 'server', address: '192.0.2.1', user: 'alice', port: 22, password: secret }] });

test('read-only batch shares a single launch, connection and credential read', async () => {
  const f = fixture();
  const result = await runOperations('Termius.exe', {}, [{ command: 'verify' }, { command: 'export' }, { command: 'verify' }], f.deps);
  assert.equal(result.length, 3);
  assert.equal(f.state().running, false);
  assert.ok(!f.events.includes('start-normal'));
  assert.equal(f.events.filter((e) => e === 'start-debug').length, 1);
  assert.equal(f.events.filter((e) => e === 'connect').length, 1);
  assert.equal(f.state().credentialReads, 1);
});

test('existing CDP instance is borrowed for reads without being closed', async () => {
  const f = fixture({ running: true, debug: true });
  await runOperations('Termius.exe', {}, [{ command: 'verify' }], f.deps);
  assert.deepEqual(f.events, ['connect', 'disconnect']);
  assert.equal(f.state().running, true);
});

test('normal running instance is not terminated without explicit --restart', async () => {
  const f = fixture({ running: true });
  await assert.rejects(runOperations('Termius.exe', {}, [{ command: 'push', desired: desired() }], f.deps), /--restart/);
  assert.deepEqual(f.events, []);
  assert.equal(f.state().running, true);
});

test('batch writes back up once and verify in-place, then refresh only once', async () => {
  const f = fixture();
  const second = desired(); second.hosts[0].label = 'second';
  const result = await runOperations('Termius.exe', {}, [
    { command: 'push', desired: desired() },
    { command: 'push', desired: second },
    { command: 'verify' },
  ], f.deps);
  assert.equal(f.events.filter((e) => e === 'backup').length, 1);
  assert.equal(f.events.filter((e) => e === 'start-debug').length, 1);
  assert.equal(f.events.filter((e) => e === 'start-normal').length, 1);
  assert.equal(result[0].verified[0].auth, 'password');
  assert.equal(result[2].length, 2);
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.equal(f.records.hosts.length, 2);
});

test('backup failure aborts all writes and restores original running state', async () => {
  const f = fixture({ running: true, backupError: true });
  await assert.rejects(runOperations('Termius.exe', { restart: true }, [{ command: 'push', desired: desired() }], f.deps), /backup failed/);
  assert.equal(f.records.hosts.length, 0);
  assert.deepEqual(f.events, ['kill', 'backup', 'start-normal']);
});

test('verify and ordinary export redact credentials; explicit secrets export retains them', async () => {
  const f = fixture();
  await vm.runInNewContext(pushExpr('key', '/native', desired()), f.context);
  await vm.runInNewContext(pushExpr('key', '/native', { keys: { work: { private_key: 'PRIVATE-TEST-KEY', passphrase: 'PRIVATE-TEST-PASSPHRASE' } }, hosts: [{ label: 'key-host', address: '192.0.2.2', key: 'work' }] }), f.context);
  const keysOnly = await vm.runInNewContext(exportExpr('key', '/native', false, true), f.context);
  const verification = await vm.runInNewContext(verifyExpr('key', '/native'), f.context);
  const redacted = await vm.runInNewContext(exportExpr('key', '/native', false), f.context);
  const full = await vm.runInNewContext(exportExpr('key', '/native', true), f.context);
  assert.ok(!verification.includes(secret));
  assert.ok(!redacted.includes(secret));
  assert.ok(full.includes(secret));
  assert.ok(keysOnly.includes('PRIVATE-TEST-KEY'));
  assert.ok(!keysOnly.includes(secret));
  assert.ok(!keysOnly.includes('PRIVATE-TEST-PASSPHRASE'));
  assert.ok(full.includes('PRIVATE-TEST-PASSPHRASE'));
  assert.ok(!redacted.includes('PRIVATE-TEST-KEY'));
});

test('real CLI operation shapes are valid for export, verify, push and batch', async () => {
  for (const command of ['export', 'verify', 'push', 'batch']) {
    const f = fixture();
    const opts = { secrets: false, dryRun: true, desired: '/spec', file: '/batch' };
    const operations = operationsFor(command, opts, () => command === 'batch' ? { operations: [{ command: 'verify' }] } : desired());
    await runOperations('Termius.exe', opts, operations, f.deps);
    assert.equal(f.state().running, false);
  }
});
