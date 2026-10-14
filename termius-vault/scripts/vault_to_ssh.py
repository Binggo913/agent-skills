#!/usr/bin/env python3
"""Add Termius-exported hosts to an explicit OpenSSH directory; never save passwords.

Reads JSON from stdin or --from. Does not launch Termius. The WSL driver can pipe
one vault export into this writer. macOS uses the POSIX path in theory only.
"""
import argparse
import fnmatch
import glob
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tempfile

HEADER = '# Managed by termius-vault; add-only host entries.\n'


def local_path(value):
    match = re.match(r'^([A-Za-z]):[\\/](.*)$', value)
    if match and os.name != 'nt':
        value = '/mnt/' + match[1].lower() + '/' + match[2].replace('\\', '/')
    return Path(value).expanduser().absolute()


def windows_path(path):
    if os.name == 'nt':
        return str(path).replace('\\', '/')
    if not re.match(r'^/mnt/[a-z]/', str(path)):
        raise ValueError('Windows target must be on a Windows drive, not the WSL filesystem')
    return subprocess.check_output(['wslpath', '-w', str(path)], text=True).strip().replace('\\', '/')


def quoted(value):
    if not isinstance(value, str) or any(c in value for c in '\r\n\0'):
        raise ValueError('Invalid multiline SSH configuration value')
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"') + '"'


def read_file(path):
    if path.is_symlink():
        raise ValueError('Refusing to modify or follow a symlink in the export target')
    return path.read_text(encoding='utf-8') if path.exists() else ''


def include_path(name, root):
    name = name.replace('\\', '/')
    if name.startswith('~/'):
        return root.parent / name[2:]
    return local_path(name) if name.startswith('/') or re.match(r'^[A-Za-z]:', name) else root / name


def has_include(text, managed, root):
    for line in text.splitlines():
        words = shlex.split(line, comments=True)
        if words and words[0].lower() == 'include':
            if any(fnmatch.fnmatchcase(str(managed), str(include_path(name, root))) for name in words[1:]):
                return True
    return False


def host_patterns(path, root, seen=None):
    """Conservative collision detection, not an ssh -G replacement."""
    seen = set() if seen is None else seen
    path = Path(os.path.abspath(path))
    if path in seen or not path.is_file():
        return []
    seen.add(path)
    patterns = []
    for line in read_file(path).splitlines():
        words = shlex.split(line, comments=True)
        if not words:
            continue
        keyword = words[0].lower()
        if keyword == 'host':
            # Generic defaults do not reserve every alias. Specific patterns do.
            if any(p != '*' and not p.startswith('!') for p in words[1:]):
                patterns.append(words[1:])
        elif keyword == 'include':
            for name in words[1:]:
                candidate = include_path(name, root)
                for included in sorted(glob.glob(str(candidate))):
                    patterns.extend(host_patterns(Path(included), root, seen))
    return patterns


def matches(alias, patterns):
    return any(any(fnmatch.fnmatchcase(alias.casefold(), p.casefold()) for p in group if not p.startswith('!')) and
               not any(fnmatch.fnmatchcase(alias.casefold(), p[1:].casefold()) for p in group if p.startswith('!')) for group in patterns)


def plan_export(data, target, platform, keys=False, only=(), exclude=()):
    if not isinstance(data, dict) or not isinstance(data.get('hosts'), list):
        raise ValueError('Input must be a Termius export with a hosts array')
    config, managed = target / 'config', target / 'config.termius'
    original, old_managed = read_file(config), read_file(managed)
    baselines = {config: original, managed: old_managed}
    if old_managed and not old_managed.startswith(HEADER):
        raise ValueError('config.termius already exists and is not managed by this tool')
    patterns = host_patterns(config, target) + host_patterns(managed, target)
    convert = windows_path if platform == 'windows' else lambda p: str(p)
    include = 'Include ' + quoted(convert(managed)) + '\n'
    blocks, files, added, skipped, warnings, used = [], {}, [], [], [], set()
    for host in data['hosts']:
        if not isinstance(host, dict):
            raise ValueError('Invalid host record')
        label = host.get('label') or host.get('address')
        if not isinstance(label, str):
            raise ValueError('Host label/address is missing')
        if only and not any(fnmatch.fnmatchcase(label, p) for p in only):
            continue
        if any(fnmatch.fnmatchcase(label, p) for p in exclude):
            continue
        alias = re.sub(r'[^A-Za-z0-9._-]', '_', label)[:100].lstrip('-') or 'termius-host'
        if alias in used:
            digest = hashlib.sha256(json.dumps([label, host.get('address'), host.get('port'), host.get('user')]).encode()).hexdigest()[:10]
            alias += '-' + digest
        if alias in used:
            continue
        used.add(alias)
        if matches(alias, patterns):
            skipped.append(alias)
            continue
        address = host.get('address')
        if not isinstance(address, str) or not address or any(c.isspace() for c in address):
            raise ValueError('Host address must be nonempty and contain no whitespace')
        port = host.get('port') or 22
        if not isinstance(port, int) or not 1 <= port <= 65535:
            raise ValueError('Host port must be between 1 and 65535')
        lines = ['Host ' + alias, '    HostName ' + quoted(address), '    Port ' + str(port)]
        if host.get('user'):
            lines.append('    User ' + quoted(host['user']))
        private = host.get('private_key')
        if keys and private:
            if not isinstance(private, str) or not re.match(r'^-----BEGIN (?:OPENSSH |RSA |EC |DSA |ENCRYPTED )?PRIVATE KEY-----', private.strip()):
                raise ValueError('Key format is not an OpenSSH/PEM private key; conversion must be handled separately')
            private = private.strip() + '\n'
            name = 'key_' + hashlib.sha256(private.encode()).hexdigest()[:24]
            key_path = target / 'termius_keys' / name
            files[key_path] = private
            if host.get('public_key'):
                public = host['public_key']
                if not isinstance(public, str) or '\n' in public.strip():
                    raise ValueError('Invalid public key record')
                files[Path(str(key_path) + '.pub')] = public.strip() + '\n'
            lines += ['    IdentityFile ' + quoted(convert(key_path)), '    IdentitiesOnly yes']
            if host.get('passphrase'):
                warnings.append(alias + ': enter the key passphrase yourself; it is not saved')
        elif host.get('auth') == 'key' or host.get('key_label') or private:
            warnings.append(alias + (': private key unavailable in source; use a keys-enabled export or configure IdentityFile' if keys else ': no IdentityFile exported; use --keys or configure an existing local key'))
        if host.get('auth') == 'password' or host.get('password'):
            warnings.append(alias + ': password is not saved; authentication remains interactive')
        blocks.append('\n'.join(lines) + '\n')
        added.append(alias)
    for path, content in files.items():
        if os.path.lexists(path) and read_file(path) != content:
            raise ValueError('A generated key path already contains different data; refusing to overwrite')
    if platform == 'macos':
        warnings.append('macOS is theoretical/unverified: assess paths, permissions and installed SSH on the target machine')
        if sys.platform != 'darwin':
            warnings.append('Not running on a Mac: absolute paths must be adapted before using these files there')
    if added:
        # Reset Host context at the boundary so existing global options remain global.
        if old_managed.endswith('Host *\n'):
            old_managed = old_managed[:-7]
        files[managed] = (old_managed or HEADER) + '\n' + '\n'.join(blocks) + '\nHost *\n'
        if not has_include(original, managed, target):
            files[config] = '# termius-vault managed include\n' + include + '\n' + original
    return files, {'target': str(target), 'platform': platform, 'added': added, 'skipped': skipped,
                   'key_files': [str(p) for p in files if p.parent.name == 'termius_keys' and not p.name.endswith('.pub')],
                   'warnings': warnings}, baselines


def restrict_windows(paths):
    helper = Path(__file__).parent / 'win' / 'ssh-acl.ps1'
    helper = str(helper) if os.name == 'nt' else subprocess.check_output(['wslpath', '-w', str(helper)], text=True).strip()
    result = subprocess.run(['powershell.exe', '-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', helper],
                            input=json.dumps([windows_path(p) for p in paths]), text=True, capture_output=True,
                            **({'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {}))
    if result.returncode:
        raise ValueError('Windows ACL restriction failed; credentials were not written')


def write_files(target, files, platform, baselines):
    if not files:
        return []
    # A stable directory prevents concurrent exports from racing on the include.
    new_root = not target.exists()
    target.mkdir(mode=0o700, parents=True, exist_ok=True)
    lock = target / '.termius-vault-export.lock'
    try:
        lock.mkdir(mode=0o700)
    except FileExistsError:
        raise ValueError('Export lock exists; confirm no writer is running before removing a stale lock') from None
    staged, backups, restricted = [], [], [target] if new_root else []
    try:
        if any(read_file(path) != content for path, content in baselines.items()):
            raise ValueError('Configuration changed during export; retry after the other writer finishes')
        for path, content in files.items():
            existed = path.exists()
            if existed and path.parent.name == 'termius_keys':
                # Exact managed key content was checked before acquiring the lock.
                if read_file(path) != content:
                    raise ValueError('Target changed during export; no overwrite allowed')
                restricted.append(path)
                continue
            parent = path.parent
            if parent.is_symlink():
                raise ValueError('Managed key directory must not be a symlink')
            if not parent.exists():
                parent.mkdir(mode=0o700)
                restricted.append(parent)
            fd, temp = tempfile.mkstemp(prefix='.termius-vault-', dir=parent)
            os.close(fd)
            staged.append((Path(temp), path, content, existed))
            restricted.append(Path(temp))
            if existed:
                fd, backup = tempfile.mkstemp(prefix=path.name + '.backup-', dir=target)
                os.close(fd)
                backup = Path(backup)
                backups.append((backup, read_file(path)))
                restricted.append(backup)
        # Secure empty files BEFORE putting credentials into them. Use one helper,
        # not a new PowerShell/console process for every individual key.
        if platform == 'windows':
            restrict_windows(restricted)
        else:
            for path in restricted:
                os.chmod(path, 0o700 if path.is_dir() else 0o600)
        for path, old in backups:
            path.write_text(old, encoding='utf-8')
        for temp, path, content, existed in staged:
            temp.write_text(content, encoding='utf-8')
            if existed:
                os.replace(temp, path)
            else:
                # Publish without overwriting a file created by another process.
                os.link(temp, path)
        return [str(p) for p, _ in backups]
    finally:
        for temp, *_ in staged:
            temp.unlink(missing_ok=True)
        lock.rmdir()


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('target', help='explicit destination .ssh directory')
    ap.add_argument('--from', dest='source', help='JSON export file; otherwise stdin')
    ap.add_argument('--platform', choices=['auto', 'posix', 'windows', 'macos'], default='auto')
    ap.add_argument('--keys', action='store_true', help='explicitly allow writing private keys')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--only', action='append', default=[])
    ap.add_argument('--exclude', action='append', default=[])
    args = ap.parse_args(argv)
    target = local_path(args.target)
    # Refuse redirecting the destination through links, including parent links.
    if any(p.is_symlink() for p in [target, *target.parents]):
        raise ValueError('Destination must not contain symlinks; choose its explicit real path')
    platform = args.platform
    windows_drive = bool(re.match(r'^/mnt/[a-z]/', str(target)) and shutil.which('wslpath'))
    if platform == 'auto':
        platform = 'windows' if os.name == 'nt' or windows_drive else ('macos' if sys.platform == 'darwin' else 'posix')
    if platform != 'windows' and (os.name == 'nt' or windows_drive):
        raise ValueError('A Windows-drive target needs Windows ACLs, not the POSIX permission path')
    with open(args.source, encoding='utf-8') if args.source else sys.stdin as stream:
        data = json.load(stream)
    globs = lambda values: [p for value in values for p in value.split(',') if p]
    files, out, baselines = plan_export(data, target, platform, args.keys, globs(args.only), globs(args.exclude))
    out['dry_run'] = args.dry_run
    out['backups'] = [] if args.dry_run else write_files(target, files, platform, baselines)
    print(json.dumps(out, ensure_ascii=True, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (json.JSONDecodeError, UnicodeError):
        print('export-ssh: malformed export/config input (contents withheld)', file=sys.stderr)
        sys.exit(1)
    except ValueError as error:
        print('export-ssh: ' + str(error), file=sys.stderr)
        sys.exit(1)
    except (OSError, subprocess.SubprocessError):
        # Subprocess diagnostics can contain credential-bearing input.
        print('export-ssh: filesystem/permission helper failed; check target and permissions (contents withheld)', file=sys.stderr)
        sys.exit(1)
