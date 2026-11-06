// The Oracle server's daily cleanup and repair is installed from the copy
// inside scripts/runner/oracle-cloud-init.sh; the readable copy is
// scripts/runner/flg-maintenance.sh. This fails if the two drift apart.
import { readFileSync } from 'node:fs';
const init = readFileSync(new URL('./runner/oracle-cloud-init.sh', import.meta.url), 'utf8');
const file = readFileSync(new URL('./runner/flg-maintenance.sh', import.meta.url), 'utf8');
const m = init.match(/cat > \/opt\/flg\/maintenance\.sh <<'MAINT'\n([\s\S]*?)MAINT\n/);
if (!m) { console.error('oracle-cloud-init.sh has no maintenance script.'); process.exit(1); }
if (m[1] !== file) { console.error('The maintenance script in oracle-cloud-init.sh differs from scripts/runner/flg-maintenance.sh. Copy the file into the MAINT block.'); process.exit(1); }
console.log('Server maintenance script: both copies match.');
