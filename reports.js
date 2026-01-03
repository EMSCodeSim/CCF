/* ===========================
   CCF CPR TIMER – reports.js
   - Free: simple CCF + basic pause summary (with ads)
   - Pro: class roster + student assignment + downloadable report cards (no ads)
   =========================== */

const SESSIONS_KEY = "ccf_sessions_v1";
const CLASS_KEY = "ccf.classSetup";
const PRO_KEY = "ccf.proUnlocked";

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
  return safeParseJSON(localStorage.getItem(CLASS_KEY) || "", null);
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
  try {
    const cls = JSON.parse(localStorage.getItem(CLASS_KEY) || "null");
    if (!cls) return null;
    cls.students = Array.isArray(cls.students) ? cls.students.filter(Boolean) : [];
    cls.targetCcf = Number.isFinite(parseInt(cls.targetCcf, 10)) ? parseInt(cls.targetCcf, 10) : 80;
    cls.sessionLengthSec = Number.isFinite(parseInt(cls.sessionLengthSec, 10)) ? parseInt(cls.sessionLengthSec, 10) : 0;
    return cls;
  } catch {
    return null;
  }
}

function computeStudentStats(sessions, rosterNames) {
  const map = new Map();
  rosterNames.forEach(n => map.set(n, { name: n, attempts: 0, avg: 0, best: 0, worst: 0 }));
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
  const roster = (cls?.students || []).map(s => String(s).trim()).filter(Boolean);
  const target = cls?.targetCcf ?? 80;

  if (!cls || !roster.length) {
    if (hintEl) hintEl.style.display = "block";
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
        <div>Student</div><div>Avg</div><div>Attempts</div><div>Status</div>
      </div>
      ${rows.map(r => {
        const st = statusFor(r.avg, r.attempts, target);
        return `
          <div class="tRow">
            <div class="tName">${escapeHtml(r.name)}</div>
            <div class="tNum">${r.attempts ? `${Math.round(r.avg)}%` : "—"}</div>
            <div class="tNum">${r.attempts}</div>
            <div class="tStatus"><span class="pill ${st.cls}">${st.text}</span></div>
          </div>
        `;
      }).join("")}
    `;
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
        const roster = (cls?.students || []).filter(Boolean);
        const msg = roster.length
          ? `Assign to which student?\n\nRoster:\n${roster.slice(0, 25).join("\n")}`
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
  const roster = (cls?.students || []).map(s => String(s).trim()).filter(Boolean);
  const target = cls?.targetCcf ?? 80;

  const rows = [
    ["endedAt","student","finalCCF","totalMs","compMs","offMs","pauseCount","longestPauseMs","className","instructor","targetCcf"],
    ...arr.map(s => [
      s.endedAt,
      sessionDisplayName(s),
      s.finalCCF ?? 0,
      s.totalMs ?? 0,
      s.compMs ?? 0,
      s.offMs ?? 0,
      s.pauseCount ?? 0,
      s.longestPauseMs ?? 0,
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

functifunction syncProUI(proEnabled) {
  const upgrade = document.getElementById("upgradeCard");
  const adZone = document.getElementById("adZone");
  const proBlock = document.getElementById("proBlock");
  const debugBtn = document.getElementById("btnDebugPro");

  if (upgrade) upgrade.style.display = proEnabled ? "none" : "block";
  if (adZone) adZone.style.display = proEnabled ? "none" : "block";
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
  const count = (cls?.students || []).filter(Boolean).length;
  meta.textContent = name
    ? `${name}${instructor ? ` • ${instructor}` : ""} • ${count} students`
    : "No class loaded (Timer → Settings → Class Setup)";

  const roster = (cls?.students || []).map(s => String(s || "").trim()).filter(Boolean);
  sel.innerHTML = ["Unassigned", ...roster].map(s => `<option value="${s}">${s}</option>`).join("");
}

function wireProActions(proEnabled) {
  const btnAssign = document.getElementById("btnAssignLatest");
  const btnDownload = document.getElementById("btnDownloadLatest");
  if (!proEnabled) return;

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
  document.getElementById("reportCount").textContent = `${sessions.length} saved`;

  if (proEnabled) renderLatestPro(sessions[0]);
  else renderLatestFree(sessions[0]);

  syncClassUI(proEnabled);
  wireProActions(proEnabled);
  renderClassDashboard(sessions, proEnabled);
  renderHistory(sessions, proEnabled);
}

document.getElementById("btnClear").addEventListener("click", () => {
  if (confirm("Clear all saved sessions?")) {
    saveSessions([]);
    boot();
  }
});

document.getElementById("btnExport").addEventListener("click", exportCSV);

boot();
