// schemaVersion + migration framework, and persistent alerts for data-loss-critical errors.
// Verifies: fresh install, legacy (unversioned) data loads without being rewritten, payroll unchanged,
// newer-version data opens read-only, corrupt data is preserved and never overwritten, and every
// critical alert stays visible until dismissed or resolved.
const O = require('./oracle'), FX = require('./fixtures');
const { APP_URL, launch, suite, fresh, VIEWS, askReady } = require('./lib');
const { ok, near, done } = suite('schema');
const KEY = 'payroll-app-v1';
const raw = p => p.evaluate(k => localStorage.getItem(k), KEY);
// key-order-independent JSON, so only real content differences count
const canon = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(n => [n, x[n]])) : x);
const alertOn = (p, key) => p.evaluate(k => !!document.querySelector(`#alerts [data-alert="${k}"]`), key);

(async () => {
  const b = await launch();
  const ctx = await b.newContext({viewport:{width:390,height:844}, permissions:['clipboard-read','clipboard-write']});

  /* --- migration runner (unit) --- */
  let p = await fresh(ctx, null);
  const u = await p.evaluate(() => ({
    current: CURRENT_SCHEMA, defaults: DEFAULTS.schemaVersion,
    legacy: migrate({employees:[]}).from, v1: migrate({schemaVersion:1}).from,
    newer: migrate({schemaVersion:2}).error, zero: migrate({schemaVersion:0}).error, text: migrate({schemaVersion:'abc'}).error,
    // a hypothetical future v1→v2→v3 chain runs in order on a copy and stamps the version
    chain: (() => { const src = {schemaVersion:1, n:1}; const r = migrate(src, 3, {1: d => ({...d, n: d.n * 10}), 2: d => ({...d, n: d.n + 5})}); return [r.data.n, r.data.schemaVersion, src.n, src.schemaVersion]; })(),
    gap: migrate({schemaVersion:1}, 3, {1: d => d}).error,
  }));
  ok('CURRENT_SCHEMA is 1 and new data starts at 1', u.current === 1 && u.defaults === 1, JSON.stringify(u));
  ok('unversioned (legacy) data is treated as version 1', u.legacy === 1 && u.v1 === 1);
  ok('newer / invalid versions are detected', u.newer === 'newer' && u.zero === 'invalid' && u.text === 'invalid', JSON.stringify(u));
  ok('future migration chain runs in order without mutating the source', JSON.stringify(u.chain) === JSON.stringify([15, 3, 1, 1]), JSON.stringify(u.chain));
  ok('missing migration step is an error, not silent', u.gap === 'missing-step');

  /* --- fresh installation --- */
  ok('fresh install: welcome screen, no alerts', await p.evaluate(() => !!document.querySelector('[data-act=add-emp]') && !document.querySelector('#alerts').children.length));
  await p.click('[data-act=add-emp]'); await p.fill('dialog [name=name]', 'جديد'); await p.fill('dialog [name=hire]', '2026-01-01'); await p.fill('dialog [name=salary]', '300'); await p.click('dialog button[value=ok]'); await p.waitForTimeout(260);
  ok('fresh install: first save writes schemaVersion 1', JSON.parse(await raw(p)).schemaVersion === 1);
  ok('fresh install: no page errors', !p.errs.length, p.errs.join('|')); await p.close();

  /* --- legacy data: loads untouched, calculations unchanged, field added only on next save --- */
  const legacy = FX();
  p = await fresh(ctx, legacy);
  const rawBefore = await raw(p);
  for(const t of VIEWS){ await p.evaluate(([t]) => { state.tab=t; state.y=2026; state.m=5; render(); }, [t]); }
  ok('legacy: stored data not rewritten by loading/rendering', await raw(p) === rawBefore);
  ok('legacy: no alerts', await p.evaluate(() => !document.querySelector('#alerts').children.length));
  for(const id of ['a','b','c','d']) for(const m of [3,4,5,6]){
    const a = await p.evaluate(([id,m]) => calcPay(empById(id),2026,m).net, [id,m]);
    ok(`legacy: net ${id} 2026-${m} matches oracle`, near(a, O.pay(legacy, legacy.employees.find(e=>e.id===id), 2026, m).net));
  }
  await p.evaluate(() => { db.employees[0].phone = '0790000000'; save(); });
  const after = JSON.parse(await raw(p));
  ok('legacy: next save adds schemaVersion 1', after.schemaVersion === 1);
  // Pre-existing behaviour (unchanged by Phase A): an empty settings object is written out with the defaults
  // the app was already applying in memory, so effective settings are identical.
  const defaults = await p.evaluate(() => DEFAULTS.settings);
  ok('legacy: settings written = defaults already in effect (no effective change)', JSON.stringify(after.settings) === JSON.stringify({...defaults, ...legacy.settings}));
  const strip = d => { const c = structuredClone(d); delete c.schemaVersion; delete c.changes; delete c.settings; c.employees[0] = {...c.employees[0]}; delete c.employees[0].phone; return canon(c); };
  ok('legacy: nothing else in the data changed (only schemaVersion added)', strip(after) === strip({...legacy}));
  ok('legacy: no page errors', !p.errs.length, p.errs.join('|')); await p.close();

  /* --- newer schema: read-only, never written --- */
  const newer = {...FX(), schemaVersion: 2, futureField: {keep: true}};
  p = await fresh(ctx, newer, {tab:'payroll', y:2026, m:5});
  const rawNewer = await raw(p);
  ok('newer: persistent alert shown', await alertOn(p, 'newer'));
  ok('newer: data still visible (read-only)', await p.evaluate(() => db.employees.length === 4 && !!document.querySelector('.pcard')));
  await p.evaluate(() => { db.employees[0].name = 'تعديل'; save(); });
  ok('newer: save blocked, stored data untouched', await raw(p) === rawNewer);
  await p.evaluate(() => { restoreFrom(JSON.stringify({employees:[]})); }); await p.waitForTimeout(60);
  ok('newer: restore blocked with alert', await alertOn(p, 'restore-failed') && await raw(p) === rawNewer);
  await p.close();

  /* --- corrupt stored data: preserved, never overwritten, recoverable --- */
  for(const bad of ['{"employees":[{"id":"a"', '"just a string"', '{"schemaVersion":"abc","employees":[]}']){
    p = await fresh(ctx, null);
    await p.evaluate(([k,v]) => localStorage.setItem(k, v), [KEY, bad]); await p.reload();
    ok(`corrupt ${bad.slice(0,12)}: alert shown`, await alertOn(p, 'corrupt'));
    ok(`corrupt ${bad.slice(0,12)}: raw copy kept aside`, await p.evaluate(([k]) => localStorage.getItem(k + '-unreadable'), [KEY]) === bad);
    await p.evaluate(() => { db.employees.push({id:'n', name:'x', hire:'2026-01-01', salary:'1', hours:'8'}); save(); });
    ok(`corrupt ${bad.slice(0,12)}: stored data never overwritten`, await raw(p) === bad);
    await p.close();
  }
  p = await fresh(ctx, null);
  await p.evaluate(([k]) => localStorage.setItem(k, '{broken'), [KEY]); await p.reload();
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#alerts [data-alert-act="download-raw"]')]);
  ok('corrupt: «download as-is» saves the raw text', require('fs').readFileSync(await dl.path(), 'utf8') === '{broken');
  await p.click('[data-act=backup]').catch(()=>{}); await p.waitForTimeout(80);
  ok('corrupt: backup of empty placeholder is blocked', await alertOn(p, 'corrupt'));
  await p.click('#alerts [data-alert-act="discard-corrupt"]'); await askReady(p); await p.click('#ask [data-r="1"]'); await p.waitForTimeout(150);
  ok('corrupt: «start over» clears alert and saving works again', !(await alertOn(p, 'corrupt')) && JSON.parse(await raw(p)).schemaVersion === 1);
  ok('corrupt: unreadable copy still kept after start over', await p.evaluate(([k]) => localStorage.getItem(k + '-unreadable'), [KEY]) === '{broken');
  // recovering by restoring a backup also lifts read-only
  await p.evaluate(([k]) => localStorage.setItem(k, '{broken'), [KEY]); await p.reload();
  await p.evaluate(([d]) => { restoreFrom(JSON.stringify(d)); }, [FX()]); await askReady(p); await p.click('#ask [data-r="1"]'); await p.waitForTimeout(150);
  ok('corrupt: restoring a backup recovers and clears the alert', !(await alertOn(p, 'corrupt')) && JSON.parse(await raw(p)).employees.length === 4);
  await p.close();

  /* --- persistent alerts for save failure / storage full / restore failure / no storage --- */
  p = await fresh(ctx, FX(), {tab:'employees'});
  await p.evaluate(() => { window.__orig = Storage.prototype.setItem; Storage.prototype.setItem = function(){ throw new DOMException('full', 'QuotaExceededError'); }; db.employees[0].name = 'x'; save(); });
  ok('save failure: alert shown', await alertOn(p, 'save-failed'));
  await p.waitForTimeout(3000);
  await p.evaluate(() => { state.tab='payroll'; render(); });
  ok('save failure: alert still visible after 3s and a re-render', await alertOn(p, 'save-failed'));
  ok('save failure: alert offers backup actions', await p.evaluate(() => !!document.querySelector('#alerts [data-alert-act="backup"]')));
  await p.click('#alerts [data-alert-close="save-failed"]');
  ok('save failure: dismiss hides it', !(await alertOn(p, 'save-failed')));
  await p.evaluate(() => save());
  ok('save failure: reappears while the problem persists', await alertOn(p, 'save-failed'));
  await p.evaluate(() => { Storage.prototype.setItem = window.__orig; save(); });
  ok('save failure: clears automatically once saving works', !(await alertOn(p, 'save-failed')));
  await p.evaluate(() => { const o = window.__orig; localStorage.setItem('payroll-app-snapshots', '[{"data":"{}"}]');
    Storage.prototype.setItem = function(k, v){ if(k === 'payroll-app-v1' && localStorage.getItem('payroll-app-snapshots')) throw new DOMException('full','QuotaExceededError'); return o.call(this, k, v); }; save(); });
  ok('storage full: warning alert shown and main data saved', await alertOn(p, 'storage-full') && JSON.parse(await raw(p)).employees[0].name === 'x');
  await p.evaluate(() => { Storage.prototype.setItem = window.__orig; });
  await p.evaluate(() => { restoreFrom('not json'); }); await p.waitForTimeout(60);
  ok('restore failure: alert shown', await alertOn(p, 'restore-failed'));
  await p.waitForTimeout(2500);
  ok('restore failure: still visible after 2.5s', await alertOn(p, 'restore-failed'));
  await p.evaluate(([d]) => { restoreFrom(JSON.stringify(d)); }, [FX()]); await askReady(p); await p.click('#ask [data-r="1"]'); await p.waitForTimeout(150);
  ok('restore failure: cleared by a successful restore', !(await alertOn(p, 'restore-failed')));
  ok('alerts: no page errors', !p.errs.length, p.errs.join('|')); await p.close();

  const ns = await ctx.newPage(); ns.errs = []; ns.on('pageerror', e => ns.errs.push(e.message));
  await ns.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get(){ throw new DOMException('denied', 'SecurityError'); } }); });
  await ns.goto(APP_URL);
  ok('no storage available: alert shown at startup, app still renders', await alertOn(ns, 'no-storage') && await ns.evaluate(() => !!document.querySelector('#view').children.length), ns.errs.join('|'));
  await ns.close();

  /* --- backup payload carries the version; old (unversioned) backups still restore --- */
  p = await fresh(ctx, FX(), {tab:'settings'});
  await p.click('[data-act=copy-data]'); await p.waitForTimeout(150);
  const payload = JSON.parse(await p.evaluate(() => navigator.clipboard.readText()));
  ok('backup payload includes schemaVersion 1', payload.app === 'payroll-app' && payload.data.schemaVersion === 1);
  await p.evaluate(([d]) => { restoreFrom(JSON.stringify(d)); }, [FX()]); await askReady(p); await p.click('#ask [data-r="1"]'); await p.waitForTimeout(150);
  ok('unversioned legacy backup restores and is stamped v1', JSON.parse(await raw(p)).schemaVersion === 1 && JSON.parse(await raw(p)).employees.length === 4);
  await p.close();

  await b.close();
  done();
})().catch(e => { console.error(e); process.exit(1); });
