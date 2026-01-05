/* ===========================
   CCF CPR TIMER – reports.js
   - Free: simple CCF + basic pause summary (with ads)
   - Pro: class roster + student assignment + downloadable report cards (no ads)
   =========================== */

const SESSIONS_KEY = "ccf_sessions_v1";
const CLASS_KEY = "ccf.classSetup";
const PRO_KEY = "ccf.proUnlocked";
const CLASS_UI_KEY = "ccf.classSetupOpen";

function isPro() {
  return localStorage.getItem(PRO_KEY) === "1";
}

// Debug helper: allow ?pro=1 or the Debug button to toggle Pro locally
function applyDebugPro() {
  const url = new URL(window.location.href);
  if (url.searchParams.get("pro") === "1") {
    localStorage.setItem(PRO_KEY, "1");
  }
}

function fmt(ms) {
  ms = Math.max(0, ms | 0);
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function safeParseJSON(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

function loadSessions() {
  const raw = localStorage.getItem(SESSIONS_KEY);
  if (!raw) return [];
  const arr = safeParseJSON(raw, []);
  return Array.isArray(arr) ? arr : [];
}

function saveSessions(arr) {
  try { localStorage.setItem(SESSIONS_KEY, JSON.stringify(arr)); } catch {}
}

function loadClassSetup() {
  const raw = safeParseJSON(localStorage.getItem(CLASS_KEY) || "", null);
  if (!raw || typeof raw !== "object") return null;
  return normalizeClassSetup(raw);
}

function normalizeClassSetup(cls) {
  // Backwards compat: older builds stored students as an array of strings.
  // New format: students: [{name, email, contact, score}]
  const out = { ...cls };
  const st = out.students;

  if (Array.isArray(st)) {
    if (st.length && typeof st[0] === "string") {
      out.students = st
        .map(s => String(s || "").trim())
        .filter(Boolean)
        .map(name => ({ name, email: "", contact: "", score: "" }));
    } else {
      out.students = st
        .filter(Boolean)
        .map(x => ({
          name: String(x.name || "").trim(),
          email: String(x.email || "").trim(),
          contact: String(x.contact || "").trim(),
          score: (x.score === 0 || x.score) ? String(x.score) : "",
        }))
        .filter(x => x.name);
    }
  } else {
    out.students = [];
  }
  out.instructorEmail = String(out.instructorEmail || "").trim();


  // Defaults
  if (!Number.isFinite(parseInt(out.targetCcf, 10))) out.targetCcf = 80;
  if (!Number.isFinite(parseInt(out.sessionLengthSec, 10))) out.sessionLengthSec = 120;
  return out;
}

function saveClassSetup(payload) {
  try {
    localStorage.setItem(CLASS_KEY, JSON.stringify({ ...payload, updatedAt: Date.now() }));
  } catch {}
}

function clearClassSetup() {
  try { localStorage.removeItem(CLASS_KEY); } catch {}
}

function toLocal(ts) {
  try {
    const d = new Date(ts);
    return d.toLocaleString();
  } catch {
    return String(ts || "");
  }
}

function badgeForCCF(ccf) {
  if (ccf >= 90) return { text: "Excellent", cls: "good" };
  if (ccf >= 80) return { text: "Meets Goal", cls: "good" };
  if (ccf >= 70) return { text: "Needs Work", cls: "bad" };
  return { text: "Low", cls: "bad" };
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function downloadCSV(filename, rows) {
  const csv = rows.map(r => r.map(cell => {
    const s = String(cell ?? "");
    // Basic CSV escaping
    if (s.includes(",") || s.includes("\n") || s.includes("\"") ) {
      return `"${s.replaceAll("\"", '""')}"`;
    }
    return s;
  }).join(",")).join("\n");
  downloadText(filename, csv);
}

function summarizeReasons(pauses = []) {
  // returns array of {reason, ms, count}
  const map = new Map();
  pauses.forEach(p => {
    const reasons = (p.reasons && p.reasons.length)
      ? p.reasons
      : (p.reason ? [p.reason] : ["Unspecified"]);
    const dur = p.ms ?? p.durMs ?? 0;
    // If multiple reasons selected, we count each (useful for training feedback)
    reasons.forEach(r => {
      const key = String(r || "Unspecified");
      const cur = map.get(key) || { reason: key, ms: 0, count: 0 };
      cur.ms += dur;
      cur.count += 1;
      map.set(key, cur);
    });
  });
  return [...map.values()].sort((a, b) => b.ms - a.ms);
}

function sessionDisplayName(session) {
  const s = session?.assignedTo?.student || session?.assignedTo || "";
  return (typeof s === "string" && s.trim()) ? s.trim() : "Unassigned";
}

function makeReportText(session) {
  const ccf = session.finalCCF ?? 0;
  const totalMs = session.totalMs ?? ((session.compMs || 0) + (session.offMs || 0));
  const pauses = session.pauses || [];
  const reasons = summarizeReasons(pauses);

  const lines = [];
  lines.push("CCF CPR TIMER – REPORT CARD");
  lines.push("--------------------------------");
  lines.push(`Date/time: ${toLocal(session.endedAt)}`);
  lines.push(`Student: ${sessionDisplayName(session)}`);

  if (session.classContext?.name) lines.push(`Class: ${session.classContext.name}`);
  if (session.classContext?.instructor) lines.push(`Instructor: ${session.classContext.instructor}`);
  if (session.classContext?.location) lines.push(`Location/Notes: ${session.classContext.location}`);

  lines.push("");
  lines.push(`Final CCF: ${ccf}% (${badgeForCCF(ccf).text})`);
  lines.push(`Total time: ${fmt(totalMs)}`);
  lines.push(`CPR on: ${fmt(session.compMs || 0)}`);
  lines.push(`Hands-off: ${fmt(session.offMs || 0)}`);
  lines.push(`Pauses: ${session.pauseCount ?? pauses.length}`);
  lines.push(`Longest pause: ${fmt(session.longestPauseMs || 0)}`);

  lines.push("");
  lines.push("Pause reasons (by total time):");
  if (!reasons.length) {
    lines.push("- None recorded");
  } else {
    reasons.slice(0, 10).forEach(r => {
      lines.push(`- ${r.reason}: ${fmt(r.ms)} (${r.count}x)`);
    });
  }

  lines.push("");
  lines.push("Pause log (most recent first):");
  if (!pauses.length) {
    lines.push("- No pauses recorded");
  } else {
    pauses.slice().reverse().slice(0, 25).forEach(p => {
      const label = (p.reasons && p.reasons.length) ? p.reasons.join(", ") : (p.reason || "Unspecified");
      lines.push(`- ${label} • ${fmt(p.ms ?? p.durMs ?? 0)}`);
    });
  }

  return lines.join("\n");
}

function renderLatestFree(session) {
  const el = document.getElementById("latestCard");
  if (!session) {
    el.innerHTML = `
      <div class="emptyCard">
        <div class="emptyTitle">No sessions yet</div>
        <div class="emptySub">Go back to the timer and run a scenario.</div>
        <a class="newBtn" href="./index.html" style="text-decoration:none; display:block; text-align:center;">Start Timer</a>
      </div>
    `;
    return;
  }

  const b = badgeForCCF(session.finalCCF || 0);
  const pauses = session.pauses || [];
  const reasonSummary = summarizeReasons(pauses).slice(0, 4);

  el.innerHTML = `
    <div class="scoreTop">
      <div>
        <div class="scoreTitle">Most Recent</div>
        <div class="scoreSub">${toLocal(session.endedAt)}</div>
      </div>
      <div class="scoreBadge ${b.cls}">${b.text}</div>
    </div>

    <div class="scoreBigRow" style="margin-top:12px;">
      <div class="scoreBig">
        <div class="scoreLabel">Final CCF</div>
        <div class="scoreValue">${session.finalCCF ?? 0}%</div>
      </div>
      <div style="text-align:right;">
        <div class="scoreLabel">Total</div>
        <div style="font-weight:1000; font-size:18px; margin-top:6px;">${fmt(session.totalMs ?? 0)}</div>
      </div>
    </div>

    <div class="scoreGrid">
      <div class="miniCard">
        <div class="miniLabel">Hands-Off</div>
        <div class="miniValue">${fmt(session.offMs ?? 0)}</div>
      </div>
      <div class="miniCard">
        <div class="miniLabel">Longest Pause</div>
        <div class="miniValue">${fmt(session.longestPauseMs ?? 0)}</div>
      </div>
      <div class="miniCard">
        <div class="miniLabel">Pauses</div>
        <div class="miniValue">${session.pauseCount ?? pauses.length}</div>
      </div>
      <div class="miniCard">
        <div class="miniLabel">CPR On</div>
        <div class="miniValue">${fmt(session.compMs ?? 0)}</div>
      </div>
    </div>

    <div class="breakdownBlock">
      <div class="breakTitle">Pause reasons (top)</div>
      <div class="breakList">
        ${reasonSummary.length
          ? reasonSummary.map(r => `
              <div class="breakItem">
                <div>
                  <div class="strong">${r.reason}</div>
                  <div class="muted">${r.count}x</div>
                </div>
                <div class="strong">${fmt(r.ms)}</div>
              </div>
            `).join("")
          : `<div class="breakItem"><div class="strong">No pause reasons recorded</div><div class="muted">(Pause prompt may be OFF)</div></div>`
        }
      </div>
    </div>
  `;
}

function renderLatestPro(session) {
  // Pro uses the same card, but adds student name at the top and a download button in the Pro tools row.
  renderLatestFree(session);
  const el = document.getElementById("latestCard");
  if (!session) return;

  const student = sessionDisplayName(session);
  el.querySelector(".scoreTitle")?.insertAdjacentHTML(
    "afterend",
    `<div class="scoreSub" style="margin-top:4px;">Student: <strong>${student}</strong></div>`
  );
}


/* ===========================
   Premium: Class Dashboard
   - Computes per-student averages and a class score
   =========================== */

function getClassSetup() {
  // Use the normalized loader (handles backwards compatibility)
  return loadClassSetup();
}

function computeStudentStats(sessions, rosterStudents) {
  const map = new Map();
  const names = (Array.isArray(rosterStudents) ? rosterStudents : [])
    .map(s => String(s?.name || "").trim())
    .filter(Boolean);
  names.forEach(n => map.set(n, { name: n, attempts: 0, avg: 0, best: 0, worst: 0 }));
  let classSum = 0;
  let classN = 0;

  sessions.forEach(s => {
    const who = (s?.assignedTo?.student || s?.assignedTo || "").trim();
    if (!who || !map.has(who)) return;
    const ccf = Number(s.finalCCF ?? s.ccfPct ?? 0);
    if (!Number.isFinite(ccf)) return;

    const st = map.get(who);
    st.attempts += 1;
    st.best = st.attempts === 1 ? ccf : Math.max(st.best, ccf);
    st.worst = st.attempts === 1 ? ccf : Math.min(st.worst, ccf);
    // incremental average
    st.avg = st.avg + (ccf - st.avg) / st.attempts;

    classSum += ccf;
    classN += 1;
  });

  const rows = Array.from(map.values()).map(r => ({
    name: r.name,
    attempts: r.attempts,
    avg: Math.round(r.avg * 10) / 10,
    best: r.attempts ? Math.round(r.best) : 0,
    worst: r.attempts ? Math.round(r.worst) : 0,
  }));

  return {
    rows,
    classAvg: classN ? Math.round((classSum / classN) * 10) / 10 : 0,
    classN,
  };
}

function statusFor(avg, attempts, target) {
  if (!attempts) return { text: "No data", cls: "muted" };
  if (avg >= target) return { text: "Meets goal", cls: "good" };
  if (avg >= target - 5) return { text: "Close", cls: "warn" };
  return { text: "Below", cls: "bad" };
}

function renderClassDashboard(sessions, proEnabled) {
  const scoreEl = document.getElementById("classScoreCard");
  const chartEl = document.getElementById("classChart");
  const tableEl = document.getElementById("studentTable");
  const hintEl = document.getElementById("classDashHint");
  if (!proEnabled) return;

  const cls = getClassSetup();
  const roster = Array.isArray(cls?.students) ? cls.students : [];
  const rosterByName = new Map(roster.map(s => [String(s?.name || "").trim(), s]));
  const target = cls?.targetCcf ?? 80;

  if (!cls || !roster.length) {
    if (hintEl) {
      hintEl.style.display = "block";
      hintEl.innerHTML = `To set up a class: open <strong>Class Setup</strong>, add students to your roster (email/contact optional), then assign sessions to students below.`;
    }
    if (scoreEl) scoreEl.innerHTML = `
      <div class="dashTitle">Class Score</div>
      <div class="dashBig">—</div>
      <div class="dashSub">No class roster yet</div>
      <div class="dashKpiRow">
        <div class="dashKpi"><div class="kLabel">Target</div><div class="kValue">${target}%</div></div>
        <div class="dashKpi"><div class="kLabel">Passing</div><div class="kValue">0/0</div></div>
        <div class="dashKpi"><div class="kLabel">Avg hands-off</div><div class="kValue">—</div></div>
      </div>
    `;
    if (chartEl) chartEl.innerHTML = `<div class="emptyNote">Add students in Class Setup to see class performance.</div>`;
    if (tableEl) tableEl.innerHTML = `<div class="emptyNote">No students yet.</div>`;
    return;
  } else {
    if (hintEl) hintEl.style.display = "none";
  }

  const stats = computeStudentStats(sessions, roster);
  const rows = stats.rows;

  // class avg hands-off
  const avgHandsOffSec = sessions.length
    ? Math.round((sessions.reduce((a, s) => a + ((s.offMs || 0) / 1000), 0) / sessions.length) * 10) / 10
    : 0;

  const passingCount = rows.filter(r => r.attempts && r.avg >= target).length;

  if (scoreEl) {
    scoreEl.innerHTML = `
      <div class="dashTitle">Class Score</div>
      <div class="dashBig">${stats.classN ? `${stats.classAvg}%` : "—"}</div>
      <div class="dashSub">${stats.classN ? `Across ${stats.classN} assigned attempts` : "No assigned attempts yet"}</div>
      <div class="dashKpiRow">
        <div class="dashKpi"><div class="kLabel">Target</div><div class="kValue">${target}%</div></div>
        <div class="dashKpi"><div class="kLabel">Passing</div><div class="kValue">${passingCount}/${rows.length}</div></div>
        <div class="dashKpi"><div class="kLabel">Avg hands-off</div><div class="kValue">${avgHandsOffSec}s</div></div>
      </div>
    `;
  }

  // Chart (simple bars)
  if (chartEl) {
    const max = 100;
    chartEl.innerHTML = rows.map(r => {
      const pct = r.attempts ? r.avg : 0;
      const st = statusFor(pct, r.attempts, target);
      return `
        <div class="barRow">
          <div class="barLabel">${initials(r.name)}</div>
          <div class="barTrackSmall" aria-hidden="true">
            <div class="barFillSmall" style="width:${Math.max(0, Math.min(100, (pct / max) * 100))}%"></div>
          </div>
          <div class="barValue ${st.cls}">${r.attempts ? `${Math.round(pct)}%` : "—"}</div>
        </div>
      `;
    }).join("");
    chartEl.insertAdjacentHTML("afterbegin", `<div class="targetLine">Target ${target}%</div>`);
  }

  // Table
  if (tableEl) {
    tableEl.innerHTML = `
      <div class="tHead">
        <div>Student</div><div>Avg</div><div>Attempts</div><div>Score</div><div>Status</div>
      </div>
      ${rows.map(r => {
        const st = statusFor(r.avg, r.attempts, target);
        const scoreVal = rosterByName.get(r.name)?.score ?? "";
        return `
          <div class="tRow">
            <div class="tName">
              <button class="tNameBtn" type="button" data-student-name="${escapeHtml(r.name)}">${escapeHtml(r.name)}</button>
            </div>
            <div class="tNum">${r.attempts ? `${Math.round(r.avg)}%` : "—"}</div>
            <div class="tNum">${r.attempts}</div>
            <div class="tNum">
              <input class="scoreInput" type="number" inputmode="numeric" min="0" max="100" placeholder="—" value="${escapeHtml(scoreVal)}" data-score-name="${escapeHtml(r.name)}" />
            </div>
            <div class="tStatus"><span class="pill ${st.cls}">${st.text}</span></div>
          </div>
        `;
      }).join("")}
    `;

    // wire: click name to open student modal
    tableEl.querySelectorAll(".tNameBtn").forEach(btn => {
      btn.addEventListener("click", () => {
        const nm = btn.getAttribute("data-student-name") || "";
        openStudentModal(nm, sessions);
      });
    });

    // wire: manual score edits
    tableEl.querySelectorAll(".scoreInput").forEach(inp => {
      inp.addEventListener("change", () => {
        const nm = inp.getAttribute("data-score-name") || "";
        const cls2 = loadClassSetup() || {};
        cls2.students = Array.isArray(cls2.students) ? cls2.students : [];
        cls2.students = cls2.students.map(s => {
          if (String(s?.name||"").trim() === nm) {
            return { ...s, score: String(inp.value || "").trim() };
          }
          return s;
        });
        saveClassSetup(cls2);
      });
    });

  }
}

function initials(name) {
  const parts = String(name).trim().split(/\s+/);
  if (!parts.length) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderHistory(list, proEnabled) {
  const el = document.getElementById("historyList");
  const historyBlock = document.querySelector(".historyBlock");
  const exportBtn = document.getElementById("btnExport");

  if (!proEnabled) {
    // Free: hide history + export (keeps page simple)
    if (historyBlock) historyBlock.style.display = "none";
    if (exportBtn) exportBtn.style.display = "none";
    return;
  }

  if (historyBlock) historyBlock.style.display = "block";
  if (exportBtn) exportBtn.style.display = "inline-flex";

  if (!list.length) {
    el.innerHTML = `<div class="historyEmpty">No saved sessions.</div>`;
    return;
  }

  el.innerHTML = list.map((s, idx) => {
    const b = badgeForCCF(s.finalCCF || 0);
    const student = sessionDisplayName(s);
    return `
      <div class="histRow">
        <div>
          <div class="histTopLine">
            <div class="histCCF">${s.finalCCF ?? 0}%</div>
            <div class="histBadge ${b.cls}">${b.text}</div>
          </div>
          <div class="histMeta">${student} • ${toLocal(s.endedAt)} • Total ${fmt(s.totalMs ?? 0)} • Hands-Off ${fmt(s.offMs ?? 0)}</div>
          <div class="histActions">
            <button class="pillBtn" data-act="assign" data-idx="${idx}">Assign</button>
            <button class="pillBtn" data-act="download" data-idx="${idx}">Download</button>
          </div>
        </div>
        <button class="histBtn" data-act="delete" data-idx="${idx}" aria-label="Delete">🗑</button>
      </div>
    `;
  }).join("");

  el.querySelectorAll("button[data-act]").forEach(btn => {
    btn.addEventListener("click", () => {
      const act = btn.dataset.act;
      const idx = Number(btn.dataset.idx);
      if (!Number.isFinite(idx)) return;
      if (act === "delete") {
        const arr = loadSessions();
        arr.splice(idx, 1);
        saveSessions(arr);
        boot();
        return;
      }
      if (act === "download") {
        const s = loadSessions()[idx];
        if (!s) return;
        const student = sessionDisplayName(s).replaceAll(/[^a-z0-9 _-]/gi, "").trim() || "report";
        const stamp = new Date(s.endedAt || Date.now()).toISOString().slice(0, 10);
        downloadText(`ccf_report_${student}_${stamp}.txt`, makeReportText(s));
        return;
      }
      if (act === "assign") {
        const arr = loadSessions();
        const s = arr[idx];
        if (!s) return;
        const cls = loadClassSetup();
        const roster = Array.isArray(cls?.students) ? cls.students : [];
        const rosterNames = roster.map(x => x.name).filter(Boolean);
        const msg = rosterNames.length
          ? `Assign to which student?\n\nRoster:\n${rosterNames.slice(0, 25).join("\n")}`
          : "Enter student name:";
        const name = prompt(msg, (s.assignedTo?.student || ""));
        if (!name) return;
        s.assignedTo = { student: name.trim(), assignedAt: Date.now() };
        arr[idx] = s;
        saveSessions(arr);
        boot();
      }
    });
  });
}

function exportCSV() {
  const arr = loadSessions();
  if (!arr.length) {
    alert("No sessions to export.");
    return;
  }

  const cls = getClassSetup();
  const roster = Array.isArray(cls?.students) ? cls.students : [];
  const target = cls?.targetCcf ?? 80;

  const rows = [
    ["endedAt","student","finalCCF","totalMs","compMs","offMs","pauseCount","longestPauseMs","patientType","rescuerCount","breathTimer","pulseCue","className","instructor","targetCcf"],
    ...arr.map(s => [
      s.endedAt,
      sessionDisplayName(s),
      s.finalCCF ?? 0,
      s.totalMs ?? 0,
      s.compMs ?? 0,
      s.offMs ?? 0,
      s.pauseCount ?? 0,
      s.longestPauseMs ?? 0,
      s.cprProfile?.patientType || "",
      s.cprProfile?.rescuerCount ?? "",
      (s.cprProfile?.breathTimerEnabled === false) ? "0" : "1",
      (s.cprProfile?.pulseCueEnabled === false) ? "0" : "1",
      s.classContext?.name || cls?.name || "",
      s.classContext?.instructor || cls?.instructor || "",
      target,
    ])
  ];

  // Append class + student summary (premium)
  if (cls && roster.length) {
    const stats = computeStudentStats(arr, roster);
    const passingCount = stats.rows.filter(r => r.attempts && r.avg >= target).length;

    rows.push([]);
    rows.push(["CLASS_SUMMARY"]);
    rows.push(["className", cls.name || ""]);
    rows.push(["instructor", cls.instructor || ""]);
    rows.push(["targetCcf", target]);
    rows.push(["classAvgCcf", stats.classN ? stats.classAvg : ""]);
    rows.push(["assignedAttempts", stats.classN]);
    rows.push(["studentsPassing", `${passingCount}/${stats.rows.length}`]);

    rows.push([]);
    rows.push(["STUDENT_AVERAGES"]);
    rows.push(["student","avgCcf","attempts","best","worst","status"]);
    stats.rows.forEach(r => {
      const st = statusFor(r.avg, r.attempts, target);
      rows.push([r.name, r.attempts ? r.avg : "", r.attempts, r.best, r.worst, st.text]);
    });
  }

  downloadCSV("ccf_reports_premium.csv", rows);
}

function buildClassSummary(cls, sessions) {
  const name = cls?.name || "Class";
  const target = cls?.targetCcf ?? 80;
  const roster = Array.isArray(cls?.students) ? cls.students : [];
  const rosterNames = roster.map(s => String(s?.name||"").trim()).filter(Boolean);

  // per-student averages from assigned sessions
  const byStudent = new Map();
  rosterNames.forEach(n => byStudent.set(n, { name: n, attempts: 0, sum: 0 }));

  sessions.forEach(s => {
    const n = s?.assignedTo?.student;
    if (!n || !byStudent.has(n)) return;
    const rec = byStudent.get(n);
    rec.attempts += 1;
    rec.sum += (s.ccfPct || 0);
  });

  const rows = [...byStudent.values()].map(r => ({
    name: r.name,
    attempts: r.attempts,
    avg: r.attempts ? (r.sum / r.attempts) : 0,
    manual: String(roster.find(x => String(x?.name||"").trim()===r.name)?.score || "").trim()
  })).sort((a,b)=>a.name.localeCompare(b.name));

  const classAttempts = rows.reduce((a,r)=>a+r.attempts,0);
  const classAvg = classAttempts ? (rows.reduce((a,r)=>a+(r.avg*r.attempts),0)/classAttempts) : 0;
  const passing = rows.filter(r => r.attempts && r.avg >= target).length;

  return { name, target, rows, classAvg, passing, total: rows.length };
}

function mailtoDraft(to, subject, body, bcc="") {
  const params = [];
  if (subject) params.push(`subject=${encodeURIComponent(subject)}`);
  if (body) params.push(`body=${encodeURIComponent(body)}`);
  if (bcc) params.push(`bcc=${encodeURIComponent(bcc)}`);
  const url = `mailto:${encodeURIComponent(to || "")}?${params.join("&")}`;
  window.location.href = url;
}

function wireExportActions(proEnabled, sessions) {
  const btnCsv = document.getElementById("btnExportCsv");
  const btnEmailInstr = document.getElementById("btnEmailInstructor");
  const btnEmailStudents = document.getElementById("btnEmailStudents");
  if (!proEnabled) return;

  if (btnCsv && btnCsv.dataset.bound !== "1") {
    btnCsv.dataset.bound = "1";
    btnCsv.addEventListener("click", () => exportCSV());
  }

  if (btnEmailInstr && btnEmailInstr.dataset.bound !== "1") {
    btnEmailInstr.dataset.bound = "1";
    btnEmailInstr.addEventListener("click", () => {
      const cls = loadClassSetup() || {};
      const summary = buildClassSummary(cls, sessions);

      let to = String(cls?.instructorEmail || "").trim();
      if (!to) to = prompt("Instructor email (optional). Leave blank to open a draft without a recipient:", "") || "";

      const subject = `CCF Class Summary - ${summary.name}`;
      const lines = [
        `Class: ${summary.name}`,
        `Target: ${summary.target}%`,
        `Class avg (assigned sessions): ${Math.round(summary.classAvg)}%`,
        `Passing: ${summary.passing}/${summary.total}`,
        ``,
        `Student averages (assigned sessions):`,
        ...summary.rows.map(r => `- ${r.name}: ${r.attempts ? Math.round(r.avg) + "%" : "—"} (${r.attempts} attempt${r.attempts===1?"":"s"})${r.manual ? ` • Manual score: ${r.manual}%` : ""}`)
      ];

      mailtoDraft(to, subject, lines.join("\n"));
    });
  }

  if (btnEmailStudents && btnEmailStudents.dataset.bound !== "1") {
    btnEmailStudents.dataset.bound = "1";
    btnEmailStudents.addEventListener("click", () => {
      const cls = loadClassSetup() || {};
      const roster = Array.isArray(cls?.students) ? cls.students : [];
      const emails = roster.map(s => String(s?.email||"").trim()).filter(Boolean);
      if (!emails.length) return alert("No student emails in roster yet. Add emails in Class Setup (optional).");

      const summary = buildClassSummary(cls, sessions);
      const subject = `CCF Results - ${summary.name}`;
      const body = [
        `CCF results for: ${summary.name}`,
        ``,
        `If you have multiple attempts assigned, your average is shown.`,
        ``,
        `Reply to this email if you have questions.`,
      ].join("\n");

      // Use BCC so you can message everyone at once
      const to = String(cls?.instructorEmail || "").trim();
      mailtoDraft(to, subject, body, emails.join(","));
    });
  }
}


function syncProUI(proEnabled) {
  const upgrade = document.getElementById("upgradeCard");
  const proBlock = document.getElementById("proBlock");
  const debugBtn = document.getElementById("btnDebugPro");

  if (upgrade) upgrade.style.display = proEnabled ? "none" : "block";
  if (proBlock) proBlock.style.display = proEnabled ? "block" : "none";

  if (debugBtn) {
    debugBtn.style.display = "inline-flex";
    debugBtn.addEventListener("click", () => {
      const next = !isPro();
      localStorage.setItem(PRO_KEY, next ? "1" : "0");
      boot();
    });
  }

  const upgradeLink = document.getElementById("btnUpgrade");
  if (upgradeLink) {
    upgradeLink.addEventListener("click", (e) => {
      e.preventDefault();
      alert("Unlock Pro in the Android/iOS app using the one-time in-app purchase. (Web version stays free.)");
    });
  }
}

function syncClassUI(proEnabled) {
  if (!proEnabled) return;
  const sel = document.getElementById("studentSelect");
  const meta = document.getElementById("classMeta");
  if (!sel || !meta) return;

  const cls = loadClassSetup();
  const name = cls?.name || "";
  const instructor = cls?.instructor || "";
  const instructorEmail = cls?.instructorEmail || "";
  const count = (cls?.students || []).filter(s => s && String(s.name || "").trim()).length;
  meta.textContent = name
    ? `${name}${instructor ? ` • ${instructor}` : ""} • ${count} students`
    : "No class loaded (use Class Setup above)";

  const roster = (cls?.students || []).map(s => String(s?.name || "").trim()).filter(Boolean);
  sel.innerHTML = ["Unassigned", ...roster].map(s => `<option value="${s}">${s}</option>`).join("");

  // Populate the Class Setup form (collapsible panel)
  const elName = document.getElementById("className");
  const elInstr = document.getElementById("instructorName");
  const elEmail = document.getElementById("instructorEmail");
  const elEmail = document.getElementById("instructorEmail");
  const elLoc = document.getElementById("classLocation");
  const elTarget = document.getElementById("targetCcf");
  const elLen = document.getElementById("sessionLengthSec");

  if (elName) elName.value = name;
  if (elInstr) elInstr.value = instructor;
  if (elEmail) elEmail.value = instructorEmail;
  if (elLoc) elLoc.value = cls?.location || "";
  if (elTarget) elTarget.value = String(cls?.targetCcf ?? "");
  if (elLen) elLen.value = String(cls?.sessionLengthSec ?? 120);

  renderRosterEditor(cls?.students || []);

  // If no class exists, auto-open Class Setup to guide first-time instructors (once)
  const shouldOpen = !name && !getClassSetupOpen();
  if (shouldOpen) setClassSetupOpen(true);
}


const ACC_KEY = "ccf.reportsAccordion.v1";

function loadAccState() {
  const raw = safeParseJSON(localStorage.getItem(ACC_KEY) || "", null);
  if (raw && typeof raw === "object") return raw;
  return { classSetup: false, latest: true, classReport: false, export: false };
}
function saveAccState(state) {
  try { localStorage.setItem(ACC_KEY, JSON.stringify(state)); } catch {}
}

function setAccOpen(accId, open) {
  const sec = document.querySelector(`.accHead[data-acc="${accId}"]`)?.closest(".acc");
  const body = document.getElementById(
    accId === "classSetup" ? "accBodyClassSetup" :
    accId === "latest" ? "accBodyLatest" :
    accId === "classReport" ? "accBodyClassReport" :
    "accBodyExport"
  );
  if (sec) sec.classList.toggle("open", open);
  if (body) body.style.display = open ? "block" : "none";
}

function wireAccordions(proEnabled) {
  // Hide premium-only accordions if not Pro
  const accClassSetup = document.getElementById("accClassSetup");
  const accClassReport = document.getElementById("accClassReport");
  const accExport = document.getElementById("accExport");
  if (!proEnabled) {
    if (accClassSetup) accClassSetup.style.display = "none";
    if (accClassReport) accClassReport.style.display = "none";
    if (accExport) accExport.style.display = "none";
  } else {
    if (accClassSetup) accClassSetup.style.display = "block";
    if (accClassReport) accClassReport.style.display = "block";
    if (accExport) accExport.style.display = "block";
  }

  const state = loadAccState();
  // Always show latest accordion (free + pro)
  setAccOpen("classSetup", !!state.classSetup && proEnabled);
  setAccOpen("latest", state.latest !== false);
  setAccOpen("classReport", !!state.classReport && proEnabled);
  setAccOpen("export", !!state.export && proEnabled);

  document.querySelectorAll(".accHead[data-acc]").forEach(btn => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-acc");
      const s = loadAccState();
      const now = !s[id];
      s[id] = now;
      saveAccState(s);
      setAccOpen(id, now && (proEnabled || id === "latest"));
    });
  });
}

function wireStudentModal() {
  const overlay = document.getElementById("studentOverlay");
  const btnClose = document.getElementById("btnCloseStudentModal");
  if (!overlay || !btnClose) return;
  if (btnClose.dataset.bound === "1") return;
  btnClose.dataset.bound = "1";
  btnClose.addEventListener("click", () => overlay.classList.remove("show"));
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.classList.remove("show");
  });
}

function openStudentModal(studentName, sessions) {
  const overlay = document.getElementById("studentOverlay");
  const title = document.getElementById("studentModalTitle");
  const sub = document.getElementById("studentModalSub");
  const body = document.getElementById("studentModalBody");
  if (!overlay || !title || !sub || !body) return;

  const assigned = sessions.filter(s => s.assignedTo?.student === studentName);
  const attempts = assigned.length;
  const avg = attempts ? assigned.reduce((a, x) => a + (x.ccfPct || 0), 0) / attempts : 0;
  const best = attempts ? Math.max(...assigned.map(s => s.ccfPct || 0)) : 0;
  const worst = attempts ? Math.min(...assigned.map(s => s.ccfPct || 0)) : 0;

  title.textContent = studentName;
  sub.textContent = attempts ? `${attempts} assigned session${attempts===1?"":"s"} • Avg ${Math.round(avg)}%` : "No assigned sessions yet";

  body.innerHTML = `
    <div class="dashCard" style="margin:0; padding:12px;">
      <div class="dashKpiRow">
        <div class="dashKpi"><div class="kLabel">Average</div><div class="kValue">${attempts ? Math.round(avg) + "%" : "—"}</div></div>
        <div class="dashKpi"><div class="kLabel">Best</div><div class="kValue">${attempts ? Math.round(best) + "%" : "—"}</div></div>
        <div class="dashKpi"><div class="kLabel">Worst</div><div class="kValue">${attempts ? Math.round(worst) + "%" : "—"}</div></div>
      </div>
      <div style="margin-top:10px; display:grid; gap:8px;">
        ${assigned.slice(0, 20).map(s => `
          <div class="tRow" style="grid-template-columns: 1fr 70px 90px;">
            <div class="tName">${escapeHtml(toLocal(s.startedAt))}</div>
            <div class="tNum">${Math.round(s.ccfPct||0)}%</div>
            <div class="tNum">${Math.round(s.handsOffSec||0)}s off</div>
          </div>
        `).join("") || `<div class="emptyNote">Assign sessions from “Most Recent Score”.</div>`}
      </div>
    </div>
  `;

  overlay.classList.add("show");
}

function wireClassSetup(
proEnabled) {
  if (!proEnabled) return;
  const btnSave = document.getElementById("btnSaveClass");
  const btnClear = document.getElementById("btnClearClass");
  const btnAddStudent = document.getElementById("btnAddStudent");
  const elName = document.getElementById("className");
  const elInstr = document.getElementById("instructorName");
  const elLoc = document.getElementById("classLocation");
  const elTarget = document.getElementById("targetCcf");
  const elLen = document.getElementById("sessionLengthSec");

  // Prevent double-binding when boot() re-runs
  if (btnSave && btnSave.dataset.bound === "1") return;
  if (btnSave) btnSave.dataset.bound = "1";
  if (btnClear) btnClear.dataset.bound = "1";
  if (btnAddStudent) btnAddStudent.dataset.bound = "1";

  if (btnAddStudent) {
    btnAddStudent.addEventListener("click", () => {
      const st = readRosterFromEditor();
      st.push({ name: "", email: "", contact: "", score: "" });
      renderRosterEditor(st);
      // Focus the last name field for fast data entry
      const host = document.getElementById("rosterEditor");
      const last = host?.querySelectorAll(".rosterRow");
      const lastRow = last && last.length ? last[last.length - 1] : null;
      lastRow?.querySelector(".rosterName")?.focus();
      // Keep select list in sync
      const sel = document.getElementById("studentSelect");
      if (sel) {
        const names = st.map(x => x.name).filter(Boolean);
        sel.innerHTML = ["Unassigned", ...names].map(s => `<option value="${s}">${s}</option>`).join("");
      }
    });
  }

  if (btnSave) {
    btnSave.addEventListener("click", () => {
      const name = (elName?.value || "").trim();
      const instructor = (elInstr?.value || "").trim();
      const instructorEmail = (elEmail?.value || "").trim();
      const location = (elLoc?.value || "").trim();
      const students = readRosterFromEditor();

      const targetRaw = parseInt(elTarget?.value || "", 10);
      const targetCcf = Number.isFinite(targetRaw)
        ? Math.min(95, Math.max(50, targetRaw))
        : 80;

      const lenRaw = parseInt(elLen?.value || "", 10);
      const sessionLengthSec = Number.isFinite(lenRaw) ? lenRaw : 120;

      saveClassSetup({ name, instructor, instructorEmail, location, students, targetCcf, sessionLengthSec });

      // quick feedback
      const old = btnSave.textContent;
      btnSave.textContent = "Saved ✓";
      setTimeout(() => (btnSave.textContent = old), 900);

      boot();
    });
  }

  if (btnClear) {
    btnClear.addEventListener("click", () => {
      if (!confirm("Clear class setup and roster?")) return;
      clearClassSetup();
      if (elName) elName.value = "";
      if (elInstr) elInstr.value = "";
      if (elLoc) elLoc.value = "";
      if (elTarget) elTarget.value = "";
      if (elLen) elLen.value = "120";
      renderRosterEditor([]);
      boot();
    });
  }
}

function wireProActions(proEnabled) {
  const btnAssign = document.getElementById("btnAssignLatest");
  const btnDownload = document.getElementById("btnDownloadLatest");
  if (!proEnabled) return;

  // Prevent double-binding when boot() re-runs
  if (btnAssign && btnAssign.dataset.bound === "1") return;
  if (btnAssign) btnAssign.dataset.bound = "1";
  if (btnDownload) btnDownload.dataset.bound = "1";

  // Prevent double-binding when boot() re-runs
  if (btnAssign && btnAssign.dataset.bound === "1") return;
  if (btnAssign) btnAssign.dataset.bound = "1";
  if (btnDownload) btnDownload.dataset.bound = "1";

  btnAssign?.addEventListener("click", () => {
    const arr = loadSessions();
    const s = arr[0];
    if (!s) return alert("No sessions to assign yet.");
    const sel = document.getElementById("studentSelect");
    const value = (sel?.value || "Unassigned").trim();
    s.assignedTo = (value && value !== "Unassigned")
      ? { student: value, assignedAt: Date.now() }
      : null;
    arr[0] = s;
    saveSessions(arr);
    boot();
  });

  btnDownload?.addEventListener("click", () => {
    const s = loadSessions()[0];
    if (!s) return alert("No sessions to download yet.");
    const student = sessionDisplayName(s).replaceAll(/[^a-z0-9 _-]/gi, "").trim() || "report";
    const stamp = new Date(s.endedAt || Date.now()).toISOString().slice(0, 10);
    downloadText(`ccf_report_${student}_${stamp}.txt`, makeReportText(s));
  });
}

function boot() {
  applyDebugPro();
  const proEnabled = isPro();
  syncProUI(proEnabled);

  const sessions = loadSessions();
  const reportCountEl = document.getElementById("reportCount");
  if (reportCountEl) reportCountEl.textContent = `${sessions.length} saved`;

  // Accordions + modals
  wireAccordions(proEnabled);
  wireStudentModal();

  // Latest card
  if (proEnabled) renderLatestPro(sessions[0]);
  else renderLatestFree(sessions[0]);

  // Class + roster UI
  syncClassUI(proEnabled);
  wireClassSetup(proEnabled);
  wireProActions(proEnabled);

  // Class report dashboard
  renderClassDashboard(sessions, proEnabled);

  // Export actions
  wireExportActions(proEnabled, sessions);
}


boot();
