// Motion (Phase 3): sheet open/close/interrupt/swipe, toast undo bar, check-in and delivered feedback,
// directional month change, instant tabs, reduced-motion fallbacks, and the confirm-sheet race.
// Each case runs with motion on and with prefers-reduced-motion, in light/dark at 390/375px.
const FX = require('./fixtures');
const { APP_URL, launch, suite, askReady } = require('./lib');
const { ok, done } = suite('animation');
(async()=>{const b=await launch();
for (const [rm, scheme, w] of [['no-preference','light',390],['no-preference','dark',375],['no-preference','light',320],['reduce','light',390],['reduce','dark',375],['reduce','dark',320]]){
  const tag = `[${rm==='reduce'?'RM':'motion'} ${scheme} ${w}]`;
  const p=await b.newPage({viewport:{width:w,height:812}, colorScheme:scheme}); await p.emulateMedia({reducedMotion:rm}); p.errs=[]; p.on('pageerror',e=>p.errs.push(e.message));
  await p.goto(APP_URL);
  const d = FX(); const t=new Date(); const y=t.getFullYear(), m=t.getMonth()+1; d.employees.forEach(e=>{ if(e.endDate) delete e.endDate; });
  await p.evaluate(d=>{localStorage.clear();localStorage.setItem('payroll-app-v1',JSON.stringify(d));sessionStorage.setItem('payroll-ui',JSON.stringify({tab:'attendance',attEmp:'a',y:2026,m:5}))},d); await p.reload();
  const anims = sel => p.evaluate(sel=>{ const el=document.querySelector(sel); return el ? el.getAnimations().map(a=>({state:a.playState, dur:a.effect.getTiming().duration, ease:a.effect.getTiming().easing, frames:a.effect.getKeyframes().map(k=>({t:k.transform||null,o:k.opacity??null}))})) : null; }, sel);
  const noMove = list => list.every(a=>a.frames.every(f=>!f.t || f.t==='none'));
  // 1. sheet open
  await p.click('[data-day-edit="a|2"]'); const open = await anims('#dlg');
  ok(`${tag} sheet open animates`, open && open.length===1 && open[0].state==='running', JSON.stringify(open));
  if(rm==='reduce') ok(`${tag} sheet open is fade-only`, noMove(open), JSON.stringify(open));
  else ok(`${tag} sheet open slides from 100% with 280ms ease-out curve`, open[0].frames[0].t.includes('100%') && open[0].dur===280 && open[0].ease.includes('0.32'), JSON.stringify(open));
  await p.waitForTimeout(320);
  // 2. close: the real sheet closes at once (page interactive); a non-interactive copy animates out, then is removed
  await p.click('#dlg button[value=cancel]');
  const mid = await p.evaluate(()=>{ const g=document.querySelector('.sheet-ghost'), v=document.querySelector('.sheet-veil');
    return {open: document.querySelector('#dlg').open, ghost: !!g, veil: !!v, inert: !!g && getComputedStyle(g).pointerEvents==='none' && getComputedStyle(v).pointerEvents==='none' && g.inert===true,
      anim: g ? g.getAnimations().map(a=>a.effect.getKeyframes().map(k=>k.transform||k.opacity)) : null, ids: g ? g.querySelectorAll('[id],[name]').length : -1}; });
  ok(`${tag} cancel closes the real sheet immediately`, mid.open === false, JSON.stringify(mid));
  ok(`${tag} exit copy + backdrop fade play and cannot receive taps`, mid.ghost && mid.veil && mid.inert, JSON.stringify(mid));
  ok(`${tag} exit copy ${rm==='reduce'?'fades':'slides down'}`, rm==='reduce' ? JSON.stringify(mid.anim).includes('1') && !JSON.stringify(mid.anim).includes('translate') : JSON.stringify(mid.anim).includes('translateY'), JSON.stringify(mid.anim));
  ok(`${tag} exit copy has no duplicate ids/names`, mid.ids === 0);
  await p.waitForTimeout(260); ok(`${tag} exit copy removed after animation`, await p.evaluate(()=>!document.querySelector('.sheet-ghost') && !document.querySelector('.sheet-veil')));
  // 2b. a tap made during the exit animation reaches the page (no blocking)
  await p.click('[data-day-edit="a|2"]'); await p.waitForTimeout(320); await p.click('#dlg button[value=cancel]'); await p.waitForTimeout(30);
  const c5 = await p.evaluate(()=>{ const r=document.querySelector('[data-day-edit="a|5"]').getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2}; });
  await p.mouse.click(c5.x, c5.y); await p.waitForTimeout(320);
  ok(`${tag} tap during exit animation is not blocked`, await p.evaluate(()=>document.querySelector('#dlg').open && document.querySelector('#dlg h3').textContent.includes(' 5 ')));
  await p.click('#dlg button[value=cancel]'); await p.waitForTimeout(260);
  // 3. interrupt: reopen while closing
  await p.click('[data-day-edit="a|2"]'); await p.waitForTimeout(320); await p.click('#dlg button[value=cancel]'); await p.waitForTimeout(40);
  await p.evaluate(()=>editDay('a',3)); await p.waitForTimeout(350);
  ok(`${tag} reopening mid-close works and stays open`, await p.evaluate(()=>{ const d=document.querySelector('#dlg'); return d.open && d.textContent.includes('3'); }));
  // 4. save closes with animation and persists
  await p.selectOption('dialog [data-tf=in] .tf-h','10'); await p.selectOption('dialog [data-tf=out] .tf-h','19'); await p.click('#dlg button[value=ok]');
  ok(`${tag} save starts exit animation (copy shows the entered values)`, await p.evaluate(()=>{ const g=document.querySelector('.sheet-ghost'); return !!g && !document.querySelector('#dlg').open && g.querySelector('.tf-h').value==='10'; }));
  await p.waitForTimeout(260); ok(`${tag} save persisted`, await p.evaluate(()=>attSheet('a',2026,5).days[3].in==='10:00' && !document.querySelector('#dlg').open));
  // 5. Escape / backdrop dismiss resolve ask() as "no"
  for (const how of ['escape','backdrop']){
    const res = p.evaluate(()=>ask('?')); await p.waitForSelector('#ask[open]:not(.closing) [data-r]'); await p.waitForTimeout(220);
    if(how==='escape') await p.keyboard.press('Escape'); else await p.mouse.click(w/2, 20);
    ok(`${tag} ask dismissed by ${how} resolves false`, (await res)===false);
    await p.waitForTimeout(260);
  }
  // 6. menu → destructive → confirm stays open (regression for the close-event race)
  await p.evaluate(()=>{ state.tab='profile'; state.profile='c'; render(); });
  await p.click('#hdrAct [data-act=profile-menu]'); await p.waitForSelector('#ask[open]:not(.closing) .menu-list'); await p.click('#ask .menu-list button.danger');
  await p.waitForTimeout(500);
  ok(`${tag} menu → confirm sheet stays open`, await p.evaluate(()=>{ const d=document.querySelector('#ask'); return d.open && !!d.querySelector('[data-r]'); }));
  await p.click('#ask [data-r="0"]'); await p.waitForTimeout(260);
  ok(`${tag} cancelled delete kept employee`, await p.evaluate(()=>!!empById('c')));
  // 7. toast + undo bar
  await p.evaluate(()=>toast('عادي')); ok(`${tag} plain toast has no undo bar`, await p.evaluate(()=>!document.querySelector('#toast .bar')));
  await p.evaluate(()=>{ snapshot(); toast('مع تراجع', true); });
  const bar = await anims('#toast .bar');
  ok(`${tag} undo toast shows 5s shrinking bar`, bar && bar[0]?.dur===5000 && bar[0].frames[1].t.includes('scaleX(0)'), JSON.stringify(bar));
  await p.evaluate(()=>{ snapshot(); toast('تم تسليم راتب عبد الرحمن بن عبد العزيز بن محمد آل عبد اللطيف', true); });
  ok(`${tag} undo button fully visible with a long name`, await p.evaluate(()=>{ const t=document.querySelector('#toast').getBoundingClientRect(), u=document.querySelector('#undoBtn').getBoundingClientRect(); return u.width>20 && u.left>=t.left-0.5 && u.right<=t.right+0.5 && u.left>=0 && u.right<=innerWidth; }));
  ok(`${tag} toast transition is transform+opacity only`, await p.evaluate(()=>getComputedStyle(document.querySelector('#toast')).transitionProperty) === 'opacity, transform');
  // 8. check-in/out
  await p.evaluate(()=>{ state.tab='home'; render(); });
  const pid = await p.evaluate(()=>document.querySelector('[data-punch^="in|"]').dataset.punch.split('|')[1]);
  await p.click(`[data-punch="in|${pid}"]`);
  ok(`${tag} check-in: row switches to انصراف immediately`, await p.evaluate(id=>!!document.querySelector(`[data-row="${id}"] [data-punch="out|${id}"]`), pid));
  ok(`${tag} check-in: row highlight`, await p.evaluate(id=>document.querySelector(`[data-row="${id}"]`).classList.contains('hl'), pid));
  const btnA = await anims(`[data-row="${pid}"] .btn`);
  ok(`${tag} check-in: button pop ${rm==='reduce'?'skipped':'runs'}`, rm==='reduce' ? btnA.length===0 : btnA.length===1 && btnA[0].dur===180, JSON.stringify(btnA));
  // 9. delivered
  await p.evaluate(()=>{ state.tab='payroll'; state.y=2026; state.m=5; render(); });
  await p.click('[data-card="a"] [data-deliver]');
  ok(`${tag} delivered: card highlight`, await p.evaluate(()=>document.querySelector('[data-card="a"]').classList.contains('hl')));
  const dim = await p.evaluate(()=>{ const c=document.querySelector('[data-card="a"]');
    // resolve any CSS colour (incl. color-mix) to sRGB by painting it
    const cv=document.createElement('canvas'); cv.width=cv.height=1; const x=cv.getContext('2d');
    const rgb=col=>{ x.clearRect(0,0,1,1); x.fillStyle='#000'; x.fillStyle=col; x.fillRect(0,0,1,1); return [...x.getImageData(0,0,1,1).data].slice(0,3); };
    const lum=col=>rgb(col).map(v=>{v/=255;return v<=.03928?v/12.92:((v+.055)/1.055)**2.4}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
    const bg=lum(getComputedStyle(c).backgroundColor), worst=Math.min(...[...c.querySelectorAll('dd, dt, .net > span')].map(e=>{const a=lum(getComputedStyle(e).color);return (Math.max(a,bg)+.05)/(Math.min(a,bg)+.05)}));
    const fades=[...c.querySelectorAll('dl, .net')].flatMap(e=>e.getAnimations().map(a=>Number(a.effect.getKeyframes()[0].opacity)));
    return {done:c.classList.contains('done'), worst:+worst.toFixed(2), fades}; });
  ok(`${tag} delivered: card dims to neutral colours`, dim.done, JSON.stringify(dim));
  ok(`${tag} delivered: dimmed text still ≥4.5:1 contrast`, dim.worst >= 4.5, JSON.stringify(dim));
  ok(`${tag} delivered: breakdown cross-fades (opacity only)`, dim.fades.length===2 && dim.fades.every(o=>o===0.45), JSON.stringify(dim));
  const cb = await anims('[data-card="a"] [data-deliver]');
  ok(`${tag} delivered: checkbox pop ${rm==='reduce'?'skipped':'runs'}`, rm==='reduce' ? cb.length===0 : cb.length===1, JSON.stringify(cb));
  ok(`${tag} delivered: state saved`, await p.evaluate(()=>db.payroll['2026-05'].a.delivered===true));
  // 10. month navigation direction
  await p.click('[data-mstep="1"]');
  const mv = await p.evaluate(()=>[...document.querySelector('#view').children].filter(c=>!c.classList.contains('ctx')).flatMap(c=>c.getAnimations().map(a=>a.effect.getKeyframes()[0].transform||'')));
  ok(`${tag} month next animates content`, mv.length>0, JSON.stringify(mv));
  ok(`${tag} month next ${rm==='reduce'?'fade-only':'enters from the left (-12px)'}`, rm==='reduce' ? mv.every(t=>!t) : mv.every(t=>t.includes('-12px')), JSON.stringify(mv));
  ok(`${tag} month bar itself not animated`, (await anims('#view .ctx')).length===0);
  await p.waitForTimeout(220); await p.click('[data-mstep="-1"]');
  const mv2 = await p.evaluate(()=>[...document.querySelector('#view').children].filter(c=>!c.classList.contains('ctx')).flatMap(c=>c.getAnimations().map(a=>a.effect.getKeyframes()[0].transform||'')));
  if(rm!=='reduce') ok(`${tag} month prev enters from the right (+12px)`, mv2.every(t=>t.includes('12px') && !t.includes('-12px')), JSON.stringify(mv2));
  // 11. tabs instant
  await p.waitForTimeout(220); await p.click('#tabs [data-tab=employees]');
  ok(`${tag} tab switch has no animation`, await p.evaluate(()=>document.querySelector('#view').getAnimations({subtree:true}).length===0 && document.querySelector('#dlg').getAnimations().length===0));
  // 12. swipe interplay: drag during open finishes the enter animation and follows the finger
  await p.evaluate(()=>{ state.tab='attendance'; render(); }); await p.click('[data-day-edit="a|1"]'); await p.waitForTimeout(320);
  const g = await p.evaluate(()=>{ const r=document.querySelector('#dlg .sheet-grab').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; });
  await p.mouse.move(g.x,g.y); await p.mouse.down(); await p.mouse.move(g.x,g.y+60,{steps:4});
  ok(`${tag} sheet follows finger`, await p.evaluate(()=>document.querySelector('#dlg').style.transform)==='translateY(60px)');
  await p.mouse.up(); const back = await anims('#dlg');
  ok(`${tag} short drag ${rm==='reduce'?'snaps back instantly':'springs back (200ms)'}`, rm==='reduce' ? back.length===0 : back.length===1 && back[0].dur===200, JSON.stringify(back));
  await p.waitForTimeout(260); await p.mouse.move(g.x,g.y); await p.mouse.down(); await p.mouse.move(g.x,g.y+170,{steps:5}); await p.mouse.up();
  const ex = await p.evaluate(([gy])=>{ const g=document.querySelector('.sheet-ghost'); return g ? {top: parseFloat(g.style.top), grab: gy} : null; }, [g.y]);
  ok(`${tag} long drag closes from finger position`, ex && ex.top >= ex.grab + 150 - 30, JSON.stringify(ex));
  await p.waitForTimeout(260); ok(`${tag} closed after long drag`, !(await p.evaluate(()=>document.querySelector('#dlg').open)));
  // 12b. performance: every animation touched transform/opacity only (checked live during a burst of interactions)
  const props = await p.evaluate(async ()=>{ const seen=new Set(); const grab=()=>document.getAnimations().forEach(a=>{ if(a.effect && a.effect.getKeyframes) a.effect.getKeyframes().forEach(k=>Object.keys(k).forEach(x=>{ if(!['offset','easing','composite','computedOffset'].includes(x)) seen.add(x); })); else seen.add(a.animationName||'css'); });
    editDay('a',4); grab(); await new Promise(r=>setTimeout(r,320)); document.querySelector('#dlg').close(); grab(); toast('x', true); snapshot(); grab();
    document.querySelector('[data-mstep="1"]')?.click(); grab(); return [...seen]; });
  ok(`${tag} animations use transform/opacity only`, props.every(x=>['transform','opacity','hl','bd-in'].includes(x)), JSON.stringify(props));
  // 13. layout untouched: no horizontal overflow after all interactions
  ok(`${tag} no horizontal overflow`, await p.evaluate(()=>document.documentElement.scrollWidth) <= w);
  ok(`${tag} no page errors`, !p.errs.length, p.errs.join('|'));
  await p.close();
}
// Regression: a late "close" event from the previous sheet must not answer the next confirmation.
for (const rm of ['reduce','no-preference']){
  const p=await b.newPage({viewport:{width:390,height:844}}); await p.emulateMedia({reducedMotion:rm}); p.on('pageerror',e=>console.log('ERR',e.message));
  await p.goto(APP_URL);
  await p.evaluate(d=>{localStorage.clear();localStorage.setItem('payroll-app-v1',JSON.stringify(d));sessionStorage.setItem('payroll-ui',JSON.stringify({tab:'settings'}))},FX()); await p.reload();
  let bad=0;
  for(let i=0;i<12;i++){
    await p.evaluate(()=>{state.tab='settings';render();});
    await p.click('[data-act=wipe]'); await p.waitForSelector('#ask[open]:not(.closing) [data-r]'); await p.click('#ask [data-r="1"]');
    await p.waitForTimeout(i%3*60);  // vary timing: act while the confirm sheet is still closing
    await p.evaluate(()=>{state.tab='settings';render();});
    const idx = await p.evaluate(()=>readSnaps().findIndex(s=>s.reason==='قبل حذف الكل'));
    await p.click(`[data-snap="${idx}"]`);
    await p.waitForSelector('#ask[open]:not(.closing) [data-r]'); 
    const txt = await p.evaluate(()=>document.querySelector('#ask').innerText.slice(0,40));
    await p.click('#ask [data-r="1"]'); await p.waitForTimeout(200);
    const n = await p.evaluate(()=>db.employees.length);
    if(n!==4){ bad++; console.log(rm,'iter',i,'emps',n,'askText',JSON.stringify(txt)); }
  }
  ok(`[${rm}] confirm sheet never auto-cancels when opened while the previous one is closing (12 timed runs)`, bad===0, `${bad}/12 failed`); await p.close();
}
await b.close(); done();
})().catch(e => { console.error(e); process.exit(1); });
