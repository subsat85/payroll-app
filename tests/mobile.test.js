// Touch targets, bottom sheets, swipe, keyboard-height sheets, scrolling, dark-mode contrast.
// Run: npm test  (or: node mobile.test.js). RM=1 runs with prefers-reduced-motion.
const fs = require('fs'), os = require('os'), path = require('path');
const O = require('./oracle'), FX = require('./fixtures');
const { launch, suite, fresh, VIEWS } = require('./lib');
const { ok, near, done } = suite('mobile');

(async () => {
  const b = await launch();
  const ctx = await b.newContext({viewport:{width:390,height:844}, hasTouch:false, permissions:['clipboard-read','clipboard-write']});
  let db, p;
  /* ===== 5. Mobile interaction ===== */
  db = FX(); p = await fresh(ctx, db, {tab:'home'});
  const small = async (where) => p.evaluate(where => {
    const els = [...document.querySelectorAll(`${where} button, ${where} a[href], ${where} select, ${where} input:not([type=hidden]):not([type=checkbox]):not([type=file]), ${where} label.check, ${where} summary`)]
      .filter(e => e.offsetParent !== null || e.closest('dialog[open]'));
    return els.map(e=>{ const r=e.getBoundingClientRect(); return {t:(e.textContent||e.getAttribute('aria-label')||e.tagName).trim().slice(0,24), h:Math.round(r.height), w:Math.round(r.width)}; }).filter(x=>x.h && (x.h<44 || x.w<44));
  }, where);
  const allSmall = {};
  for(const t of VIEWS.concat(['profile'])){ await p.evaluate(([t])=>{ state.tab=t; state.profile='a'; state.attEmp='a'; state.y=2026; state.m=5; render(); }, [t]); const s = await small('body'); if(s.length) allSmall[t]=s; }
  // inside sheets
  await p.evaluate(()=>{ state.tab='attendance'; render(); }); await p.click('[data-day-edit="a|1"]'); await p.evaluate(()=>document.querySelector('dialog details').open=true);
  const sDay = await small('#dlg'); if(sDay.length) allSmall['sheet:day'] = sDay; await p.keyboard.press('Escape'); await p.waitForTimeout(260);
  ok('44px: every touch target ≥44×44', !Object.keys(allSmall).length, JSON.stringify(allSmall).slice(0,900));
  // bottom sheet: footer visible when content is tall + small viewport (keyboard-like)
  await p.setViewportSize({width:390, height:420});
  await p.evaluate(()=>{ state.tab='employees'; render(); }); await p.click('#hdrAct [data-act=add-emp]'); await p.evaluate(()=>document.querySelector('dialog details').open=true);
  await p.focus('dialog [name=name]'); await p.waitForTimeout(320);
  ok('sheet: save button visible at 420px height', await p.evaluate(()=>{ const r=document.querySelector('#dlg .sheet-foot .primary').getBoundingClientRect(); return r.bottom <= innerHeight && r.top >= 0; }));
  ok('sheet: content scrolls inside sheet', await p.evaluate(()=>{ const d=document.querySelector('#dlg'); return d.scrollHeight > d.clientHeight; }));
  await p.keyboard.press('Escape'); await p.waitForTimeout(260); await p.setViewportSize({width:390, height:844});
  // swipe to close
  await p.evaluate(()=>{ state.tab='attendance'; render(); }); await p.click('[data-day-edit="a|1"]'); await p.waitForTimeout(320);
  const g = await p.evaluate(()=>{ const r=document.querySelector('#dlg .sheet-grab').getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2}; });
  await p.mouse.move(g.x,g.y); await p.mouse.down(); await p.mouse.move(g.x,g.y+40,{steps:4}); await p.mouse.up();
  await p.waitForTimeout(250); ok('swipe: short drag keeps sheet open & resets', await p.evaluate(()=>$('#dlg').open && $('#dlg').style.transform==='' && getComputedStyle($('#dlg')).transform.replace(/matrix\(1, 0, 0, 1, 0, 0\)/,'none')==='none'));
  await p.mouse.move(g.x,g.y); await p.mouse.down(); await p.mouse.move(g.x,g.y+160,{steps:6}); await p.mouse.up(); await p.waitForTimeout(300);
  ok('swipe: long drag closes sheet', await p.evaluate(()=>!$('#dlg').open));
  ok('swipe: no unsaved data written by closing', await p.evaluate(()=>attSheet('a',2026,5).days[1].out) === '00:15');
  // backdrop tap closes; tapping inside doesn't
  await p.click('[data-day-edit="a|1"]'); await p.click('#dlg .sheet-body h3');
  ok('sheet: tap inside does not close', await p.evaluate(()=>$('#dlg').open));
  await p.mouse.click(195, 30); await p.waitForTimeout(300);
  ok('sheet: tap backdrop closes', await p.evaluate(()=>!$('#dlg').open));
  // save button in sheet persists
  await p.click('[data-day-edit="a|9"]'); await p.selectOption('dialog [data-tf=in] .tf-h','08'); await p.selectOption('dialog [data-tf=out] .tf-h','17');
  ok('time field: picking hour fills minutes 00', await p.evaluate(()=>document.querySelector('#dlg [name=in]').value) === '08:00');
  await p.selectOption('dialog [data-tf=out] .tf-m','30'); await p.click('dialog button[value=ok]'); await p.waitForTimeout(260);
  ok('sheet save persisted', await p.evaluate(()=>JSON.parse(localStorage.getItem('payroll-app-v1')).attendance['a|2026-05'].days[9].out) === '17:30');
  await p.click('[data-day-edit="a|9"]'); await p.selectOption('dialog [data-tf=in] .tf-h',''); 
  ok('time field: clearing hour clears value', await p.evaluate(()=>document.querySelector('#dlg [name=in]').value) === '');
  await p.keyboard.press('Escape'); await p.waitForTimeout(260);
  // page scroll works & bottom nav does not cover last row
  await p.evaluate(()=>window.scrollTo(0, document.body.scrollHeight)); await p.waitForTimeout(50);
  ok('scroll: last day row fully above bottom nav', await p.evaluate(()=>{ const rows=document.querySelectorAll('.day'); const r=rows[rows.length-1].getBoundingClientRect(); return r.bottom <= document.querySelector('#tabs').getBoundingClientRect().top; }));
  ok('no page errors (mobile)', !p.errs.length, p.errs.join('|')); await p.close();

  /* ===== dark mode smoke ===== */
  const dctx = await b.newContext({viewport:{width:390,height:844}, colorScheme:'dark'});
  p = await fresh(dctx, FX(), {tab:'payroll', y:2026, m:5});
  ok('dark: primary button contrast ≥4.5', await p.evaluate(()=>{ const s=getComputedStyle(document.documentElement); const L=h=>{const n=parseInt(h.trim().slice(1),16); return [n>>16,(n>>8)&255,n&255].map(c=>{c/=255;return c<=.03928?c/12.92:((c+.055)/1.055)**2.4}).reduce((a,c,i)=>a+c*[.2126,.7152,.0722][i],0)}; const a=L(s.getPropertyValue('--brand-fill')), b=1; return (b+.05)/(a+.05) >= 4.5; }));
  ok('no page errors (dark)', !p.errs.length, p.errs.join('|'));
  await b.close();
  done();
})().catch(e => { console.error(e); process.exit(1); });
