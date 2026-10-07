// Independent re-implementation of the original Excel formulas. It never imports app code, so payroll
// results can be checked against it. Keep it in sync with the spreadsheets, not with index.html.
// Independent re-implementation of the spreadsheet formulas (does NOT use app code)
const D = 86400000, U = s => { const [y,m,d] = s.split('-').map(Number); return Date.UTC(y,m-1,d); };
const dim = (y,m) => new Date(Date.UTC(y,m,0)).getUTCDate();
const mins = s => { if(!s) return null; const [h,m] = s.split(':').map(Number); return h*60+m; };
function attDay(r, reqDef){
  const a = mins(r.in), b = mins(r.out); if(a==null||b==null) return null;
  const lf = mins(r.lf), lt = mins(r.lt);
  const leave = lf!=null && lt!=null ? ((lt-lf)%1440+1440)%1440 : (mins(r.lm)||0);
  const actual = Math.max(((b-a)%1440+1440)%1440 - leave, 0);       // MAX(MOD(C-B,1)-leave,0)
  const req = r.holiday ? 0 : (mins(r.req) ?? reqDef);             // IF(H="نعم",0,IF(I="",B2,I))
  return {actual, over: Math.max(actual-req,0), short: Math.max(req-actual,0)};
}
function attMonth(sheet, y, m, rate, reqDefault='09:00'){
  let over=0, short=0, n=0;
  for(let d=1; d<=dim(y,m); d++){ const r = sheet?.days?.[d]; if(!r) continue; const c = attDay(r, mins(sheet.req||reqDefault)); if(!c) continue; over+=c.over; short+=c.short; n++; }
  return {netMin: over-short, pay: (over-short)/60*rate, n};
}
function leaveIn(leaves, empId, s, e, type){ let n=0; for(const l of leaves){ if(l.empId!==empId||(type&&l.type!==type)) continue; const a=Math.max(U(l.from),s), b=Math.min(U(l.to||l.from),e); if(b>=a) n+=Math.round((b-a)/D)+1; } return n; }
function pay(db, emp, y, m){
  const S = {monthDays:30, otMultiplier:1.25, ssPct:0, attReq:'09:00', autoAtt:true, ...db.settings};
  const MD = +S.monthDays, s = Date.UTC(y,m-1,1), e = Date.UTC(y,m-1,dim(y,m));
  const h = U(emp.hire), t = emp.endDate ? U(emp.endDate) : null;
  const days = h>e ? 0 : (t!=null && t<s) ? 0 : Math.min(MD, Math.round(((t==null?e:Math.min(t,e)) - Math.max(h,s))/D)+1);   // H column
  const sal = +emp.salary, hrs = +emp.hours, dayR = sal/MD, hourR = hrs ? dayR/hrs : 0, mult = +S.otMultiplier;
  const rec = db.payroll?.[`${y}-${String(m).padStart(2,'0')}`]?.[emp.id] || {};
  const pre = `${y}-${String(m).padStart(2,'0')}`;
  const sheet = db.attendance?.[`${emp.id}|${pre}`];
  const auto = S.autoAtt !== false && !(sheet && sheet.manual);
  const rate = sheet && sheet.rate!=null && sheet.rate!=='' ? +sheet.rate : hourR*mult;
  const att = auto && sheet ? attMonth(sheet, y, m, rate, S.attReq) : null;
  const live = att && att.n ? att : null;
  const ot = db.overtime.filter(o=>o.empId===emp.id && o.date.startsWith(pre) && !(live && o.note==='من حاسبة الدوام')).reduce((a,o)=>a+ +o.hours,0);
  const adv = db.advances.filter(a=>a.empId===emp.id && a.date.startsWith(pre)).reduce((x,a)=>x+ +a.amount,0);
  const base = dayR*days, abs = dayR*(+rec.absDays||0), unpaid = dayR*leaveIn(db.leaves||[], emp.id, s, e, 'بدون راتب');
  const late = hourR*(+rec.lateHours||0), otPay = hourR*ot*mult + (live?live.pay:0), ss = base*(+S.ssPct)/100;
  const ded = abs+unpaid+late+adv+(+rec.otherDed||0)+ss;
  return {days, base, ded, otPay, net: base-ded+otPay+(+rec.bonus||0)};
}
module.exports = {pay, attMonth, leaveIn, U};
