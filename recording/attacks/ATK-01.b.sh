#!/usr/bin/env bash
# ATK-01 variant b: the quiet scan (D-46, KI-77). ATK-01.a's ffuf scan of the shop's root with the same
# SecLists common.txt and auto-calibration, but sending a normal browser's user agent and held to about
# 40 requests a second on 2 threads, so it takes about two minutes instead of 13 s and a rule for ffuf's
# name doesn't match it. Runs inside the rig's tools container only (recording/record.sh).
# tool: ffuf 2.1.0
# label: quiet: ffuf root scan, common.txt, browser user agent, 40 requests a second
set -eu
ffuf -u http://10.66.0.10/FUZZ -w /wordlists/common.txt -ac -s -t 2 -rate 40 \
  -H 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
