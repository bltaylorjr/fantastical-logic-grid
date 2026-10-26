"""Emails the owner a task list written in Markdown, from the game's Gmail
account. Run by .github/workflows/owner-email.yml:

- on a push to main, once for each file added or changed under
  docs/owner-tasks/ (README.md is skipped), so any pull request that adds a
  task file emails it when it merges;
- by hand (Run workflow) with a FILE path, or with a SUBJECT and BODY,
  optionally with ATTACH (a PDF under docs/reports/) and a "to" address.
  The address is read from the run's event file, not the environment, and
  masked, so it never shows in the public log.

The subject is the file's first "# " heading. The body goes out as plain text
(the Markdown itself) and as simple HTML. The repository is public, so the log
shows only the subject. Never put secrets in a task file.
Needs: GMAIL_USER, GMAIL_APP_PASSWORD; OWNER_TO (defaults to GMAIL_USER).
Python standard library only.
"""
import html
import json
import os
import re
import smtplib
import ssl
import sys
from email.message import EmailMessage

GMAIL_USER = os.environ.get('GMAIL_USER', '').strip()
GMAIL_PASSWORD = ''.join(os.environ.get('GMAIL_APP_PASSWORD', '').split())
TO = os.environ.get('OWNER_TO', '').strip() or GMAIL_USER
REPO = os.environ.get('GITHUB_REPOSITORY', 'bltaylorjr/fantastical-logic-grid')
ATTACH = os.environ.get('ATTACH', '').strip()


def input_to():
    """The optional "to" input, read from the event file so it is never
    printed with the step's environment."""
    try:
        with open(os.environ.get('GITHUB_EVENT_PATH', ''), encoding='utf-8') as f:
            to = ((json.load(f).get('inputs') or {}).get('to') or '').strip()
    except (OSError, ValueError):
        return ''
    if to:
        print(f'::add-mask::{to}')
        if not re.fullmatch(r'[^@\s,;<>]+@[^@\s,;<>]+\.[A-Za-z]{2,}', to):
            fail('The "to" input is not one email address.')
    return to


def fail(message):
    print(f'::error::{message}')
    sys.exit(1)


def inline(text):
    out = html.escape(text, quote=False)
    out = re.sub(r'`([^`]+)`', r'<code>\1</code>', out)
    out = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', out)
    out = re.sub(r'\[([^\]]+)\]\((https?://[^)\s]+)\)', r'<a href="\2">\1</a>', out)
    out = re.sub(r'(?<!href=")(?<!">)(https?://[^\s<)]+[^\s<).,;:])', r'<a href="\1">\1</a>', out)
    return out


def to_html(markdown):
    """Headings, paragraphs, numbered and bulleted lists (nested by indent),
    bold, code and links: all a task list needs."""
    parts, stack, para = [], [], []

    def close_para():
        if para:
            parts.append('<p>' + inline(' '.join(para)) + '</p>')
            para.clear()

    def close_lists(depth=0):
        while len(stack) > depth:
            parts.append(f'</li></{stack.pop()[0]}>')

    for raw in markdown.splitlines():
        line = raw.rstrip()
        item = re.match(r'^(\s*)(\d+[.)]|[-*])\s+(.*)$', line)
        heading = re.match(r'^(#{1,4})\s+(.*)$', line)
        if not line.strip():
            close_para()
            continue
        if heading:
            close_para()
            close_lists()
            level = len(heading.group(1))
            parts.append(f'<h{level}>{inline(heading.group(2))}</h{level}>')
        elif item:
            close_para()
            indent = len(item.group(1).expandtabs(4))
            tag = 'ol' if item.group(2)[0].isdigit() else 'ul'
            while stack and indent < stack[-1][1]:
                parts.append(f'</li></{stack.pop()[0]}>')
            if stack and indent == stack[-1][1]:
                if stack[-1][0] != tag:
                    parts.append(f'</li></{stack.pop()[0]}><{tag}><li>')
                    stack.append((tag, indent))
                else:
                    parts.append('</li><li>')
            else:
                parts.append(f'<{tag}><li>')
                stack.append((tag, indent))
            parts.append(inline(item.group(3)))
        elif stack and raw.startswith(' '):
            parts.append(' ' + inline(line.strip()))
        else:
            close_lists()
            para.append(line.strip())
    close_para()
    close_lists()
    style = ('body{font-family:Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1d1b29;max-width:760px}'
             'h1{font-size:22px}h2{font-size:18px;margin-top:28px;border-bottom:1px solid #ddd;padding-bottom:4px}'
             'h3{font-size:16px}code{background:#f1eff7;padding:1px 4px;border-radius:3px}li{margin:3px 0}')
    return f'<!doctype html><html><head><meta charset="utf-8"><style>{style}</style></head><body>{"".join(parts)}</body></html>'


def send(subject, markdown, source='', attach=''):
    msg = EmailMessage()
    msg['From'] = f'The Fantastical Logic Grid <{GMAIL_USER}>'
    msg['To'] = TO
    msg['Subject'] = subject
    footer = (f'\n\n---\nSent automatically from {source} in https://github.com/{REPO}' if source else
              f'\n\n---\nSent automatically from https://github.com/{REPO}')
    msg.set_content(markdown + footer)
    msg.add_alternative(to_html(markdown + footer), subtype='html')
    if attach:
        with open(attach, 'rb') as f:
            msg.add_attachment(f.read(), maintype='application', subtype='pdf', filename=os.path.basename(attach))
    try:
        with smtplib.SMTP_SSL('smtp.gmail.com', 465, context=ssl.create_default_context(), timeout=120) as smtp:
            smtp.login(GMAIL_USER, GMAIL_PASSWORD)
            smtp.send_message(msg)
    except smtplib.SMTPAuthenticationError:
        fail('Gmail refused the sign-in. Check the GMAIL_USER and GMAIL_APP_PASSWORD secrets (server/ARCHIVE.md).')
    except Exception as e:  # noqa: BLE001
        fail(f'The email was not sent ({type(e).__name__}).')
    print(f'Sent: {subject}')


def from_file(path):
    with open(path, encoding='utf-8') as f:
        markdown = f.read().strip()
    first = re.search(r'^#\s+(.+)$', markdown, re.M)
    subject = first.group(1).strip() if first else os.path.splitext(os.path.basename(path))[0].replace('-', ' ')
    return 'To do: ' + subject, markdown


def main():
    global TO
    TO = input_to() or TO
    if not GMAIL_USER or not GMAIL_PASSWORD:
        fail('Missing the GMAIL_USER or GMAIL_APP_PASSWORD secret. See server/ARCHIVE.md.')
    files = [p for p in os.environ.get('FILES', '').split() if p]
    subject = os.environ.get('SUBJECT', '').strip()
    body = os.environ.get('BODY', '').strip()
    if not files and not body:
        print('Nothing to send.')
        return
    for path in files:
        if not re.fullmatch(r'docs/owner-tasks/[\w.-]+\.md', path) or os.path.basename(path) == 'README.md':
            print(f'Skipped {path}')
            continue
        if not os.path.isfile(path):
            fail(f'{path} is not in the repository.')
        send(*from_file(path), source=path)
    if ATTACH and (not re.fullmatch(r'docs/reports/[\w.-]+\.pdf', ATTACH) or not os.path.isfile(ATTACH)):
        fail(f'{ATTACH} is not a PDF in docs/reports/.')
    if body:
        send(subject or 'To do: a task for you', body.replace('\\n', '\n'), attach=ATTACH)


if __name__ == '__main__':
    main()
