// app.js
// ======= CCF TIMER MVP (Scenario-based, web -> Capacitor ready) =======

const $ = (id) => document.getElementById(id);

const UI = {
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

  pauseStartMs: null,
  longestPauseMs: 0,
  pauseCount: 0,

  cycleMs: 120000, // 2 min
  cycleStartMs: null,

  // Timeline segments
  segments: [], // { kind:'green'|'red', ms:number }
  currentSeg: null, // { kind, startMs }
  pauseReason: null,

  warnedThisPause: false,
};

function fmt(ms) {
  ms = Math.max(0, ms | 0);
  const totalSec = Math.floor(ms / 1000);
  const m = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const s = String(totalSec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function calcCCF() {
  const total = state.compressionsMs + state.handsOffMs;
  if (total <= 0) return null;
  return Math.round((state.compressionsMs / total) * 100);
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
  const now = performance.now();
  state.running = true;
  state.sessionStartMs = now;
  state.cycleStartMs = now;
  state.lastTickMs = now;
}

function startSegment(kind) {
  const now = performance.now();
  // close prior segment
  if (state.currentSeg) {
    const dur = now - state.currentSeg.startMs;
    if (dur > 0) state.segments.push({ kind: state.currentSeg.kind, ms: dur });
  }
  state.currentSeg = { kind, startMs: now };
}

function stopSegments() {
  const now = performance.now();
  if (state.currentSeg) {
    const dur = now - state.currentSeg.startMs;
    if (dur > 0) state.segments.push({ kind: state.currentSeg.kind, ms: dur });
    state.currentSeg = null;
  }
}

function renderTimeline() {
  const now = performance.now();
  const segs = state.segments.slice();
  if (state.currentSeg) {
    segs.push({ kind: state.currentSeg.kind, ms: now - state.currentSeg.startMs });
  }
  const total = segs.reduce((a, s) => a + s.ms, 0);
  UI.timelineStrip.innerHTML = "";
  if (total <= 0) return;

  for (const s of segs) {
    const div = document.createElement("div");
    div.className = `seg ${s.kind}`;
    div.style.width = `${(s.ms / total) * 100}%`;
    UI.timelineStrip.appendChild(div);
  }
}

function setScenarioButton() {
  UI.btnScenario.textContent = state.scenarioActive ? "END SCENARIO" : "START SCENARIO";
  // color shift when ending
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
  state.longestPauseMs = 0;
  state.pauseCount = 0;

  state.cycleStartMs = null;

  state.segments = [];
  state.currentSeg = null;
  state.pauseReason = null;
  state.warnedThisPause = false;

  closeSheet();
  setStatus("READY", null);
  updateUI(true);
}

function updateUI(force = false) {
  const now = performance.now();

  // session time
  const sessionMs = state.running ? (now - state.sessionStartMs) : 0;
  UI.sessionTime.textContent = fmt(sessionMs);

  // cycle time
  const cycleElapsed = state.running ? (now - state.cycleStartMs) : 0;
  UI.cycleTime.textContent = `${fmt(cycleElapsed)} / ${fmt(state.cycleMs)}`;

  // wrap cycle
  if (state.running && cycleElapsed >= state.cycleMs) {
    const overshoot = cycleElapsed % state.cycleMs;
    state.cycleStartMs = now - overshoot;
  }

  // metrics
  const ccf = calcCCF();
  UI.ccfLive.textContent = ccf === null ? "—%" : `${ccf}%`;
  UI.handsOff.textContent = fmt(state.handsOffMs);
  UI.longestPause.textContent = fmt(state.longestPauseMs);
  UI.pauseCount.textContent = String(state.pauseCount);

  setScenarioButton();
  setCompressionButton();
  renderTimeline();
}

function tick() {
  const now = performance.now();
  if (state.running && state.lastTickMs != null) {
    const dt = now - state.lastTickMs;

    if (state.mode === "compressing") {
      state.compressionsMs += dt;
    } else if (state.mode === "paused") {
      state.handsOffMs += dt;

      if (state.pauseStartMs != null) {
        const pauseDur = now - state.pauseStartMs;
        if (pauseDur > state.longestPauseMs) state.longestPauseMs = pauseDur;

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
  }

  state.lastTickMs = now;
  updateUI();
  requestAnimationFrame(tick);
}

// Scenario button
UI.btnScenario.addEventListener("click", () => {
  // Start scenario
  if (!state.scenarioActive) {
    resetAll();        // fresh session
    ensureRunning();
    state.scenarioActive = true;
    state.mode = "ready";
    setStatus("READY", null);
    updateUI(true);
    return;
  }

  // End scenario
  if (confirm("End scenario and stop the timer?")) {
    state.scenarioActive = false;
    state.scenarioEnded = true;
    stopSegments();
    state.mode = "ready";
    state.running = false;
    setStatus("ENDED", null);
    updateUI(true);
  }
});

// Compression button
UI.btnCompression.addEventListener("click", () => {
  if (!state.scenarioActive) return;

  // Start / resume compressions
  if (state.mode !== "compressing") {
    ensureRunning();

    if (state.mode === "paused") {
      state.pauseStartMs = null;
      state.pauseReason = null;
    }

    state.mode = "compressing";
    state.warnedThisPause = false;
    startSegment("green");
    setStatus("COMPRESSIONS ON", "green");
    updateUI(true);
    return;
  }

  // Pause (requires reason)
  openSheet();
});

UI.btnReset.addEventListener("click", () => {
  if (confirm("Reset this session?")) resetAll();
});

UI.btnClearTimeline.addEventListener("click", () => {
  state.segments = [];
  state.currentSeg = null;
  updateUI(true);
});

UI.overlay.addEventListener("click", closeSheet);
UI.btnSheetClose.addEventListener("click", closeSheet);

// Build reason buttons
function buildReasons() {
  UI.reasonGrid.innerHTML = "";
  for (const reason of REASONS) {
    const b = document.createElement("button");
    b.className = "chip";
    b.textContent = reason;
    b.addEventListener("click", () => {
      if (!state.scenarioActive) return;

      ensureRunning();
      state.mode = "paused";
      state.pauseReason = reason;
      state.pauseStartMs = performance.now();
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

buildReasons();
resetAll();
requestAnimationFrame(tick);
