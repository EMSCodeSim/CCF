/* ===========================
   CCF CPR TIMER – app.js
   =========================== */

const $ = (id) => document.getElementById(id);
const now = () => Date.now();

function fmt(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

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

  // Pause modal
  pauseOverlay: $("pauseOverlay"),
  btnResumePause: $("btnResumeFromPause"),
  btnClearPauseReasons: $("btnClearPauseReasons"),
  reasonChips: document.querySelectorAll(".reasonChip"),
};

const state = {
  running: false,
  mode: "idle", // "cpr" | "paused" | "idle"
  startMs: 0,
  lastMs: 0,

  compMs: 0,
  offMs: 0,

  pauseStartMs: null,
  pauseCount: 0,

  // Multi-select reasons for the current pause
  currentReasons: [],

  // Stored pause events (for later reporting)
  pauseEvents: [],

  // Future setting: turn this off to skip the reason modal
  pauseReasonPromptEnabled: true,

  breathCprMs: 0,
  breathsDue: false,

  bpm: 110,
  metronomeOn: false,
};

let audioCtx = null;
let metInterval = null;

/* ---------- CORE ---------- */
function calcCCF() {
  const total = state.compMs + state.offMs;
  if (total <= 0) return "0%";
  const pct = Math.round((state.compMs / total) * 100);
  return `${pct}%`;
}

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

  // If we are resuming from a pause, finalize that pause event first.
  finalizePauseEvent();
  hidePauseModal();

  state.mode = "cpr";
  state.pauseStartMs = null;
  state.breathsDue = false;
  state.breathCprMs = 0;

  UI.statusTitle.textContent = "CPR ON";
  UI.statusSub.textContent = "Compressions ON";

  startMetronome();
}

function startPause() {
  if (!state.running || state.mode === "paused") return;

  state.mode = "paused";
  state.pauseStartMs = now();
  state.pauseCount++;

  // reset current pause selections
  state.currentReasons = [];
  UI.reasonChips.forEach((chip) => chip.setAttribute("aria-pressed", "false"));

  UI.statusTitle.textContent = "HANDS-OFF";
  UI.statusSub.textContent = state.pauseReasonPromptEnabled ? "Select pause reasons" : "Paused";

  if (state.pauseReasonPromptEnabled) {
    showPauseModal();
  }

  stopMetronome();
}

function endSession() {
  stopMetronome();
  state.running = false;
}

/* ---------- BREATH / PULSE BARS ---------- */
function updateBreathBar(dt) {
  // Simple BLS-style: prompt breaths every 30 compressions ≈ ~16–18s at 110 bpm.
  // This is your existing behavior; leaving it intact.
  const cycleMs = 17000;
  state.breathCprMs += dt;

  if (state.breathCprMs >= cycleMs) {
    state.breathsDue = true;
    state.breathCprMs = cycleMs;
  }

  const pct = Math.min(100, Math.round((state.breathCprMs / cycleMs) * 100));
  UI.breathBar.style.width = `${pct}%`;

  UI.breathMeta.textContent = state.breathsDue ? "Breaths due" : `Breaths in ${fmt(cycleMs - state.breathCprMs)}`;
}

function updatePulseBar() {
  // Pulse check every 2 minutes (typical training cue).
  const pulseCycle = 120000;
  const t = state.compMs + state.offMs;
  const remain = pulseCycle - (t % pulseCycle);
  const pct = Math.min(100, Math.round(((pulseCycle - remain) / pulseCycle) * 100));
  UI.pulseBar.style.width = `${pct}%`;
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

/* ---------- METRONOME ---------- */
function beep() {
  if (!audioCtx) return;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = "square";
  o.frequency.value = 880;
  g.gain.value = 0.03;
  o.connect(g);
  g.connect(audioCtx.destination);
  o.start();
  o.stop(audioCtx.currentTime + 0.03);
}

function startMetronome() {
  stopMetronome();
  if (!state.metronomeOn || !state.running) return;

  const interval = Math.round(60000 / state.bpm);
  metInterval = setInterval(() => beep(), interval);
}

function stopMetronome() {
  if (metInterval) clearInterval(metInterval);
  metInterval = null;
}

/* ---------- PAUSE REASONS (BLS multi-select) ---------- */
function showPauseModal() {
  UI.pauseOverlay.classList.add("show");
  UI.pauseOverlay.setAttribute("aria-hidden", "false");
}

function hidePauseModal() {
  UI.pauseOverlay.classList.remove("show");
  UI.pauseOverlay.setAttribute("aria-hidden", "true");
}

// Finalize a pause event (called on resume).
function finalizePauseEvent() {
  if (state.mode !== "paused" || !state.pauseStartMs) return;

  const endMs = now();
  const durMs = Math.max(0, endMs - state.pauseStartMs);

  state.pauseEvents.push({
    startMs: state.pauseStartMs,
    endMs,
    durMs,
    reasons: [...state.currentReasons],
  });

  state.pauseStartMs = null;
}

function toggleReason(reason, pressed) {
  const idx = state.currentReasons.indexOf(reason);
  if (pressed && idx === -1) state.currentReasons.push(reason);
  if (!pressed && idx !== -1) state.currentReasons.splice(idx, 1);
}

UI.reasonChips.forEach((chip) => {
  chip.addEventListener("click", () => {
    const reason = chip.dataset.reason;
    const isPressed = chip.getAttribute("aria-pressed") === "true";
    const next = !isPressed;
    chip.setAttribute("aria-pressed", next ? "true" : "false");
    toggleReason(reason, next);
  });
});

UI.btnClearPauseReasons.addEventListener("click", () => {
  state.currentReasons = [];
  UI.reasonChips.forEach((chip) => chip.setAttribute("aria-pressed", "false"));
});

UI.btnResumePause.addEventListener("click", () => {
  // No reason is required—resume immediately.
  hidePauseModal();
  startCPR();
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
hidePauseModal();
UI.bpmValue.textContent = state.bpm;
