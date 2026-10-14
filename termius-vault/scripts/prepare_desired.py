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


def expand_spec(spec):
    if not isinstance(spec, dict) or not isinstance(spec.get("hosts"), list):
        raise ValueError("spec requires a hosts array")
    spec.setdefault("keys", {})
    if not isinstance(spec["keys"], dict):
        raise ValueError("spec keys must be an object")
    for name, entry in spec["keys"].items():
        spec["keys"][name] = read_key(dict(entry))
    return spec


def prepare_batch(source):
    plan = load_spec(source)
    if not isinstance(plan, dict) or not isinstance(plan.get("operations"), list):
        raise ValueError("batch requires an operations array")
    base = os.path.dirname(os.path.abspath(source))
    cache = {}
    for operation in plan["operations"]:
        if not isinstance(operation, dict) or operation.get("command") not in ("export", "verify", "push"):
            raise ValueError("batch supports export, verify and push")
        allowed = {"command", "secrets", "keys"} if operation["command"] == "export" else (
            {"command", "desired", "dryRun"} if operation["command"] == "push" else {"command"}
        )
        if set(operation) - allowed:
            raise ValueError("unsupported batch operation field")
        for flag in ("secrets", "dryRun", "keys"):
            if flag in operation and not isinstance(operation[flag], bool):
                raise ValueError(f"{flag} must be boolean")
        if operation["command"] == "push":
            spec = operation.get("desired")
            if isinstance(spec, str):
                path = os.path.realpath(os.path.join(base, os.path.expanduser(spec)))
                if path not in cache:
                    cache[path] = expand_spec(load_spec(path))
                operation["desired"] = cache[path]
            else:
                operation["desired"] = expand_spec(spec)
    return plan


def main():
    batch = len(sys.argv) > 1 and sys.argv[1] == "--batch"
    args = sys.argv[2:] if batch else sys.argv[1:]
    if len(args) != 2:
        sys.exit("Usage: prepare_desired.py [--batch] <source.json|yaml> <output.json>")
    output = prepare_batch(args[0]) if batch else expand_spec(load_spec(args[0]))
    # Restrict before writing, rather than chmod after secrets already exist.
    fd = os.open(args[1], os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(output, fh)


if __name__ == "__main__":
    main()
