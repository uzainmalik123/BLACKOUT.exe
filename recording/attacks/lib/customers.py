"""The shop's fake customers (docs/PRD.md REC-04, D-26). Runs inside the rig's tools container only.

    python3 customers.py seed <shop URL>   registers every customer through the shop's own sign-up API
    python3 customers.py combos            prints MIN-02's leaked email:password list, one per line

Deterministic (fixed seed), so every run starts with the same customers in the same order (same ids).
Every address is under example.com/.net/.org (reserved for documentation, RFC 2606).
"""
import json
import random
import sys
import urllib.request

COUNT = 300

FIRST = """ava ben chloe dan ella finn grace hugo isla jack kate leo maya nina owen pia quinn ruby sam tess
uma vic will xena yusuf zoe amir bea carl dora eli faye gus hana ivan jade kofi lena milo nora""".split()
LAST = """adams baker carter diaz evans fischer garcia hughes ito jensen khan lopez morgan novak okafor
patel quist reyes silva tanaka ueda vance walsh xu young zimmer brooks costa duval ender frost""".split()
DOMAINS = ["example.com", "example.net", "example.org"]

# Passwords people reuse everywhere; the customers who picked one fall to credential stuffing (MIN-02).
LEAKED = ["Password1!", "Summer2025!", "iloveyou1", "Qwerty123!", "Welcome1!", "Football7!", "Sunshine1!",
          "Dragon2024!", "Monkey123!", "Letmein99!"]
REUSED_SHARE = 0.1


def customers():
    rng = random.Random(2026)
    seen, out = set(), []
    while len(out) < COUNT:
        first, last = rng.choice(FIRST), rng.choice(LAST)
        email = f"{first}.{last}@{rng.choice(DOMAINS)}"
        if email in seen:
            email = f"{first}.{last}{rng.randint(2, 99)}@{rng.choice(DOMAINS)}"
        if email in seen:
            continue
        seen.add(email)
        reused = rng.random() < REUSED_SHARE
        password = rng.choice(LEAKED) if reused else f"{rng.choice(LAST).title()}{rng.randint(1000, 9999)}#{first}"
        out.append({"email": email, "password": password, "reused": reused})
    return out


def combos():
    """A leaked list as a stuffing bot gets it: our reusers' real pairs among stale and foreign ones."""
    rng = random.Random(1313)
    pairs = []
    for c in customers():
        if c["reused"]:
            pairs.append((c["email"], c["password"]))
        elif rng.random() < 0.15:
            pairs.append((c["email"], rng.choice(LEAKED)))  # a stale password from another site's leak
    for i in range(20):  # people who were never our customers
        pairs.append((f"{rng.choice(FIRST)}{i}@example.net", rng.choice(LEAKED)))
    rng.shuffle(pairs)
    return pairs


def seed(shop):
    for c in customers():
        body = json.dumps({"email": c["email"], "password": c["password"], "passwordRepeat": c["password"]}).encode()
        req = urllib.request.Request(f"{shop}/api/Users", body, {"Content-Type": "application/json"})
        with urllib.request.urlopen(req) as res:
            if res.status != 201:
                sys.exit(f"seed failed for {c['email']}: HTTP {res.status}")
    print(f"seeded {COUNT} customers")


if __name__ == "__main__":
    if sys.argv[1:2] == ["seed"] and len(sys.argv) == 3:
        seed(sys.argv[2])
    elif sys.argv[1:] == ["combos"]:
        for email, password in combos():
            print(f"{email}:{password}")
    else:
        sys.exit(__doc__)
