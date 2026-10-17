#!/usr/bin/env bash
# push to GitHub; the connected Railway service deploys master automatically
set -euo pipefail

cd "$(dirname "$0")"

branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$branch" != master ]; then
  echo "heads up, on $branch, and Railway deploys from master"
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "heads up, uncommitted changes won't get deployed"
fi

git push
