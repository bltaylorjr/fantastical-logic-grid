"""Storyline gifts, run by the GitHub Action .github/workflows/story-gifts.yml
every 15 minutes (and straight away when the Worker starts it).

1. Ask the Worker for approved storyline gifts (POST /admin/v1/gifts/claim).
2. For each one, make the puzzle told with the player's storyline and print it
   with its answer key to PDF (scripts/story-gift.mjs).
3. Email the player a thank-you with the PDF attached (when there is an address).
4. Hand the saved puzzle back to the Worker (POST /admin/v1/gifts/done), which
   puts it in the player's saved puzzles; the game picks it up on its next sync.

The email and printing helpers are the educator packages' own
(scripts/educator-packages.py). The repository is public, so this prints only
counts and gift numbers, never an email address or a screen name.
Python standard library only.
"""
import importlib.util
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location('educator_packages', os.path.join(HERE, 'educator-packages.py'))
edu = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(edu)


def gift_mail(g, manifest):
    who = g.get('credit')
    blocks = [
        f'Hello{" " + who if who else ""},',
        'Thank you! Your storyline submission has been approved. It is now part of '
        f'The Fantastical Logic Grid\'s {manifest["theme"]} stories, so other players will meet it too'
        + (f', credited to {who}.' if who else '.'),
        f'We made a puzzle told with your storyline: "{manifest["title"]}" ({manifest["difficulty"]}).',
    ]
    if g.get('hasPlayer'):
        blocks.append('It is waiting in your saved puzzles in the game. Sign in on any device and open Saved puzzles to play it.')
    blocks += [
        ('list', ['The attached PDF has the puzzle and, on its own page, the answer key. Print it or play it on screen.']),
        ('link', 'Play at thelogicgrid.com', edu.SITE),
        'Keep the ideas coming!',
        edu.SIGN_OFF,
    ]
    return {'subject': f'Thank you! Your storyline was approved: {manifest["title"]}', 'blocks': blocks}


def build(g):
    edu.ensure_printer()
    with tempfile.TemporaryDirectory() as tmp:
        job = os.path.join(tmp, 'job.json')
        out = os.path.join(tmp, 'out')
        with open(job, 'w', encoding='utf-8') as f:
            json.dump(g, f)
        subprocess.run(['node', os.path.join(edu.ROOT, 'scripts', 'story-gift.mjs'), job, out], check=True, timeout=600, cwd=edu.ROOT)
        with open(os.path.join(out, 'manifest.json'), encoding='utf-8') as f:
            manifest = json.load(f)
        attachments = []
        for path in manifest['files']:
            with open(path, 'rb') as f:
                attachments.append((os.path.basename(path), f.read()))
        return manifest, attachments


def main():
    if not edu.API or not edu.TOKEN:
        print('Story gifts are not set up yet (missing FLG_CLOUD_URL or FLG_ADMIN_TOKEN).')
        return 0
    try:
        work = edu.call('gifts/claim', {})
    except Exception as e:  # noqa: BLE001
        print(f'Could not reach the Worker: {type(e).__name__}')
        return 1
    gifts = work.get('gifts', [])
    if not gifts:
        print('No storyline gifts waiting.')
        return 0
    mailer = edu.Mailer()
    results = []
    try:
        for g in gifts:
            try:
                manifest, attachments = build(g)
            except Exception as e:  # noqa: BLE001
                print(f'Gift {g["id"]}: the puzzle could not be made ({type(e).__name__}).')
                results.append({'id': g['id'], 'ok': False, 'error': f'Build problem: {type(e).__name__}'})
                continue
            if g.get('email'):
                if not mailer.send(g['email'], gift_mail(g, manifest), attachments):
                    print(f'Gift {g["id"]}: the email did not go out; it will be tried again.')
                    results.append({'id': g['id'], 'ok': False, 'error': 'The email did not go out.'})
                    continue
            results.append({'id': g['id'], 'ok': True, 'save': manifest['save'] if g.get('hasPlayer') else None})
            print(f'Gift {g["id"]}: made{", emailed" if g.get("email") else ""}{", saved for the player" if g.get("hasPlayer") else ""}.')
    finally:
        mailer.close()
    done = edu.call('gifts/done', {'gifts': results})
    print(f'Done: {done.get("sent", 0)} sent, {done.get("failed", 0)} to try again.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
