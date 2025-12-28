/* ===========================
   CCF CPR TIMER – app.js
   =========================== */

const $ = (id) => document.getElementById(id);

/* ---------- STATE ---------- */
const state = {
  running: false,
  mode: "ready", // ready | cpr | paused

  startMs: 0,
  lastMs: 0,

  compMs: 0,
  offMs: 0,

  pauseStartMs: null,
  pauseCount: 0,
  pauses: [],
  currentReason: null,

  breathCprMs: 0,
  breathsDue: false,

  bpm: 110,
  metronomeOn: false,
  metInterval: null,
};

/* ---------- ELEMENTS ---------- */
const UI = {
  mainTimer: $("mainTimer"),
  ccfLine: $("ccfLine"),
  statusTitle: $("statusTitle"),
  statusSub: $("statusSub"),
  statusRight: $("statusRight"),

  breathBar: $("breathBarFill"),
  pulseBar: $("pulseBarFill"),
  breathMeta: $("breathMetaLeft"),
  pulseMeta: $("pulseMetaLeft"),

  btnCpr: $("btnCpr"),
  btnPause: $("btnPause"),
  btnEnd: $("btnEnd"),

  cprOnTime: $("cprOnTime"),
  handsOffTime: $("handsOffTime"),

  btnMet: $("btnMetronome"),
  metState: $("metState"),
  bpmValue: $("bpmValue"),
  bpmDown: $("btnBpmDown"),
  bpmUp: $("btnBpmUp"),

  pausePanel: $("pausePanel"),
  reasonButtons: document.querySelectorAll(".reasonBtn"),
};

/* ---------- HELPERS ---------- */
function now() {
  return performance.now();
}

function fmt(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function calcCCF() {
  const total = state.compMs + state.offMs;
  if (!total) return "—%";
  return Math.round((state.compMs / total) * 100) + "%";
}

/* ---------- METRONOME ---------- */
let audioCtx = null;

function clickSound() {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.frequency.value = 1000;
  gain.gain.setValueAtTime(0.001, t);
  gain.gain.exponentialRampToValueAtTime(0.15, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + 0.06);
}

function startMetronome() {
  stopMetronome();
  if (!state.metronomeOn || state.mode !== "cpr") return;
  const interval = 60000 / state.bpm;
  clickSound();
  state.metInterval = setInterval(clickSound, interval);
}

function stopMetronome() {
  if (state.metInterval) clearInterval(state.metInterval);
  state.metInterval = null;
}

/* ---------- COACH BARS ---------- */
function updateBreathBar(dt) {
  if (state.mode !== "cpr") return;

  const cycleMs = (30 * 60000) / state.bpm;
  state.breathCprMs += dt;

  if (state.breathCprMs >= cycleMs) {
    state.breathsDue = true;
    state.breathCprMs = cycleMs;
  }

  const pct = state.breathsDue
    ? 0
    : Math.max(0, 1 - state.breathCprMs / cycleMs);

  UI.breathBar.style.width = `${Math.round(pct * 100)}%`;
  UI.breathMeta.textContent = state.breathsDue
    ? "Give 2 breaths"
    : `Next breaths in ${Math.ceil((cycleMs - state.breathCprMs) / 1000)}s`;
}

function updatePulseBar() {
  const total = state.compMs + state.offMs;
  const cycle = 120000;
  const remain = cycle - (total % cycle);
  UI.pulseBar.style.width = `${Math.round((remain / cycle) * 100)}%`;
  UI.pulseMeta.textContent = `Next pulse check in ${fmt(remain)}`;
}

/* ---------- LOOP ---------- */
function tick() {
  if (!state.running) return;

  const t = now();
  const dt = t - state.lastMs;
  state.lastMs = t;

  if (state.mode === "cpr") {
    state.compMs += dt;
    updateBreathBar(dt);
  } else if (state.mode === "paused") {
    state.offMs += dt;
  }

  updatePulseBar();

  UI.mainTimer.textContent = fmt(state.compMs + state.offMs);
  UI.cprOnTime.textContent = fmt(state.compMs);
  UI.handsOffTime.textContent = fmt(state.offMs);
  UI.ccfLine.textContent = `CCF ${calcCCF()}`;
  UI.statusRight.textContent = `CCF ${calcCCF()}`;

  requestAnimationFrame(tick);
}

/* ---------- TRANSITIONS ---------- */
function startSession() {
  if (!state.running) {
    state.running = true;
    state.startMs = now();
    state.lastMs = state.startMs;
    requestAnimationFrame(tick);
  }
}

function startCPR() {
  startSession();

  state.mode = "cpr";
  state.pauseStartMs = null;
  state.breathsDue = false;
  state.breathCprMs = 0;

  UI.statusTitle.textContent = "CPR ON";
  UI.statusSub.textContent = "Compressions ON";

  hidePauseReasons();
  startMetronome();
}

function startPause() {
  if (!state.running || state.mode === "paused") return;

  state.mode = "paused";
  state.pauseStartMs = now();
  state.pauseCount++;

  UI.statusTitle.textContent = "HANDS-OFF";
  UI.statusSub.textContent = "Select pause reason";

  showPauseReasons();
  stopMetronome();
}

function endSession() {
  stopMetronome();
  state.running = false;
}

/* ---------- PAUSE REASONS ---------- */
function showPauseReasons() {
  UI.pausePanel.style.display = "block";
}

function hidePauseReasons() {
  UI.pausePanel.style.display = "none";
}

UI.reasonButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    state.currentReason = btn.dataset.reason;
    hidePauseReasons();
  });
});

/* ---------- EVENTS ---------- */
UI.btnCpr.addEventListener("click", startCPR);
UI.btnPause.addEventListener("click", startPause);
UI.btnEnd.addEventListener("click", endSession);

UI.btnMet.addEventListener("click", () => {
  if (!state.running) return;
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  state.metronomeOn = !state.metronomeOn;
  UI.metState.textContent = state.metronomeOn ? "ON" : "OFF";
  startMetronome();
});

UI.bpmDown.addEventListener("click", () => {
  state.bpm = Math.max(60, state.bpm - 5);
  UI.bpmValue.textContent = state.bpm;
  startMetronome();
});

UI.bpmUp.addEventListener("click", () => {
  state.bpm = Math.min(200, state.bpm + 5);
  UI.bpmValue.textContent = state.bpm;
  startMetronome();
});

/* ---------- INIT ---------- */
hidePauseReasons();
UI.bpmValue.textContent = state.bpm;
