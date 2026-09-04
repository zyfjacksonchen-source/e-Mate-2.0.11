import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('control', Path(__file__).with_name('gpt-fast-mode-control.py'))
control = importlib.util.module_from_spec(spec)
spec.loader.exec_module(control)


class FastModeTest(unittest.TestCase):
    MANAGED_KEY_ID = 101
    OTHER_KEY_ID = 202

    def test_unpatched_proxy_cannot_accept_a_policy(self):
        with patch.dict(control.os.environ, {'SSH_ORIGINAL_COMMAND': 'emate-gpt-fast-mode-v1'}), \
             patch.object(control.subprocess, 'check_output', return_value=b'[{"Config":{"Labels":{}}}]'), \
             patch.object(control, 'psql') as database:
            with self.assertRaisesRegex(ValueError, 'UNAVAILABLE'):
                control.main()
            database.assert_not_called()

    def test_individual_bulk_conflict_and_preservation(self):
        unrelated = {'service_tier': 'priority', 'action': 'block', 'scope': 'all',
                     'api_key_ids': [self.OTHER_KEY_ID]}
        raw = json.dumps({'rules': [unrelated]})

        def update(models, enabled):
            nonlocal raw
            raw = control.updated_policy(raw, self.MANAGED_KEY_ID, {
                'schemaVersion': 1, 'expectedRevision': control.revision(raw),
                'modelIds': models, 'enabled': enabled,
            })
            self.assertEqual(json.loads(raw)['rules'][-1], unrelated)

        update(['gpt-5.6-luna'], True)
        self.assertEqual(control.snapshot(raw, self.MANAGED_KEY_ID)['enabledModelIds'], ['gpt-5.6-luna'])
        self.assertEqual([r['action'] for r in json.loads(raw)['rules'][:2]], ['filter', 'force_priority'])
        update(list(control.MODELS), True)
        self.assertEqual(control.snapshot(raw, self.MANAGED_KEY_ID)['enabledModelIds'], list(control.MODELS))
        update(['gpt-5.6-luna'], False)
        self.assertEqual(control.snapshot(raw, self.MANAGED_KEY_ID)['enabledModelIds'], ['gpt-5.6-sol'])
        update(list(control.MODELS), False)
        self.assertEqual(control.snapshot(raw, self.MANAGED_KEY_ID)['enabledModelIds'], [])
        for model_ids, revision, error in [(['deepseek'], control.revision(raw), 'INVALID_REQUEST'),
                                         (['gpt-image-2-pro'], control.revision(raw), 'INVALID_REQUEST'),
                                         (list(control.MODELS), '0' * 64, 'CONFLICT')]:
            with self.assertRaisesRegex(ValueError, error):
                control.updated_policy(raw, self.MANAGED_KEY_ID, {
                    'schemaVersion': 1, 'expectedRevision': revision,
                    'modelIds': model_ids, 'enabled': True,
                })
        self.assertNotIn("');", control.sql_text("'); DROP TABLE settings;--"))


if __name__ == '__main__':
    unittest.main()
