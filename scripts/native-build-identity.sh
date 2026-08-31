#!/usr/bin/env bash

# Sets the native Android identity for the current checkout. Source this file
# from build or install scripts; it intentionally produces no output.

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
base_app_name="BackOnTrack"
base_android_application_id="app.backontrack.android"
current_branch="$(git -C "$repository_root" branch --show-current 2>/dev/null || true)"

BACKONTRACK_APP_NAME="$base_app_name"
BACKONTRACK_ANDROID_APPLICATION_ID="$base_android_application_id"

case "$current_branch" in
  main|master)
    ;;
  '')
    current_branch="detached-$(git -C "$repository_root" rev-parse --short HEAD 2>/dev/null || printf 'build')"
    ;;&
  *)
    branch_slug="$(printf '%s' "$current_branch" \
      | LC_ALL=C tr '[:upper:]' '[:lower:]' \
      | sed -E 's/[^a-z0-9]+/_/g; s/^_+//; s/_+$//')"
    branch_slug="${branch_slug:0:40}"
    [[ -n "$branch_slug" ]] || branch_slug="branch"

    branch_hash="$(printf '%s' "$current_branch" | git hash-object --stdin | cut -c1-8)"
    BACKONTRACK_APP_NAME="$base_app_name ($branch_slug)"
    BACKONTRACK_ANDROID_APPLICATION_ID="${base_android_application_id}.branch_${branch_slug}_${branch_hash}"
    ;;
esac
