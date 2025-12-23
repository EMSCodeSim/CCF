// ======= CCF TIMER MVP (web -> Capacitor ready) =======

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

  btnOn: $("btnOn"),
  btnPause: $("btnPause"),
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
  ms = Math.max(0, ms|0);
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
  setStatus("READY", null);
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
  // Build normalized strip widths from segments + current active segment (partial)
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

function resetAll() {
  state.running = false;
  state.mode = "ready";
  state.sessionStartMs = null;
  state.lastTickMs = null;

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
  updateUI(true);
}

function updateUI(force = false) {
  const now = performance.now();

  // session time
  const sessionMs = state.running ? (now - state.sessionStartMs) : 0;
  UI.sessionTime.textContent = fmt(sessionMs);

  // cycle time
  const cycleElapsed = state.running ? (now - state.cycleStartMs) : 0;
  const cycleDisp = `${fmt(cycleElapsed)} / ${fmt(state.cycleMs)}`;
  UI.cycleTime.textContent = cycleDisp;

  // wrap cycle (keeps simple 2-min blocks)
  if (state.running && cycleElapsed >= state.cycleMs) {
    // roll forward by multiples to avoid drift
    const overshoot = cycleElapsed % state.cycleMs;
    state.cycleStartMs = now - overshoot;
  }

  // metrics
  const ccf = calcCCF();
  UI.ccfLive.textContent = ccf === null ? "—%" : `${ccf}%`;
  UI.handsOff.textContent = fmt(state.handsOffMs);
  UI.longestPause.textContent = fmt(state.longestPauseMs);
  UI.pauseCount.textContent = String(state.pauseCount);

  // buttons
  if (state.mode === "compressing") {
    UI.btnOn.disabled = true;
    UI.btnPause.disabled = false;
    UI.btnOn.style.opacity = "0.85";
  } else if (state.mode === "paused") {
    UI.btnOn.disabled = false;
    UI.btnPause.disabled = true;
    UI.btnPause.style.opacity = "0.85";
    UI.btnPause.textContent = "PAUSED";
    UI.btnOn.textContent = "RESUME COMPRESSIONS";
  } else {
    UI.btnOn.disabled = false;
    UI.btnPause.disabled = false;
    UI.btnOn.textContent = "COMPRESSIONS ON";
    UI.btnPause.textContent = "PAUSE";
    UI.btnOn.style.opacity = "1";
    UI.btnPause.style.opacity = "1";
  }

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

      // pause duration tracking
      if (state.pauseStartMs != null) {
        const pauseDur = now - state.pauseStartMs;
        if (pauseDur > state.longestPauseMs) state.longestPauseMs = pauseDur;

        // warning
        const warnEnabled = UI.warnToggle.checked;
        const warnAt = parseInt(UI.warnSeconds.value, 10) * 1000;
        if (warnEnabled && !state.warnedThisPause && pauseDur >= warnAt) {
          state.warnedThisPause = true;
          // simple alert effect: vibration on mobile if available
          if (navigator.vibrate) navigator.vibrate([120, 80, 120]);
          // flash status color quickly
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

// Actions
UI.btnOn.addEventListener("click", () => {
  ensureRunning();

  // if we were paused, end pause segment
  if (state.mode === "paused") {
    state.pauseStartMs = null;
    state.pauseReason = null;
  }

  state.mode = "compressing";
  state.warnedThisPause = false;
  startSegment("green");
  setStatus("COMPRESSIONS ON", "green");
});

UI.btnPause.addEventListener("click", () => {
  ensureRunning();
  // require reason selection
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
      // start pause
      ensureRunning();
      state.mode = "paused";
      state.pauseReason = reason;
      state.pauseStartMs = performance.now();
      state.pauseCount += 1;
      state.warnedThisPause = false;

      startSegment("red");
      setStatus(`PAUSED • ${reason}`, "red");
      closeSheet();
    });
    UI.reasonGrid.appendChild(b);
  }
}

buildReasons();
resetAll();
requestAnimationFrame(tick);
