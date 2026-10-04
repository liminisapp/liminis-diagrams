#!/usr/bin/env bash
#
# One-time bootstrap: reserve @liminis/diagrams on npm so that trusted
# publishing can be configured for it.
#
# Why this exists
# ---------------
# The release workflow authenticates by npm trusted publishing (OIDC), which is
# configured from a package's own settings page on npmjs.com. That page does not
# exist until the package does, so a name that has never been published cannot
# have a trusted publisher registered. The first publish therefore cannot use
# OIDC, and has to be a manual one.
#
# This script makes that first publish a deliberately empty 0.0.0 stub rather
# than the real 0.1.0. That matters: npm provenance can only be produced by a CI
# publish from a public repository, so a hand-published 0.1.0 would permanently
# lack provenance -- and 0.1.0 is the version people actually install. Reserving
# the name with a stub keeps the real release on the workflow, with attestation
# intact.
#
# It publishes from a temporary directory, never from the repository. Running
# `npm publish` in the repo would fire `prepack` (building and shipping the real
# dist/ under a junk version number) and hit the LIMINIS_ALLOW_PUBLISH guard.
#
# Usage
# -----
#     ./scripts/bootstrap-npm-name.sh
#
# Safe to re-run: it stops if the name is already taken and tells you by whom.

set -euo pipefail

PKG="@liminis/diagrams"
STUB_VERSION="0.0.0"
REPO_URL="https://github.com/liminisapp/liminis-diagrams"
GH_OWNER="liminisapp"
GH_REPO="liminis-diagrams"
WORKFLOW="publish.yml"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
fail() { printf '\033[31mERROR:\033[0m %s\n' "$1" >&2; exit 1; }
ok()   { printf '\033[32m  ok\033[0m  %s\n' "$1"; }

bold "Preflight"

command -v npm >/dev/null 2>&1 || fail "npm is not on PATH."
ok "npm $(npm --version), node $(node --version)"

if ! WHO=$(npm whoami 2>/dev/null); then
  fail "Not logged in to npm. Run 'npm login' first, then re-run this script."
fi
ok "logged in as $WHO"

REGISTRY_PATH=$(printf '%s' "$PKG" | sed 's|/|%2F|')
STATUS=$(curl -s -o /dev/null -w '%{http_code}' "https://registry.npmjs.org/${REGISTRY_PATH}")

if [ "$STATUS" = "200" ]; then
  MAINTAINERS=$(curl -s "https://registry.npmjs.org/${REGISTRY_PATH}" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const d=JSON.parse(s);console.log((d.maintainers||[]).map(m=>m.name).join(", "))}catch{console.log("unknown")}})')
  printf '\n'
  bold "$PKG already exists on npm (maintainers: ${MAINTAINERS})."
  if printf '%s' "$MAINTAINERS" | grep -qw "$WHO"; then
    echo "You already own it, so the name is reserved and step 1 is done."
    echo "Skip to 'Next steps' below."
    SKIP_PUBLISH=1
  else
    fail "The name is taken by someone else. Stop and pick a different package name."
  fi
elif [ "$STATUS" = "404" ]; then
  ok "$PKG is available"
  SKIP_PUBLISH=0
else
  fail "Unexpected response from the npm registry (HTTP $STATUS). Try again later."
fi

if [ "$SKIP_PUBLISH" = "0" ]; then
  printf '\n'
  bold "Publishing the ${STUB_VERSION} placeholder"

  WORKDIR=$(mktemp -d "${TMPDIR:-/tmp}/liminis-diagrams-stub.XXXXXX")
  trap 'rm -rf "$WORKDIR"' EXIT
  ok "temp dir $WORKDIR"

  cat > "$WORKDIR/package.json" <<JSON
{
  "name": "$PKG",
  "version": "$STUB_VERSION",
  "description": "Placeholder reserving the name. Real releases start at 0.1.0.",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+${REPO_URL}.git"
  },
  "homepage": "$REPO_URL"
}
JSON

  cat > "$WORKDIR/README.md" <<MD
# $PKG

Placeholder reserving the name on npm. It contains no code.

The first real release is 0.1.0, published from CI with provenance.
See ${REPO_URL}.
MD

  echo
  echo "About to publish ${PKG}@${STUB_VERSION} with dist-tag 'placeholder'."
  echo "npm will prompt for your 2FA one-time code."
  echo "This cannot be undone after 72 hours, and the name is claimed permanently."
  echo
  printf 'Continue? [y/N] '
  if ! read -r REPLY; then
    printf '\n'
    echo "No input available -- this script must be run from an interactive"
    echo "terminal, not a pipe or a non-interactive runner."
    echo "Nothing was published."
    exit 1
  fi
  case "$REPLY" in
    [yY]*) ;;
    *) echo "Aborted. Nothing was published."; exit 0 ;;
  esac

  # --tag placeholder does NOT keep the stub off `latest` on a *first* publish:
  # npm sets `latest` to the first version regardless, so both tags end up
  # pointing at 0.0.0 and `npm install @liminis/diagrams` returns the empty
  # stub until the first real release supersedes it. Observed on the 2026-08-23
  # publish, which produced {"placeholder":"0.0.0","latest":"0.0.0"}. The tag is
  # kept anyway: it is accurate, and it survives as a marker after 0.1.0 takes
  # over `latest`.
  ( cd "$WORKDIR" && npm publish --access public --tag placeholder )
  ok "published ${PKG}@${STUB_VERSION}"
fi

printf '\n'
bold "Registry state"
npm view "$PKG" versions dist-tags 2>/dev/null || true

printf '\n'
bold "Next steps (manual, in a browser)"
cat <<TXT

1. Register the trusted publisher.

   Go to  https://www.npmjs.com/package/${PKG}/access
   Find the "Trusted Publisher" section and choose GitHub Actions, then:

       Organization or user  ${GH_OWNER}
       Repository            ${GH_REPO}
       Workflow filename     ${WORKFLOW}
       Environment           (leave blank)

   The workflow path is fixed by the spec for issue #1 (FR-010) as
   .github/workflows/${WORKFLOW}, so registering it now is safe even though the
   file does not exist yet. If that filename ever changes, this registration
   must be updated or the release will fail to authenticate.

2. Do NOT publish 0.1.0 by hand.

   Let issue #3 cut it through the release workflow, so the release carries npm
   provenance. A manual publish cannot produce provenance at all.

3. After 0.1.0 is live, retire the placeholder:

       npm deprecate '${PKG}@${STUB_VERSION}' 'Placeholder used to reserve the name; use 0.1.0 or later.'

   Do this only AFTER 0.1.0 exists. While ${STUB_VERSION} is the only version,
   deprecating it marks the entire package as deprecated.

TXT
