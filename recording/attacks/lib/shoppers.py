"""Ordinary shoppers (docs/PRD.md REC-06, D-60, D-61). Runs inside the rig's tools container only.

    python3 shoppers.py <shop URL> [a|b|c]  e.g. http://10.66.0.10 (through nginx, so it's logged); a by default
    python3 shoppers.py setup-b <shop URL> CUST.b's setup, straight at the shop before the window (not logged)

Variant a (CUST.a): about ten minutes of customers using the shop the way its own Angular front-end does: page loads,
the product list, product details and reviews, searches, guest baskets, logins (a few typos and a
couple of forgotten passwords), baskets, the full checkout, sign-ups, feedback (with the shop's
CAPTCHA, solved as a person reads it) and complaints with a small real PDF. No attack payloads.

Variant b (CUST.b, KI-82): about three minutes of the same kind of shoppers, plus the two things a
shopper does that CUST.a never shows: forgot-password (the security question looked up as the email is
typed, a mistyped answer, then the right one, then a login with the new password; one gives up) and
/ftp (the About page's "Terms of Use" link to /ftp/legal.md; one curious shopper opens /ftp itself).
Its setup gives the reset shoppers the security answer they set long ago, outside the recording.

Variant c (CUST.c, SYS-23, D-237): about two minutes of the same kind of shoppers whose searches and feedback
hold quotes, the way people write: `dad's juice`, `O'Brien`, `"apple juice"`, feedback with "didn't" in it.
They are what a naive SQLi rule set flags (the false positives of a WAF rule). The shop's own search is
injectable, so an apostrophe in a search really answers 500 (SQLITE_ERROR); the shopper then tries again
without it, as people do.

Each visitor is named in X-Forwarded-For (trusted from the tools box only, D-27), always inside
203.0.113.0/24 and never on an address a Death or minion recording uses. Every choice comes from a
fixed seed, so the same people do the same things every run; only the server's own ids and
the exact millisecond timings differ. CUST_SCALE (default 1) multiplies every wait, for quick tests.
"""
import http.client
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

# CUST.b (KI-82): its own seed, a shorter window, and the addresses added since CUST.a (D-46, D-63) kept clear too.
SEED_B = 6110
WINDOW_B_S = 150      # sessions start in the first 150 s; the last ones finish by about 180 s
LONG_BY_B_S = 100
ATTACKER_HOSTS_B = ATTACKER_HOSTS | {13, 85, 86, 88, 90, 96, 97}
SOURCES_B = 20
SEED_C = 6120
WINDOW_C_S = 90       # sessions start in the first 90 s; the last ones finish by about 120 s
LONG_BY_C_S = 45
ATTACKER_HOSTS_C = ATTACKER_HOSTS_B | {26, 45}
SOURCES_C = 12
ABOUT_CHUNK = "/about.component-HWmrgSem.js"   # v20.4.0's lazy chunk for the About page (its name is in main.js)
CAROUSEL = [f"/assets/public/images/carousel/{n}" for n in ("1.jpg", "2.jpg", "3.jpg", "4.jpg", "5.png", "6.jpg", "7.jpg")]

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

# CUST.c: what people type with quotes in it, and what they try next when the shop errors.
QUOTED_SEARCHES = [("dad's juice", "dads juice"), ("O'Brien", "Brien"), ("kid's t-shirt", "kids t-shirt"),
                   ("children's juice", "childrens juice"), ("lemon 'n' lime", "lemon lime"), ("chef's apron", "apron"),
                   ("Valentine's", "valentine"), ("people's choice", "best seller")]
DOUBLE_QUOTED = ['"apple juice"', '"green smoothie"', '"fruit press"']
QUOTED_FEEDBACK = [
    ("Didn't expect the banana juice to be this good. My kids' new favourite!", 5),
    ("The \"Best Juice Shop\" mug arrived chipped, but you've replaced it already. Thanks!", 4),
]


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
                status = res.status
                try:
                    payload = res.read()
                except http.client.IncompleteRead as short:
                    payload = short.partial   # Juice Shop's directory listings announce more bytes than they send
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

    def forgot_password(self, email, answers, new):
        """The forgot-password page: the question is looked up once the email is typed, then each answer is tried."""
        self.think(6, 14)     # typing the email
        self.call("GET", "/rest/user/security-question?email=" + urllib.parse.quote(email, safe="@"))  # the front-end appends it as typed
        for answer in answers:
            self.think(10, 25)   # answer, new password, again
            status, _ = self.call("POST", "/rest/user/reset-password", {"email": email, "answer": answer, "new": new, "repeat": new})
            if status == 200:
                return True
        return False

    def about(self, first_visit):
        """The About Us page: its lazy chunk, the config, the feedback carousel (and its pictures, the first time)."""
        if first_visit:
            self.call("GET", ABOUT_CHUNK)
        self.call("GET", "/rest/admin/application-configuration")
        self.call("GET", "/api/Feedbacks/")
        if first_visit:
            for image in CAROUSEL:
                self.call("GET", image)

    def terms(self):
        """The About page's "Terms of Use" link: /ftp/legal.md, opened in a new tab."""
        self.call("GET", "/ftp/legal.md")


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


# --- CUST.b (KI-82): password resets and /ftp ---------------------------------------------------

def answer_typo(answer, rng):
    """How people get their own security answer wrong: the wrong case, or a slipped letter."""
    if rng.random() < 0.5 and answer.lower() != answer:
        return answer.lower()
    return typo(answer, rng)


def plan_b():
    """CUST.b's sessions; the reset shoppers carry the question and answer their setup gives them."""
    rng = random.Random(SEED_B)
    hosts = rng.sample([h for h in range(2, 128) if h not in ATTACKER_HOSTS_B], SOURCES_B)
    agent_of = {h: rng.choice(AGENTS) for h in hosts}
    seeded = rng.sample(customers(), 12)
    kinds = ["browse"] * 9 + ["shop"] * 4 + ["checkout"] * 1 + ["reset"] * 5 + ["about"] * 4 + ["ftp"] * 1
    timed = sorted((rng.uniform(0, LONG_BY_B_S if k in ("checkout", "reset") else WINDOW_B_S), k) for k in kinds)
    starts, kinds = [t for t, _ in timed], [k for _, k in timed]
    starts[0] = 0.5
    order = hosts + [rng.choice(hosts) for _ in range(len(kinds) - len(hosts))]
    rng.shuffle(order)
    sessions, taken, resets = [], 0, 0
    for i, (kind, start, host) in enumerate(zip(kinds, starts, order)):
        who = None
        if kind in ("shop", "checkout", "reset"):
            who, taken = dict(seeded[taken]), taken + 1
        if kind == "reset":
            who["question"] = rng.randint(1, 14)
            who["answer"] = rng.choice(QUESTION_ANSWERS)
            who["new"] = f"{rng.choice(STREETS).split()[0]}{rng.randint(1000, 9999)}!"
            who["gives_up"] = resets == 4      # one of the five never gets it and leaves
            resets += 1
        sessions.append({"n": i, "kind": kind, "start": start, "ip": f"203.0.113.{host}",
                         "agent": agent_of[host], "who": who})
    return sessions


def setup_b(shop):
    """Before CUST.b's window: each reset shopper's security answer, as they set it when they signed up."""
    for s in plan_b():
        who = s["who"]
        if s["kind"] != "reset":
            continue
        body = json.dumps({"email": who["email"], "password": who["password"]}).encode()
        req = urllib.request.Request(f"{shop}/rest/user/login", body, {"Content-Type": "application/json"})
        with urllib.request.urlopen(req) as res:
            token = json.loads(res.read())["authentication"]["token"]
        req = urllib.request.Request(f"{shop}/rest/user/whoami?fields=id", headers={"Authorization": f"Bearer {token}", "Cookie": f"token={token}"})
        with urllib.request.urlopen(req) as res:
            uid = json.loads(res.read())["user"]["id"]
        body = json.dumps({"UserId": uid, "answer": who["answer"], "SecurityQuestionId": who["question"]}).encode()
        req = urllib.request.Request(f"{shop}/api/SecurityAnswers/", body, {"Content-Type": "application/json"})
        with urllib.request.urlopen(req) as res:
            if res.status != 201:
                sys.exit(f"setup failed for {who['email']}: HTTP {res.status}")
    print("set the security answers of the reset shoppers")


def run_b(shop, s, seen, seen_lock):
    rng = random.Random(f"{SEED_B}-{s['n']}")
    v = Visitor(shop, s["ip"], s["agent"], rng)
    with seen_lock:
        first = s["ip"] not in seen
        seen.add(s["ip"])
    v.page_load(first)
    kind, who = s["kind"], s["who"]
    if kind == "browse":
        browse_a_bit(v, rng, views=(1, 5), searches=(0, 3))
        return
    if kind in ("about", "ftp"):
        browse_a_bit(v, rng, views=(0, 2), searches=(0, 1))
        v.think(4, 10)
        v.about(first)
        v.think(10, 30)      # reading about the shop
        v.terms()
        if kind == "ftp":    # curious: what else is in that folder?
            v.think(8, 20)
            v.call("GET", "/ftp")
            v.think(5, 12)
            v.terms()
        return
    browse_a_bit(v, rng, views=(0, 2), searches=(0, 2))
    v.think(8, 20)
    if kind == "reset":
        v.login(who["email"], typo(who["password"], rng))   # can't remember it, then the "Forgot your password?" link
        v.think(4, 10)
        tries = [answer_typo(who["answer"], rng)] * (2 if who["gives_up"] else 1)
        tries = tries if who["gives_up"] else tries + [who["answer"]]
        if not v.forgot_password(who["email"], tries, who["new"]):
            return   # gives up
        v.think(4, 10)
        if not v.login(who["email"], who["new"]):
            print(f"login after reset failed for {who['email']}", file=sys.stderr)
            return
        browse_a_bit(v, rng, views=(1, 2), searches=(0, 1))
        if rng.random() < 0.5:
            v.think(4, 12)
            v.add_to_basket(rng.choice(v.products))
        return
    if not v.login(who["email"], who["password"]):
        print(f"login failed for {who['email']}", file=sys.stderr)
        return
    browse_a_bit(v, rng, views=(1, 3), searches=(0, 2))
    for _ in range(rng.randint(1, 3)):
        v.think(4, 12)
        v.add_to_basket(rng.choice(v.products))
    if kind == "checkout":
        v.think(4, 10)
        v.checkout(full_name(who["email"]))


# --- CUST.c (SYS-23): quotes in searches and feedback -------------------------------------------

def plan_c():
    """CUST.c's sessions: plain browsers, shoppers who type a quote into search, and two who leave feedback."""
    rng = random.Random(SEED_C)
    hosts = rng.sample([h for h in range(2, 128) if h not in ATTACKER_HOSTS_C], SOURCES_C)
    agent_of = {h: rng.choice(AGENTS) for h in hosts}
    seeded = rng.sample(customers(), 4)
    kinds = ["browse"] * 4 + ["quoted"] * 8 + ["exact"] * 2 + ["feedback"] * 2
    timed = sorted((rng.uniform(0, LONG_BY_C_S if k == "feedback" else WINDOW_C_S), k) for k in kinds)
    starts, kinds = [t for t, _ in timed], [k for _, k in timed]
    starts[0] = 0.5
    order = hosts + [rng.choice(hosts) for _ in range(len(kinds) - len(hosts))]
    rng.shuffle(order)
    sessions, taken, quoted, fed = [], 0, 0, 0
    for i, (kind, start, host) in enumerate(zip(kinds, starts, order)):
        s = {"n": i, "kind": kind, "start": start, "ip": f"203.0.113.{host}", "agent": agent_of[host], "who": None}
        if kind == "quoted":
            s["query"], quoted = QUOTED_SEARCHES[quoted % len(QUOTED_SEARCHES)], quoted + 1
        if kind == "feedback":
            s["who"], taken = seeded[taken], taken + 1
            s["feedback"], fed = QUOTED_FEEDBACK[fed % len(QUOTED_FEEDBACK)], fed + 1
        sessions.append(s)
    return sessions


def run_c(shop, s, seen, seen_lock):
    rng = random.Random(f"{SEED_C}-{s['n']}")
    v = Visitor(shop, s["ip"], s["agent"], rng)
    with seen_lock:
        first = s["ip"] not in seen
        seen.add(s["ip"])
    v.page_load(first)
    kind = s["kind"]
    if kind == "browse":
        browse_a_bit(v, rng, views=(1, 3), searches=(1, 2))
        return
    if kind == "quoted":
        typed, retry = s["query"]
        v.think(3, 8)
        status, _ = v.call("GET", "/rest/products/search?q=" + urllib.parse.quote(typed))
        if status >= 500:            # the shop shows an error; they try again without the apostrophe
            v.think(4, 9)
            v.search(retry)
        v.think(4, 12)
        v.view_product()
        return
    if kind == "exact":
        v.think(3, 8)
        v.search(rng.choice(DOUBLE_QUOTED))
        v.think(4, 12)
        v.view_product()
        return
    who = s["who"]                   # feedback: a seeded customer signs in and writes a line with quotes in it
    v.think(5, 12)
    if not v.login(who["email"], who["password"]):
        print(f"login failed for {who['email']}", file=sys.stderr)
        return
    v.think(3, 8)
    v.feedback(*s["feedback"])


STATUS = {}
STATUS_LOCK = threading.Lock()


def tally(status):
    with STATUS_LOCK:
        STATUS[status] = STATUS.get(status, 0) + 1


def main(shop, variant="a"):
    sessions, runner = {"a": (plan(), run), "b": (plan_b(), run_b), "c": (plan_c(), run_c)}[variant]
    seen, seen_lock = set(), threading.Lock()
    began = time.monotonic()
    threads = []
    for s in sessions:
        delay = s["start"] * SCALE - (time.monotonic() - began)
        if delay > 0:
            time.sleep(delay)
        t = threading.Thread(target=runner, args=(shop, s, seen, seen_lock), daemon=True)
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
    if sys.argv[1:2] == ["setup-b"] and len(sys.argv) == 3:
        setup_b(sys.argv[2].rstrip("/"))
    elif len(sys.argv) == 2 or (len(sys.argv) == 3 and sys.argv[2] in ("a", "b", "c")):
        main(sys.argv[1].rstrip("/"), sys.argv[2] if len(sys.argv) == 3 else "a")
    else:
        sys.exit(__doc__)
