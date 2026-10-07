// Payroll calculations and legacy-data migration, checked against the independent oracle.
// Run: npm test  (or: node calculations.test.js). RM=1 runs with prefers-reduced-motion.
const fs = require('fs'), os = require('os'), path = require('path');
const O = require('./oracle'), FX = require('./fixtures');
const { launch, suite, fresh, VIEWS } = require('./lib');
const { ok, near, done } = suite('calculations');
const appPay = (p, id, y, m) => p.evaluate(([id,y,m]) => { const r = calcPay(empById(id),y,m); return {days:r.days, base:r.base, ded:r.deductions, otPay:r.otPay, net:r.net}; }, [id,y,m]);
async function cmp(p, db, id, y, m, label){
  const a = await appPay(p,id,y,m), e = O.pay(db, db.employees.find(x=>x.id===id), y, m);
  for(const k of ['days','base','ded','otPay','net']) ok(`${label} ${id} ${y}-${m} ${k}`, near(a[k], e[k]), `app ${a[k]} vs oracle ${e[k]}`);
  return a;
}
(async () => {
  const b = await launch();
  const ctx = await b.newContext({viewport:{width:390,height:844}, hasTouch:false, permissions:['clipboard-read','clipboard-write']});
  let db, p;
  /* ===== 1+2. Calculations & migration ===== */
  db = FX(); p = await fresh(ctx, db);
  for(const id of ['a','b','c','d']) for(const [y,m] of [[2026,1],[2026,2],[2026,3],[2026,4],[2026,5],[2026,6],[2026,7]]) await cmp(p, db, id, y, m, 'legacy-auto');
  // Hand-checked anchors from the original spreadsheets
  const a5 = await appPay(p,'a',2026,5);
  ok('anchor: entitlement 26 days (hired 6 May)', a5.days === 26, a5.days);
  ok('anchor: base 251.33', near(a5.base, 251.3333));
  ok('anchor: attendance -2:09 → -3.25 (rate 1.51)', near(await p.evaluate(()=>calcPay(empById('a'),2026,5).attPay), -129/60*(290/30/8*1.25)));
  ok('anchor: legacy post ignored in auto month', await p.evaluate(()=>calcPay(empById('a'),2026,5).manualOt) === 2);
  ok('anchor: Jan 31 days capped at 30', (await appPay(p,'d',2026,1)).days === 30);
  ok('anchor: Feb = 28 days', (await appPay(p,'d',2026,2)).days === 28);
  ok('anchor: ended 15 Mar → 15 days', (await appPay(p,'b',2026,3)).days === 15);
  ok('anchor: ended → April 0', (await appPay(p,'b',2026,4)).base === 0);
  ok('anchor: hours=0 → no late/OT division error', isFinite((await appPay(p,'c',2026,5)).net));
  ok('anchor: unpaid leave split May 2 / June 2', await p.evaluate(()=>[calcPay(empById('a'),2026,5).unpaidDays, calcPay(empById('a'),2026,6).unpaidDays].join()) === '2,2');
  ok('anchor: annual leave across years (Dec 30–Jan 2) → 2 days in 2026', await p.evaluate(()=>leaveBalance(empById('d'),2026)) === 12);
  ok('anchor: manual month (d Apr) counts legacy post 3.5h, ignores attendance', await p.evaluate(()=>{const r=calcPay(empById('d'),2026,4); return r.manualOt===3.5 && r.attPay===0;}));
  ok('anchor: posted month without attendance (d Mar) still counts post', await p.evaluate(()=>calcPay(empById('d'),2026,3).manualOt) === 1);
  ok('anchor: sheet rate override 2.00 used (d May)', near(await p.evaluate(()=>calcPay(empById('d'),2026,5).attPay), (11*60-480 + 7*60-480)/60*2));
  ok('anchor: incomplete day (in only) not counted', await p.evaluate(()=>calcAttendance(attSheet('a',2026,6),2026,6,1).worked) === 3);
  // SS percent
  await p.evaluate(()=>{ db.settings.ssPct = 7.5; }); db.settings.ssPct = 7.5;
  await cmp(p, db, 'a', 2026, 5, 'ss7.5'); await cmp(p, db, 'd', 2026, 5, 'ss7.5');
  await p.evaluate(()=>{ db.settings.ssPct = 0; }); db.settings.ssPct = 0;
  // Switch month a/May to manual → legacy post counts, attendance not
  await p.evaluate(()=>{ db.attendance['a|2026-05'].manual = true; }); db.attendance['a|2026-05'].manual = true;
  const man = await cmp(p, db, 'a', 2026, 5, 'switched-manual');
  ok('manual: no double count (otPay = (2-2.15)h × rate)', near(man.otPay, -0.15*290/30/8*1.25));
  await p.evaluate(()=>{ delete db.attendance['a|2026-05'].manual; }); delete db.attendance['a|2026-05'].manual;
  // Global off
  await p.evaluate(()=>{ db.settings.autoAtt = false; }); db.settings.autoAtt = false;
  for(const id of ['a','d']) for(const m of [4,5,6]) await cmp(p, db, id, 2026, m, 'global-off');
  await p.evaluate(()=>{ db.settings.autoAtt = true; }); db.settings.autoAtt = true;
  // Change attendance after payroll is calculated (via UI)
  await p.evaluate(()=>{ state.tab='attendance'; state.attEmp='a'; state.y=2026; state.m=5; render(); });
  const before = (await appPay(p,'a',2026,5)).net;
  await p.click('[data-day-edit="a|2"]');
  await p.selectOption('dialog [data-tf=out] .tf-h','21');
  await p.click('dialog button[value=ok]'); await p.waitForTimeout(260);
  db.attendance['a|2026-05'].days[2].out = '21:00';
  const after = await cmp(p, db, 'a', 2026, 5, 'after-edit');
  ok('live: net changed after attendance edit', !near(before, after.net), `${before} → ${after.net}`);
  ok('live: payroll screen total = sum of live nets', await p.evaluate(()=>{ state.tab='payroll'; render(); const t = empsForMonth(2026,5).reduce((s,e)=>s+calcPay(e,2026,5).net,0); return num(document.querySelector('.hero .value bdi').textContent) === fix(t); }));
  // Manual mode via UI then post → replaces legacy post, still no double count
  await p.evaluate(()=>{ state.tab='attendance'; render(); });
  await p.click('#hdrAct [data-act=att-menu]'); await p.click('#ask .menu-list button:nth-child(1)'); await p.waitForTimeout(300);
  await p.click('dialog [name=autoPay]'); await p.click('dialog button[value=ok]'); await p.waitForTimeout(260);
  ok('ui: month switched to manual', await p.evaluate(()=>attSheet('a',2026,5).manual === true));
  ok('ui: post button visible in manual mode', await p.isVisible('[data-act=post-ot]'));
  await p.click('[data-act=post-ot]'); await p.waitForSelector('#ask[open]:not(.closing) [data-r]'); await p.click('#ask [data-r="1"]'); await p.waitForTimeout(50);
  const posts = await p.evaluate(()=>db.overtime.filter(o=>o.empId==='a'&&o.date.startsWith('2026-05')&&o.note==='من حاسبة الدوام').map(o=>o.hours));
  ok('ui: re-post replaces (one post record)', posts.length === 1, JSON.stringify(posts));
  const manNet = (await appPay(p,'a',2026,5)).net;
  await p.evaluate(()=>{ delete db.attendance['a|2026-05'].manual; });
  ok('auto vs manual-after-post give same net (±rounding)', near(manNet, (await appPay(p,'a',2026,5)).net, 0.02), `${manNet}`);
  ok('no page errors (calc)', !p.errs.length, p.errs.join('|')); await p.close();

  /* ===== Number parsing ===== */
  p = await fresh(ctx, null);
  const parsed = await p.evaluate(()=>['٢٩٠','1,290','1,290.50','12,5','٣٫٥','1.5','-2','٬1٬290'].map(num));
  ok('parse ٢٩٠', parsed[0]===290); ok('parse 1,290 (thousands)', parsed[1]===1290, parsed[1]); ok('parse 1,290.50', parsed[2]===1290.5, parsed[2]);
  ok('parse 12,5 (decimal comma)', parsed[3]===12.5, parsed[3]); ok('parse ٣٫٥', parsed[4]===3.5); ok('parse -2', parsed[6]===-2);
  await p.close();

  await b.close();
  done();
})().catch(e => { console.error(e); process.exit(1); });
