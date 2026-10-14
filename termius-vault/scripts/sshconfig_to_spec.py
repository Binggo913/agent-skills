#!/usr/bin/env python3
"""Prepare merged, add-only host specs from one or more SSH config files/directories.

Extracts concrete aliases and basic HostName/User/Port/IdentityFile options.
This is not ssh -G: complex Include/Match/proxy/token semantics are not migrated.
Windows paths are mapped to WSL mounts. Output references key files; it never
reads private-key contents. See references/import.md for limits.
"""
import fnmatch
import glob
import json
import os
import re
import shlex
import sys
import argparse

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


def parse_config(path, _seen=None, _root=None):
    blocks = [{"patterns": [], "opts": {}}]  # leading global block
    cur = blocks[0]
    _seen = set() if _seen is None else _seen
    _root = _root or os.path.dirname(os.path.abspath(path))
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
                for inc in shlex.split(val.replace("\\", "/"), comments=True):
                    inc = to_local(inc)
                    if inc.startswith("~"):
                        inc = os.path.join(os.path.dirname(_root), inc[1:].lstrip("/"))
                    elif not os.path.isabs(inc):
                        inc = os.path.join(_root, inc)
                    for p in sorted(glob.glob(inc)):
                        if os.path.isfile(p):
                            blocks.extend(parse_config(p, _seen, _root))
            else:
                if key in {"hostname", "user", "port", "identityfile"} and val[:1] in {'"', "'"}:
                    words = shlex.split(val, comments=True)
                    if len(words) != 1:
                        raise ValueError("Unsupported scalar SSH option value")
                    val = words[0]
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


def source_to_spec(source, keep=lambda label: True):
    src = to_local(source)
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
        if not keep(h):
            continue
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
                while name in keys:
                    n += 1
                    name = f"{base}-{n}"
                key_paths[kpath] = name
                keys[name] = {"private_key_file": kpath}
            entry["key"] = key_paths[kpath]
            if not os.path.exists(kpath):
                sys.stderr.write(f"warning: key file missing: {kpath}\n")
        hosts.append(entry)

    return {"keys": keys, "hosts": hosts}


def merge_specs(specs):
    """First source wins duplicate aliases; share keys only by resolved file path."""
    hosts, keys, paths, labels = [], {}, {}, set()
    for spec in specs:
        for host in spec["hosts"]:
            if host["label"] in labels:
                continue
            labels.add(host["label"])
            if host.get("key"):
                original = host["key"]
                key = spec["keys"][original]
                filename = os.path.realpath(key["private_key_file"])
                if filename not in paths:
                    name, n = original, 1
                    while name in keys:
                        n += 1
                        name = f"{original}-{n}"
                    paths[filename] = name
                    keys[name] = key
                host = {**host, "key": paths[filename]}
            hosts.append(host)
    return {"keys": keys, "hosts": hosts}


def main():
    ap = argparse.ArgumentParser(
        description="Convert an OpenSSH config into a termius-vault desired-hosts spec."
    )
    ap.add_argument("sources", nargs="+", help="SSH config file or .ssh directory")
    ap.add_argument(
        "--only", action="append", default=[], metavar="GLOB",
        help="only include host aliases matching GLOB (repeatable / comma-separated)",
    )
    ap.add_argument(
        "--exclude", action="append", default=[], metavar="GLOB",
        help="skip host aliases matching GLOB (repeatable / comma-separated)",
    )
    args = ap.parse_args()

    def globs(values):
        return [p for chunk in values for p in chunk.split(",") if p]

    only = globs(args.only)
    exclude = globs(args.exclude)

    def keep(label):
        if only and not any(fnmatch.fnmatch(label, p) for p in only):
            return False
        return not any(fnmatch.fnmatch(label, p) for p in exclude)

    spec = merge_specs(source_to_spec(source, keep) for source in args.sources)
    json.dump(spec, sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
