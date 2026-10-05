#!/usr/bin/env python3
"""Run existing repository checks without hiding failed or blocked commands."""
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('--repo', action='append', help='Limit to assembly.json block names')
parser.add_argument('--timeout', type=int, default=1800)
args = parser.parse_args()
manifest = json.loads((ROOT / 'integration/assembly.json').read_text())
output = ROOT / 'logs/recheck'
output.mkdir(parents=True, exist_ok=True)
results = []
for block in manifest['blocks']:
    if args.repo and block['name'] not in args.repo:
        continue
    for index, command in enumerate(block['checks']):
        command = [sys.executable if s == '{python}' else s for s in command]
        log = output / f"{block['name']}-{index}.log"
        env = dict(os.environ)
        env['PYTHONPATH'] = 'src'
        if block['name'] == 'paperclip':
            # TS 7's compiler is native Go; NODE_OPTIONS cannot bound its heap.
            env.setdefault('GOMEMLIMIT', '768MiB')
            env.setdefault('GOGC', '50')
        print(block['name'], ' '.join(command), flush=True)
        try:
            with log.open('w') as stream:
                run = subprocess.run(command, cwd=ROOT / block['directory'], env=env,
                    stdout=stream, stderr=subprocess.STDOUT, timeout=args.timeout, check=False)
            status = run.returncode
        except (OSError, subprocess.TimeoutExpired) as error:
            status = 124 if isinstance(error, subprocess.TimeoutExpired) else 127
            with log.open('a') as stream:
                stream.write('\n' + str(error) + '\n')
        results.append({'block': block['name'], 'command': command, 'exit_code': status,
                        'log': str(log.relative_to(ROOT))})
        (output / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
        print('exit:', status, flush=True)
sys.exit(1 if any(r['exit_code'] for r in results) else 0)
