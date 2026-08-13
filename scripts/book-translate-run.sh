#!/bin/bash
# Resume-safe loop until FR/IT/ES/PT/NL chapters are complete.
# On Gemini daily quota (exit 3) sleeps until resumeAfter, then continues.
set -uo pipefail
export PATH=/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin:$PATH
cd /Users/sergey/Desktop/HARMONIZER

LOG=Book/translations/translate.log
echo "START $(date)" | tee -a "$LOG"

missing_count() {
  node <<'NODE'
const fs = require("fs");
const path = require("path");
const manifest = JSON.parse(
  fs.readFileSync("Book/translations/en/chapters/manifest.json", "utf8"),
);
const ids = manifest.filter((c) => !c.skipTranslate).map((c) => c.id);
let missing = 0;
for (const loc of ["fr", "it", "es", "pt", "nl"]) {
  for (const id of ids) {
    if (!fs.existsSync(path.join("Book/translations", loc, "chapters", `${id}.md`))) {
      missing += 1;
    }
  }
}
console.log(missing);
NODE
}

wait_quota_if_needed() {
  local pause=Book/translations/quota-pause.json
  [[ -f "$pause" ]] || return 0
  local resume_epoch
  resume_epoch=$(node -e "
    const p=JSON.parse(require('fs').readFileSync('$pause','utf8'));
    const t=Date.parse(p.resumeAfter||0);
    console.log(Number.isFinite(t)?t:0);
  ")
  local now_ms
  now_ms=$(node -e "console.log(Date.now())")
  if [[ "$resume_epoch" -gt "$now_ms" ]]; then
    local wait_s=$(( (resume_epoch - now_ms) / 1000 ))
    echo "QUOTA sleep ${wait_s}s until $(node -e "console.log(new Date($resume_epoch).toISOString())") — $(date)" | tee -a "$LOG"
    # caffeinate so Mac sleep does not stall the wait
    caffeinate -i sleep "$wait_s"
    rm -f "$pause"
    echo "QUOTA resume $(date)" | tee -a "$LOG"
  else
    rm -f "$pause"
  fi
}

pass=1
while true; do
  miss=$(missing_count)
  echo "==== pass $pass $(date) missing=$miss ====" | tee -a "$LOG"
  if [[ "$miss" -eq 0 ]]; then
    echo "ALL COMPLETE $(date)" | tee -a "$LOG"
    break
  fi
  if [[ "$pass" -ge 40 ]]; then
    echo "GIVING UP after $pass passes, still missing=$miss" | tee -a "$LOG"
    exit 2
  fi

  wait_quota_if_needed

  set +e
  caffeinate -i node scripts/book-translate.mjs --all \
    --provider gemini --model gemini-3.1-pro-preview \
    --concurrency 1 2>&1 | tee -a "$LOG"
  code=${PIPESTATUS[0]}
  set -e

  if [[ "$code" -eq 3 ]]; then
    echo "Daily Gemini quota hit (exit 3) — will sleep then retry" | tee -a "$LOG"
    wait_quota_if_needed
  elif [[ "$code" -ne 0 ]]; then
    echo "translate exit=$code — brief pause" | tee -a "$LOG"
    sleep 30
  else
    sleep 5
  fi
  pass=$((pass + 1))
done

echo "END $(date)" | tee -a "$LOG"
