"""Thank-you emails for the game's Ideas and Problems boxes, sent by the
GitHub Action .github/workflows/feedback-replies.yml every 15 minutes (the
domain's DNS is not on Cloudflare, so the Worker cannot send email itself).

1. Ask the Worker for the notes waiting (POST /admin/v1/replies/claim).
2. Send each one from noreply@thelogicgrid.com through Resend (free plan:
   100 a day, 3,000 a month) when RESEND_API_KEY is set and the domain is
   verified there. Anything Resend does not take goes from the game's Gmail
   (smtp.gmail.com, an app password) with a "(no-reply)" sender name
   instead. The text is fixed: it never contains anything the player wrote.
3. Tell the Worker which went out (POST /admin/v1/replies/done), which
   removes their email addresses.

The repository is public, so its Actions logs are too: this prints only
counts, never an email address. Needs FLG_CLOUD_URL, FLG_ADMIN_TOKEN and at
least one of RESEND_API_KEY or GMAIL_USER + GMAIL_APP_PASSWORD; MAIL_FROM is
optional. Without them it says so and stops (not an error).
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
RESEND_KEY = os.environ.get('RESEND_API_KEY', '').strip()
MAIL_FROM = os.environ.get('MAIL_FROM', '').strip() or 'noreply@thelogicgrid.com'
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
    'message': {
        'subject': 'You have a new message from The Fantastical Logic Grid team',
        'body': ('Hello, puzzler!\n\n'
                 'The Fantastical Logic Grid team has written to you. To read it and reply, open the game, '
                 'sign in and choose Menu > Messages.\n\n'
                 'You get this email because you turned on "Email me when the team writes" in Messages. '
                 'To stop these emails, untick it there.\n\n'
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


def text_version(kind):
    return NOTES[kind]['body'] + '\n\n--\n' + NO_REPLY + '\n'


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
    msg.set_content(text_version(kind))
    msg.add_alternative(html_version(note['body']), subtype='html')
    return msg


def send_resend(replies):
    """Sends through Resend from MAIL_FROM. Returns (sent ids, refused ids);
    anything in neither list is left for Gmail."""
    sent, refused = [], []
    for r in replies:
        payload = {'from': formataddr(('The Fantastical Logic Grid', MAIL_FROM)), 'to': [r['email']], 'subject': NOTES[r['kind']]['subject'],
                   'text': text_version(r['kind']), 'html': html_version(NOTES[r['kind']]['body']),
                   'headers': {'Auto-Submitted': 'auto-replied', 'X-Auto-Response-Suppress': 'All'}}
        req = urllib.request.Request('https://api.resend.com/emails', method='POST', data=json.dumps(payload).encode(),
                                     headers={'Authorization': f'Bearer {RESEND_KEY}', 'Content-Type': 'application/json', 'User-Agent': 'flg-feedback-replies'})
        try:
            with urllib.request.urlopen(req, timeout=30):
                sent.append(r['id'])
        except urllib.error.HTTPError as e:
            if e.code == 422:
                # Resend says this address cannot be sent to (for example it is malformed).
                refused.append(r['id'])
                continue
            reasons = {401: 'the key is wrong', 403: 'the domain is not verified yet', 429: 'the free daily limit is used up'}
            print(f'Resend stopped (HTTP {e.code}: {reasons.get(e.code, "an error")}); the rest go from Gmail.')
            break
        except urllib.error.URLError:
            print('Resend did not answer; the rest go from Gmail.')
            break
    return sent, refused


def send_gmail(replies):
    """Sends through Gmail. Returns (sent ids, refused ids)."""
    sent, refused = [], []
    try:
        with smtplib.SMTP_SSL('smtp.gmail.com', 465, context=ssl.create_default_context(), timeout=60) as smtp:
            smtp.login(GMAIL_USER, GMAIL_PASSWORD)
            for r in replies:
                try:
                    smtp.send_message(message(r['kind'], r['email']))
                    sent.append(r['id'])
                except smtplib.SMTPRecipientsRefused:
                    refused.append(r['id'])
                except smtplib.SMTPException:
                    # Most likely Gmail's daily limit: stop, the rest are tried again later.
                    break
    except smtplib.SMTPAuthenticationError:
        print('::error::Gmail refused the sign-in. Check GMAIL_USER and GMAIL_APP_PASSWORD.')
    except Exception as e:  # noqa: BLE001 - whatever went wrong, report what was sent
        print(f'::error::Sending stopped ({type(e).__name__}).')
    return sent, refused


def main():
    gmail = bool(GMAIL_USER and GMAIL_PASSWORD)
    missing = [n for n, v in [('FLG_CLOUD_URL', API), ('FLG_ADMIN_TOKEN', TOKEN), ('RESEND_API_KEY or GMAIL_USER + GMAIL_APP_PASSWORD', RESEND_KEY or gmail)] if not v]
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

    sent, failed, via = [], [], {'Resend': 0, 'Gmail': 0}
    if RESEND_KEY:
        s, f = send_resend(replies)
        sent += s
        failed += f
        via['Resend'] = len(s)
    rest = [r for r in replies if r['id'] not in sent and r['id'] not in failed]
    if rest and gmail:
        s, f = send_gmail(rest)
        sent += s
        failed += f
        via['Gmail'] = len(s)
    left = [r['id'] for r in replies if r['id'] not in sent and r['id'] not in failed]
    try:
        done = call('replies/done', {'sent': sent, 'failed': failed + left})
    except (urllib.error.HTTPError, urllib.error.URLError):
        fail(f'Sent {len(sent)}, but the Worker did not take the report. They may be sent again in 30 minutes.')
    print(f'Sent {done.get("sent", 0)} thank-you emails (Resend {via["Resend"]}, Gmail {via["Gmail"]}); {len(failed) + len(left)} will be tried again.')
    if not sent:
        sys.exit(1)


if __name__ == '__main__':
    main()
