# Hivelore README demo — the portable, deterministic recipe.
# Render with:  vhs docs/demo/hivelore-demo.tape   (install: https://github.com/charmbracelet/vhs)
# VHS needs `ttyd` + `ffmpeg`. `hivelore` must be on PATH (npm i -g @hivelore/cli).

Output docs/demo/hivelore-demo.gif

Set Shell bash
Set FontSize 20
Set Width 1000
Set Height 640
Set Padding 18
Set Theme "Monokai"
Set TypingSpeed 18ms

# ── hidden setup: a throwaway repo, so the tape is self-contained ──
Hide
Type "PS1='$ '; d=$(mktemp -d); cd $d" Enter
Type "git init -q && git config user.email d@d.co && git config user.name d" Enter
Type "mkdir src && printf 'export const price=(n)=>n*100;\n' > src/pricing.ts" Enter
Type "git add -A && git commit -qm init && hivelore init -y >/dev/null 2>&1 && clear" Enter
Show

Sleep 800ms
Type "# 1. An agent records a mistake it just learned" Enter
Sleep 500ms
Type `hivelore memory tried --what "import moment" --why-failed "bloat; use date-fns" --paths src/` Enter
Sleep 1.6s

# capture the lesson id for the next step (kept off-screen)
Hide
Type "L=$(hivelore memory list | grep -oE '20[0-9-]+attempt-import-moment' | head -1)" Enter
Show

Type "" Enter
Type "# 2. Turn it into a validated, deterministic guard" Enter
Sleep 500ms
Type `hivelore sensors propose $L --pattern "from 'moment'" --severity block` Enter
Sleep 1.8s

Type "" Enter
Type "# 3. Later, an agent reintroduces the mistake and commits" Enter
Sleep 500ms
Type `echo "import moment from 'moment';" >> src/pricing.ts` Enter
Sleep 400ms
Type "git commit -am 'add date helper'" Enter
Sleep 2.5s

Type "" Enter
Type "git log --oneline   # still just the initial commit — the repeat was refused" Enter
Sleep 3s
