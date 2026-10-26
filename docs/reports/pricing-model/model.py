# Cost model for The Fantastical Logic Grid as monthly active players (MAU) grow.
import json
A = dict(dau=0.25, req=25, writes=15, reads=400, cpu_ms=2, kb_store=15, signin=0.30,
         mb_per_mau=10, email_share=0.05, neurons=1)
STAGES = [1_000, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000]

def firebase(signed):
    tiers = [(50_000, 0), (100_000, 0.0055), (1_000_000, 0.0046), (10_000_000, 0.0032)]
    cost, low = 0, 0
    for high, p in tiers:
        if signed > low: cost += (min(signed, high) - low) * p
        low = high
    return cost

def email(mau):
    n = mau * A['email_share'] * 30
    if n <= 15_000: return 0, n  # Gmail (about 500 a day) is enough
    return round(n / 1000 * 0.10, 2), n  # Amazon SES pay-as-you-go

def cloudflare(mau):
    dau = mau * A['dau']
    req_day = dau * A['req']; w_day = dau * A['writes']; r_day = dau * A['reads']
    gb = mau * A['kb_store'] / 1e6
    free_ok = req_day * 1.5 < 100_000 and w_day * 1.5 < 100_000 and r_day < 5e6 and gb < 0.5
    if free_ok: return 0, False
    req = req_day * 30; cpu = req * A['cpu_ms']; w = w_day * 30
    c = 5 + max(0, req - 10e6) / 1e6 * 0.30 + max(0, cpu - 30e6) / 1e6 * 0.02 \
        + max(0, w - 50e6) / 1e6 * 1.0 + max(0, gb - 5) * 0.75
    return round(c, 2), True

def ai(mau):
    n = mau * A['dau'] * A['neurons'] * 30
    return round(max(0, n - 300_000) / 1000 * 0.011, 2)

rows = []
for m in STAGES:
    cf, paid = cloudflare(m)
    fb = round(firebase(m * A['signin']), 2)
    em, emails = email(m)
    infra = dict(cloudflare=cf, workers_ai=ai(m), firebase=fb, email=em, hosting=0, voices=0, domain=1.25)
    sec = 0 if m < 50_000 else (50 if m < 250_000 else 150)
    build = 100 if m < 50_000 else 200
    help_ = 0 if m < 25_000 else (100 if m < 100_000 else (500 if m < 250_000 else 1000))
    art = 0 if m < 10_000 else (100 if m < 100_000 else 300)
    people = dict(security=sec, build_tools=build, moderation=help_, art_music=art)
    tot_i = round(sum(infra.values()), 2); tot_p = sum(people.values())
    rows.append(dict(mau=m, dau=int(m*A['dau']), signed=int(m*A['signin']), emails=int(emails), infra=infra, people=people,
                     infra_total=tot_i, people_total=tot_p, total=round(tot_i+tot_p, 2)))
# Uncapped server-voice what-if (do not do): 10% of DAU, 750 new characters a day each
for r in rows:
    chars = r['dau'] * 0.10 * 30 * 750
    r['chirp_uncapped'] = round(max(0, chars - 1e6) / 1e6 * 30)
    r['gemini_uncapped'] = round(r['dau'] * 0.10 * 30 * (50 * 25) / 1e6 * 9)  # 50 s audio, 25 tok/s, $9/M
json.dump(dict(assumptions=A, rows=rows), open('model.json', 'w'), indent=1)
for r in rows: print(r['mau'], r['infra'], r['infra_total'], r['people_total'], r['total'], r['chirp_uncapped'], r['gemini_uncapped'])
