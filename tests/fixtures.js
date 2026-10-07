// Legacy-format fixtures: realistic data exactly as written by earlier versions of the app (string numbers,
// one-time "ترحيل" posts, manual months, cross-month leaves). Names are generic sample values, not real staff.
// Realistic legacy data as written by the previous app versions (string numbers, legacy posts, etc.)
module.exports = () => ({
  employees:[
    {id:'a', name:'عبد الرحمن محمد الخطيب', title:'مبيعات', hire:'2026-05-06', salary:'290', hours:'8'},
    {id:'b', name:'سامي', title:'مستودعات', hire:'2025-01-01', salary:'450', hours:'8', endDate:'2026-03-15', endReason:'استقالة'},
    {id:'c', name:'محمد عبد الله إبراهيم عبد الرحيم الأحمد', title:'سائق', hire:'2026-01-01', salary:'300', hours:'0'},
    {id:'d', name:'ليلى', title:'محاسبة', hire:'2024-06-01', salary:'600', hours:'9'}],
  payroll:{
    '2026-05':{a:{absDays:'1',lateHours:'2',bonus:'10',otherDed:'5',note:'x'}, d:{delivered:true,deliveredDate:'2026-06-01'}},
    '2026-03':{b:{absDays:'0.5'}}, '2026-06':{a:{lateHours:'1.5'}}},
  advances:[{id:'v1',empId:'a',date:'2026-05-07',amount:'50'},{id:'v2',empId:'a',date:'2026-05-20',amount:'20'},{id:'v3',empId:'a',date:'2026-06-01',amount:'30'},{id:'v4',empId:'d',date:'2026-04-30',amount:'100'}],
  overtime:[
    {id:'o1',empId:'a',date:'2026-05-31',hours:-2.15,note:'من حاسبة الدوام'},   // legacy one-time post (auto month)
    {id:'o2',empId:'a',date:'2026-05-12',hours:'2',note:'يدوي'},               // manual extra hours
    {id:'o3',empId:'d',date:'2026-04-30',hours:3.5,note:'من حاسبة الدوام'},     // legacy post, month later switched to manual
    {id:'o4',empId:'d',date:'2026-03-31',hours:1,note:'من حاسبة الدوام'}],      // posted, no attendance kept
  leaves:[{id:'l1',empId:'a',type:'بدون راتب',from:'2026-05-30',to:'2026-06-02'},{id:'l2',empId:'a',type:'سنوية',from:'2026-07-01',to:'2026-07-03'},
          {id:'l3',empId:'d',type:'سنوية',from:'2025-12-30',to:'2026-01-02'},{id:'l4',empId:'d',type:'مرضية',from:'2026-04-10',to:'2026-04-11'}],
  attendance:{
    'a|2026-05':{days:{1:{in:'15:00',out:'00:15'},2:{in:'12:00',out:'18:00'},3:{in:'12:00',out:'23:50',lf:'14:33',lt:'16:47'}}},
    'a|2026-06':{days:{1:{in:'15:00',out:'00:00',holiday:true},2:{in:'15:00',out:'00:00',req:'08:00'},3:{in:'15:00',out:'23:00',lm:'01:30'},4:{in:'15:00'}}},
    'd|2026-04':{manual:true, days:{1:{in:'08:00',out:'20:30'},2:{in:'08:00',out:'17:00'}}},
    'd|2026-05':{rate:'2', req:'08:00', days:{5:{in:'07:00',out:'18:00'},6:{in:'09:00',out:'16:00'}}}},
  settings:{}, lastBackup:'2026-05-01'
});
