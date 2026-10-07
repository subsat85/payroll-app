// Arabic RTL: visual order of negatives, currency, times, dates, counters; long names; overflow.
// Run: npm test  (or: node rtl.test.js). RM=1 runs with prefers-reduced-motion.
const fs = require('fs'), os = require('os'), path = require('path');
const O = require('./oracle'), FX = require('./fixtures');
const { launch, suite, fresh, VIEWS } = require('./lib');
const { ok, near, done } = suite('rtl');

(async () => {
  const b = await launch();
  const ctx = await b.newContext({viewport:{width:390,height:844}, hasTouch:false, permissions:['clipboard-read','clipboard-write']});
  let db, p;
  /* ===== 4. RTL ===== */
  db = FX(); db.employees.push({id:'e',name:'عبد الرحمن بن عبد العزيز بن محمد آل عبد اللطيف الطويل جداً',title:'مدير قسم المبيعات والتسويق الإقليمي',hire:'2026-01-01',salary:'1234.5',hours:'8'});
  p = await fresh(ctx, db, {tab:'attendance', attEmp:'a', y:2026, m:5});
  // visual order helper: returns x of first and last character of an element's text
  const order = sel => p.evaluate(sel => { const el = document.querySelector(sel); if(!el) return null; const t = el.firstChild && el.firstChild.nodeType===3 ? el.firstChild : el; const r = document.createRange();
    const node = t.nodeType===3 ? t : t.firstChild; const L = node.textContent.length; r.setStart(node,0); r.setEnd(node,1); const a = r.getBoundingClientRect().x; r.setStart(node,L-1); r.setEnd(node,L); const z = r.getBoundingClientRect().x; return {text:node.textContent, first:a, last:z}; }, sel);
  let o = await order('.hero .value bdi');
  ok('RTL: negative hours "-2:09" reads left→right with minus first', o && o.text.startsWith('-') && o.first < o.last, JSON.stringify(o));
  o = await order('.hero .sub .money bdi');
  ok('RTL: negative money "-3.25" minus on the left', o && o.text.startsWith('-') && o.first < o.last, JSON.stringify(o));
  ok('RTL: currency sits left of the number', await p.evaluate(()=>{ const m = document.querySelector('.hero .sub .money'); return m.querySelector('.cur').getBoundingClientRect().x < m.querySelector('bdi').getBoundingClientRect().x; }));
  ok('RTL: day row times in→out read right-to-left (15:00 right of 00:15)', await p.evaluate(()=>{ const b = document.querySelectorAll('.day')[0].querySelectorAll('.t bdi'); return b[0].textContent==='15:00' && b[0].getBoundingClientRect().x > b[1].getBoundingClientRect().x; }));
  ok('RTL: each time is LTR (15:00 not 00:51)', (await order('.day .t bdi')).first < (await order('.day .t bdi')).last);
  await p.evaluate(()=>{ state.tab='payroll'; render(); });
  ok('RTL: "x / y" counter keeps order', await p.evaluate(()=>{ const bd = [...document.querySelectorAll('.kv bdi')].find(x=>x.textContent.includes('/')); const r = document.createRange(); r.setStart(bd.firstChild,0); r.setEnd(bd.firstChild,1); const a = r.getBoundingClientRect().x; const L = bd.textContent.length; r.setStart(bd.firstChild,L-1); r.setEnd(bd.firstChild,L); return a < r.getBoundingClientRect().x; }));
  await p.evaluate(()=>{ state.tab='profile'; state.profile='d'; render(); });
  ok('RTL: date 2024-06-01 reads LTR', await p.evaluate(()=>{ const bd = [...document.querySelectorAll('dd bdi')].find(x=>/^\d{4}-/.test(x.textContent)); const r=document.createRange(); r.setStart(bd.firstChild,0); r.setEnd(bd.firstChild,1); const a=r.getBoundingClientRect().x; r.setStart(bd.firstChild,9); r.setEnd(bd.firstChild,10); return a < r.getBoundingClientRect().x; }));
  // long names: truncate, no overflow, on every screen + 320px
  for(const w of [320,375,390]){
    await p.setViewportSize({width:w, height:740});
    for(const t of VIEWS.concat(['profile'])){
      await p.evaluate(([t])=>{ state.tab=t; state.profile='e'; state.attEmp='e'; state.y=2026; state.m=5; render(); }, [t]);
      const sw = await p.evaluate(()=>document.documentElement.scrollWidth);
      ok(`no horizontal overflow ${t} @${w}`, sw <= w, `${sw}`);
    }
  }
  await p.setViewportSize({width:390, height:844});
  await p.evaluate(()=>{ state.tab='employees'; render(); });
  ok('long name truncated with ellipsis in list', await p.evaluate(()=>{ const el=[...document.querySelectorAll('.row .info b')].find(x=>x.textContent.includes('الطويل')); return el.scrollWidth > el.clientWidth && getComputedStyle(el).textOverflow==='ellipsis'; }));
  await p.evaluate(()=>{ state.tab='attendance'; state.attEmp='e'; render(); });
  ok('long name truncated in picker', await p.evaluate(()=>{ const el=document.querySelector('.picker b'); return el.scrollWidth > el.clientWidth; }));
  await p.evaluate(()=>{ state.tab='profile'; state.profile='e'; render(); });
  ok('header title truncates', await p.evaluate(()=>{ const h=document.querySelector('#hdrTitle'); return h.scrollWidth >= h.clientWidth && getComputedStyle(h).textOverflow==='ellipsis'; }));
  ok('profile title does not overflow', await p.evaluate(()=>document.documentElement.scrollWidth) <= 390);
  ok('no page errors (rtl)', !p.errs.length, p.errs.join('|')); await p.close();

  await b.close();
  done();
})().catch(e => { console.error(e); process.exit(1); });
