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


if __name__ == '__main__':
    unittest.main()
