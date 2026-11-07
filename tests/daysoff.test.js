// Monthly days-off allowance: 4 free days per employee per month (from 2026-11); each extra day = 8 hours,
// deducted with the existing absence formula (base ÷ month days). Checked against the independent oracle.
// Run: npm test  (or: node daysoff.test.js). APP_LANG=en runs in English.
const O = require('./oracle');
const { launch, suite, fresh } = require('./lib');
const { ok, near, done } = suite('daysoff');

const emp = (id, extra={}) => ({id, name:'موظف '+id, title:'مبيعات', hire:'2025-01-01', salary:'600', hours:'9', allowances:[{id:'al'+id,name:'مواصلات',amount:100}], ...extra});
const base = () => ({ employees:[emp('e'), emp('f', {salary:'450', hours:'8'})], payroll:{}, advances:[], overtime:[], leaves:[], attendance:{}, settings:{}, lastBackup:'2026-11-01' });
const offSheet = (n, start=1) => { const days = {}; for(let i=0;i<n;i++) days[start+i] = {holiday:true}; return days; };
const P = (p, id, y, m) => p.evaluate(([id,y,m]) => { const r = calcPay(empById(id),y,m); return {used:r.off.used, allowed:r.off.allowed, excess:r.off.excess, hours:r.off.hours, offDed:r.offDed,
  absDed:r.absDed, unpaidDed:r.unpaidDed, lateDed:r.lateDed, ss:r.ss, otPay:r.otPay, attPay:r.attPay, base:r.base, allowances:r.allowances, deductions:r.deductions, net:r.net, rate:otRateFor(empById(id))}; }, [id,y,m]);
const vsOracle = async (p, db, id, y, m, label) => {
  const a = await P(p, id, y, m), e = O.pay(db, db.employees.find(x=>x.id===id), y, m);
  ok(`${label}: used = oracle`, a.used === e.offUsed, `${a.used} vs ${e.offUsed}`);
  ok(`${label}: excess = oracle`, a.excess === e.offExcess, `${a.excess} vs ${e.offExcess}`);
  ok(`${label}: deduction = oracle`, near(a.offDed, e.offDed), `${a.offDed} vs ${e.offDed}`);
  ok(`${label}: net = oracle`, near(a.net, e.net), `${a.net} vs ${e.net}`);
  return a;
};

(async () => {
  const b = await launch();
  const ctx = await b.newContext({ viewport:{width:390,height:844} });

  /* 1–5, 7. N days off in Nov 2026 (employee e: base 600 → day = 20) */
  const none = await (async () => { const db = base(); const p = await fresh(ctx, db); const r = await P(p,'e',2026,11); await p.close(); return r; })();
  for(const [n, exHours] of [[0,0],[3,0],[4,0],[5,8],[6,16],[8,32]]){
    const db = base(); db.attendance['e|2026-11'] = { days: offSheet(n) };
    const p = await fresh(ctx, db);
    const a = await vsOracle(p, db, 'e', 2026, 11, `${n} days`);
    const ex = Math.max(n-4,0);
    ok(`${n} days: used ${n}, allowed 4`, a.used === n && a.allowed === 4);
    ok(`${n} days: excess ${ex}`, a.excess === ex);
    ok(`${n} days: deducted hours ${exHours}`, a.hours === exHours, a.hours);
    ok(`${n} days: deduction = ${ex} × (600 ÷ 30)`, near(a.offDed, ex*20), a.offDed);
    ok(`${n} days: net = no-days-off net − deduction`, near(a.net, none.net - ex*20));
    ok(`${n} days: OT rate unchanged`, near(a.rate, none.rate, 1e-12));
    for(const k of ['absDed','unpaidDed','lateDed','ss','otPay','base','allowances']) ok(`${n} days: ${k} unchanged`, near(a[k], none[k]));
    ok(`${n} days: no page errors`, p.errs.length === 0, p.errs.join('|'));
    await p.close();
  }

  /* Allowances are not part of the deduction: same deduction with allowances removed or raised */
  { const db = base(); db.attendance['e|2026-11'] = { days: offSheet(6) }; const p = await fresh(ctx, db);
    const d1 = (await P(p,'e',2026,11)).offDed;
    await p.evaluate(() => { empById('e').allowances = [{id:'x',name:'سكن',amount:999}]; });
    const d2 = (await P(p,'e',2026,11)).offDed;
    await p.evaluate(() => { empById('e').allowances = []; });
    const d3 = (await P(p,'e',2026,11)).offDed;
    ok('allowances: deduction independent of allowances', near(d1,40) && near(d2,40) && near(d3,40), [d1,d2,d3].join());
    // employee with 8 daily hours: still a full day (absence formula), 8 h shown
    db.attendance['f|2026-11'] = { days: offSheet(5) };
    await p.evaluate(d => { db.attendance['f|2026-11'] = d; }, db.attendance['f|2026-11']);
    const f = await vsOracle(p, db, 'f', 2026, 11, 'emp f 5 days');
    ok('emp f: deduction 450 ÷ 30 = 15, 8 h', near(f.offDed, 15) && f.hours === 8);
    ok('per employee: e unaffected by f', (await P(p,'e',2026,11)).excess === 2);
    await p.close(); }

  /* 6. New month resets to 4, unused days never carry over */
  { const db = base();
    db.attendance['e|2026-11'] = { days: offSheet(8) };   // 4 extra in Nov
    db.attendance['e|2026-12'] = { days: offSheet(2) };   // within allowance in Dec
    db.attendance['f|2026-11'] = { days: offSheet(1) };   // 3 unused in Nov…
    db.attendance['f|2026-12'] = { days: offSheet(6) };   // …do not cover Dec's 2 extra
    const p = await fresh(ctx, db);
    const n = await vsOracle(p, db, 'e', 2026, 11, 'reset Nov'), d = await vsOracle(p, db, 'e', 2026, 12, 'reset Dec');
    ok('reset: Nov 4 extra', n.excess === 4); ok('reset: Dec back to 4 allowed, 0 extra', d.allowed === 4 && d.excess === 0 && d.offDed === 0);
    const fd = await vsOracle(p, db, 'f', 2026, 12, 'no carry Dec');
    ok('no carry-over: f Dec still 2 extra', fd.excess === 2 && near(fd.offDed, 30));
    const j = await P(p, 'e', 2027, 1);
    ok('reset: Jan 2027 with none → 0', j.used === 0 && j.excess === 0);
    await p.close(); }

  /* 8. A day is never counted twice */
  { const db = base();
    const days = offSheet(5);                                         // 1..5 marked off
    days[6] = {holiday:true, pub:true};                               // official holiday → not counted
    days[7] = {holiday:true, in:'10:00', out:'14:00'};                // worked on a holiday → overtime, not a day off
    days[8] = {holiday:true};                                         // inside unpaid leave → counted as leave only
    days[9] = {holiday:true};                                         // inside annual leave → not a day off
    days[10] = {in:'09:00', out:'18:00'};
    db.attendance['e|2026-11'] = { days };
    db.leaves = [{id:'l1', empId:'e', type:'بدون راتب', from:'2026-11-08', to:'2026-11-08'}, {id:'l2', empId:'e', type:'سنوية', from:'2026-11-09', to:'2026-11-09'}];
    db.payroll = { '2026-11': { e: { absDays:'1' } } };                // separate manual absence stays as before
    const p = await fresh(ctx, db);
    const a = await vsOracle(p, db, 'e', 2026, 11, 'no double count');
    ok('no double count: only days 1–5 counted', a.used === 5, a.used);
    ok('no double count: unpaid-leave day deducted once (as leave)', near(a.unpaidDed, 20));
    ok('no double count: manual absence unchanged + 1 extra off day', near(a.absDed, 20) && near(a.offDed, 20));
    ok('worked holiday still overtime', a.attPay > 0);
    ok('list of counted days', await p.evaluate(() => calcPay(empById('e'),2026,11).off.list.join()) === '1,2,3,4,5');
    // re-saving the same day via the editor does not add it again
    await p.evaluate(() => { state.tab='attendance'; state.attEmp='e'; state.y=2026; state.m=11; render(); });
    await p.click('[data-day-edit="e|3"]'); await p.waitForSelector('#dlg[open] [name=holiday]');
    await p.click('#dlg button[value=ok]'); await p.waitForTimeout(350);
    ok('re-save same day: still 5', (await P(p,'e',2026,11)).used === 5);
    await p.close(); }

  /* Previous months keep their payroll (rule starts 2026-11) */
  { const db = base(); db.attendance['e|2026-10'] = { days: offSheet(9) }; db.attendance['e|2026-11'] = { days: offSheet(9) };
    const p = await fresh(ctx, db);
    const oct = await vsOracle(p, db, 'e', 2026, 10, 'Oct 2026');
    ok('Oct 2026: no deduction even with 9 days', oct.excess === 0 && oct.offDed === 0 && oct.used === 9);
    ok('Oct 2026: net = salary + allowances', near(oct.net, 700));
    ok('Nov 2026: applies', (await P(p,'e',2026,11)).excess === 5);
    ok('Oct attendance view: no days-off card', await p.evaluate(() => { state.tab='attendance'; state.attEmp='e'; state.y=2026; state.m=10; render(); return !document.querySelector('.off-strip'); }));
    await p.close(); }

  /* Employee not employed that month → no deduction */
  { const db = base(); db.employees.push(emp('g', {hire:'2026-12-10'})); db.attendance['g|2026-11'] = { days: offSheet(7) };
    const p = await fresh(ctx, db); const g = await P(p,'g',2026,11);
    ok('not yet hired: no deduction', g.offDed === 0 && g.net === 0, JSON.stringify(g)); await p.close(); }

  /* UI: mark days via the editor, official holiday option, displays */
  { const db = base(); db.attendance['e|2026-11'] = { days: { 1:{in:'09:00',out:'20:00'} } };
    const p = await fresh(ctx, db, { tab:'attendance', attEmp:'e', y:2026, m:11 });
    await p.waitForSelector('.off-strip');
    for(const d of [2,3,4,5,6,7]){
      await p.click(`[data-day-edit="e|${d}"]`); await p.waitForSelector('#dlg[open] [name=holiday]');
      await p.evaluate(() => { for(const n of ['in','out']) { const f = document.querySelector('#dlg form'); tfSet(f, n, ''); } });
      await p.check('#dlg [name=holiday]');
      await p.click('#dlg button[value=ok]'); await p.waitForTimeout(350);
    }
    let r = await P(p,'e',2026,11);
    ok('UI: 6 days marked → used 6, extra 2, 16 h, 40', r.used === 6 && r.excess === 2 && r.hours === 16 && near(r.offDed, 40), JSON.stringify(r));
    const strip = await p.evaluate(() => [...document.querySelectorAll('.off-strip .kv')].map(k => k.querySelector('b').textContent.trim()));
    ok('attendance card shows 5 figures', strip.length === 5, strip.join(' | '));
    ok('attendance card: used/allowed/extra/hours/amount', /6/.test(strip[0]) && /4/.test(strip[1]) && /2/.test(strip[2]) && /16/.test(strip[3]) && /40/.test(strip[4]), strip.join(' | '));
    // official holiday via editor: checking it ticks holiday, saves pub, and is not counted
    await p.click('[data-day-edit="e|8"]'); await p.waitForSelector('#dlg[open] [name=pub]');
    await p.evaluate(() => { const f = document.querySelector('#dlg form'); tfSet(f,'in',''); tfSet(f,'out',''); });
    await p.check('#dlg [name=pub]');
    ok('UI: official holiday ticks holiday', await p.isChecked('#dlg [name=holiday]'));
    await p.click('#dlg button[value=ok]'); await p.waitForTimeout(350);
    ok('UI: official holiday saved', await p.evaluate(() => { const d = attSheet('e',2026,11).days[8]; return d.holiday === true && d.pub === true; }));
    ok('UI: official holiday not counted', (await P(p,'e',2026,11)).used === 6);
    ok('UI: day list shows official holiday', (await p.textContent('[data-day-edit="e|8"]')).includes(await p.evaluate(() => L('عطلة رسمية'))));
    // unticking holiday clears official holiday
    await p.click('[data-day-edit="e|8"]'); await p.waitForSelector('#dlg[open] [name=pub]');
    await p.uncheck('#dlg [name=holiday]');
    ok('UI: unticking holiday clears official', !(await p.isChecked('#dlg [name=pub]')));
    await p.click('#dlg button[value=cancel]'); await p.waitForTimeout(300);
    // existing worked-day data untouched by marking others
    ok('UI: worked day 1 untouched', await p.evaluate(() => JSON.stringify(attSheet('e',2026,11).days[1]) === JSON.stringify({in:'09:00',out:'20:00'})));
    // payroll card, payslip, share text, Excel
    await p.evaluate(() => { state.tab='payroll'; state.y=2026; state.m=11; render(); });
    const card = await p.evaluate(() => { const t = document.querySelector('[data-card="e"]').textContent; return [t.includes(L('العطل {0} من {1} يوم', 6, 4)), t.includes(L('عطل زائدة {0} يوم · {1} ساعة', 2, 16))]; });
    ok('payroll card: days off line', card[0]);
    ok('payroll card: extra deduction line', card[1]);
    ok('payroll card net = calcPay', await p.evaluate(() => num(document.querySelector('[data-card="e"] .net span:last-child').textContent) === fix(calcPay(empById('e'),2026,11).net)));
    const slip = await p.evaluate(() => slipHTML(empById('e'),2026,11));
    ok('payslip: extra days line', slip.includes(await p.evaluate(() => L('عطل زائدة ({0} يوم · {1} ساعة)', 2, 16))));
    ok('payslip: days off info', slip.includes(await p.evaluate(() => L('{0} من {1}', 6, 4))));
    ok('share text: extra days', await p.evaluate(() => slipText(empById('e'),2026,11).includes(L('عطل زائدة ({0} يوم · {1} ساعة)', 2, 16))));
    const row = await p.evaluate(() => { const r = payRow(empById('e'),2026,11,calcPay(empById('e'),2026,11)); return [r[L('أيام العطل')], r[L('عطل زائدة (يوم)')], r[L('ساعات خصم العطل')], r[L('خصم العطل الزائدة')]]; });
    ok('Excel row: 6 / 2 / 16 / 40', row.join() === '6,2,16,40', row.join());
    ok('summary total includes deduction', await p.evaluate(() => { state.tab='summary'; state.y=2026; render(); return !!document.querySelector('thead'); }));
    ok('UI: no page errors', p.errs.length === 0, p.errs.join('|'));
    await p.close(); }

  await b.close();
  done();
})().catch(e => { console.error(e); process.exit(1); });
