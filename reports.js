
/* CCF Reports (Option B, Modal-based) - Stable paths: /reports.js and /CCF/reports.js */
(function(){
  "use strict";

  const CLASSES_KEY = "ccf.classes.v1";
  const SESSIONS_KEY = "ccf_sessions_v1";

  // One-time migration from legacy keys (pre-v1)
  (function migrateLegacyStorage(){
    try{
      const legacyClasses = localStorage.getItem("ccf.classes");
      const legacySessions = localStorage.getItem("ccf.sessions");
      const hasV1Classes = !!localStorage.getItem(CLASSES_KEY);
      const hasV1Sessions = !!localStorage.getItem(SESSIONS_KEY);

      if(!hasV1Classes && legacyClasses) localStorage.setItem(CLASSES_KEY, legacyClasses);
      if(!hasV1Sessions && legacySessions) localStorage.setItem(SESSIONS_KEY, legacySessions);
    }catch(e){}
  })();

  const $ = (sel, root=document) => root.querySelector(sel);

  function el(tag, attrs={}, children=[]){
    const node = document.createElement(tag);
    for(const [k,v] of Object.entries(attrs||{})){
      if(k === "class") node.className = v;
      else if(k === "style") node.setAttribute("style", v);
      else if(k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
      else if(v === true) node.setAttribute(k, k);
      else if(v !== false && v != null) node.setAttribute(k, String(v));
    }
    if(!Array.isArray(children)) children=[children];
    children.forEach(ch=>{
      if(ch == null) return;
      if(typeof ch === "string" || typeof ch === "number") node.appendChild(document.createTextNode(String(ch)));
      else node.appendChild(ch);
    });
    return node;
  }

  function uid(prefix="id"){
    return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
  }

  function toast(msg){
    try{
      const t = el("div",{class:"toast"},[String(msg||"")]);
      document.body.appendChild(t);
      setTimeout(()=>{ try{ t.remove(); }catch(e){} }, 1700);
    }catch(e){
      try{ alert(msg); }catch(_){}
    }
  }

  function loadJson(key, fallback){
    try{
      const raw = localStorage.getItem(key);
      if(!raw) return fallback;
      return JSON.parse(raw);
    }catch(e){
      return fallback;
    }
  }
  function saveJson(key, val){
    localStorage.setItem(key, JSON.stringify(val));
  }

  function num(v){
    if(v===null||v===undefined||v==="") return null;
    if(typeof v==="string"){
      const s=v.trim();
      if(s.endsWith("%")){
        const n=Number(s.slice(0,-1));
        return Number.isFinite(n)?n:null;
      }
    }
    const n=Number(v);
    return Number.isFinite(n)?n:null;
  }
  function fmtTimeMs(ms){
    ms = Math.max(0, Number(ms)||0);
    const sec = Math.round(ms/1000);
    const mm = String(Math.floor(sec/60)).padStart(2,"0");
    const ss = String(sec%60).padStart(2,"0");
    return `${mm}:${ss}`;
  }
  function fmtDateTime(ts){
    if(!ts) return "—";
    const d = new Date(ts);
    return d.toLocaleString(undefined,{month:"short", day:"numeric", year:"numeric", hour:"numeric", minute:"2-digit"});
  }
  function fmtTimeOnly(ts){
    if(!ts) return "—";
    const d=new Date(ts);
    return d.toLocaleString(undefined,{hour:"numeric", minute:"2-digit"});
  }
  function fmtDateOnly(ts){
    if(!ts) return "—";
    const d=new Date(ts);
    return d.toLocaleString(undefined,{month:"short", day:"numeric", year:"numeric"});
  }

  function groupPauseTimeByReason(pauses){
    const map = new Map();
    (pauses||[]).forEach(p=>{
      const ms = num(p.ms ?? p.durMs ?? p.durationMs) ?? 0;
      let reasons = [];
      if(Array.isArray(p.reasons) && p.reasons.length) reasons = p.reasons;
      else if(p.reason) reasons = [p.reason];
      else reasons = ["Unspecified"];
      reasons.forEach(r=>{
        const key = String(r||"Unspecified");
        map.set(key, (map.get(key)||0) + ms);
      });
    });
    return Array.from(map.entries())
      .map(([reason, ms])=>({reason, ms}))
      .sort((a,b)=>b.ms-a.ms);
  }

  function normalizeSession(raw){
    const s = raw || {};
    const endedAt = s.endedAt || s.endAt || s.timestamp || null;

    const totalMs = num(s.totalMs ?? s.elapsedMs);
    const compMs  = num(s.compMs);
    const offMs   = num(s.offMs);

    let ccfPct = num(s.ccfPct ?? s.ccfPercent ?? s.finalCCF ?? s.finalCcf ?? s.ccfScore);
    if(ccfPct==null && totalMs!=null && compMs!=null && totalMs>0){
      ccfPct = (compMs/totalMs)*100;
    }

    const pauses = Array.isArray(s.pauses) ? s.pauses : [];
    const pauseCount = (num(s.pauseCount) ?? pauses.length ?? 0);

    let longestPauseMs = num(s.longestPauseMs);
    let longestPauseReason = null;

    if((longestPauseMs==null || longestPauseMs===0) && pauses.length){
      const best = pauses.reduce((best,p)=>{
        const d = num(p.ms ?? p.durMs ?? p.durationMs) ?? 0;
        return d > (best?.d||0) ? {p,d} : best;
      }, null);
      longestPauseMs = best?.d ?? 0;
      const p = best?.p;
      if(p){
        longestPauseReason = (p.reasons && p.reasons.length) ? p.reasons.join(", ") : (p.reason || "Unspecified");
      }
    } else if(pauses.length){
      const p = pauses.find(p => (num(p.ms ?? p.durMs ?? p.durationMs) ?? 0) === longestPauseMs) || null;
      if(p){
        longestPauseReason = (p.reasons && p.reasons.length) ? p.reasons.join(", ") : (p.reason || "Unspecified");
      }
    }

    const id = s.id || uid("ses");
    const pauseTotalMs = pauses.reduce((a,p)=>a + (num(p.ms ?? p.durMs ?? p.durationMs) ?? 0), 0);
    const pauseBreakdown = groupPauseTimeByReason(pauses);

    return {
      ...s,
      id,
      endedAt,
      totalMs, compMs, offMs,
      ccfPct,
      pauseCount,
      pauses,
      longestPauseMs: longestPauseMs ?? 0,
      longestPauseReason: longestPauseReason || (longestPauseMs ? "Unspecified" : null),
      pauseTotalMs,
      pauseBreakdown,
      // assignment fields (normalized)
      assignedClassId: s.assignedClassId ?? null,
      assignedStudentId: s.assignedStudentId ?? null,
      assignedAt: s.assignedAt ?? null,
      instructorNote: s.instructorNote ?? ""
    };
  }

  function normalizeSessions(arr){
    const inArr = Array.isArray(arr) ? arr : [];
    let changed = false;
    const out = inArr.map(s=>{
      const ns = normalizeSession(s);
      if(ns.id !== s?.id) changed = true;
      // Ensure endedAt exists if possible
      if(!ns.endedAt && (ns.timestamp || ns.endAt)) changed = true;
      return ns;
    });
    if(changed) saveSessions(out);
    return out;
  }

  function normalizeClasses(list){
    const inArr = Array.isArray(list) ? list : [];
    let changed = false;
    const out = inArr.map(c=>{
      if(!c || typeof c !== "object") return null;
      const cc = {...c};
      if(!cc.id){ cc.id = uid("cls"); changed = true; }
      if(!Array.isArray(cc.students)){ cc.students = []; changed = true; }
      cc.students = cc.students.map(st=>{
        const s = {...st};
        if(!s.id){ s.id = uid("stu"); changed = true; }
        if(!s.name) s.name = "";
        if(!s.email) s.email = "";
        return s;
      });
      if(!cc.createdAt){ cc.createdAt = Date.now(); changed = true; }
      if(!cc.updatedAt){ cc.updatedAt = Date.now(); changed = true; }
      return cc;
    }).filter(Boolean);
    if(changed) saveClasses(out);
    return out;
  }

  function loadClasses(){
    return normalizeClasses(loadJson(CLASSES_KEY, []));
  }
  function saveClasses(classes){
    saveJson(CLASSES_KEY, classes);
  }
  function loadSessions(){
    return normalizeSessions(loadJson(SESSIONS_KEY, []));
  }
  function saveSessions(sessions){
    saveJson(SESSIONS_KEY, sessions);
  }

  // Selectors
  function getUnassignedSessions(sessions){
    return (sessions||[])
      .filter(s => !s.assignedClassId && !s.assignedStudentId)
      .sort((a,b)=>(b.endedAt||0)-(a.endedAt||0));
  }
  function getMostRecentUnassigned(sessions){
    return getUnassignedSessions(sessions)[0] || null;
  }
  function getClassById(classes, id){
    return (classes||[]).find(c=>c.id===id) || null;
  }
  function getStudentsForClass(classes, classId){
    const c = getClassById(classes, classId);
    return c ? (c.students||[]) : [];
  }

  // Actions
  function deleteSession(sessionId){
    const sessions = loadSessions().filter(s=>s.id!==sessionId);
    saveSessions(sessions);
    toast("Session deleted");
  }

  function assignSession(sessionId, classId, studentId, note){
    if(!classId) { toast("Select a class"); return false; }
    if(!studentId){ toast("Select a student"); return false; }
    const sessions = loadSessions();
    const idx = sessions.findIndex(s=>s.id===sessionId);
    if(idx<0) return false;
    sessions[idx] = {
      ...sessions[idx],
      assignedClassId: classId,
      assignedStudentId: studentId,
      assignedAt: Date.now(),
      instructorNote: note || ""
    };
    saveSessions(sessions);
    toast("Assigned");
    return true;
  }

  function upsertClass(cls){
    const classes = loadClasses();
    const now = Date.now();
    if(!cls.id){
      cls.id = uid("cls");
      cls.createdAt = now;
    }
    cls.updatedAt = now;
    cls.students = (cls.students||[]).map(s=>{
      if(!s.id) s.id = uid("stu");
      return {id:s.id, name:(s.name||"").trim(), email:(s.email||"").trim()};
    }).filter(s=>s.name);
    const idx = classes.findIndex(c=>c.id===cls.id);
    if(idx>=0) classes[idx] = {...classes[idx], ...cls};
    else classes.unshift(cls);
    saveClasses(classes);
    toast(idx>=0 ? "Class updated" : "Class created");
    return cls.id;
  }

  function deleteClass(classId){
    const classes = loadClasses().filter(c=>c.id!==classId);
    saveClasses(classes);
    // unassign sessions that referenced this class
    const sessions = loadSessions().map(s=>{
      if(s.assignedClassId===classId){
        return {...s, assignedClassId:null, assignedStudentId:null, assignedAt:null, instructorNote:""};
      }
      return s;
    });
    saveSessions(sessions);
    toast("Class deleted");
  }

  // CSV exports
  function toCsv(rows){
    const esc = (v)=>{
      const s = (v==null) ? "" : String(v);
      if(/[",\n]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
      return s;
    };
    if(!rows.length) return "";
    const cols = Object.keys(rows[0]);
    const out = [cols.join(",")];
    rows.forEach(r=>{
      out.push(cols.map(c=>esc(r[c])).join(","));
    });
    return out.join("\n");
  }
  function downloadText(filename, text){
    const blob = new Blob([text], {type:"text/csv;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const a = el("a",{href:url, download:filename});
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 0);
  }

  function sessionToRow(s, classes){
    const c = s.assignedClassId ? getClassById(classes, s.assignedClassId) : null;
    const st = c && s.assignedStudentId ? (c.students||[]).find(x=>x.id===s.assignedStudentId) : null;

    const breakdown = (s.pauseBreakdown||[]).map(r=>`${r.reason}=${Math.round(r.ms/1000)}`).join("; ");
    return {
      session_id: s.id,
      ended_at: s.endedAt ? new Date(s.endedAt).toISOString() : "",
      ccf_percent: s.ccfPct!=null ? Math.round(s.ccfPct) : "",
      duration_sec: s.totalMs!=null ? Math.round(s.totalMs/1000) : "",
      hands_off_sec: s.offMs!=null ? Math.round(s.offMs/1000) : "",
      pause_count: s.pauseCount ?? "",
      longest_pause_reason: s.longestPauseReason || "",
      longest_pause_sec: s.longestPauseMs!=null ? Math.round(s.longestPauseMs/1000) : "",
      pause_total_sec: s.pauseTotalMs!=null ? Math.round(s.pauseTotalMs/1000) : "",
      pause_breakdown: breakdown,
      assigned_class_id: s.assignedClassId || "",
      assigned_class_name: c ? c.name || "" : "",
      assigned_student_id: s.assignedStudentId || "",
      assigned_student_name: st ? st.name || "" : "",
      instructor_note: s.instructorNote || ""
    };
  }

  // UI state
  const ui = {
    activeModal: null, // "session" | "classEditor" | "classDetail"
    activeSessionId: null,
    activeClassId: null,
    classDetailTab: "roster", // roster | sessions | summary
    classDetailStudentId: null,
    classEditorMode: "create",
    classEditorId: null,
    classEditorDraft: null,
    postModalScroll: null
  };

  function clearApp(){
    const app = $("#app");
    if(app) app.innerHTML = "";
    // remove existing modals
    document.querySelectorAll(".modalOverlay").forEach(n=>n.remove());
  }

  // Render helpers
  function card(title, bodyChildren){
    return el("div",{class:"card"},[
      title ? el("div",{class:"cardTitle"},[title]) : null,
      el("div",{class:"cardBody"}, bodyChildren || [])
    ]);
  }

  function confirmDialog(title, msg, onYes){
    const overlay = el("div",{class:"modalOverlay"},[
      el("div",{class:"modal"},[
        el("div",{class:"modalHeader"},[
          el("div",{class:"modalTitle"},[title||"Confirm"]),
          el("button",{class:"ghostBtn", onClick:()=>overlay.remove()},["Close"])
        ]),
        el("div",{class:"modalBody"},[
          el("div",{class:"dashSub"},[msg||""])
        ]),
        el("div",{class:"modalFooter"},[
          el("button",{class:"ghostBtn", onClick:()=>overlay.remove()},["Cancel"]),
          el("button",{class:"dangerBtn", onClick:()=>{ overlay.remove(); onYes && onYes(); }},["Delete"])
        ])
      ])
    ]);
    document.body.appendChild(overlay);
  }

  function openSessionModal(sessionId){
    ui.activeModal="session";
    ui.activeSessionId=sessionId;
    render();
  }
  function openClassEditor(mode="create", classId=null){
    ui.activeModal="classEditor";
    ui.classEditorMode=mode;
    ui.classEditorId=classId;

    // Initialize a persistent draft so Add Student works without losing changes on re-render.
    const classes = loadClasses();
    if(mode === "edit" && classId){
      const src = classes.find(c=>c.id===classId);
      ui.classEditorDraft = src ? JSON.parse(JSON.stringify(src)) : blankClass();
    } else {
      ui.classEditorDraft = blankClass();
    }
    ui.postModalScroll = null;
    render();
  }
  function openClassDetail(classId){
    ui.activeModal="classDetail";
    ui.activeClassId=classId;
    ui.classDetailTab="roster";
    ui.classDetailStudentId=null;
    render();
  }
  function closeModal(){
    ui.activeModal=null;
    ui.activeSessionId=null;
    ui.classEditorId=null;
    ui.classEditorDraft=null;
    ui.postModalScroll=null;
    render();
  }

  function renderMostRecentUnassigned(app, sessions, classes){
    const s = getMostRecentUnassigned(sessions);
    if(!s){
      app.appendChild(card("Most Recent (Unassigned)",[
        el("div",{class:"dashSub"},["No unassigned sessions."]),
        el("div",{class:"dashSub", style:"opacity:.85; margin-top:6px;"},["Run a new CPR session or review class/student reports below."])
      ]));
      return;
    }

    let classId = "";
    let studentId = "";
    let noteOpen = false;
    let noteText = "";

    const studentSelect = el("select",{class:"input", disabled:true},[
      el("option",{value:""},["Select a class to assign to a student."])
    ]);

    const classSelect = el("select",{class:"input"},[
      el("option",{value:""},["No class"]),
      ...classes.map(c=>el("option",{value:c.id},[`${c.name||"Untitled"} • ${c.date||""}`]))
    ]);

    const assignBtn = el("button",{class:"primaryBtn", disabled:true},["Assign"]);

    function refreshStudentOptions(){
      const st = classId ? getStudentsForClass(classes, classId) : [];
      studentSelect.innerHTML="";
      if(!classId){
        studentSelect.appendChild(el("option",{value:""},["Select a class to assign to a student."]));
        studentSelect.disabled = true;
        studentId="";
      } else {
        studentSelect.disabled = false;
        studentSelect.appendChild(el("option",{value:""},["Select student…"]));
        st.forEach(x=>studentSelect.appendChild(el("option",{value:x.id},[x.name])));
      }
      assignBtn.disabled = !(classId && studentId);
    }

    classSelect.addEventListener("change", ()=>{
      classId = classSelect.value || "";
      refreshStudentOptions();
    });
    studentSelect.addEventListener("change", ()=>{
      studentId = studentSelect.value || "";
      assignBtn.disabled = !(classId && studentId);
    });

    const noteWrap = el("div",{style:"margin-top:8px; display:none;"},[
      el("textarea",{class:"input", rows:"2", placeholder:"Optional instructor note…", onInput:(e)=>{ noteText = e.target.value; }})
    ]);

    const noteToggle = el("button",{class:"ghostBtn", onClick:()=>{
      noteOpen = !noteOpen;
      noteWrap.style.display = noteOpen ? "block" : "none";
    }},["Add note (optional)"]);

    assignBtn.addEventListener("click", ()=>{
      const ok = assignSession(s.id, classId, studentId, noteText);
      if(ok) render(); // refresh lists
    });

    const openBtn = el("button",{class:"ghostBtn", onClick:()=>openSessionModal(s.id)},["Open full report"]);
    const delBtn = el("button",{class:"dangerBtn", onClick:()=>confirmDialog("Delete session?","This will remove this session from device.",()=>{ deleteSession(s.id); render(); })},["Delete"]);

    app.appendChild(card("Most Recent (Unassigned)",[
      el("div",{class:"dashRow"},[
        el("div",{class:"dashTitle"},[`Session • ${fmtDateOnly(s.endedAt)} ${fmtTimeOnly(s.endedAt)}`]),
      ]),
      el("div",{class:"scoreBig"},[`CCF ${s.ccfPct!=null ? Math.round(s.ccfPct) : "—"}%`]),
      el("div",{class:"statsGrid"},[
        stat("Duration", s.totalMs!=null ? fmtTimeMs(s.totalMs) : "—"),
        stat("Hands-off", s.offMs!=null ? fmtTimeMs(s.offMs) : "—"),
        stat("Pauses", s.pauseCount!=null ? String(s.pauseCount) : "0"),
        stat("Longest", (s.longestPauseMs ? `${s.longestPauseReason||"Unspecified"} • ${fmtTimeMs(s.longestPauseMs)}` : "—"))
      ]),
      el("div",{class:"btnRow"},[openBtn, delBtn]),
      el("div",{class:"dashTitle", style:"margin-top:10px;"},["Assign to"]),
      el("label",{class:"fieldLbl"},["Class (optional)"]),
      classSelect,
      el("label",{class:"fieldLbl", style:"margin-top:8px;"},["Student"]),
      studentSelect,
      el("div",{class:"btnRow", style:"margin-top:10px;"},[assignBtn]),
      noteToggle,
      noteWrap
    ]));

    refreshStudentOptions();
  }

  function stat(label, value){
    return el("div",{class:"stat"},[
      el("div",{class:"statLabel"},[label]),
      el("div",{class:"statValue"},[value])
    ]);
  }

  
  function renderReportsHeader(app, classes, sessions){
    const totalStudents = classes.reduce((a,c)=>a+((c.students||[]).length),0);
    const assignedCount = sessions.filter(s=> (s.assignedStudentId||s.studentId||s.assignedTo)).length;
    const unassignedCount = sessions.length - assignedCount;

    app.appendChild(card(null,[
      el("div",{class:"reportsHero"},[
        el("div",{class:"reportsHeroTitle"},["Instructor Reports"]),
        el("div",{class:"reportsHeroSub"},["Create classes and rosters, review performance by student, and export reports."])
      ]),
      el("div",{class:"statsRow"},[
        stat("Classes", String(classes.length)),
        stat("Students", String(totalStudents)),
        stat("Sessions", String(sessions.length)),
        stat("Unassigned", String(unassignedCount))
      ])
    ]));
  }

  function renderAssignedOverview(app, classes, sessions){
    // Recent assigned sessions (quick access)
    const recent = sessions
      .filter(s=> (s.assignedStudentId||s.studentId||s.assignedTo))
      .sort((a,b)=>(b.endedAt||0)-(a.endedAt||0))
      .slice(0,8);

    const rows = [];
    if(recent.length===0){
      rows.push(el("div",{class:"dashSub"},["No assigned sessions yet. Run a session on the Timer screen and assign it to a student."]));
    } else {
      const list = el("div",{class:"list"},[]);
      recent.forEach(s=>{
        reminderNormalizeAssignment(s);
        const when = s.endedAt ? new Date(s.endedAt).toLocaleString() : "";
        list.appendChild(el("div",{class:"listRow"},[
          el("div",{class:"listMain"},[
            el("div",{class:"listTitle"},[`${s.assignedStudentName||s.assignedTo||"Assigned"} • ${Math.round(s.ccfPct||0)}%`]),
            el("div",{class:"listSub"},[`${s.assignedClassName||""}${s.assignedClassName&&when?" • ":""}${when}`])
          ]),
          el("div",{class:"listActions"},[
            el("button",{class:"ghostBtn", type:"button", onClick:()=>openSessionModal(s.id)},["Open"])
          ])
        ]));
      });
      rows.push(list);
    }

    app.appendChild(card("Recent Assigned Sessions", rows));
  }

  function reminderNormalizeAssignment(s){
    // Ensure legacy fields are reflected for UI labels
    if(!s.assignedStudentId && s.studentId) s.assignedStudentId = s.studentId;
    if(!s.assignedStudentName && s.assignedTo) s.assignedStudentName = s.assignedTo;
    if(!s.assignedClassId && s.classId) s.assignedClassId = s.classId;
    if(!s.assignedClassName && s.className) s.assignedClassName = s.className;
  }


  function renderUnassignedAccordion(app, sessions, classes, opts){
    const unassigned = getUnassignedSessions(sessions);
    const section = el("div",{class:"accordion"},[]);
    const header = el("button",{class:"accordionHdr"},[
      el("span",{},[`Assign Unassigned Sessions (${unassigned.length})`]),
      el("span",{class:"accordionChev"},["▸"])
    ]);
    const body = el("div",{class:"accordionBody"},[]);
    let open = !!(opts && opts.defaultOpen);
    header.addEventListener("click", ()=>{
      open=!open;
      body.style.display = open ? "block" : "none";
      header.querySelector(".accordionChev").textContent = open ? "▾" : "▸";
    });

    // initial open/closed
    body.style.display = open ? "block" : "none";
    header.querySelector(".accordionChev").textContent = open ? "▾" : "▸";

    if(unassigned.length===0){
      body.appendChild(el("div",{class:"dashSub", style:"padding:10px 2px;"},["No unassigned sessions."]));
    } else {
      unassigned.forEach(s=>{
        body.appendChild(renderUnassignedRow(s, classes));
      });
    }

    section.appendChild(header);
    section.appendChild(body);
    app.appendChild(section);
  }

  function renderUnassignedRow(session, classes){
    let drawerOpen=false;
    let classId="";
    let studentId="";
    let noteOpen=false;
    let noteText="";

    const row = el("div",{class:"listRow"},[
      el("div",{class:"listMain"},[
        el("div",{class:"listTitle"},[`${fmtDateOnly(session.endedAt)} ${fmtTimeOnly(session.endedAt)} • CCF ${session.ccfPct!=null ? Math.round(session.ccfPct) : "—"}%`]),
        el("div",{class:"listSub"},[
          session.longestPauseMs ? `Longest ${session.longestPauseReason||"Unspecified"} ${fmtTimeMs(session.longestPauseMs)}` : "No pauses"
        ])
      ]),
      el("div",{class:"listActions"},[
        el("button",{class:"ghostBtn", onClick:()=>{ drawerOpen=!drawerOpen; drawer.style.display = drawerOpen ? "block" : "none"; }},["Assign"]),
        el("button",{class:"ghostBtn", onClick:()=>openSessionModal(session.id)},["Open"]),
        el("button",{class:"dangerBtn", onClick:()=>confirmDialog("Delete session?","This will remove this session from device.",()=>{ deleteSession(session.id); render(); })},["Delete"]),
      ])
    ]);

    const classSelect = el("select",{class:"input"},[
      el("option",{value:""},["Select class…"]),
      ...classes.map(c=>el("option",{value:c.id},[`${c.name||"Untitled"} • ${c.date||""}`]))
    ]);
    const studentSelect = el("select",{class:"input", disabled:true},[
      el("option",{value:""},["Select a class to choose students"])
    ]);
    const assignBtn = el("button",{class:"primaryBtn", disabled:true},["Assign"]);

    function refreshStudentOptions(){
      const st = classId ? getStudentsForClass(loadClasses(), classId) : [];
      studentSelect.innerHTML="";
      if(!classId){
        studentSelect.appendChild(el("option",{value:""},["Select a class to choose students"]));
        studentSelect.disabled=true;
        studentId="";
      } else {
        studentSelect.disabled=false;
        studentSelect.appendChild(el("option",{value:""},["Select student…"]));
        st.forEach(x=>studentSelect.appendChild(el("option",{value:x.id},[x.name])));
      }
      assignBtn.disabled = !(classId && studentId);
    }

    classSelect.addEventListener("change", ()=>{
      classId = classSelect.value || "";
      refreshStudentOptions();
    });
    studentSelect.addEventListener("change", ()=>{
      studentId = studentSelect.value || "";
      assignBtn.disabled = !(classId && studentId);
    });

    const noteWrap = el("div",{style:"margin-top:8px; display:none;"},[
      el("textarea",{class:"input", rows:"2", placeholder:"Optional instructor note…", onInput:(e)=>{ noteText = e.target.value; }})
    ]);
    const noteToggle = el("button",{class:"ghostBtn", onClick:()=>{
      noteOpen = !noteOpen;
      noteWrap.style.display = noteOpen ? "block" : "none";
    }},["Add note (optional)"]);

    assignBtn.addEventListener("click", ()=>{
      const ok = assignSession(session.id, classId, studentId, noteText);
      if(ok) render();
    });

    const drawer = el("div",{class:"assignDrawer", style:"display:none;"},[
      el("div",{class:"dashTitle"},["Assign this session"]),
      el("label",{class:"fieldLbl"},["Class (optional)"]),
      classSelect,
      el("label",{class:"fieldLbl", style:"margin-top:8px;"},["Student"]),
      studentSelect,
      el("div",{class:"btnRow", style:"margin-top:10px;"},[assignBtn]),
      noteToggle,
      noteWrap
    ]);

    return el("div",{},[row, drawer]);
  }

  function renderClassesAccordion(app, classes, opts){
    const section = el("div",{class:"accordion"},[]);
    const header = el("button",{class:"accordionHdr"},[
      el("span",{},[`Classes & Roster (${classes.length})`]),
      el("span",{class:"accordionChev"},["▸"])
    ]);
    const body = el("div",{class:"accordionBody"},[]);
    let open = !!(opts && opts.defaultOpen);
    header.addEventListener("click", ()=>{
      open=!open;
      body.style.display = open ? "block" : "none";
      header.querySelector(".accordionChev").textContent = open ? "▾" : "▸";
    });

    // initial open/closed
    body.style.display = open ? "block" : "none";
    header.querySelector(".accordionChev").textContent = open ? "▾" : "▸";

    body.appendChild(el("div",{class:"btnRow"},[
      el("button",{class:"primaryBtn", onClick:()=>openClassEditor("create", null)},["+ New Class"]),
    ]));

    if(classes.length===0){
      body.appendChild(el("div",{class:"dashSub", style:"padding:10px 2px;"},["No classes yet. Create one to assign sessions to students."]));
    } else {
      const list = el("div",{class:"list"},[]);
      classes.slice(0,10).forEach(c=>{
        list.appendChild(el("div",{class:"listRow"},[
          el("div",{class:"listMain"},[
            el("div",{class:"listTitle"},[`${c.name||"Untitled"} • ${c.date||""}`]),
            el("div",{class:"listSub"},[`${(c.students||[]).length} students`])
          ]),
          el("div",{class:"listActions"},[
            el("button",{class:"ghostBtn", onClick:()=>openClassDetail(c.id)},["Open"])
          ])
        ]));
      });
      body.appendChild(list);
    }

    section.appendChild(header);
    section.appendChild(body);
    app.appendChild(section);
  }

  function renderExportAccordion(app){
    const section = el("div",{class:"accordion"},[]);
    const header = el("button",{class:"accordionHdr"},[
      el("span",{},["Export"]),
      el("span",{class:"accordionChev"},["▸"])
    ]);
    const body = el("div",{class:"accordionBody", style:"display:none;"},[]);
    let open=false;
    header.addEventListener("click", ()=>{
      open=!open;
      body.style.display = open ? "block" : "none";
      header.querySelector(".accordionChev").textContent = open ? "▾" : "▸";
    });

    body.appendChild(el("div",{class:"btnCol"},[
      el("button",{class:"ghostBtn", onClick:()=>{
        const classes = loadClasses();
        const sessions = loadSessions();
        const rows = sessions.map(s=>sessionToRow(s, classes));
        downloadText(`ccf_sessions_all_${Date.now()}.csv`, toCsv(rows));
      }},["Export all sessions (CSV)"]),
      el("button",{class:"ghostBtn", onClick:()=>{
        const classes = loadClasses();
        const sessions = getUnassignedSessions(loadSessions());
        const rows = sessions.map(s=>sessionToRow(s, classes));
        downloadText(`ccf_sessions_unassigned_${Date.now()}.csv`, toCsv(rows));
      }},["Export unassigned sessions (CSV)"])
    ]));

    section.appendChild(header);
    section.appendChild(body);
    app.appendChild(section);
  }

  // Modals
  function renderSessionModal(){
    const sessions = loadSessions();
    const classes = loadClasses();
    const s = sessions.find(x=>x.id===ui.activeSessionId);
    if(!s) return null;

    // assign state
    let classId = "";
    let studentId = "";
    let noteOpen=false;
    let noteText="";

    const classSelect = el("select",{class:"input"},[
      el("option",{value:""},["No class"]),
      ...classes.map(c=>el("option",{value:c.id},[`${c.name||"Untitled"} • ${c.date||""}`]))
    ]);
    const studentSelect = el("select",{class:"input", disabled:true},[
      el("option",{value:""},["Select a class to assign to a student."])
    ]);
    const assignBtn = el("button",{class:"primaryBtn", disabled:true},["Assign"]);

    function refreshStudents(){
      const st = classId ? getStudentsForClass(classes, classId) : [];
      studentSelect.innerHTML="";
      if(!classId){
        studentSelect.appendChild(el("option",{value:""},["Select a class to assign to a student."]));
        studentSelect.disabled=true;
        studentId="";
      } else {
        studentSelect.disabled=false;
        studentSelect.appendChild(el("option",{value:""},["Select student…"]));
        st.forEach(x=>studentSelect.appendChild(el("option",{value:x.id},[x.name])));
      }
      assignBtn.disabled = !(classId && studentId);
    }

    classSelect.addEventListener("change", ()=>{ classId = classSelect.value || ""; refreshStudents(); });
    studentSelect.addEventListener("change", ()=>{ studentId = studentSelect.value || ""; assignBtn.disabled = !(classId && studentId); });

    const noteWrap = el("div",{style:"margin-top:8px; display:none;"},[
      el("textarea",{class:"input", rows:"2", placeholder:"Optional instructor note…", onInput:(e)=>{ noteText = e.target.value; }})
    ]);
    const noteToggle = el("button",{class:"ghostBtn", onClick:()=>{
      noteOpen=!noteOpen;
      noteWrap.style.display = noteOpen ? "block" : "none";
    }},["Add note (optional)"]);

    assignBtn.addEventListener("click", ()=>{
      const ok = assignSession(s.id, classId, studentId, noteText);
      if(ok){
        // keep open but refresh underlying lists
        render();
      }
    });

    const overlay = el("div",{class:"modalOverlay"},[
      el("div",{class:"modal"},[
        el("div",{class:"modalHeader"},[
          el("div",{class:"modalTitle"},["Session Report"]),
          el("div",{class:"modalHdrBtns"},[
            el("button",{class:"ghostBtn", onClick:closeModal},["Close"]),
            el("button",{class:"dangerBtn", onClick:()=>confirmDialog("Delete session?","This will remove this session from device.",()=>{ deleteSession(s.id); closeModal(); })},["Delete"])
          ])
        ]),
        el("div",{class:"modalBody"},[
          el("div",{class:"dashTitle"},[`Session • ${fmtDateOnly(s.endedAt)} ${fmtTimeOnly(s.endedAt)}`]),
          el("div",{class:"scoreBig"},[`CCF ${s.ccfPct!=null ? Math.round(s.ccfPct) : "—"}%`]),
          el("div",{class:"statsGrid"},[
            stat("Duration", s.totalMs!=null ? fmtTimeMs(s.totalMs) : "—"),
            stat("Hands-off", s.offMs!=null ? fmtTimeMs(s.offMs) : "—"),
            stat("Pauses", s.pauseCount!=null ? String(s.pauseCount) : "0"),
            stat("Longest", (s.longestPauseMs ? `${s.longestPauseReason||"Unspecified"} • ${fmtTimeMs(s.longestPauseMs)}` : "—"))
          ]),
          renderPauseBreakdownBlock(s),
          renderPauseDetailsBlock(s),
          el("div",{class:"dashTitle", style:"margin-top:12px;"},["Assign to"]),
          el("label",{class:"fieldLbl"},["Class (optional)"]),
          classSelect,
          el("label",{class:"fieldLbl", style:"margin-top:8px;"},["Student"]),
          studentSelect,
          el("div",{class:"btnRow", style:"margin-top:10px;"},[assignBtn]),
          noteToggle,
          noteWrap
        ])
      ])
    ]);

    refreshStudents();
    return overlay;
  }

  function renderPauseBreakdownBlock(session){
    const rows = session.pauseBreakdown || [];
    if(!rows.length){
      return el("div",{class:"dashSub", style:"margin-top:10px; opacity:.85;"},["No pauses recorded."]);
    }
    const totalMs = rows.reduce((a,r)=>a+r.ms,0);
    const wrap = el("div",{class:"breakdownBox"},[
      el("div",{class:"dashTitle"},["Pause time breakdown"]),
      el("div",{class:"dashSub", style:"opacity:.85; margin-bottom:8px;"},[`Total paused time: ${fmtTimeMs(totalMs)}`])
    ]);
    rows.forEach(r=>{
      const pct = totalMs>0 ? Math.round((r.ms/totalMs)*100) : 0;
      wrap.appendChild(el("div",{class:"breakdownRow"},[
        el("div",{class:"breakdownReason"},[r.reason]),
        el("div",{class:"breakdownVal"},[`${fmtTimeMs(r.ms)} (${pct}%)`])
      ]));
    });
    return wrap;
  }

  function renderPauseDetailsBlock(session){
    const pauses = session.pauses || [];
    const wrap = el("div",{style:"margin-top:12px;"},[
      el("div",{class:"dashTitle"},["Pause details"])
    ]);
    if(!pauses.length){
      wrap.appendChild(el("div",{class:"dashSub", style:"opacity:.85; margin-top:6px;"},["No pauses recorded."]));
      return wrap;
    }
    const list = el("div",{class:"pauseList"},[]);
    pauses.forEach(p=>{
      const dur = num(p.ms ?? p.durMs ?? p.durationMs) ?? 0;
      const reason = (Array.isArray(p.reasons) && p.reasons.length) ? p.reasons.join(", ") : (p.reason || "Unspecified");
      // display start time relative if startMs exists
      const at = (p.startMs!=null) ? fmtTimeMs(p.startMs) : "—";
      list.appendChild(el("div",{class:"pauseRow"},[
        el("div",{class:"pauseAt"},[at]),
        el("div",{class:"pauseReason"},[reason]),
        el("div",{class:"pauseDur"},[fmtTimeMs(dur)])
      ]));
    });
    wrap.appendChild(list);
    return wrap;
  }
  function renderClassEditorModal(){
    const classes = loadClasses();
    const editingSrc = (ui.classEditorMode==="edit" && ui.classEditorId)
      ? getClassById(classes, ui.classEditorId)
      : null;
    const editing = !!editingSrc;

    // Initialize / refresh draft
    if(!ui.classEditorDraft){
      ui.classEditorDraft = editingSrc ? JSON.parse(JSON.stringify(editingSrc)) : blankClass();
    }
    if(editingSrc && ui.classEditorDraft && ui.classEditorDraft.id !== editingSrc.id){
      ui.classEditorDraft = JSON.parse(JSON.stringify(editingSrc));
    }
    const cls = ui.classEditorDraft;

    function renderStudentEditorRow(cls, idx){
      const st = cls.students[idx];
      return el("div",{class:"studentRow"},[
        el("input",{class:"input", value:st.name||"", placeholder:"Student name",
          onInput:(e)=>{ st.name=e.target.value; }}),
        el("input",{class:"input", value:st.email||"", placeholder:"Email (optional)",
          onInput:(e)=>{ st.email=e.target.value; }}),
        el("button",{class:"dangerBtn", type:"button", onClick:(e)=>{ 
          if(e){e.preventDefault(); e.stopPropagation();}
          cls.students.splice(idx,1); 
          render(); 
        }},["Remove"])
      ]);
    }

    const overlay = el("div",{class:"modalOverlay"},[
      el("div",{class:"modal"},[
        el("div",{class:"modalHeader"},[
          el("div",{class:"modalTitle"},[editing ? "Edit Class" : "New Class"]),
          el("div",{class:"modalHdrBtns"},[
            el("button",{class:"ghostBtn", type:"button", onClick:(e)=>{ if(e){e.preventDefault();} closeModal(); }},["Cancel"]),
            el("button",{class:"primaryBtn", type:"button", onClick:(e)=>{
              if(e){e.preventDefault(); e.stopPropagation();}
              const id = upsertClass(cls);
              ui.activeModal=null;
              ui.classEditorDraft=null;
              ui.postModalScroll=null;
              ui.activeClassId=id;
              toast("Saved");
              render();
            }},["Save"])
          ])
        ]),
        el("div",{class:"modalBody"},[
          field("Class name", inputText(cls.name,(v)=>cls.name=v,"Class name")),
          field("Date", inputDate(cls.date,(v)=>cls.date=v)),
          field("Location (opt)", inputText(cls.location,(v)=>cls.location=v,"Location")),
          field("Instructor (opt)", inputText(cls.instructor,(v)=>cls.instructor=v,"Instructor")),
          field("Email (opt)", inputText(cls.instructorEmail,(v)=>cls.instructorEmail=v,"Email")),
          field("Target CCF (opt)", inputNumber(cls.targetCCF,(v)=>cls.targetCCF=v,"80")),
          el("div",{class:"dashTitle", style:"margin-top:14px;"},["Students"]),
          el("button",{class:"primaryBtn", type:"button", onClick:(e)=>{ 
            if(e){e.preventDefault(); e.stopPropagation();}
            if(!Array.isArray(cls.students)) cls.students=[];
            cls.students.push({id:uid("stu"), name:"", email:""}); 
            ui.postModalScroll="studentsBottom"; 
            render(); 
          }},["+ Add student"]),
          el("div",{style:"margin-top:10px;"},[
            ...(Array.isArray(cls.students)?cls.students:[]).map((st, idx)=>renderStudentEditorRow(cls, idx))
          ])
        ])
      ])
    ]);

    // Keep the editor from jumping to the top after Add Student
    setTimeout(()=>{
      try{
        if(ui.postModalScroll==="studentsBottom"){
          const body = document.querySelector(".modalOverlay .modalBody");
          if(body) body.scrollTop = body.scrollHeight;
          const rows = document.querySelectorAll(".modalOverlay .studentRow");
          const last = rows && rows.length ? rows[rows.length-1] : null;
          const inp = last ? last.querySelector("input") : null;
          inp && inp.focus && inp.focus();
          ui.postModalScroll=null;
        }
      }catch(e){}
    },0);

    return overlay;
  }

  function field(