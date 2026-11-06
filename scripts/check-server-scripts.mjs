// The Oracle server's daily cleanup and repair, and its free-tier guard, are
// installed from copies inside scripts/runner/oracle-cloud-init.sh; the readable
// copies are scripts/runner/flg-maintenance.sh and flg-usage.sh. This fails if
// either pair drifts apart.
import { readFileSync } from 'node:fs';
const init = readFileSync(new URL('./runner/oracle-cloud-init.sh', import.meta.url), 'utf8');
const file = readFileSync(new URL('./runner/flg-maintenance.sh', import.meta.url), 'utf8');
const pairs = [
  ['maintenance.sh', 'MAINT', file],
  ['usage.sh', 'USAGE', readFileSync(new URL('./runner/flg-usage.sh', import.meta.url), 'utf8')],
];
for (const [name, tag, text] of pairs) {
  const m = init.match(new RegExp(`cat > /opt/flg/${name.replace('.', '\\.')} <<'${tag}'\\n([\\s\\S]*?)${tag}\\n`));
  if (!m) { console.error(`oracle-cloud-init.sh has no ${name}.`); process.exit(1); }
  if (m[1] !== text) { console.error(`The ${name} in oracle-cloud-init.sh differs from scripts/runner/. Copy the file into the ${tag} block.`); process.exit(1); }
}
console.log('Server scripts: both copies of each match.');
