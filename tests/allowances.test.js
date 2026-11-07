// Base salary + fixed allowances: overtime stays on the base salary only, allowances only change net pay.
// Run: npm test  (or: node allowances.test.js). APP_LANG=en runs in English.
const O = require('./oracle'), FX = require('./fixtures');
const { launch, suite, fresh } = require('./lib');
const { ok, near, done } = suite('allowances');

const KEYS = ['days','base','absDed','unpaidDed','lateDed','adv','otherDed','ss','deductions','otHours','otPay','manualOtPay','attPay','bonus'];
const snap = (p, ids, months) => p.evaluate(([ids, months, KEYS]) => {
  const o = {};
  for(const id of ids) for(const [y,m] of months){ const r = calcPay(empById(id),y,m); o[`${id}|${y}-${m}`] = Object.fromEntries(KEYS.concat('allowances','net').map(k=>[k, r[k]])); }
  o.rates = Object.fromEntries(ids.map(id => [id, otRateFor(empById(id))]));
  o.sheetRates = Object.fromEntries(ids.map(id => [id, sheetRate(attSheet(id,2026,5), empById(id))]));
  return o;
}, [ids, months, KEYS]);
const MONTHS = [[2026,1],[2026,2],[2026,3],[2026,4],[2026,5],[2026,6],[2026,7]];
const IDS = ['a','b','c','d'];
const sameExceptNet = (A, B, label) => {
  for(const k of Object.keys(A)) if(k.includes('|')) for(const f of KEYS) ok(`${label} ${k} ${f} unchanged`, near(A[k][f], B[k][f]), `${A[k][f]} → ${B[k][f]}`);
  for(const id of IDS){ ok(`${label} OT hourly rate ${id} unchanged`, near(A.rates[id], B.rates[id], 1e-9)); ok(`${label} attendance rate ${id} unchanged`, near(A.sheetRates[id], B.sheetRates[id], 1e-9)); }
};

(async () => {
  const b = await launch();
  const ctx = await b.newContext({ viewport:{width:390,height:844} });

  /* 1. Legacy data (no allowances): nothing changes */
  let db = FX(), p = await fresh(ctx, db);
  const before = await snap(p, IDS, MONTHS);
  for(const k of Object.keys(before)) if(k.includes('|')) ok(`legacy ${k}: allowances = 0`, before[k].allowances === 0);
  for(const id of IDS) for(const [y,m] of MONTHS){
    const e = O.pay(db, db.employees.find(x=>x.id===id), y, m), a = before[`${id}|${y}-${m}`];
    ok(`legacy ${id} ${y}-${m} net = oracle`, near(a.net, e.net), `${a.net} vs ${e.net}`);
  }
  ok('legacy: stored employees untouched after load', await p.evaluate(() => db.employees.every(e => !('allowances' in e))));

  /* 2. Add allowances directly: OT, deductions, SS unchanged; net = old net + prorated allowances; matches oracle */
  const AL = { a:[{id:'x1',name:'مواصلات',amount:'30'},{id:'x2',name:'سكن',amount:45}], b:[{id:'x3',name:'هاتف',amount:'15'}], d:[{id:'x4',name:'طبيعة عمل',amount:'120'}] };
  await p.evaluate(AL => { for(const id in AL) empById(id).allowances = AL[id]; }, AL);
  for(const id in AL) db.employees.find(x=>x.id===id).allowances = AL[id];
  const withAl = await snap(p, IDS, MONTHS);
  sameExceptNet(before, withAl, 'with allowances');
  for(const id of IDS) for(const [y,m] of MONTHS){
    const k = `${id}|${y}-${m}`, e = O.pay(db, db.employees.find(x=>x.id===id), y, m);
    const tot = (AL[id]||[]).reduce((s,a)=>s+ +a.amount,0), exp = tot / 30 * withAl[k].days;
    ok(`${k} allowances prorated = total × days ÷ 30`, near(withAl[k].allowances, exp), `${withAl[k].allowances} vs ${exp}`);
    ok(`${k} net = old net + allowances`, near(withAl[k].net, before[k].net + exp));
    ok(`${k} net = oracle`, near(withAl[k].net, e.net), `${withAl[k].net} vs ${e.net}`);
  }
  ok('proration: a hired 6 May → 26/30 of 75', near(withAl['a|2026-5'].allowances, 75*26/30));
  ok('proration: d full month → 120', near(withAl['d|2026-5'].allowances, 120));
  ok('proration: b ended 15 Mar → 15/30 of 15', near(withAl['b|2026-3'].allowances, 7.5));
  ok('proration: b after end → 0', withAl['b|2026-4'].allowances === 0);
  ok('total = base + allowances − deductions + OT + bonus (a May)', near(withAl['a|2026-5'].net, withAl['a|2026-5'].base + withAl['a|2026-5'].allowances - withAl['a|2026-5'].deductions + withAl['a|2026-5'].otPay + withAl['a|2026-5'].bonus));

  // OT strictly from base: double the base → OT rate doubles; raise allowances → OT rate same
  const r1 = await p.evaluate(() => { const e = empById('d'), r0 = otRateFor(e); e.allowances[0].amount = 999; const r2 = otRateFor(e); const s = e.salary; e.salary = String(2*num(s)); const r3 = otRateFor(e); e.salary = s; e.allowances[0].amount = '120'; return {r0, r2, r3}; });
  ok('OT rate = base ÷ 30 ÷ hours × 1.25 (d: 600/30/9×1.25)', near(r1.r0, 600/30/9*1.25, 1e-9), r1.r0);
  ok('raising an allowance does not change OT rate', near(r1.r0, r1.r2, 1e-12));
  ok('doubling base doubles OT rate', near(r1.r3, 2*r1.r0, 1e-9));

  // SS percent still on base only
  await p.evaluate(() => { db.settings.ssPct = 7.5; }); db.settings.ssPct = 7.5;
  for(const id of ['a','d']){ const r = await p.evaluate(id => calcPay(empById(id),2026,5), id); ok(`ss on base only (${id})`, near(r.ss, r.base*0.075)); const e = O.pay(db, db.employees.find(x=>x.id===id), 2026, 5); ok(`ss7.5 net = oracle (${id})`, near(r.net, e.net)); }
  await p.evaluate(() => { db.settings.ssPct = 0; }); db.settings.ssPct = 0;

  /* 3. UI: add / edit / delete allowances from the profile */
  db = FX(); p = await fresh(ctx, db, { tab:'profile', profile:'d' });
  const base0 = await snap(p, ['d'], [[2026,5]]);
  ok('profile shows allowances section', await p.isVisible('[data-act="edit-allow:d"]'));
  await p.click('[data-act="edit-allow:d"]'); await p.waitForSelector('#dlg[open] .al-row');
  await p.fill('#dlg .al-row:nth-child(1) [data-al=name]', 'مواصلات');
  await p.fill('#dlg .al-row:nth-child(1) [data-al=amount]', '40');
  await p.click('#alAdd');
  await p.fill('#dlg .al-row:nth-child(2) [data-al=name]', 'سكن');
  await p.fill('#dlg .al-row:nth-child(2) [data-al=amount]', '٦٠');      // Arabic-Indic digits
  ok('live total in dialog', (await p.textContent('#alSum')).replace(/[^\d.]/g,'').includes('100'));
  await p.click('#dlg button[value=ok]'); await p.waitForTimeout(400);
  let st = await p.evaluate(() => ({al: empById('d').allowances, saved: JSON.parse(localStorage.getItem('payroll-app-v1')).employees.find(e=>e.id==='d').allowances}));
  ok('UI add: two allowances stored', st.al.length === 2 && st.al[0].name === 'مواصلات' && st.al[0].amount === 40 && st.al[1].amount === 60, JSON.stringify(st.al));
  ok('UI add: persisted to storage', JSON.stringify(st.saved) === JSON.stringify(st.al));
  let s1 = await snap(p, ['d'], [[2026,5]]);
  for(const f of KEYS) ok(`UI add: ${f} unchanged`, near(base0['d|2026-5'][f], s1['d|2026-5'][f]));
  ok('UI add: net + 100', near(s1['d|2026-5'].net, base0['d|2026-5'].net + 100));
  ok('profile lists allowances', (await p.textContent('#view')).includes('سكن'));

  // edit amount
  await p.click('[data-act="edit-allow:d"]'); await p.waitForSelector('#dlg[open] .al-row');
  await p.fill('#dlg .al-row:nth-child(2) [data-al=amount]', '75');
  await p.click('#dlg button[value=ok]'); await p.waitForTimeout(400);
  const s2 = await snap(p, ['d'], [[2026,5]]);
  ok('UI edit: ids kept', await p.evaluate(ids => empById('d').allowances.map(a=>a.id).join() === ids, st.al.map(a=>a.id).join()));
  ok('UI edit: otPay unchanged', near(s2['d|2026-5'].otPay, base0['d|2026-5'].otPay) && near(s2.rates.d, base0.rates.d, 1e-12));
  ok('UI edit: net + 115', near(s2['d|2026-5'].net, base0['d|2026-5'].net + 115));

  // validation: amount without name is refused, dialog stays open
  await p.click('[data-act="edit-allow:d"]'); await p.waitForSelector('#dlg[open] .al-row');
  await p.click('#alAdd'); await p.fill('#dlg .al-row:nth-child(3) [data-al=amount]', '10');
  await p.click('#dlg button[value=ok]'); await p.waitForTimeout(300);
  ok('validation: missing name keeps dialog open', await p.isVisible('#dlg[open]'));
  ok('validation: nothing saved', await p.evaluate(() => empById('d').allowances.length === 2));
  ok('validation: field marked invalid', await p.isVisible('#dlg .al-row:nth-child(3) [data-al=name].invalid'));

  // delete one row
  await p.click('#dlg .al-row:nth-child(3) [data-al-del]');
  await p.click('#dlg .al-row:nth-child(1) [data-al-del]');
  await p.click('#dlg button[value=ok]'); await p.waitForTimeout(400);
  const s3 = await snap(p, ['d'], [[2026,5]]);
  ok('UI delete: one left (سكن 75)', await p.evaluate(() => { const a = empById('d').allowances; return a.length === 1 && a[0].name === 'سكن' && a[0].amount === 75; }));
  ok('UI delete: otPay unchanged', near(s3['d|2026-5'].otPay, base0['d|2026-5'].otPay));
  ok('UI delete: net + 75', near(s3['d|2026-5'].net, base0['d|2026-5'].net + 75));

  // undo of the allowance change restores previous list
  // employee edit dialog keeps allowances and shows base salary label
  await p.click('[data-act="profile-menu"]').catch(()=>{});
  await p.evaluate(() => { document.querySelector('#ask')?.open && document.querySelector('#ask').close(); editEmployee('d'); });
  await p.waitForSelector('#dlg[open] [name=salary]');
  await p.click('#dlg button[value=ok]'); await p.waitForTimeout(400);
  ok('employee edit keeps allowances', await p.evaluate(() => empById('d').allowances.length === 1));

  /* 4. Screens: payroll card, payslip, summary, Excel rows */
  await p.evaluate(() => { state.tab='payroll'; state.y=2026; state.m=5; render(); });
  ok('payroll card shows allowances line', await p.evaluate(() => [...document.querySelectorAll('[data-card="d"] dt')].some(dt => dt.textContent.trim() === L('العلاوات'))));
  ok('payroll card net = calcPay net', await p.evaluate(() => num(document.querySelector('[data-card="d"] .net span:last-child').textContent) === fix(calcPay(empById('d'),2026,5).net)));
  const slip = await p.evaluate(() => slipHTML(empById('d'),2026,5));
  ok('payslip lists allowance by name', slip.includes('سكن'));
  ok('payslip text includes allowances', await p.evaluate(() => slipText(empById('d'),2026,5).includes(L('العلاوات:'))));
  await p.evaluate(() => { state.tab='summary'; state.y=2026; render(); });
  ok('summary has allowances column', await p.evaluate(() => [...document.querySelectorAll('thead th')].some(th => th.textContent.trim() === L('العلاوات'))));
  const row = await p.evaluate(() => payRow(empById('d'),2026,5,calcPay(empById('d'),2026,5)));
  ok('Excel row has allowances column = 75', row[await p.evaluate(()=>L('العلاوات'))] === 75, JSON.stringify(row));
  ok('Excel row keeps monthly base salary', row[await p.evaluate(()=>L('الراتب الأساسي الشهري'))] === 600);

  /* 5. Backup round-trip keeps allowances */
  const rt = await p.evaluate(() => { const r = parseBackup(exportPayload()); return r.data && r.data.employees.find(e=>e.id==='d').allowances; });
  ok('backup round-trip keeps allowances', Array.isArray(rt) && rt.length === 1 && rt[0].name === 'سكن');

  /* 6. Hostile allowance names are escaped everywhere */
  const bad = '<img src=x onerror="window.__pwn=1">';
  await p.evaluate(bad => { empById('d').allowances = [{id:'h1', name: bad, amount: 5}, {id:'"><b>', name:'x', amount:'abc'}]; }, bad);
  for(const [tab, extra] of [['profile',{profile:'d'}],['payroll',{y:2026,m:5}],['summary',{y:2026}]]){
    await p.evaluate(([tab, extra]) => { Object.assign(state, extra); state.tab = tab; render(); }, [tab, extra]);
    ok(`escape: no injected img on ${tab}`, await p.evaluate(() => !document.querySelector('#view img')));
  }
  await p.evaluate(() => editAllowances('d')); await p.waitForSelector('#dlg[open] .al-row');
  ok('escape: dialog renders name as text', await p.evaluate(b => !document.querySelector('#dlg img') && document.querySelector('#dlg [data-al=name]').value === b, bad));
  await p.click('#dlg button[value=cancel]');
  ok('escape: payslip has no img', await p.evaluate(() => !/<img/.test(slipHTML(empById('d'),2026,5))));
  ok('non-numeric stored amount treated as 0', await p.evaluate(() => isFinite(calcPay(empById('d'),2026,5).net)));
  await p.waitForTimeout(300);
  ok('no script executed', await p.evaluate(() => !window.__pwn));
  ok('no page errors', p.errs.length === 0, p.errs.join(' | '));

  await b.close();
  done();
})().catch(e => { console.error(e); process.exitCode = 1; });
