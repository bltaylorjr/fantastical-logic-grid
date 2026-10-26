"""Daily puzzle by email, sent by the GitHub Action .github/workflows/daily-email.yml
once a day (the domain's DNS is not on Cloudflare, so the Worker cannot send
email itself).

1. Read today's puzzle from the live site (thelogicgrid.com/daily/latest.json).
2. Ask the Worker for the players who asked for it and have not had today's
   yet (POST /admin/v1/daily-email/claim), 100 at a time.
3. Send each one from noreply@thelogicgrid.com through Resend (free plan:
   100 a day) when RESEND_API_KEY is set and the domain is verified there,
   and the rest from the game's Gmail. Every email has a one-click
   unsubscribe link and List-Unsubscribe headers.
4. Tell the Worker which failed (tried again on the next run) or were
   refused by the mail service (taken off the list).

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
import urllib.parse
import urllib.request
from email.message import EmailMessage
from email.utils import formataddr, make_msgid

API = os.environ.get('FLG_CLOUD_URL', '').strip().rstrip('/')
TOKEN = os.environ.get('FLG_ADMIN_TOKEN', '').strip()
GMAIL_USER = os.environ.get('GMAIL_USER', '').strip()
GMAIL_PASSWORD = ''.join(os.environ.get('GMAIL_APP_PASSWORD', '').split())
RESEND_KEY = os.environ.get('RESEND_API_KEY', '').strip()
MAIL_FROM = os.environ.get('MAIL_FROM', '').strip() or 'noreply@thelogicgrid.com'
SITE = os.environ.get('FLG_SITE_URL', '').strip().rstrip('/') or 'https://thelogicgrid.com'
SENDER_NAME = 'The Fantastical Logic Grid'
ROUNDS = 5  # at most 500 a run


def call(path, body):
    req = urllib.request.Request(f'{API}/admin/v1/{path}', method='POST', data=json.dumps(body).encode(),
                                 headers={'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json', 'User-Agent': 'flg-daily-email'})
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.loads(res.read() or b'{}')


def fail(message):
    print(f'::error::{message}')
    sys.exit(1)


def todays_puzzle():
    req = urllib.request.Request(f'{SITE}/daily/latest.json', headers={'User-Agent': 'flg-daily-email'})
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.loads(res.read())


def play_link(day):
    q = urllib.parse.urlencode({'play': 'daily', 'utm_source': 'email', 'utm_medium': 'email', 'utm_campaign': 'daily-email'})
    return f'{SITE}/?{q}'


def unsubscribe_link(token):
    return f'{API}/v1/daily-email/unsubscribe?t={token}'


SUPPORT_LINE = 'The Fantastical Logic Grid is free, has no ads, and is made by one person. If you enjoy it, you can help keep it going'


def content(p, support=''):
    """Subject, text and HTML for the day's puzzle; the HTML has {unsub} to fill in.
    support: the Support page link, sent by the Worker only once support asks are on."""
    when = p['date']
    size = f"{p['categories']} categories x {p['items']} items"
    subject = f"Today's logic puzzle: {p['title']}"
    link = play_link(when)
    text = (f"Today's daily puzzle is ready.\n\n{p['title']}\n{p['difficultyName']} · {p['themeName']} · {size}\n\n"
            f"{p['opening']}\n\nPlay it free: {link}\n\nThe same puzzle for everyone today. Solve it to keep your streak going.\n\n"
            + (f"{SUPPORT_LINE}: {support}\n\n" if support else '')
            + "--\nYou asked for the daily puzzle by email in The Fantastical Logic Grid. This is a no-reply address.\n"
            "Unsubscribe with one click: {unsub}\n")
    e = html.escape
    body = ('<!doctype html><html><body style="margin:0;padding:24px;background:#f6f1e7;font-family:Arial,Helvetica,sans-serif;'
            'font-size:16px;line-height:1.5;color:#1f1a14"><div style="max-width:560px;margin:0 auto;background:#fffdf8;border-radius:10px;padding:24px">'
            '<p style="margin:0 0 6px;font-size:14px;color:#5c5246">Today\'s daily puzzle</p>'
            f'<h1 style="margin:0 0 8px;font-size:24px">{e(p["title"])}</h1>'
            f'<p style="margin:0 0 16px;font-size:14px;color:#5c5246">{e(p["difficultyName"])} · {e(p["themeName"])} · {e(size)}</p>'
            f'<p style="margin:0 0 20px">{e(p["opening"])}</p>'
            f'<p style="margin:0 0 20px"><a href="{e(link)}" style="display:inline-block;background:#7a3e00;color:#ffffff;text-decoration:none;'
            'padding:12px 20px;border-radius:8px;font-weight:bold">Play today\'s puzzle</a></p>'
            '<p style="margin:0 0 14px">The same puzzle for everyone today. Solve it to keep your streak going.</p>'
            + (f'<p style="margin:0 0 14px;font-size:14px;color:#5c5246">{e(SUPPORT_LINE)}: <a href="{e(support)}" style="color:#7a3e00">support the game</a>.</p>' if support else '')
            + '<p style="margin:20px 0 0;font-size:13px;color:#5c5246">You asked for the daily puzzle by email in The Fantastical Logic Grid. '
            'This is a no-reply address. <a href="{unsub}" style="color:#5c5246">Unsubscribe</a> with one click.</p>'
            '</div></body></html>')
    return subject, text, body


def headers_for(token):
    return {'List-Unsubscribe': f'<{unsubscribe_link(token)}>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All'}


def send_resend(people, mail):
    """Returns (sent tokens, refused tokens); the rest are left for Gmail."""
    subject, text, body = mail
    sent, refused = [], []
    for r in people:
        unsub = unsubscribe_link(r['token'])
        payload = {'from': formataddr((SENDER_NAME, MAIL_FROM)), 'to': [r['email']], 'subject': subject,
                   'text': text.replace('{unsub}', unsub), 'html': body.replace('{unsub}', html.escape(unsub)), 'headers': headers_for(r['token'])}
        req = urllib.request.Request('https://api.resend.com/emails', method='POST', data=json.dumps(payload).encode(),
                                     headers={'Authorization': f'Bearer {RESEND_KEY}', 'Content-Type': 'application/json', 'User-Agent': 'flg-daily-email'})
        try:
            with urllib.request.urlopen(req, timeout=30):
                sent.append(r['token'])
        except urllib.error.HTTPError as e:
            if e.code == 422:
                refused.append(r['token'])
                continue
            reasons = {401: 'the key is wrong', 403: 'the domain is not verified yet', 429: 'the free daily limit is used up'}
            print(f'Resend stopped (HTTP {e.code}: {reasons.get(e.code, "an error")}); the rest go from Gmail.')
            break
        except urllib.error.URLError:
            print('Resend did not answer; the rest go from Gmail.')
            break
    return sent, refused


def send_gmail(people, mail):
    """Returns (sent tokens, refused tokens)."""
    subject, text, body = mail
    sent, refused = [], []
    try:
        with smtplib.SMTP_SSL('smtp.gmail.com', 465, context=ssl.create_default_context(), timeout=60) as smtp:
            smtp.login(GMAIL_USER, GMAIL_PASSWORD)
            for r in people:
                unsub = unsubscribe_link(r['token'])
                msg = EmailMessage()
                msg['From'] = formataddr((SENDER_NAME + ' (no-reply)', GMAIL_USER))
                msg['To'] = r['email']
                msg['Subject'] = subject
                msg['Message-ID'] = make_msgid(domain='thelogicgrid.com')
                for k, v in headers_for(r['token']).items():
                    msg[k] = v
                msg.set_content(text.replace('{unsub}', unsub))
                msg.add_alternative(body.replace('{unsub}', html.escape(unsub)), subtype='html')
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
        print('The daily email is not set up yet (missing ' + ', '.join(missing) + '). See server/DAILY-EMAIL.md.')
        return
    try:
        puzzle = todays_puzzle()
    except (urllib.error.URLError, ValueError) as e:
        fail(f"Today's puzzle could not be read from the site ({type(e).__name__}).")
    if not all(puzzle.get(k) for k in ('date', 'title', 'opening', 'difficultyName', 'themeName')):
        fail("The site's latest.json is missing today's puzzle.")
    mail = None

    totals = {'Resend': 0, 'Gmail': 0, 'retry': 0, 'removed': 0}
    resend_ok = bool(RESEND_KEY)
    for _ in range(ROUNDS):
        try:
            claim = call('daily-email/claim', {'day': puzzle['date'], 'limit': 100})
        except urllib.error.HTTPError as e:
            fail(f'The Worker refused (HTTP {e.code}). Check that FLG_ADMIN_TOKEN matches the Worker ADMIN_TOKEN.')
        except urllib.error.URLError as e:
            fail(f'The Worker did not answer: {e.reason}')
        if claim.get('off'):
            print('The daily email is switched off in the admin dashboard.')
            return
        people = [r for r in claim.get('list', []) if r.get('email') and r.get('token')]
        if not people:
            break
        if mail is None:
            mail = content(puzzle, claim.get('support') or '')
        sent, refused = [], []
        if resend_ok:
            s, f = send_resend(people, mail)
            sent += s
            refused += f
            totals['Resend'] += len(s)
            resend_ok = len(s) + len(f) == len(people)  # Resend stopped: use Gmail from now on
        rest = [r for r in people if r['token'] not in sent and r['token'] not in refused]
        if rest and gmail:
            s, f = send_gmail(rest, mail)
            sent += s
            refused += f
            totals['Gmail'] += len(s)
        failed = [r['token'] for r in people if r['token'] not in sent and r['token'] not in refused]
        try:
            done = call('daily-email/done', {'failed': failed, 'refused': refused})
        except (urllib.error.HTTPError, urllib.error.URLError):
            fail(f'Sent {len(sent)}, but the Worker did not take the report.')
        totals['retry'] += done.get('retry', 0)
        totals['removed'] += done.get('removed', 0)
        if failed:
            break  # the senders stopped; the rest wait for the next run
    print(f"Daily puzzle {puzzle['date']}: sent {totals['Resend'] + totals['Gmail']} (Resend {totals['Resend']}, Gmail {totals['Gmail']}); "
          f"{totals['retry']} to try again, {totals['removed']} refused and taken off the list.")
    if totals['retry'] and not (totals['Resend'] + totals['Gmail']):
        sys.exit(1)


if __name__ == '__main__':
    main()
