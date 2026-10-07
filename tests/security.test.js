// Security: every user-controlled value (including IDs and values from backup files) must be escaped
// before it reaches HTML. Payloads are planted in every field, every screen and sheet is rendered,
// and the test fails if any payload executes or creates an element. Also statically audits index.html
// for attribute interpolations that are not escaped.
const fs = require('fs'), path = require('path');
const { launch, suite, fresh, VIEWS, askReady } = require('./lib');
const { ok, done } = suite('security');

const P  = `x"'><img src=x onerror="window.__x=(window.__x||0)+1"><svg onload="window.__x=1">`;
const P2 = `y</b><script>window.__x=1</script>`;
const T  = `15:00"><img src=x onerror="window.__x=1">`;
function hostile(){
  return {
    employees:[
      {id:P, name:P, title:P, hire:'2026-01-01', salary:'290', hours:'8', phone:P, nid:P, notes:P, endDate:'2027-01-01', endReason:P},
      {id:'ok1', name:P2, title:P2, hire:'2026-01-01', salary:'300', hours:'8'}],
    payroll:{'2026-05':{[P]:{note:P, delivered:true, deliveredDate:P, absDays:'1'}}},
    advances:[{id:P2, empId:P, date:'2026-05-03', amount:'50', note:P}],
    overtime:[{id:P, empId:P, date:'2026-05-04', hours:'1', note:P}],
    leaves:[{id:P, empId:P, type:P, from:'2026-05-10', to:'2026-05-11', note:P}],
    attendance:{[`${P}|2026-05`]:{req:'09:00', rate:'', days:{1:{in:T, out:'00:15'}, 2:{in:'08:00', out:'17:00', lf:T, lt:T}}}},
    settings:{currency:P, company:P, ssPct:'0', monthDays:'30', otMultiplier:'1.25', defIn:T, defOut:T, attReq:'09:00', annualLeave:'14'},
  };
}
(async () => {
  const b = await launch();
  const ctx = await b.newContext({viewport:{width:390,height:844}, permissions:['clipboard-read','clipboard-write']});
  const p = await fresh(ctx, hostile(), {tab:'home', y:2026, m:5, attEmp:P, profile:P});
  await p.evaluate(([P]) => localStorage.setItem('payroll-app-snapshots', JSON.stringify([{at:P, day:'x', reason:P, n:P, data:'{}'}])), [P]);
  const clean = async label => {
    const r = await p.evaluate(() => ({x: window.__x, img: document.querySelectorAll('img').length, script: document.querySelectorAll('main script, dialog script').length, onload: document.querySelectorAll('[onload],[onerror]').length}));
    ok(`no injection: ${label}`, !r.x && !r.img && !r.script && !r.onload, JSON.stringify(r));
  };
  for(const t of VIEWS.concat(['profile'])){
    await p.evaluate(([t]) => { state.tab = t; state.y = 2026; state.m = 5; render(); }, [t]);
    await clean(`screen ${t}`);
  }
  // every sheet that renders user data
  const sheets = {
    'day editor':     ([P]) => editDay(P, 2),
    'pay edit':       ([P]) => editPay(P),
    'payslip':        ([P]) => showSlip(P),
    'employee edit':  ([P]) => editEmployee(P),
    'advance edit':   ([P,P2]) => editRecord('advances', P2),
    'overtime edit':  ([P]) => editRecord('overtime', P),
    'leave edit':     ([P]) => editLeave(P),
    'month settings': ([P]) => { state.attEmp = P; attSettings(); },
    'quick fill':     ([P]) => { state.attEmp = P; quickFill(); },
    'employee picker':() => pickEmployee(),
  };
  for(const [label, fn] of Object.entries(sheets)){
    await p.evaluate(`(${fn})(${JSON.stringify([P,P2])})`); await p.waitForTimeout(60);
    await clean(`sheet ${label}`);
    await p.evaluate(() => { document.querySelector('#dlg').close(); }); await p.waitForTimeout(260);
  }
  await p.evaluate(([P]) => { state.tab='profile'; state.profile=P; render(); }, [P]);
  await p.click('#hdrAct [data-act=profile-menu]'); await askReady(p); await clean('profile menu'); await p.keyboard.press('Escape'); await p.waitForTimeout(260);
  // escaped IDs still work as IDs (round-trip through data-* attributes)
  await p.evaluate(() => { state.tab='employees'; render(); });
  ok('escaped id round-trips through data attribute', await p.evaluate(([P]) => document.querySelector('[data-profile]').dataset.profile === P, [P]));
  await p.click('[data-profile]'); ok('row with hostile id opens the right profile', await p.evaluate(([P]) => state.tab==='profile' && state.profile===P, [P]));
  await p.evaluate(([P]) => { state.tab='home'; render(); }, [P]);
  await p.click('[data-punch^="in|"]'); await clean('check-in with hostile id (CSS.escape selector)');
  await p.evaluate(() => { state.tab='payroll'; state.y=2026; state.m=5; render(); });
  await p.click('[data-deliver]'); await clean('delivered toggle with hostile id');
  // a backup file with hostile IDs is rejected as a whole; data unchanged; persistent alert shown
  const before = await p.evaluate(() => JSON.stringify(db));
  await p.evaluate(([d]) => { restoreFrom(JSON.stringify(d)); }, [hostile()]); await p.waitForTimeout(80);
  ok('restore with invalid IDs rejected', await p.evaluate(() => JSON.stringify(db)) === before);
  ok('restore rejection shows persistent alert', await p.evaluate(() => !!document.querySelector('#alerts [data-alert="restore-failed"]')));
  await clean('after rejected restore');
  // a backup with hostile *names* but valid IDs is accepted, and still rendered safely
  const named = hostile(); named.employees[0].id = 'e1'; for(const k of ['advances','overtime','leaves']) named[k].forEach(r => { r.id = 'r' + k; r.empId = 'e1'; });
  named.payroll = {'2026-05':{e1:{note:P}}}; named.attendance = {'e1|2026-05': named.attendance[`${P}|2026-05`]};
  await p.evaluate(([d]) => { restoreFrom(JSON.stringify(d)); }, [named]); await askReady(p); await p.click('#ask [data-r="1"]'); await p.waitForTimeout(150);
  ok('restore with hostile names but valid IDs accepted', await p.evaluate(() => db.employees[0].id === 'e1'));
  for(const t of VIEWS){ await p.evaluate(([t]) => { state.tab=t; state.attEmp='e1'; render(); }, [t]); await clean(`after restore: ${t}`); }
  ok('no page errors', !p.errs.length, p.errs.join(' | '));
  await b.close();

  // Static audit: every ${...} inside an HTML attribute value must be escaped or provably safe (numbers/constants).
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const js = html.slice(html.indexOf('<script>'));
  const SAFE = new Set(['HUES[h % HUES.length]','T[2]','cls','d','day','go','i','kind','label','name','opts.set','sign(netMin)','sign(p.attPay)','sign(s.otPay)','st','isCurMonth() ? now().getDate() : nd']);
  const unsafe = [];
  for(const m of js.matchAll(/([\w-]+)="([^"<>]*?\$\{[^"<>]*?)"/g))
    for(const e of [...m[2].matchAll(/\$\{([^}]*)\}/g)].map(x => x[1].trim()))
      if(!/^(esc|CSS\.escape)\(/.test(e) && !SAFE.has(e)) unsafe.push(`${m[1]}="\${${e}}"`);
  ok('static audit: no unescaped attribute interpolation', unsafe.length === 0, unsafe.join(', '));
  done();
})().catch(e => { console.error(e); process.exit(1); });
