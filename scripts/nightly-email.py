"""Nightly maintenance email, sent from the game's Gmail account by
.github/workflows/nightly.yml only when the night's checks found something the
owner needs to act on (the "problems" list). Quiet nights send nothing.

Reads the lists that scripts/nightly-checks.sh wrote to REPORT_DIR and emails
the problems, with the warnings below them and a link to the run.
The repository is public, so its Actions logs are too: this prints nothing but
whether the email went out.
Needs: GMAIL_USER, GMAIL_APP_PASSWORD and NIGHTLY_TO or ARCHIVE_TO (the same
secrets as the weekly emails, server/ARCHIVE.md). RUN_URL links to the run.
TEST=true sends even when there are no problems.
Python standard library only.
"""
import html
import os
import smtplib
import ssl
import sys
from email.message import EmailMessage

GMAIL_USER = os.environ.get('GMAIL_USER', '').strip()
GMAIL_PASSWORD = ''.join(os.environ.get('GMAIL_APP_PASSWORD', '').split())
TO = os.environ.get('NIGHTLY_TO', '').strip() or os.environ.get('ARCHIVE_TO', '').strip()
REPORT = os.environ.get('REPORT_DIR', 'nightly-report')
RUN_URL = os.environ.get('RUN_URL', '')
ISSUE_URL = os.environ.get('ISSUE_URL', '')
TEST = os.environ.get('TEST', '').lower() == 'true'


def lines(name):
    try:
        with open(os.path.join(REPORT, name), encoding='utf-8') as f:
            return [l.strip() for l in f if l.strip()]
    except FileNotFoundError:
        return []


def main():
    problems, warnings = lines('problems.txt'), lines('warnings.txt')
    if not problems and not TEST:
        print('Nothing needs the owner tonight, so no email.')
        return
    missing = [k for k, v in [('GMAIL_USER', GMAIL_USER), ('GMAIL_APP_PASSWORD', GMAIL_PASSWORD), ('NIGHTLY_TO or ARCHIVE_TO', TO)] if not v]
    if missing:
        print('The nightly email is not set up yet. Missing: ' + ', '.join(missing) + '. See server/ARCHIVE.md.')
        return
    count = len(problems)
    subject = f'Nightly check: {count} thing{"s" if count != 1 else ""} need{"" if count != 1 else "s"} attention' if count else 'Nightly check: test email, all clear'
    text = ['The nightly maintenance run at 2 am Eastern found:', '']
    text += [f'- {p}' for p in problems] or ['- Nothing that needs you (this is a test email).']
    if warnings:
        text += ['', 'Also worth a look (no action needed from you; these are tracked in a GitHub issue):', ''] + [f'- {w}' for w in warnings]
    text += ['', 'Most of these can be handed to Claude in the project chat: paste the line and ask for a fix.']
    if ISSUE_URL:
        text.append(f'GitHub issue: {ISSUE_URL}')
    if RUN_URL:
        text.append(f'Full report: {RUN_URL}')
    li = lambda xs: ''.join(f'<li>{html.escape(x)}</li>' for x in xs)
    page = (f'<p>The nightly maintenance run at 2 am Eastern found:</p><ul>{li(problems) or "<li>Nothing that needs you (this is a test email).</li>"}</ul>'
            + (f'<p>Also worth a look (no action needed from you; these are tracked in a GitHub issue):</p><ul>{li(warnings)}</ul>' if warnings else '')
            + '<p>Most of these can be handed to Claude in the project chat: paste the line and ask for a fix.</p>'
            + (f'<p><a href="{html.escape(ISSUE_URL)}">GitHub issue</a></p>' if ISSUE_URL else '')
            + (f'<p><a href="{html.escape(RUN_URL)}">Full report</a></p>' if RUN_URL else ''))
    msg = EmailMessage()
    msg['From'] = f'The Fantastical Logic Grid <{GMAIL_USER}>'
    msg['To'] = TO
    msg['Subject'] = subject
    msg.set_content('\n'.join(text))
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
    print('Nightly email sent.')


if __name__ == '__main__':
    main()
