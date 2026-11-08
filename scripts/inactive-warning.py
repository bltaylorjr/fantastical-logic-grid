"""Account warnings, sent by the GitHub Action .github/workflows/inactive-warning.yml
once a day (the domain's DNS is not on Cloudflare, so the Worker cannot send
email itself). Two kinds (server/src/inactive-accounts.js):

  inactive  no activity for a while: "sign in or play before <day> to keep
            your account", sent a week (inactive_warn_days) before deletion
  name      no screen name: "choose a screen name within 3 days
            (unnamed_grace_days) or the account is deleted", with a link to
            the account page, which suggests a name

1. Ask the Worker for the accounts whose warning is due
   (POST /admin/v1/inactive-warnings/claim), 100 at a time.
2. Send each from noreply@thelogicgrid.com through Resend when RESEND_API_KEY
   is set, and the rest from the game's Gmail.
3. Tell the Worker which were sent (the days start then), which failed
   (tried again on the next run) and which the mail service refused (that
   account is then treated as having no email).

The repository is public, so its Actions logs are too: this prints only
counts, never an email address. Needs FLG_CLOUD_URL, FLG_ADMIN_TOKEN and at
least one of RESEND_API_KEY or GMAIL_USER + GMAIL_APP_PASSWORD. Without them
it says so and stops (not an error). Python standard library only.
"""
import html
import json
import os
import smtplib
import ssl
import sys
import urllib.error
import urllib.request
from datetime import date
from email.message import EmailMessage
from email.utils import formataddr, make_msgid

API = os.environ.get('FLG_CLOUD_URL', '').strip().rstrip('/')
TOKEN = os.environ.get('FLG_ADMIN_TOKEN', '').strip()
GMAIL_USER = os.environ.get('GMAIL_USER', '').strip()
GMAIL_PASSWORD = ''.join(os.environ.get('GMAIL_APP_PASSWORD', '').split())
RESEND_KEY = os.environ.get('RESEND_API_KEY', '').strip()
MAIL_NOREPLY = os.environ.get('MAIL_NOREPLY', '').strip() or 'noreply@thelogicgrid.com'
SITE = os.environ.get('FLG_SITE_URL', '').strip().rstrip('/') or 'https://thelogicgrid.com'
SENDER_NAME = 'The Logic Grid'
ROUNDS = 5  # at most 500 a run


def call(path, body):
    req = urllib.request.Request(f'{API}/admin/v1/{path}', method='POST', data=json.dumps(body).encode(),
                                 headers={'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json', 'User-Agent': 'flg-inactive-warning'})
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.loads(res.read() or b'{}')


def fail(message):
    print(f'::error::{message}')
    sys.exit(1)


def nice_day(iso):
    d = date.fromisoformat(iso)
    return f'{d.strftime("%A")}, {d.strftime("%B")} {d.day}, {d.year}'


def content(person, claim):
    """Subject, text and HTML for one warning."""
    when = nice_day(person['deleteOn'])
    hello = f"Hi {person['name']}," if person.get('name') else 'Hi,'
    if person.get('kind') == 'name':
        link = claim.get('accountUrl') or f'{SITE}/account/'
        days = claim.get('nameDays') or 3
        subject = 'Choose a screen name to keep your Logic Grid account'
        lines = [hello,
                 'Every account on The Logic Grid now needs a screen name, and yours does not have one yet.',
                 f'Sign in and choose one within {days} days. We suggest a name for you, so you can keep it with one tap or pick your own.',
                 f'If your account still has no screen name on {when}, it will be deleted with its saved puzzles, settings and scores. This cannot be undone.']
        button = 'Choose my screen name'
    else:
        link = f'{SITE}/'
        days = claim.get('days') or 30
        subject = 'Your Logic Grid account will be deleted soon'
        lines = [hello,
                 f'Your account on The Logic Grid has not been used for a while. Accounts with no activity for {days} days are deleted.',
                 f'To keep it, sign in or play a puzzle before {when}. That is all it takes.',
                 f'If you do nothing, your account will be deleted on {when} with its saved puzzles, settings and scores. This cannot be undone.']
        button = 'Sign in and keep my account'
    foot = 'You are getting this because you have an account on The Logic Grid. This is a no-reply address; questions go to support@thelogicgrid.com.'
    text = '\n\n'.join(lines + [f'{button}: {link}', f'--\n{foot}']) + '\n'
    e = html.escape
    body = ('<!doctype html><html><body style="margin:0;padding:24px;background:#f6f1e7;font-family:Arial,Helvetica,sans-serif;'
            'font-size:16px;line-height:1.5;color:#1f1a14"><div style="max-width:560px;margin:0 auto;background:#fffdf8;border-radius:10px;padding:24px">'
            + ''.join(f'<p style="margin:0 0 14px">{e(x)}</p>' for x in lines)
            + f'<p style="margin:6px 0 20px"><a href="{e(link)}" style="display:inline-block;background:#7a3e00;color:#ffffff;text-decoration:none;'
            f'padding:12px 20px;border-radius:8px;font-weight:bold">{e(button)}</a></p>'
            f'<p style="margin:20px 0 0;font-size:13px;color:#5c5246">{e(foot)}</p></div></body></html>')
    return subject, text, body


HEADERS = {'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All'}


def send_resend(people, claim):
    """Returns (sent tokens, refused tokens); the rest are left for Gmail."""
    sent, refused = [], []
    for r in people:
        subject, text, body = content(r, claim)
        payload = {'from': formataddr((SENDER_NAME, MAIL_NOREPLY)), 'to': [r['email']], 'subject': subject, 'text': text, 'html': body, 'headers': HEADERS}
        req = urllib.request.Request('https://api.resend.com/emails', method='POST', data=json.dumps(payload).encode(),
                                     headers={'Authorization': f'Bearer {RESEND_KEY}', 'Content-Type': 'application/json', 'User-Agent': 'flg-inactive-warning'})
        try:
            with urllib.request.urlopen(req, timeout=30):
                sent.append(r['token'])
        except urllib.error.HTTPError as e:
            if e.code == 422:
                refused.append(r['token'])
                continue
            print(f'Resend stopped (HTTP {e.code}); the rest go from Gmail.')
            break
        except urllib.error.URLError:
            print('Resend did not answer; the rest go from Gmail.')
            break
    return sent, refused


def send_gmail(people, claim):
    """Returns (sent tokens, refused tokens)."""
    sent, refused = [], []
    try:
        with smtplib.SMTP_SSL('smtp.gmail.com', 465, context=ssl.create_default_context(), timeout=60) as smtp:
            smtp.login(GMAIL_USER, GMAIL_PASSWORD)
            for r in people:
                subject, text, body = content(r, claim)
                msg = EmailMessage()
                msg['From'] = formataddr((SENDER_NAME + ' (no-reply)', GMAIL_USER))
                msg['To'] = r['email']
                msg['Subject'] = subject
                msg['Message-ID'] = make_msgid(domain='thelogicgrid.com')
                for k, v in HEADERS.items():
                    msg[k] = v
                msg.set_content(text)
                msg.add_alternative(body, subtype='html')
                try:
                    smtp.send_message(msg)
                    sent.append(r['token'])
                except smtplib.SMTPRecipientsRefused:
                    refused.append(r['token'])
                except smtplib.SMTPException:
                    break  # most likely Gmail's daily limit; the rest are tried again next run
    except smtplib.SMTPAuthenticationError:
        print('::error::Gmail refused the sign-in. Check GMAIL_USER and GMAIL_APP_PASSWORD.')
    except Exception as e:  # noqa: BLE001 - whatever went wrong, report what was sent
        print(f'::error::Sending stopped ({type(e).__name__}).')
    return sent, refused


def main():
    gmail = bool(GMAIL_USER and GMAIL_PASSWORD)
    missing = [n for n, v in [('FLG_CLOUD_URL', API), ('FLG_ADMIN_TOKEN', TOKEN), ('RESEND_API_KEY or GMAIL_USER + GMAIL_APP_PASSWORD', RESEND_KEY or gmail)] if not v]
    if missing:
        print('Account warnings are not set up yet (missing ' + ', '.join(missing) + ').')
        return
    totals = {'sent': 0, 'retry': 0, 'refused': 0}
    resend_ok = bool(RESEND_KEY)
    for _ in range(ROUNDS):
        try:
            claim = call('inactive-warnings/claim', {'limit': 100})
        except urllib.error.HTTPError as e:
            fail(f'The Worker refused (HTTP {e.code}). Check that FLG_ADMIN_TOKEN matches the Worker ADMIN_TOKEN.')
        except urllib.error.URLError as e:
            fail(f'The Worker did not answer: {e.reason}')
        if claim.get('off'):
            print('Automatic deletion of inactive accounts is switched off' + (f" (missing {claim['missing']})" if claim.get('missing') else '') + '.')
            return
        people = [r for r in claim.get('list', []) if r.get('email') and r.get('token') and r.get('deleteOn')]
        if not people:
            break
        sent, refused = [], []
        if resend_ok:
            s, f = send_resend(people, claim)
            sent += s
            refused += f
            resend_ok = len(s) + len(f) == len(people)
        rest = [r for r in people if r['token'] not in sent and r['token'] not in refused]
        if rest and gmail:
            s, f = send_gmail(rest, claim)
            sent += s
            refused += f
        failed = [r['token'] for r in people if r['token'] not in sent and r['token'] not in refused]
        try:
            done = call('inactive-warnings/done', {'sent': sent, 'failed': failed, 'refused': refused})
        except (urllib.error.HTTPError, urllib.error.URLError):
            fail(f'Sent {len(sent)}, but the Worker did not take the report.')
        totals['sent'] += done.get('sent', 0)
        totals['retry'] += done.get('retry', 0)
        totals['refused'] += done.get('refused', 0)
        if failed:
            break
    print(f"Account warnings: sent {totals['sent']}; {totals['retry']} to try again, {totals['refused']} refused by the mail service.")
    if totals['retry'] and not totals['sent']:
        sys.exit(1)


if __name__ == '__main__':
    main()
