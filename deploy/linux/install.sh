#!/usr/bin/env bash
set -euo pipefail
[[ $(id -u) = 0 ]] || { echo 'Run with sudo'; exit 1; }
cd -- "$(dirname -- "$0")"
version=$(cat VERSION); [[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
install -d /opt/rally/releases /etc/rally
if [[ ! -e /etc/rally/server.env ]]; then
 printf '%s\n' 'RALLY_HOST=127.0.0.1' 'RALLY_PORT=4711' > /etc/rally/server.env
 chmod 0644 /etc/rally/server.env
fi
target=/opt/rally/releases/$version
[[ ! -e $target ]] || { echo "Version already installed: $target"; exit 1; }
for account in rally-runtime rally-control; do
  id "$account" >/dev/null 2>&1 || useradd --system --user-group --no-create-home --shell /usr/sbin/nologin "$account"
done
umask 077
for entry in admin:rally-control vault:rally-runtime; do
 name=${entry%:*}; group=${entry#*:}; file=/etc/rally/$name.key
 if [[ ! -e $file ]]; then ./bin/node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))' > "$file"; fi
 chown "root:$group" "$file"; chmod 0640 "$file"
done
umask 022
install -d "$target"; cp -a bin lib src node_modules packages package.json VERSION LICENSE THIRD_PARTY_NOTICES "$target/"; chown -R root:root "$target"; chmod -R go-w "$target"
previous=$(readlink -f /opt/rally/current || true)
if [[ -L /opt/rally/current ]]; then
 systemctl stop rally-control rally-runtime
 install -d -m 0700 /var/backups/rally
 tar -czf "/var/backups/rally/pre-$version-$(date +%s).tar.gz" -C / etc/rally var/lib/rally var/lib/rally-control
fi
install -m 0644 rally-{runtime,control}.service /etc/systemd/system/
ln -sfn "$target" /opt/rally/.current-new; mv -Tf /opt/rally/.current-new /opt/rally/current
systemctl daemon-reload; systemctl enable --now rally-runtime rally-control
port=$(sed -n 's/^RALLY_PORT=\([0-9]*\)$/\1/p' /etc/rally/server.env | tail -1)
port=${port:-4711}
for _ in {1..40}; do
 if curl -fsS --unix-socket /run/rally-runtime/service.sock -H 'Content-Type: application/json' -d '{"channel":"tasks:state","args":[]}' http://localhost/v1/rpc >/dev/null 2>&1 && curl -fsS "http://127.0.0.1:$port/health" >/dev/null 2>&1; then
  echo 'Ready. Listener: /etc/rally/server.env. Read /etc/rally/admin.key locally to sign in.'; exit 0
 fi
 sleep 1
done
echo "Not ready. Inspect journalctl -u rally-runtime -u rally-control. Previous release: $previous" >&2; exit 1
