#!/usr/bin/env bash
# Smoke test the demo API end to end. Usage: demo/smoke.sh <base-url>
set -euo pipefail
B="${1:-http://127.0.0.1:8787}"
j() { curl -fsS -H 'content-type: application/json' -H "x-demo-user: ${U:-recruiter-riya}" "$@"; }
echo "reset";        j -X POST "$B/api/demo/reset" >/dev/null
echo "tests";        TID=$(j "$B/api/tests" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s)[0].test.id))')
echo "triage $TID";  j "$B/api/tests/$TID/candidates" | head -c 300; echo
echo "candidate";    j "$B/api/c/demo-candidate" | head -c 200; echo
echo "under-18 blocked?"; curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' -d '{"ageConfirmed":false,"consent":true}' "$B/api/c/demo-candidate/start"
echo "start";        j -X POST -d '{"ageConfirmed":true,"consent":true}' "$B/api/c/demo-candidate/start" >/dev/null
echo "events";       j -X POST -d '{"events":[{"t":1000,"type":"tab_hidden"},{"t":5000,"type":"tab_visible"}]}' "$B/api/c/demo-candidate/events"; echo
echo "submit";       j -X POST "$B/api/c/demo-candidate/submit"; echo
echo "cand report";  j "$B/api/c/demo-candidate/report" | head -c 300; echo
echo "shortlist";    j -X POST -d '{"cutoff":60}' "$B/api/tests/$TID/shortlist"; echo
echo "inbox";        U=reviewer-arjun j "$B/api/reviewer/inbox" | head -c 300; echo
echo "analytics";    j "$B/api/analytics" | head -c 300; echo
echo "assets";       curl -fsS "$B/" | head -c 120; echo
echo "SMOKE OK"
