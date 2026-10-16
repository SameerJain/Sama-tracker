#!/usr/bin/env bash
# push to GitHub; the connected Railway service deploys automatically
set -e

if [ -n "$(git status --porcelain)" ]; then
  echo "heads up, uncommitted changes won't get deployed"
fi

git push
