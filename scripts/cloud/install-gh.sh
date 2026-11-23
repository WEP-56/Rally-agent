#!/usr/bin/env bash
# Install the pinned CLI into a Linux release staging directory.
set -euo pipefail
[[ $(uname -s) = Linux && $(uname -m) = x86_64 ]]
bundle=${1:?Usage: install-gh.sh BUNDLE_DIRECTORY}
version=2.105.0
archive="gh_${version}_linux_amd64"
sha256=79e7ab5db738c48777b696e374f8b428f0647debfb424f44d2f426370407fe2f
stage=$(mktemp -d /tmp/rally-gh.XXXXXX)
trap 'rm -rf -- "$stage"' EXIT
curl -fsSL --connect-timeout 30 --max-time 180 "https://github.com/cli/cli/releases/download/v${version}/${archive}.tar.gz" -o "$stage/gh.tar.gz"
printf '%s  %s\n' "$sha256" "$stage/gh.tar.gz" | sha256sum -c -
tar -xzf "$stage/gh.tar.gz" -C "$stage" "$archive/bin/gh" "$archive/LICENSE"
mkdir -p "$bundle/bin"
install -m 755 "$stage/$archive/bin/gh" "$bundle/bin/gh"
install -m 644 "$stage/$archive/LICENSE" "$bundle/bin/GH-LICENSE"
"$bundle/bin/gh" --version
