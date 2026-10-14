---
name: termius-vault
description: Read, export, verify, or import hosts/keys/passwords for the Termius desktop SSH client on Windows by decrypting its local vault and, optionally, writing records back through Termius' own database. Use when a task involves inspecting or backing up Termius hosts, migrating an SSH config into Termius, bulk-adding hosts and identities (keys or passwords) to Termius, or verifying Termius host→identity→key mappings.
license: MIT
compatibility: Termius desktop read/write implemented for Windows, driven from WSL/Linux (uses cmd.exe and wslpath). SSH-config parsing is portable; macOS is plausible but unimplemented and untested. Uses Termius' bundled Electron/Node runtime, so no separate Node.js or npm install is needed.
disable-model-invocation: true
metadata:
  platform: windows
  category: ssh
---

# Termius Vault

> **This skill never activates on its own.** `disable-model-invocation` is set,
> so it is excluded from the system prompt and costs **no tokens unless you use
> it**. Invoke it explicitly with the command below.
>
> ```
> /skill:termius-vault
> ```
>
> If you prefer the model to be able to pick it up automatically from a task
> description, remove `disable-model-invocation: true` from the frontmatter.

Talk to the local [Termius](https://termius.com) desktop vault on Windows: read
it, print it, or push new hosts/identities into it. Everything runs against the
**current user's own machine and own credentials** — the skill never sends data
anywhere except back into Termius itself.

## When to use this skill

- "What hosts / keys / known_hosts do I have in Termius?"
- "Export my Termius hosts" or "back up my Termius keys".
- "Import this `~/.ssh/config` into Termius" / "add these hosts to Termius".
- "Why can't Termius connect to host X — is the right key attached?"
- Bulk add/rename hosts and identities instead of clicking through the UI.

If the goal is only "get a plain SSH client config", prefer Termius' built-in
*Import from SSH config*; use this skill when you need read access to an
existing vault or scripted/bulk writes.

## How it works (short)

1. Termius stores its vault encrypted with a per-user **local key**. On Windows
   that key lives in Credential Manager under `Termius/localKey`.
2. The key decrypts an IndexedDB database (`%APPDATA%\Termius\IndexedDB`) whose
   records are Dexie objects; individual fields and a `content` blob are
   libsodium `xsalsa20poly1305` ciphertexts.
3. This skill reads the key, then uses Termius' **own native crypto module**
   (`app.asar.unpacked/.../libtermius/termius.node`) and Termius' **Electron
   runtime** (`Termius.exe` with `ELECTRON_RUN_AS_NODE=1`) to decrypt/encrypt.
4. For reads and writes it attaches to Termius' `background-process` renderer
   over the Chrome DevTools Protocol and uses the same IndexedDB the app uses.

See `references/termius-format.md` for the exact record shapes.

## Commands

Run the driver from this skill directory:

```bash
scripts/termius.sh doctor                 # environment + crypto sanity check
scripts/termius.sh export                 # hosts + known_hosts (secrets redacted)
scripts/termius.sh export --secrets       # include passwords / private keys
scripts/termius.sh verify                 # host → identity → key/password table
scripts/termius.sh push <spec.json>       # add missing hosts/keys from a spec
scripts/termius.sh push <spec.json> --dry-run
scripts/termius.sh import <ssh-dir|config> # add hosts parsed from an SSH config
scripts/termius.sh import ~/.ssh --dry-run
```

Flags:

- `--restart` — allow the tool to close and reopen Termius when it is running
  without the DevTools port. Without it, a running app causes a clear error.
- `--secrets` — export passwords and private keys (default: omitted).
- `--keep-debug` — leave Termius running with the DevTools port after
  `export`/`verify`/`push --dry-run` instead of restoring normal mode.

`push` always: closes any running Termius, backs up the IndexedDB directory,
writes the new records, then restarts Termius normally so it can sync.

## Importing an existing SSH config

`import` parses an OpenSSH `config` (handling `Include`, multiple/negated
`Host` patterns, and `IdentityFile`), builds the same spec `push` uses, and
adds every missing host. Existing hosts (matched by ssh alias / label) are
skipped, so it is idempotent.

The source can be any `.ssh` directory or config file **visible from the
machine running the driver**. Common cases on this setup:

| Source | Path to pass |
|---|---|
| WSL (Linux) `~/.ssh` | `~/.ssh` |
| Windows host `%USERPROFILE%\.ssh` | `/mnt/c/Users/<user>/.ssh` (or a `C:/...`/`D:/...` path; Windows paths in `IdentityFile`/`Include` are mapped to `/mnt/<drive>/...`) |

Import both in one go, for example:

```bash
scripts/termius.sh import ~/.ssh --dry-run
scripts/termius.sh import /mnt/c/Users/<user>/.ssh
```

`import` reuses the `push` write path, so it is **only as platform-portable as
Termius write access is** (see Platforms). The parsing itself is pure Python and
runs anywhere.

## Pushing hosts: the spec file

`push` takes a JSON or YAML document. Keys may be referenced by file:

```json
{
  "keys": {
    "work-ed25519": { "private_key_file": "~/.ssh/id_ed25519_work" }
  },
  "hosts": [
    { "label": "build-arm", "address": "10.0.0.10", "port": 2201,
      "user": "alice", "key": "work-ed25519" },
    { "label": "jump-legacy", "address": "10.0.0.20", "port": 22,
      "user": "alice", "password": "REPLACE_ME" }
  ]
}
```

- `keys[].private_key_file` is inlined automatically (its `.pub` sibling is read
  for `public_key`). You may instead pass `private_key` / `public_key` /
  `passphrase` inline.
- `hosts[]` uses either `key: <keys name>` (public-key auth) or `password:`.
- Existing hosts are matched by `label` and skipped, so the command is
  idempotent — safe to re-run after adding entries.
- See `references/examples/`.

## Safety and hygiene

- Operates only on the local user's Termius data; no network calls.
- `export` redacts secrets unless `--secrets` is given.
- `push` never deletes hosts or keys; it only adds missing ones.
- `push` backs up `%APPDATA%\Termius\IndexedDB` before writing.
- The generated desired-JSON contains secrets; the driver writes it to the
  Windows temp dir, uses it, and removes it on exit. Treat exported `--secrets`
  output as sensitive.
- Publishing/using this against data you do not own may violate Termius' terms;
  use it on your own machine and your own account.

## Platforms

The SSH-config **parsing** (`sshconfig_to_spec.py`) and the `push` **spec
format** are platform-neutral. What differs per OS is talking to the local
Termius install:

- **Windows host + WSL — supported and tested.** The controller reads the local
  key from Credential Manager, uses `%LOCALAPPDATA%\Programs\Termius\...`,
  and drives Termius through CDP.
- **macOS — plausible, treat as experimental.** Termius is also Electron on
  macOS, so the same CDP approach should work, but the platform glue differs and
  is **not implemented or tested** here:
  - local key: Keychain, not Credential Manager;
  - vault path: `~/Library/Application Support/Termius`;
  - native module: `.../libtermius/mac-arm64/termius.node` (or `mac-x64`);
  - app: `Termius.app`, not `Termius.exe`.

  The intended use is "import this Mac's own `~/.ssh` into Termius". Do not
  assume it works: run `doctor` first, adapt `termius-ctl.js` / add a
  `cred-read` equivalent for Keychain, and verify on the target machine before
  relying on any write. **Let the situation decide** — a Unix-like host does not
  by itself guarantee the Termius side is wired up.

## Troubleshooting

- **`Termius/localKey not found`** — Termius has never been opened on this
  Windows account, or you are not the user who owns the credential.
- **`Termius is running without CDP`** — re-run with `--restart`.
- **Sign-in/upgrade changed the format** — re-check `references/termius-format.md`
  against the installed version; record shapes can change between releases.
- **Writes don't appear** — Termius must restart to sync; `push` does this, but
  confirm the app finished starting before checking `verify`.
