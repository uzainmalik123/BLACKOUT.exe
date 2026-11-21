"""Ordinary shoppers (docs/PRD.md REC-06, D-60, D-61). Runs inside the rig's tools container only.

    python3 shoppers.py <shop URL>        e.g. http://10.66.0.10 (through nginx, so it's logged)

About ten minutes of customers using the shop the way its own Angular front-end does: page loads,
the product list, product details and reviews, searches, guest baskets, logins (a few typos and a
couple of forgotten passwords), baskets, the full checkout, sign-ups, feedback (with the shop's
CAPTCHA, solved as a person reads it) and complaints with a small real PDF. No attack payloads.

Each visitor is named in X-Forwarded-For (trusted from the tools box only, D-27), always inside
203.0.113.0/24 and never on an address a Death or minion recording uses. Every choice comes from a
fixed seed, so the same people do the same things every run; only the server's own ids and
the exact millisecond timings differ. CUST_SCALE (default 1) multiplies every wait, for quick tests.
"""
import json
import os
import random
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from customers import customers  # noqa: E402

SEED = 6106
SCALE = float(os.environ.get("CUST_SCALE", "1"))
WINDOW_S = 540        # sessions start in the first 540 s; the last ones finish by about 600 s
LONG = {"checkout", "signup", "feedback", "complaint"}
LONG_BY_S = 420       # ... and the long ones start by 420 s
ORIGIN = "https://juice-sh.op/"   # the shop's public address, as browsers put it in Referer (D-61)

# Addresses Death's and the minions' recordings use (recording/README.md); customers never get one.
ATTACKER_HOSTS = {11, 23, 44, 61, 81, 82, 83, 91, 111, 131, 151, 171, 201} | set(range(128, 256))
SOURCES = 64

# Real, current desktop and mobile browser user agents (Chrome, Edge, Firefox, Safari).
AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0",
    "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (iPad; CPU OS 17_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.7 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
]

SEARCHES = ["apple", "juice", "banana", "lemon", "orange", "melon", "carrot", "strawberry", "raspberry",
            "smoothie", "green smoothie", "apple juice", "mug", "hoodie", "sticker", "t-shirt", "coaster",
            "book", "syrup", "lemon juice", "strawbery", "bananna", "fruit press", "card"]

FEEDBACK = [
    ("Delivery was quick and the apple juice tasted great.", 5),
    ("Good prices, but the site was a bit slow at checkout.", 4),
    ("Love the banana juice. Please stock bigger bottles!", 5),
    ("Nice shop. The search could be smarter about typos.", 3),
]

COMPLAINTS = [
    ("receipt.pdf", "My order arrived with one bottle broken. Receipt attached, could you refund that item?"),
    ("delivery_note.pdf", "I was charged for one day delivery but it took four days. Delivery note attached."),
]

STREETS = ["Maple Street", "Station Road", "Elm Avenue", "Harbour Lane", "Church Street", "Park Road", "Mill Lane"]
CITIES = [("Springfield", "IL", "United States"), ("Leeds", "West Yorkshire", "United Kingdom"),
          ("Hamburg", "Hamburg", "Germany"), ("Lyon", "Rhone", "France"), ("Toronto", "Ontario", "Canada"),
          ("Melbourne", "Victoria", "Australia")]

QUESTION_ANSWERS = ["Maria", "Smith", "Rex", "Paris", "Blue", "Pizza"]


def pdf(text):
    """A small, valid one-page PDF with `text` on it, built by hand (no libraries in the tools box)."""
    stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n%s\nendstream" % (len(stream), stream),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n%s\nendobj\n" % (i, body)
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    for off in offsets:
        out += b"%010d 00000 n \n" % off
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, xref)
    return bytes(out)


class Visitor:
    """One browser: an address, a user agent, cookies and the token the front-end keeps."""

    def __init__(self, shop, ip, agent, rng):
        self.shop, self.ip, self.agent, self.rng = shop, ip, agent, rng
        self.token = None
        self.bid = None
        self.user = None

    def think(self, low, high):
        time.sleep(self.rng.uniform(low, high) * SCALE)

    def call(self, method, path, body=None, referer=ORIGIN, content_type=None, raw=None):
        headers = {"User-Agent": self.agent, "X-Forwarded-For": self.ip, "Accept-Language": "en-GB,en;q=0.9"}
        if referer:
            headers["Referer"] = referer
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        if raw is not None:
            data, headers["Content-Type"] = raw, content_type
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
            headers["Cookie"] = f"token={self.token}; cookieconsent_status=dismiss"
        req = urllib.request.Request(self.shop + path, data, headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=30) as res:
                status, payload = res.status, res.read()
        except urllib.error.HTTPError as err:
            status, payload = err.code, err.read()
        tally(status)
        if status >= 500:
            print(f"{self.ip} {method} {path} -> {status}", file=sys.stderr)
        try:
            return status, json.loads(payload)
        except ValueError:
            return status, payload

    # --- what the front-end does on each page ---------------------------------------------------

    def page_load(self, first_visit):
        """A full load of the single-page app; a returning browser has the static files cached."""
        entry = self.rng.choice(["", "", "", "https://www.google.com/", "https://duckduckgo.com/", "https://www.bing.com/"])
        status, index = self.call("GET", "/", referer=entry)
        if first_visit and isinstance(index, bytes):
            html = index.decode("utf8", "replace")
            for asset in re.findall(r'(?:href|src)="([^"]+\.(?:css|js))"', html):
                self.call("GET", "/" + asset)
            self.call("GET", "/assets/public/favicon_js.ico")
            self.call("GET", "/assets/i18n/en.json")
            self.call("GET", "/assets/public/images/JuiceShop_Logo.png")
        self.call("GET", "/rest/admin/application-configuration")
        self.call("GET", "/rest/languages")
        self.call("GET", "/rest/admin/application-version")
        if self.token:
            self.call("GET", "/rest/user/whoami")
            self.call("GET", f"/rest/basket/{self.bid}")
        return self.product_list(first_visit)

    def product_list(self, images):
        """The search page loads every product and filters in the browser (Angular's own behaviour)."""
        _, products = self.call("GET", "/rest/products/search?q=")
        _, quantities = self.call("GET", "/api/Quantitys/")
        products = products.get("data", []) if isinstance(products, dict) else []
        quantities = quantities.get("data", []) if isinstance(quantities, dict) else []
        if images:
            for p in products[: self.rng.randint(6, 12)]:
                alt = [a["file"] for a in p.get("alternateImages") or [] if a.get("density") == "1x"]
                self.call("GET", "/assets/public/images/products/" + (alt[0] if alt else p["image"]))
        stock = {q["ProductId"]: q for q in quantities}
        # Shoppers pick things that are in stock and not limited per customer.
        self.products = [p for p in products if stock.get(p["id"], {}).get("quantity", 0) >= 10
                         and not stock.get(p["id"], {}).get("limitPerUser")] or products
        return self.products

    def search(self, word):
        """A search sent to the shop's search API (D-61: the SPA itself filters in the browser)."""
        self.call("GET", "/rest/products/search?q=" + urllib.parse.quote(word))

    def view_product(self):
        product = self.rng.choice(self.products)
        self.call("GET", f"/rest/products/{product['id']}/reviews")
        return product

    def product_detail(self, pid):
        self.call("GET", f"/api/Products/{pid}?d=" + urllib.parse.quote(date.today().strftime("%a %b %d %Y")))

    def login(self, email, password):
        status, res = self.call("POST", "/rest/user/login", {"email": email, "password": password})
        if status != 200:
            return False
        self.token, self.bid = res["authentication"]["token"], res["authentication"]["bid"]
        self.call("GET", f"/rest/basket/{self.bid}")
        self.call("GET", "/rest/user/whoami")
        _, me = self.call("GET", "/rest/user/whoami?fields=id,email")
        self.user = me.get("user", {}) if isinstance(me, dict) else {}
        self.product_list(False)
        return True

    def logout(self):
        self.call("GET", "/rest/saveLoginIp")
        self.token = self.bid = None

    def add_to_basket(self, product):
        pid = product["id"]
        if not self.token:   # a guest basket lives in the browser; the front-end only fetches the name
            self.product_detail(pid)
            return
        _, basket = self.call("GET", f"/rest/basket/{self.bid}")
        items = basket.get("data", {}).get("Products", []) if isinstance(basket, dict) else []
        mine = next((p for p in items if p["id"] == pid), None)
        if mine:
            item = mine["BasketItem"]
            self.call("GET", f"/api/BasketItems/{item['id']}")
            self.call("PUT", f"/api/BasketItems/{item['id']}", {"quantity": item["quantity"] + 1})
        else:
            self.call("POST", "/api/BasketItems/", {"ProductId": pid, "BasketId": str(self.bid), "quantity": 1})
        self.product_detail(pid)
        self.call("GET", f"/rest/basket/{self.bid}")

    def checkout(self, name):
        self.call("GET", f"/rest/basket/{self.bid}")
        self.think(3, 8)
        _, addresses = self.call("GET", "/api/Addresss")
        self.think(15, 35)    # typing an address
        city, state, country = self.rng.choice(CITIES)
        _, address = self.call("POST", "/api/Addresss/", {
            "country": country, "fullName": name, "mobileNum": self.rng.randint(2000000000, 9999999999),
            "zipCode": str(self.rng.randint(10000, 99999)), "city": city, "state": state,
            "streetAddress": f"{self.rng.randint(1, 240)} {self.rng.choice(STREETS)}"})
        address_id = address["data"]["id"]
        self.call("GET", "/api/Addresss")
        self.think(2, 5)
        self.call("GET", f"/api/Addresss/{address_id}")
        self.call("GET", "/api/Deliverys")
        self.think(3, 8)
        delivery = self.rng.choice([1, 2, 3, 3])
        self.call("GET", "/api/Cards")
        self.call("GET", "/rest/wallet/balance")
        self.think(15, 30)    # typing a card
        _, card = self.call("POST", "/api/Cards/", {
            "fullName": name, "cardNum": int("4" + "".join(str(self.rng.randint(0, 9)) for _ in range(15))),
            "expMonth": str(self.rng.randint(1, 12)), "expYear": str(self.rng.randint(2080, 2090))})
        card_id = card["data"]["id"]
        self.call("GET", "/api/Cards")
        self.think(2, 6)
        self.call("GET", f"/api/Deliverys/{delivery}")
        self.call("GET", f"/api/Addresss/{address_id}")
        self.call("GET", f"/api/Cards/{card_id}")
        self.call("GET", f"/rest/basket/{self.bid}")
        self.think(3, 10)
        status, order = self.call("POST", f"/rest/basket/{self.bid}/checkout", {
            "couponData": None,
            "orderDetails": {"paymentId": str(card_id), "addressId": str(address_id), "deliveryMethodId": str(delivery)}})
        if status == 200 and isinstance(order, dict):
            self.call("GET", "/rest/track-order/" + urllib.parse.quote(order["orderConfirmation"]))
            self.call("GET", f"/rest/basket/{self.bid}")

    def feedback(self, comment, rating):
        _, me = self.call("GET", "/rest/user/whoami?fields=id,email")
        _, captcha = self.call("GET", "/rest/captcha/")
        self.think(20, 45)   # writing, then reading the sum
        expression = captcha["captcha"]
        assert re.fullmatch(r"[0-9+\-*]+", expression)
        answer = str(eval(expression, {"__builtins__": {}}))  # what the person types: e.g. 2+9+1 -> 12
        user = me.get("user", {}) if isinstance(me, dict) else {}
        author = f"***{user['email'][3:]}" if user.get("email") else "anonymous"
        self.call("POST", "/api/Feedbacks/", {"UserId": user.get("id"), "captchaId": captcha["captchaId"],
                                             "captcha": answer, "comment": f"{comment} ({author})", "rating": rating})

    def complaint(self, filename, message):
        _, me = self.call("GET", "/rest/user/whoami?fields=id,email")
        self.think(25, 50)
        boundary = "----WebKitFormBoundary" + "".join(self.rng.choice("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef0123456789") for _ in range(16))
        body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n"
                f"Content-Type: application/pdf\r\n\r\n").encode() + pdf(message[:60]) + f"\r\n--{boundary}--\r\n".encode()
        status, _ = self.call("POST", "/file-upload", raw=body, content_type=f"multipart/form-data; boundary={boundary}")
        if status < 300:
            self.call("POST", "/api/Complaints/", {"UserId": me["user"]["id"], "message": message})


# --- the day's sessions ----------------------------------------------------------------------------

def full_name(email):
    local = re.sub(r"\d+$", "", email.split("@")[0])
    return " ".join(part.title() for part in local.split("."))


def plan():
    """Every session of the recording: when it starts, who it is and what they came to do."""
    rng = random.Random(SEED)
    hosts = rng.sample([h for h in range(2, 128) if h not in ATTACKER_HOSTS], SOURCES)
    agent_of = {h: rng.choice(AGENTS) for h in hosts}
    people = customers()
    seeded = rng.sample(people, 60)     # the customers who log in during the recording, distinct
    kinds = (["browse"] * 42 + ["shop"] * 22 + ["typo"] * 5 + ["forgot"] * 2 + ["checkout"] * 8
             + ["signup"] * 6 + ["feedback"] * 3 + ["complaint"] * 2)
    # The long visits (checkout, sign-up, forms) start early enough to finish inside the ten minutes.
    timed = sorted((rng.uniform(0, LONG_BY_S if k in LONG else WINDOW_S), k) for k in kinds)
    starts, kinds = [t for t, _ in timed], [k for _, k in timed]
    starts[0] = 0.5
    # Every address shows up at least once; the rest are returning browsers on the same address.
    order = hosts + [rng.choice(hosts) for _ in range(len(kinds) - len(hosts))]
    rng.shuffle(order)
    sessions, taken = [], 0
    for i, (kind, start, host) in enumerate(zip(kinds, starts, order)):
        who = None
        if kind in ("shop", "typo", "forgot", "checkout", "feedback", "complaint"):
            who, taken = seeded[taken], taken + 1
        sessions.append({"n": i, "kind": kind, "start": start, "ip": f"203.0.113.{host}",
                         "agent": agent_of[host], "who": who})
    return sessions


def signup_identity(n):
    rng = random.Random(f"{SEED}-signup-{n}")
    first = rng.choice(["noah", "liv", "theo", "mila", "arlo", "iris", "kai", "luna", "remy", "sana"])
    last = rng.choice(["hartley", "moreau", "lindqvist", "osei", "petrov", "tremblay", "byrne", "kowalski"])
    return f"{first}.{last}{rng.randint(10, 99)}@{rng.choice(['example.com', 'example.net', 'example.org'])}", \
        f"{last.title()}{rng.randint(1000, 9999)}!{first}"


def typo(password, rng):
    i = rng.randrange(len(password))
    return password[:i] + rng.choice("asdfjkl;0") + password[i + 1:]


def browse_a_bit(v, rng, views=(1, 4), searches=(0, 2)):
    for _ in range(rng.randint(*searches)):
        v.think(3, 10)
        v.search(rng.choice(SEARCHES))
    for _ in range(rng.randint(*views)):
        v.think(4, 15)
        v.view_product()


def run(shop, s, seen, seen_lock):
    rng = random.Random(f"{SEED}-{s['n']}")
    v = Visitor(shop, s["ip"], s["agent"], rng)
    with seen_lock:
        first = s["ip"] not in seen
        seen.add(s["ip"])
    v.page_load(first)
    kind, who = s["kind"], s["who"]
    if kind == "browse":
        browse_a_bit(v, rng, views=(1, 5), searches=(0, 3))
        if rng.random() < 0.3:
            v.think(3, 8)
            v.add_to_basket(rng.choice(v.products))   # a guest basket, then they leave
        return
    if kind == "signup":
        browse_a_bit(v, rng, views=(0, 2), searches=(0, 1))
        email, password = signup_identity(s["n"])
        v.think(3, 8)
        _, questions = v.call("GET", "/api/SecurityQuestions/")
        question = rng.choice(questions["data"])
        v.think(25, 50)      # filling the form
        status, user = v.call("POST", "/api/Users/", {
            "email": email, "password": password, "passwordRepeat": password,
            "securityQuestion": question, "securityAnswer": rng.choice(QUESTION_ANSWERS)})
        if status == 201:
            v.call("POST", "/api/SecurityAnswers/", {"UserId": user["data"]["id"], "answer": rng.choice(QUESTION_ANSWERS),
                                                    "SecurityQuestionId": question["id"]})
            v.think(6, 15)
            if v.login(email, password):
                browse_a_bit(v, rng, views=(1, 3), searches=(0, 1))
                if rng.random() < 0.5:
                    v.add_to_basket(rng.choice(v.products))
        return
    # Everyone else is a seeded customer who signs in.
    browse_a_bit(v, rng, views=(0, 2), searches=(0, 2))
    v.think(8, 20)
    if kind == "forgot":
        for _ in range(rng.randint(2, 3)):
            v.login(who["email"], typo(who["password"], rng))
            v.think(5, 12)
        return   # gives up
    if kind == "typo":
        v.login(who["email"], typo(who["password"], rng))
        v.think(4, 10)
    if not v.login(who["email"], who["password"]):
        print(f"login failed for {who['email']}", file=sys.stderr)
        return
    if kind == "feedback":
        v.think(5, 15)
        v.feedback(*FEEDBACK[s["n"] % len(FEEDBACK)])
    elif kind == "complaint":
        v.think(5, 15)
        v.complaint(*COMPLAINTS[s["n"] % len(COMPLAINTS)])
    else:
        browse_a_bit(v, rng, views=(1, 3), searches=(0, 2))
        for _ in range(rng.randint(1, 3) if kind != "typo" else 1):
            v.think(4, 12)
            v.add_to_basket(rng.choice(v.products))
        if kind == "checkout":
            v.think(4, 10)
            v.checkout(full_name(who["email"]))
    if rng.random() < 0.4:
        v.think(5, 20)
        v.logout()


STATUS = {}
STATUS_LOCK = threading.Lock()


def tally(status):
    with STATUS_LOCK:
        STATUS[status] = STATUS.get(status, 0) + 1


def main(shop):
    sessions = plan()
    seen, seen_lock = set(), threading.Lock()
    began = time.monotonic()
    threads = []
    for s in sessions:
        delay = s["start"] * SCALE - (time.monotonic() - began)
        if delay > 0:
            time.sleep(delay)
        t = threading.Thread(target=run, args=(shop, s, seen, seen_lock), daemon=True)
        t.start()
        threads.append(t)
    for t in threads:
        t.join()
    kinds = {}
    for s in sessions:
        kinds[s["kind"]] = kinds.get(s["kind"], 0) + 1
    print(json.dumps({"sessions": len(sessions), "kinds": kinds, "sources": len({s['ip'] for s in sessions}),
                      "statuses": dict(sorted(STATUS.items())), "seconds": round(time.monotonic() - began)}))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1].rstrip("/"))
