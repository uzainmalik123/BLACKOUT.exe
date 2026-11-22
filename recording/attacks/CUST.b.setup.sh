#!/usr/bin/env bash
# CUST.b's setup (KI-82): the five shoppers who reset their password set a security answer long ago, when
# they signed up. Straight at the shop, before the window, so it isn't in the recording (D-25).
set -eu
python3 /attacks/lib/shoppers.py setup-b http://10.66.0.20:3000
