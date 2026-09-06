#!/usr/bin/env python3
"""Invoke the CRM offer reminder Edge Function without exposing its secret."""
import json
import pathlib
import urllib.error
import urllib.request

SECRET_FILE = pathlib.Path('/etc/ekvportal-crm-reminders/secret.env')
FUNCTION_URL = 'https://yurysbxxevtuvhrbmloc.supabase.co/functions/v1/send-crm-commercial-reminders'


def load_secret():
    values = {}
    for raw_line in SECRET_FILE.read_text(encoding='utf-8').splitlines():
        line = raw_line.strip()
        if line and not line.startswith('#') and '=' in line:
            key, value = line.split('=', 1)
            values[key.strip()] = value.strip()
    secret = values.get('CRM_REMINDER_SECRET', '')
    if not secret:
        raise SystemExit('CRM_REMINDER_SECRET is missing.')
    return secret


request = urllib.request.Request(
    FUNCTION_URL,
    data=b'{}',
    headers={'Content-Type': 'application/json', 'x-cron-secret': load_secret()},
    method='POST',
)
try:
    with urllib.request.urlopen(request, timeout=120) as response:
        result = json.load(response)
    print(json.dumps(result, ensure_ascii=False))
    if not result.get('success'):
        raise SystemExit(1)
except urllib.error.HTTPError as error:
    print(json.dumps({'http_status': error.code, 'response': error.read(2000).decode(errors='replace')}))
    raise SystemExit(1)
except (urllib.error.URLError, TimeoutError):
    print('CRM reminder request failed or timed out; inspect delivery evidence before retrying.')
    raise SystemExit(1)
