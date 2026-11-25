#!/usr/bin/env bash
# Run in a disposable CI checkout after building packages. Do not prune the developer checkout.
set -euo pipefail
[[ $(uname -s) = Linux ]]
ver=$(node -p 'require("./package.json").version'); arch=$(node -p 'process.arch')
stage=$(mktemp -d /tmp/rally-package.XXXXXX)
trap 'rm -rf -- "$stage"' EXIT
bundle="$stage/rally-server-$ver"; mkdir -p "$bundle/bin" "$bundle/packages" release
cp package{,-lock}.json "$bundle/"; mkdir -p "$bundle/packages"
for pkg in packages/*; do
 [[ -f $pkg/package.json ]] || continue
 dest="$bundle/$pkg"; mkdir -p "$dest"; cp "$pkg/package.json" "$dest/"; cp -a "$pkg/dist" "$dest/"; if [[ -d $pkg/schemas ]]; then cp -a "$pkg/schemas" "$dest/"; fi
 if [[ -f $pkg/LICENSE ]]; then cp "$pkg/LICENSE" "$dest/"; fi
done
(cd "$bundle" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund)
(cd "$bundle" && PLAYWRIGHT_BROWSERS_PATH="$bundle/browser" node node_modules/playwright/cli.js install chromium --only-shell)
cp -a out/server/src "$bundle/"
cp -a skills "$bundle/skills"
test -f "$bundle/skills/SKILL.md"
for reference in identity.md coach.md model-provider.md media-search.md mcp.md skills.md roles.md external-agents.md; do
 test -f "$bundle/skills/references/$reference"
done
cp -a LICENSE THIRD_PARTY_NOTICES "$bundle/"
cp -a deploy/linux/* "$bundle/"
node_root=$(dirname "$(dirname "$(readlink -f "$(command -v node)")")")
cp "$node_root/bin/node" "$bundle/bin/node"
cp "$node_root/LICENSE" "$bundle/bin/NODE-LICENSE"
mkdir -p "$bundle/lib/node_modules"
cp -a "$node_root/lib/node_modules/npm" "$bundle/lib/node_modules/"
ln -s ../lib/node_modules/npm/bin/npm-cli.js "$bundle/bin/npm"
ln -s ../lib/node_modules/npm/bin/npx-cli.js "$bundle/bin/npx"
bash scripts/cloud/install-gh.sh "$bundle"
printf '%s\n' "$ver" > "$bundle/VERSION"
chmod +x "$bundle/install.sh"
chmod -R a+rX "$bundle"
node --test tests/process-identity.test.mjs
RALLY_TEST_SERVER="$bundle" node --test tests/cloud/linux-tools.test.mjs
PLAYWRIGHT_BROWSERS_PATH="$bundle/browser" RALLY_TEST_BROWSER_ROOT="$bundle" node --test tests/agent-browser/linux-package.test.mjs
RALLY_TEST_SERVER="$bundle" node --test tests/cloud/server.test.mjs
RALLY_TEST_SERVER="$bundle" node --test tests/cloud/agent.test.mjs
RALLY_TEST_SERVER="$bundle" node --test tests/attachments/cloud.test.mjs
RALLY_TEST_SERVER="$bundle" node --test tests/attachments/agent.test.mjs
archive="release/rally-server-$ver-linux-$arch.tar.gz"; tar -czf "$archive" -C "$stage" "rally-server-$ver"; echo "$archive"
