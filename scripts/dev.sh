#!/usr/bin/env bash
# dev.sh — Manage TRSS-Yunzai main repo + plugin forks
# Usage: ./scripts/dev.sh <command> [repo] [flags]
#
# Design notes:
#   - Per-repo fault isolation: one repo failing never aborts the others;
#     failures are collected and reported in a summary at the end.
#   - Network operations (fetch/push/sync) are wrapped with a timeout
#     (override via NET_TIMEOUT, default 60s) so an unreachable remote can't hang.
#   - `status` does NOT contact the network by default — it is fast and always
#     shows each repo's LOCAL changes. Pass `--fetch` to also compare with upstream.
#   - `clone` runs in parallel and uses each fork's own default branch, so a
#     mismatched branch name (e.g. upstream main vs fork master) never breaks it.

# Intentionally NOT using `-e`: we handle errors per-repo instead of aborting.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NET_TIMEOUT="${NET_TIMEOUT:-60}"

# Format: "rel_path|upstream_url|fork_url|upstream_default_branch"
# upstream_default_branch is the UPSTREAM branch, used by `status --fetch`/`sync`.
REPOS=(
  ".|https://github.com/TimeRainStarSky/Yunzai.git|https://github.com/gendu-amd/Yunzai.git|main"
  "plugins/genshin|https://git.trss.me/Yunzai-genshin|https://github.com/gendu-amd/Yunzai-genshin.git|main"
  "plugins/miao-plugin|https://github.com/yoimiya-kokomi/miao-plugin.git|https://github.com/gendu-amd/miao-plugin.git|master"
  "plugins/TRSS-Plugin|https://github.com/TimeRainStarSky/TRSS-Plugin.git|https://github.com/gendu-amd/TRSS-Plugin.git|main"
  "plugins/Guoba-Plugin|https://github.com/guoba-yunzai/guoba-plugin.git|https://github.com/gendu-amd/guoba-plugin.git|master"
  "plugins/xiaoyao-cvs-plugin|https://github.com/Ctrlcvs/xiaoyao-cvs-plugin.git|https://github.com/gendu-amd/xiaoyao-cvs-plugin.git|master"
  "plugins/ark-plugin|https://github.com/NotIvny/ark-plugin.git|https://github.com/gendu-amd/ark-plugin.git|main"
  "plugins/ZZZ-Plugin|https://github.com/ZZZure/ZZZ-Plugin.git|https://github.com/gendu-amd/ZZZ-Plugin.git|main"
)

# ── colors (auto-disabled when not a TTY) ──────────────────────────────────────
if [[ -t 1 ]]; then
  C_RESET=$'\033[0m'; C_DIM=$'\033[2m'; C_BOLD=$'\033[1m'
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'
else
  C_RESET=; C_DIM=; C_BOLD=; C_RED=; C_GREEN=; C_YELLOW=
fi

# ── failure tracking ───────────────────────────────────────────────────────────
FAILED=()
note_fail() { FAILED+=("$1"); }
print_summary() {
  echo ""
  if [[ ${#FAILED[@]} -eq 0 ]]; then
    echo "${C_GREEN}=== Done. All OK. ===${C_RESET}"
    return 0
  fi
  echo "${C_RED}=== Done with ${#FAILED[@]} failure(s): ===${C_RESET}"
  local f
  for f in "${FAILED[@]}"; do echo "  ${C_RED}✗${C_RESET} $f"; done
  return 1
}

# ── helpers ──────────────────────────────────────────────────────────────────
abs_path_of()  { local rel="$1"; [[ "$rel" == "." ]] && echo "$ROOT" || echo "$ROOT/$rel"; }
label_of()     { local rel="$1"; [[ "$rel" == "." ]] && echo "Yunzai (main)" || echo "$rel"; }
short_name_of(){ local rel="$1"; [[ "$rel" == "." ]] && echo "main" || basename "$rel"; }

have() { command -v "$1" >/dev/null 2>&1; }

# git wrapped with a network timeout (use for fetch/push/pull, NOT clone)
gitnet() {
  if have timeout; then timeout "$NET_TIMEOUT" git "$@"; else git "$@"; fi
}

# Returns 0 if repo matches filter (empty filter matches all)
matches_filter() {
  local rel="$1" filter="$2"
  [[ -z "$filter" ]] && return 0
  local short; short="$(short_name_of "$rel")"
  [[ "$short" == "$filter" || "$rel" == "$filter" ]]
}

list_repos() {
  echo "Available repos:"
  local entry rel
  for entry in "${REPOS[@]}"; do
    IFS='|' read -r rel _ _ _ <<< "$entry"
    printf "  %-18s (%s)\n" "$(short_name_of "$rel")" "$rel"
  done
}

# Iterate repos matching $2 and call function $1 with:
#   rel upstream_url fork_url default_branch dir label
# Repos without a .git dir are skipped with a message (unless $3 == allow_missing).
for_each_repo() {
  local fn="$1" filter="$2" allow_missing="${3:-}"
  local entry rel upstream_url fork_url default_branch dir label
  for entry in "${REPOS[@]}"; do
    IFS='|' read -r rel upstream_url fork_url default_branch <<< "$entry"
    matches_filter "$rel" "$filter" || continue
    dir="$(abs_path_of "$rel")"; label="$(label_of "$rel")"
    echo ""
    echo "${C_BOLD}--- $label ---${C_RESET}"
    if [[ "$allow_missing" != "allow_missing" && ! -d "$dir/.git" ]]; then
      echo "  ${C_DIM}SKIP: not cloned${C_RESET}"
      continue
    fi
    "$fn" "$rel" "$upstream_url" "$fork_url" "$default_branch" "$dir" "$label"
  done
}

# ── clone ──────────────────────────────────────────────────────────────────────
cmd_clone() {
  local filter="${1:-}"
  echo "=== Cloning plugins from your forks (parallel) ==="
  local tmp; tmp="$(mktemp -d)"
  local entry rel upstream_url fork_url default_branch dir label sn
  local pids=() labels=() logs=()

  for entry in "${REPOS[@]}"; do
    IFS='|' read -r rel upstream_url fork_url default_branch <<< "$entry"
    [[ "$rel" == "." ]] && continue            # never clone the main repo
    matches_filter "$rel" "$filter" || continue
    dir="$(abs_path_of "$rel")"; label="$(label_of "$rel")"; sn="$(short_name_of "$rel")"
    if [[ -d "$dir/.git" ]]; then
      echo "  ${C_DIM}SKIP (exists): $label${C_RESET}"
      continue
    fi
    echo "  ${C_YELLOW}→ start:${C_RESET} $label"
    # Omit -b so git uses the fork's own default branch (no branch-name mismatch).
    # No network timeout here: large resource repos legitimately take a while.
    ( git clone --depth=1 "$fork_url" "$dir" ) >"$tmp/$sn.log" 2>&1 &
    pids+=($!); labels+=("$label"); logs+=("$tmp/$sn.log")
  done

  local i
  for i in "${!pids[@]}"; do
    if wait "${pids[$i]}"; then
      echo "  ${C_GREEN}✓${C_RESET} ${labels[$i]}"
    else
      echo "  ${C_RED}✗${C_RESET} ${labels[$i]}"
      sed 's/^/        /' "${logs[$i]}"
      note_fail "${labels[$i]} (clone)"
    fi
  done
  rm -rf "$tmp"

  echo ""
  echo "Next: ${C_BOLD}./scripts/dev.sh setup${C_RESET} to configure upstream remotes."
  print_summary
}

# ── setup ──────────────────────────────────────────────────────────────────────
_setup_one() {
  local rel="$1" upstream_url="$2" fork_url="$3" default_branch="$4" dir="$5" label="$6"
  (
    cd "$dir" || exit 1
    local cur_o cur_u
    cur_u="$(git remote get-url upstream 2>/dev/null || true)"
    cur_o="$(git remote get-url origin 2>/dev/null || true)"

    # ensure upstream → original source
    if [[ -n "$cur_u" ]]; then
      if [[ "$cur_u" != "$upstream_url" ]]; then
        git remote set-url upstream "$upstream_url"; echo "  upstream updated → $upstream_url"
      else
        echo "  upstream OK"
      fi
    elif [[ "$cur_o" == "$upstream_url" ]]; then
      git remote rename origin upstream; echo "  origin renamed → upstream"
    else
      git remote add upstream "$upstream_url"; echo "  upstream added → $upstream_url"
    fi

    # ensure origin → your fork
    cur_o="$(git remote get-url origin 2>/dev/null || true)"
    if [[ -n "$cur_o" ]]; then
      if [[ "$cur_o" != "$fork_url" ]]; then
        git remote set-url origin "$fork_url"; echo "  origin updated → $fork_url"
      else
        echo "  origin OK"
      fi
    else
      git remote add origin "$fork_url"; echo "  origin added → $fork_url"
    fi
  ) || note_fail "$label (setup)"
}
cmd_setup() {
  echo "=== Setting up remotes ==="
  for_each_repo _setup_one "${1:-}"
  print_summary
}

# ── status ─────────────────────────────────────────────────────────────────────
_status_one() {
  local rel="$1" upstream_url="$2" fork_url="$3" default_branch="$4" dir="$5" label="$6"
  (
    cd "$dir" || exit 1
    echo "  branch: $(git branch --show-current 2>/dev/null)"
    local changes; changes="$(git status --short)"
    if [[ -n "$changes" ]]; then
      echo "$changes" | sed 's/^/  /'
    else
      echo "  ${C_DIM}(clean)${C_RESET}"
    fi

    [[ "$STATUS_FETCH" != "1" ]] && exit 0
    git remote get-url upstream >/dev/null 2>&1 || { echo "  ${C_DIM}(no upstream remote)${C_RESET}"; exit 0; }

    if gitnet fetch upstream --quiet 2>/dev/null; then
      local ahead behind
      ahead="$(git rev-list --count "upstream/$default_branch..HEAD" 2>/dev/null || echo 0)"
      behind="$(git rev-list --count "HEAD..upstream/$default_branch" 2>/dev/null || echo 0)"
      if [[ "$ahead" -gt 0 ]]; then echo "  ${C_YELLOW}↑ $ahead${C_RESET} ahead of upstream/$default_branch"; fi
      if [[ "$behind" -gt 0 ]]; then echo "  ${C_YELLOW}↓ $behind${C_RESET} behind upstream/$default_branch (run sync)"; fi
      if [[ "$ahead" -eq 0 && "$behind" -eq 0 ]]; then echo "  ${C_DIM}up to date with upstream/$default_branch${C_RESET}"; fi
    else
      echo "  ${C_DIM}(upstream fetch failed/timeout — skipped)${C_RESET}"
    fi
  )
}
cmd_status() {
  STATUS_FETCH=0
  local filter="" a
  for a in "$@"; do
    case "$a" in
      --fetch) STATUS_FETCH=1 ;;
      *)       filter="$a" ;;
    esac
  done
  if [[ "$STATUS_FETCH" == "1" ]]; then
    echo "=== Repository Status (with upstream fetch) ==="
  else
    echo "=== Repository Status (local only; use --fetch to compare upstream) ==="
  fi
  for_each_repo _status_one "$filter"
  echo ""
}

# ── commits (read-only: latest commit per repo) ────────────────────────────────
_commits_one() {
  local rel="$1" upstream_url="$2" fork_url="$3" default_branch="$4" dir="$5" label="$6"
  (
    cd "$dir" || exit 1
    local cur; cur="$(git branch --show-current 2>/dev/null)"
    local line; line="$(git log -1 --format='%h  %cd  %s' --date=format:'%Y-%m-%d %H:%M' 2>/dev/null)"
    if [[ -z "$line" ]]; then
      echo "  ${C_DIM}(no commits)${C_RESET}"
    else
      echo "  ${C_DIM}[$cur]${C_RESET} ${C_GREEN}$line${C_RESET}"
    fi
    # 相对你的 fork(origin/当前分支)的领先/落后,基于本地缓存 ref(不联网;准确值用 status --fetch)
    if git rev-parse --verify --quiet "origin/$cur" >/dev/null 2>&1; then
      local ahead behind
      ahead="$(git rev-list --count "origin/$cur..HEAD" 2>/dev/null || echo 0)"
      behind="$(git rev-list --count "HEAD..origin/$cur" 2>/dev/null || echo 0)"
      [[ "$ahead" -gt 0 ]] && echo "  ${C_YELLOW}↑$ahead 未推送 origin${C_RESET}"
      [[ "$behind" -gt 0 ]] && echo "  ${C_YELLOW}↓$behind 未拉取 origin${C_RESET}"
    fi
  )
}
cmd_commits() {
  echo "=== 各仓最新提交(本体 + 插件) ==="
  for_each_repo _commits_one "${1:-}"
  echo ""
}

# ── sync ───────────────────────────────────────────────────────────────────────
_sync_one() {
  local rel="$1" upstream_url="$2" fork_url="$3" default_branch="$4" dir="$5" label="$6"
  (
    cd "$dir" || exit 1
    local cur; cur="$(git branch --show-current)"
    git remote get-url upstream >/dev/null 2>&1 || { echo "  no upstream remote (run setup)"; exit 1; }
    if ! gitnet fetch upstream --quiet; then
      echo "  ${C_RED}fetch failed/timeout${C_RESET}"; exit 1
    fi
    if git merge "upstream/$default_branch" --ff-only --quiet 2>/dev/null; then
      echo "  ${C_GREEN}fast-forwarded${C_RESET} $cur ← upstream/$default_branch"
    else
      echo "  merging upstream/$default_branch into $cur ..."
      if ! git merge "upstream/$default_branch" --no-edit; then
        echo "  ${C_RED}merge conflict — resolve manually${C_RESET}"; exit 1
      fi
    fi
  ) || note_fail "$label (sync)"
}
cmd_sync() {
  echo "=== Syncing from upstream ==="
  for_each_repo _sync_one "${1:-}"
  print_summary
}

# ── push ───────────────────────────────────────────────────────────────────────
_push_one() {
  local rel="$1" upstream_url="$2" fork_url="$3" default_branch="$4" dir="$5" label="$6"
  (
    cd "$dir" || exit 1
    local cur; cur="$(git branch --show-current)"
    if gitnet push origin "$cur"; then
      echo "  ${C_GREEN}pushed${C_RESET} $cur → origin"
    else
      echo "  ${C_RED}push failed/timeout${C_RESET}"; exit 1
    fi
  ) || note_fail "$label (push)"
}
cmd_push() {
  echo "=== Pushing to your forks ==="
  for_each_repo _push_one "${1:-}"
  print_summary
}

# ── diff (read-only) ─────────────────────────────────────────────────────────--
_diff_one() {
  local rel="$1" upstream_url="$2" fork_url="$3" default_branch="$4" dir="$5" label="$6"
  (
    cd "$dir" || exit 1
    local unstaged staged
    unstaged="$(git --no-pager diff --stat)"
    staged="$(git --no-pager diff --stat --staged)"
    if [[ -z "$unstaged" && -z "$staged" ]]; then
      echo "  ${C_DIM}(no changes)${C_RESET}"; exit 0
    fi
    if [[ -n "$staged" ]]; then
      echo "  ${C_GREEN}staged:${C_RESET}"; echo "$staged" | sed 's/^/    /'
    fi
    if [[ -n "$unstaged" ]]; then
      echo "  ${C_YELLOW}unstaged:${C_RESET}"; echo "$unstaged" | sed 's/^/    /'
    fi
  )
}
cmd_diff() {
  echo "=== Diffs ==="
  for_each_repo _diff_one "${1:-}"
  echo ""
}

# ── commit (stage all + commit with one shared message) ────────────────────────
_commit_one() {
  local rel="$1" upstream_url="$2" fork_url="$3" default_branch="$4" dir="$5" label="$6"
  (
    cd "$dir" || exit 1
    if [[ -z "$(git status --porcelain)" ]]; then
      echo "  ${C_DIM}(nothing to commit)${C_RESET}"; exit 0
    fi
    if git add -A && git commit -q -m "$DEV_COMMIT_MSG"; then
      echo "  ${C_GREEN}committed${C_RESET}"
    else
      echo "  ${C_RED}commit failed${C_RESET}"; exit 1
    fi
  ) || note_fail "$label (commit)"
}
cmd_commit() {
  DEV_COMMIT_MSG="${1:-}"
  local filter="${2:-}"
  if [[ -z "$DEV_COMMIT_MSG" ]]; then
    echo "Usage: $0 commit \"<message>\" [repo|all]"
    exit 1
  fi
  [[ "$filter" == "all" ]] && filter=""
  echo "=== Committing dirty repos (message: \"$DEV_COMMIT_MSG\") ==="
  for_each_repo _commit_one "$filter"
  print_summary
}

# ── branch ─────────────────────────────────────────────────────────────────────
_branch_one() {
  local rel="$1" upstream_url="$2" fork_url="$3" default_branch="$4" dir="$5" label="$6"
  (
    cd "$dir" || exit 1
    if git show-ref --verify --quiet "refs/heads/$DEV_NEW_BRANCH"; then
      git checkout "$DEV_NEW_BRANCH"; echo "  switched to existing $DEV_NEW_BRANCH"
    else
      git checkout -b "$DEV_NEW_BRANCH"; echo "  created and switched to $DEV_NEW_BRANCH"
    fi
  ) || note_fail "$label (branch)"
}
cmd_branch() {
  local filter="${1:-}"
  DEV_NEW_BRANCH="${2:-}"
  if [[ -z "$filter" || -z "$DEV_NEW_BRANCH" ]]; then
    echo "Usage: $0 branch <repo|all> <branch-name>"
    echo "  $0 branch xiaoyao-cvs-plugin feature/sr-gacha"
    echo "  $0 branch all feature/my-feature"
    exit 1
  fi
  [[ "$filter" == "all" ]] && filter=""
  echo "=== Creating branch '$DEV_NEW_BRANCH' ==="
  for_each_repo _branch_one "$filter"
  print_summary
}

# ── help ───────────────────────────────────────────────────────────────────────
cmd_help() {
  cat <<EOF
Usage: $0 <command> [repo] [flags]

Commands:
  clone  [repo]              Clone plugins from your forks (parallel, fork default branch)
  setup  [repo]              Configure upstream + origin remotes
  status [repo] [--fetch]    Show branch + local changes. --fetch also compares upstream
  commits [repo]             Show latest commit of main + each plugin (+ ahead/behind origin)
  diff   [repo]              Show staged/unstaged diff stat per repo (read-only)
  sync   [repo]              Merge upstream default branch into current branch
  commit "<msg>" [repo|all]  Stage all (-A) + commit dirty repos with one message
  push   [repo]              Push current branch to your fork
  branch <repo|all> <name>   Create/switch a feature branch

[repo] is optional — omit to run on ALL repos, or pass a short name:
$(list_repos)

Environment:
  NET_TIMEOUT=<sec>   Timeout for network ops (fetch/push/sync). Default: 60

Examples:
  $0 status                          # fast, local-only status of all repos
  $0 status xiaoyao-cvs-plugin       # one repo
  $0 status --fetch                  # also show ahead/behind vs upstream
  $0 diff xiaoyao-cvs-plugin         # what changed
  $0 commit "feat: sr gacha" xiaoyao-cvs-plugin
  $0 push xiaoyao-cvs-plugin

New server workflow:
  git clone https://github.com/gendu-amd/Yunzai.git TRSS-Yunzai && cd TRSS-Yunzai
  ./scripts/dev.sh clone && ./scripts/dev.sh setup && pnpm install
EOF
}

# ── main ───────────────────────────────────────────────────────────────────────
cmd="${1:-help}"
[[ $# -gt 0 ]] && shift
case "$cmd" in
  clone)  cmd_clone  "${1:-}" ;;
  setup)  cmd_setup  "${1:-}" ;;
  status) cmd_status "$@" ;;
  commits|commit-log|log) cmd_commits "${1:-}" ;;
  diff)   cmd_diff   "${1:-}" ;;
  sync)   cmd_sync   "${1:-}" ;;
  commit) cmd_commit "${1:-}" "${2:-}" ;;
  push)   cmd_push   "${1:-}" ;;
  branch) cmd_branch "${1:-}" "${2:-}" ;;
  *)      cmd_help ;;
esac
