# Termius local vault format (notes)

Reverse-engineering notes gathered from a Windows Termius desktop install.
Field names and schemas can change between releases; treat this as a map, not a
contract, and re-verify after upgrades.

## Storage layout

| Path | Contents |
|---|---|
| `%APPDATA%\Termius\IndexedDB\file__0.indexeddb.leveldb` | Dexie/IndexedDB vault (hosts, keys, known_hosts, history, …) |
| `%APPDATA%\Termius\Local Storage\leveldb` | app settings (JSON-ish), current user/team info |
| `%APPDATA%\Termius\session-logs-v2\*.log` | encrypted terminal session logs |
| `%APPDATA%\Termius\Local State` | Electron `os_crypt` key (DPAPI-wrapped) — not needed for the vault |
| Credential Manager → `Termius/localKey` | base64 of the 32-byte **local vault key** |
| `%LOCALAPPDATA%\Programs\Termius\resources\app.asar.unpacked\node_modules\@termius\libtermius\win-x64\termius.node` | native crypto module (libsodium) |

The IndexedDB origin is `file://` (`file__0`), which is why a `file://` page
sharing the same `userData` directory sees the same database.

## The local key

`Termius/localKey` is a CRED_TYPE_GENERIC credential whose blob is the UTF-8
text of a base64 string, e.g. `<44 chars>`. Decoding it yields 32 bytes used as
the key for `crypto.systems.FromEncryptionKey`.

Termius itself obtains it via keytar (`getPassword('Termius')`) and caches it in
the `settings` store as `localKey`. If Credential Manager has no entry but the
app is signed in, the cached settings value is an alternative source.

## Crypto module usage

```js
const native = require('.../@termius/libtermius/win-x64/termius.node');
const c = native.crypto; c.init();
const sys = c.systems.FromEncryptionKey(Buffer.from(localKey_b64, 'base64'));
const plaintext = sys.decrypt(Buffer.from(ciphertext_b64, 'base64')).toString('utf8');
const ct = sys.encrypt(Buffer.from('secret', 'utf8')).toString('base64');
```

- Algorithm: libsodium `xsalsa20poly1305` (symmetric) and
  `curve25519xsalsa20poly1305` (key pairs).
- Version enumeration: `c.versions` → `{Unknown:0, Version1:1, …, Default:4}`.
- Helpers: `c.utils.generateEncryptionKey`, `c.utils.getVersionFromCiphertext`
  (takes a **Buffer**, not a string).
- Ciphertext version detection by base64 first char: `B`→4 (sodium), `A`→3
  (legacy RNCryptor). Locally stored records use the sodium scheme.

`Termius.exe` can act as a Node runtime via `ELECTRON_RUN_AS_NODE=1`, which is
the easiest way to `require` the module with a compatible ABI.

## Database schema (Dexie)

Each logical collection is its own IndexedDB database (named in `dbName`), with
one object store and `keyPath: local_id, autoIncrement: true`, indexes
`&local_id, &id, status`.

Relevant databases/stores:

| dbName | store | role |
|---|---|---|
| `hosts` | `hosts` | host entries (references an `ssh_configs` row) |
| `ssh_configs` | `ssh_configs` | connection parameters (port, identity ref, …) |
| `ssh_identities` | `ssh_identities` | credentials (username/password or key ref) |
| `keys` | `keys` | SSH key pairs |
| `ssh_config_identities` | `ssh_config_identities` | link table (config ↔ identity) |
| `known_hosts` | `known_hosts` | host key pins |
| `activities` | `activities` | connection history |
| `settings` | `settings` | `localKey`, `last_sync`, user/team blob |

## Record shapes

Common fields on syncable entities: `id`, `local_id`, `updated_at`,
`encrypted_with`, `is_shared`, `status`, `changedFields`.

Encryption rules:

- Fields listed in the model's `cryptoFields` (plus any `content`) are stored as
  base64 sodium ciphertext.
- Only `content` is JSON-stringified before encryption; other crypto fields are
  encrypted as raw strings.
- `serializableFields` defaults to `["content"]`.

### hosts

`cryptoFields`: `address, label, cloud_instance_id, cloud_instance_type`
`plainFields`: `backspace, ip_version, os_name`

```jsonc
{
  "local_id": 0, "id": 0, "updated_at": "YYYY-MM-DDTHH:MM:SS",
  "ssh_config": { "id": 0, "local_id": 0 }, "group": null, "telnet_config": null,
  "encrypted_with": null, "is_shared": false, "credentials_mode": null,
  "address": "<ct>", "label": "<ct>", "backspace": "default",
  "ip_version": "AUTO", "os_name": "",
  "content": "<ct of JSON>", "status": "SYNCHRONIZED"
}
```

`content` plaintext:
`{"version":1,"address":…,"label":…,"backspace":"default","ip_version":"AUTO","os_name":…}`

### ssh_configs

```jsonc
{
  "port": 22, "identity": { "id": 0, "local_id": 0 },
  "proxycommand": null, "startup_snippet": null, "pam": null,
  "env_variables": "<ct>", "charset": null, "mosh_server_command": "<ct>",
  "use_mosh": false, "content": "<ct>", "status": "SYNCHRONIZED"
}
```

`content` plaintext:
`{"version":1,"env_variables":"{}","charset":null,"port":22,"mosh_server_command":"mosh-server new -s -l LANG=en_US.UTF-8","use_mosh":false}`

### ssh_identities

`cryptoFields`: `label, password, username`

```jsonc
{
  "ssh_key": { "id": 0, "local_id": 0 } | null, "sshid_mode": null,
  "username": "<ct>", "password": "<ct>", "label": "<ct>",
  "is_visible": false, "content": "<ct>"
}
```

`content` plaintext:
`{"version":1,"label":…,"password":…,"username":…,"is_visible":false}`

### keys

`cryptoFields`: `label, passphrase, private_key, public_key`

`content` plaintext:
`{"passphrase":…,"private_key":…,"public_key":…,"label":…,"version":1}`

## Application access

The driver reads the local key from Windows Credential Manager, then runs
Termius's native crypto module in its own bundled Electron/Node runtime. Vault
expressions execute in the app's background renderer over loopback CDP; no
separate Windows Node/npm install or LevelDB parser is required. These are
reverse-engineered interfaces and may change after upgrades.

## Sync semantics

`status` values include `SYNCHRONIZED`, `WRITING`, `UPLOADING`,
`UPLOAD_COMPLETE`, `UPLOAD_FAILED`, `UPDATE_FAILED`, `CREATE_FAILED`,
`DELETE_FAILED`, `DELETED`.

New local records are created without a remote `id` and with a
"needs-create" status; on the next sync Termius assigns server ids and flips
them to `SYNCHRONIZED`. Practically, that means:

1. Insert the full record graph (key → identity → ssh_config → host → link).
2. Restart Termius.
3. It syncs and the host appears in the UI with a server id.

The CDP write itself requires the app to be running. The controller stops it
for a physical backup, starts one debugging instance for the entire task, and
restarts normally only once after all additions. See [commands.md](commands.md)
for lifecycle/permission details. Local verification does not confirm cloud
sync or UI visibility; multi-database writes are not atomic.

## Reading through CDP

Launching Termius with `--remote-debugging-address=127.0.0.1 --remote-debugging-port=<port>`
exposes a `page` target whose URL contains `background-process`. Evaluating JS
in that target gives access to `indexedDB` (same origin as the vault) and to
`require` (Node integration), so both the DB and the native crypto module can be
used from a single expression. This avoids parsing Chromium's LevelDB format by
hand.
