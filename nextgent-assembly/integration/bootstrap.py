#!/usr/bin/env python3
"""Fetch exact source commits into the existing assembly topology; never overwrite a checkout."""
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCK = Path(__file__).with_name('repositories.lock.json')

def git(*args, cwd=None):
    return subprocess.check_output(['git', *args], cwd=cwd, text=True).strip()

for repo in json.loads(LOCK.read_text()):
    target = ROOT / 'repos' / repo['directory']
    if target.exists():
        if git('rev-parse', 'HEAD', cwd=target) != repo['commit'] or git('status', '--porcelain', cwd=target):
            raise SystemExit(f'Refusing to change existing checkout: {target}')
        print(f'Already pinned: {repo["repository"]}')
        continue
    target.parent.mkdir(parents=True, exist_ok=True)
    git('clone', '--filter=blob:none', '--no-checkout', f'https://github.com/{repo["repository"]}.git', str(target))
    git('checkout', '--detach', repo['commit'], cwd=target)
    if git('rev-parse', 'HEAD', cwd=target) != repo['commit']:
        raise SystemExit(f'Commit verification failed: {target}')
    print(f'Pinned: {repo["repository"]} {repo["commit"]}')
