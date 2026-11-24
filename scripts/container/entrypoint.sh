#!/bin/sh
# The Fly image's entrypoint (docs/HOSTING.md, D-201). A Fly volume is mounted at /data owned by root, and the
# server runs as the non-root `node` user, so this runs as root first: it makes the two folders written at run time
# (the counters' folder, KI-193, and kiro-cli's data folder, where `kiro-cli login` keeps its session) and hands
# them to `node`, then drops to `node` for the server itself. Started as a non-root user already (`docker run
# --user`), it just runs the command.
set -eu
RUNTIME_USER="${RUNTIME_USER:-node}"
dirs=""
[ -n "${KIRO_STATE_FILE:-}" ] && dirs="$dirs $(dirname "$KIRO_STATE_FILE")"
[ -n "${XDG_DATA_HOME:-}" ] && dirs="$dirs $XDG_DATA_HOME"
if [ "$(id -u)" = "0" ]; then
  if [ -n "$dirs" ]; then
    # shellcheck disable=SC2086
    mkdir -p $dirs && chown -R "$RUNTIME_USER:$RUNTIME_USER" $dirs
  fi
  home="$(getent passwd "$RUNTIME_USER" | cut -d: -f6)"
  exec setpriv --reuid="$RUNTIME_USER" --regid="$RUNTIME_USER" --init-groups env HOME="${home:-/home/$RUNTIME_USER}" "$@"
fi
exec "$@"
