# What normal looks like

Learn this page. During an incident, the fastest way to spot an attacker is to notice what **isn't** normal.

## A normal access log line

```
198.51.100.23 - - [21/Nov/2026:02:14:07 +0000] "GET /rest/products/search?q=apple HTTP/1.1" 200 1532 "https://shop.example/" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) …"
```

Reading it left to right: **who** (address) · **when** · **what they asked for** · **status code** · **response size in bytes** · **where they came from** · **their browser (user agent)**.

## Normal, at night

| Signal | Normal | Worth a look |
|---|---|---|
| Status codes | Mostly `200`; a few `304` and `404` | Bursts of `404` (someone guessing paths), many `401` on login (password guessing), any `500` (the app is breaking) |
| Search queries | Words: `apple`, `juice`, `banana` | Quotes, brackets, `UNION`, `SELECT`, `--`: someone talking to the database through the search box |
| Logins | A handful an hour, almost all succeed | Many failures from one address, or failures for many different accounts |
| User agents | Real browsers (`Mozilla/5.0 …`) | Tools that name themselves: `sqlmap`, `Fuzz Faster U Fool`, `python-requests`, `Hydra` |
| App log | Quiet | Any `SQLITE_ERROR` or stack trace |
| New accounts | A few customers sign up | Any new account with a role other than customer |
| Uploads | Rare, small PDFs with complaints | Archives (`.zip`) or files with strange names |

## Background noise you will see

The shop is on the internet, so bots knock all night: scanners looking for WordPress (`/wp-admin`), password-guessing bots, scrapers. Most of it is harmless on its own, but left alone it adds up, and it can hide something worse.
