#!/usr/bin/env bash
# MIN-01 variant a: one wave of an internet-wide exploit scanner looking for WordPress, PHP and leaked
# config files, one request each, a zgrab user agent. Runs inside the rig's tools container only.
# tool: curl 8.x
# label: crawler wave: 24 PHP/WordPress/config probes, zgrab user agent
set -eu
for path in /wp-admin/ /wp-login.php /xmlrpc.php /wp-config.php.bak /wp-content/plugins/ /.env /.env.backup \
  /.git/config /phpmyadmin/ /pma/ /admin.php /config.php /info.php /phpinfo.php /.aws/credentials \
  /vendor/phpunit/phpunit/src/Util/PHP/eval-stdin.php /cgi-bin/luci /actuator/env /server-status \
  /backup.zip /db.sql /.DS_Store /owa/auth/logon.aspx /api/.env; do
  curl -s -o /dev/null -A 'Mozilla/5.0 zgrab/0.x' -w "%{http_code} $path\n" "http://10.66.0.10$path"
done
