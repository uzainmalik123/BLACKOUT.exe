#!/usr/bin/env bash
# CUST variant c (SYS-23, D-237): about two minutes of ordinary shoppers, not an attack, whose searches and
# feedback hold quotes (dad's juice, O'Brien, "apple juice", "didn't"): the customers a naive SQLi rule set
# flags, the false positives of a WAF rule. 16 visits from 12 addresses (X-Forwarded-For, D-27), real browser
# user agents. The shop's search is injectable, so an apostrophe really answers 500; the shopper retries
# without it. Deterministic (fixed seed). Runs inside the rig's tools container only.
# tool: python3 urllib (lib/shoppers.py)
# label: ordinary customers: ~2 min, 16 visits from 12 addresses, quotes in searches and feedback, browser user agents
set -eu
python3 /attacks/lib/shoppers.py http://10.66.0.10 c
