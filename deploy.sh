#!/usr/bin/env bash
# Pushes your commits, then pulls them on the VM and restarts the bot.
# Expects a "dfbot" host in ~/.ssh/config pointing at the VM.
set -e

if [ -n "$(git status --porcelain)" ]; then
  echo "Warning: you have uncommitted changes. Only committed work gets deployed."
fi

git push
ssh dfbot 'cd dark-fundies-bot && git pull --ff-only && npm ci --omit=dev && sudo systemctl restart dfbot && sleep 5 && journalctl -u dfbot -n 5 --no-pager'
