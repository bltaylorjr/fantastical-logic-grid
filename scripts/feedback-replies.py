"""Thank-you and update emails for the game's Ideas and Problems boxes, sent by the
GitHub Action .github/workflows/feedback-replies.yml every 15 minutes (the
domain's DNS is not on Cloudflare, so the Worker cannot send email itself).

1. Ask the Worker for the notes waiting (POST /admin/v1/replies/claim).
2. Send each one from support@thelogicgrid.com (team-message notices from
   noreply@thelogicgrid.com, since players answer those in the game) through Resend (free plan:
   100 a day, 3,000 a month) when RESEND_API_KEY is set and the domain is
   verified there. Anything Resend does not take goes from the game's Gmail
   (smtp.gmail.com, an app password) instead. Replies go to MAIL_REPLY_TO. The wording is fixed; thank-you and update emails also quote
   what the player wrote (and, for an update, the team's note on what was
   done). They only ever go to the player's own confirmed address.
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
MAIL_FROM = os.environ.get('MAIL_FROM', '').strip() or 'support@thelogicgrid.com'
# Replies to player emails land here until support@ has its own inbox (MAIL_REPLY_TO overrides).
REPLY_TO = os.environ.get('MAIL_REPLY_TO', '').strip() or 'fantasticallogicgrid@gmail.com'
# One-way emails (nothing to answer) go from here, with no Reply-To.
MAIL_NOREPLY = os.environ.get('MAIL_NOREPLY', '').strip() or 'noreply@thelogicgrid.com'
GAME_URL = 'https://thelogicgrid.com'
SENDER_NAME = 'The Fantastical Logic Grid'
NO_REPLY = ('Questions? Just reply to this email. To share another idea or report a problem, '
            'use Menu > Ideas and problems in the game.')
ONE_WAY = ('This is an automatic message from a no-reply address, so replies are not read. '
           'To answer the team, open the game and choose Menu > Messages.')
ONE_WAY_KINDS = {'message'}  # sent from MAIL_NOREPLY; everything else from MAIL_FROM


def footer(r):
    return ONE_WAY if r['kind'] in ONE_WAY_KINDS else NO_REPLY

SIGN_OFF = 'The Fantastical Logic Grid team\n' + GAME_URL

# Each email is a list of blocks: plain paragraphs, and ('quote', label, text)
# for the player's own words or the team's note. Those come from the Worker,
# already cleaned (no email addresses or links), and go only to the player's
# own address. An email whose words are missing still reads well without them.
NOTES = {
    'idea': {
        'subject': 'Thank you for your idea!',
        'blocks': lambda r: [
            'Hello, puzzler!',
            'Thank you for sending us your idea for The Fantastical Logic Grid, and for helping to make the game better. '
            'We read every idea, and the best ones find their way into new stories, themes and features.',
            ('quote', 'Your idea', r.get('text')),
            'We will email you again when the team acts on it. Thank you for contributing!',
            SIGN_OFF,
        ],
    },
    'problem': {
        'subject': 'We received your problem report',
        'blocks': lambda r: [
            'Hello, puzzler!',
            'We are sorry for the inconvenience. Your problem report for The Fantastical Logic Grid has been received, '
            'and it is being looked into and addressed.',
            ('quote', 'What you reported', r.get('text')),
            'Thank you for the information. Reports like yours help us find and fix problems for every player. '
            'We will email you again when it has been addressed.',
            SIGN_OFF,
        ],
    },
    'idea_update': {
        'subject': 'An update on your idea',
        'blocks': lambda r: [
            'Hello, puzzler!',
            'Good news: the team has acted on the idea you sent us for The Fantastical Logic Grid.',
            ('quote', 'Your idea', r.get('text')),
            ('quote', 'What we did', r.get('note')),
            'Thank you again for helping to make the game better. Open the game to see it, and keep the ideas coming!',
            SIGN_OFF,
        ],
    },
    'problem_update': {
        'subject': 'The problem you reported has been addressed',
        'blocks': lambda r: [
            'Hello, puzzler!',
            'The problem you reported in The Fantastical Logic Grid has been addressed. Thank you for your patience.',
            ('quote', 'What you reported', r.get('text')),
            ('quote', 'What we did', r.get('note')),
            'If you still see it after updating the game, please tell us in Menu > Ideas and problems. '
            'Thank you for helping us make the game better for every player.',
            SIGN_OFF,
        ],
    },
    'message': {
        'subject': 'You have a new message from The Fantastical Logic Grid team',
        'blocks': lambda r: [
            'Hello, puzzler!',
            'The Fantastical Logic Grid team has written to you. To read it and reply, open the game, '
            'sign in and choose Menu > Messages.',
            'You get this email because you turned on "Email me when the team writes" in Messages. '
            'To stop these emails, untick it there.',
            SIGN_OFF,
        ],
    },
}


def blocks(r):
    """The email's blocks, without quotes that have no words."""
    return [b for b in NOTES[r['kind']]['blocks'](r) if isinstance(b, str) or (b[2] or '').strip()]


def call(path, body):
    req = urllib.request.Request(f'{API}/admin/v1/{path}', method='POST', data=json.dumps(body).encode(),
                                 headers={'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json', 'User-Agent': 'flg-feedback-replies'})
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.loads(res.read() or b'{}')


def fail(message):
    print(f'::error::{message}')
    sys.exit(1)


def html_version(r):
    parts = []
    for b in blocks(r):
        if isinstance(b, str):
            parts.append(f'<p style="margin:0 0 14px">{html.escape(b).replace(chr(10), "<br>")}</p>')
        else:
            parts.append(f'<p style="margin:0 0 6px;font-weight:bold">{html.escape(b[1])}:</p>'
                         '<blockquote style="margin:0 0 16px;padding:10px 14px;border-left:4px solid #b08d3c;background:#f6f1e7;'
                         f'border-radius:4px">{html.escape(b[2].strip()).replace(chr(10), "<br>")}</blockquote>')
    return ('<!doctype html><html><body style="margin:0;padding:24px;background:#f6f1e7;font-family:Arial,Helvetica,sans-serif;'
            'font-size:16px;line-height:1.5;color:#1f1a14"><div style="max-width:560px;margin:0 auto;background:#fffdf8;'
            'border-radius:10px;padding:24px">' + ''.join(parts) +
            f'<p style="margin:20px 0 0;font-size:13px;color:#5c5246">{html.escape(footer(r))}</p></div></body></html>')


def text_version(r):
    out = []
    for b in blocks(r):
        if isinstance(b, str):
            out.append(b)
        else:
            out.append(b[1] + ':\n' + '\n'.join('> ' + line for line in b[2].strip().split('\n')))
    return '\n\n'.join(out) + '\n\n--\n' + footer(r) + '\n'


def message(r):
    msg = EmailMessage()
    one_way = r['kind'] in ONE_WAY_KINDS
    msg['From'] = formataddr((SENDER_NAME + (' (no-reply)' if one_way else ''), GMAIL_USER))
    msg['To'] = r['email']
    if not one_way:
        msg['Reply-To'] = REPLY_TO
    msg['Subject'] = NOTES[r['kind']]['subject']
    msg['Message-ID'] = make_msgid(domain='thelogicgrid.com')
    # An automatic message: mail programs should not send out-of-office answers to it.
    msg['Auto-Submitted'] = 'auto-replied'
    msg['X-Auto-Response-Suppress'] = 'All'
    msg.set_content(text_version(r))
    msg.add_alternative(html_version(r), subtype='html')
    return msg


def send_resend(replies):
    """Sends through Resend from MAIL_FROM. Returns (sent ids, refused ids);
    anything in neither list is left for Gmail."""
    sent, refused = [], []
    for r in replies:
        one_way = r['kind'] in ONE_WAY_KINDS
        payload = {'from': formataddr((SENDER_NAME, MAIL_NOREPLY if one_way else MAIL_FROM)), 'to': [r['email']], 'subject': NOTES[r['kind']]['subject'],
                   'text': text_version(r), 'html': html_version(r),
                   'headers': {'Auto-Submitted': 'auto-replied', 'X-Auto-Response-Suppress': 'All'}}
        if not one_way:
            payload['reply_to'] = REPLY_TO
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
                    smtp.send_message(message(r))
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
