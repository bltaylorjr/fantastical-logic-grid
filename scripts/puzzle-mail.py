"""Puzzle emails, sent by the GitHub Action .github/workflows/puzzle-mail.yml
every 15 minutes (the domain's DNS is not on Cloudflare, so the Worker cannot
send email itself). See server/PUZZLE-EMAILS.md.

1. Ask the Worker what is due (POST /admin/v1/mail/due): confirm emails
   waiting, this week's puzzle (from Monday at about 7 am Eastern) and special
   editions whose day has come.
2. For each, ask for up to 100 addresses at a time (POST /admin/v1/mail/claim)
   and send them from noreply@thelogicgrid.com through Resend (free plan:
   100 a day) when RESEND_API_KEY is set and the domain is verified there,
   and the rest from the game's Gmail. The weekly and special puzzles are read
   from the live site, so nothing goes out before the site has them. Every
   puzzle email has a one-click unsubscribe link, List-Unsubscribe headers and
   a link to change which emails come.
3. Tell the Worker which failed (tried again on the next run) or were refused
   by the mail service (taken off the list) (POST /admin/v1/mail/done).

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
ROUNDS = 5  # at most 500 of each a run
SUPPORT_LINE = 'The Fantastical Logic Grid is free, has no ads, and is made by one person. If you enjoy it, you can help keep it going'
LIST_NAMES = {'weekly': 'the puzzle of the week (Mondays)', 'special': 'special edition puzzles'}


class Stop(Exception):
    pass


def call(path, body):
    req = urllib.request.Request(f'{API}/admin/v1/{path}', method='POST', data=json.dumps(body).encode(),
                                 headers={'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json', 'User-Agent': 'flg-puzzle-mail'})
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.loads(res.read() or b'{}')


def site_json(path):
    """The file from the live site, or None while the site does not have it yet."""
    req = urllib.request.Request(f'{SITE}/{path}', headers={'User-Agent': 'flg-puzzle-mail'})
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.loads(res.read())
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise


def link(params, campaign):
    q = urllib.parse.urlencode({**params, 'utm_source': 'email', 'utm_medium': 'email', 'utm_campaign': campaign})
    return f'{SITE}/?{q}'


# ------------------------------------------------------------- the emails
# Each returns (subject, text, html, headers) for one person.
E = html.escape
WRAP = ('<!doctype html><html><body style="margin:0;padding:24px;background:#f6f1e7;font-family:Arial,Helvetica,sans-serif;'
        'font-size:16px;line-height:1.5;color:#1f1a14"><div style="max-width:560px;margin:0 auto;background:#fffdf8;border-radius:10px;padding:24px">{}</div></body></html>')
BUTTON = ('<p style="margin:0 0 20px"><a href="{}" style="display:inline-block;background:#7a3e00;color:#ffffff;text-decoration:none;'
          'padding:12px 20px;border-radius:8px;font-weight:bold">{}</a></p>')
SMALL = '<p style="margin:20px 0 0;font-size:13px;color:#5c5246">{}</p>'


def confirm_email(person):
    url = f"{API}/v1/mail/confirm?t={person['token']}"
    what = ' and '.join(LIST_NAMES[x] for x in person.get('lists', []) if x in LIST_NAMES) or 'puzzle emails'
    subject = 'Confirm your puzzle emails'
    text = (f"Someone, hopefully you, asked for {what} from The Fantastical Logic Grid at this address.\n\n"
            f"To confirm, open this link and press Confirm:\n{url}\n\n"
            "If you did not ask for this, ignore this email and nothing more will come. The link stops working after 7 days.\n\n"
            "--\nThe Fantastical Logic Grid. This is a no-reply address.\n")
    body = WRAP.format(
        '<h1 style="margin:0 0 12px;font-size:22px">Confirm your puzzle emails</h1>'
        f'<p style="margin:0 0 16px">Someone, hopefully you, asked for {E(what)} from The Fantastical Logic Grid at this address.</p>'
        + BUTTON.format(E(url), 'Confirm my emails')
        + '<p style="margin:0 0 14px">If you did not ask for this, ignore this email and nothing more will come. The link stops working after 7 days.</p>'
        + SMALL.format('The Fantastical Logic Grid. This is a no-reply address.'))
    return subject, text, body, {'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All'}


def puzzle_email(person, *, kind, heading, subject, title, meta, opening, note, play_url, support):
    unsub = f"{API}/v1/mail/unsubscribe?t={person['token']}&l={kind}"
    settings = f"{API}/v1/mail/settings?t={person['token']}"
    why = 'the puzzle of the week' if kind == 'weekly' else 'special edition puzzles'
    text = (f"{heading}\n\n{title}\n{meta}\n\n" + (f"{note}\n\n" if note else '') + f"{opening}\n\nPlay it free: {play_url}\n\n"
            + (f"{SUPPORT_LINE}: {support}\n\n" if support else '')
            + f"--\nYou asked for {why} by email from The Fantastical Logic Grid. This is a no-reply address.\n"
            f"Unsubscribe with one click: {unsub}\nChange which emails you get: {settings}\n")
    body = WRAP.format(
        f'<p style="margin:0 0 6px;font-size:14px;color:#5c5246">{E(heading)}</p>'
        f'<h1 style="margin:0 0 8px;font-size:24px">{E(title)}</h1>'
        f'<p style="margin:0 0 16px;font-size:14px;color:#5c5246">{E(meta)}</p>'
        + (f'<p style="margin:0 0 16px;font-style:italic">{E(note)}</p>' if note else '')
        + f'<p style="margin:0 0 20px">{E(opening)}</p>'
        + BUTTON.format(E(play_url), 'Play it free')
        + (f'<p style="margin:0 0 14px;font-size:14px;color:#5c5246">{E(SUPPORT_LINE)}: <a href="{E(support)}" style="color:#7a3e00">support the game</a>.</p>' if support else '')
        + SMALL.format(f'You asked for {E(why)} by email from The Fantastical Logic Grid. This is a no-reply address. '
                       f'<a href="{E(unsub)}" style="color:#5c5246">Unsubscribe</a> with one click, or '
                       f'<a href="{E(settings)}" style="color:#5c5246">change which emails you get</a>.'))
    headers = {'List-Unsubscribe': f'<{unsub}>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
               'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All'}
    return subject, text, body, headers


def size(p):
    return f"{p['categories']} categories x {p['items']} items"


def weekly_builder(w, support):
    meta = f"{w['difficultyName']} · {w['themeName']} · {size(w)}"
    play = link({'play': 'weekly', 'week': w['week']}, 'weekly-email')
    return lambda person: puzzle_email(person, kind='weekly', heading='The puzzle of the week', subject=f"Puzzle of the week: {w['title']}",
                                       title=w['title'], meta=meta, opening=w['opening'], note='', play_url=play, support=support)


def special_builder(edition, s, support):
    p = s['puzzle']
    meta = f"{p['difficulty']['name']} · {p['theme']['name']} · {len(p['categories'])} categories x {len(p['categories'][0]['items'])} items"
    play = link({'play': 'special', 'id': edition['id']}, 'special-email')
    return lambda person: puzzle_email(person, kind='special', heading=f"Special edition: {s['title']}", subject=f"Special edition puzzle: {s['title']}",
                                       title=p['title'], meta=meta, opening=p['story']['paragraphs'][0], note=s.get('note') or '', play_url=play, support=support)


# ------------------------------------------------------------- sending
def send_resend(items):
    """items: [(person, (subject, text, html, headers))]. Returns (sent tokens, refused tokens); the rest are left for Gmail."""
    sent, refused = [], []
    for person, (subject, text, body, headers) in items:
        payload = {'from': formataddr((SENDER_NAME, MAIL_FROM)), 'to': [person['email']], 'subject': subject, 'text': text, 'html': body, 'headers': headers}
        req = urllib.request.Request('https://api.resend.com/emails', method='POST', data=json.dumps(payload).encode(),
                                     headers={'Authorization': f'Bearer {RESEND_KEY}', 'Content-Type': 'application/json', 'User-Agent': 'flg-puzzle-mail'})
        try:
            with urllib.request.urlopen(req, timeout=30):
                sent.append(person['token'])
        except urllib.error.HTTPError as e:
            if e.code == 422:
                refused.append(person['token'])
                continue
            reasons = {401: 'the key is wrong', 403: 'the domain is not verified yet', 429: 'the free daily limit is used up'}
            print(f'Resend stopped (HTTP {e.code}: {reasons.get(e.code, "an error")}); the rest go from Gmail.')
            break
        except urllib.error.URLError:
            print('Resend did not answer; the rest go from Gmail.')
            break
    return sent, refused


def send_gmail(items):
    sent, refused = [], []
    try:
        with smtplib.SMTP_SSL('smtp.gmail.com', 465, context=ssl.create_default_context(), timeout=60) as smtp:
            smtp.login(GMAIL_USER, GMAIL_PASSWORD)
            for person, (subject, text, body, headers) in items:
                msg = EmailMessage()
                msg['From'] = formataddr((SENDER_NAME + ' (no-reply)', GMAIL_USER))
                msg['To'] = person['email']
                msg['Subject'] = subject
                msg['Message-ID'] = make_msgid(domain='thelogicgrid.com')
                for k, v in headers.items():
                    msg[k] = v
                msg.set_content(text)
                msg.add_alternative(body, subtype='html')
                try:
                    smtp.send_message(msg)
                    sent.append(person['token'])
                except smtplib.SMTPRecipientsRefused:
                    refused.append(person['token'])
                except smtplib.SMTPException:
                    break  # most likely Gmail's daily limit; the rest are tried again next run
    except smtplib.SMTPAuthenticationError:
        print('::error::Gmail refused the sign-in. Check GMAIL_USER and GMAIL_APP_PASSWORD.')
    except Exception as e:  # noqa: BLE001 - whatever went wrong, report what was sent
        print(f'::error::Sending stopped ({type(e).__name__}).')
    return sent, refused


class Senders:
    def __init__(self):
        self.resend = bool(RESEND_KEY)
        self.gmail = bool(GMAIL_USER and GMAIL_PASSWORD)
        self.counts = {'Resend': 0, 'Gmail': 0}

    def send(self, items):
        sent, refused = [], []
        if self.resend:
            s, f = send_resend(items)
            sent += s
            refused += f
            self.counts['Resend'] += len(s)
            self.resend = len(s) + len(f) == len(items)  # Resend stopped: use Gmail from now on
        rest = [x for x in items if x[0]['token'] not in sent and x[0]['token'] not in refused]
        if rest and self.gmail:
            s, f = send_gmail(rest)
            sent += s
            refused += f
            self.counts['Gmail'] += len(s)
        return sent, refused


def run(senders, send, build, label):
    """Claims, sends and reports one send ('confirm', 'weekly-<Monday>', 'special-<id>'). Returns how many went out."""
    total = 0
    for _ in range(ROUNDS):
        try:
            claim = call('mail/claim', {'send': send, 'limit': 100})
        except urllib.error.HTTPError as e:
            if e.code == 400:
                print(f'{label}: not due any more.')
                return total
            raise Stop(f'The Worker refused (HTTP {e.code}). Check that FLG_ADMIN_TOKEN matches the Worker ADMIN_TOKEN.')
        except urllib.error.URLError as e:
            raise Stop(f'The Worker did not answer: {e.reason}')
        if claim.get('off'):
            return total
        people = [r for r in claim.get('list', []) if r.get('email') and r.get('token')]
        if not people:
            if claim.get('capped'):
                print(f'{label}: the daily limit (Puzzle emails a day) is reached; the rest go tomorrow.')
            break
        items = [(p, build(p)) for p in people]
        sent, refused = senders.send(items)
        failed = [p['token'] for p in people if p['token'] not in sent and p['token'] not in refused]
        try:
            done = call('mail/done', {'send': send, 'failed': failed, 'refused': refused})
        except (urllib.error.HTTPError, urllib.error.URLError):
            raise Stop(f'{label}: sent {len(sent)}, but the Worker did not take the report.')
        total += len(sent)
        print(f"{label}: sent {len(sent)}, {done.get('retry', 0)} to try again, {done.get('removed', 0)} refused and taken off the list.")
        if failed:
            if not sent:
                raise Stop(f'{label}: the mail services stopped; the rest wait for the next run.')
            break  # the senders stopped; the rest wait for the next run
    return total


def main():
    gmail = bool(GMAIL_USER and GMAIL_PASSWORD)
    missing = [n for n, v in [('FLG_CLOUD_URL', API), ('FLG_ADMIN_TOKEN', TOKEN), ('RESEND_API_KEY or GMAIL_USER + GMAIL_APP_PASSWORD', RESEND_KEY or gmail)] if not v]
    if missing:
        print('Puzzle emails are not set up yet (missing ' + ', '.join(missing) + '). See server/PUZZLE-EMAILS.md.')
        return
    try:
        due = call('mail/due', {})
    except urllib.error.HTTPError as e:
        print(f'::error::The Worker refused (HTTP {e.code}). Check that FLG_ADMIN_TOKEN matches the Worker ADMIN_TOKEN.')
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f'::error::The Worker did not answer: {e.reason}')
        sys.exit(1)
    if due.get('off'):
        print('Puzzle emails are switched off in the admin dashboard.')
        return
    senders = Senders()
    support = due.get('support') or ''
    try:
        if due.get('confirms'):
            run(senders, 'confirm', confirm_email, 'Confirm emails')
        week = due.get('weekly')
        if week:
            w = site_json('weekly/latest.json')
            if not w or w.get('week') != week:
                print(f'The puzzle of the week for {week} is not on the site yet; it goes out once the site is rebuilt.')
            else:
                run(senders, f'weekly-{week}', weekly_builder(w, support), f'Puzzle of the week {week}')
        for edition in due.get('specials') or []:
            s = site_json(f"specials/{edition['id']}.json")
            if not s or not s.get('puzzle'):
                print(f"Special edition {edition['date']} is not on the site yet; it goes out once the site is rebuilt.")
                continue
            run(senders, f"special-{edition['id']}", special_builder(edition, s, support), f"Special edition {edition['date']}")
    except Stop as e:
        print(f'::error::{e}')
        sys.exit(1)
    print(f"Sent {senders.counts['Resend'] + senders.counts['Gmail']} (Resend {senders.counts['Resend']}, Gmail {senders.counts['Gmail']}).")


if __name__ == '__main__':
    main()
