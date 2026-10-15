// English UI (LTR): every screen, sheet, confirm, alert and toast must be fully translated (no Arabic left except
// the bilingual language switch and user data), the layout must mirror correctly, the language must persist,
// and payroll results must be identical in both languages. Stored data is never translated.
const O = require('./oracle'), FX = require('./fixtures');
const { APP_URL, launch, suite, VIEWS, askReady } = require('./lib');
const { ok, near, done } = suite('i18n');
const AR = /[؀-ۿ]/;
const ALLOWED = ['العربية', 'اللغة · Language', 'اللغة'];    // bilingual language switch only

// Same legacy data, but with Latin names/titles/notes so any Arabic left on screen is an untranslated UI string.
function latin(){
  const d = FX();
  const names = {a:'Omar Haddad', b:'Sami Nasser', c:'Mohammad Abdullah Ibrahim Abdulrahim Al-Ahmad', d:'Layla Khoury'};
  d.employees.forEach(e => { e.name = names[e.id]; e.title = 'Sales'; });
  d.payroll['2026-05'].a.note = 'note';
  d.overtime.find(o => o.id === 'o2').note = 'manual';
  return d;
}
async function open(ctx, data, ui, lang){
  const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
  await p.emulateMedia({ reducedMotion: process.env.RM ? 'reduce' : 'no-preference' });
  await p.goto(APP_URL);
  await p.evaluate(([d, u, lang]) => { localStorage.clear(); if(d) localStorage.setItem('payroll-app-v1', JSON.stringify(d)); if(lang) localStorage.setItem('payroll-lang', lang); sessionStorage.setItem('payroll-ui', JSON.stringify(u)); }, [data, ui, lang]);
  await p.reload(); return p;
}
// Arabic text visible to the user (text nodes + placeholder/aria-label/title), excluding the bilingual switch
const leftovers = p => p.evaluate(([allowed]) => {
  const AR = /[؀-ۿ]/, out = [];
  const roots = [document.querySelector('header'), document.querySelector('#view'), document.querySelector('#tabs'), document.querySelector('#alerts'), document.querySelector('#toast'), ...document.querySelectorAll('dialog[open]')];
  for(const r of roots){ if(!r) continue;
    const w = document.createTreeWalker(r, NodeFilter.SHOW_TEXT); let n;
    while((n = w.nextNode())){ const t = n.textContent.trim(); if(t && AR.test(t) && !allowed.includes(t) && !n.parentElement.closest('option[value="ar"]')) out.push(t); }
    r.querySelectorAll('[placeholder],[aria-label],[title]').forEach(el => ['placeholder','aria-label','title'].forEach(a => { const v = el.getAttribute(a); if(v && AR.test(v)) out.push(`@${a}=${v}`); }));
  }
  if(AR.test(document.title)) out.push('title=' + document.title);
  return [...new Set(out)];
}, [ALLOWED]);

(async () => {
  const b = await launch();
  for(const [scheme, w] of [['light', 390], ['dark', 375], ['light', 320]]){
    const tag = `[en ${scheme} ${w}]`;
    const ctx = await b.newContext({ viewport: { width: w, height: 760 }, colorScheme: scheme, permissions: ['clipboard-read','clipboard-write'] });
    const data = latin();
    const p = await open(ctx, data, { tab: 'home', y: 2026, m: 5, attEmp: 'a', profile: 'a' }, 'en');
    await p.evaluate(() => localStorage.setItem('payroll-app-snapshots', JSON.stringify([{at:'2026-05-01T10:00:00Z', day:'2026-05-01', reason:'تلقائية يومية', n:4, data:'{}'}])));
    ok(`${tag} html is lang=en dir=ltr`, await p.evaluate(() => document.documentElement.lang === 'en' && document.documentElement.dir === 'ltr'));
    // every screen
    for(const t of VIEWS.concat(['profile'])){
      await p.evaluate(([t]) => { state.tab = t; state.y = 2026; state.m = 5; state.attEmp = 'a'; state.profile = 'a'; render(); }, [t]);
      const left = await leftovers(p);
      ok(`${tag} screen ${t}: fully English`, left.length === 0, left.join(' | '));
      ok(`${tag} screen ${t}: no horizontal overflow`, await p.evaluate(() => document.documentElement.scrollWidth) <= w);
    }
    await p.evaluate(() => { localStorage.removeItem('payroll-app-v1'); db = structuredClone(DEFAULTS); state.tab = 'home'; render(); });
    ok(`${tag} welcome screen: fully English`, (await leftovers(p)).length === 0, (await leftovers(p)).join(' | '));
    await p.evaluate(([d]) => { db = normalize(d); save(true); }, [data]);
    // every sheet
    const sheets = { day:"editDay('a',3)", pay:"editPay('a')", slip:"showSlip('a')", emp:"editEmployee('a')", empNew:"editEmployee()", adv:"editRecord('advances','v1')", ot:"editRecord('overtime','o1')", leave:"editLeave('l1')", attset:"(state.attEmp='a', attSettings())", qf:"(state.attEmp='a', quickFill())", pick:"pickEmployee()", paste:"pasteDialog()" };
    for(const [k, code] of Object.entries(sheets)){
      await p.evaluate(code); await p.waitForTimeout(30);
      await p.evaluate(() => document.querySelectorAll('#dlg details').forEach(d => d.open = true));
      const left = await leftovers(p);
      ok(`${tag} sheet ${k}: fully English`, left.length === 0, left.join(' | '));
      await p.evaluate(() => document.querySelector('#dlg').close()); await p.waitForTimeout(260);
    }
    // confirms, menus, alerts, toasts
    const asks = { restore:"restoreFrom(JSON.stringify({employees:[{id:'z',name:'z',hire:'2026-01-01',salary:'1',hours:'8'}]}))", wipe:"handleAct('wipe')", clear:"(state.attEmp='a',state.y=2026,state.m=5, handleAct('clear-att'))", attmenu:"(state.attEmp='a', handleAct('att-menu'))", profmenu:"(state.profile='a', handleAct('profile-menu'))", del:"deleteEmployee('a')", post:"(state.attEmp='d', state.y=2026, state.m=4, handleAct('post-ot'))" };
    for(const [k, code] of Object.entries(asks)){
      await p.evaluate(`void (${code})`); await askReady(p);
      const left = await leftovers(p);
      ok(`${tag} confirm ${k}: fully English`, left.length === 0, left.join(' | '));
      await p.evaluate(() => document.querySelector('#ask').close()); await p.waitForTimeout(260);
    }
    await p.evaluate(() => { for(const [k, f] of [['save-failed', ALERT.saveFailed()], ['storage-full', ALERT.storageFull()], ['corrupt', ALERT.corrupt()], ['newer', ALERT.newer(2)], ['no-storage', ALERT.noStorage()], ['restore-failed', ALERT.restoreFailed(parseBackup('x').error)]]) showAlert(k, f); snapshot(); toast(L('تم الحفظ'), true); });
    const la = await leftovers(p);
    ok(`${tag} alerts + toast: fully English`, la.length === 0, la.join(' | '));
    await p.evaluate(() => { alerts.clear(); renderAlerts(); });
    // stored data stays Arabic; only the display is translated
    await p.evaluate(() => { state.tab = 'leaves'; state.y = 2026; render(); });
    ok(`${tag} leave type shown in English`, await p.evaluate(() => document.querySelector('#view').textContent.includes('Unpaid')));
    ok(`${tag} stored leave types unchanged (Arabic)`, await p.evaluate(() => db.leaves.map(l => l.type).join() === 'بدون راتب,سنوية,سنوية,مرضية'));
    await p.evaluate(() => editLeave('l2')); await p.waitForTimeout(30);
    ok(`${tag} leave select: English labels, Arabic stored values`, await p.evaluate(() => { const o = [...document.querySelectorAll('#dlg [name=type] option')]; return o[0].textContent === 'Annual' && o[0].value === 'سنوية' && document.querySelector('#dlg [name=type]').value === 'سنوية'; }));
    await p.click('#dlg button[value=ok]'); await p.waitForTimeout(260);
    ok(`${tag} saving a leave in English keeps the Arabic value`, await p.evaluate(() => db.leaves.find(l => l.id === 'l2').type === 'سنوية'));
    ok(`${tag} currency shown as JOD, stored as د.أ`, await p.evaluate(() => { state.tab='payroll'; state.m=5; render(); return document.querySelector('.hero .cur').textContent === 'JOD' && db.settings.currency === 'د.أ'; }));
    // LTR mirroring
    await p.evaluate(() => { state.tab = 'profile'; state.profile = 'a'; render(); });
    ok(`${tag} back arrow mirrored to point left`, await p.evaluate(() => getComputedStyle(document.querySelector('#hdrBack .ico')).transform !== 'none'));
    await p.evaluate(() => { state.tab = 'attendance'; state.attEmp = 'a'; state.y = 2026; state.m = 5; render(); });
    ok(`${tag} negative hours read -2:09 left-to-right`, await p.evaluate(() => { const bd = document.querySelector('.hero .value bdi'); const r = document.createRange(); r.setStart(bd.firstChild, 0); r.setEnd(bd.firstChild, 1); const a = r.getBoundingClientRect().x; r.setStart(bd.firstChild, bd.textContent.length - 1); r.setEnd(bd.firstChild, bd.textContent.length); return bd.textContent.startsWith('-') && a < r.getBoundingClientRect().x; }));
    ok(`${tag} day rows: check-in time left of check-out`, await p.evaluate(() => { const t = document.querySelectorAll('.day')[0].querySelectorAll('.t bdi'); return t[0].getBoundingClientRect().x < t[1].getBoundingClientRect().x; }));
    ok(`${tag} day status bar on the left edge`, await p.evaluate(() => { const d = document.querySelector('.day.st-over'); return getComputedStyle(d, '::before').left === '0px'; }));
    ok(`${tag} currency to the right of the number`, await p.evaluate(() => { const m = document.querySelector('.hero .sub .money'); return m.querySelector('.cur').getBoundingClientRect().x > m.querySelector('bdi').getBoundingClientRect().x; }));
    if(!process.env.RM){
      await p.click('[data-mstep="1"]');
      ok(`${tag} next month slides in from the right`, await p.evaluate(() => [...document.querySelector('#view').children].filter(c => !c.classList.contains('ctx')).flatMap(c => c.getAnimations().map(a => a.effect.getKeyframes()[0].transform)).every(t => t.includes('translateX(12px)'))));
    }
    // payslip + Excel headers in English
    const slip = await p.evaluate(() => slipText(empById('a'), 2026, 5));
    ok(`${tag} payslip share text in English`, !AR.test(slip) && slip.startsWith('Payslip May 2026'), slip);
    ok(`${tag} Excel headers in English`, await p.evaluate(() => Object.keys(payRow(empById('a'),2026,5,calcPay(empById('a'),2026,5))).every(k => !/[؀-ۿ]/.test(k))));
    ok(`${tag} no page errors`, !p.errs.length, p.errs.join(' | '));
    await ctx.close();
  }

  // payroll results identical in Arabic and English for every employee and month
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const data = FX();
  const run = async lang => { const p = await open(ctx, data, { tab: 'payroll' }, lang); const r = await p.evaluate(() => { const o = {}; for(const e of db.employees) for(let m = 1; m <= 12; m++){ const c = calcPay(e, 2026, m); o[e.id + m] = [c.days, c.base, c.deductions, c.otPay, c.net].map(x => +x.toFixed(6)).join(); } return o; }); await p.close(); return r; };
  const ar = await run(null), en = await run('en');
  ok('payroll identical in Arabic and English (48 employee-months)', JSON.stringify(ar) === JSON.stringify(en));
  for(const id of ['a','b','c','d']) for(const m of [3,4,5,6]){
    const e = O.pay(data, data.employees.find(x => x.id === id), 2026, m);
    ok(`English payroll ${id} 2026-${m} matches oracle`, near(+en[id + m].split(',')[4], e.net));
  }
  // switching language: persists, is not stored in payroll data, and reloads into the other direction
  const p = await open(ctx, data, { tab: 'settings' }, null);
  ok('default language is Arabic (rtl)', await p.evaluate(() => document.documentElement.dir === 'rtl' && LANG === 'ar'));
  const before = await p.evaluate(() => localStorage.getItem('payroll-app-v1'));
  await Promise.all([p.waitForNavigation(), p.selectOption('[data-lang]', 'en')]);
  ok('switching to English reloads in LTR and stays on Settings', await p.evaluate(() => document.documentElement.dir === 'ltr' && state.tab === 'settings' && document.querySelector('#hdrTitle').textContent === 'Settings & data protection'));
  ok('language preference is not part of the payroll data', await p.evaluate(() => localStorage.getItem('payroll-app-v1')) === before && await p.evaluate(() => localStorage.getItem('payroll-lang')) === 'en');
  await p.reload();
  ok('English persists after reopening', await p.evaluate(() => LANG === 'en'));
  await p.evaluate(() => { state.tab = 'more'; render(); });
  await Promise.all([p.waitForNavigation(), p.click('[data-act=toggle-lang]')]);
  ok('More → language toggles back to Arabic (rtl)', await p.evaluate(() => LANG === 'ar' && document.documentElement.dir === 'rtl'));
  ok('backup payload has no language field', await p.evaluate(() => !('lang' in JSON.parse(exportPayload()).data) && !('lang' in db.settings)));
  ok('no page errors (switching)', !p.errs.length, p.errs.join(' | '));
  await b.close();
  done();
})().catch(e => { console.error(e); process.exit(1); });
