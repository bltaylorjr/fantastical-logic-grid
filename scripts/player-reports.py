"""Daily player report: the errors players hit and the problems and ideas they
sent in the last day, grouped and emailed from the game's Gmail account by the
GitHub Action .github/workflows/player-reports.yml (same setup as the archive
email, server/ARCHIVE.md).

Errors (GET /admin/errors) are grouped by message and file across versions
and platforms. Errors already fixed (scripts/known-errors.json) that only come
from older versions are listed apart, so only new trouble needs a look.
Problems and ideas (GET /admin/v1/feedback) are grouped by topic. Nothing new
since yesterday means no email.

The repository is public, so its Actions logs are too: this prints counts
only, never what players wrote. With PUBLIC_KEY (a base64 RSA public key in
PEM form) it also prints everything it fetched encrypted to that key, so a
triage session holding the private key can read the details from the log.

Needs: FLG_CLOUD_URL, FLG_ADMIN_TOKEN, and to email: GMAIL_USER,
GMAIL_APP_PASSWORD, REPORTS_TO or ARCHIVE_TO. TEST=true emails even when
nothing is new. SEND=false skips the email.
Python standard library plus the openssl command (on GitHub's runners).
"""
import base64
import gzip
import html
import json
import os
import pathlib
import smtplib
import ssl
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage

# Stray spaces or line breaks pasted around a secret are ignored.
API = os.environ.get('FLG_CLOUD_URL', '').strip().rstrip('/')
TOKEN = os.environ.get('FLG_ADMIN_TOKEN', '').strip()
GMAIL_USER = os.environ.get('GMAIL_USER', '').strip()
GMAIL_PASSWORD = ''.join(os.environ.get('GMAIL_APP_PASSWORD', '').split())
TO = os.environ.get('REPORTS_TO', '').strip() or os.environ.get('ARCHIVE_TO', '').strip()
TEST = os.environ.get('TEST', '').lower() == 'true'
SEND = os.environ.get('SEND', 'true').lower() != 'false'
PUBLIC_KEY = ''.join(os.environ.get('PUBLIC_KEY', '').split())
DASHBOARD = f'{API}/admin/'
KNOWN = pathlib.Path(__file__).with_name('known-errors.json')
TOPICS = {'story': 'Story idea', 'other': 'Other', 'play': 'Playing', 'sound': 'Sound', 'pictures': 'Pictures', 'saving': 'Saving'}
DAY_MS = 24 * 3600 * 1000


def fail(message):
    print(f'::error::{message}')
    sys.exit(1)


def get(path):
    req = urllib.request.Request(f'{API}{path}', headers={'Authorization': f'Bearer {TOKEN}', 'User-Agent': 'flg-player-reports'})
    try:
        return json.loads(urllib.request.urlopen(req, timeout=60).read())
    except urllib.error.HTTPError as e:
        fail(f'The Worker refused {path.split("?")[0]} (HTTP {e.code}). Check FLG_ADMIN_TOKEN matches the Worker ADMIN_TOKEN.')
    except urllib.error.URLError as e:
        fail(f'The Worker did not answer: {e.reason}')


def version_key(v):
    try:
        return tuple(int(x) for x in str(v).split('.'))
    except ValueError:
        return ()


def known_fix(g, known):
    for k in known:
        if k['match'] in g['message'] and k.get('place', '') in g['file']:
            return k
    return None


def group_errors(rows, known, since_day):
    """Groups the error rows by message and file. Returns (needs_look, fixed)."""
    groups = {}
    for e in rows:
        file = (e.get('place') or '').split(':')[0]
        g = groups.setdefault((e['kind'], e['message'], file), {
            'kind': e['kind'], 'message': e['message'], 'file': file, 'count': 0,
            'versions': set(), 'platforms': set(), 'places': set(), 'first': e['first'], 'last': e['last'], 'rows': []})
        g['count'] += e['count']
        g['versions'].add(e['version'])
        g['platforms'].add(e['platform'])
        if e.get('place'):
            g['places'].add(e['place'])
        g['first'], g['last'] = min(g['first'], e['first']), max(g['last'], e['last'])
        g['rows'].append(e)
    needs, fixed = [], []
    for g in groups.values():
        if g['last'] < since_day:
            continue
        k = known_fix(g, known)
        # Fixed only while every report comes from a version before the fix.
        if k and all(version_key(r['version']) and version_key(r['version']) < version_key(k['fixedIn']) for r in g['rows']):
            g['fix'] = k
            fixed.append(g)
        else:
            if k:
                g['note'] = f"Still seen in {k['fixedIn']} or later, so the fix in {k['fixedIn']} did not cover it."
            needs.append(g)
    order = lambda g: (-g['count'], g['message'])
    return sorted(needs, key=order), sorted(fixed, key=order)


def describe(g):
    where = ', '.join(sorted(g['places'])) or 'unknown place'
    return (f"{g['count']} times ({g['kind']}, {', '.join(sorted(g['platforms']))}, version {', '.join(sorted(g['versions'], key=version_key))}, "
            f"{g['first']} to {g['last']}): {g['message']} at {where}")


def build(needs, fixed, problems, ideas, new_problems, new_ideas):
    sections = []
    if needs:
        sections.append(('Errors that need a look', [describe(g) + (f" {g['note']}" if g.get('note') else '') for g in needs]))
    if fixed:
        sections.append(('Errors already fixed (from older versions, they stop as players update)',
                         [f"{describe(g)}. Fixed in {g['fix']['fixedIn']}: {g['fix']['note']}" for g in fixed]))
    for label, new, items in (('Problems', new_problems, problems), ('Ideas', new_ideas, ideas)):
        waiting = [f for f in items if f['status'] == 'new']
        if not waiting:
            continue
        by_topic = {}
        for f in waiting:
            by_topic.setdefault(TOPICS.get(f['topic'], f['topic']), []).append(f)
        lines = [f"{len(new)} new since yesterday, {len(waiting)} waiting in the dashboard"]
        for topic, fs in sorted(by_topic.items()):
            lines += [f"{topic}{' (new)' if f in new else ''}: {f['text']} ({f['platform']}, version {f['version']})" for f in fs]
        sections.append((f'{label} from players', lines))
    if not sections:
        sections.append(('All clear', ['No errors in the last day and no problems or ideas waiting.']))

    parts = []
    if needs:
        parts.append(f"{len(needs)} error{'s' if len(needs) != 1 else ''} to look at")
    if new_problems:
        parts.append(f"{len(new_problems)} new problem{'s' if len(new_problems) != 1 else ''}")
    if new_ideas:
        parts.append(f"{len(new_ideas)} new idea{'s' if len(new_ideas) != 1 else ''}")
    day = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    subject = f"Logic Grid player report {day}: " + (', '.join(parts) or 'nothing new')
    footer = (f"Mark problems and ideas done in the dashboard: {DASHBOARD}\n"
              "Errors are anonymous and cleaned of personal details. Stop this email with the repository variable PLAYER_REPORTS=off.")
    text = f"The Fantastical Logic Grid, player report for {day}\n\n" + '\n\n'.join(
        f"{h}\n" + '\n'.join(f'- {x}' for x in ls) for h, ls in sections) + f"\n\n{footer}\n"
    body = ''.join(f"<h2 style=\"font-size:16px;margin:20px 0 6px\">{html.escape(h)}</h2><ul style=\"margin:0;padding-left:20px\">"
                   + ''.join(f'<li style="margin:3px 0">{html.escape(x)}</li>' for x in ls) + '</ul>' for h, ls in sections)
    page = (f"<div style=\"font-family:Arial,sans-serif;font-size:14px;color:#121626;max-width:640px\"><h1 style=\"font-size:20px;color:#5B3CC4\">The Fantastical Logic Grid</h1>"
            f"<p>Player report for {html.escape(day)}</p>{body}<p style=\"margin-top:24px\"><a href=\"{html.escape(DASHBOARD)}\">Open the dashboard</a> to mark problems and ideas done. "
            "Errors are anonymous and cleaned of personal details. Stop this email with the repository variable PLAYER_REPORTS=off.</p></div>")
    return subject, text, page


def print_encrypted(data):
    """Prints data encrypted to PUBLIC_KEY: an AES key wrapped with RSA-OAEP, then the gzipped JSON."""
    with tempfile.TemporaryDirectory() as d:
        d = pathlib.Path(d)
        (d / 'pub.pem').write_bytes(base64.b64decode(PUBLIC_KEY))
        (d / 'key').write_text(os.urandom(32).hex())
        (d / 'data.gz').write_bytes(gzip.compress(json.dumps(data).encode()))
        run = lambda *a: subprocess.run(a, check=True, capture_output=True, cwd=d)
        run('openssl', 'pkeyutl', '-encrypt', '-pubin', '-inkey', 'pub.pem', '-pkeyopt', 'rsa_padding_mode:oaep', '-in', 'key', '-out', 'key.enc')
        run('openssl', 'enc', '-aes-256-cbc', '-pbkdf2', '-salt', '-pass', 'file:key', '-in', 'data.gz', '-out', 'data.enc')
        print('=====KEY=====\n' + base64.b64encode((d / 'key.enc').read_bytes()).decode())
        print('=====DATA=====\n' + base64.b64encode((d / 'data.enc').read_bytes()).decode())
        print('=====END=====')


def main():
    if not API or not TOKEN:
        print('The player report is not set up yet. Missing: FLG_CLOUD_URL or FLG_ADMIN_TOKEN.')
        return
    errors = get('/admin/errors?days=7').get('errors', [])
    problems = get('/admin/v1/feedback?kind=problem&status=all').get('items', [])
    ideas = get('/admin/v1/feedback?kind=idea&status=all').get('items', [])
    if PUBLIC_KEY:
        print_encrypted({'errors': errors, 'problems': problems, 'ideas': ideas})

    known = json.loads(KNOWN.read_text())['fixed']
    since_day = (datetime.now(timezone.utc) - timedelta(days=1)).strftime('%Y-%m-%d')
    since_ms = time.time() * 1000 - DAY_MS - 3600_000  # a little overlap with yesterday's run
    needs, fixed = group_errors(errors, known, since_day)
    new_problems = [f for f in problems if f['status'] == 'new' and f['createdAt'] >= since_ms]
    new_ideas = [f for f in ideas if f['status'] == 'new' and f['createdAt'] >= since_ms]
    print(f'{len(needs)} error groups need a look, {len(fixed)} already fixed, {len(new_problems)} new problems, {len(new_ideas)} new ideas.')
    if not SEND:
        return
    if not (needs or new_problems or new_ideas) and not TEST:
        print('Nothing new since yesterday; no email.')
        return
    missing = [k for k, v in [('GMAIL_USER', GMAIL_USER), ('GMAIL_APP_PASSWORD', GMAIL_PASSWORD), ('REPORTS_TO or ARCHIVE_TO', TO)] if not v]
    if missing:
        print('The player report email is not set up yet. Missing: ' + ', '.join(missing) + '. See server/ARCHIVE.md.')
        return
    subject, text, page = build(needs, fixed, problems, ideas, new_problems, new_ideas)
    msg = EmailMessage()
    msg['From'] = f'The Fantastical Logic Grid <{GMAIL_USER}>'
    msg['To'] = TO
    msg['Subject'] = subject
    msg.set_content(text)
    msg.add_alternative(page, subtype='html')
    try:
        with smtplib.SMTP_SSL('smtp.gmail.com', 465, context=ssl.create_default_context(), timeout=120) as smtp:
            smtp.login(GMAIL_USER, GMAIL_PASSWORD)
            smtp.send_message(msg)
    except smtplib.SMTPAuthenticationError:
        fail('Gmail refused the sign-in. Check GMAIL_USER and the app password (GMAIL_APP_PASSWORD).')
    except Exception as e:  # noqa: BLE001
        fail(f'The email was not sent ({type(e).__name__}).')
    print('Player report email sent.')


if __name__ == '__main__':
    main()
