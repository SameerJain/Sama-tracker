#!/usr/bin/env bash
# push, pull on the vm, restart. needs a "dfbot" host in ~/.ssh/config
set -e

if [ -n "$(git status --porcelain)" ]; then
  echo "heads up, uncommitted changes won't get deployed"
fi

git push
ssh dfbot 'cd dark-fundies-bot && git pull --ff-only && npm ci --omit=dev && sudo systemctl restart dfbot && sleep 5 && journalctl -u dfbot -n 5 --no-pager'
