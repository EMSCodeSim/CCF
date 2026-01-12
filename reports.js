const REPORTS_VERSION = "v17";
window.__REPORTS_JS_LOADED = true;

/* =========================================================
   Reports (Mobile-first)
   - Local-only class + roster storage
   - Sessions from timer: localStorage key ccf_sessions_v1
   ========================================================= */

const SESSIONS_KEY = "ccf_sessions_v1";
const CLASSES_KEY  = "ccf.classes.v1";
const DEFAULTS_KEY = "ccf.classDefaults.v1";
const UI_KEY       = "ccf.reports.ui.v1"; // remembers last view/class

// Pro gating
// - Reports tab is Pro-only (shows paywall when not unlocked)
// - Unlock flag is stored locally (set by ProPurchase after successful IAP)
const PRO_KEY = "ccf.pro.v1";
function isPro(){
  try{ return localStorage.getItem(PRO_KEY) === "1"; }catch{ return false; }
}

// If you want to temporarily bypass Pro gating (for testing), set to true.
const PRO_DEBUG_BYPASS = false;
function proEnabled(){
  return PRO_DEBUG_BYPASS ? true : isPro();
}

function renderProPaywall(){
  const root = document.getElementById("app");
  if(!root) return;
  const price = (window.ProPurchase && typeof window.ProPurchase.getPriceString==="function")
    ? window.ProPurchase.getPriceString()
    : "";
  const priceTxt = price ? ` (${price})` : "";
  root.innerHTML = `
    <div class="pad16">
      <div class="dashCard">
        <div class="dashTitle">Unlock Pro Reports</div>
        <div class="dashSub" style="margin-top:6px; line-height:1.35;">
          Pro enables the full <b>Reports</b> system: class creation, rosters, session assignment, student tracking, exports, printing, and emailing.
          <br/><br/>
          Your timer still works normally — only the Reports tab + quick-assign tools are Pro.
        </div>
        <div class="row" style="gap:10px; margin-top:14px; flex-wrap:wrap;">
          <button class="primaryBtn" id="btnBuyPro" type="button">Unlock Pro${priceTxt}</button>
          <button class="secondaryBtn" id="btnRestorePro" type="button">Restore</button>
        </div>
        <div class="dashSub" style="margin-top:10px; opacity:.85;">
          If the purchase buttons do nothing, make sure you installed the app from Google Play (internal testing is OK) and you created the in-app product in Play Console.
        </div>
      </div>
    </div>`;

  const buyBtn = document.getElementById("btnBuyPro");
  if(buyBtn){
    buyBtn.addEventListener("click", async ()=>{
      try{
        if(window.ProPurchase && typeof window.ProPurchase.buy==="function"){
          const r = await window.ProPurchase.buy();
          if(r && r.ok===false) alert(r.error||"Purchase failed");
        }else{
          alert("In-app purchases aren’t available in this build.");
        }
      }catch(err){
        alert((err && err.message) ? err.message : String(err));
      }
    });
  }
  const restoreBtn = document.getElementById("btnRestorePro");
  if(restoreBtn){
    restoreBtn.addEventListener("click", async ()=>{
      try{
        if(window.ProPurchase && typeof window.ProPurchase.restore==="function"){
          const r = await window.ProPurchase.restore();
          if(r && r.ok===false) alert(r.error||"Restore failed");
        }
      }catch(err){
        alert((err && err.message) ? err.message : String(err));
      }
    });
  }
}

/* ---------- Storage helpers ---------- */
function loadJson(key, fallback){
  try{
    const raw = localStorage.getItem(key);
    if(!raw) return fallback;
    const v = JSON.parse(raw);
    return (v===null || v===undefined) ? fallback : v;
  }catch{ return fallback; }
}
function saveJson(key, value){
  localStorage.setItem(key, JSON.stringify(value));
}

/* ---------- IDs ---------- */
function uid(){
  return Math.random().toString(36).slice(2, 10) + "-" + Math.random().toString(36).slice(2, 10);
}

/* ---------- Sessions ---------- */
function loadSessions(){
  const arr = loadJson(SESSIONS_KEY, []);
  return Array.isArray(arr) ? arr : [];
}
function saveSessions(arr){
  saveJson(SESSIONS_KEY, Array.isArray(arr) ? arr : []);
}

/* ---------- Classes ---------- */
function loadClasses(){
  const arr = loadJson(CLASSES_KEY, []);
  return Array.isArray(arr) ? arr : [];
}
function saveClasses(arr){
  saveJson(CLASSES_KEY, Array.isArray(arr) ? arr : []);
}
function getClassById(id){
  return loadClasses().find(c => c.id === id);
}
function upsertClass(cls){
  const all = loadClasses();
  const idx = all.findIndex(c => c.id === cls.id);
  cls.updatedAt = Date.now();
  if(idx>=0) all[idx]=cls; else all.unshift(cls);
  saveClasses(all);
}
function deleteClass(id){
  saveClasses(loadClasses().filter(c => c.id !== id));
  // unassign sessions from deleted class
  const sess = loadSessions();
  let changed = false;
  sess.forEach(s=>{
    if(s.classId===id){ s.classId=null; s.studentId=null; changed=true; }
  });
  if(changed) saveSessions(sess);
}
function loadDefaults(){
  return loadJson(DEFAULTS_KEY, { instructorName:"", instructorEmail:"", location:"" });
}
function saveDefaults(d){
  saveJson(DEFAULTS_KEY, d || {});
}

/* ---------- UI state ---------- */
const state = {
  view: "list",     // 'list' | 'class'
  classId: null,    // selected class
  ui: loadJson(UI_KEY, { openSections: {} }),
  debounce: null,
};
function saveUI(){
  saveJson(UI_KEY, { view: state.view, classId: state.classId, openSections: state.ui.openSections || {} });
}

/* ---------- DOM ---------- */
const app = () => document.getElementById("app");
function el(tag, attrs, ...children){

function num(v){
  if(v===null||v===undefined||v==="") return null;
  if(typeof v==="string"){
    const s=v.trim();
    if(s.endsWith("%")){
      const n=Number(s.slice(0,-1));
      return Number.isFinite(n)?n:null;
    }
    if(/^\d{1,2}:\d{2}$/.test(s)){
      const parts=s.split(":").map(Number);
      if(parts.every(Number.isFinite)) return parts[0]*60+parts[1];
    }
  }
  const n=Number(v);
  return Number.isFinite(n)?n:null;
}
function fmtMs(ms){ ms=Math.max(0,Number(ms)||0); const s=Math.round(ms/1000); const mm=String(Math.floor(s/60)).padStart(2,"0"); const ss=String(s%60).padStart(2,"0"); return `${mm}:${ss}`; }
function stamp(ts){ if(!ts) return ""; try{ return new Date(ts).toLocaleString(); }catch{ return ""; } }

function normalizeSession(raw){
  const s = raw || {};
  const startedAt = s.startedAt ?? s.startAt ?? s.started ?? s.timestamp ?? s.createdAt ?? null;
  const endedAt   = s.endedAt ?? s.endAt ?? s.ended ?? s.finishedAt ?? null;

  const ccfPct = num(s.ccfPct ?? s.ccf ?? s.ccfPercent ?? s.finalCCF ?? s.finalCcf ?? s.ccfScore ?? s.ccf_score);

  let durationSec = num(s.durationSec ?? s.totalSec ?? s.totalSeconds ?? s.elapsedSec);
  const totalMs = num(s.totalMs ?? s.elapsedMs);
  if(durationSec==null && totalMs!=null) durationSec = totalMs/1000;
  if(durationSec==null && startedAt && endedAt) durationSec = Math.max(0,(new Date(endedAt)-new Date(startedAt))/1000);

  const pauses = Array.isArray(s.pauses)?s.pauses:(Array.isArray(s.pauseEvents)?s.pauseEvents:[]);
  const pauseCount = pauses.length || num(s.pauseCount) || 0;

  let handsOffSec = num(s.handsOffSec ?? s.handsOffSeconds);
  const offMs = num(s.offMs);
  if(handsOffSec==null && offMs!=null) handsOffSec = offMs/1000;
  if(handsOffSec==null && pauses.length){
    handsOffSec = pauses.reduce((a,p)=>a + (num(p.ms ?? p.durMs ?? p.durationMs) || 0),0)/1000;
  }

  let longestPause = null;
  if(pauses.length){
    const best = pauses.slice().sort((a,b)=>(num(b.ms??b.durMs??b.durationMs)??0)-(num(a.ms??a.durMs??a.durationMs)??0))[0];
    const ms = num(best.ms ?? best.durMs ?? best.durationMs) ?? 0;
    const reason = (best.reasons && best.reasons.length) ? best.reasons.join(", ") : (best.reason || "Unspecified");
    const startMs = num(best.startMs ?? best.atMs ?? best.tMs);
    longestPause = {ms, reason, startMs};
  } else if(s.longestPauseMs || s.longestPauseSec){
    const ms = num(s.longestPauseMs) ?? (num(s.longestPauseSec)??0)*1000;
    longestPause = {ms, reason:(s.longestPauseReason||"Unspecified"), startMs:null};
  }

  return {...s, startedAt, endedAt, ccfPct, durationSec, pauseCount, handsOffSec, pauses, longestPause};
}

function renderPauseList(pauses){
  if(!pauses || !pauses.length) return el("div",{class:"muted", style:"margin-top:8px; opacity:.85;"},["No pause reasons recorded"]);
  const list = pauses.slice(0,12).map((p,i)=>{
    const ms = num(p.ms ?? p.durMs ?? p.durationMs) ?? 0;
    const reason = (p.reasons && p.reasons.length) ? p.reasons.join(", ") : (p.reason || "Unspecified");
    const atMs = num(p.startMs ?? p.atMs ?? p.tMs);
    const atStr = (atMs!=null) ? fmtMs(atMs) : "";
    return el("div",{style:"display:flex; justify-content:space-between; gap:10px; padding:6px 0; border-top:1px solid rgba(255,255,255,.06);"},[
      el("div",{style:"font-weight:700;"},[reason]),
      el("div",{style:"opacity:.85; white-space:nowrap;"},[((atStr?atStr+" • ":"")+Math.round(ms/1000)+"s")])
    ]);
  });
  const wrap = el("div",{style:"margin-top:10px; padding:10px 12px; border-radius:14px; border:1px solid rgba(255,255,255,.10); background:rgba(0,0,0,.18);"},[
    el("div",{style:"font-weight:800; margin-bottom:6px;"},["Pauses (time • reason)"]),
    ...list
  ]);
  return wrap;
}




  const n = document.createElement(tag);

  const isAttrs =
    attrs &&
    typeof attrs === "object" &&
    !Array.isArray(attrs) &&
    !(attrs instanceof Node) &&
    !(attrs instanceof NodeList) &&
    !(attrs instanceof HTMLCollection);

  if(!isAttrs){
    children = [attrs, ...children];
    attrs = {};
  }

  Object.entries(attrs||{}).forEach(([k,v])=>{
    if(k==="class") n.className = v;
    else if(k==="html") n.innerHTML = v;
    else if(k.startsWith("on") && typeof v==="function")
      n.addEventListener(k.slice(2).toLowerCase(), v);
    else if(v!==null && v!==undefined)
      n.setAttribute(k, String(v));
  });

  const append = (ch)=>{
    if(ch===null || ch===undefined || ch===false) return;

    if(Array.isArray(ch)){
      ch.forEach(append);
    }
    else if(ch instanceof Node){
      n.appendChild(ch);
    }
    else if(ch instanceof NodeList || ch instanceof HTMLCollection){
      Array.from(ch).forEach(append);
    }
    else {
      n.appendChild(document.createTextNode(String(ch)));
    }
  };

  children.forEach(append);
  return n;
}

function sessionStamp(s){
  const t = s?.startedAt ?? s?.endedAt ?? s?.ended ?? s?.timestamp ?? null;
  return t ? new Date(t).toLocaleString() : "";
}

function fmtDateISO(iso){
  try{
    if(!iso) return "";
    const d = new Date(iso+"T00:00:00");
    return d.toLocaleDateString();
  }catch{ return iso || ""; }
}
function todayISO(){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}
function clampInt(v, min, max, fallback){
  const n = parseInt(v, 10);
  if(Number.isFinite(n)){
    return Math.max(min, Math.min(max, n));
  }
  return fallback;
}

/* ---------- Accordion ---------- */
function accKey(classId, sectionId){ return `${classId||"list"}:${sectionId}`; }
function isOpen(classId, sectionId){
  const k = accKey(classId, sectionId);
  return !!(state.ui.openSections && state.ui.openSections[k]);
}
function setOpen(classId, sectionId, open){
  state.ui.openSections = state.ui.openSections || {};
  state.ui.openSections[accKey(classId, sectionId)] = !!open;
  saveUI();
}
function Accordion({classId, id, title, subtitle, defaultOpen=false, bodyEl}){
  const open = isOpen(classId, id) || defaultOpen;
  const hdr = el("button", { class:"accHeader",
    "data-acc": id, type:"button" }, [
    el("div", { class:"accHdrLeft" }, [
      el("div", { class:"accTitle" }, [title]),
      subtitle ? el("div", { class:"accSub" }, [subtitle]) : null
    ]),
    el("div", { class:"accChevron", "data-open": open ? "1":"0" }, [open ? "▾" : "▸"])
  ]);

  const body = el("div", { class:"accBody", style: open ? "" : "display:none;" }, [bodyEl]);

  hdr.addEventListener("click", ()=>{
    const now = body.style.display !== "none";
    body.style.display = now ? "none" : "";
    hdr.querySelector(".accChevron").textContent = now ? "▸" : "▾";
    setOpen(classId, id, !now);
  });

  return el("section", { class:"accWrap" }, [hdr, body]);
}

/* ---------- Render: List view ---------- */

function renderList(){
  state.view = "list";
  state.classId = null;

  // On entry, default everything collapsed unless user previously opened something
  if(!state.ui.openSections) state.ui.openSections = {};
  const defaults = { classes:false, latest:false, unassigned:false, export:false };
  Object.keys(defaults).forEach(k=>{
    if(typeof state.ui.openSections[k] !== "boolean") state.ui.openSections[k] = defaults[k];
  });

  saveUI();

  const classes = loadClasses().sort((a,b)=>(b.updatedAt||b.createdAt||0)-(a.updatedAt||a.createdAt||0));
  const sessions = loadSessions();
  const mostRecentClass = classes[0] || null;
  const latestSession = sessions.length ? sessions[sessions.length-1] : null;

  // Unassigned = not linked to a student (may be linked to a class)
  const unassigned = sessions.filter(s => !s.studentId).slice().sort((a,b)=>(b.startedAt||0)-(a.startedAt||0));

  const container = el("div", { class:"pad16" }, []);

  //  stays at the top
  container.appendChild(el("button", { class:"primaryBtn", type:"button", id:"btnNewClassTop" }, [""]));

  //  button (opens classes accordion)
  container.appendChild(el("button", { class:"secondaryBtn", type:"button", id:"btnViewClasses", style:"margin-top:10px;" }, [""]));

  // Classes accordion body
  const classesBody = el("div", {}, []);
  if(!classes.length){
    classesBody.appendChild(el("div", { class:"dashSub" }, ["No classes yet. Tap + New Class to start."]));
  }else{
    classesBody.appendChild(el("div", { class:"dashSub" }, ["All saved classes (tap to open)."]));
    const list = el("div", { class:"stack10", style:"margin-top:10px;" }, []);
    classes.forEach(cls => list.appendChild(classCard(cls)));
    classesBody.appendChild(list);

    classesBody.appendChild(el("div", { class:"row", style:"gap:10px; margin-top:12px; flex-wrap:wrap;" }, [
      el("button", { class:"secondaryBtn", type:"button", id:"btnDlAllClasses" }, ["Download all classes (CSV)"]),
      el("button", { class:"secondaryBtn", type:"button", id:"btnEmailAllClasses" }, ["Email all classes"]),
    ]));
  }

  container.appendChild(Accordion({
    classId:null,
    id:"classes",
    title:"Classes",
    subtitle: classes.length ? `${classes.length} saved` : "None yet",
    defaultOpen:false,
    bodyEl: classesBody
  }));

  // Most recent session
  const latestBody = el("div", {}, []);

  latestBody.appendChild(el("div", { class:"dashSub" }, ["Most recent CPR session (assign it quickly)."]));

  // Class picker defaults to most recent created class
  const clsSel = el("select", { id:"latestClassPicker" }, [
    el("option", { value:"" }, ["— Select class —"]),
    ...classes.map(c => el("option", { value:c.id }, [`${(c.name||"Class")} • ${fmtDateISO(c.dateISO||todayISO())}`]))
  ]);
  if(mostRecentClass) clsSel.value = mostRecentClass.id;

  latestBody.appendChild(el("label", { class:"field", style:"margin-top:10px;" }, [
    el("span", { class:"fieldLabel" }, ["Assign into class"]),
    clsSel
  ]));

  // Session preview
  latestBody.appendChild(el("div", { class:"reportCard", id:"latestSessionCard", style:"margin-top:10px;" }, []));

  latestBody.appendChild(el("div", { class:"divider", style:"margin:12px 0;" }, []));

  // Student picker
  latestBody.appendChild(el("div", { class:"dashTitle" }, ["Assign to student"]));
  latestBody.appendChild(el("div", { class:"studentRow", style:"margin-top:10px; align-items:flex-end;" }, [
    el("label", { class:"field", style:"margin:0; flex:1;" }, [
      el("span", { class:"fieldLabel" }, ["Student"]),
      el("select", { id:"latestStudentSelect" }, [ el("option", { value:"" }, ["— Select student —"]) ])
    ]),
    el("button", { class:"endBtn", type:"button", id:"btnAssignLatest" }, ["Assign to student"])
  ]));

  // Add student inline (simple)
  latestBody.appendChild(el("div", { class:"studentRow", style:"margin-top:10px; align-items:flex-end;" }, [
    el("label", { class:"field", style:"margin:0; flex:1;" }, [
      el("span", { class:"fieldLabel" }, ["Or add student now"]),
      el("input", { id:"latestAddStudentName", type:"text", placeholder:"Student name" }, [])
    ]),
    el("button", { class:"secondaryBtn", type:"button", id:"btnLatestAddAssign" }, ["Add & Assign"])
  ]));

  latestBody.appendChild(el("div", { class:"row", style:"gap:10px; margin-top:10px; flex-wrap:wrap;" }, [
    el("button", { class:"secondaryBtn", type:"button", id:"btnLatestOpenReport" }, ["Open report"]),
    el("button", { class:"secondaryBtn", type:"button", id:"btnLatestDownload" }, ["Download"]),
    el("button", { class:"secondaryBtn", type:"button", id:"btnLatestEmail" }, ["Email"]),
    el("button", { class:"secondaryBtn", type:"button", id:"btnLatestDelete" }, ["Delete"])
  ]));

  container.appendChild(Accordion({
    classId:null,
    id:"latest",
    title:"Most Recent CCF Session",
    subtitle: latestSession ? (latestSession.startedAt ? new Date(latestSession.startedAt).toLocaleString() : "") : "No sessions yet",
    defaultOpen:true,
    bodyEl: latestBody
  }));

  // Unassigned sessions (timestamped)
  const unBody = el("div", {}, []);
  unBody.appendChild(el("div", { class:"dashSub" }, ["Unassigned sessions (no student). Assign or delete."]));
  const unList = el("div", { class:"stack10", style:"margin-top:10px;" }, []);
  if(!unassigned.length){
    unList.appendChild(el("div", { class:"empty" }, ["No unassigned sessions."]));
  }else{
    unassigned.slice(0,50).forEach(s => unList.appendChild(sessionRow(s, { mode:"unassigned", classId:null })));
  }
  unBody.appendChild(unList);

  container.appendChild(Accordion({
    classId:null,
    id:"unassigned",
    title:"Unassigned sessions",
    subtitle: unassigned.length ? `${unassigned.length} saved` : "None",
    defaultOpen:false,
    bodyEl: unBody
  }));

  // Export
  const exportBody = renderExportPanel(classes);
  container.appendChild(Accordion({
    classId:null,
    id:"export",
    title:"Export",
    subtitle:"Download / print / email",
    defaultOpen:false,
    bodyEl: exportBody
  }));

  app().innerHTML = "";
  app().appendChild(container);

  // Wire buttons
  safeBind("btnNewClassTop", ()=>{
    const d = loadDefaults();
    const cls = {
      id: uid(),
      name: "",
      dateISO: todayISO(),
      instructorName: d.instructorName || "",
      instructorEmail: d.instructorEmail || "",
      location: d.location || "",
      students: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      targetCcf: 80
    };
    upsertClass(cls);
    openClass(cls.id, true);
  });

  safeBind("btnDlAllClasses", ()=>{
    downloadText(exportAllClassesCSV(), safeFile("ccf-classes-all.csv"));
  });

  safeBind("btnEmailAllClasses", ()=>{
    emailText("CCF Classes (All)", exportAllClassesCSV());
  });

  // Latest session render + bind
  renderLatestSession(latestSession);

  safeBind("latestClassPicker", ()=>{
    populateLatestStudents();
  }, "change");

  safeBind("btnLatestOpenReport", ()=>{
    if(!latestSession) return alert("No sessions saved yet.");
    showSessionModal(latestSession);
  });

  safeBind("btnLatestDownload", ()=>{
    if(!latestSession) return alert("No sessions saved yet.");
    downloadText(buildSessionTxt(latestSession), safeFile(`ccf-${latestSession.startedAt||Date.now()}.txt`));
  });

  safeBind("btnLatestEmail", ()=>{
    if(!latestSession) return alert("No sessions saved yet.");
    emailText("CCF Session Report", buildSessionTxt(latestSession));
  });

  safeBind("btnLatestDelete", ()=>{
    if(!latestSession) return alert("No sessions saved yet.");
    if(confirm("Delete the most recent session?")){
      deleteSessionById(latestSession.id);
      renderList();
    }
  });

  safeBind("btnLatestAddAssign", ()=>{
    const classId = document.getElementById("latestClassPicker").value;
    if(!classId) return alert("Select a class first.");
    if(!latestSession) return alert("No sessions saved yet.");
    const nm = String(document.getElementById("latestAddStudentName").value||"").trim();
    if(!nm) return alert("Enter a student name.");
    const st = addStudentToClass(classId, nm);
    assignSession(latestSession.id, classId, st.id);
    document.getElementById("latestAddStudentName").value = "";
    renderList();
  });

  safeBind("btnAssignLatest", ()=>{
  if(!latestSession) return alert("No sessions saved yet.");
  const classId = document.getElementById("latestClassPicker")?.value || "";
  if(!classId) return alert("Select a class first.");
  const studentId = document.getElementById("latestStudentSelect")?.value || "";
  if(!studentId) return alert("Select a student (or use Add Student).");
  const arr = loadSessions();
  const idx = arr.findIndex(x=>x.id===latestSession.id);
  if(idx<0) return;
  arr[idx].classId = classId;
  arr[idx].studentId = studentId;
  saveSessions(arr);
  localStorage.setItem("ccf.currentClassId", classId);
  alert("Assigned to student.");
  boot();
});

  populateLatestStudents();
}


function classCard(cls){
  const students = Array.isArray(cls.students) ? cls.students : [];
  const sessions = loadSessions().filter(s => s.classId === cls.id);
  const assignedToStudent = sessions.filter(s => s.studentId).length;

  const title = (cls.name && cls.name.trim()) ? cls.name.trim() : "(Untitled class)";
  const meta = [
    cls.dateISO ? fmtDateISO(cls.dateISO) : "",
    cls.instructorName ? cls.instructorName : "",
    cls.location ? cls.location : "",
  ].filter(Boolean).join(" • ");

  const stats = `${students.length} students • ${assignedToStudent}/${sessions.length} assigned`;

  const card = el("button", { class:"classCard", type:"button" }, [
    el("div", { class:"classCardTop" }, [
      el("div", { class:"className" }, [title]),
      el("div", { class:"classMeta" }, [meta || ""])
    ]),
    el("div", { class:"classStats" }, [stats]),
  ]);
  card.addEventListener("click", ()=>openClass(cls.id, false));
  return card;
}

/* ---------- Render: Class view ---------- */
function openClass(classId, isNew){
  state.view = "class";
  state.classId = classId;
  saveUI();
  renderClass(classId, isNew);
}

function renderClass(classId, isNew){
  const cls0 = getClassById(classId);
  if(!cls0){
    renderList();
    return;
  }
  // Clone for in-memory edits
  let cls = JSON.parse(JSON.stringify(cls0));
  cls.students = Array.isArray(cls.students) ? cls.students : [];

  const header = el("div", { class:"pad16" }, [
    el("button", { class:"ghostBtn", type:"button", id:"btnBack" }, ["← Back to classes"]),
    el("div", { class:"dashTitle", style:"margin-top:10px;" }, [cls.name?.trim() ? cls.name.trim() : "Class"]),
    el("div", { class:"dashSub" }, [
      (cls.dateISO ? fmtDateISO(cls.dateISO) : ""),
      (cls.instructorName ? ` • ${cls.instructorName}` : ""),
      (cls.location ? ` • ${cls.location}` : "")
    ].join(""))
  ]);

  const body = el("div", { class:"pad16", style:"padding-top:0;" }, []);

  // --- Class info
  const infoBody = el("div", { class:"formGrid" }, [

// Class picker (switch between saved classes) + create new
el("div", { class:"row", style:"gap:10px; flex-wrap:wrap; align-items:flex-end; grid-column:1 / -1;" }, [
  el("label", { class:"field", style:"flex:1; min-width:220px; margin:0;" }, [
    el("span", { class:"fieldLabel" }, ["Select saved class (optional)"]),
    (function(){
      const sel = el("select", { id:"classPicker" }, [
        el("option", { value:"" }, ["— Current class —"]),
        ...loadClasses().map(c=> el("option", { value:c.id }, [
          `${(c.name||"Class")}${c.dateISO?(" • "+fmtDateISO(c.dateISO)):""}`
        ]))
      ]);
      return sel;
    })()
  ]),
  el("button", { class:"secondaryBtn", type:"button", id:"btnNewClassFromSetup" }, ["+ New class"])
]),

    field("Class name (optional)", "text", "className", cls.name || "", "Ex: EMT Skills Day"),
    field("Date", "date", "classDate", cls.dateISO || todayISO(), ""),
    field("Instructor (optional)", "text", "instrName", cls.instructorName || "", ""),
    field("Instructor email (optional)", "email", "instrEmail", cls.instructorEmail || "", ""),
    field("Location / notes (optional)", "text", "classLoc", cls.location || "", "Station / room / notes"),
    field("Target CCF % (optional)", "number", "targetCcf", String(cls.targetCcf ?? 80), ""),
    el("div", { class:"row", style:"gap:10px; flex-wrap:wrap; margin-top:6px;" }, [
      el("button", { class:"secondaryBtn", type:"button", id:"btnDeleteClass" }, ["Delete class"]),
      el("button", { class:"secondaryBtn", type:"button", id:"btnDownloadClass" }, ["Download class CSV"]),
      el("button", { class:"secondaryBtn", type:"button", id:"btnPrintClass" }, ["Print"]),
      el("button", { class:"secondaryBtn", type:"button", id:"btnEmailInstructor" }, ["Email instructor"]),
    ])
  ]);

  body.appendChild(Accordion({
    classId,
    id:"info",
    title:"Class setup",
    subtitle:"Name, date, instructor, location",
    defaultOpen: !!isNew, // new class opens setup
    bodyEl: infoBody
  }));

  // --- Students
  const rosterWrap = el("div", {}, [
    el("div", { class:"row", style:"justify-content:space-between; align-items:center; gap:10px;" }, [
      el("div", {}, [
        el("div", { class:"dashSub" }, ["Add students (name required for assignment). Email is optional."])
      ]),
      el("button", { class:"primaryBtn", type:"button", id:"btnAddStudent" }, ["+ Add Student"])
    ]),
    el("div", { id:"studentsList", class:"list", style:"margin-top:10px;" }, [])
  ]);
  
  // Students roster is part of Class Setup (not a separate accordion)
  infoBody.appendChild(el("div", { class:"divider", style:"margin:14px 0;" }, []));
  infoBody.appendChild(el("div", { class:"dashTitle" }, ["Students"]));
  infoBody.appendChild(el("div", { class:"dashSub" }, ["Add students to this class. Names can be left blank until you’re ready to assign sessions."]));
  infoBody.appendChild(rosterWrap);

// --- Assign Sessions (class context)
  const assignWrap = el("div", {}, [
    el("div", { class:"dashSub" }, ["Assign saved CCF sessions to students in this class."]),
    el("div", { id:"classSessionsList", class:"list", style:"margin-top:10px;" }, [])
  ]);
  body.appendChild(Accordion({
    classId,
    id:"assign",
    title:"Assign sessions",
    subtitle:"Link past runs to this class / student",
    defaultOpen:false,
    bodyEl: assignWrap
  }));

  // --- Dashboard
  const dashWrap = el("div", { id:"dashWrap" }, []);
  body.appendChild(Accordion({
    classId,
    id:"dashboard",
    title:"Class report",
    subtitle:"Overall performance + student reports",
    defaultOpen:false,
    bodyEl: dashWrap
  }));

  // --- Export
  const exportWrap = el("div", {}, [
    el("div", { class:"dashSub" }, ["Download / email results."]),
    el("div", { class:"row", style:"gap:10px; flex-wrap:wrap; margin-top:10px;" }, [
      el("button", { class:"secondaryBtn", type:"button", id:"btnEmailStudents" }, ["Email students (BCC)"]),
      el("button", { class:"secondaryBtn", type:"button", id:"btnDownloadAllSessions" }, ["Download assigned sessions CSV"]),
    ])
  ]);
  body.appendChild(Accordion({
    classId,
    id:"export",
    title:"Export",
    subtitle:"CSV / print / email",
    defaultOpen:false,
    bodyEl: exportWrap
  }));

  app().innerHTML = "";
  app().appendChild(header);
  app().appendChild(body);

  // Initial render lists
  renderStudents(cls);
  renderClassSessions(cls);
  renderDashboard(cls);

  // Handlers
  document.getElementById("btnBack").addEventListener("click", renderList);

// Class picker + new class (inside Class setup)
const clsPick = document.getElementById("classPicker");
if(clsPick){
  clsPick.addEventListener("change", ()=>{
    const v = clsPick.value;
    if(v) renderClass(v, false);
  });
}
const btnNewFrom = document.getElementById("btnNewClassFromSetup");
if(btnNewFrom){
  btnNewFrom.addEventListener("click", ()=>{
    const d = loadDefaults();
    const newCls = {
      id: uid(),
      name: "",
      dateISO: new Date().toISOString().slice(0,10),
      instructorName: d.instructorName || "",
      instructorEmail: d.instructorEmail || "",
      location: d.location || "",
      targetCcf: 80,
      sessionLengthSec: 120,
      students: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    upsertClass(newCls);
    renderClass(newCls.id, true);
  });
}


  // Autosave class fields (debounced)
  const debSave = ()=>{
    clearTimeout(state.debounce);
    state.debounce = setTimeout(()=>{
      upsertClass(cls);
      // update defaults
      const d = loadDefaults();
      d.instructorName = cls.instructorName || d.instructorName;
      d.instructorEmail = cls.instructorEmail || d.instructorEmail;
      d.location = cls.location || d.location;
      saveDefaults(d);
      // rerender header summary text without rerendering form
      document.getElementById("hdrTitle").textContent = "Reports";
    }, 250);
  };

  hookField("className", v=>{ cls.name = v; debSave(); });
  hookField("classDate", v=>{ cls.dateISO = v; debSave(); });
  hookField("instrName", v=>{ cls.instructorName = v; debSave(); });
  hookField("instrEmail", v=>{ cls.instructorEmail = v; debSave(); });
  hookField("classLoc", v=>{ cls.location = v; debSave(); });
  hookField("targetCcf", v=>{ cls.targetCcf = clampInt(v, 0, 100, 80); debSave(); });

  document.getElementById("btnAddStudent").addEventListener("click", ()=>{
    cls.students.push({ id: uid(), name:"", email:"", contact:"" });
    upsertClass(cls);
    renderStudents(cls, true);
  });

  document.getElementById("btnDeleteClass").addEventListener("click", ()=>{
    if(confirm("Delete this class? This does not delete the CPR sessions, only the class record.")){
      deleteClass(cls.id);
      renderList();
    }
  });

  document.getElementById("btnDownloadClass").addEventListener("click", ()=>{
    downloadText(buildClassCsv(cls), safeFile(`class-${cls.name||cls.id}.csv`));
  });

  document.getElementById("btnPrintClass").addEventListener("click", ()=>{
    printClass(cls);
  });

  document.getElementById("btnEmailInstructor").addEventListener("click", ()=>{
    emailInstructor(cls);
  });

  document.getElementById("btnEmailStudents").addEventListener("click", ()=>{
    emailStudents(cls);
  });

  document.getElementById("btnDownloadAllSessions").addEventListener("click", ()=>{
    downloadText(buildAssignedSessionsCsv(cls), safeFile(`sessions-${cls.name||cls.id}.csv`));
  });
}

/* ---------- UI bits ---------- */
function field(label, type, id, value, placeholder){
  const wrap = el("label", { class:"field" }, [
    el("span", { class:"fieldLabel" }, [label]),
    el("input", { id, type, value, placeholder: placeholder||"" })
  ]);
  return wrap;
}
function hookField(id, onChange){
  const input = document.getElementById(id);
  if(!input) return;
  input.addEventListener("input", ()=> onChange(input.value));
}
function renderStudents(cls, focusNew){
  const list = document.getElementById("studentsList");
  if(!list) return;
  list.innerHTML = "";
  if(!cls.students.length){
    list.appendChild(el("div", { class:"empty" }, ["No students yet. Tap “Add Student”."]));
    return;
  }
  cls.students.forEach((st, idx)=>{
    const card = el("div", { class:"studentCard" }, [
      el("div", { class:"studentRow" }, [
        el("label", { class:"field", style:"margin:0; flex:1;" }, [
          el("span", { class:"fieldLabel" }, ["Name"]),
          el("input", { type:"text", value: st.name||"", "data-stid": st.id, "data-k":"name", placeholder:"Student name" })
        ]),
        el("button", { class:"ghostIconBtn", type:"button", title:"Remove student" }, ["✕"])
      ]),
      el("div", { class:"studentRow", style:"margin-top:8px;" }, [
        el("label", { class:"field", style:"margin:0; flex:1;" }, [
          el("span", { class:"fieldLabel" }, ["Email (optional)"]),
          el("input", { type:"email", value: st.email||"", "data-stid": st.id, "data-k":"email", placeholder:"" })
        ]),
        el("label", { class:"field", style:"margin:0; flex:1;" }, [
          el("span", { class:"fieldLabel" }, ["Contact (optional)"]),
          el("input", { type:"text", value: st.contact||"", "data-stid": st.id, "data-k":"contact", placeholder:"" })
        ])
      ])
    ]);

    // remove
    card.querySelector(".ghostIconBtn").addEventListener("click", ()=>{
      if(confirm("Remove this student from the class roster?")){
        cls.students = cls.students.filter(s=>s.id!==st.id);
        // unassign sessions for this student in this class
        const sess = loadSessions();
        let changed=false;
        sess.forEach(s=>{
          if(s.classId===cls.id && s.studentId===st.id){ s.studentId=null; changed=true; }
        });
        if(changed) saveSessions(sess);
        upsertClass(cls);
        renderStudents(cls, false);
        renderDashboard(cls);
        renderClassSessions(cls);
      }
    });

    list.appendChild(card);
  });

  // input handlers without rerender (prevents keyboard closing)
  list.querySelectorAll("input[data-stid]").forEach(inp=>{
    inp.addEventListener("input", ()=>{
      const sid = inp.getAttribute("data-stid");
      const k = inp.getAttribute("data-k");
      const st = cls.students.find(s=>s.id===sid);
      if(st && k) st[k] = inp.value;
      // debounced save
      clearTimeout(state.debounce);
      state.debounce = setTimeout(()=>{
        upsertClass(cls);
      }, 250);
    });
  });

  if(focusNew){
    const last = list.querySelector('input[data-k="name"][data-stid]');
    if(last) last.focus();
  }
}

/* ---------- Sessions listing + assignment ---------- */
function sessionTitle(s){
  const when = s.startedAt ? new Date(s.startedAt).toLocaleString() : "Session";
  const ccf = (s.ccfPct!==undefined && s.ccfPct!==null) ? `${Math.round(s.ccfPct)}%` : "—";
  const pauses = (s.pauses && Array.isArray(s.pauses)) ? s.pauses.length : (s.pauseCount ?? 0);
  const ho = (s.handsOffSec!==undefined && s.handsOffSec!==null) ? `${Math.round(s.handsOffSec)}s hands-off` : "";
  return `${ccf} • ${pauses} pauses • ${ho}`.trim();
}
function sessionRow(s, {mode, classId}){
  const row = el("div", { class:"sessionRow" }, [
    el("div", { class:"sessionLeft" }, [
      el("div", { class:"sessionMain" }, [s.startedAt ? new Date(s.startedAt).toLocaleString() : "Session"]),
      el("div", { class:"sessionSub" }, [sessionTitle(s)])
    ]),
    el("div", { class:"sessionActions" }, [])
  ]);

  const actions = row.querySelector(".sessionActions");

  const btnView = el("button", { class:"secondaryBtn", type:"button" }, ["View"]);
  btnView.addEventListener("click", ()=> showSessionModal(s, classId || null));
  actions.appendChild(btnView);

  if(mode==="unassigned"){
    const btnAssign = el("button", { class:"primaryBtn", type:"button" }, ["Assign"]);
    btnAssign.addEventListener("click", ()=> showAssignModal(s));
    actions.appendChild(btnAssign);
  }

  const btnDl = el("button", { class:"secondaryBtn", type:"button" }, ["Download"]);
  btnDl.addEventListener("click", ()=>{
    downloadText(buildSessionTxt(s), safeFile(`ccf-${s.startedAt||Date.now()}.txt`));
  });
  actions.appendChild(btnDl);

  const btnDel = el("button", { class:"secondaryBtn", type:"button" }, ["Delete"]);
  btnDel.addEventListener("click", ()=>{
    if(confirm("Delete this saved session?")){
      const arr = loadSessions();
      saveSessions(arr.filter(x=>x.id!==s.id));
      boot();
    }
  });
  actions.appendChild(btnDel);

  return row;
}

function renderClassSessions(cls){
  const list = document.getElementById("classSessionsList");
  if(!list) return;
  list.innerHTML = "";

  const sessions = loadSessions().slice().reverse(); // newest first
  const classSessions = sessions.filter(s => (s.classId===cls.id) || (!s.classId && !s.studentId));
  if(!classSessions.length){
    list.appendChild(el("div", { class:"empty" }, ["No saved sessions yet. Run the timer to create sessions."]));
    return;
  }

  classSessions.slice(0, 25).forEach(s=>{
    const card = el("div", { class:"sessionAssignCard" }, [
      el("div", { class:"sessionMain" }, [s.startedAt ? new Date(s.startedAt).toLocaleString() : "Session"]),
      el("div", { class:"sessionSub" }, [sessionTitle(s)]),
      el("div", { class:"row", style:"gap:10px; margin-top:8px; flex-wrap:wrap; align-items:flex-end;" }, [
        el("label", { class:"field", style:"margin:0; flex:1; min-width:200px;" }, [
          el("span", { class:"fieldLabel" }, ["Assign to student (optional)"]),
          studentSelect(cls, s.studentId || "")
        ]),
        el("button", { class:"primaryBtn", type:"button" }, ["Assign to this class"]),
        el("button", { class:"secondaryBtn", type:"button" }, ["Unassign"]),
      ])
    ]);

    const sel = card.querySelector("select");
    const btnAssign = card.querySelectorAll("button")[0];
    const btnUnassign = card.querySelectorAll("button")[1];

    btnAssign.addEventListener("click", ()=>{
      const sid = sel.value || null;
      const arr = loadSessions();
      const idx = arr.findIndex(x=>x.id===s.id);
      if(idx<0) return;
      arr[idx].classId = cls.id;
      arr[idx].studentId = sid;
      saveSessions(arr);
      renderDashboard(cls);
      renderClassSessions(cls);
    });

    btnUnassign.addEventListener("click", ()=>{
      const arr = loadSessions();
      const idx = arr.findIndex(x=>x.id===s.id);
      if(idx<0) return;
      arr[idx].classId = null;
      arr[idx].studentId = null;
      saveSessions(arr);
      renderDashboard(cls);
      renderClassSessions(cls);
    });

    list.appendChild(card);
  });
}

function studentSelect(cls, selectedId){
  const sel = el("select", {}, []);
  sel.appendChild(el("option", { value:"" }, ["— Unassigned —"]));
  cls.students.forEach(st=>{
    const opt = el("option", { value: st.id }, [st.name || "(Unnamed)"]);
    if(st.id===selectedId) opt.selected = true;
    sel.appendChild(opt);
  });
  return sel;
}

/* ---------- Dashboard ---------- */
function renderDashboard(cls){
  const wrap = document.getElementById("dashWrap");
  if(!wrap) return;
  const sessions = loadSessions().filter(s=>s.classId===cls.id && s.studentId);

  const byStudent = new Map();
  sessions.forEach(s=>{
    const arr = byStudent.get(s.studentId) || [];
    arr.push(s);
    byStudent.set(s.studentId, arr);
  });

  const rows = cls.students.map(st=>{
    const ss = byStudent.get(st.id) || [];
    const attempts = ss.length;
    const avg = attempts ? ss.reduce((a,x)=>a + (x.ccfPct||0), 0)/attempts : null;
    const last = attempts ? ss.slice().sort((a,b)=>(b.startedAt||0)-(a.startedAt||0))[0] : null;
    return { st, attempts, avg, last };
  });

  const attempted = rows.filter(r=>r.attempts>0);
  const classAvg = attempted.length ? attempted.reduce((a,r)=>a + r.avg, 0)/attempted.length : null;
  const target = clampInt(cls.targetCcf ?? 80, 0, 100, 80);
  const passing = attempted.filter(r=> (r.avg >= target)).length;

  wrap.innerHTML = "";
  wrap.appendChild(el("div", { class:"dashCard" }, [
    el("div", { class:"dashTitle" }, ["Class summary"]),
    el("div", { class:"dashGrid" }, [
      stat("Avg CCF", classAvg===null ? "—" : `${Math.round(classAvg)}%`),
      stat("Passing", `${passing}/${cls.students.length}`),
      stat("Assigned sessions", String(sessions.length)),
      stat("Target", `${target}%`),
    ])
  ]));

  const roster = el("div", { class:"dashCard", style:"margin-top:12px;" }, [
    el("div", { class:"dashTitle" }, ["Students"]),
    el("div", { class:"dashSub" }, ["Tap a student for their report."]),
    el("div", { class:"list", style:"margin-top:10px;" }, [])
  ]);

  const list = roster.querySelector(".list");
  if(!cls.students.length){
    list.appendChild(el("div", { class:"empty" }, ["No students in this class yet."]));
  }else{
    rows.forEach(r=>{
      const btn = el("button", { class:"studentReportRow", type:"button" }, [
        el("div", { class:"srLeft" }, [
          el("div", { class:"srName" }, [r.st.name || "(Unnamed)"]),
          el("div", { class:"srMeta" }, [`${r.attempts} attempt${r.attempts===1?"":"s"}`])
        ]),
        el("div", { class:"srRight" }, [
          el("div", { class:"srScore" }, [r.avg===null ? "—" : `${Math.round(r.avg)}%`]),
        ])
      ]);
      btn.addEventListener("click", ()=>showStudentModal(cls, r.st));
      list.appendChild(btn);
    });
  }
  wrap.appendChild(roster);
}

function stat(label, value){
  return el("div", { class:"stat" }, [
    el("div", { class:"statLabel" }, [label]),
    el("div", { class:"statValue" }, [value]),
  ]);
}

/* ---------- Modals (simple) ---------- */
function showModal(title, bodyEl){
  const overlay = el("div", { class:"modalOverlay" }, []);
  const card = el("div", { class:"modalCard" }, [
    el("div", { class:"modalHdr" }, [
      el("div", { class:"modalTitle" }, [title]),
      el("button", { class:"ghostIconBtn", type:"button" }, ["✕"])
    ]),
    el("div", { class:"modalBody" }, [bodyEl])
  ]);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  const close = ()=>{ overlay.remove(); };
  card.querySelector(".ghostIconBtn").addEventListener("click", close);
  overlay.addEventListener("click", (e)=>{ if(e.target===overlay) close(); });
  return { close };
}

function showStudentModal(cls, st){
  const sess = loadSessions().filter(s=>s.classId===cls.id && s.studentId===st.id)
    .slice().sort((a,b)=>(b.startedAt||0)-(a.startedAt||0));
  const avg = sess.length ? sess.reduce((a,x)=>a+(x.ccfPct||0),0)/sess.length : null;
  const best = sess.length ? Math.max(...sess.map(s=>s.ccfPct||0)) : null;
  const worst = sess.length ? Math.min(...sess.map(s=>s.ccfPct||0)) : null;

  const body = el("div", {}, [
    el("div", { class:"dashCard" }, [
      el("div", { class:"dashTitle" }, [st.name || "Student"]),
      el("div", { class:"dashGrid" }, [
        stat("Avg", avg===null?"—":`${Math.round(avg)}%`),
        stat("Best", best===null?"—":`${Math.round(best)}%`),
        stat("Worst", worst===null?"—":`${Math.round(worst)}%`),
        stat("Attempts", String(sess.length)),
      ])
    ]),
    el("div", { class:"dashCard", style:"margin-top:12px;" }, [
      el("div", { class:"dashTitle" }, ["Sessions"]),
      el("div", { class:"list", style:"margin-top:10px;" }, sess.slice(0, 25).map(s=>sessionRow(s, { mode:"class", classId: cls.id })))
    ])
  ]);
  showModal("Student report", body);
}

function showSessionModal(s){
  const body = el("div", {}, [
    el("div", { class:"dashSub" }, [s.startedAt ? new Date(s.startedAt).toLocaleString() : ""]),
    el("div", { class:"dashCard", style:"margin-top:10px;" }, [
      el("div", { class:"dashGrid" }, [
        stat("CCF", s.ccfPct==null?"—":`${Math.round(s.ccfPct)}%`),
        stat("Pauses", String((s.pauses && s.pauses.length) ? s.pauses.length : (s.pauseCount ?? 0))),
        stat("Hands-off", s.handsOffSec==null?"—":`${Math.round(s.handsOffSec)}s`),
        stat("Duration", s.durationSec==null?"—":`${Math.round(s.durationSec)}s`),
      ])
    ]),
    el("div", { class:"dashCard", style:"margin-top:12px;" }, [
      el("div", { class:"dashTitle" }, ["Longest pause"]),
      el("div", { class:"dashSub" }, [longestPauseSummary(s)])
    ])
  ]);
  showModal("Session", body);
}


function showAssignModal(s, opts){
  opts = opts || {};
  const classes = loadClasses();
  const suggestedClassId = opts.classId || (loadJson("ccf.currentClassId", "") || "");
  let classId = suggestedClassId && classes.some(c=>c.id===suggestedClassId) ? suggestedClassId : (classes[0]?.id || "");

  // Session report preview (full report)
  const sessionReport = el("div", { class:"dashCard", style:"margin-bottom:12px;" }, [
    el("div", { class:"dashTitle" }, ["Session report"]),
    el("div", { class:"dashSub" }, [s.startedAt ? new Date(s.startedAt).toLocaleString() : ""]),
    el("div", { class:"dashGrid", style:"margin-top:10px;" }, [
      stat("CCF", s.ccfPct==null?"—":`${Math.round(s.ccfPct)}%`),
      stat("Pauses", String((s.pauses && s.pauses.length) ? s.pauses.length : (s.pauseCount ?? 0))),
      stat("Hands-off", s.handsOffSec==null?"—":`${Math.round(s.handsOffSec)}s`),
      stat("Duration", s.durationSec==null?"—":`${Math.round(s.durationSec)}s`),
    ]),
    el("div", { class:"dashSub", style:"margin-top:10px;" }, ["Longest pause: " + longestPauseSummary(s)])
  ]);

  const classSel = el("select", { id:"assignClassSel" }, classes.map(c=>{
    const label = (c.name && String(c.name).trim()) ? String(c.name).trim() : "(Untitled)";
    const date = c.dateISO ? fmtDateISO(c.dateISO) : "";
    return el("option",{value:c.id},[date ? `${label} • ${date}` : label]);
  }));
  classSel.value = classId;

  const studentSelWrap = el("div", {}, []);
  const rebuildStudentSel = ()=>{
    const cls = getClassById(classSel.value);
    studentSelWrap.innerHTML = "";
    if(!cls){
      studentSelWrap.appendChild(el("div",{class:"dashSub"},["No class selected."]));
      return;
    }
    const sel = studentSelect(cls, "");
    sel.id = "assignStudentSel";
    studentSelWrap.appendChild(sel);
  };
  classSel.addEventListener("change", ()=>{
    localStorage.setItem("ccf.currentClassId", classSel.value || "");
    rebuildStudentSel();
  });

  const addName = el("input", { type:"text", placeholder:"New student name (optional)" });

  const body = el("div", {}, [
    sessionReport,

    el("label", { class:"field" }, [
      el("span",{class:"fieldLabel"},["Assign into class"]),
      classSel
    ]),
    el("label", { class:"field" }, [
      el("span",{class:"fieldLabel"},["Assign to student (optional)"]),
      studentSelWrap
    ]),
    el("label", { class:"field" }, [
      el("span",{class:"fieldLabel"},["Or add a new student now"]),
      addName
    ]),

    el("div", { class:"row", style:"gap:10px; margin-top:12px; flex-wrap:wrap; justify-content:space-between;" }, [
      el("button", { class:"primaryBtn", type:"button", id:"btnDoAssign" }, ["Assign"]),
      el("button", { class:"secondaryBtn", type:"button", id:"btnAssignDownload" }, ["Download"]),
      el("button", { class:"secondaryBtn", type:"button", id:"btnAssignEmail" }, ["Email"]),
      el("button", { class:"secondaryBtn", type:"button", id:"btnAssignDelete" }, ["Delete"])
    ])
  ]);

  rebuildStudentSel();
  const modal = showModal("Assign session", body);

  body.querySelector("#btnDoAssign").addEventListener("click", ()=>{
    const cid = classSel.value;
    const cls = getClassById(cid);
    if(!cls) return alert("Select a class.");

    let sid = body.querySelector("#assignStudentSel")?.value || null;
    const nm = String(addName.value || "").trim();
    if(nm){
      const st = { id: uid(), name: nm, email:"", contact:"" };
      cls.students = Array.isArray(cls.students) ? cls.students : [];
      cls.students.push(st);
      upsertClass(cls);
      sid = st.id;
      // refresh student dropdown
      rebuildStudentSel();
      body.querySelector("#assignStudentSel").value = st.id;
      addName.value = "";
    }

    const arr = loadSessions();
    const idx = arr.findIndex(x=>x.id===s.id);
    if(idx<0) return;
    arr[idx].classId = cid;
    arr[idx].studentId = sid;
    saveSessions(arr);

    localStorage.setItem("ccf.currentClassId", cid || "");
    modal.close();
    boot();
  });

  body.querySelector("#btnAssignDownload").addEventListener("click", ()=>{
    downloadText(buildSessionTxt(s), safeFile(`ccf-${s.startedAt||Date.now()}.txt`));
  });

  body.querySelector("#btnAssignEmail").addEventListener("click", ()=>{
    emailText("CCF Session Report", buildSessionTxt(s));
  });

  body.querySelector("#btnAssignDelete").addEventListener("click", ()=>{
    if(confirm("Delete this session? This cannot be undone.")){
      deleteSessionById(s.id);
      modal.close();
      boot();
    }
  });
}

/* ---------- Export / Print / Email ---------- */
function safeFile(name){
  return String(name).replace(/[^\w\-\.]+/g,"_").slice(0, 80);
}
function downloadText(text, filename){
  const blob = new Blob([text], {type:"text/plain"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename || "export.txt";
  document.body.appendChild(a);
  a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 0);
}


function buildAllClassesCsv(classes, sessions){
  classes = Array.isArray(classes) ? classes : [];
  sessions = Array.isArray(sessions) ? sessions : [];
  const lines = [];
  lines.push("class_id,class_name,date,instructor,instructor_email,location,students,assigned_sessions,avg_ccf");
  classes.forEach(c=>{
    const stCount = (c.students||[]).filter(s=>String(s?.name||"").trim()).length;
    const ss = sessions.filter(s=>s.classId===c.id && s.studentId);
    const avg = ss.length ? (ss.reduce((a,x)=>a+(Number(x.ccf)||0),0)/ss.length) : null;
    lines.push([
      csv(c.id),
      csv(c.name||""),
      csv(c.dateISO||""),
      csv(c.instructorName||""),
      csv(c.instructorEmail||""),
      csv(c.location||""),
      stCount,
      ss.length,
      avg===null ? "" : Math.round(avg)
    ].join(","));
  });
  return lines.join("\n");
}

function buildStudentCsv(cls, studentId, sessions){
  sessions = Array.isArray(sessions) ? sessions : [];
  const st = (cls.students||[]).find(s=>s.id===studentId);
  const ss = sessions.filter(s=>s.classId===cls.id && s.studentId===studentId);
  const lines = [];
  lines.push("class_name,student_name,student_email,session_id,started_at,ccf,pause_count,longest_pause_sec,longest_pause_reason");
  ss.forEach(s=>{
    lines.push([
      csv(cls.name||""),
      csv(st?.name||""),
      csv(st?.email||""),
      csv(s.id||""),
      csv(new Date(s.startedAt||0).toISOString()),
      s.ccf ?? "",
      s.pauseCount ?? "",
      s.longestPauseSec ?? "",
      csv(s.longestPauseReason||"")
    ].join(","));
  });
  if(!ss.length){
    lines.push([csv(cls.name||""),csv(st?.name||""),csv(st?.email||""),"","","","","",""].join(","));
  }
  return lines.join("\n");
}
function buildClassCsv(cls){
  const sessions = loadSessions().filter(s=>s.classId===cls.id);
  const lines = [];
  lines.push(["CLASS_NAME","DATE","INSTRUCTOR","INSTRUCTOR_EMAIL","LOCATION","STUDENT_COUNT","SESSION_COUNT"].join(","));
  lines.push(csvRow([cls.name||"", cls.dateISO||"", cls.instructorName||"", cls.instructorEmail||"", cls.location||"", String((cls.students||[]).length), String(sessions.length)]));
  lines.push("");
  lines.push(["STUDENTS"].join(","));
  lines.push(["STUDENT_ID","NAME","EMAIL","CONTACT"].join(","));
  (cls.students||[]).forEach(st=>lines.push(csvRow([st.id, st.name||"", st.email||"", st.contact||""])));
  lines.push("");
  lines.push(["SESSIONS"].join(","));
  lines.push(["SESSION_ID","STARTED_AT","CCF_PCT","PAUSE_COUNT","LONGEST_PAUSE_REASON","CLASS_ID","STUDENT_ID"].join(","));
  sessions.slice().sort((a,b)=>(a.startedAt||0)-(b.startedAt||0)).forEach(s=>{
    lines.push(csvRow([
      s.id||"",
      s.startedAt? new Date(s.startedAt).toISOString() : "",
      s.ccfPct==null? "" : String(Math.round(s.ccfPct)),
      String((s.pauses && s.pauses.length) ? s.pauses.length : (s.pauseCount ?? 0)),
      longestPauseReason(s)||"",
      s.classId||"",
      s.studentId||"",
    ]));
  });
  return lines.join("\n");
}
function buildAssignedSessionsCsv(cls){
  const sessions = loadSessions().filter(s=>s.classId===cls.id);
  const lines = [];
  lines.push(["SESSION_ID","STARTED_AT","CCF_PCT","PAUSE_COUNT","HANDS_OFF_SEC","DURATION_SEC","STUDENT_NAME"].join(","));
  sessions.slice().sort((a,b)=>(b.startedAt||0)-(a.startedAt||0)).forEach(s=>{
    const st = (cls.students||[]).find(x=>x.id===s.studentId);
    lines.push(csvRow([
      s.id||"",
      s.startedAt? new Date(s.startedAt).toISOString() : "",
      s.ccfPct==null? "" : String(Math.round(s.ccfPct)),
      String((s.pauses && s.pauses.length) ? s.pauses.length : (s.pauseCount ?? 0)),
      s.handsOffSec==null? "" : String(Math.round(s.handsOffSec)),
      s.durationSec==null? "" : String(Math.round(s.durationSec)),
      st?.name || ""
    ]));
  });
  return lines.join("\n");
}
function csvRow(arr){
  return arr.map(v=>{
    const s = String(v??"");
    if(/[,"\n]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
    return s;
  }).join(",");
}
function buildSessionTxt(s){
  return [
    "CCF SESSION",
    "----------",
    `Date: ${s.startedAt ? new Date(s.startedAt).toLocaleString() : ""}`,
    `CCF: ${s.ccfPct==null ? "—" : Math.round(s.ccfPct)+"%"}`,
    `Pauses: ${(s.pauses && s.pauses.length) ? s.pauses.length : (s.pauseCount ?? 0)}`,
    `Hands-off: ${s.handsOffSec==null ? "—" : Math.round(s.handsOffSec)+"s"}`,
    `Duration: ${s.durationSec==null ? "—" : Math.round(s.durationSec)+"s"}`,
    `Longest pause: ${longestPauseSummary(s)}`,
    "",
  ].join("\n");
}
function longestPauseReason(s){
  // session may store pauses with ms + reasons
  if(s.longestPauseReason) return s.longestPauseReason;
  if(!Array.isArray(s.pauses)) return "";
  let best=null;
  s.pauses.forEach(p=>{
    const ms = p.ms ?? p.durMs ?? 0;
    if(!best || ms>(best.ms||0)) best = { ms, p };
  });
  if(!best) return "";
  const p=best.p;
  const reasons = (p.reasons && p.reasons.length) ? p.reasons.join(", ") : (p.reason || "");
  return reasons || "";
}
function longestPauseSummary(s){
  const reason = longestPauseReason(s);
  const sec = longestPauseSeconds(s);
  if(!sec && !reason) return "—";
  return `${reason || "Unspecified"} (${sec ? sec+"s" : "—"})`;
}
function longestPauseSeconds(s){
  if(s.longestPauseSec!=null) return Math.round(s.longestPauseSec);
  if(!Array.isArray(s.pauses)) return 0;
  let best=0;
  s.pauses.forEach(p=>{
    const ms = p.ms ?? p.durMs ?? 0;
    if(ms>best) best=ms;
  });
  return best ? Math.round(best/1000) : 0;
}
function printClass(cls){
  const win = window.open("", "_blank");
  if(!win) return alert("Popup blocked. Allow popups to print.");
  const sessions = loadSessions().filter(s=>s.classId===cls.id && s.studentId);
  const byStudent = new Map();
  sessions.forEach(s=>{
    const arr=byStudent.get(s.studentId)||[];
    arr.push(s);
    byStudent.set(s.studentId, arr);
  });
  const rows = (cls.students||[]).map(st=>{
    const ss=byStudent.get(st.id)||[];
    const avg = ss.length ? Math.round(ss.reduce((a,x)=>a+(x.ccfPct||0),0)/ss.length) : null;
    return { st, avg, attempts: ss.length };
  });
  win.document.write(`
    <html><head><title>Class Report</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body{font-family:system-ui, -apple-system, Segoe UI, Roboto, sans-serif; padding:20px;}
      h1{margin:0 0 6px 0;}
      .meta{color:#555; margin-bottom:16px;}
      table{width:100%; border-collapse:collapse;}
      th,td{border:1px solid #ddd; padding:8px; text-align:left;}
      th{background:#f4f4f4;}
    </style></head><body>
    <h1>${escapeHtml(cls.name||"Class")}</h1>
    <div class="meta">${escapeHtml(cls.dateISO||"")} • ${escapeHtml(cls.instructorName||"")} • ${escapeHtml(cls.location||"")}</div>
    <table>
      <thead><tr><th>Student</th><th>Email</th><th>Attempts</th><th>Avg CCF</th></tr></thead>
      <tbody>
      ${rows.map(r=>`<tr>
        <td>${escapeHtml(r.st.name||"")}</td>
        <td>${escapeHtml(r.st.email||"")}</td>
        <td>${r.attempts}</td>
        <td>${r.avg==null?"—":(r.avg+"%")}</td>
      </tr>`).join("")}
      </tbody>
    </table>
    <script>window.print();</script>
    </body></html>
  `);
  win.document.close();
}
function emailInstructor(cls){
  const to = (cls.instructorEmail||"").trim();
  if(!to) return alert("Add an instructor email in Class setup first.");
  const subj = encodeURIComponent(`CCF Class Report: ${cls.name||"Class"} (${cls.dateISO||""})`);
  const body = encodeURIComponent(buildInstructorEmailBody(cls));
  window.location.href = `mailto:${encodeURIComponent(to)}?subject=${subj}&body=${body}`;
}
function buildInstructorEmailBody(cls){
  const sessions = loadSessions().filter(s=>s.classId===cls.id && s.studentId);
  const byStudent = new Map();
  sessions.forEach(s=>{
    const arr=byStudent.get(s.studentId)||[];
    arr.push(s);
    byStudent.set(s.studentId, arr);
  });
  const target = clampInt(cls.targetCcf ?? 80, 0, 100, 80);
  const rows = (cls.students||[]).map(st=>{
    const ss=byStudent.get(st.id)||[];
    const avg = ss.length ? Math.round(ss.reduce((a,x)=>a+(x.ccfPct||0),0)/ss.length) : null;
    return { st, avg, attempts: ss.length };
  });
  const attempted = rows.filter(r=>r.attempts>0);
  const classAvg = attempted.length ? Math.round(attempted.reduce((a,r)=>a+r.avg,0)/attempted.length) : null;
  const passing = attempted.filter(r=>r.avg>=target).length;

  return [
    `Class: ${cls.name||""}`,
    `Date: ${cls.dateISO||""}`,
    `Instructor: ${cls.instructorName||""}`,
    `Location: ${cls.location||""}`,
    "",
    `Target CCF: ${target}%`,
    `Class Avg CCF: ${classAvg==null?"—":(classAvg+"%")}`,
    `Passing: ${passing}/${rows.length}`,
    "",
    "Students:",
    ...rows.map(r=>`- ${r.st.name||"(Unnamed)"}: ${r.avg==null?"—":(r.avg+"%")} (${r.attempts} attempts)`),
    "",
    "Sent from CCF Trainer",
  ].join("\n");
}
function emailStudents(cls){
  const emails = (cls.students||[]).map(s=>String(s.email||"").trim()).filter(Boolean);
  if(!emails.length) return alert("No student emails in roster.");
  const subj = encodeURIComponent(`CCF Results: ${cls.name||"Class"} (${cls.dateISO||""})`);
  const body = encodeURIComponent("Your instructor has shared CCF results from CCF Trainer.\n\n(Results may be provided in a separate attachment or summary.)");
  // BCC
  window.location.href = `mailto:?bcc=${encodeURIComponent(emails.join(","))}&subject=${subj}&body=${body}`;
}
function escapeHtml(s){
  return String(s??"").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ---------- Boot ---------- */
function boot(){
  window.__REPORTS_BOOTED = true;

  // Pro gate
  if(!proEnabled()){
    renderProPaywall();
    return;
  }

  // restore view
  const saved = loadJson(UI_KEY, null);
  if(saved && saved.view==="class" && saved.classId && getClassById(saved.classId)){
    state.ui.openSections = saved.openSections || {};
    openClass(saved.classId, false);
  }else{
    state.ui.openSections = (saved && saved.openSections) ? saved.openSections : {};
    renderList();
  }
}

function __reportsFatal(err){
  try{ console.error(err); }catch{}
  try{
    const root = document.getElementById("app");
    if(root){
      root.innerHTML = `
        <div class="pad16">
          <div class="dashCard">
            <div class="dashTitle">Reports failed to load</div>
            <div class="dashSub" style="margin-top:6px;">${(err && err.message) ? err.message : err}</div>
            <div class="row" style="gap:10px; margin-top:12px; flex-wrap:wrap;">
              <button class="secondaryBtn" id="btnReportsRetry" type="button">Retry</button>
              <button class="endBtn" id="btnReportsClear" type="button">Reset Reports Data</button>
            </div>
            <div class="dashSub" style="margin-top:10px;">Tip: “Reset Reports Data” clears saved classes UI state (sessions are kept).</div>
          </div>
        </div>`;
      const r = document.getElementById("btnReportsRetry");
      if(r) r.onclick = ()=>{ location.reload(); };
      const c = document.getElementById("btnReportsClear");
      if(c) c.onclick = ()=>{
        try{
          localStorage.removeItem(CLASSES_KEY);
          localStorage.removeItem(DEFAULTS_KEY);
          localStorage.removeItem(UI_KEY);
        }catch{}
        location.reload();
      };
    }
  }catch{}
}
window.addEventListener("error", (e)=>{ __reportsFatal(e.error || e.message || e); });
window.addEventListener("unhandledrejection", (e)=>{ __reportsFatal(e.reason || e); });
document.addEventListener("DOMContentLoaded", ()=>{ try{ boot(); }catch(err){ __reportsFatal(err); } });

// If Pro is purchased while this page is open, refresh the UI.
window.addEventListener("ccf:pro-changed", ()=>{
  try{
    if(proEnabled()) location.reload();
    else renderProPaywall();
  }catch(e){}
});
window.addEventListener("storage", (e)=>{
  try{
    if(e && e.key === PRO_KEY){
      if(proEnabled()) location.reload();
      else renderProPaywall();
    }
  }catch(_e){}
});
function safeBind(id, fn, evt="click"){
  const elx = document.getElementById(id);
  if(!elx) return;
  const key = "__b_" + evt;
  if(elx.dataset[key]==="1") return;
  elx.dataset[key]="1";
  elx.addEventListener(evt, (e)=>{
    try{ fn(e); }catch(err){ console.error(err); alert("Reports error: " + err.message); }
  });
}

function scrollToAcc(id){
  const hdr = document.querySelector(`.accHeader[data-acc="${id}"]`);
  if(hdr) hdr.scrollIntoView({ behavior:"smooth", block:"start" });
}


function emailText(subject, body){
  const subj = encodeURIComponent(subject||"");
  const b = encodeURIComponent(body||"");
  window.location.href = `mailto:?subject=${subj}&body=${b}`;
}


function deleteSessionById(id){
  const arr = loadSessions();
  saveSessions(arr.filter(s=>s.id!==id));
}


function addStudentToClass(classId, name){
  const cls = getClassById(classId);
  if(!cls) throw new Error("Class not found");
  cls.students = Array.isArray(cls.students) ? cls.students : [];
  const nm = String(name||"").trim();
  if(!nm) throw new Error("Student name required");
  const existing = cls.students.find(s=>String(s.name||"").trim().toLowerCase()===nm.toLowerCase());
  if(existing) return existing;
  const st = { id: uid(), name: nm, email:"", contact:"", createdAt: Date.now() };
  cls.students.push(st);
  cls.updatedAt = Date.now();
  upsertClass(cls);
  return st;
}

function assignSession(sessionId, classId, studentId){
  const arr = loadSessions();
  const idx = arr.findIndex(s=>s.id===sessionId);
  if(idx<0) throw new Error("Session not found");
  arr[idx].classId = classId || null;
  arr[idx].studentId = studentId || null;
  saveSessions(arr);
  // touch class
  if(classId){
    const cls = getClassById(classId);
    if(cls){ cls.updatedAt = Date.now(); upsertClass(cls); }
  }
}


function renderExportPanel(classes){
  const wrap = el("div", {}, []);

  wrap.appendChild(el("div", { class:"dashSub" }, ["Choose what to export."]));

  const scope = el("select", { id:"exportScope" }, [
    el("option", { value:"all" }, ["Everything (all classes + all sessions)"]),
    el("option", { value:"class" }, ["One class"]),
    el("option", { value:"student" }, ["One student (within a class)"]),
  ]);

  const pick = el("div", { id:"exportPick", style:"margin-top:10px; display:grid; gap:10px;" }, []);
  wrap.appendChild(el("label", { class:"field", style:"margin-top:10px;" }, [
    el("span", { class:"fieldLabel" }, ["Export scope"]),
    scope
  ]));
  wrap.appendChild(pick);

  const btnRow = el("div", { class:"row", style:"gap:10px; margin-top:10px; flex-wrap:wrap;" }, [
    el("button", { class:"secondaryBtn", type:"button", id:"btnExportDownload" }, ["Download CSV"]),
    el("button", { class:"secondaryBtn", type:"button", id:"btnExportEmail" }, ["Email CSV"]),
  ]);
  wrap.appendChild(btnRow);

  function renderPick(){
    pick.innerHTML = "";
    const v = scope.value;
    if(v==="class"){
      pick.appendChild(el("label", { class:"field" }, [
        el("span",{class:"fieldLabel"},["Class"]),
        el("select",{id:"exportClass"}, [
          ...classes.map(c=>el("option",{value:c.id},[`${(c.name||"Class")} • ${fmtDateISO(c.dateISO||todayISO())}`]))
        ])
      ]));
    }else if(v==="student"){
      const classSel = el("select", { id:"exportClass" }, [
        ...classes.map(c=>el("option",{value:c.id},[`${(c.name||"Class")} • ${fmtDateISO(c.dateISO||todayISO())}`]))
      ]);
      const studentSel = el("select", { id:"exportStudent" }, [ el("option",{value:""},["— Select student —"]) ]);
      const rebuildStudents = ()=>{
        const cls = getClassById(classSel.value);
        studentSel.innerHTML = "";
        studentSel.appendChild(el("option",{value:""},["— Select student —"]));
        (cls?.students||[]).forEach(st=>{
          studentSel.appendChild(el("option",{value:st.id},[st.name||"(Unnamed)"]));
        });
      };
      classSel.addEventListener("change", rebuildStudents);
      rebuildStudents();

      pick.appendChild(el("label", { class:"field" }, [
        el("span",{class:"fieldLabel"},["Class"]),
        classSel
      ]));
      pick.appendChild(el("label", { class:"field" }, [
        el("span",{class:"fieldLabel"},["Student"]),
        studentSel
      ]));
    }else{
      pick.appendChild(el("div", { class:"dashSub" }, ["Exports all saved classes and sessions."]));
    }
  }
  renderPick();
  scope.addEventListener("change", renderPick);

  // handlers
  setTimeout(()=>{
    safeBind("btnExportDownload", ()=>{
      const csv = buildExportCSV(scope.value);
      downloadText(csv, safeFile(`ccf-export-${scope.value}.csv`));
    });
    safeBind("btnExportEmail", ()=>{
      const csv = buildExportCSV(scope.value);
      emailText("CCF Export", csv);
    });
  },0);

  return wrap;
}

function buildExportCSV(scope){
  const classes = loadClasses();
  const sessions = loadSessions();

  if(scope==="class"){
    const classId = document.getElementById("exportClass")?.value;
    return exportOneClassCSV(classId);
  }
  if(scope==="student"){
    const classId = document.getElementById("exportClass")?.value;
    const studentId = document.getElementById("exportStudent")?.value;
    return exportOneStudentCSV(classId, studentId);
  }
  // all
  return exportAllCSV();
}

function csvEscape(v){
  const s = String(v ?? "");
  if(/[",\n]/.test(s)) return '"' + s.replace(/"/g,'""') + '"';
  return s;
}

function exportAllClassesCSV(){
  const classes = loadClasses().sort((a,b)=>(b.updatedAt||b.createdAt||0)-(a.updatedAt||a.createdAt||0));
  const header = ["classId","className","date","instructor","instructorEmail","location","targetCcf","studentCount","createdAt","updatedAt"].join(",");
  const rows = classes.map(c=>[
    c.id, c.name||"", c.dateISO||"", c.instructorName||"", c.instructorEmail||"", c.location||"", c.targetCcf??"", (c.students||[]).length, c.createdAt||"", c.updatedAt||""
  ].map(csvEscape).join(","));
  return [header, ...rows].join("\n");
}

function exportAllSessionsCSV(){
  const classesById = new Map(loadClasses().map(c=>[c.id,c]));
  const header = ["sessionId","startedAt","ccfPct","pauseCount","handsOffSec","durationSec","classId","className","studentId","studentName"].join(",");
  const rows = loadSessions().map(s=>{
    const cls = s.classId ? classesById.get(s.classId) : null;
    const st = (cls && cls.students) ? cls.students.find(x=>x.id===s.studentId) : null;
    return [
      s.id, s.startedAt?new Date(s.startedAt).toISOString():"", s.ccfPct??"", (s.pauses&&s.pauses.length)?s.pauses.length:(s.pauseCount??""), s.handsOffSec??"", s.durationSec??"",
      s.classId||"", cls?.name||"", s.studentId||"", st?.name||""
    ].map(csvEscape).join(",");
  });
  return [header, ...rows].join("\n");
}

function exportAllCSV(){
  return exportAllClassesCSV() + "\n\n" + exportAllSessionsCSV();
}

function exportOneClassCSV(classId){
  if(!classId) return "No class selected";
  const cls = getClassById(classId);
  if(!cls) return "Class not found";
  const sessions = loadSessions().filter(s=>s.classId===classId);
  const header = ["className","date","instructor","instructorEmail","location","targetCcf"].join(",");
  const classRow = [cls.name||"", cls.dateISO||"", cls.instructorName||"", cls.instructorEmail||"", cls.location||"", cls.targetCcf??""].map(csvEscape).join(",");
  const studHeader = ["studentId","studentName","studentEmail","studentContact"].join(",");
  const studRows = (cls.students||[]).map(st=>[st.id, st.name||"", st.email||"", st.contact||""].map(csvEscape).join(","));
  const sessHeader = ["sessionId","startedAt","ccfPct","pauseCount","handsOffSec","durationSec","studentId","studentName"].join(",");
  const sessRows = sessions.map(s=>{
    const st = (cls.students||[]).find(x=>x.id===s.studentId);
    return [s.id, s.startedAt?new Date(s.startedAt).toLocaleString():"", s.ccfPct??"", (s.pauses&&s.pauses.length)?s.pauses.length:(s.pauseCount??""), s.handsOffSec??"", s.durationSec??"", s.studentId||"", st?.name||""].map(csvEscape).join(",");
  });
  return [header, classRow, "", studHeader, ...studRows, "", sessHeader, ...sessRows].join("\n");
}

function exportOneStudentCSV(classId, studentId){
  if(!classId || !studentId) return "Select class and student";
  const cls = getClassById(classId);
  if(!cls) return "Class not found";
  const st = (cls.students||[]).find(x=>x.id===studentId);
  if(!st) return "Student not found";
  const sessions = loadSessions().filter(s=>s.classId===classId && s.studentId===studentId);
  const header = ["studentName","studentEmail","className","classDate","attempts"].join(",");
  const row = [st.name||"", st.email||"", cls.name||"", cls.dateISO||"", sessions.length].map(csvEscape).join(",");
  const sessHeader = ["sessionId","startedAt","ccfPct","pauseCount","handsOffSec","durationSec","longestPause"].join(",");
  const sessRows = sessions.map(s=>[s.id, s.startedAt?new Date(s.startedAt).toLocaleString():"", s.ccfPct??"", (s.pauses&&s.pauses.length)?s.pauses.length:(s.pauseCount??""), s.handsOffSec??"", s.durationSec??"", longestPauseSummary(s)].map(csvEscape).join(","));
  return [header, row, "", sessHeader, ...sessRows].join("\n");
}


function renderLatestSession(latestSession){
  const card = document.getElementById("latestSessionCard");
  if(!card) return;
  card.innerHTML = "";
  if(!latestSession){
    card.appendChild(el("div", { class:"dashSub" }, ["No saved sessions yet. Run a session to see it here."]));
    return;
  }

  // Header
  card.appendChild(el("div", { class:"dashTitle" }, ["Last session report"]));
  const stamp = sessionStamp(latestSession);
  if(stamp) card.appendChild(el("div", { class:"dashSub" }, [stamp]));

  // Key stats
  card.appendChild(el("div", { class:"dashGrid", style:"margin-top:10px;" }, [
    stat("CCF", latestSession.ccfPct==null?"—":`${Math.round(latestSession.ccfPct)}%`),
    stat("Pauses", String((latestSession.pauses && latestSession.pauses.length) ? latestSession.pauses.length : (latestSession.pauseCount ?? 0))),
    stat("Hands-off", latestSession.handsOffSec==null?"—":`${Math.round(latestSession.handsOffSec)}s`),
    stat("Duration", latestSession.durationSec==null?"—":`${Math.round(latestSession.durationSec)}s`),
  ]));

  card.appendChild(el("div", { class:"dashSub", style:"margin-top:10px;" }, [
    "Longest pause: ", longestPauseSummary(latestSession)
  ]));

  // Pause list
  const pauses = Array.isArray(latestSession.pauses) ? latestSession.pauses : [];
  if(!pauses.length){
    card.appendChild(el("div", { class:"dashSub", style:"margin-top:10px; opacity:.85;" }, [
      "No pauses recorded (pause prompt may be OFF)."
    ]));
    return;
  }

  card.appendChild(el("div", { class:"dashTitle", style:"margin-top:12px;" }, ["Pauses"]));
  const list = el("div", { class:"pauseList", style:"display:grid; gap:8px; margin-top:8px;" }, []);
  pauses.forEach((p,i)=>{
    const reason = (p.reasons && p.reasons.length) ? p.reasons.join(", ") : (p.reason || "Unspecified");
    const ms = p.ms ?? p.durMs ?? 0;
    // show either relative time (if startMs exists) or order
    const rel = (p.startMs!=null) ? `@ ${fmt(p.startMs)}` : `#${i+1}`;
    list.appendChild(el("div", { class:"pauseRow", style:"padding:10px 12px; border:1px solid rgba(255,255,255,.08); border-radius:14px; background:rgba(0,0,0,.08);" }, [
      el("div", { style:"display:flex; justify-content:space-between; gap:10px; align-items:baseline;" }, [
        el("div", { style:"font-weight:800;" }, [reason]),
        el("div", { style:"opacity:.9; font-variant-numeric: tabular-nums;" }, [fmt(ms)])
      ]),
      el("div", { class:"dashSub", style:"margin-top:4px; opacity:.85;" }, [rel])
    ]));
  });
  card.appendChild(list);
}


function populateLatestStudents(){
  const classId = document.getElementById("latestClassPicker")?.value || "";
  const sel = document.getElementById("latestStudentSelect");
  if(!sel) return;
  sel.innerHTML = "";
  sel.appendChild(el("option", { value:"" }, ["— Select student —"]));
  if(!classId) return;
  const cls = getClassById(classId);
  if(!cls) return;
  (cls.students||[]).forEach(st=>{
    sel.appendChild(el("option", { value:st.id }, [st.name || "(Unnamed)"]));
  });
}
