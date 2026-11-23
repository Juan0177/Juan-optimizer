#!/usr/bin/env python3
"""
JuanLab: tells Discord about Stellar Optimizer's new commits (s-naveen/stellar-optimizer), without
merging anything. Run by .github/workflows/juanlab-stellar-notify.yml.

The commits are those after the last one announced (kept in --state); the first time, those not yet
in Juan-optimizer. The state moves on only once Discord has the message, so a failed post is
announced again on the next run. Without DISCORD_WEBHOOK nothing is posted and nothing is kept.
"""
import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

REPO_URL = 'https://github.com/s-naveen/stellar-optimizer'
COLOR = 0x8B7CF6
DESCRIPTION_MAX = 3900  # Discord allows 4096 in an embed's description
SUBJECT_MAX = 160


def git(*args: str) -> str:
    return subprocess.run(['git', *args], check=True, capture_output=True, text=True).stdout.strip()


def is_commit(ref: str) -> bool:
    return subprocess.run(['git', 'cat-file', '-e', f'{ref}^{{commit}}'], capture_output=True).returncode == 0


def is_ancestor(a: str, b: str) -> bool:
    return subprocess.run(['git', 'merge-base', '--is-ancestor', a, b], capture_output=True).returncode == 0


def plural(n: int, one: str, many: str) -> str:
    return f'{n} {one if n == 1 else many}'


def message(source: str, last: str, base: str) -> dict | None:
    head = git('rev-parse', source)
    log = git('log', '--format=%H%x1f%h%x1f%s%x1f%cI', f'{last}..{head}')
    if not log:
        return None
    commits = [line.split('\x1f') for line in log.splitlines()]  # newest first
    releases = [s.split(': ', 1)[1] for _, _, s, _ in commits if s.startswith('chore(release): ')]
    changes = [c for c in commits if not c[2].startswith('chore(release): ')]

    lines = []
    if releases:
        lines.append('Versioni: ' + ', '.join(f'**{v}**' for v in reversed(releases)))
        lines.append('')
    shown = 0
    for full, short, subject, _ in changes:
        subject = subject if len(subject) <= SUBJECT_MAX else subject[: SUBJECT_MAX - 1] + '…'
        line = f'• [`{short}`]({REPO_URL}/commit/{full}) {subject}'
        if len('\n'.join(lines + [line])) > DESCRIPTION_MAX - 40:
            break
        lines.append(line)
        shown += 1
    if shown < len(changes):
        lines.append(f'… e {plural(len(changes) - shown, "altro commit", "altri commit")}')

    pending = int(git('rev-list', '--count', f'{base}..{head}'))
    aligned = git('log', '-1', '--format=%s', '--grep=^chore(release): v', base)
    fields = [{'name': 'Non ancora in Juan-optimizer', 'value': plural(pending, 'commit', 'commit'), 'inline': True}]
    if aligned:
        fields.append({'name': 'Ultima versione allineata', 'value': aligned.split(': ', 1)[1], 'inline': True})
    n = len(commits)
    return {
        'head': head,
        'payload': {
            'allowed_mentions': {'parse': []},
            'embeds': [{
                'title': f'Stellar Optimizer: {plural(n, "commit nuovo", "commit nuovi")}',
                'url': f'{REPO_URL}/compare/{last[:12]}...{head[:12]}',
                'description': '\n'.join(lines),
                'color': COLOR,
                'fields': fields,
                'footer': {'text': 's-naveen/stellar-optimizer · main'},
                'timestamp': commits[0][3],
            }],
        },
    }


def post(url: str, payload: dict) -> None:
    request = urllib.request.Request(
        url + '?wait=true',
        data=json.dumps(payload).encode(),
        method='POST',
        headers={'Content-Type': 'application/json', 'User-Agent': 'JuanLab stellar-notify (github.com/Juan0177/Juan-optimizer)'},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        response.read()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', required=True, help="Juan-optimizer's branch, e.g. HEAD")
    parser.add_argument('--source', required=True, help="Stellar's branch, e.g. stellar/main")
    parser.add_argument('--state', required=True, help='file keeping the last commit announced')
    parser.add_argument('--dry-run', action='store_true', help='print the message instead of posting it')
    args = parser.parse_args()

    last = open(args.state).read().strip() if os.path.exists(args.state) else ''
    # (a history rewritten upstream, or the first run: from what Juan-optimizer already has)
    if not (last and is_commit(last) and is_ancestor(last, args.source)):
        last = git('merge-base', args.base, args.source)
    built = message(args.source, last, args.base)
    if built is None:
        print('Nessun commit nuovo su Stellar Optimizer.')
        return 0
    if args.dry_run:
        print(json.dumps(built['payload'], ensure_ascii=False, indent=2))
        return 0
    url = os.environ.get('DISCORD_WEBHOOK', '').strip()
    if not url:
        print('::warning::Manca il secret STELLAR_DISCORD_WEBHOOK: nessun avviso inviato.')
        return 0
    try:
        post(url, built['payload'])
    except urllib.error.HTTPError as error:
        print(f'::error::Discord ha risposto {error.code}: {error.read().decode(errors="replace")[:300]}')
        return 1
    os.makedirs(os.path.dirname(args.state) or '.', exist_ok=True)
    with open(args.state, 'w') as file:
        file.write(built['head'] + '\n')
    print(f"Avviso inviato: {built['payload']['embeds'][0]['title']}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
