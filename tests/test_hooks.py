import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

class Hooks(unittest.TestCase):
    def test_session_cwd_with_spaces_and_json_characters(self):
        with tempfile.TemporaryDirectory() as temp:
            parent = Path(temp)
            project = parent / 'plugin-creo-memories'
            project.mkdir()
            lane = project / '.vp/lanes/a space'
            lane.mkdir(parents=True)
            binary = parent / 'bin'
            binary.mkdir()
            vp = binary / 'vp'
            vp.write_text('#!/bin/sh\nprintf \'%s\\t%s\\n\' "$PWD" \'quote" and back\\slash\'\n')
            vp.chmod(0o755)
            env = dict(os.environ, PATH=str(binary)+os.pathsep+os.environ['PATH'])
            env.pop('CLAUDE_PLUGIN_ROOT', None)
            is_vp = ROOT.name == 'plugin-vantage-point'
            target = lane if is_vp else project
            hook = ROOT / ('hooks/scripts/lane-status.sh' if is_vp else 'hooks/session-start.sh')
            result = subprocess.run(['bash',str(hook)],input=json.dumps({'cwd':str(target)}),text=True,cwd=parent,env=env,capture_output=True)
            self.assertEqual(result.returncode,0,result.stderr)
            if is_vp:
                content=json.loads(result.stdout)['hookSpecificOutput']['additionalContext']
                self.assertIn(str(lane),content)
                self.assertIn('quote" and back',content)
            else:
                self.assertIn('chronista-plugins',result.stdout)
                self.assertNotIn('remember / search の atlasId に',result.stdout)

    def test_invalid_event_is_quiet(self):
        hook=ROOT / ('hooks/scripts/lane-status.sh' if ROOT.name == 'plugin-vantage-point' else 'hooks/session-start.sh')
        result=subprocess.run(['bash',str(hook)],input='{bad',text=True,capture_output=True)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(result.stdout,'')

if __name__ == '__main__':
    unittest.main()
