// Runs every suite in its own process and fails (exit 1) if any check fails.
// Usage: npm test            all suites
//        node run.js rtl     one suite
// Some suites also run a second time with prefers-reduced-motion (RM=1), since sheets/toasts behave differently.
const { spawnSync } = require('child_process');
const path = require('path');
const SUITES = ['calculations', 'safety', 'rtl', 'mobile', 'animation', 'security', 'schema'];
const RM_TOO = new Set(['safety', 'mobile']);
const only = process.argv.slice(2);
let pass = 0, fail = 0; const failed = [];
for(const s of SUITES.filter(s => !only.length || only.includes(s))){
  for(const rm of RM_TOO.has(s) ? [false, true] : [false]){
    const r = spawnSync(process.execPath, [path.join(__dirname, `${s}.test.js`)], { encoding: 'utf8', env: { ...process.env, ...(rm ? { RM: '1' } : {}) }, timeout: 600000 });
    const out = (r.stdout || '') + (r.stderr || '');
    process.stdout.write(rm ? out.replace(`[${s}]`, `[${s} · reduced-motion]`) : out);
    const m = out.match(/PASS (\d+)\s+FAIL (\d+)/);
    if(m){ pass += +m[1]; fail += +m[2]; }
    if(r.status !== 0 || !m){ failed.push(s + (rm ? ' (RM)' : '')); if(!m) fail++; }
  }
}
console.log(`\nTOTAL  PASS ${pass}  FAIL ${fail}${failed.length ? `  — failing: ${failed.join(', ')}` : ''}`);
process.exit(fail || failed.length ? 1 : 0);
