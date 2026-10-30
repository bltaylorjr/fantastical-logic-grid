"""Educator puzzle packages, run by the GitHub Action
.github/workflows/educator-packages.yml every 5 minutes (and straight away when
the Worker starts it). The domain's DNS is not on Cloudflare, so the Worker
cannot send email itself (server/EDUCATORS.md).

1. Ask the Worker for the work waiting (POST /admin/v1/educators/claim):
   code emails for new requests, decline emails, answers to educators' ideas
   and problems, and approved packages.
2. Send the code, decline and answer emails.
3. Build each approved package with scripts/educator-package.mjs (the game's
   own puzzle engine, printed to PDF by Chromium) and email the PDFs to the
   educator's verified school address, with the private link to their ideas,
   problems and feedback section and the short survey.
4. Tell the Worker what went out (POST /admin/v1/educators/done).

Code emails go from noreply@thelogicgrid.com and the rest from support@thelogicgrid.com through Resend (free plan) when
RESEND_API_KEY is set and the domain is verified there, otherwise from the
game's Gmail. Replies go to MAIL_REPLY_TO. The repository is public, so its
Actions logs are too: this prints only counts and request references, never
an email address, name or code. Python standard library only.
"""
import base64
import html
import json
import os
import smtplib
import ssl
import subprocess
import sys
import tempfile
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
MAIL_FROM = os.environ.get('MAIL_FROM', '').strip() or 'support@thelogicgrid.com'
# Replies to player emails land here until support@ has its own inbox (MAIL_REPLY_TO overrides).
REPLY_TO = os.environ.get('MAIL_REPLY_TO', '').strip() or 'fantasticallogicgrid@gmail.com'
# One-way emails (nothing to answer) go from here, with no Reply-To.
MAIL_NOREPLY = os.environ.get('MAIL_NOREPLY', '').strip() or 'noreply@thelogicgrid.com'
SITE = (os.environ.get('FLG_SITE_URL', '').strip() or 'https://thelogicgrid.com').rstrip('/')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SENDER_NAME = 'The Fantastical Logic Grid'
CONTACT = 'support@thelogicgrid.com'
NO_REPLY = 'Questions? Just reply to this email.'
ONE_WAY = 'This is an automatic message from a no-reply address, so replies are not read. Questions? Write to support@thelogicgrid.com.'
SIGN_OFF = 'The Fantastical Logic Grid team\n' + SITE


def verify_mail(m):
    link = f'{SITE}/educators/?' + urllib.parse.urlencode({'ref': m['ref'], 'code': m['code']})
    return {
        'one_way': True,
        'subject': f'Your code: {m["code"]} (The Fantastical Logic Grid for educators)',
        'blocks': [
            f'Hello {m["name"]},',
            'Thank you for requesting a free printable puzzle package from The Fantastical Logic Grid. '
            'To confirm this is your school email address, enter this code on the Educators page:',
            ('code', m['code']),
            ('link', 'Or confirm with one click', link),
            'The code works for 2 days. Once you confirm, our team reviews your request, usually within a day or two, '
            'and then emails your puzzles to this address as PDF files ready to print.',
            'If you did not ask for this, you can ignore this email: nothing is sent without the code.',
            SIGN_OFF,
        ],
    }


def declined_mail(m):
    blocks = [
        f'Hello {m["name"]},',
        'Thank you for your interest in The Fantastical Logic Grid. We are sorry, but we could not approve your request for a puzzle package this time.',
    ]
    if (m.get('note') or '').strip():
        blocks.append(('quote', 'A note from our team', m['note']))
    blocks += [
        f'If you think this was a mistake, write to us at {CONTACT} with your school name and request number {m["ref"]}. '
        f'Our free printable worksheets are always open to everyone at {SITE}/printables/.',
        SIGN_OFF,
    ]
    return {'subject': 'About your puzzle package request', 'blocks': blocks}


def package_mail(b, manifest):
    n = manifest['puzzles']
    keys = b['request'].get('keys')
    files = ['puzzles.pdf: the cover page and the puzzles, ready to print']
    if keys == 'separate':
        files.append('answer-keys.pdf: the answers, to keep back')
    elif keys == 'after':
        files[0] = 'puzzles.pdf: the cover page and the puzzles, each followed by its answer key'
    return {
        'subject': f'Your puzzle package is ready: {manifest["title"]}',
        'blocks': [
            f'Hello {b["name"]},',
            f'Your free puzzle package from The Fantastical Logic Grid is attached: {n} logic grid {"puzzle" if n == 1 else "puzzles"}, '
            'each with its own new story and exactly one answer.',
            ('list', files),
            'Print them with any PDF reader. You may copy them for your own students; please do not sell them or post them online.',
            f'Your students can also play free in their browser at {SITE}, and you can ask for another package any time at {SITE}/educators/.',
            *([
                'Once you have tried them, we would love to hear how it went. This private link opens your own ideas, problems and '
                'feedback section and a 2-minute survey about how our tools can help you:',
                ('link', 'Share ideas and feedback', feedback_link(b['ref'], b['feedbackKey'])),
            ] if b.get('feedbackKey') else []),
            'Happy puzzling!',
            SIGN_OFF,
        ],
    }


def feedback_link(ref, key):
    return f'{SITE}/educators/feedback/?' + urllib.parse.urlencode({'ref': ref, 'key': key})


KIND_WORDS = {'idea': 'idea', 'problem': 'problem report', 'feedback': 'feedback'}


def reply_mail(m):
    return {
        'subject': 'We answered your note (The Fantastical Logic Grid for educators)',
        'blocks': [
            f'Hello {m["name"]},',
            f'Thank you for your {KIND_WORDS.get(m.get("kind"), "note")}. Our team has looked at it.',
            ('quote', 'You wrote', m['text']),
            ('quote', 'Our answer', m['note']),
            'You can see all your notes and our answers, and send more, with the link in the email that brought your puzzles.',
            SIGN_OFF,
        ],
    }


def html_version(mail):
    parts = []
    for b in mail['blocks']:
        if isinstance(b, str):
            parts.append(f'<p style="margin:0 0 14px">{html.escape(b).replace(chr(10), "<br>")}</p>')
        elif b[0] == 'code':
            parts.append(f'<p style="margin:0 0 16px;font-size:32px;letter-spacing:6px;font-weight:bold;font-family:Consolas,monospace">{html.escape(b[1])}</p>')
        elif b[0] == 'link':
            parts.append(f'<p style="margin:0 0 16px"><a href="{html.escape(b[2])}" style="display:inline-block;background:#5B3CC4;color:#fff;'
                         f'padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:bold">{html.escape(b[1])}</a></p>')
        elif b[0] == 'list':
            parts.append('<ul style="margin:0 0 14px">' + ''.join(f'<li>{html.escape(x)}</li>' for x in b[1]) + '</ul>')
        else:
            parts.append(f'<p style="margin:0 0 6px;font-weight:bold">{html.escape(b[1])}:</p>'
                         '<blockquote style="margin:0 0 16px;padding:10px 14px;border-left:4px solid #5B3CC4;background:#f3f0fb;'
                         f'border-radius:4px">{html.escape(b[2].strip())}</blockquote>')
    return ('<!doctype html><html><body style="margin:0;padding:24px;background:#f3f0fb;font-family:Arial,Helvetica,sans-serif;'
            'font-size:16px;line-height:1.5;color:#1f1a14"><div style="max-width:560px;margin:0 auto;background:#fff;'
            'border-radius:10px;padding:24px">' + ''.join(parts) +
            f'<p style="margin:20px 0 0;font-size:13px;color:#5c5246">{html.escape(ONE_WAY if mail.get("one_way") else NO_REPLY)}</p></div></body></html>')


def text_version(mail):
    out = []
    for b in mail['blocks']:
        if isinstance(b, str):
            out.append(b)
        elif b[0] == 'code':
            out.append('    ' + b[1])
        elif b[0] == 'link':
            out.append(f'{b[1]}: {b[2]}')
        elif b[0] == 'list':
            out.append('\n'.join('- ' + x for x in b[1]))
        else:
            out.append(b[1] + ':\n> ' + b[2].strip())
    return '\n\n'.join(out) + '\n\n--\n' + (ONE_WAY if mail.get('one_way') else NO_REPLY) + '\n'


def call(path, body):
    req = urllib.request.Request(f'{API}/admin/v1/{path}', method='POST', data=json.dumps(body).encode(),
                                 headers={'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json', 'User-Agent': 'flg-educator-packages'})
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.loads(res.read() or b'{}')


class Mailer:
    """Sends through Resend first (when set up), then Gmail. One Gmail connection per run."""

    def __init__(self):
        self.resend_ok = bool(RESEND_KEY)
        self.smtp = None
        self.via = {'Resend': 0, 'Gmail': 0}

    def send(self, to, mail, attachments=()):
        if self.resend_ok and self._resend(to, mail, attachments):
            self.via['Resend'] += 1
            return True
        if GMAIL_USER and GMAIL_PASSWORD and self._gmail(to, mail, attachments):
            self.via['Gmail'] += 1
            return True
        return False

    def _resend(self, to, mail, attachments):
        one_way = mail.get('one_way')
        payload = {'from': formataddr((SENDER_NAME, MAIL_NOREPLY if one_way else MAIL_FROM)), 'to': [to], 'subject': mail['subject'],
                   'text': text_version(mail), 'html': html_version(mail),
                   'headers': {'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All'}}
        if not one_way:
            payload['reply_to'] = REPLY_TO
        if attachments:
            payload['attachments'] = [{'filename': name, 'content': base64.b64encode(data).decode()} for name, data in attachments]
        req = urllib.request.Request('https://api.resend.com/emails', method='POST', data=json.dumps(payload).encode(),
                                     headers={'Authorization': f'Bearer {RESEND_KEY}', 'Content-Type': 'application/json', 'User-Agent': 'flg-educator-packages'})
        try:
            with urllib.request.urlopen(req, timeout=60):
                return True
        except urllib.error.HTTPError as e:
            reasons = {401: 'the key is wrong', 403: 'the domain is not verified yet', 429: 'the free daily limit is used up'}
            print(f'Resend stopped (HTTP {e.code}: {reasons.get(e.code, "an error")}); using Gmail.')
            self.resend_ok = False
        except urllib.error.URLError:
            print('Resend did not answer; using Gmail.')
            self.resend_ok = False
        return False

    def _gmail(self, to, mail, attachments):
        msg = EmailMessage()
        msg['From'] = formataddr((SENDER_NAME + (' (no-reply)' if mail.get('one_way') else ''), GMAIL_USER))
        msg['To'] = to
        if not mail.get('one_way'):
            msg['Reply-To'] = REPLY_TO
        msg['Subject'] = mail['subject']
        msg['Message-ID'] = make_msgid(domain='thelogicgrid.com')
        msg['Auto-Submitted'] = 'auto-generated'
        msg['X-Auto-Response-Suppress'] = 'All'
        msg.set_content(text_version(mail))
        msg.add_alternative(html_version(mail), subtype='html')
        for name, data in attachments:
            msg.add_attachment(data, maintype='application', subtype='pdf', filename=name)
        try:
            if self.smtp is None:
                self.smtp = smtplib.SMTP_SSL('smtp.gmail.com', 465, context=ssl.create_default_context(), timeout=120)
                self.smtp.login(GMAIL_USER, GMAIL_PASSWORD)
            self.smtp.send_message(msg)
            return True
        except smtplib.SMTPAuthenticationError:
            print('::error::Gmail refused the sign-in. Check GMAIL_USER and GMAIL_APP_PASSWORD.')
        except Exception as e:  # noqa: BLE001 - report and carry on; it is tried again later
            print(f'Gmail did not send ({type(e).__name__}).')
        self.close()
        return False

    def close(self):
        if self.smtp is not None:
            try:
                self.smtp.quit()
            except Exception:  # noqa: BLE001
                pass
            self.smtp = None


PRINTER_READY = False


def ensure_printer():
    """Installs the fonts and Chromium for printing the first time a package is built
    (most runs have nothing to build, so they skip this). Already there locally."""
    global PRINTER_READY
    if PRINTER_READY:
        return
    if os.environ.get('GITHUB_ACTIONS') == 'true':
        run = lambda *cmd: subprocess.run(list(cmd), check=True, timeout=600, cwd=ROOT, stdout=subprocess.DEVNULL)
        run('npm', 'ci', '--no-audit', '--no-fund', '--ignore-scripts')
        run('npm', 'install', '--no-save', '--no-audit', '--no-fund', 'playwright@1.63.0')
        run('npx', 'playwright', 'install', '--with-deps', 'chromium')
    PRINTER_READY = True


def build(b, used):
    """Builds one package. Returns (manifest, attachments) or raises."""
    ensure_printer()
    with tempfile.TemporaryDirectory() as tmp:
        out = os.path.join(tmp, 'out')
        job = {k: v for k, v in b.items() if k != 'feedbackKey'}
        subprocess.run(['node', os.path.join(ROOT, 'scripts', 'educator-package.mjs'), '-', out], input=json.dumps({**job, 'usedStories': used}).encode(),
                       check=True, timeout=900, cwd=ROOT)
        with open(os.path.join(out, 'manifest.json'), encoding='utf-8') as f:
            manifest = json.load(f)
        attachments = []
        for path in manifest['files']:
            with open(path, 'rb') as f:
                attachments.append((os.path.basename(path), f.read()))
        return manifest, attachments


def main():
    missing = [n for n, v in [('FLG_CLOUD_URL', API), ('FLG_ADMIN_TOKEN', TOKEN), ('RESEND_API_KEY or GMAIL_USER + GMAIL_APP_PASSWORD', RESEND_KEY or (GMAIL_USER and GMAIL_PASSWORD))] if not v]
    if missing:
        print('Educator packages are not set up yet (missing ' + ', '.join(missing) + '). See server/EDUCATORS.md.')
        return
    try:
        work = call('educators/claim', {'limit': 50})
    except urllib.error.HTTPError as e:
        print(f'::error::The Worker refused (HTTP {e.code}). Check that FLG_ADMIN_TOKEN matches the Worker ADMIN_TOKEN.')
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f'::error::The Worker did not answer: {e.reason}')
        sys.exit(1)
    mails, builds, replies = work.get('mails', []), work.get('builds', []), work.get('replies', [])
    if not mails and not builds and not replies:
        print('Nothing waiting.')
        return
    mailer = Mailer()
    report = {'mails': {'sent': [], 'failed': []}, 'replies': {'sent': [], 'failed': []}, 'builds': []}
    for m in mails:
        maker = {'verify': verify_mail, 'declined': declined_mail}.get(m.get('kind'))
        if not maker or not m.get('email') or (m['kind'] == 'verify' and not m.get('code')):
            report['mails']['sent'].append(m['id'])  # nothing to send; clear it
            continue
        ok = mailer.send(m['email'], maker(m))
        report['mails']['sent' if ok else 'failed'].append(m['id'])
    for m in replies:
        if not m.get('email') or not (m.get('note') or '').strip():
            report['replies']['sent'].append(m['id'])  # nothing to send; clear it
            continue
        report['replies']['sent' if mailer.send(m['email'], reply_mail(m)) else 'failed'].append(m['id'])
    used = list(work.get('usedStories', []))
    for b in builds:
        try:
            manifest, attachments = build(b, used)
        except Exception as e:  # noqa: BLE001 - reported to the Worker, tried again later
            print(f'Package {b["ref"]} could not be built ({type(e).__name__}).')
            report['builds'].append({'id': b['id'], 'ok': False, 'error': type(e).__name__})
            continue
        ok = mailer.send(b['email'], package_mail(b, manifest), attachments)
        if ok:
            used += manifest['storyIds']
            print(f'Package {b["ref"]}: {manifest["puzzles"]} puzzles sent.')
        else:
            print(f'Package {b["ref"]}: built, but the email did not go; tried again later.')
        report['builds'].append({'id': b['id'], 'ok': ok, 'puzzles': manifest['puzzles'], 'storyIds': manifest['storyIds'], **({} if ok else {'error': 'email'})})
    mailer.close()
    try:
        call('educators/done', report)
    except (urllib.error.HTTPError, urllib.error.URLError):
        print('::error::The Worker did not take the report; some emails may go again.')
        sys.exit(1)
    print(f'Sent {len(report["mails"]["sent"])} code or decline emails, {len(report["replies"]["sent"])} answers and {sum(1 for x in report["builds"] if x["ok"])} packages '
          f'(Resend {mailer.via["Resend"]}, Gmail {mailer.via["Gmail"]}); '
          f'{len(report["mails"]["failed"]) + len(report["replies"]["failed"]) + sum(1 for x in report["builds"] if not x["ok"])} will be tried again.')


if __name__ == '__main__':
    main()
