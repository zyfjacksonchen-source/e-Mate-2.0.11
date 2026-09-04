#!/usr/bin/env python3
"""Restricted SSH command for the pinned Sub2API fast-policy setting.

Install root-owned at /usr/local/libexec/emate-gpt-fast-mode with config at
/etc/emate-gpt-fast-mode.json containing one tenant ID and one positive API-key ID.
The dedicated authorized_keys entry MUST use restrict,from="<enterprise IP>",
command="/usr/local/libexec/emate-gpt-fast-mode". Never grant this key a shell.
"""
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import uuid

MODELS = ('gpt-5.6-luna', 'gpt-5.6-sol')
SETTING = 'openai_fast_policy_settings'
MARKER = 'e-mate:gpt-fast-mode:v1'
AUDIT = '/var/log/emate-gpt-fast-mode.jsonl'


def revision(raw):
    return hashlib.sha256(raw.encode()).hexdigest()


def enabled_models(raw, key_id):
    return [model for model in MODELS if any(
        rule.get('error_message') == MARKER and rule.get('api_key_ids') == [key_id]
        and rule.get('action') == 'force_priority' and model in rule.get('model_whitelist', [])
        for rule in json.loads(raw)['rules'])]


def snapshot(raw, key_id):
    return {'schemaVersion': 1, 'revision': revision(raw), 'enabledModelIds': enabled_models(raw, key_id)}


def updated_policy(raw, key_id, update):
    if (not isinstance(update, dict) or set(update) != {'schemaVersion', 'expectedRevision', 'modelIds', 'enabled'}
            or update['schemaVersion'] != 1 or type(update['enabled']) is not bool
            or not isinstance(update['modelIds'], list) or not update['modelIds']
            or any(model not in MODELS for model in update['modelIds'])
            or len(set(update['modelIds'])) != len(update['modelIds'])
            or not isinstance(update['expectedRevision'], str)
            or not re.fullmatch('[a-f0-9]{64}', update['expectedRevision'])):
        raise ValueError('INVALID_REQUEST')
    if revision(raw) != update['expectedRevision']:
        raise ValueError('CONFLICT')
    enabled = set(enabled_models(raw, key_id))
    for model in update['modelIds']:
        (enabled.add if update['enabled'] else enabled.discard)(model)
    policy = json.loads(raw)
    remaining = [rule for rule in policy['rules'] if not (
        rule.get('error_message') == MARKER and rule.get('api_key_ids') == [key_id])]
    # Sub2API stops on the first matched rule, including its model fallback.
    # Filter only priority requests first; then inject priority for enabled models.
    rules = []
    for active in (False, True):
        models = [model for model in MODELS if (model in enabled) == active]
        if models:
            rules.append({'service_tier': 'all' if active else 'priority',
                          'action': 'force_priority' if active else 'filter', 'scope': 'all',
                          'api_key_ids': [key_id], 'model_whitelist': models,
                          'fallback_action': 'pass', 'error_message': MARKER})
    policy['rules'] = rules + remaining
    return json.dumps(policy, separators=(',', ':'))


def sql_text(value):
    # No request text is ever interpolated into SQL as syntax.
    return "convert_from(decode('%s','hex'),'UTF8')" % value.encode().hex()


def psql(sql):
    container = json.loads(subprocess.check_output(['docker', 'inspect', 'sub2api-postgres'], timeout=5))[0]
    env = dict(value.split('=', 1) for value in container['Config']['Env'])
    return subprocess.check_output([
        'docker', 'exec', '-i', 'sub2api-postgres', 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
        '-U', env['POSTGRES_USER'], '-d', env['POSTGRES_DB'],
    ], input=sql.encode(), stderr=subprocess.DEVNULL, timeout=8).decode().strip()


def audit(entry):
    descriptor = os.open(AUDIT, os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'a') as output:
        output.write(json.dumps(entry, separators=(',', ':')) + '\n')
        output.flush()
        os.fsync(output.fileno())


def main():
    if os.environ.get('SSH_ORIGINAL_COMMAND') != 'emate-gpt-fast-mode-v1':
        raise ValueError('FORBIDDEN')
    running = json.loads(subprocess.check_output(['docker', 'inspect', 'sub2api'], timeout=5))[0]
    if running['Config'].get('Labels', {}).get('net.ecoremedia.emate.gpt-fast-mode') != '1':
        # An unpatched proxy would ignore api_key_ids and broaden these rules.
        raise ValueError('UNAVAILABLE')
    with open('/etc/emate-gpt-fast-mode.json') as source:
        config = json.load(source)
    key_id = config['apiKeyId']
    if type(key_id) is not int or key_id < 1:
        raise ValueError('UNAVAILABLE')
    body = sys.stdin.buffer.read(16_385)
    if len(body) > 16_384:
        raise ValueError('INVALID_REQUEST')
    request = json.loads(body)
    if (not isinstance(request, dict) or set(request) not in ({'tenantId', 'actorId'}, {'tenantId', 'actorId', 'update'})
            or request['tenantId'] != config['tenantId'] or not isinstance(request['actorId'], str)
            or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:-]{0,127}', request['actorId'])):
        raise ValueError('FORBIDDEN')
    if psql(f"SELECT count(*) FROM api_keys WHERE id={key_id} AND status='active' AND deleted_at IS NULL;") != '1':
        raise ValueError('UNAVAILABLE')
    before = psql(f"SELECT value FROM settings WHERE key='{SETTING}';")
    raw = before or '{"rules":[]}'
    if 'update' not in request:
        return snapshot(raw, key_id)
    updated = updated_policy(raw, key_id, request['update'])
    event = {'id': str(uuid.uuid4()), 'time': time.time(), 'tenantId': request['tenantId'],
             'actorId': request['actorId'], 'update': request['update']}
    audit({**event, 'result': 'intent'})
    # One atomic compare-and-swap for the whole batch preserves concurrent edits.
    result = psql(f"INSERT INTO settings(key,value,updated_at) VALUES ('{SETTING}',{sql_text(updated)},now()) "
                  f"ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now() "
                  f"WHERE settings.value={sql_text(before)} RETURNING value;")
    audit({**event, 'result': 'saved' if result else 'conflict'})
    if not result:
        raise ValueError('CONFLICT')
    return snapshot(result, key_id)


if __name__ == '__main__':
    try:
        print(json.dumps(main(), separators=(',', ':')))
    except Exception as error:
        code = str(error) if isinstance(error, ValueError) and str(error) in ('CONFLICT', 'FORBIDDEN', 'INVALID_REQUEST') else 'UNAVAILABLE'
        print(json.dumps({'error': code}))
