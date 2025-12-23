// app.js
// ======= CCF TIMER (RUN + TIMELINE + SCORE + HISTORY) =======

const $ = (id) => document.getElementById(id);

// UI
const UI = {
  // Run
  statusText: $("statusText"),
  ccfLive: $("ccfLive"),
  sessionTime: $("sessionTime"),
  cycleTime: $("cycleTime"),
  handsOff: $("handsOff"),
  longestPause: $("longestPause"),
  pauseCount: $("pauseCount"),
  timelineStrip: $("timelineStrip"),

  btnScenario: $("btnScenario"),
  btnCompression: $("btnCompression"),
  btnReset: $("btnReset"),
  btnClearTimeline: $("btnClearTimeline"),

  // Tabs / Screens
  screenRun: $("screenRun"),
  screenTimeline: $("screenTimeline"),
  screenScore: $("screenScore"),
  tabRun: $("tabRun"),
  tabTimeline: $("tabTimeline"),
  tabScore: $("tabScore"),

  // Timeline screen
  timelineStripBig: $("timelineStripBig"),
  pauseList: $("pauseList"),

  // Score screen
  finalCCF: $("finalCCF"),
  scoreBadge: $("scoreBadge"),
  finalDuration: $("finalDuration"),
  finalHandsOff: $("finalHandsOff"),
  finalLongest: $("finalLongest"),
  pauseBreakdown: $("pauseBreakdown"),
  cycleList: $("cycleList"),
  historyList: $("historyList"),
  btnClearHistory: $("btnClearHistory"),

  // Sheet
  overlay: $("overlay"),
  pauseSheet: $("pauseSheet"),
  reasonGrid: $("reasonGrid"),
  btnSheetClose: $("btnSheetClose"),
  warnToggle: $("warnToggle"),
  warnSeconds: $("warnSeconds"),
};

const REASONS = [
  "Rhythm/Analysis",
  "Shock",
  "Airway/Ventilate",
  "Pulse Check",
  "IV/IO/Meds",
  "SGA/ETT",
  "Move/Transport",
  "Other",
];

const STORAGE_KEY = "ccf_sessions_v1";
const HISTORY_LIMIT = 20;
const CCF_GOAL = 80;

// State
const state = {
  running: false,
  mode: "ready", // "compressing" | "paused" | "ready"
  sessionStartMs: null,
  lastTickMs: null,

  scenarioActive: false,
  scenarioEnded: false,

  compressionsMs: 0,
  handsOffMs: 0,

  // pause tracking
  pauseStartMs: null,
  pauseCount: 0,
  longestPauseMs: 0,
  currentPauseReason: null,

  pauses: [], // { reason, startRelMs, durationMs }

  // cycle tracking
  cycleMs: 120000,
  cycleStartMs: null,
  cycleCompMs: 0,
  cycleHandsOffMs: 0,
  cycleLongestPauseMs: 0,
  cycles: [], // { ccf, compMs, handsOffMs, longestPauseMs }

  // timeline bar segments
  segments: [], // { kind:'green'|'red', ms:number }
  currentSeg: null, // { kind, startMs }

  warnedThisPause: false,

  // UI
  activeTab: "run", // "run" | "timeline" | "score"
};

function fmt(ms) {
  ms = Math.max(0, ms | 0);
  const totalSec = Math.floor(ms / 1000);
  const m = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const s = String(totalSec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function calcCCF(compMs, handsOffMs) {
  const total = compMs + handsOffMs;
  if (total <= 0) return null;
  return Math.round((compMs / total) * 100);
}

function nowMs() {
  return performance.now();
}

function relMs() {
  if (!state.sessionStartMs) return 0;
  return nowMs() - state.sessionStartMs;
}

function setStatus(text, kind) {
  UI.statusText.textContent = text;
  UI.statusText.style.color =
    kind === "green" ? "var(--green)" :
    kind === "red" ? "var(--red)" :
    "var(--text)";
}

function openSheet() {
  UI.overlay.classList.remove("hidden");
  UI.pauseSheet.classList.remove("hidden");
}
function closeSheet() {
  UI.overlay.classList.add("hidden");
  UI.pauseSheet.classList.add("hidden");
}

function ensureRunning() {
  if (state.running) return;
  const n = nowMs();
  state.running = true;
  state.sessionStartMs = n;
  state.cycleStartMs = n;
  state.lastTickMs = n;
}

function startSegment(kind) {
  const n = nowMs();
  if (state.currentSeg) {
    const dur = n - state.currentSeg.startMs;
    if (dur > 0) state.segments.push({ kind: state.currentSeg.kind, ms: dur });
  }
  state.currentSeg = { kind, startMs: n };
}

function stopSegments() {
  const n = nowMs();
  if (state.currentSeg) {
    const dur = n - state.currentSeg.startMs;
    if (dur > 0) state.segments.push({ kind: state.currentSeg.kind, ms: dur });
    state.currentSeg = null;
  }
}

function renderTimelineStrip(el) {
  const n = nowMs();
  const segs = state.segments.slice();
  if (state.currentSeg) segs.push({ kind: state.currentSeg.kind, ms: n - state.currentSeg.startMs });
  const total = segs.reduce((a, s) => a + s.ms, 0);
  el.innerHTML = "";
  if (total <= 0) return;
  for (const s of segs) {
    const div = document.createElement("div");
    div.className = `seg ${s.kind}`;
    div.style.width = `${(s.ms / total) * 100}%`;
    el.appendChild(div);
  }
}

function setScenarioButton() {
  UI.btnScenario.textContent = state.scenarioActive ? "END SCENARIO" : "START SCENARIO";
  if (state.scenarioActive) {
    UI.btnScenario.classList.remove("btnBlue");
    UI.btnScenario.classList.add("btnRed");
  } else {
    UI.btnScenario.classList.remove("btnRed");
    UI.btnScenario.classList.add("btnBlue");
  }
}

function setCompressionButton() {
  if (!state.scenarioActive) {
    UI.btnCompression.textContent = "START COMPRESSIONS";
    UI.btnCompression.disabled = true;
    UI.btnCompression.classList.remove("btnRed");
    UI.btnCompression.classList.add("btnGreen");
    return;
  }
  UI.btnCompression.disabled = false;

  if (state.mode === "compressing") {
    UI.btnCompression.textContent = "PAUSE COMPRESSIONS";
    UI.btnCompression.classList.remove("btnGreen");
    UI.btnCompression.classList.add("btnRed");
  } else {
    UI.btnCompression.textContent = "START COMPRESSIONS";
    UI.btnCompression.classList.remove("btnRed");
    UI.btnCompression.classList.add("btnGreen");
  }
}

function switchTab(tab) {
  state.activeTab = tab;

  UI.screenRun.classList.toggle("hidden", tab !== "run");
  UI.screenTimeline.classList.toggle("hidden", tab !== "timeline");
  UI.screenScore.classList.toggle("hidden", tab !== "score");

  UI.tabRun.classList.toggle("active", tab === "run");
  UI.tabTimeline.classList.toggle("active", tab === "timeline");
  UI.tabScore.classList.toggle("active", tab === "score");

  // render tab-specific views
  if (tab === "timeline") renderTimelineScreen();
  if (tab === "score") renderScoreScreen();
}

function resetAll() {
  state.running = false;
  state.mode = "ready";
  state.sessionStartMs = null;
  state.lastTickMs = null;

  state.scenarioActive = false;
  state.scenarioEnded = false;

  state.compressionsMs = 0;
  state.handsOffMs = 0;

  state.pauseStartMs = null;
  state.pauseCount = 0;
  state.longestPauseMs = 0;
  state.currentPauseReason = null;

  state.pauses = [];

  state.cycleStartMs = null;
  state.cycleCompMs = 0;
  state.cycleHandsOffMs = 0;
  state.cycleLongestPauseMs = 0;
  state.cycles = [];

  state.segments = [];
  state.currentSeg = null;

  state.warnedThisPause = false;

  closeSheet();
  setStatus("READY", null);
  updateUI(true);
}

function finalizeCurrentPauseIfActive() {
  if (state.mode !== "paused" || state.pauseStartMs == null) return;

  const n = nowMs();
  const dur = n - state.pauseStartMs;

  // record pause event
  state.pauses.push({
    reason: state.currentPauseReason || "Other",
    startRelMs: (state.pauseStartMs - state.sessionStartMs),
    durationMs: dur
  });

  if (dur > state.longestPauseMs) state.longestPauseMs = dur;
  if (dur > state.cycleLongestPauseMs) state.cycleLongestPauseMs = dur;

  state.pauseStartMs = null;
  state.currentPauseReason = null;
}

function finalizeCycleIfNeeded() {
  if (!state.running || !state.cycleStartMs) return;

  const n = nowMs();
  const elapsed = n - state.cycleStartMs;
  if (elapsed < state.cycleMs) return;

  // finalize current cycle snapshot
  const ccf = calcCCF(state.cycleCompMs, state.cycleHandsOffMs);
  state.cycles.push({
    ccf: ccf ?? 0,
    compMs: state.cycleCompMs,
    handsOffMs: state.cycleHandsOffMs,
    longestPauseMs: state.cycleLongestPauseMs
  });

  // reset cycle accumulators
  state.cycleCompMs = 0;
  state.cycleHandsOffMs = 0;
  state.cycleLongestPauseMs = 0;

  // move cycle start forward (handle overshoot)
  const overshoot = elapsed % state.cycleMs;
  state.cycleStartMs = n - overshoot;
}

function updateUI(force = false) {
  const n = nowMs();

  // Session time
  const sessionMs = state.running && state.sessionStartMs ? (n - state.sessionStartMs) : 0;
  UI.sessionTime.textContent = fmt(sessionMs);

  // Cycle time
  const cycleElapsed = state.running && state.cycleStartMs ? (n - state.cycleStartMs) : 0;
  UI.cycleTime.textContent = `${fmt(cycleElapsed)} / ${fmt(state.cycleMs)}`;

  // metrics
  const liveCCF = calcCCF(state.compressionsMs, state.handsOffMs);
  UI.ccfLive.textContent = liveCCF === null ? "—%" : `${liveCCF}%`;
  UI.handsOff.textContent = fmt(state.handsOffMs);
  UI.longestPause.textContent = fmt(state.longestPauseMs);
  UI.pauseCount.textContent = String(state.pauseCount);

  setScenarioButton();
  setCompressionButton();
  renderTimelineStrip(UI.timelineStrip);

  // keep other screens fresh too
  if (state.activeTab === "timeline") renderTimelineScreen();
  if (state.activeTab === "score") renderScoreScreen();
}

function tick() {
  const n = nowMs();

  if (state.running && state.lastTickMs != null) {
    const dt = n - state.lastTickMs;

    if (state.mode === "compressing") {
      state.compressionsMs += dt;
      state.cycleCompMs += dt;
    } else if (state.mode === "paused") {
      state.handsOffMs += dt;
      state.cycleHandsOffMs += dt;

      // update longest pause "live"
      if (state.pauseStartMs != null) {
        const pauseDur = n - state.pauseStartMs;
        if (pauseDur > state.longestPauseMs) state.longestPauseMs = pauseDur;
        if (pauseDur > state.cycleLongestPauseMs) state.cycleLongestPauseMs = pauseDur;

        // warning
        const warnEnabled = UI.warnToggle.checked;
        const warnAt = parseInt(UI.warnSeconds.value, 10) * 1000;
        if (warnEnabled && !state.warnedThisPause && pauseDur >= warnAt) {
          state.warnedThisPause = true;
          if (navigator.vibrate) navigator.vibrate([120, 80, 120]);
          UI.statusText.style.filter = "drop-shadow(0 0 10px rgba(239,68,68,.8))";
          setTimeout(() => (UI.statusText.style.filter = "none"), 350);
        }
      }
    }

    // cycle rollovers
    finalizeCycleIfNeeded();
  }

  state.lastTickMs = n;
  updateUI();
  requestAnimationFrame(tick);
}

// ---------- Rendering: Timeline / Score / History ----------

function renderTimelineScreen() {
  renderTimelineStrip(UI.timelineStripBig);

  UI.pauseList.innerHTML = "";
  if (state.pauses.length === 0) {
    const empty = document.createElement("div");
    empty.className = "item";
    empty.innerHTML = `<div class="strong">No pauses recorded</div><div class="small">Start a scenario, pause with a reason, then resume.</div>`;
    UI.pauseList.appendChild(empty);
    return;
  }

  for (const p of state.pauses) {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `
      <div class="strong">${fmt(p.startRelMs)}</div>
      <div><span class="pill red">${p.reason}</span></div>
      <div class="right strong">${Math.max(1, Math.round(p.durationMs/1000))}s</div>
    `;
    UI.pauseList.appendChild(row);
  }
}

function pausesByReason(pauses) {
  const map = {};
  for (const p of pauses) {
    const key = p.reason || "Other";
    if (!map[key]) map[key] = { count: 0, totalMs: 0 };
    map[key].count += 1;
    map[key].totalMs += p.durationMs;
  }
  // sort by total time desc
  return Object.entries(map).sort((a, b) => b[1].totalMs - a[1].totalMs);
}

function renderScoreScreen() {
  // Final summary from current state (even if scenario not ended yet)
  const durationMs = state.running && state.sessionStartMs ? (nowMs() - state.sessionStartMs) : (
    state.sessionStartMs ? (state.lastTickMs - state.sessionStartMs) : 0
  );

  const finalCCF = calcCCF(state.compressionsMs, state.handsOffMs);
  UI.finalCCF.textContent = finalCCF === null ? "—%" : `${finalCCF}%`;

  const pass = (finalCCF !== null && finalCCF >= CCF_GOAL);
  UI.scoreBadge.textContent = finalCCF === null ? "No data" : (pass ? `Meets Goal (≥${CCF_GOAL}%)` : `Needs Improvement (<${CCF_GOAL}%)`);
  UI.scoreBadge.classList.toggle("good", !!pass);
  UI.scoreBadge.classList.toggle("bad", finalCCF !== null && !pass);

  UI.finalDuration.textContent = fmt(durationMs);
  UI.finalHandsOff.textContent = fmt(state.handsOffMs);
  UI.finalLongest.textContent = fmt(state.longestPauseMs);

  // Breakdown
  UI.pauseBreakdown.innerHTML = "";
  const breakdown = pausesByReason(state.pauses);
  if (breakdown.length === 0) {
    UI.pauseBreakdown.innerHTML = `<div class="item"><div class="strong">No pauses recorded</div><div class="small">Great! Or you never paused.</div></div>`;
  } else {
    for (const [reason, info] of breakdown) {
      const div = document.createElement("div");
      div.className = "item";
      div.innerHTML = `
        <div>
          <div class="strong">${reason}</div>
          <div class="muted">${info.count} pause${info.count===1?"":"s"}</div>
        </div>
        <div class="strong">${fmt(info.totalMs)}</div>
      `;
      UI.pauseBreakdown.appendChild(div);
    }
  }

  // Cycles (include current unfinished as "Current" if scenario still running)
  UI.cycleList.innerHTML = "";
  const cycles = state.cycles.slice();

  // Add current partial cycle as preview
  if (state.running && (state.cycleCompMs + state.cycleHandsOffMs) > 0) {
    cycles.push({
      ccf: calcCCF(state.cycleCompMs, state.cycleHandsOffMs) ?? 0,
      compMs: state.cycleCompMs,
      handsOffMs: state.cycleHandsOffMs,
      longestPauseMs: state.cycleLongestPauseMs,
      _partial: true
    });
  }

  if (cycles.length === 0) {
    UI.cycleList.innerHTML = `<div class="item"><div class="strong">No cycles yet</div><div class="small">Start compressions to begin cycle tracking.</div></div>`;
  } else {
    cycles.forEach((c, idx) => {
      const div = document.createElement("div");
      div.className = "item";
      const label = c._partial ? `Current` : `Cycle ${idx + 1}`;
      div.innerHTML = `
        <div>
          <div class="strong">${label} • ${c.ccf}% CCF</div>
          <div class="small">Longest pause: ${fmt(c.longestPauseMs)}</div>
        </div>
        <div class="muted">${fmt(c.compMs)} on</div>
      `;
      UI.cycleList.appendChild(div);
    });
  }

  // History
  renderHistory();
}

function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveHistory(items) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, HISTORY_LIMIT)));
  } catch {}
}

function addSessionToHistory(session) {
  const items = loadHistory();
  items.unshift(session);
  saveHistory(items);
}

function renderHistory() {
  const items = loadHistory();
  UI.historyList.innerHTML = "";

  if (items.length === 0) {
    UI.historyList.innerHTML = `<div class="item"><div class="strong">No saved sessions yet</div><div class="small">End a scenario to save it here.</div></div>`;
    return;
  }

  for (const s of items.slice(0, 10)) {
    const div = document.createElement("div");
    div.className = "item";
    const dt = new Date(s.date);
    const when = isNaN(dt.getTime()) ? "" : dt.toLocaleString();
    div.innerHTML = `
      <div>
        <div class="strong">${s.ccf}% CCF</div>
        <div class="small">${when}</div>
      </div>
      <div class="right">
        <div class="muted">${fmt(s.durationMs)}</div>
        <div class="small">LP ${fmt(s.longestPauseMs)}</div>
      </div>
    `;
    UI.historyList.appendChild(div);
  }
}

// ---------- Actions ----------

UI.tabRun.addEventListener("click", () => switchTab("run"));
UI.tabTimeline.addEventListener("click", () => switchTab("timeline"));
UI.tabScore.addEventListener("click", () => switchTab("score"));

UI.btnScenario.addEventListener("click", () => {
  // Start scenario
  if (!state.scenarioActive) {
    resetAll();
    ensureRunning();
    state.scenarioActive = true;
    state.mode = "ready";
    setStatus("READY", null);
    switchTab("run");
    updateUI(true);
    return;
  }

  // End scenario
  if (confirm("End scenario and stop the timer?")) {
    // finalize any active pause so list + stats are correct
    finalizeCurrentPauseIfActive();

    // finalize current partial cycle snapshot (optional, only if any activity)
    if ((state.cycleCompMs + state.cycleHandsOffMs) > 0) {
      const ccf = calcCCF(state.cycleCompMs, state.cycleHandsOffMs) ?? 0;
      state.cycles.push({
        ccf,
        compMs: state.cycleCompMs,
        handsOffMs: state.cycleHandsOffMs,
        longestPauseMs: state.cycleLongestPauseMs
      });
      state.cycleCompMs = 0;
      state.cycleHandsOffMs = 0;
      state.cycleLongestPauseMs = 0;
    }

    // stop segments and timer
    stopSegments();
    state.running = false;
    state.scenarioActive = false;
    state.scenarioEnded = true;
    state.mode = "ready";
    setStatus("ENDED", null);

    // Save to history
    const durationMs = state.sessionStartMs && state.lastTickMs ? (state.lastTickMs - state.sessionStartMs) : 0;
    const ccfFinal = calcCCF(state.compressionsMs, state.handsOffMs) ?? 0;
    addSessionToHistory({
      date: new Date().toISOString(),
      ccf: ccfFinal,
      durationMs,
      handsOffMs: state.handsOffMs,
      longestPauseMs: state.longestPauseMs,
      pauseCount: state.pauseCount,
      pausesByReason: Object.fromEntries(pausesByReason(state.pauses).map(([k, v]) => [k, v])),
      cycles: state.cycles.slice(0)
    });

    // Auto-show SCORE (your preference A)
    switchTab("score");
    updateUI(true);
  }
});

UI.btnCompression.addEventListener("click", () => {
  if (!state.scenarioActive) return;

  // If currently compressing -> pause requires reason
  if (state.mode === "compressing") {
    openSheet();
    return;
  }

  // Starting/resuming compressions
  ensureRunning();

  // finalize active pause (if any) before switching to compressions
  finalizeCurrentPauseIfActive();

  state.mode = "compressing";
  state.warnedThisPause = false;
  startSegment("green");
  setStatus("COMPRESSIONS ON", "green");
  updateUI(true);
});

UI.btnReset.addEventListener("click", () => {
  if (confirm("Reset this session?")) {
    resetAll();
    switchTab("run");
  }
});

UI.btnClearTimeline.addEventListener("click", () => {
  state.segments = [];
  state.currentSeg = null;
  updateUI(true);
});

UI.btnClearHistory.addEventListener("click", () => {
  if (confirm("Clear all saved session history?")) {
    saveHistory([]);
    renderHistory();
  }
});

UI.overlay.addEventListener("click", closeSheet);
UI.btnSheetClose.addEventListener("click", closeSheet);

// Build pause reason buttons
function buildReasons() {
  UI.reasonGrid.innerHTML = "";
  for (const reason of REASONS) {
    const b = document.createElement("button");
    b.className = "chip";
    b.textContent = reason;

    b.addEventListener("click", () => {
      if (!state.scenarioActive) return;

      ensureRunning();

      // switch to paused and start pause tracking
      state.mode = "paused";
      state.currentPauseReason = reason;
      state.pauseStartMs = nowMs();
      state.pauseCount += 1;
      state.warnedThisPause = false;

      startSegment("red");
      setStatus(`PAUSED • ${reason}`, "red");

      closeSheet();
      updateUI(true);
    });

    UI.reasonGrid.appendChild(b);
  }
}

// Init
buildReasons();
resetAll();
switchTab("run");
requestAnimationFrame(tick);
