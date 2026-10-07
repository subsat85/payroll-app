// Backup, restore, snapshots, delete/undo, unsaved-changes counter, storage-full handling.
// Run: npm test  (or: node safety.test.js). RM=1 runs with prefers-reduced-motion.
const fs = require('fs'), os = require('os'), path = require('path');
const O = require('./oracle'), FX = require('./fixtures');
const { launch, suite, fresh, VIEWS } = require('./lib');
const { ok, near, done } = suite('safety');

(async () => {
  const b = await launch();
  const ctx = await b.newContext({viewport:{width:390,height:844}, hasTouch:false, permissions:['clipboard-read','clipboard-write']});
  let db, p;
  /* ===== 3. Data safety ===== */
  db = FX(); p = await fresh(ctx, db, {tab:'settings'});
  ok('snapshot: daily snapshot taken on load', await p.evaluate(()=>readSnaps().length) >= 1);
  // unsaved changes counter
  await p.evaluate(()=>{ db.changes = 0; save(true); });
  await p.evaluate(()=>{ state.tab='employees'; render(); }); await p.click('#hdrAct [data-act=add-emp]');
  await p.fill('dialog [name=name]','جديد'); await p.fill('dialog [name=hire]','2026-01-01'); await p.fill('dialog [name=salary]','300'); await p.click('dialog button[value=ok]'); await p.waitForTimeout(260);
  ok('counter: +1 after add employee', await p.evaluate(()=>db.changes) === 1);
  ok('counter: persisted', await p.evaluate(()=>JSON.parse(localStorage.getItem('payroll-app-v1')).changes) === 1);
  // backup via copy
  await p.evaluate(()=>{ state.tab='settings'; render(); }); await p.click('[data-act=copy-data]'); await p.waitForTimeout(150);
  ok('backup(copy): counter reset + lastBackup today', await p.evaluate(()=>db.changes===0 && db.lastBackup===today()));
  const clip = await p.evaluate(()=>navigator.clipboard.readText());
  ok('backup payload wrapped & complete', (()=>{ const j = JSON.parse(clip); return j.app==='payroll-app' && j.data.employees.length===5 && j.data.attendance['a|2026-05']; })());
  // backup file download fallback
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-act=backup]')]);
  const fpath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'payroll-test-')), 'backup.json'); await dl.saveAs(fpath);
  ok('backup(file): valid JSON with all employees', JSON.parse(fs.readFileSync(fpath,'utf8')).data.employees.length === 5);
  // delete employee + undo
  await p.evaluate(()=>{ state.profile='a'; state.tab='profile'; render(); });
  await p.click('#hdrAct [data-act=profile-menu]'); await p.click('#ask .menu-list button.danger'); await p.waitForTimeout(300); await p.waitForSelector('#ask[open]:not(.closing) [data-r]'); await p.click('#ask [data-r="1"]'); await p.waitForTimeout(80);
  ok('delete employee: removed with records', await p.evaluate(()=>!empById('a') && !db.advances.some(x=>x.empId==='a') && !Object.keys(db.attendance).some(k=>k.startsWith('a|'))));
  ok('delete employee: snapshot taken', await p.evaluate(()=>readSnaps().some(s=>s.reason==='قبل حذف موظف')));
  await p.click('#undoBtn');
  ok('delete employee: undo restores everything', await p.evaluate(()=>!!empById('a') && db.advances.filter(x=>x.empId==='a').length===3 && !!db.attendance['a|2026-05']));
  // cancelled delete changes nothing
  await p.evaluate(()=>{ state.profile='b'; state.tab='profile'; render(); });
  await p.click('#hdrAct [data-act=profile-menu]'); await p.click('#ask .menu-list button.danger'); await p.waitForTimeout(300); await p.waitForSelector('#ask[open]:not(.closing) [data-r]'); await p.click('#ask [data-r="0"]');
  ok('delete cancelled: employee kept', await p.evaluate(()=>!!empById('b')));
  // wipe dataset → restore from snapshot
  await p.evaluate(()=>{ state.tab='settings'; render(); }); await p.click('[data-act=wipe]'); await p.waitForSelector('#ask[open]:not(.closing) [data-r]'); await p.click('#ask [data-r="1"]'); await p.waitForTimeout(50);
  ok('wipe: dataset empty', await p.evaluate(()=>db.employees.length) === 0);
  await p.evaluate(()=>{ state.tab='settings'; render(); });
  const idx = await p.evaluate(()=>readSnaps().findIndex(s=>s.reason==='قبل حذف الكل'));
  await p.click(`[data-snap="${idx}"]`); await p.waitForTimeout(300); await p.waitForSelector('#ask[open]:not(.closing) [data-r]'); await p.click('#ask [data-r="1"]'); await p.waitForTimeout(80);
  ok('wipe → snapshot restore: all back', await p.evaluate(()=>db.employees.length===5 && db.advances.length===4 && Object.keys(db.attendance).length===4));
  // restore from file
  await p.evaluate(()=>{ db = structuredClone(DEFAULTS); save(true); state.tab='settings'; render(); });
  await p.setInputFiles('input[data-act-file=restore]', fpath); await p.waitForTimeout(100); await p.waitForSelector('#ask[open]:not(.closing) [data-r]'); await p.click('#ask [data-r="1"]'); await p.waitForTimeout(80);
  ok('restore(file): 5 employees back', await p.evaluate(()=>db.employees.length) === 5);
  // invalid / partial restores
  const snapBefore = await p.evaluate(()=>JSON.stringify(db));
  for(const bad of ['{not json', '{"foo":1}', '', JSON.stringify({app:'payroll-app', data:{}})]){
    await p.evaluate(t=>restoreFrom(t), bad); await p.waitForTimeout(30);
    ok(`invalid restore rejected: ${bad.slice(0,15)||'(empty)'}`, await p.evaluate(()=>JSON.stringify(db)) === snapBefore);
  }
  // restore cancelled
  await p.evaluate(t=>{ restoreFrom(t); }, JSON.stringify({employees:[]})); await p.waitForTimeout(50); await p.waitForSelector('#ask[open]:not(.closing) [data-r]'); await p.click('#ask [data-r="0"]');
  ok('restore cancelled: unchanged', await p.evaluate(()=>JSON.stringify(db)) === snapBefore);
  // structurally partial backup (nulls) must not crash
  await p.evaluate(t=>{ restoreFrom(t); }, JSON.stringify({employees:[{id:'z',name:'ز',hire:'2026-01-01',salary:'100',hours:'8'}], attendance:null, payroll:null, advances:null, overtime:null, leaves:null, settings:null}));
  await p.waitForTimeout(80); await p.waitForSelector('#ask[open]:not(.closing) [data-r]'); await p.click('#ask [data-r="1"]'); await p.waitForTimeout(120);
  ok('partial backup restored', await p.evaluate(()=>db.employees.length===1 && db.attendance && typeof db.attendance==='object'));
  const views = VIEWS;
  let crash = '';
  for(const t of VIEWS){ try{ await p.evaluate(t=>{ state.tab=t; render(); }, t); }catch(e){ crash += t+':'+e.message.split('\n')[0]+' '; } }
  ok('partial backup (null fields) renders every screen', !crash && !p.errs.length, crash + p.errs.join('|'));
  p.errs.length = 0;
  // storage full: snapshots must never block the main save
  await p.evaluate(()=>{ const big = 'x'.repeat(1000); const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function(k,v){ if(k==='payroll-app-v1' && localStorage.getItem('payroll-app-snapshots')) throw new DOMException('full','QuotaExceededError'); return orig.call(this,k,v); };
    localStorage.setItem('payroll-app-snapshots', JSON.stringify([{data:big}])); db.employees[0].name='بعد الامتلاء'; save(); });
  ok('quota: main data saved even when snapshots fill storage', await p.evaluate(()=>JSON.parse(localStorage.getItem('payroll-app-v1')).employees[0].name) === 'بعد الامتلاء');
  ok('no page errors (safety)', !p.errs.length, p.errs.join('|')); await p.close();

  await b.close();
  done();
})().catch(e => { console.error(e); process.exit(1); });
