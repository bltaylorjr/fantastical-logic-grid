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
   An approved storyline's email ("Congratulations") first has its puzzle
   built from the player's storyline (scripts/storyline-puzzle.mjs), stored in
   their game (POST /admin/v1/replies/puzzle), then attached as a PDF with its
   answer key (scripts/contributor-puzzle.mjs, printed by Chromium through
   Playwright, installed only when one is waiting). A disapproved storyline's
   email thanks the player for their input.
3. Tell the Worker which went out (POST /admin/v1/replies/done), which
   removes their email addresses.

The repository is public, so its Actions logs are too: this prints only
counts, never an email address. Needs FLG_CLOUD_URL, FLG_ADMIN_TOKEN and at
least one of RESEND_API_KEY or GMAIL_USER + GMAIL_APP_PASSWORD; MAIL_FROM is
optional. Without them it says so and stops (not an error).
Python standard library only.
"""
import base64
import html
import json
import os
import re
import smtplib
import subprocess
import tempfile
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
# Sent from MAIL_NOREPLY; everything else from MAIL_FROM (support@). A
# storyline submission's confirmation, approval and decline thank-you are one-way.
ONE_WAY_KINDS = {'message', 'story_received', 'story_approved', 'submission_approved', 'story_declined', 'story_puzzle'}
STORY_ONE_WAY = ('This is an automatic message from a no-reply address, so replies are not read. '
                 f'Questions? Email {MAIL_FROM}.')
TEAM_COPY = 'Sent by The Fantastical Logic Grid team. Questions? Just reply to this email.'
KIND_WORDS = {'storyline': 'storyline', 'theme': 'theme idea', 'category': 'category idea', 'puzzle': 'puzzle'}


def footer(r):
    if r['kind'] == 'message':
        return ONE_WAY
    if r['kind'] in ONE_WAY_KINDS:
        return STORY_ONE_WAY
    if r['kind'] == 'submission_copy':
        return TEAM_COPY
    return NO_REPLY


def entry_words(r):
    """'storyline', 'theme idea' or 'category idea', for the email about an entry."""
    return KIND_WORDS.get((r.get('submission') or {}).get('kind'), 'storyline')


def entry_form(r):
    """The copy of the completed form, as a block, or nothing."""
    copy = (r.get('submission') or {}).get('copy')
    return ('form', 'Your completed form', copy) if copy else ''


def subject(r):
    s = NOTES[r['kind']]['subject']
    return s(r) if callable(s) else s

SIGN_OFF = 'The Fantastical Logic Grid team\n' + GAME_URL

# Each email is a list of blocks: plain paragraphs, ('link', words, url) for a
# button (the URL comes from the Worker and always points at the game's own
# site), and ('quote', label, text)
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
    'problem_repaired': {
        'subject': 'We fixed the puzzle you reported',
        'blocks': lambda r: [
            'Hello, puzzler!',
            'We are sorry for the trouble with that puzzle, and thank you for telling us about it. '
            'We looked into your report and fixed the problem.',
            ('quote', 'What you reported', r.get('text')),
            ('quote', 'What we found', r.get('explain')),
            ('quote', 'What we did', r.get('note')),
            ('link', 'Add the repaired puzzle to my saved puzzles', r.get('link')),
            'The button opens the game and puts the repaired puzzle in your Saved puzzles, ready to play again. '
            'It works on any device for 30 days.',
            'Thank you for helping us make the game better for every player.',
            SIGN_OFF,
        ],
    },
    'story_received': {
        'subject': lambda r: f'We received your {entry_words(r)}',
        'blocks': lambda r: [
            'Hello, author!',
            f'Thank you for sending your {entry_words(r)} to The Logic Grid. It has been saved, '
            'and the team reads every entry.',
            ('We will email you if it is approved. An approved storyline comes back to you as a finished logic puzzle '
             '(a PDF with its answer key), and it waits in your game\'s Saved puzzles too when you are signed in.')
            if entry_words(r) == 'storyline' else ('Your puzzle is already in your Saved puzzles on the device you made it on. '
            'We will email you if the team publishes it in the game.') if entry_words(r) == 'puzzle' else 'We will email you if it is approved.',
            'Here is a copy of what you sent:',
            entry_form(r),
            'Thank you for contributing!',
            SIGN_OFF,
        ],
    },
    'submission_approved': {
        'subject': lambda r: f'Congratulations! Your {entry_words(r)} has been approved',
        'blocks': lambda r: [
            'Hello, author!',
            f'Congratulations! Your {entry_words(r)} has been approved, and the team will use it in new puzzles for '
            'The Fantastical Logic Grid.',
            entry_form(r),
            'Thank you for contributing to the game!',
            SIGN_OFF,
        ],
    },
    'submission_copy': {
        'subject': lambda r: f'A {entry_words(r)} sent to The Fantastical Logic Grid' + (f': {r["submission"]["title"]}' if (r.get('submission') or {}).get('title') else ''),
        'blocks': lambda r: [
            'Hello,',
            f'Here is a copy of a {entry_words(r)} sent to The Fantastical Logic Grid, as it was submitted.',
            ('form', 'The submission', (r.get('submission') or {}).get('copy')),
            'The first puzzle built from it is attached as a PDF, with its answer key on the last page.' if r.get('_files') else '',
            SIGN_OFF,
        ],
    },
    'story_puzzle': {
        'subject': 'Your storyline puzzle is ready',
        'blocks': lambda r: [
            'Hello, puzzler!',
            'Good news: the first puzzle built from your approved storyline is ready.',
            ('quote', 'Your storyline', (r.get('submission') or {}).get('title')),
            'It is attached as a PDF, with its answer key on the last page, so you can print it and solve it on paper.' if r.get('_files') else '',
            ('The same puzzle is waiting in your game, ready to play: sign in with this email address and open Saved puzzles. '
             'It is also in Menu > Messages > Puzzles for you for 30 days.') if r.get('stored') else '',
            'Thank you for contributing to the game\'s stories!',
            SIGN_OFF,
        ],
    },
    'story_approved': {
        'subject': 'Congratulations! Your storyline has been approved',
        'blocks': lambda r: [
            'Hello, puzzler!',
            'Congratulations! Your storyline has been approved. Thank you for sending it to The Fantastical Logic Grid: '
            'the team enjoyed it and it is now part of the game.',
            ('quote', 'Your storyline', r.get('text') or (r.get('submission') or {}).get('title')),
            ('We built the first puzzle from your storyline. It is attached as a PDF, with its answer key on the last page, '
             'so you can print it and solve it on paper.') if r.get('_files') else '',
            ('The same puzzle is waiting in your game, ready to play: sign in with this email address and open Saved puzzles. '
             'It is also in Menu > Messages > Puzzles for you for 30 days.') if r.get('stored') else '',
            '' if r.get('_files') or r.get('stored') else 'The team will use it in new puzzles. Open the game to find it.',
            'Thank you for contributing to the game\'s stories!',
            SIGN_OFF,
        ],
    },
    'story_declined': {
        'subject': 'Thank you for your storyline',
        'blocks': lambda r: [
            'Hello, puzzler!',
            'Thank you for taking the time to send us a storyline for The Fantastical Logic Grid. '
            'We read every one, and we truly appreciate your input.',
            ('quote', 'Your storyline', r.get('text')),
            ('quote', 'Your entry', (r.get('submission') or {}).get('title')) if not r.get('text') else '',
            'This one will not be made into a puzzle, but please keep the ideas coming: '
            'every storyline helps us shape the stories in the game.',
            'Thank you for contributing!',
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


def has_words(b):
    if b[0] == 'form':
        return isinstance(b[2], list) and len(b[2]) > 0
    return bool(str(b[2] or '').strip()) and (b[0] != 'link' or str(b[2]).startswith('https://'))


def blocks(r):
    """The email's blocks, without quotes that have no words."""
    return [b for b in NOTES[r['kind']]['blocks'](r) if (isinstance(b, str) and b) or (not isinstance(b, str) and has_words(b))]


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
        elif b[0] == 'form':
            rows = ''.join(f'<tr><th style="text-align:left;vertical-align:top;padding:6px 10px 6px 0;width:38%;color:#5c5246;font-weight:bold">{html.escape(str(k))}</th>'
                           f'<td style="padding:6px 0;vertical-align:top">{html.escape(str(v)).replace(chr(10), "<br>")}</td></tr>' for k, v in b[2])
            parts.append(f'<p style="margin:0 0 6px;font-weight:bold">{html.escape(b[1])}:</p>'
                         '<table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 16px;padding:10px 14px;'
                         f'background:#f6f1e7;border-radius:4px;font-size:15px">{rows}</table>')
        elif b[0] == 'link':
            parts.append(f'<p style="margin:6px 0 18px"><a href="{html.escape(b[2], quote=True)}" style="display:inline-block;'
                         'background:#5B3CC4;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:8px">'
                         f'{html.escape(b[1])}</a></p>')
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
        elif b[0] == 'form':
            out.append(b[1] + ':\n' + '\n'.join(f'{k}: {v}' for k, v in b[2]))
        elif b[0] == 'link':
            out.append(b[1] + ':\n' + b[2])
        else:
            out.append(b[1] + ':\n' + '\n'.join('> ' + line for line in b[2].strip().split('\n')))
    return '\n\n'.join(out) + '\n\n--\n' + footer(r) + '\n'


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRINTER_READY = False


def ensure_printer():
    """Installs the fonts and Chromium the first time a PDF is needed (most runs
    have none, so they skip this). Already there locally."""
    global PRINTER_READY
    if PRINTER_READY:
        return
    if os.environ.get('GITHUB_ACTIONS') == 'true':
        run = lambda *cmd: subprocess.run(list(cmd), check=True, timeout=600, cwd=ROOT, stdout=subprocess.DEVNULL)
        run('npm', 'ci', '--no-audit', '--no-fund', '--ignore-scripts')
        run('npm', 'install', '--no-save', '--no-audit', '--no-fund', 'playwright@1.63.0')
        run('npx', 'playwright', 'install', '--with-deps', 'chromium')
    PRINTER_READY = True


def build_puzzle(r):
    """An approved storyline that has no puzzle yet: build the first puzzle from
    the player's words with the game's engine (scripts/storyline-puzzle.mjs),
    store it for the player (POST /admin/v1/replies/puzzle) and keep it for the
    PDF. If the storyline has no lists the game can read, or anything fails,
    the email still goes, without a puzzle."""
    if r.get('kind') not in ('story_approved', 'story_build', 'story_puzzle'):
        return
    if isinstance(r.get('puzzle'), dict):
        if r.get('storeSaved'):
            # Saved in the database earlier; put it in the player's game too.
            try:
                r['stored'] = bool(call('replies/puzzle', {'id': r['id'], 'puzzle': r['puzzle']}).get('stored'))
            except (urllib.error.HTTPError, urllib.error.URLError):
                r['stored'] = False
        else:
            r['stored'] = r.get('kind') in ('story_approved', 'story_puzzle') and 'puzzleExpiresAt' in r  # built and stored on an earlier try
        return
    build = r.get('build')
    sub = r.get('submission') or {}
    text = r.get('text') or (sub.get('form') or {}).get('idea')
    if not isinstance(build, dict) or not (build.get('submission') or text):
        return
    try:
        with tempfile.TemporaryDirectory() as tmp:
            src, out = os.path.join(tmp, 'storyline.json'), os.path.join(tmp, 'puzzle.json')
            with open(src, 'w', encoding='utf-8') as f:
                if build.get('submission'):
                    json.dump({'submission': {'form': sub.get('form'), 'polished': sub.get('polished')}, 'theme': build.get('theme') or '', 'seed': f'story-{r["id"]}'}, f)
                else:
                    json.dump({'text': text, 'theme': build.get('theme') or '', 'seed': f'story-{r["id"]}'}, f)
            done = subprocess.run(['node', os.path.join(ROOT, 'scripts', 'storyline-puzzle.mjs'), src, out], timeout=300, cwd=ROOT,
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if done.returncode != 0:
                print('A storyline had no lists the game could read; that email goes without a puzzle.')
                return
            with open(out, encoding='utf-8') as f:
                puzzle = json.load(f)
        r['puzzle'] = puzzle
        r['stored'] = bool(call('replies/puzzle', {'id': r['id'], 'puzzle': puzzle}).get('stored'))
    except urllib.error.HTTPError as e:
        print(f'A storyline puzzle could not be stored in the game (HTTP {e.code}); the email still has the PDF.')
    except Exception as e:  # noqa: BLE001 - send without the puzzle rather than not at all
        print(f'A storyline puzzle could not be built ({type(e).__name__}); that email goes without it.')
        r['puzzle'] = None


def attachments(r):
    """The PDF for an approved storyline (puzzle and answer key), or none. If it
    cannot be built, the email still goes; the puzzle is in the game anyway."""
    if r.get('kind') not in ('story_approved', 'story_puzzle', 'submission_copy') or not isinstance(r.get('puzzle'), dict):
        return []
    try:
        ensure_printer()
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, 'puzzle.json')
            with open(src, 'w', encoding='utf-8') as f:
                json.dump(r['puzzle'], f)
            name = (re.sub(r'[^A-Za-z0-9]+', '-', str(r['puzzle'].get('title') or 'puzzle')).strip('-')[:60] or 'puzzle') + '.pdf'
            out = os.path.join(tmp, name)
            subprocess.run(['node', os.path.join(ROOT, 'scripts', 'contributor-puzzle.mjs'), src, out], check=True, timeout=300, cwd=ROOT,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            with open(out, 'rb') as f:
                return [(name, f.read())]
    except Exception as e:  # noqa: BLE001 - send without the PDF rather than not at all
        print(f'A storyline PDF could not be built ({type(e).__name__}); that email goes without it.')
        r['puzzle'] = None
        return []


def message(r):
    msg = EmailMessage()
    one_way = r['kind'] in ONE_WAY_KINDS
    msg['From'] = formataddr((SENDER_NAME + (' (no-reply)' if one_way else ''), GMAIL_USER))
    msg['To'] = r['email']
    if not one_way:
        msg['Reply-To'] = REPLY_TO
    msg['Subject'] = subject(r)
    msg['Message-ID'] = make_msgid(domain='thelogicgrid.com')
    # An automatic message: mail programs should not send out-of-office answers to it.
    msg['Auto-Submitted'] = 'auto-replied'
    msg['X-Auto-Response-Suppress'] = 'All'
    msg.set_content(text_version(r))
    msg.add_alternative(html_version(r), subtype='html')
    for name, data in r.get('_files', []):
        msg.add_attachment(data, maintype='application', subtype='pdf', filename=name)
    return msg


def send_resend(replies):
    """Sends through Resend from MAIL_FROM. Returns (sent ids, refused ids);
    anything in neither list is left for Gmail."""
    sent, refused = [], []
    for r in replies:
        one_way = r['kind'] in ONE_WAY_KINDS
        payload = {'from': formataddr((SENDER_NAME, MAIL_NOREPLY if one_way else MAIL_FROM)), 'to': [r['email']], 'subject': subject(r),
                   'text': text_version(r), 'html': html_version(r),
                   'headers': {'Auto-Submitted': 'auto-replied', 'X-Auto-Response-Suppress': 'All'}}
        if not one_way:
            payload['reply_to'] = REPLY_TO
        if r.get('_files'):
            payload['attachments'] = [{'filename': name, 'content': base64.b64encode(data).decode()} for name, data in r['_files']]
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
    # An approved storyline with no address to write to: only its puzzle is
    # built and saved with the entry (Storyline submissions in the dashboard).
    builds = [r for r in claim.get('replies', []) if r.get('kind') == 'story_build']
    for r in builds:
        build_puzzle(r)
    if builds:
        try:
            call('replies/done', {'sent': [r['id'] for r in builds], 'failed': []})
        except (urllib.error.HTTPError, urllib.error.URLError):
            print('Built storyline puzzles, but the Worker did not take the report.')
        print(f'Built {len(builds)} storyline {"puzzle" if len(builds) == 1 else "puzzles"} for the database.')
    replies = [r for r in claim.get('replies', []) if r.get('kind') in NOTES and r.get('email')]
    if not replies:
        print('No thank-you emails waiting.')
        return

    for r in replies:
        build_puzzle(r)
        r['_files'] = attachments(r)

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
