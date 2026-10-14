"""Minimal regressions for merged import and plaintext-temp cleanup; no live vault."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
spec = importlib.util.spec_from_file_location('sshconfig', SCRIPTS / 'sshconfig_to_spec.py')
sshconfig = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sshconfig)


class PreparationTests(unittest.TestCase):
    def test_merge_first_alias_wins_and_distinct_keys_remain_distinct(self):
        with tempfile.TemporaryDirectory() as root:
            sources = []
            for name in ['first', 'second']:
                source = Path(root) / name
                source.mkdir()
                (source / 'config').write_text(f'Host same {name}\n IdentityFile id_work\n')
                (source / 'id_work').write_text('SYNTHETIC-KEY-' + name)
                sources.append(str(source))
            out = sshconfig.merge_specs(sshconfig.source_to_spec(p) for p in sources)
            self.assertEqual([h['label'] for h in out['hosts']], ['same', 'first', 'second'])
            self.assertEqual(len(out['keys']), 2)
            self.assertNotEqual(out['hosts'][1]['key'], out['hosts'][2]['key'])

    def test_driver_cleans_plaintext_temp_after_success_and_failures(self):
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            bin_dir, local = base / 'bin', base / 'Local'
            bin_dir.mkdir()
            temp = local / 'Temp'
            temp.mkdir(parents=True)
            helpers = {
                'wslpath': r"import sys; print(sys.argv[2].replace('\\', '/') if sys.argv[1] == '-u' else sys.argv[2])",
                'cmd.exe': "import os,sys; print(os.environ['MOCK_LOCAL']) if 'echo %LOCALAPPDATA%' in sys.argv else sys.exit(int(os.environ.get('MOCK_FAIL','0')))",
            }
            for name, code in helpers.items():
                path = bin_dir / name
                path.write_text('#!' + sys.executable + '\n' + code + '\n')
                path.chmod(0o755)
            source = base / 'desired.json'
            env = {**os.environ, 'PATH': str(bin_dir) + ':' + os.environ['PATH'], 'MOCK_LOCAL': str(local)}
            valid = {'hosts': [], 'keys': {}}
            missing_key = {'hosts': [], 'keys': {'work': {'private_key_file': str(base / 'missing')}}}
            for desired, status in [(valid, 0), (valid, 7), (missing_key, 0)]:
                with self.subTest(controller_status=status, missing_key=desired is missing_key):
                    source.write_text(json.dumps(desired))
                    result = subprocess.run(['bash', str(SCRIPTS / 'termius.sh'), 'push', str(source)],
                                            env={**env, 'MOCK_FAIL': str(status)}, capture_output=True, text=True)
                    self.assertEqual(result.returncode == 0, desired is valid and status == 0)
                    self.assertEqual(list(temp.iterdir()), [])


    def test_reverse_export_is_add_only_idempotent_and_roundtrips_basic_hosts(self):
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            target = base / '.ssh'
            target.mkdir(mode=0o700)
            original = 'Host existing\n HostName 192.0.2.99\n\nHost *\n ServerAliveInterval 30\n'
            (target / 'config').write_text(original)
            data = {'hosts': [
                {'label': 'existing', 'address': '192.0.2.1'},
                {'label': 'new host', 'address': '192.0.2.2', 'user': 'alice', 'port': 2201, 'auth': 'key',
                 'private_key': '-----BEGIN OPENSSH PRIVATE KEY-----\nSYNTHETIC\n-----END OPENSSH PRIVATE KEY-----\n',
                 'password': 'NEVER-SAVE-PASSWORD', 'passphrase': 'NEVER-SAVE-PASSPHRASE'},
            ]}
            source = base / 'export.json'
            source.write_text(json.dumps(data))
            command = ['bash', str(SCRIPTS / 'termius.sh'), 'export-ssh', str(target), '--from', str(source), '--keys']
            first = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(first.returncode, 0, first.stderr)
            result = json.loads(first.stdout)
            self.assertEqual(result['added'], ['new_host'])
            self.assertEqual(result['skipped'], ['existing'])
            self.assertTrue((target / 'config').read_text().endswith(original))
            self.assertEqual(Path(result['backups'][0]).read_text(), original)
            key_path = Path(result['key_files'][0])
            self.assertEqual(key_path.stat().st_mode & 0o777, 0o600)
            for path in [target / 'config', target / 'config.termius', key_path]:
                self.assertNotIn('NEVER-SAVE-', path.read_text())
            forward = sshconfig.source_to_spec(str(target))
            host = next(h for h in forward['hosts'] if h['label'] == 'new_host')
            self.assertEqual((host['address'], host['port'], host['user']), ('192.0.2.2', 2201, 'alice'))
            self.assertEqual(forward['keys'][host['key']]['private_key_file'], str(key_path))
            second = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(second.returncode, 0, second.stderr)
            self.assertEqual(json.loads(second.stdout)['added'], [])
            self.assertEqual(json.loads(second.stdout)['backups'], [])
            self.assertEqual((target / 'config.termius').read_text().count('Host new_host\n'), 1)

    def test_reverse_dry_run_creates_nothing_and_reports_no_credentials(self):
        with tempfile.TemporaryDirectory() as root:
            target = Path(root) / '.ssh'
            data = {'hosts': [{'label': 'test', 'address': '192.0.2.1', 'auth': 'password', 'password': 'NEVER-PRINT'}]}
            result = subprocess.run([sys.executable, str(SCRIPTS / 'vault_to_ssh.py'), str(target), '--dry-run'],
                                    input=json.dumps(data), capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout)['added'], ['test'])
            self.assertFalse(target.exists())
            self.assertNotIn('NEVER-PRINT', result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
