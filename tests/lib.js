// Shared helpers for the browser test suites. Everything resolves relative to the repository.
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

const APP_URL = pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href;
const VIEWS = ['home','attendance','payroll','employees','more','advances','overtime','leaves','summary','settings'];

// CHROMIUM_PATH lets CI or a sandbox point at a preinstalled browser.
const launch = () => chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

function suite(name){
  let pass = 0, fail = 0; const fails = [];
  return {
    ok(label, cond, info = ''){ if(cond) pass++; else { fail++; fails.push(label + (info !== '' ? `  → ${info}` : '')); } },
    near: (a, b, t = 0.006) => Math.abs(a - b) <= t,
    done(){
      console.log(`[${name}] PASS ${pass}  FAIL ${fail}`);
      fails.forEach(f => console.log('  ✗ ' + f));
      process.exitCode = fail ? 1 : 0;
      return { pass, fail };
    },
  };
}

// Opens the app with the given saved data and UI state. RM=1 runs with prefers-reduced-motion.
async function fresh(ctx, data, ui){
  const p = await ctx.newPage();
  await p.emulateMedia({ reducedMotion: process.env.RM ? 'reduce' : 'no-preference' });
  p.errs = [];
  p.on('pageerror', e => p.errs.push(e.message));
  p.on('console', m => m.type() === 'error' && p.errs.push(m.text()));
  await p.goto(APP_URL);
  await p.evaluate(([d, u]) => { localStorage.clear(); if(d) localStorage.setItem('payroll-app-v1', JSON.stringify(d)); sessionStorage.setItem('payroll-ui', JSON.stringify(u || { tab: 'home' })); }, [data, ui]);
  await p.reload();
  return p;
}

// Waits until the confirm/menu sheet is fully open (not mid-close).
const askReady = p => p.waitForSelector('#ask[open]:not(.closing) [data-r], #ask[open]:not(.closing) .menu-list');

module.exports = { APP_URL, VIEWS, launch, suite, fresh, askReady };
