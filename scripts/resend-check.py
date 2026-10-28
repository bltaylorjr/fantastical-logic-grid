"""Resend check (.github/workflows/resend-check.yml).

1. Looks up the public DNS records Resend needs for thelogicgrid.com
   (MX + SPF TXT on send, DKIM TXT on resend._domainkey, DMARC TXT on _dmarc)
   using Google's public DNS, plus the ImprovMX MX + SPF that forward
   support@thelogicgrid.com, and says which are found.
2. If RESEND_API_KEY is set, sends one test email from MAIL_FROM
   (default noreply@thelogicgrid.com) to GMAIL_USER, the game's own inbox,
   and prints Resend's answer. Exits 1 if a required record is missing or
   the test send fails.
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from email.utils import formataddr

DOMAIN = 'thelogicgrid.com'
MAIL_FROM = os.environ.get('MAIL_FROM', '').strip() or f'noreply@{DOMAIN}'
KEY = os.environ.get('RESEND_API_KEY', '').strip()
TO = os.environ.get('GMAIL_USER', '').strip()

CHECKS = [
    ('MX', f'send.{DOMAIN}', 'amazonses.com', True, 'MX for send (bounces)'),
    ('TXT', f'send.{DOMAIN}', 'v=spf1', True, 'SPF TXT for send'),
    ('TXT', f'resend._domainkey.{DOMAIN}', 'p=', True, 'DKIM TXT for resend._domainkey'),
    ('TXT', f'_dmarc.{DOMAIN}', 'v=DMARC1', False, 'DMARC TXT for _dmarc (optional)'),
    ('MX', DOMAIN, 'improvmx.com', False, 'MX for support@ (ImprovMX forwarding)'),
    ('TXT', DOMAIN, 'spf.improvmx.com', False, 'SPF TXT for the domain (ImprovMX)'),
]


def lookup(rr, name):
    url = 'https://dns.google/resolve?' + urllib.parse.urlencode({'name': name, 'type': rr})
    with urllib.request.urlopen(url, timeout=20) as r:
        data = json.load(r)
    return [a['data'].replace('" "', '').strip('"') for a in data.get('Answer', []) if a.get('type') in (15, 16)]


def main():
    ok = True
    for rr, name, want, required, label in CHECKS:
        try:
            values = lookup(rr, name)
        except (urllib.error.URLError, ValueError) as e:
            print(f'?  {label}: lookup failed ({e})')
            ok = ok and not required
            continue
        good = [v for v in values if want in v]
        if good:
            shown = good[0] if len(good[0]) < 70 else good[0][:60] + '...'
            print(f'OK {label}: {shown}')
        else:
            print(f'{"NO" if required else "--"} {label}: not found' + (f' (found {values})' if values else ''))
            ok = ok and not required

    if not KEY:
        print('RESEND_API_KEY is not set yet, so no test email was sent.')
        sys.exit(0 if ok else 1)
    if not TO:
        print('GMAIL_USER is not set, so there is no inbox to send the test to.')
        sys.exit(1)
    payload = {'from': formataddr(('The Fantastical Logic Grid', MAIL_FROM)), 'to': [TO],
               'subject': 'Resend test from The Fantastical Logic Grid',
               'text': f'This is a test from the Resend check. If you can read it, emails from {MAIL_FROM} work.\n'}
    req = urllib.request.Request('https://api.resend.com/emails', method='POST', data=json.dumps(payload).encode(),
                                 headers={'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json',
                                          'User-Agent': 'flg-resend-check'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            print(f'Test email accepted by Resend from {MAIL_FROM} (id {json.load(r).get("id")}). Check the game inbox.')
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read()).get('message', '')
        except ValueError:
            msg = ''
        print(f'Resend refused the test email (HTTP {e.code}): {msg}')
        ok = False
    except urllib.error.URLError as e:
        print(f'Resend did not answer: {e}')
        ok = False
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
