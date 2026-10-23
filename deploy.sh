#!/usr/bin/env bash
# check the code, then push to GitHub; the connected Railway service redeploys master automatically.
# the new deploy answers /health once it's logged in, and the old one saves and signs off on SIGTERM
set -euo pipefail

cd "$(dirname "$0")"

branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$branch" != master ]; then
  echo "heads up, on $branch, and Railway deploys from master"
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "heads up, uncommitted changes won't get deployed"
fi

npm run check
echo "deploying: $(git log -1 --format=%s)"

git push
