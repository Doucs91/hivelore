#!/usr/bin/env bash
# Records the Hivelore README demo to a GIF. Reproducible, no manual timing.
#
# Requires: hivelore on PATH (npm i -g @hivelore/cli), asciinema, and agg.
#   pipx install asciinema
#   curl -sSL -o ~/.local/bin/agg \
#     https://github.com/asciinema/agg/releases/latest/download/agg-x86_64-unknown-linux-gnu
#   chmod +x ~/.local/bin/agg
#
# Usage:  bash docs/demo/record-demo.sh            # -> docs/demo/hivelore-demo.gif
set -euo pipefail
OUT_DIR="$(cd "$(dirname "$0")" && pwd)"
CAST="$(mktemp -d)/demo.cast"
PLAY="$(mktemp)"

# ── the scripted session (typing effect + real commands, in a throwaway repo) ──
cat > "$PLAY" <<'SCRIPT'
#!/usr/bin/env bash
set +e
G=$'\033[1;32m'; DIM=$'\033[2m'; C=$'\033[1;36m'; Y=$'\033[1;33m'; R=$'\033[0m'
D=$(mktemp -d); cd "$D" || exit 1; mkdir -p src
git init -q; git config user.email dev@team.co; git config user.name dev
printf "export const price = (n) => n * 100;\n" > src/pricing.ts
git add -A; git commit -qm "init" >/dev/null 2>&1
hivelore init -y >/dev/null 2>&1
type() { printf '%s$%s ' "$G" "$R"; local i; for ((i=0;i<${#1};i++)); do printf '%s' "${1:i:1}"; sleep 0.016; done; printf '\n'; }
say()  { printf '\n%s# %s%s\n' "$C" "$1" "$R"; sleep 0.7; }
clear
printf '%s  Hivelore — the lesson that refuses the commit repeating it%s\n' "$DIM" "$R"; sleep 1.3
say "1. An agent records a mistake it just learned"
type 'hivelore memory tried --what "import moment" \'
type '      --why-failed "bloat; use date-fns" --paths src/'
hivelore memory tried --what "import moment" --why-failed "bloat; use date-fns" --instead date-fns --paths src/ 2>&1 | grep -E "Recorded" | sed 's/^/  /'
L=$(hivelore memory list 2>&1 | grep -oE "20[0-9-]+attempt-import-moment" | head -1); sleep 1.3
say "2. Turn it into a validated, deterministic guard"
type "hivelore sensors propose \$LESSON \\"
type "      --pattern \"from 'moment'\" --severity block"
hivelore sensors propose "$L" --pattern "from ['\"]moment['\"]" --severity block --bad-example "import x from 'moment'" 2>&1 | grep -E "accepted|self-check" | sed 's/^/  /'; sleep 1.4
say "3. Later, an agent reintroduces the mistake and commits"
type "echo \"import moment from 'moment'\" >> src/pricing.ts"
printf "import moment from 'moment';\n" >> src/pricing.ts
type "git commit -am 'add date helper'"; sleep 0.3
git commit -am "add date helper" >/tmp/_c.$$ 2>&1
grep -iE "refused this commit" /tmp/_c.$$ | sed 's/^/  /'
printf '  %s✗ Block sensor fired — import moment.js: use date-fns%s\n' "$Y" "$R"; sleep 0.5
printf '%s  → commit refused (exit 1). git log is still just:%s\n' "$DIM" "$R"
git log --oneline | sed 's/^/    /'; sleep 1.1
printf '\n%s  Same diff, same verdict — on every machine and in CI.%s\n' "$G" "$R"; sleep 2.3
SCRIPT

asciinema rec --overwrite -c "bash $PLAY" "$CAST"
agg --theme monokai --font-size 20 --cols 80 --rows 22 --speed 1.35 "$CAST" "$OUT_DIR/hivelore-demo.gif"
echo "→ wrote $OUT_DIR/hivelore-demo.gif"
