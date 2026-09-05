#!/usr/bin/env python3
"""Server-owned scheduler client. The secret is never passed in argv or printed."""
import json
import pathlib
import sys
import urllib.error
import urllib.request

secret_file = pathlib.Path('/etc/ekvportal-attendance-report/secret.env')
secret = secret_file.read_text().strip().split('=', 1)[1]
payload = {'mode': 'scheduled'}
if len(sys.argv) == 3 and sys.argv[1] == '--demo':
    payload = {'mode': 'demo', 'demoId': sys.argv[2]}
elif len(sys.argv) != 1:
    raise SystemExit('Usage: run.py [--demo STABLE_DEMO_ID]')
request = urllib.request.Request(
    'https://yurysbxxevtuvhrbmloc.supabase.co/functions/v1/send-attendance-plan-report',
    data=json.dumps(payload).encode(),
    headers={'Content-Type': 'application/json', 'x-cron-secret': secret},
    method='POST',
)
try:
    with urllib.request.urlopen(request, timeout=100) as response:
        result = json.load(response)
    print(json.dumps(result, ensure_ascii=False))
    if not (result.get('success') or result.get('skipped')):
        raise SystemExit(1)
except urllib.error.HTTPError as error:
    print(json.dumps({'http_status': error.code, 'response': error.read(2000).decode(errors='replace')}))
    raise SystemExit(1)
except (urllib.error.URLError, TimeoutError):
    print('Report request failed or timed out; inspect delivery evidence before resending.')
    raise SystemExit(1)
