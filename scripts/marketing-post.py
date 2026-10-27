"""Posts the approved marketing ads on their posting day, run each morning by
the GitHub Action .github/workflows/marketing-post.yml.

1. Ask the Worker for the approved ads of active campaigns whose posting day
   has come (GET /admin/v1/marketing/due).
2. Post each one to the sites whose official free API allows it, using that
   site's key from the GitHub secrets: Bluesky, Mastodon, X, the game's
   Facebook Page, Instagram and Threads. Tell the Worker the result, so the
   ad shows as posted (with its link) or keeps the error to try again
   tomorrow (POST /admin/v1/marketing/ads/<id>/auto).
3. Email the owner's inbox the ads that must be posted by hand that day
   (Reddit, Hacker News, Product Hunt, TikTok, YouTube, LinkedIn, Pinterest,
   Facebook groups, itch.io and the rest), with the words, the tracked link
   and the files ready to paste, plus anything that failed.

Keys never live in the repository: each is a GitHub secret (see the
Marketing entries in admin/connections.js). A site without its key is
simply emailed instead. The repository is public, so this prints only ad
titles and counts, never a key, and error notes are scrubbed of them.

Modes (MODE): post (default), check (signs in to each site with a key and
says whether it works, posting nothing), dry-run (says what it would post
and sends the email marked Preview, posting and changing nothing).
Python standard library only.
"""
import base64
import hashlib
import hmac
import html
import json
import os
import re
import secrets
import smtplib
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from email.message import EmailMessage
from zoneinfo import ZoneInfo

API = os.environ.get('FLG_CLOUD_URL', '').strip().rstrip('/')
TOKEN = os.environ.get('FLG_ADMIN_TOKEN', '').strip()
MODE = (os.environ.get('MODE', '').strip() or 'post').lower()
DAY = os.environ.get('DAY', '').strip() or datetime.now(ZoneInfo('America/New_York')).date().isoformat()
GMAIL_USER = os.environ.get('GMAIL_USER', '').strip()
GMAIL_PASSWORD = ''.join(os.environ.get('GMAIL_APP_PASSWORD', '').split())
MAIL_TO = os.environ.get('OWNER_TASKS_TO', '').strip() or GMAIL_USER
ADMIN_URL = f'{API}/admin/#marketing'
UA = 'flg-marketing-post'
GRAPH = 'https://graph.facebook.com/v21.0'
THREADS = 'https://graph.threads.net/v1.0'
RETRY_DAYS = 3  # a failed automatic post is tried again on the next 3 mornings

KEYS = {
    'bluesky': ['BLUESKY_HANDLE', 'BLUESKY_APP_PASSWORD'],
    'mastodon': ['MASTODON_URL', 'MASTODON_TOKEN'],
    'x': ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'],
    'facebook': ['META_PAGE_ID', 'META_PAGE_TOKEN'],
    'instagram': ['INSTAGRAM_ACCOUNT_ID', 'META_PAGE_TOKEN'],
    'threads': ['THREADS_USER_ID', 'THREADS_TOKEN'],
}
NAMES = {'bluesky': 'Bluesky', 'mastodon': 'Mastodon', 'x': 'X', 'facebook': 'Facebook Page', 'instagram': 'Instagram', 'threads': 'Threads'}


def env(name):
    return os.environ.get(name, '').strip()


def has_keys(channel):
    return channel in KEYS and all(env(k) for k in KEYS[channel])


def is_auto(ad):
    """Facebook ads go to the game's Page; posts in groups are always by hand."""
    return ad['channel'] in KEYS and not (ad['channel'] == 'facebook' and ad.get('medium') == 'community')


def scrub(text):
    out = str(text)
    for names in KEYS.values():
        for k in names:
            v = env(k)
            if len(v) >= 6 and k not in ('BLUESKY_HANDLE', 'MASTODON_URL'):
                out = out.replace(v, '***')
    out = re.sub(r'(access_token|oauth_[a-z_]+)=[^&\s"]+', r'\1=***', out)
    return out[:280]


class Failed(Exception):
    pass


def request(url, method='GET', data=None, headers=None, form=None, timeout=60):
    headers = {'User-Agent': UA, **(headers or {})}
    body = None
    if form is not None:
        body = urllib.parse.urlencode(form).encode()
        headers['Content-Type'] = 'application/x-www-form-urlencoded'
    elif isinstance(data, (dict, list)):
        body = json.dumps(data).encode()
        headers['Content-Type'] = 'application/json'
    elif data is not None:
        body = data
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            raw = res.read()
            return json.loads(raw) if raw and raw[:1] in (b'{', b'[') else {}
    except urllib.error.HTTPError as e:
        detail = e.read().decode('utf-8', 'replace')[:400]
        raise Failed(f'{e.code} {detail}') from None
    except urllib.error.URLError as e:
        raise Failed(f'could not connect ({e.reason})') from None


def worker(path, body=None):
    return request(f'{API}/admin/v1/{path}', method='POST' if body is not None else 'GET', data=body,
                   headers={'Authorization': f'Bearer {TOKEN}'})


def raw_url(url):
    """github.com/<owner>/<repo>/raw/<branch>/<path> redirects; the sites want the final address."""
    m = re.match(r'^https://github\.com/([^/]+)/([^/]+)/raw/([^/]+)/(.+)$', url)
    return f'https://raw.githubusercontent.com/{m[1]}/{m[2]}/{m[3]}/{m[4]}' if m else url


def files(ad, kind):
    return [raw_url(m['url']) for m in ad.get('media', []) if m.get('kind') == kind]


def download(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=120) as res:
        return res.read(), res.headers.get('Content-Type', 'application/octet-stream').split(';')[0]


ALT = 'A logic grid puzzle from The Fantastical Logic Grid: the grid, the clues and the story scene.'


# ------------------------------------------------------------- the sites
def bluesky_session():
    s = request('https://bsky.social/xrpc/com.atproto.server.createSession', method='POST',
                data={'identifier': env('BLUESKY_HANDLE'), 'password': env('BLUESKY_APP_PASSWORD')})
    return s['accessJwt'], s['did'], s.get('handle') or env('BLUESKY_HANDLE')


def post_bluesky(ad):
    jwt, did, handle = bluesky_session()
    auth = {'Authorization': f'Bearer {jwt}'}
    # Posts hold 300 characters, so the long tracked link shows as the site's
    # name and still opens the full link.
    show = 'thelogicgrid.com'
    parts = ad['words'].split(ad['link'])
    text = show.join(parts)
    facets, at = [], 0
    for part in parts[:-1]:
        at += len(part.encode())
        facets.append({'index': {'byteStart': at, 'byteEnd': at + len(show.encode())},
                       'features': [{'$type': 'app.bsky.richtext.facet#link', 'uri': ad['link']}]})
        at += len(show.encode())
    if len(text) > 300:
        raise Failed(f'the words are {len(text)} characters; Bluesky allows 300')
    record = {'$type': 'app.bsky.feed.post', 'text': text, 'createdAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z'), 'langs': ['en']}
    if facets:
        record['facets'] = facets
    images = []
    for url in files(ad, 'image')[:4]:
        data, ctype = download(url)
        if len(data) > 976_000:
            raise Failed('a picture is over Bluesky\'s 1 MB limit')
        blob = request('https://bsky.social/xrpc/com.atproto.repo.uploadBlob', method='POST', data=data,
                       headers={**auth, 'Content-Type': ctype})['blob']
        images.append({'alt': ALT, 'image': blob})
    if images:
        record['embed'] = {'$type': 'app.bsky.embed.images', 'images': images}
    r = request('https://bsky.social/xrpc/com.atproto.repo.createRecord', method='POST', headers=auth,
                data={'repo': did, 'collection': 'app.bsky.feed.post', 'record': record})
    return f"https://bsky.app/profile/{handle}/post/{r['uri'].rsplit('/', 1)[-1]}"


def multipart(fields, file_field, filename, data, ctype):
    boundary = secrets.token_hex(16)
    out = b''
    for k, v in fields.items():
        out += f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
    out += f'--{boundary}\r\nContent-Disposition: form-data; name="{file_field}"; filename="{filename}"\r\nContent-Type: {ctype}\r\n\r\n'.encode()
    out += data + f'\r\n--{boundary}--\r\n'.encode()
    return out, f'multipart/form-data; boundary={boundary}'


def post_mastodon(ad):
    base = env('MASTODON_URL').rstrip('/')
    if not base.startswith('https://'):
        base = 'https://' + base
    auth = {'Authorization': f"Bearer {env('MASTODON_TOKEN')}"}
    media_ids = []
    for url in files(ad, 'image')[:4]:
        data, ctype = download(url)
        body, btype = multipart({'description': ALT}, 'file', url.rsplit('/', 1)[-1], data, ctype)
        m = request(f'{base}/api/v2/media', method='POST', data=body, headers={**auth, 'Content-Type': btype})
        for _ in range(30):
            if m.get('url'):
                break
            time.sleep(2)
            m = request(f"{base}/api/v1/media/{m['id']}", headers=auth)
        media_ids.append(m['id'])
    # The idempotency key stops a retry from posting the same ad twice.
    r = request(f'{base}/api/v1/statuses', method='POST', headers={**auth, 'Idempotency-Key': f"flg-ad-{ad['id']}"},
                data={'status': ad['words'], 'media_ids': media_ids, 'visibility': 'public', 'language': 'en'})
    return r['url']


def oauth1(method, url):
    p = {'oauth_consumer_key': env('X_API_KEY'), 'oauth_nonce': secrets.token_hex(16), 'oauth_signature_method': 'HMAC-SHA1',
         'oauth_timestamp': str(int(time.time())), 'oauth_token': env('X_ACCESS_TOKEN'), 'oauth_version': '1.0'}
    q = lambda s: urllib.parse.quote(str(s), safe='~')
    base = '&'.join([method, q(url), q('&'.join(f'{q(k)}={q(v)}' for k, v in sorted(p.items())))])
    key = f"{q(env('X_API_SECRET'))}&{q(env('X_ACCESS_SECRET'))}"
    p['oauth_signature'] = base64.b64encode(hmac.new(key.encode(), base.encode(), hashlib.sha1).digest()).decode()
    return 'OAuth ' + ', '.join(f'{q(k)}="{q(v)}"' for k, v in sorted(p.items()))


def post_x(ad):
    # The free X API plan can post text; the link shows the game's picture card.
    url = 'https://api.x.com/2/tweets'
    r = request(url, method='POST', data={'text': ad['words']}, headers={'Authorization': oauth1('POST', url)})
    return f"https://x.com/i/web/status/{r['data']['id']}"


def meta(url, method='GET', form=None, token=''):
    return request(url, method=method, form=form, headers={'Authorization': f'Bearer {token}'})


def post_facebook(ad):
    page, token = env('META_PAGE_ID'), env('META_PAGE_TOKEN')
    videos, images = files(ad, 'video'), files(ad, 'image')
    if videos:
        r = meta(f'{GRAPH}/{page}/videos', 'POST', {'file_url': videos[0], 'description': ad['words']}, token)
        return f"https://www.facebook.com/{page}/videos/{r['id']}"
    if images:
        r = meta(f'{GRAPH}/{page}/photos', 'POST', {'url': images[0], 'caption': ad['words']}, token)
        return f"https://www.facebook.com/{r.get('post_id') or r['id']}"
    r = meta(f'{GRAPH}/{page}/feed', 'POST', {'message': ad['words'], 'link': ad['link']}, token)
    return f"https://www.facebook.com/{r['id']}"


def wait_ready(url, token, field='status_code'):
    for _ in range(60):
        s = meta(f'{url}?fields={field}', token=token).get(field, '')
        if s in ('FINISHED', 'PUBLISHED'):
            return
        if s in ('ERROR', 'EXPIRED'):
            raise Failed(f'the site could not process the file ({s})')
        time.sleep(10)
    raise Failed('the site took more than 10 minutes to process the file')


def post_instagram(ad):
    ig, token = env('INSTAGRAM_ACCOUNT_ID'), env('META_PAGE_TOKEN')
    videos, images = files(ad, 'video'), files(ad, 'image')
    if videos:
        form = {'media_type': 'REELS', 'video_url': videos[0], 'caption': ad['words'], 'share_to_feed': 'true'}
    elif images:
        # Instagram takes JPEG only; every picture has a .jpg twin (media/marketing).
        form = {'image_url': re.sub(r'\.png$', '.jpg', images[0]), 'caption': ad['words']}
    else:
        raise Failed('Instagram needs a picture or a video')
    c = meta(f'{GRAPH}/{ig}/media', 'POST', form, token)
    wait_ready(f"{GRAPH}/{c['id']}", token)
    r = meta(f'{GRAPH}/{ig}/media_publish', 'POST', {'creation_id': c['id']}, token)
    return meta(f"{GRAPH}/{r['id']}?fields=permalink", token=token).get('permalink') or 'https://www.instagram.com/'


def post_threads(ad):
    user, token = env('THREADS_USER_ID'), env('THREADS_TOKEN')
    videos, images = files(ad, 'video'), files(ad, 'image')
    form = {'text': ad['words']}
    if videos:
        form.update(media_type='VIDEO', video_url=videos[0])
    elif images:
        form.update(media_type='IMAGE', image_url=images[0])
    else:
        form.update(media_type='TEXT')
    c = meta(f'{THREADS}/{user}/threads', 'POST', form, token)
    wait_ready(f"{THREADS}/{c['id']}", token, 'status')
    r = meta(f'{THREADS}/{user}/threads_publish', 'POST', {'creation_id': c['id']}, token)
    return meta(f"{THREADS}/{r['id']}?fields=permalink", token=token).get('permalink') or 'https://www.threads.net/'


POST = {'bluesky': post_bluesky, 'mastodon': post_mastodon, 'x': post_x, 'facebook': post_facebook, 'instagram': post_instagram, 'threads': post_threads}


def check_keys():
    tests = {
        'bluesky': lambda: bluesky_session()[2],
        'mastodon': lambda: request(f"{('https://' + env('MASTODON_URL')) if not env('MASTODON_URL').startswith('https://') else env('MASTODON_URL').rstrip('/')}/api/v1/accounts/verify_credentials",
                                    headers={'Authorization': f"Bearer {env('MASTODON_TOKEN')}"})['acct'],
        'x': lambda: request('https://api.x.com/2/users/me', headers={'Authorization': oauth1('GET', 'https://api.x.com/2/users/me')})['data']['username'],
        'facebook': lambda: meta(f"{GRAPH}/{env('META_PAGE_ID')}?fields=name", token=env('META_PAGE_TOKEN'))['name'],
        'instagram': lambda: meta(f"{GRAPH}/{env('INSTAGRAM_ACCOUNT_ID')}?fields=username", token=env('META_PAGE_TOKEN'))['username'],
        'threads': lambda: meta(f'{THREADS}/me?fields=username', token=env('THREADS_TOKEN'))['username'],
    }
    bad = 0
    for ch, test in tests.items():
        if not has_keys(ch):
            print(f'{NAMES[ch]}: not set up (add {", ".join(KEYS[ch])})')
            continue
        try:
            test()
            print(f'{NAMES[ch]}: connected')
        except Exception as e:  # noqa: BLE001 - report every site
            bad += 1
            print(f'::warning::{NAMES[ch]}: the key did not work: {scrub(e)}')
    return bad


# ------------------------------------------------------------- the email
def ad_block(ad, why=''):
    media = ''.join(f'<li><a href="{html.escape(raw_url(m["url"]))}">{html.escape(m["title"])}</a></li>' for m in ad.get('media', []))
    where = ad.get('where') or ''
    where_html = f'<a href="{html.escape(where)}">{html.escape(where)}</a>' if where.startswith('https://') else html.escape(where)
    return (f'<h3>{html.escape(ad["title"])}</h3>'
            + (f'<p><i>{html.escape(why)}</i></p>' if why else '')
            + (f'<p><b>Where:</b> {where_html}</p>' if where else '')
            + (f'<p><b>Tip:</b> {html.escape(ad["notes"])}</p>' if ad.get('notes') else '')
            + f'<p><b>Words to post</b> (the tracked link is already in them):</p>'
            + f'<pre style="white-space:pre-wrap;font-family:Segoe UI,Arial,sans-serif;background:#f1eff7;padding:10px;border-radius:6px">{html.escape(ad["words"])}</pre>'
            + f'<p><b>Tracked link:</b> <a href="{html.escape(ad["link"])}">{html.escape(ad["link"])}</a></p>'
            + (f'<p><b>Files:</b></p><ul>{media}</ul>' if media else ''))


def email(subject, parts):
    if not (GMAIL_USER and GMAIL_PASSWORD and MAIL_TO):
        print('Email not set up (GMAIL_USER, GMAIL_APP_PASSWORD): skipped.')
        return
    style = 'body{font-family:Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1d1b29;max-width:760px}h3{margin-top:26px;border-top:1px solid #ddd;padding-top:12px}'
    body = f'<!doctype html><html><head><meta charset="utf-8"><style>{style}</style></head><body>{"".join(parts)}</body></html>'
    msg = EmailMessage()
    msg['From'] = f'The Fantastical Logic Grid <{GMAIL_USER}>'
    msg['To'] = MAIL_TO
    msg['Subject'] = subject
    msg.set_content(re.sub(r'<[^>]+>', '', re.sub(r'</(p|h3|li|pre)>', '\n', body)))
    msg.add_alternative(body, subtype='html')
    with smtplib.SMTP_SSL('smtp.gmail.com', 465, context=ssl.create_default_context()) as s:
        s.login(GMAIL_USER, GMAIL_PASSWORD)
        s.send_message(msg)
    print('Email sent to the owner inbox.')


def main():
    if MODE == 'check':
        sys.exit(1 if check_keys() else 0)
    if not (API and TOKEN):
        print('Not set up: FLG_CLOUD_URL and FLG_ADMIN_TOKEN are needed. Nothing to do.')
        return
    due = worker(f'marketing/due?day={urllib.parse.quote(DAY)}')
    ads = due.get('ads', [])
    dry = MODE == 'dry-run'
    print(f'{DAY}: {len(ads)} approved ads due (automatic posting {"on" if due.get("autopost") else "off"}).')
    posted, failed, by_hand = [], [], []
    for ad in ads:
        auto = due.get('autopost') and is_auto(ad) and has_keys(ad['channel'])
        if not auto:
            if ad['postOn'] == DAY:
                why = '' if not is_auto(ad) else (f'{NAMES[ad["channel"]]} can be posted automatically once its key is saved (admin > Connections and setup).'
                                                    if due.get('autopost') else 'Automatic posting is switched off in admin Settings.')
                by_hand.append((ad, why))
            continue
        if (date.fromisoformat(DAY) - date.fromisoformat(ad['postOn'])).days > RETRY_DAYS:
            continue  # gave up: its note in admin says why
        if dry:
            print(f'Would post: {ad["title"]}')
            posted.append((ad, '(preview)'))
            continue
        try:
            url = POST[ad['channel']](ad)
            worker(f'marketing/ads/{ad["id"]}/auto', {'ok': True, 'postUrl': url, 'note': f'Posted automatically on {DAY}'})
            posted.append((ad, url))
            print(f'Posted: {ad["title"]}')
        except Exception as e:  # noqa: BLE001 - one site failing must not stop the others
            note = f'{DAY}: {scrub(e)}'
            failed.append((ad, note))
            print(f'::warning::Could not post {ad["title"]}: {note}')
            try:
                worker(f'marketing/ads/{ad["id"]}/auto', {'ok': False, 'note': note})
            except Exception as e2:  # noqa: BLE001
                print(f'::warning::Could not save the note: {scrub(e2)}')
    print(f'Posted {len(posted)}, failed {len(failed)}, to post by hand today {len(by_hand)}.')
    if not (by_hand or failed or (dry and posted)) or not due.get('reminders'):
        return
    when = datetime.fromisoformat(DAY).strftime('%A, %B %-d')
    parts = [f'<p>Good morning! Here is the launch campaign for {when}.</p>']
    if posted:
        parts.append('<p><b>Posted automatically:</b></p><ul>' + ''.join(
            f'<li>{html.escape(a["title"])}: <a href="{html.escape(u)}">{html.escape(u)}</a></li>' if u.startswith('https://') else f'<li>{html.escape(a["title"])} {html.escape(u)}</li>'
            for a, u in posted) + '</ul>')
    if failed:
        parts.append('<p><b>Could not post (it tries again tomorrow, or post it by hand):</b></p><ul>' + ''.join(
            f'<li>{html.escape(a["title"])}: {html.escape(n)}</li>' for a, n in failed) + '</ul>')
    if by_hand:
        parts.append(f'<p><b>{len(by_hand)} to post by hand today.</b> For each one: copy the words, add the file, post it, then open '
                     f'<a href="{html.escape(ADMIN_URL)}">admin &gt; Marketing</a> and click <b>Mark as posted</b> with the post\'s link. '
                     'Each one takes about 5 minutes. Skip any you like.</p>')
        parts += [ad_block(a, why) for a, why in by_hand]
    for a, n in failed:
        parts.append(ad_block(a, 'This one failed automatically. You can post it by hand instead.'))
    title = f'{len(by_hand)} to post by hand' if by_hand else 'automatic posting report'
    email(f'{"Preview: " if dry else ""}Launch campaign, {when}: {title}', parts)


if __name__ == '__main__':
    main()
