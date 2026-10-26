#!/usr/bin/env bash
# The nightly maintenance checks (run by .github/workflows/nightly.yml at 2 am
# Eastern). Each check adds lines to three lists in $REPORT_DIR:
#   problems.txt  something is broken or needs the owner: emailed, and a GitHub issue
#   warnings.txt  worth fixing soon (slower pages, a broken outside link): GitHub issue only
#   notes.txt     what was done and checked, for the run summary
# The repository is public, so nothing here prints player text, ids or search queries.
# Needs: curl, jq, node, npm (and npx for Lighthouse). Free tools only.
set -uo pipefail
: "${REPORT_DIR:?}" "${SITE:?}" "${API:?}"
TOKEN="${FLG_ADMIN_TOKEN:-}"
KEY="${INDEXNOW_KEY:-fae88a004ad87116c0e93df007b2de7e}"
mkdir -p "$REPORT_DIR"
: >"$REPORT_DIR/problems.txt"; : >"$REPORT_DIR/warnings.txt"; : >"$REPORT_DIR/notes.txt"
problem() { echo "$*" >>"$REPORT_DIR/problems.txt"; echo "Problem: $*"; }
warning() { echo "$*" >>"$REPORT_DIR/warnings.txt"; echo "Warning: $*"; }
note() { echo "$*" >>"$REPORT_DIR/notes.txt"; echo "Note: $*"; }
section() { echo; echo "::group::$*"; }
endsection() { echo "::endgroup::"; }
fetch() { for i in 1 2 3; do if body=$(curl -fsSL --max-time 25 "$@"); then printf '%s' "$body"; return 0; fi; sleep 15; done; return 1; }
admin() { [ -n "$TOKEN" ] && curl -fsS --max-time 25 -H "Authorization: Bearer $TOKEN" "$API$1"; }

# ---------------------------------------------------------------- Worker, database, cleanup
section "Worker and database"
if health=$(fetch "$API/v1/health?deep=1"); then
  if ! jq -e '.db == true' <<<"$health" >/dev/null; then problem "The Worker answers, but its D1 database does not."
  else
    last=$(jq -r '.lastUpkeep // 0' <<<"$health")
    age=$(( ($(date +%s) * 1000 - last) / 60000 ))
    if [ "$last" = 0 ]; then warning "The Worker's nightly cleanup has never run. Check Workers > flg-api > Settings > Triggers in the Cloudflare dashboard."
    elif [ "$age" -gt $(( 36 * 60 )) ]; then problem "The Worker's nightly cleanup last ran $(( age / 60 )) hours ago. Check Workers > flg-api > Settings > Triggers in the Cloudflare dashboard."
    elif [ "$age" -gt 90 ]; then warning "Tonight's Worker cleanup has not run yet (the last one was $(( age / 60 )) hours ago). It runs at 2:00 am Eastern; the next nightly check looks again."
    else note "The Worker cleaned out old data and tidied the database $age minutes ago."; fi
    note "Errors players reported today so far: $(jq -r '.errorsToday' <<<"$health"). Server voice clips today: $(jq -r '"\(.voicesToday) of \(.voiceCap)"' <<<"$health")."
  fi
else problem "The shared Worker at $API does not answer, so sign-in sync, races and server voices are down."; fi
endsection

# ---------------------------------------------------------------- admin data (needs FLG_ADMIN_TOKEN)
section "Search numbers, puzzle ratings and free limits"
if [ -z "$TOKEN" ]; then
  note "The repository secret FLG_ADMIN_TOKEN is not set, so the search numbers, puzzle ratings and free limits were not checked."
else
  if s=$(admin /admin/v1/search); then
    for src in google bing; do
      name=$([ $src = google ] && echo "Google Search Console" || echo "Bing Webmaster Tools")
      if ! jq -e ".sources.$src.connected" <<<"$s" >/dev/null; then note "$name is not connected to the admin dashboard yet (optional; see SEO.md)."
      elif [ "$(jq -r ".sources.$src.error // empty" <<<"$s")" != "" ]; then warning "$name numbers could not be refreshed tonight. The admin dashboard's Search section shows the reason."
      else
        at=$(jq -r ".sources.$src.fetchedAt // 0" <<<"$s")
        hrs=$(( ($(date +%s) * 1000 - at) / 3600000 ))
        if [ "$hrs" -gt 30 ]; then warning "$name numbers are $hrs hours old."; else note "$name numbers were refreshed tonight (see the admin dashboard's Search section)."; fi
      fi
    done
  else warning "The admin search numbers did not answer (check that FLG_ADMIN_TOKEN matches the Worker's ADMIN_TOKEN)."; fi

  # Puzzle ratings for the last 7 days (the Worker's ratings report): `headline`
  # and `actionNeeded` hold only numbers and built-in names, never player text.
  code=$(curl -sS -o "$REPORT_DIR/ratings.json" -w '%{http_code}' --max-time 60 -H "Authorization: Bearer $TOKEN" "$API/admin/v1/ratings?brief=1&days=7" || echo 000)
  if [ "$code" = 200 ] && jq -e . "$REPORT_DIR/ratings.json" >/dev/null 2>&1; then
    headline=$(jq -r '.headline // empty | tostring' "$REPORT_DIR/ratings.json")
    note "Puzzle ratings: ${headline:-the ratings report answered.}"
    jq -r '.actionNeeded // [] | .[] | tostring' "$REPORT_DIR/ratings.json" | while read -r line; do [ -n "$line" ] && warning "Puzzle ratings: $line"; done
  else note "Puzzle ratings: not available yet."; fi
  rm -f "$REPORT_DIR/ratings.json"

  if a=$(admin /admin/v1/alerts); then
    jq -r '.alerts[]? | "\(.label) is at \(.percent)% of its free allowance. \(.text)"' <<<"$a" | while read -r line; do [ -n "$line" ] && warning "$line"; done
    [ "$(jq '.alerts | length' <<<"$a")" = 0 ] && note "Every free allowance is under the alert level."
  fi
fi
endsection

# ---------------------------------------------------------------- dependencies and security
section "Dependencies and security"
audit() { # $1 folder, $2 label
  local json high crit mod devhigh
  json=$(cd "$1" && npm audit --omit=dev --json 2>/dev/null || true)
  crit=$(jq -r '.metadata.vulnerabilities.critical // 0' <<<"$json" 2>/dev/null || echo 0)
  high=$(jq -r '.metadata.vulnerabilities.high // 0' <<<"$json" 2>/dev/null || echo 0)
  mod=$(jq -r '.metadata.vulnerabilities.moderate // 0' <<<"$json" 2>/dev/null || echo 0)
  if [ $(( crit + high )) -gt 0 ]; then problem "$2: $crit critical and $high high security advisories in libraries players' devices or the Worker use. Dependabot opens fixes when they exist; run npm audit in $1 for details."
  elif [ "$mod" -gt 0 ]; then warning "$2: $mod moderate security advisories in libraries the game uses (npm audit in $1)."
  else note "$2: no known security advisories in the libraries the game ships."; fi
  json=$(cd "$1" && npm audit --json 2>/dev/null || true)
  devhigh=$(jq -r '(.metadata.vulnerabilities.critical // 0) + (.metadata.vulnerabilities.high // 0)' <<<"$json" 2>/dev/null || echo 0)
  [ "$devhigh" -gt $(( crit + high )) ] && warning "$2: $(( devhigh - crit - high )) high or critical advisories in build and test tools only (not shipped to players)."
  local out; out=$(cd "$1" && npm outdated --json 2>/dev/null || true)
  local n; n=$(jq 'length' <<<"${out:-{\}}" 2>/dev/null || echo 0)
  [ "$n" -gt 0 ] && note "$2: $n libraries have newer versions; Dependabot's weekly updates bring them in."
}
audit . "Game and website"
audit server "Worker"
endsection

# ---------------------------------------------------------------- the built site: links and structured data
section "Built website: links, tags and structured data"
if node scripts/check-site.mjs --external --json "$REPORT_DIR/site.json"; then :; fi
if [ -f "$REPORT_DIR/site.json" ]; then
  note "Website build: $(jq -r .summary "$REPORT_DIR/site.json")"
  jq -r '.problems[]' "$REPORT_DIR/site.json" | while read -r l; do problem "Website build: $l"; done
  jq -r '.warnings[]' "$REPORT_DIR/site.json" | while read -r l; do warning "Website build: $l"; done
  rm -f "$REPORT_DIR/site.json"
else problem "The website link and structured-data check did not run (see the run log)."; fi
endsection

# ---------------------------------------------------------------- the live site, sitemap and IndexNow
section "Live website, sitemap and IndexNow"
robots=$(fetch "$SITE/robots.txt") || problem "$SITE/robots.txt does not answer."
grep -q "^Sitemap: $SITE/sitemap.xml" <<<"${robots:-}" || problem "The live robots.txt does not point search engines to the sitemap."
# Only the groups search engines follow matter (AI training crawlers may be shut out on purpose).
awk 'BEGIN{RS="";IGNORECASE=1} /User-agent:[ \t]*(\*|Googlebot|Bingbot)[ \t]*(\n|$)/ && /\nDisallow:[ \t]*\/[ \t]*(\n|$)/{f=1} END{exit !f}' <<<"${robots:-}" && problem "The live robots.txt blocks the whole site from search engines."
if sitemap=$(fetch "$SITE/sitemap.xml"); then
  urls=$(grep -o '<loc>[^<]*</loc>' <<<"$sitemap" | sed 's#</*loc>##g')
  bad=0
  while read -r u; do
    [ -z "$u" ] && continue
    if page=$(fetch "$u"); then
      grep -q "<link rel=\"canonical\" href=\"$u\">" <<<"$page" || { problem "$u does not name itself as the canonical address."; bad=1; }
      grep -qi 'name="robots" content="noindex' <<<"$page" && { problem "$u tells search engines not to list it."; bad=1; }
    else problem "$u is in the live sitemap but does not answer."; bad=1; fi
  done <<<"$urls"
  [ $bad = 0 ] && note "All $(grep -c . <<<"$urls") pages in the live sitemap answer and name themselves as canonical."
  # The daily page is rebuilt just after midnight UTC; if it is stale, publish again.
  daily=$(grep -o "<loc>$SITE/daily/</loc><lastmod>[^<]*" <<<"$sitemap" | sed 's#.*<lastmod>##')
  if [ "$daily" = "$(date -u +%F)" ]; then note "Tonight's daily puzzle page is live (sitemap date $daily) and IndexNow was told after the publish."
  else
    echo "republish=1" >>"$REPORT_DIR/actions.txt"
    warning "The daily puzzle page was last refreshed on ${daily:-never}, so the nightly run published the website again. If this repeats, check the \"Publish web version\" workflow runs."
  fi
else problem "The live $SITE/sitemap.xml does not answer."; fi
[ "$(fetch "$SITE/$KEY.txt")" = "$KEY" ] || problem "The IndexNow key file $SITE/$KEY.txt is missing, so Bing cannot accept change notices."
fetch "$SITE/og-image.jpg" >/dev/null || warning "The share picture $SITE/og-image.jpg is missing."
endsection

# ---------------------------------------------------------------- Lighthouse with speed budgets
section "Lighthouse on the live site"
if npx --yes @lhci/cli@0.15.1 autorun --config=./lighthouserc.live.json >"$REPORT_DIR/lhci.log" 2>&1; then lh=ok; else lh=fail; fi
tail -40 "$REPORT_DIR/lhci.log"
if [ -f .lighthouseci/assertion-results.json ]; then
  jq -r '.[] | "\(.level)\t\(.url | sub("^https?://[^/]+"; ""))\t\(.auditTitle // .auditId)\t\(.actual)\t\(.expected)\t\(.operator)"' .lighthouseci/assertion-results.json |
  while IFS=$'\t' read -r level url title actual expected op; do
    v=$(printf '%.2f' "$actual" 2>/dev/null || echo "$actual")
    msg="Lighthouse, ${url:-/}: $title is $v (the budget is $op $expected)."
    if [ "$level" = error ]; then problem "$msg"; else warning "$msg"; fi
  done
fi
if [ -d .lighthouseci ]; then
  for f in .lighthouseci/lhr-*.json; do
    [ -f "$f" ] || continue
    jq -r '"Lighthouse \(.finalDisplayedUrl | sub("^https?://[^/]+"; "")): speed \(.categories.performance.score * 100 | round), accessibility \(.categories.accessibility.score * 100 | round), SEO \(.categories.seo.score * 100 | round); first paint \(.audits["first-contentful-paint"].displayValue), largest paint \(.audits["largest-contentful-paint"].displayValue), layout shift \(.audits["cumulative-layout-shift"].displayValue)."' "$f" | while read -r l; do note "$l"; done
  done
fi
[ "$lh" = fail ] && [ ! -s .lighthouseci/assertion-results.json ] && warning "Lighthouse could not test the live site tonight (see the run log)."
endsection
exit 0
