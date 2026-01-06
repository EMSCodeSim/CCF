
/* =========================================================
   Reports (Mobile-first)
   - Local-only class + roster storage
   - Sessions from timer: localStorage key ccf_sessions_v1
   ========================================================= */

const SESSIONS_KEY = "ccf_sessions_v1";
const CLASSES_KEY  = "ccf.classes.v1";
const DEFAULTS_KEY = "ccf.classDefaults.v1";
const UI_KEY       = "ccf.reports.ui.v1"; // remembers last view/class

// Later: re-enable Pro gating by checking ccf.proUnlocked.
// For now, everything is enabled (per your request).
const PRO_MODE = true;

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
function el(tag, attrs={}, children=[]){
  const n = document.createElement(tag);
  Object.entries(attrs||{}).forEach(([k,v])=>{
    if(k==="class") n.className = v;
    else if(k==="html") n.innerHTML = v;
    else if(k.startsWith("on") && typeof v==="function") n.addEventListener(k.slice(2).toLowerCase(), v);
    else if(v!==null && v!==undefined) n.setAttribute(k, String(v));
  });
  (children||[]).forEach(ch=>{
    if(ch===null || ch===undefined) return;
    if(typeof ch==="string") n.appendChild(document.createTextNode(ch));
    else n.appendChild(ch);
  });
  return n;
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
  const hdr = el("button", { class:"accHeader", type:"button" }, [
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
  saveUI();

  const classes = loadClasses();
  const sessions = loadSessions();

  const unassigned = sessions.filter(s => !s.classId && !s.studentId);

  const container = el("div", { class:"pad16" }, [
    el("div", { class:"row", style:"justify-content:space-between; align-items:center; gap:10px;" }, [
      el("div", {}, [
        el("div", { class:"dashTitle" }, ["Classes"]),
        el("div", { class:"dashSub" }, ["Create a class, add students, then assign CCF sessions."])
      ]),
      el("button", { class:"primaryBtn", type:"button", id:"btnNewClass" }, ["+ New Class"])
    ]),
  ]);

  // Unassigned sessions (collapsed by default)
  const unBody = el("div", {}, [
    unassigned.length ? el("div", { class:"dashSub" }, [`Unassigned sessions: ${unassigned.length}`]) :
      el("div", { class:"dashSub" }, ["No unassigned sessions."]),
    el("div", { class:"list" }, unassigned.slice().reverse().slice(0, 15).map(s => sessionRow(s, { mode:"unassigned" })))
  ]);
  container.appendChild(Accordion({
    classId:null,
    id:"unassigned",
    title:"Unassigned sessions",
    subtitle:"Assign past runs to a class/student",
    defaultOpen:false,
    bodyEl: unBody
  }));

  // Class list
  const listEl = el("div", { class:"list", style:"margin-top:12px;" }, []);
  if(!classes.length){
    listEl.appendChild(el("div", { class:"empty" }, ["No classes yet. Tap “New Class” to create one."]));
  }else{
    classes.forEach(cls => listEl.appendChild(classCard(cls)));
  }
  container.appendChild(listEl);

  app().innerHTML = "";
  app().appendChild(container);

  document.getElementById("btnNewClass").addEventListener("click", ()=>{
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
      targetCcf: 80,
    };
    upsertClass(cls);
    openClass(cls.id, true);
  });
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
  body.appendChild(Accordion({
    classId,
    id:"students",
    title:"Students",
    subtitle:`${cls.students.length} in roster`,
    defaultOpen:false,
    bodyEl: rosterWrap
  }));

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
      el("div", { class:"sessionMain" }, [sessionTitle(s)]),
      el("div", { class:"sessionSub" }, [s.startedAt ? new Date(s.startedAt).toLocaleString() : ""])
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
      el("div", { class:"sessionMain" }, [sessionTitle(s)]),
      el("div", { class:"sessionSub" }, [s.startedAt ? new Date(s.startedAt).toLocaleString() : ""]),
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

function showAssignModal(s){
  // pick class then student
  const classes = loadClasses();
  let classId = classes[0]?.id || "";
  const classSel = el("select", {}, classes.map(c=>el("option",{value:c.id},[c.name?.trim()?c.name.trim():"(Untitled)"])));
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
  classSel.addEventListener("change", rebuildStudentSel);

  const addName = el("input", { type:"text", placeholder:"Add new student name (optional)" });
  const body = el("div", {}, [
    el("label", { class:"field" }, [
      el("span",{class:"fieldLabel"},["Class"]),
      classSel
    ]),
    el("label", { class:"field" }, [
      el("span",{class:"fieldLabel"},["Student (optional)"]),
      studentSelWrap
    ]),
    el("label", { class:"field" }, [
      el("span",{class:"fieldLabel"},["Or add a new student now"]),
      addName
    ]),
    el("div", { class:"row", style:"gap:10px; margin-top:10px; flex-wrap:wrap;" }, [
      el("button", { class:"primaryBtn", type:"button", id:"btnDoAssign" }, ["Assign"]),
    ])
  ]);
  rebuildStudentSel();
  const modal = showModal("Assign session", body);

  body.querySelector("#btnDoAssign").addEventListener("click", ()=>{
    const cid = classSel.value;
    const cls = getClassById(cid);
    if(!cls) return alert("Select a class.");

    let sid = body.querySelector("#assignStudentSel").value || null;

    const nm = (addName.value||"").trim();
    if(nm){
      const st = { id: uid(), name: nm, email:"", contact:"" };
      cls.students = Array.isArray(cls.students) ? cls.students : [];
      cls.students.push(st);
      upsertClass(cls);
      sid = st.id;
    }

    const arr = loadSessions();
    const idx = arr.findIndex(x=>x.id===s.id);
    if(idx<0) return;
    arr[idx].classId = cid;
    arr[idx].studentId = sid;
    saveSessions(arr);
    modal.close();
    boot();
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

document.addEventListener("DOMContentLoaded", boot);
