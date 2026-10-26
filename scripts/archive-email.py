"""Weekly archive email, sent from the game's Gmail account by the GitHub
Action .github/workflows/archive-email.yml (the domain's DNS is not on
Cloudflare, so the Worker cannot send email itself).

1. Ask the Worker for this week's zip (POST /admin/v1/archive/export).
2. Email it through Gmail (smtp.gmail.com, an app password).
3. Tell the Worker it was sent (POST /admin/v1/archive/confirm). Only then,
   and only when both Backups switches are on, are the rows removed.

The repository is public, so its Actions logs are too: this prints only row
counts, never the data, and keeps the zip in memory (no files, no artifacts).
Needs: FLG_CLOUD_URL, FLG_ADMIN_TOKEN, GMAIL_USER, GMAIL_APP_PASSWORD,
ARCHIVE_TO; TEST=true sends even while the weekly switch is off.
Python standard library only.
"""
import json
import os
import smtplib
import ssl
import sys
import urllib.error
import urllib.request
from email.message import EmailMessage

API = os.environ.get('FLG_CLOUD_URL', '').strip().rstrip('/')
TOKEN = os.environ.get('FLG_ADMIN_TOKEN', '').strip()
GMAIL_USER = os.environ.get('GMAIL_USER', '').strip()
GMAIL_PASSWORD = ''.join(os.environ.get('GMAIL_APP_PASSWORD', '').split())
TO = os.environ.get('ARCHIVE_TO', '').strip()
TEST = os.environ.get('TEST', '').lower() == 'true'


def call(path, body=None):
    req = urllib.request.Request(f'{API}/admin/v1/{path}', method='POST', data=json.dumps(body or {}).encode(),
                                 headers={'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json', 'User-Agent': 'flg-archive-email'})
    return urllib.request.urlopen(req, timeout=120)


def fail(message):
    print(f'::error::{message}')
    sys.exit(1)


def main():
    missing = [n for n, v in [('FLG_CLOUD_URL (repository variable)', API), ('FLG_ADMIN_TOKEN', TOKEN), ('GMAIL_USER', GMAIL_USER),
                              ('GMAIL_APP_PASSWORD', GMAIL_PASSWORD), ('ARCHIVE_TO', TO)] if not v]
    if missing:
        fail('Missing: ' + ', '.join(missing) + '. See server/ARCHIVE.md.')

    try:
        res = call('archive/export' + ('?test=1' if TEST else ''))
    except urllib.error.HTTPError as e:
        if e.code == 409:
            print('The weekly archive email is switched off in the admin dashboard (Settings and switches > Backups). Nothing to do.')
            return
        fail(f'The Worker refused the export (HTTP {e.code}). Check FLG_ADMIN_TOKEN matches the Worker ADMIN_TOKEN.')
    except urllib.error.URLError as e:
        fail(f'The Worker did not answer: {e.reason}')
    zip_bytes = res.read()
    archive_id = res.headers['X-Archive-Id']
    total = int(res.headers.get('X-Archive-Total') or 0)
    rows = json.loads(res.headers.get('X-Archive-Rows') or '{}')
    name = (res.headers.get('Content-Disposition') or '').split('filename="')[-1].rstrip('"') or 'flg-archive.zip'
    print(f'Archive {name}: {total} rows, {len(zip_bytes)} bytes' + (' (test send)' if TEST else ''))
    for table, n in rows.items():
        if n:
            print(f'  {table}: {n}')

    listing = '\n'.join(f'  {t}: {n} rows' for t, n in rows.items() if n) or '  (no rows)'
    plan = ('This is a test send: nothing is removed from the database.' if TEST else
            'Rows are removed from the database after this email only when both Backups switches are on in the admin dashboard; '
            'then this email is the only copy, so keep it.')
    msg = EmailMessage()
    msg['From'] = f'The Fantastical Logic Grid <{GMAIL_USER}>'
    msg['To'] = TO
    msg['Subject'] = f'Logic Grid archive {name[12:22]}: {total} old rows'
    msg.set_content(f'The weekly archive of data the game no longer needs.\n\n{listing}\n\n{plan}\n\n'
                    'Open the zip with Backups and archive > Archive viewer in the admin dashboard, or open the CSV files in a '
                    'spreadsheet. Player ids are replaced with codes; README.txt in the zip lists the personal data it holds.\n')
    if total:
        msg.add_attachment(zip_bytes, maintype='application', subtype='zip', filename=name)
    try:
        with smtplib.SMTP_SSL('smtp.gmail.com', 465, context=ssl.create_default_context(), timeout=120) as smtp:
            smtp.login(GMAIL_USER, GMAIL_PASSWORD)
            smtp.send_message(msg)
    except smtplib.SMTPAuthenticationError:
        fail('Gmail refused the sign-in. Check GMAIL_USER and the app password (GMAIL_APP_PASSWORD). Nothing was removed.')
    except Exception as e:  # noqa: BLE001 - any send failure means nothing is removed
        fail(f'The email was not sent ({type(e).__name__}). Nothing was removed.')
    print('Email sent.')

    try:
        done = json.loads(call('archive/confirm', {'id': int(archive_id)}).read())
    except urllib.error.HTTPError as e:
        fail(f'The email went out, but the Worker did not accept the confirmation (HTTP {e.code}). Nothing was removed.')
    print('Rows removed from the database.' if done.get('removed') else 'Nothing removed (removal is off, or this was a test).')


if __name__ == '__main__':
    main()
