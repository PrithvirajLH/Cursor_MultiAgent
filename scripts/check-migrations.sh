#!/usr/bin/env bash
# Fails when a Prisma migration ADDED relative to the base ref contains a
# destructive statement. Background: apps/api/prisma/migrations must stay
# additive — `prisma migrate dev` emits DROP INDEX for six trigram GIN indexes
# it cannot model, and applying one destroys search performance.
# See docs/agent-context/repo-landmines.md ("Prisma").
#
# Usage: scripts/check-migrations.sh [base-ref]   (default: origin/main)
# Opt-out for an intentional drop: make the FIRST line of the migration
#   -- allow-drop: <reason>
set -u
base="${1:-origin/main}"
if ! git rev-parse --verify --quiet "$base" >/dev/null; then
  remote="${base%%/*}"
  branch="${base#*/}"
  git fetch --no-tags "$remote" "$branch:refs/remotes/$base" >/dev/null 2>&1 || {
    echo "check-migrations: cannot resolve base ref '$base'" >&2
    exit 2
  }
fi
status=0
count=0
while IFS= read -r file; do
  [ -n "$file" ] || continue
  count=$((count + 1))
  first_line="$(head -n 1 "$file")"
  case "$first_line" in
    "-- allow-drop:"*)
      echo "check-migrations: ALLOWED  $file  ($first_line)"
      continue
      ;;
  esac
  if grep -nE '^[[:space:]]*(DROP|ALTER TABLE .* DROP)' "$file"; then
    echo "::error file=$file::destructive statement in a new migration — hand-strip it or add a first-line '-- allow-drop: <reason>' (repo-landmines.md, Prisma)"
    status=1
  else
    echo "check-migrations: ok       $file"
  fi
done < <(git diff --name-only --diff-filter=A "$base...HEAD" -- 'apps/api/prisma/migrations/*/migration.sql')
echo "check-migrations: $count new migration file(s) checked against $base"
exit $status
