# Notes for Claude

## Accounts and keys you set up go into Passwords

Whenever you create or set up an account, sign-in, API key, token or app
password for the owner (or rotate one), save it to the owner's Passwords vault
in the admin app straight away, with its proper site name, sign-in address,
username/email, password, 2-step setup key and any keys as hidden extra fields:

    node scripts/vault-drop.mjs --push --source Claude < login.json

Write `login.json` (format at the top of `scripts/vault-drop.mjs`) in a temp
folder outside the repo, delete it right after, and never put a secret on the
command line, in a commit, a PR, an issue, a log, memory or a chat message.
The tool locks the login to the vault's public drop box key, so you can add but
never read; the owner's dashboard files it on the next unlock. If the drop box
is not on yet (the tool says so), tell the owner to open Passwords once, and
keep nothing in plain text meanwhile.

Tell the owner what you saved (site and username, never the secret).
