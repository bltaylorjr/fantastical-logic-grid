"""Thank-you emails for the game's Ideas and Problems boxes, sent from the
game's Gmail account by the GitHub Action
.github/workflows/feedback-replies.yml every 15 minutes (the domain's DNS is
not on Cloudflare, so the Worker cannot send email itself).

1. Ask the Worker for the notes waiting (POST /admin/v1/replies/claim).
2. Send each one through Gmail (smtp.gmail.com, an app password) from a
   no-reply sender name. The text is fixed: it never contains anything the
   player wrote.
3. Tell the Worker which went out (POST /admin/v1/replies/done), which
   removes their email addresses.

The repository is public, so its Actions logs are too: this prints only
counts, never an email address. Needs: FLG_CLOUD_URL, FLG_ADMIN_TOKEN,
GMAIL_USER, GMAIL_APP_PASSWORD. Without them it says so and stops (not an
error), so the schedule is quiet until the setup is done.
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
from email.utils import formataddr, make_msgid

API = os.environ.get('FLG_CLOUD_URL', '').strip().rstrip('/')
TOKEN = os.environ.get('FLG_ADMIN_TOKEN', '').strip()
GMAIL_USER = os.environ.get('GMAIL_USER', '').strip()
GMAIL_PASSWORD = ''.join(os.environ.get('GMAIL_APP_PASSWORD', '').split())
GAME_URL = 'https://thelogicgrid.com'
SENDER_NAME = 'The Fantastical Logic Grid (no-reply)'
NO_REPLY = ('This is an automatic message from a no-reply address. Please do not reply to it: '
            'replies are not read. To share another idea or report a problem, use Menu > Ideas and problems in the game.')

NOTES = {
    'idea': {
        'subject': 'Thank you for your idea!',
        'body': ('Hello, puzzler!\n\n'
                 'Thank you for sending us your idea for The Fantastical Logic Grid, and for helping to make the game better. '
                 'We read every idea, and the best ones find their way into new stories, themes and features.\n\n'
                 'Thank you for contributing!\n\n'
                 'The Fantastical Logic Grid team\n' + GAME_URL),
    },
    'problem': {
        'subject': 'We received your problem report',
        'body': ('Hello, puzzler!\n\n'
                 'We are sorry for the inconvenience. Your problem report for The Fantastical Logic Grid has been received, '
                 'and it is being looked into and addressed.\n\n'
                 'Thank you for the information. Reports like yours help us find and fix problems for every player.\n\n'
                 'The Fantastical Logic Grid team\n' + GAME_URL),
    },
}


def call(path, body):
    req = urllib.request.Request(f'{API}/admin/v1/{path}', method='POST', data=json.dumps(body).encode(),
                                 headers={'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json', 'User-Agent': 'flg-feedback-replies'})
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.loads(res.read() or b'{}')


def fail(message):
    print(f'::error::{message}')
    sys.exit(1)


def html_version(text):
    paras = ''.join(f'<p style="margin:0 0 14px">{html.escape(p).replace(chr(10), "<br>")}</p>' for p in text.split('\n\n'))
    return ('<!doctype html><html><body style="margin:0;padding:24px;background:#f6f1e7;font-family:Arial,Helvetica,sans-serif;'
            'font-size:16px;line-height:1.5;color:#1f1a14"><div style="max-width:560px;margin:0 auto;background:#fffdf8;'
            'border-radius:10px;padding:24px">' + paras +
            f'<p style="margin:20px 0 0;font-size:13px;color:#5c5246">{html.escape(NO_REPLY)}</p></div></body></html>')


def message(kind, to):
    note = NOTES[kind]
    msg = EmailMessage()
    msg['From'] = formataddr((SENDER_NAME, GMAIL_USER))
    msg['To'] = to
    msg['Subject'] = note['subject']
    msg['Message-ID'] = make_msgid(domain='thelogicgrid.com')
    # An automatic message: mail programs should not send out-of-office answers to it.
    msg['Auto-Submitted'] = 'auto-replied'
    msg['X-Auto-Response-Suppress'] = 'All'
    text = note['body'] + '\n\n--\n' + NO_REPLY + '\n'
    msg.set_content(text)
    msg.add_alternative(html_version(note['body']), subtype='html')
    return msg


def main():
    missing = [n for n, v in [('FLG_CLOUD_URL', API), ('FLG_ADMIN_TOKEN', TOKEN), ('GMAIL_USER', GMAIL_USER), ('GMAIL_APP_PASSWORD', GMAIL_PASSWORD)] if not v]
    if missing:
        print('Thank-you emails are not set up yet (missing ' + ', '.join(missing) + '). See server/FEEDBACK-EMAILS.md.')
        return
    try:
        claim = call('replies/claim', {'limit': 50})
    except urllib.error.HTTPError as e:
        fail(f'The Worker refused (HTTP {e.code}). Check that FLG_ADMIN_TOKEN matches the Worker ADMIN_TOKEN.')
    except urllib.error.URLError as e:
        fail(f'The Worker did not answer: {e.reason}')
    if claim.get('off'):
        print('Thank-you emails are switched off in the admin dashboard.' + (f' Dropped {claim["dropped"]} waiting.' if claim.get('dropped') else ''))
        return
    replies = [r for r in claim.get('replies', []) if r.get('kind') in NOTES and r.get('email')]
    if not replies:
        print('No thank-you emails waiting.')
        return

    sent, failed = [], []
    try:
        with smtplib.SMTP_SSL('smtp.gmail.com', 465, context=ssl.create_default_context(), timeout=60) as smtp:
            smtp.login(GMAIL_USER, GMAIL_PASSWORD)
            for r in replies:
                try:
                    smtp.send_message(message(r['kind'], r['email']))
                    sent.append(r['id'])
                except smtplib.SMTPRecipientsRefused:
                    failed.append(r['id'])
                except smtplib.SMTPException:
                    # Most likely Gmail's daily limit: stop, the rest are tried again later.
                    break
    except smtplib.SMTPAuthenticationError:
        print('::error::Gmail refused the sign-in. Check GMAIL_USER and GMAIL_APP_PASSWORD.')
    except Exception as e:  # noqa: BLE001 - whatever went wrong, report what was sent
        print(f'::error::Sending stopped ({type(e).__name__}).')
    left = [r['id'] for r in replies if r['id'] not in sent and r['id'] not in failed]
    try:
        done = call('replies/done', {'sent': sent, 'failed': failed + left})
    except (urllib.error.HTTPError, urllib.error.URLError):
        fail(f'Sent {len(sent)}, but the Worker did not take the report. They may be sent again in 30 minutes.')
    print(f'Sent {done.get("sent", 0)} thank-you emails; {len(failed) + len(left)} will be tried again.')
    if not sent:
        sys.exit(1)


if __name__ == '__main__':
    main()
