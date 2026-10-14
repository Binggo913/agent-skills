#!/usr/bin/env python3
"""Convert an OpenSSH client config into a `termius-vault` desired-hosts spec.

Accepts either a config file or an `.ssh` directory. Handles `Include`,
multiple/negated `Host` patterns, first-value-wins option resolution, and
resolves `IdentityFile` keys (including Windows paths such as `D:/.ssh/...`,
which are mapped to `/mnt/d/...` when running under WSL).

Output (stdout) is the same JSON document `termius.sh push` consumes, with
`private_key_file` entries that `prepare_desired.py` inlines later.

Usage:
    sshconfig_to_spec.py <config-or-ssh-dir>
"""
import fnmatch
import glob
import json
import os
import re
import sys

WIN_PATH = re.compile(r"^([A-Za-z]):[\\/](.*)$")


def to_local(p):
    """Map a Windows path to its WSL mount, leave POSIX paths untouched."""
    m = WIN_PATH.match(p)
    if m:
        return "/mnt/" + m.group(1).lower() + "/" + m.group(2).replace("\\", "/")
    return p


def split_line(line):
    line = line.strip()
    if not line or line.startswith("#"):
        return None
    m = re.match(r"^([A-Za-z][A-Za-z0-9]*)\s*(?:=|\s)\s*(.*)$", line)
    if not m:
        return None
    val = m.group(2).strip()
    if not val.startswith('"'):
        val = re.sub(r"\s+#.*$", "", val)
    return m.group(1).lower(), val


def parse_config(path, _seen=None):
    blocks = [{"patterns": [], "opts": {}}]  # leading global block
    cur = blocks[0]
    _seen = _seen or set()
    real = os.path.realpath(path)
    if real in _seen:
        return blocks
    _seen.add(real)
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        for raw in fh:
            kv = split_line(raw)
            if not kv:
                continue
            key, val = kv
            if key == "host":
                cur = {"patterns": val.split(), "opts": {}}
                blocks.append(cur)
            elif key == "include":
                for inc in val.split():
                    for p in glob.glob(to_local(os.path.expanduser(inc))):
                        if os.path.isfile(p):
                            blocks.extend(parse_config(p, _seen))
            else:
                cur["opts"].setdefault(key, []).append(val)
    return blocks


def host_matches(patterns, host):
    hit = False
    for pat in patterns:
        neg = pat.startswith("!")
        p = pat[1:] if neg else pat
        if fnmatch.fnmatch(host, p):
            if neg:
                return False
            hit = True
    return hit


def effective(blocks, host):
    opts = {}
    for b in blocks:
        if not b["patterns"]:
            for k, v in b["opts"].items():
                opts.setdefault(k, v)
        elif host_matches(b["patterns"], host):
            for k, v in b["opts"].items():
                opts.setdefault(k, v)
    return opts


def resolve(path, home, ssh_dir):
    path = path.strip('"')
    path = to_local(path)
    if path.startswith("~"):
        path = os.path.join(home, path[1:].lstrip("/\\"))
    elif not os.path.isabs(path):
        path = os.path.join(ssh_dir, path)
    return os.path.normpath(path)


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    src = to_local(sys.argv[1])
    cfg = os.path.join(src, "config") if os.path.isdir(src) else src
    if not os.path.isfile(cfg):
        sys.exit(f"no SSH config found at {cfg}")
    ssh_dir = os.path.dirname(os.path.abspath(cfg))
    home = os.path.dirname(ssh_dir)
    blocks = parse_config(cfg)

    names = []
    for b in blocks:
        for p in b["patterns"]:
            if any(c in p for c in "*?!") or p in names:
                continue
            names.append(p)

    keys = {}
    key_paths = {}
    hosts = []
    for h in names:
        o = effective(blocks, h)
        entry = {
            "label": h,
            "address": o.get("hostname", [h])[0],
            "port": int(o.get("port", ["22"])[0]),
        }
        if o.get("user"):
            entry["user"] = o["user"][0]
        idf = o.get("identityfile")
        if idf:
            kpath = resolve(idf[0], home, ssh_dir)
            if kpath not in key_paths:
                base = os.path.basename(kpath)
                name = base
                n = 1
                while name in keys and key_paths.get(keys[name]["private_key_file"]) != kpath:
                    n += 1
                    name = f"{base}-{n}"
                key_paths[kpath] = name
                keys[name] = {"private_key_file": kpath}
            entry["key"] = key_paths[kpath]
            if not os.path.exists(kpath):
                sys.stderr.write(f"warning: key file missing: {kpath}\n")
        hosts.append(entry)

    json.dump({"keys": keys, "hosts": hosts}, sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
