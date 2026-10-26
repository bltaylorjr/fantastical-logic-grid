"""The weekly "what we changed and why" email, sent from the game's Gmail
account by .github/workflows/improve.yml after the weekly improvement run.

It reads improve.json (written by scripts/improve.mjs) and tells the owner:
what was tuned automatically this week and why, every change merged in the
last 7 days with its reason, the top findings, and what the weekly Claude
task will look at next. Counts and built-in names only, never player text.

Needs: GMAIL_USER, GMAIL_APP_PASSWORD, and SUMMARY_TO or ARCHIVE_TO (the
same setup as the weekly summary email). Optional: OUT_DIR (where improve.json is), PR_URL and PR_STATE
(merged, open or failed), REPORT_URL (the weekly improvement issue).
Python standard library only. Prints nothing but whether it sent.
"""
import html
import json
import os
import smtplib
import ssl
import sys
from email.message import EmailMessage

GMAIL_USER = os.environ.get('GMAIL_USER', '').strip()
GMAIL_PASSWORD = ''.join(os.environ.get('GMAIL_APP_PASSWORD', '').split())
TO = os.environ.get('SUMMARY_TO', '').strip() or os.environ.get('ARCHIVE_TO', '').strip()
OUT = os.environ.get('OUT_DIR', 'improve-report')
PR_URL = os.environ.get('PR_URL', '').strip()
PR_STATE = os.environ.get('PR_STATE', '').strip()
REPORT_URL = os.environ.get('REPORT_URL', '').strip()
AREA = {'game': 'Game', 'daily': 'Daily puzzle', 'stories': 'Stories', 'players': 'Players', 'limits': 'Free limits',
        'speed': 'Speed', 'seo': 'Search (SEO)', 'site': 'Website'}


def build(r):
    """Returns (subject, sections) for an improve.json."""
    sections = []
    tuned = r.get('changes') or []
    if tuned:
        state = {'merged': 'Tests passed and it is live.', 'open': 'It is waiting in a pull request.',
                 'failed': 'The tests did not pass, so it was NOT applied; the pull request stays open for a look.'}.get(PR_STATE, '')
        lines = list(tuned)
        lines.append(f"Applies to daily puzzles from {r['entry']['from']} and gently to players' story choices. Past daily puzzles do not change. {state}".strip())
        if PR_URL:
            lines.append(f'Pull request: {PR_URL}')
        sections.append(('Tuned automatically this week, and why', lines))
    else:
        sections.append(('Tuned automatically this week, and why', ['Nothing needed tuning this week.']))
    merged = r.get('merged') or []
    if merged:
        sections.append(('Changes merged in the last 7 days', [f"#{m['number']} {m['title']}" + (f": {m['why']}" if m.get('why') else '') for m in merged]))
    top = [f for f in r.get('findings') or [] if not f.get('auto')][:6]
    if top:
        sections.append(('Top findings', [f"{AREA.get(f['area'], f['area'])}: {f['text']} {f.get('action') or ''}".strip() for f in top]))
    claude = [f for f in r.get('findings') or [] if f.get('forClaude')][:3]
    if claude:
        sections.append(('Next: the weekly Claude task picks up (small pull requests, merged once tests pass)', [f"{AREA.get(f['area'], f['area'])}: {f['text']}" for f in claude]))
    yours = [f for f in r.get('findings') or [] if not f.get('forClaude') and not f.get('auto') and f['area'] in ('limits', 'site', 'seo')][:4]
    if yours:
        sections.append(('May need you (outside the code)', [f"{f['text']} {f.get('action') or ''}".strip() for f in yours]))
    if r.get('ratings') and r['ratings'].get('headline'):
        sections.insert(0, ('This week in one line', [r['ratings']['headline']]))
    if r.get('notes'):
        sections.append(('Notes', r['notes']))
    subject = f"Logic Grid improvements, week of {r['today']}: " + (f"{len(tuned)} automatic tweak{'s' if len(tuned) != 1 else ''}" if tuned else 'no automatic tweaks') + f", {len(merged)} change{'s' if len(merged) != 1 else ''} merged"
    return subject, sections


def main():
    missing = [k for k, v in [('GMAIL_USER', GMAIL_USER), ('GMAIL_APP_PASSWORD', GMAIL_PASSWORD), ('SUMMARY_TO or ARCHIVE_TO', TO)] if not v]
    if missing:
        print('The weekly improvement email is not set up yet. Missing: ' + ', '.join(missing) + '. See IMPROVE.md.')
        return
    try:
        with open(os.path.join(OUT, 'improve.json'), encoding='utf-8') as f:
            r = json.load(f)
    except (OSError, ValueError):
        print('::error::improve.json is missing, so there is nothing to email.')
        sys.exit(1)
    subject, sections = build(r)
    footer = f'The full report: {REPORT_URL}' if REPORT_URL else ''
    text = '\n\n'.join(f'{h}\n' + '\n'.join(f'- {x}' for x in ls) for h, ls in sections) + (f'\n\n{footer}\n' if footer else '\n')
    body = ''.join(f'<h2 style="font-size:16px;margin:20px 0 6px">{html.escape(h)}</h2><ul style="margin:0;padding-left:20px">'
                   + ''.join(f'<li style="margin:3px 0">{html.escape(x)}</li>' for x in ls) + '</ul>' for h, ls in sections)
    link = f'<p style="margin-top:24px"><a href="{html.escape(REPORT_URL)}">The full report</a></p>' if REPORT_URL else ''
    page = f'<div style="font-family:Arial,sans-serif;font-size:14px;color:#121626;max-width:640px"><h1 style="font-size:20px;color:#5B3CC4">The Fantastical Logic Grid: what we changed and why</h1>{body}{link}</div>'
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
        print('::error::Gmail refused the sign-in. Check GMAIL_USER and the app password (GMAIL_APP_PASSWORD).')
        sys.exit(1)
    except Exception as e:  # noqa: BLE001
        print(f'::error::The email was not sent ({type(e).__name__}).')
        sys.exit(1)
    print('Weekly improvement email sent.')


if __name__ == '__main__':
    main()
