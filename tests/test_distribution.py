import json
from pathlib import Path
import re
import unittest
import yaml

ROOT = Path(__file__).resolve().parents[1]

class Distribution(unittest.TestCase):
    def test_manifests_and_skills(self):
        claude = json.loads((ROOT/'.claude-plugin/plugin.json').read_text())
        codex = json.loads((ROOT/'.codex-plugin/plugin.json').read_text())
        for key, value in claude.items():
            self.assertEqual(codex[key], value, key)
        self.assertEqual(codex['skills'],'./skills/')
        self.assertRegex(claude['version'],r'^\d+\.\d+\.\d+$')
        self.assertIn('## ['+claude['version']+']',(ROOT/'CHANGELOG.md').read_text())
        if (ROOT/'.mcp.json').exists():
            self.assertEqual(codex['mcpServers'],'./.mcp.json')
            self.assertTrue(json.loads((ROOT/'.mcp.json').read_text())['mcpServers'])
        for path in (ROOT/'skills').glob('*/SKILL.md'):
            data=yaml.safe_load(path.read_text().split('---',2)[1])
            self.assertEqual(data['name'],path.parent.name)
            self.assertTrue(data['description'])
            self.assertEqual(data['metadata']['version'],claude['version'])
            self.assertLessEqual(set(data),{'name','description','license','metadata','allowed-tools'})
            self.assertTrue(all(isinstance(v,str) for v in data['metadata'].values()))

    def test_local_references_and_hook_scripts(self):
        for path in [ROOT/'README.md',*(ROOT/'skills').rglob('*.md'),*(ROOT/'commands').glob('*.md'),*(ROOT/'docs').rglob('*.md')]:
            for target in re.findall(r'\]\(([^)]+)\)',path.read_text()):
                if '://' in target or target.startswith('#'): continue
                self.assertTrue((path.parent/target.split('#')[0]).exists(),f'{path}: {target}')
        path=ROOT/'hooks/hooks.json'
        if path.exists():
            for groups in json.loads(path.read_text())['hooks'].values():
                for group in groups:
                    for hook in group['hooks']:
                        self.assertEqual(hook['type'],'command')
                        for target in re.findall(r'\$\{CLAUDE_PLUGIN_ROOT\}/([^"\s]+)',hook['command']):
                            self.assertTrue((ROOT/target).is_file(),target)
