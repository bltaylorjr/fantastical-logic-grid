"""The owner's learning emails, sent from the game's Gmail account by
.github/workflows/learning-digest.yml:

- MODE=daily: the to-do list. Open issues labeled "learning" (smallest first,
  with today's pick on top), pull requests waiting for review, and learning
  tasks finished in the last day.
- MODE=done: sent when a "learning" issue is closed as completed. The task's
  build sheet (docs/learning/build-sheets/<issue number>-*.md): a wireframe of
  what it should look like, the code line by line, and a link to the
  reference sheet.

Build sheets are Markdown with images and tables; this file turns them into
simple HTML email. Pictures from the repository are attached inside the email,
so they keep working when the repository is private.
Set DRY_RUN=1 to write the email to learning-email.html instead of sending.
Needs: GITHUB_TOKEN; GMAIL_USER and GMAIL_APP_PASSWORD (not for a dry run);
OWNER_TO (optional, defaults to GMAIL_USER). Python standard library only.
"""
import glob
import html
import json
import os
import re
import smtplib
import ssl
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage

REPO = os.environ.get('GITHUB_REPOSITORY', 'bltaylorjr/fantastical-logic-grid')
TOKEN = os.environ.get('GITHUB_TOKEN', '').strip()
GMAIL_USER = os.environ.get('GMAIL_USER', '').strip()
GMAIL_PASSWORD = ''.join(os.environ.get('GMAIL_APP_PASSWORD', '').split())
TO = os.environ.get('OWNER_TO', '').strip() or GMAIL_USER
DRY_RUN = os.environ.get('DRY_RUN') == '1'
RAW = f'https://raw.githubusercontent.com/{REPO}/main/'
BLOB = f'https://github.com/{REPO}/blob/main/'
SHEETS = 'docs/learning/build-sheets'


def fail(message):
    print(f'::error::{message}')
    sys.exit(1)


def api(path):
    req = urllib.request.Request(f'https://api.github.com/repos/{REPO}/{path}', headers={
        'Accept': 'application/vnd.github+json', 'Authorization': f'Bearer {TOKEN}', 'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'fantastical-logic-grid-learning-digest'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


# ---------- Markdown to email HTML ----------
def absolute(url, base_dir):
    """Relative links in a build sheet point into the repository: images
    load from raw.githubusercontent.com, pages open on github.com."""
    if re.match(r'https?://', url) or url.startswith('#'):
        return url
    path = os.path.normpath(os.path.join(base_dir, url)).replace(os.sep, '/')
    return (RAW if re.search(r'\.(png|jpe?g|gif)$', path, re.I) else BLOB) + path


def inline(text, base_dir='.'):
    codes = []
    text = re.sub(r'`([^`]+)`', lambda m: codes.append(m.group(1)) or f'\x00{len(codes) - 1}\x00', text)
    out = html.escape(text, quote=False)
    out = re.sub(r'!\[([^\]]*)\]\(([^)\s]+)\)', lambda m: f'<img src="{html.escape(absolute(m.group(2), base_dir))}" alt="{m.group(1)}" '
                 'style="max-width:100%;height:auto;border:1px solid #d6dbe4;border-radius:8px;margin:8px 0">', out)
    out = re.sub(r'\[([^\]]+)\]\(([^)\s]+)\)', lambda m: f'<a href="{html.escape(absolute(m.group(2), base_dir))}">{m.group(1)}</a>', out)
    out = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', out)
    out = re.sub(r'(?<![\w*])\*([^*\n]+)\*(?![\w*])', r'<em>\1</em>', out)
    return re.sub(r'\x00(\d+)\x00', lambda m: f'<code>{html.escape(codes[int(m.group(1))], quote=False)}</code>', out)


def to_html(markdown, base_dir='.'):
    lines = markdown.splitlines()
    parts, para, i = [], [], 0
    def flush():
        if para:
            parts.append(f'<p>{inline(" ".join(para), base_dir)}</p>')
            para.clear()
    while i < len(lines):
        line = lines[i].rstrip()
        if line.startswith('```'):
            flush()
            body = []
            i += 1
            while i < len(lines) and not lines[i].startswith('```'):
                body.append(lines[i])
                i += 1
            parts.append(f'<pre>{html.escape(chr(10).join(body), quote=False)}</pre>')
        elif line.startswith('|') and i + 1 < len(lines) and re.match(r'^\|[\s:|-]+\|$', lines[i + 1].strip()):
            flush()
            cells = lambda l: [c.strip() for c in l.strip().strip('|').split('|')]
            rows = [f'<tr>{"".join(f"<th>{inline(c, base_dir)}</th>" for c in cells(line))}</tr>']
            i += 2
            while i < len(lines) and lines[i].startswith('|'):
                rows.append(f'<tr>{"".join(f"<td>{inline(c, base_dir)}</td>" for c in cells(lines[i]))}</tr>')
                i += 1
            parts.append(f'<table>{"".join(rows)}</table>')
            continue
        elif m := re.match(r'^(#{1,4})\s+(.*)$', line):
            flush()
            parts.append(f'<h{len(m.group(1))}>{inline(m.group(2), base_dir)}</h{len(m.group(1))}>')
        elif re.match(r'^\s*([-*]|\d+\.)\s+', line):
            flush()
            tag = 'ol' if re.match(r'^\s*\d', line) else 'ul'
            items = []
            while i < len(lines) and re.match(r'^\s*([-*]|\d+\.)\s+', lines[i]):
                text = re.sub(r'^\s*([-*]|\d+\.)\s+', '', lines[i])
                box = text.startswith('[ ] ')
                items.append(f'<li>{"&#9744; " if box else ""}{inline(text[4:] if box else text, base_dir)}</li>')
                i += 1
            parts.append(f'<{tag}>{"".join(items)}</{tag}>')
            continue
        elif not line.strip():
            flush()
        else:
            para.append(line.strip())
        i += 1
    flush()
    style = ('body{font-family:Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1f2a44;max-width:760px;margin:0 auto}'
             'h1{font-size:22px;color:#7a3e9d}h2{font-size:18px;margin-top:26px;border-bottom:1px solid #e1e5ec;padding-bottom:4px}'
             'h3{font-size:16px}code{background:#f1eff7;padding:1px 4px;border-radius:3px;font-size:13px}'
             'pre{background:#f4f6fa;border:1px solid #e1e5ec;border-radius:8px;padding:10px 12px;font-size:13px;overflow-x:auto;white-space:pre-wrap}'
             'table{border-collapse:collapse;margin:8px 0;width:100%}th,td{border:1px solid #d6dbe4;padding:6px 8px;text-align:left;vertical-align:top;font-size:14px}'
             'th{background:#eef1f7}li{margin:3px 0}a{color:#5b3cc4}')
    return f'<!doctype html><html><head><meta charset="utf-8"><style>{style}</style></head><body>{"".join(parts)}</body></html>'


def send(subject, markdown, base_dir='.'):
    footer = f'\n\n---\nSent automatically from https://github.com/{REPO} (learning emails: docs/learning/README.md)'
    body_html = to_html(markdown + footer, base_dir)
    if DRY_RUN:
        with open('learning-email.html', 'w', encoding='utf-8') as f:
            f.write(body_html)
        print(f'Dry run: {subject} (written to learning-email.html)')
        return
    if not GMAIL_USER or not GMAIL_PASSWORD:
        fail('Missing the GMAIL_USER or GMAIL_APP_PASSWORD secret. See server/ARCHIVE.md.')
    msg = EmailMessage()
    msg['From'] = f'The Fantastical Logic Grid <{GMAIL_USER}>'
    msg['To'] = TO
    msg['Subject'] = subject
    # Pictures from the repository travel inside the email (cid: links), so
    # they still show once the repository is private.
    images = []
    def embed(m):
        local = m.group(1)[len(RAW):]
        if not os.path.isfile(local):
            return m.group(0)
        images.append(local)
        return f'src="cid:pic{len(images) - 1}@flg"'
    body_html = re.sub(r'src="(' + re.escape(RAW) + r'[^"]+)"', embed, body_html)
    msg.set_content(markdown + footer)
    msg.add_alternative(body_html, subtype='html')
    html_part = msg.get_body(('html',))
    for i, path in enumerate(images):
        with open(path, 'rb') as f:
            kind = 'jpeg' if path.lower().endswith(('.jpg', '.jpeg')) else 'png'
            html_part.add_related(f.read(), 'image', kind, cid=f'<pic{i}@flg>', filename=os.path.basename(path))
    try:
        with smtplib.SMTP_SSL('smtp.gmail.com', 465, context=ssl.create_default_context(), timeout=120) as smtp:
            smtp.login(GMAIL_USER, GMAIL_PASSWORD)
            smtp.send_message(msg)
    except smtplib.SMTPAuthenticationError:
        fail('Gmail refused the sign-in. Check the GMAIL_USER and GMAIL_APP_PASSWORD secrets (server/ARCHIVE.md).')
    except Exception as e:  # noqa: BLE001
        fail(f'The email was not sent ({type(e).__name__}).')
    print(f'Sent: {subject}')


# ---------- the emails ----------
def minutes(issue):
    m = re.search(r'about (\d+) minutes', issue.get('body') or '')
    return int(m.group(1)) if m else None


def level(issue):
    m = re.search(r'\*\*(Level \d+[^*]*)\*\*', issue.get('body') or '')
    return m.group(1).split(' · ')[0] if m else ''


def sheet_for(number):
    found = sorted(glob.glob(f'{SHEETS}/{number}-*.md'))
    return found[0] if found else None


def age(p, now):
    """' · waiting 5 days' for a pull request opened 3 or more days ago, else ''."""
    days = (now - datetime.fromisoformat(p['created_at'].replace('Z', '+00:00'))).days
    return f' · waiting {days} days' if days >= 3 else ''


def daily():
    now = datetime.now(timezone.utc)
    issues = [i for i in api('issues?labels=learning&state=all&per_page=100&sort=created&direction=asc') if 'pull_request' not in i]
    issues.sort(key=lambda i: i['number'])
    open_ = [i for i in issues if i['state'] == 'open']
    since = now - timedelta(hours=26)
    done = [i for i in issues if i['state'] == 'closed' and i.get('state_reason') == 'completed'
            and datetime.fromisoformat(i['closed_at'].replace('Z', '+00:00')) > since]
    pulls = [p for p in api('pulls?state=open&per_page=50') if not (p.get('user') or {}).get('login', '').startswith('dependabot')]
    prs = [p for p in pulls if not p.get('draft')]
    # Drafts are listed once a week (Mondays), so unfinished work is not forgotten.
    drafts = [p for p in pulls if p.get('draft')] if now.weekday() == 0 else []
    if not open_ and not done and not prs and not drafts:
        print('Nothing to send today.')
        return
    try:
        from zoneinfo import ZoneInfo
        local = now.astimezone(ZoneInfo('America/New_York'))
    except Exception:  # noqa: BLE001
        local = now
    md = [f'# Your to-do list for {local.strftime("%A, %B")} {local.day}', '']
    if open_:
        pick = open_[0]
        t = minutes(pick)
        md += ['## Today\'s pick', '',
               f'**[{pick["title"]}]({pick["html_url"]})**' + (f' · about {t} minutes' if t else '') + (f' · {level(pick)}' if level(pick) else ''), '']
        sheet = sheet_for(pick['number'])
        if sheet:
            md += [f'What it should look like, and the code explained: [build sheet]({sheet}).', '']
        md += ['Short on time? Comment `Claude, take over` on the issue.', '']
        if len(open_) > 1:
            md += ['## Also waiting (no rush)', '']
            md += [f'- [{i["title"]}]({i["html_url"]})' + (f' · about {minutes(i)} min' if minutes(i) else '') for i in open_[1:]]
            md += ['']
    if prs:
        md += ['## Waiting for your review', '', 'Read each one; merge it when you\'re happy. Nothing reaches players until you do.', '']
        md += [f'- [#{p["number"]} {p["title"]}]({p["html_url"]})' + age(p, now) for p in prs[:10]]
        md += ['']
    if drafts:
        md += ['## Drafts not finished yet (weekly reminder)', '',
               'Unfinished work. Finish or close each one, so it does not drift away from the game and clash with newer changes.', '']
        md += [f'- [#{p["number"]} {p["title"]}]({p["html_url"]})' + age(p, now) for p in drafts[:15]]
        md += ['']
    if done:
        md += ['## Finished since yesterday', '']
        for i in done:
            sheet = sheet_for(i['number'])
            md.append(f'- {i["title"]}' + (f': [build sheet]({sheet})' if sheet else ''))
        md += ['']
    total = sum(minutes(i) or 0 for i in open_)
    if open_:
        md += [f'{len(open_)} learning task{"s" if len(open_) != 1 else ""} open, about {total} minutes in all.']
    send(f'To do today: {open_[0]["title"]}' if open_ else 'To do today: reviews waiting', '\n'.join(md))


def done(number):
    issue = api(f'issues/{number}')
    if 'learning' not in [l['name'] for l in issue.get('labels', [])]:
        print('Not a learning task.')
        return
    if issue.get('state_reason') != 'completed':
        print('Closed without being completed; no build sheet sent.')
        return
    sheet = sheet_for(number)
    if not sheet:
        send(f'Done: {issue["title"]}', f'# Done: {issue["title"]}\n\nNice work! This task has no build sheet yet. '
             f'Ask Claude for one: "Write the build sheet for issue #{number}."\n\n[The issue]({issue["html_url"]})')
        return
    with open(sheet, encoding='utf-8') as f:
        markdown = f.read().strip()
    intro = f'Nice work finishing **{issue["title"]}**! Here is your build sheet: what you built, what it should look like, and the code explained.\n\n'
    send(f'Done: {issue["title"]} (your build sheet)', intro + markdown, base_dir=os.path.dirname(sheet))


def main():
    if not TOKEN:
        fail('Missing GITHUB_TOKEN.')
    mode = os.environ.get('MODE', 'daily')
    if mode == 'done':
        number = os.environ.get('ISSUE_NUMBER', '').strip()
        if not number.isdigit():
            fail('MODE=done needs ISSUE_NUMBER.')
        done(int(number))
    else:
        daily()


if __name__ == '__main__':
    main()
