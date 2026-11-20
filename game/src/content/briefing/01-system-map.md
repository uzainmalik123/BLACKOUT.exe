# System map

**Juice Shop**: the company's online store. One server, one app, one database. You are the only defender on shift tonight.

```
 customers ──▶  nginx (web server, :80)  ──▶  Juice Shop app (Node.js)  ──▶  SQLite database
                logs every request              logs errors                    customers, orders,
                                                                               products
```

## What runs where

| Part | Where | Notes |
|---|---|---|
| Web server | nginx, in front of everything | Every request is logged here. If nginx stops, the whole shop is offline |
| The shop | Juice Shop app behind nginx | Writes its own error log |
| Database | `/srv/juice-shop/data/juiceshop.sqlite` | 312 customers, 56 products, every order and address |
| Customer uploads | `/srv/juice-shop/uploads/` | Files customers send with complaints |
| Firewall | `iptables` on the server | Empty tonight: no addresses blocked |
| Web application firewall | WAF console | No rules switched on |

## Logs

| Log | Path | What's in it |
|---|---|---|
| Access log | `/var/log/nginx/access.log` | One line per request: address, time, request, status code, size, user agent |
| App log | `/var/log/juice-shop/app.log` | Errors from the shop, with stack traces |

## The public parts of the site

| Feature | Address | Can be switched off in |
|---|---|---|
| Product search | `/rest/products/search?q=…` | Feature flags |
| Login | `/rest/user/login` | (always on) |
| Sign-up | `/api/Users` | Feature flags (registration) |
| Password reset | `/rest/user/reset-password` | Feature flags |
| Complaint uploads | `/file-upload` | Feature flags (uploads) |
| Public documents folder | `/ftp` | Feature flags |
| Customer feedback | `/api/Feedbacks` | Feature flags (feedback CAPTCHA) |

## Backups

A backup of the database and uploads is taken **every hour**, on the hour. Restoring one rolls everything back to that moment, good and bad.
