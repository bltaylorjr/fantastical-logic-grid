"""Weekly summary email, sent from the game's Gmail account by the GitHub
Action .github/workflows/summary-email.yml, with the same setup as the archive
email (server/ARCHIVE.md).

It asks the Worker for the week in numbers (GET /admin/v1/summary?days=7):
new players, games, top themes, races, new ideas and problems, errors,
where visitors came from, the market test's pass marks,
puzzles that need attention and free-limit warnings, and emails them.

The repository is public, so its Actions logs are too: this prints nothing
but whether the email went out.
Needs: FLG_CLOUD_URL, FLG_ADMIN_TOKEN, GMAIL_USER, GMAIL_APP_PASSWORD, and
SUMMARY_TO or ARCHIVE_TO. TEST=true sends even while the switch is off.
Python standard library only.
"""
import html
import json
import os
import smtplib
import ssl
import sys
import urllib.error
import urllib.request
from email.message import EmailMessage

# Stray spaces or line breaks pasted around a secret are ignored.
API = os.environ.get('FLG_CLOUD_URL', '').strip().rstrip('/')
TOKEN = os.environ.get('FLG_ADMIN_TOKEN', '').strip()
GMAIL_USER = os.environ.get('GMAIL_USER', '').strip()
GMAIL_PASSWORD = ''.join(os.environ.get('GMAIL_APP_PASSWORD', '').split())
TO = os.environ.get('SUMMARY_TO', '').strip() or os.environ.get('ARCHIVE_TO', '').strip()
TEST = os.environ.get('TEST', '').lower() == 'true'
DASHBOARD = f'{API}/admin/'
TIERS = {'basic': 'Basic', 'easy': 'Easy', 'medium': 'Medium', 'hard': 'Hard', 'expert': 'Expert', 'mensa': 'MENSA'}
TOPICS = {'story': 'Story idea', 'other': 'Idea', 'play': 'Playing', 'sound': 'Sound', 'pictures': 'Pictures', 'saving': 'Saving', }


def fail(message):
    print(f'::error::{message}')
    sys.exit(1)


def n(v):
    return f'{int(v or 0):,}'


def build(s):
    """Returns (subject, text, html) for a summary."""
    p, g = s['players'], s['games']
    rate = f"{round(100 * g['solved'] / g['finished'])}%" if g['finished'] else '-'
    sections = []  # (heading, [lines])
    sections.append(('Players', [
        f"{n(p['newAccounts'])} new accounts ({n(p['accounts'])} in all)",
        f"{n(p['newScreenNames'])} new screen names",
        f"{n(p['scoringPlayers'])} players posted scores",
    ]))
    sections.append(('Games', [
        f"{n(g['finished'])} games finished, {n(g['solved'])} solved ({rate})" + (f", average rating {g['rating']} of 5" if g.get('rating') else ''),
        'Top themes: ' + (', '.join(f"{t['id']} ({n(t['n'])})" for t in g['topThemes']) or 'none yet'),
        'By level: ' + (', '.join(f"{TIERS.get(t['id'], t['id'])} ({n(t['n'])})" for t in g['byTier']) or 'none yet'),
        f"{n(s['races'])} races, {n(s['scores']['solves'])} scored solves",
    ]))
    mt = s.get('marketTest')
    if mt:
        words = {'pass': 'PASS', 'below': 'BELOW', 'too_early': 'TOO EARLY', 'not_measured': 'NOT MEASURED'}
        lines = []
        for m in mt['marks']:
            unit = ' of 5' if m['id'] == 'rating' else '%'
            mark = f"{m['mark']}{unit}" if m['id'] == 'rating' else f"{m['mark']}%"
            if m['status'] == 'not_measured':
                got = 'there is no Support button yet'
            elif m['value'] is None:
                got = f"no {m['unit']} yet"
            else:
                got = f"{m['value']}{unit} from {n(m['n'])} {m['unit']}"
            extra = f" (needs {n(m['min'])} {m['unit']} to judge)" if m['status'] == 'too_early' else ''
            lines.append(f"{words.get(m['status'], m['status'])}: {m['label']}: {got}, pass mark {mark}{extra}")
        sections.append((f"Market test, last {mt['days']} days", lines))
    fun = s.get('funnel')
    if fun:
        pc = lambda v: '-' if v is None else f'{v}%'
        sections.append(('Where visitors came from this week', [
            f"{f['source']} ({f['medium']}): {n(f['visit'])} visits, {n(f['play'])} started a puzzle ({pc(f['startPct'])}), {n(f['solve'])} solves, {n(f['return'])} came back ({pc(f['returnPct'])})"
            for f in fun]))
    if s['alerts']:
        sections.append(('Free limits to watch', [f"{a['label']}: {a['percent']}%. {a['text']}" for a in s['alerts']]))
    r = s.get('ratings')
    if r and r.get('rated'):
        spread = ', '.join(f"{i + 1} star{'s' if i else ''}: {n(c)}" for i, c in enumerate(r.get('spread') or []))
        lines = [f"Average {r['average']} of 5 stars from {n(r['rated'])} ratings ({spread})"]
        if r.get('summary'):
            lines.append(r['summary'])
        lines += [f"Working: {f['text']} {f.get('advice') or ''}".strip() for f in r.get('good') or []]
        lines += [f"To improve: {f['text']} {f.get('advice') or ''}".strip() for f in r.get('improve') or []]
        sections.append(('Puzzle ratings', lines))
    if s['quality']:
        sections.append(('Puzzles that need attention', [f"{q['theme']}, {TIERS.get(q['tier'], q['tier'])} ({n(q['games'])} games): " + '; '.join(i['text'] for i in q['issues']) for q in s['quality']]))
    fb = s['feedback']
    waiting = fb.get('waiting', {})
    lines = [f"Waiting in the dashboard: {n(waiting.get('idea'))} ideas, {n(waiting.get('problem'))} problems"]
    lines += [f"{'Idea' if f['kind'] == 'idea' else 'Problem'} ({TOPICS.get(f['topic'], f['topic'])}): {f['text']}" for f in fb['recent']]
    sections.append(('Ideas and problems from players', lines))
    if s['errors']:
        sections.append(('Most common errors', [f"{n(e['count'])} times: {e['message']} ({e['platform']})" for e in s['errors']]))
    if s.get('storyPartsWaiting'):
        sections.append(('Story parts', [f"{n(s['storyPartsWaiting'])} waiting for review"]))
    usage = s.get('usage') or {}
    if usage:
        sections.append(('Free services used', [f"{k}: {n(v)}" for k, v in sorted(usage.items())]))

    subject = f"Logic Grid week {s['from']} to {s['to']}: {n(g['finished'])} games, {n(p['newAccounts'])} new players" + (f", {len(s['alerts'])} free-limit warning{'s' if len(s['alerts']) > 1 else ''}" if s['alerts'] else '')
    text = f"The Fantastical Logic Grid, {s['from']} to {s['to']}\n\n" + '\n\n'.join(f"{h}\n" + '\n'.join(f'- {x}' for x in ls) for h, ls in sections) + f"\n\nOpen the dashboard: {DASHBOARD}\nTurn this email off in Settings and switches > Alerts and reports.\n"
    body = ''.join(f"<h2 style=\"font-size:16px;margin:20px 0 6px\">{html.escape(h)}</h2><ul style=\"margin:0;padding-left:20px\">" + ''.join(f'<li style="margin:3px 0">{html.escape(x)}</li>' for x in ls) + '</ul>' for h, ls in sections)
    page = (f"<div style=\"font-family:Arial,sans-serif;font-size:14px;color:#121626;max-width:640px\"><h1 style=\"font-size:20px;color:#5B3CC4\">The Fantastical Logic Grid</h1>"
            f"<p>{html.escape(s['from'])} to {html.escape(s['to'])}</p>{body}<p style=\"margin-top:24px\"><a href=\"{html.escape(DASHBOARD)}\">Open the dashboard</a>. "
            "Turn this email off in Settings and switches &gt; Alerts and reports.</p></div>")
    return subject, text, page


def main():
    missing = [k for k, v in [('FLG_CLOUD_URL (repository variable)', API), ('FLG_ADMIN_TOKEN', TOKEN), ('GMAIL_USER', GMAIL_USER),
                              ('GMAIL_APP_PASSWORD', GMAIL_PASSWORD), ('SUMMARY_TO or ARCHIVE_TO', TO)] if not v]
    if missing:
        print('The weekly summary email is not set up yet. Missing: ' + ', '.join(missing) + '. See server/ARCHIVE.md.')
        return
    req = urllib.request.Request(f'{API}/admin/v1/summary?days=7', headers={'Authorization': f'Bearer {TOKEN}', 'User-Agent': 'flg-summary-email'})
    try:
        s = json.loads(urllib.request.urlopen(req, timeout=60).read())
    except urllib.error.HTTPError as e:
        fail(f'The Worker refused the summary (HTTP {e.code}). Check FLG_ADMIN_TOKEN matches the Worker ADMIN_TOKEN.')
    except urllib.error.URLError as e:
        fail(f'The Worker did not answer: {e.reason}')
    if not s.get('enabled') and not TEST:
        print('The weekly summary email is switched off in the admin dashboard. Nothing to do.')
        return
    subject, text, page = build(s)
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
    print('Summary email sent.')


if __name__ == '__main__':
    main()
