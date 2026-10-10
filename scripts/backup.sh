#!/bin/sh
# Write a full git bundle (all branches and tags) to ../trace-backups and keep the newest 10.
# Usage: sh scripts/backup.sh   (run from anywhere inside the repo)
set -eu
top=$(git rev-parse --show-toplevel)
# In a linked worktree, back up next to the main checkout so every worktree shares one folder.
common=$(cd "$top" && cd "$(git rev-parse --git-common-dir)" && pwd)
repo=$(dirname "$common")
dest="$(dirname "$repo")/trace-backups"
mkdir -p "$dest"
stamp=$(date +%Y%m%d-%H%M%S)
sha=$(git rev-parse --short HEAD)
file="$dest/trace-$stamp-$sha.bundle"
git bundle create "$file" --all
git bundle verify "$file" >/dev/null
echo "backup: $file"
# Keep the newest 10 bundles.
ls -1t "$dest"/trace-*.bundle 2>/dev/null | tail -n +11 | while IFS= read -r old; do
  rm -f "$old"
  echo "backup: removed old $old"
done
