#!/usr/bin/env python3
"""Expand a desired-hosts spec into the JSON consumed by `termius-ctl.js push`.

A spec may reference SSH private keys by path using `private_key_file`; this
helper inlines the key material (and its `.pub` sibling) so the Windows-side
controller receives a self-contained document.

Usage:
    prepare_desired.py <spec.(json|yaml)> <out.json>

The output contains secrets, so write it to a location with 0600 permissions
and delete it after use (the `termius.sh` driver does this automatically).
"""
import json
import os
import sys


def load_spec(path):
    with open(path, "r", encoding="utf-8") as fh:
        text = fh.read()
    if path.endswith((".yaml", ".yml")):
        try:
            import yaml  # type: ignore
        except ImportError:
            sys.exit("PyYAML is required for YAML specs; install pyyaml or use JSON")
        return yaml.safe_load(text)
    return json.loads(text)


def read_key(entry):
    path = entry.pop("private_key_file", None)
    if not path:
        return entry
    path = os.path.expanduser(path)
    with open(path, "r", encoding="utf-8") as fh:
        entry["private_key"] = fh.read()
    pub = path + ".pub"
    if os.path.exists(pub):
        with open(pub, "r", encoding="utf-8") as fh:
            parts = fh.read().split()
        if len(parts) >= 2:
            entry["public_key"] = parts[0] + " " + parts[1] + "\n"
    return entry


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    spec = load_spec(sys.argv[1])
    for name, entry in (spec.get("keys") or {}).items():
        spec["keys"][name] = read_key(dict(entry))
    with open(sys.argv[2], "w", encoding="utf-8") as fh:
        json.dump(spec, fh)
    os.chmod(sys.argv[2], 0o600)


if __name__ == "__main__":
    main()
