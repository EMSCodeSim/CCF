/* ===========================
   CCF CPR TIMER – app.js
   Fix: CPR button starts timer reliably
   + Breath bar toggles Advanced Airway
   + Both CPR buttons reset breath bar
   + Pause reasons modal w/ big RESUME CPR
   =========================== */

const $ = (id) => document.getElementById(id);
const now = () => Date.now();

function fmt(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

let UI = null;

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

  // Breathing prompts
  breathsDue: false,
  breathCprMs: 0,        // 30:2 training cue timer
  breathAdvMs: 0,        // advanced airway timer (q6s + grace)

  // Advanced airway toggle
  advancedAirway: false,

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

function resetBreathBox() {
  // Resets the breath prompt UI/timers (used when starting/resuming CPR)
  state.breathsDue = false;
  state.breathCprMs = 0;
  state.breathAdvMs = 0;

  if (UI?.breathBar) UI.breathBar.style.width = "0%";
  if (UI?.breathBarBox) UI.breathBarBox.classList.toggle("airwayOn", state.advancedAirway);

  if (UI?.breathMeta) {
    UI.breathMeta.textContent = state.advancedAirway
      ? "Advanced airway • Next breath in 00:06"
      : "No airway • Breaths in 00:17";
  }
}

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

function showPauseModal() {
  if (!UI?.pauseOverlay) return;
  UI.pauseOverlay.classList.add("show");
  UI.pauseOverlay.setAttribute("aria-hidden", "false");
}

function hidePauseModal() {
  if (!UI?.pauseOverlay) return;
  UI.pauseOverlay.classList.remove("show");
  UI.pauseOverlay.setAttribute("aria-hidden", "true");
}

function startCPR() {
  // CPR start/resume must always start the session + animation loop
  startSession();

  // Always reset breath prompt when CPR is started/resumed (both CPR buttons)
  resetBreathBox();

  // If we are resuming from a pause, finalize that pause event first.
  finalizePauseEvent();
  hidePauseModal();

  state.mode = "cpr";
  state.pauseStartMs = null;

  if (UI?.statusTitle) UI.statusTitle.textContent = "CPR ON";
  if (UI?.statusSub) UI.statusSub.textContent = "Compressions ON";

  startMetronome();
}

function startPause() {
  if (!state.running || state.mode === "paused") return;

  state.mode = "paused";
  state.pauseStartMs = now();
  state.pauseCount++;

  // reset current pause selections
  state.currentReasons = [];
  UI?.reasonChips?.forEach((chip) => chip.setAttribute("aria-pressed", "false"));

  if (UI?.statusTitle) UI.statusTitle.textContent = "HANDS-OFF";
  if (UI?.statusSub) UI.statusSub.textContent = state.pauseReasonPromptEnabled ? "Select pause reasons" : "Paused";

  if (state.pauseReasonPromptEnabled) showPauseModal();

  stopMetronome();
}

function endSession() {
  stopMetronome();
  state.running = false;
}

/* ---------- BREATH / PULSE BARS ---------- */
function updateBreathBar(dt) {
  if (!UI?.breathBar || !UI?.breathMeta) return;

  if (state.advancedAirway) {
    // Advanced airway: 1 breath every 6 seconds + grace window to give breath
    const intervalMs = 6000;
    const graceMs = 2000;
    const totalMs = intervalMs + graceMs;

    state.breathAdvMs += dt;
    if (state.breathAdvMs >= totalMs) state.breathAdvMs = state.breathAdvMs % totalMs;

    const inGrace = state.breathAdvMs >= intervalMs;
    const pct = Math.min(100, Math.round((Math.min(state.breathAdvMs, intervalMs) / intervalMs) * 100));
    UI.breathBar.style.width = `${inGrace ? 100 : pct}%`;

    if (inGrace) {
      const remain = totalMs - state.breathAdvMs;
      UI.breathMeta.textContent = `Advanced airway • Breath due (give now) • ${fmt(remain)} remaining`;
    } else {
      const remain = intervalMs - state.breathAdvMs;
      UI.breathMeta.textContent = `Advanced airway • Next breath in ${fmt(remain)}`;
    }
    return;
  }

  // No airway (BLS cue): breaths every ~17s (approx 30 compressions @ ~110 bpm)
  const cycleMs = 17000;
  state.breathCprMs += dt;

  if (state.breathCprMs >= cycleMs) {
    state.breathsDue = true;
    state.breathCprMs = cycleMs;
  }

  const pct = Math.min(100, Math.round((state.breathCprMs / cycleMs) * 100));
  UI.breathBar.style.width = `${pct}%`;
  UI.breathMeta.textContent = state.breathsDue
    ? "No airway • Breaths due"
    : `No airway • Breaths in ${fmt(cycleMs - state.breathCprMs)}`;
}

function updatePulseBar() {
  if (!UI?.pulseBar || !UI?.pulseMeta) return;

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

  if (UI?.mainTimer) UI.mainTimer.textContent = fmt(state.compMs + state.offMs);
  if (UI?.cprOnTime) UI.cprOnTime.textContent = fmt(state.compMs);
  if (UI?.handsOffTime) UI.handsOffTime.textContent = fmt(state.offMs);

  const ccfPct = calcCCF();
  const ccf = `CCF ${ccfPct}`;
  if (UI?.ccfLine) UI.ccfLine.textContent = ccf;
  if (UI?.statusRight) UI.statusRight.textContent = ccf;
  if (UI?.ccfScoreText) UI.ccfScoreText.textContent = ccfPct;

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

/* ---------- PAUSE REASONS (multi-select) ---------- */
function toggleReason(reason, pressed) {
  const idx = state.currentReasons.indexOf(reason);
  if (pressed && idx === -1) state.currentReasons.push(reason);
  if (!pressed && idx !== -1) state.currentReasons.splice(idx, 1);
}

function setAdvancedAirway(enabled) {
  state.advancedAirway = !!enabled;
  if (UI?.advAirwayState) UI.advAirwayState.textContent = state.advancedAirway ? "ON" : "OFF";
  if (UI?.btnAdvAirway) UI.btnAdvAirway.classList.toggle("on", state.advancedAirway);
  if (UI?.breathBarBox) UI.breathBarBox.classList.toggle("airwayOn", state.advancedAirway);

  // Reset UI/timers so it switches cleanly
  resetBreathBox();
}

function handleBreathBoxToggle(e) {
  if (e.type === "keydown") {
    const k = e.key;
    if (k !== "Enter" && k !== " " && k !== "Spacebar") return;
    e.preventDefault();
  }
  setAdvancedAirway(!state.advancedAirway);
}

/* ---------- INIT / BINDINGS ---------- */

/* ---------- SETTINGS (About / Metronome / Class Setup) ---------- */
const LS_KEYS = {
  bpm: "ccf.bpm",
  classSetup: "ccf.classSetup",
};

function safeParseJSON(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

function loadSettingsFromStorage() {
  const bpmStr = localStorage.getItem(LS_KEYS.bpm);
  const bpm = bpmStr ? parseInt(bpmStr, 10) : null;
  if (Number.isFinite(bpm)) state.bpm = Math.min(200, Math.max(60, bpm));

  const cls = safeParseJSON(localStorage.getItem(LS_KEYS.classSetup) || "", null);
  if (cls && UI?.className) {
    UI.className.value = cls.name || "";
    UI.classInstructor.value = cls.instructor || "";
    UI.classLocation.value = cls.location || "";
    UI.classStudents.value = (cls.students || []).join("\n");
  }
}

function saveBpmToStorage() {
  localStorage.setItem(LS_KEYS.bpm, String(state.bpm));
}

function showSettings() {
  if (!UI?.settingsOverlay) return;
  UI.settingsOverlay.classList.add("show");
  UI.settingsOverlay.setAttribute("aria-hidden", "false");
}

function hideSettings() {
  if (!UI?.settingsOverlay) return;
  UI.settingsOverlay.classList.remove("show");
  UI.settingsOverlay.setAttribute("aria-hidden", "true");
}

function setSettingsTab(which) {
  const tabs = [
    { id: "about", tab: UI?.tabAbout, panel: UI?.panelAbout },
    { id: "met", tab: UI?.tabMet, panel: UI?.panelMet },
    { id: "class", tab: UI?.tabClass, panel: UI?.panelClass },
  ];

  tabs.forEach(t => {
    const active = t.id === which;
    if (t.tab) {
      t.tab.classList.toggle("active", active);
      t.tab.setAttribute("aria-selected", active ? "true" : "false");
    }
    if (t.panel) t.panel.classList.toggle("show", active);
  });
}

function syncBpmUI() {
  if (UI?.bpmValue) UI.bpmValue.textContent = state.bpm;
  if (UI?.bpmSlider) UI.bpmSlider.value = String(state.bpm);
}

function saveClassSetup() {
  const payload = {
    name: UI?.className?.value?.trim() || "",
    instructor: UI?.classInstructor?.value?.trim() || "",
    location: UI?.classLocation?.value?.trim() || "",
    students: (UI?.classStudents?.value || "")
      .split("\n")
      .map(s => s.trim())
      .filter(Boolean),
    updatedAt: Date.now(),
  };
  localStorage.setItem(LS_KEYS.classSetup, JSON.stringify(payload));
}

function clearClassSetup() {
  if (UI?.className) UI.className.value = "";
  if (UI?.classInstructor) UI.classInstructor.value = "";
  if (UI?.classLocation) UI.classLocation.value = "";
  if (UI?.classStudents) UI.classStudents.value = "";
  localStorage.removeItem(LS_KEYS.classSetup);
}

function init() {
  UI = {
    mainTimer: $("mainTimer"),
    ccfLine: $("ccfLine"),
    statusTitle: $("statusTitle"),
    statusSub: $("statusSub"),
    statusRight: $("statusRight"),

    breathBar: $("breathBarFill"),
    pulseBar: $("pulseBarFill"),
    breathMeta: $("breathMetaLeft"),
    pulseMeta: $("pulseMetaLeft"),
    breathBarBox: $("breathBarBox"),

    btnCpr: $("btnCpr"),
    btnPause: $("btnPause"),
    btnEnd: $("btnEnd"),

    btnCCFScore: $("btnCCFScore"),
    ccfScoreText: $("ccfScoreText"),

    btnSettings: $("btnSettings"),
    settingsOverlay: $("settingsOverlay"),
    btnSettingsClose: $("btnSettingsClose"),
    tabAbout: $("tabAbout"),
    tabMet: $("tabMet"),
    tabClass: $("tabClass"),
    panelAbout: $("panelAbout"),
    panelMet: $("panelMet"),
    panelClass: $("panelClass"),
    bpmSlider: $("bpmSlider"),
    className: $("className"),
    classInstructor: $("classInstructor"),
    classLocation: $("classLocation"),
    classStudents: $("classStudents"),
    btnSaveClass: $("btnSaveClass"),
    btnClearClass: $("btnClearClass"),

    cprOnTime: $("cprOnTime"),
    handsOffTime: $("handsOffTime"),

    btnMet: $("btnMetronome"),
    metState: $("metState"),
    bpmValue: $("bpmValue"),
    bpmDown: $("btnBpmDown"),
    bpmUp: $("btnBpmUp"),

    btnAdvAirway: $("btnAdvAirway"),
    advAirwayState: $("advAirwayState"),

    pauseOverlay: $("pauseOverlay"),
    btnResumePause: $("btnResumeFromPause"),
    btnClearPauseReasons: $("btnClearPauseReasons"),
    reasonChips: document.querySelectorAll(".reasonChip"),
  };

  // Buttons
  UI.btnCpr?.addEventListener("click", startCPR);
  UI.btnPause?.addEventListener("click", startPause);
  UI.btnEnd?.addEventListener("click", endSession);

  // Metronome
  UI.btnMet?.addEventListener("click", () => {
    if (!state.running) return;
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    state.metronomeOn = !state.metronomeOn;
    if (UI.metState) UI.metState.textContent = state.metronomeOn ? "ON" : "OFF";
    startMetronome();
  });

  UI.bpmDown?.addEventListener("click", () => {
    state.bpm = Math.max(60, state.bpm - 5);
    syncBpmUI();
    saveBpmToStorage();
    startMetronome();
  });

  UI.bpmUp?.addEventListener("click", () => {
    state.bpm = Math.min(200, state.bpm + 5);
    syncBpmUI();
    saveBpmToStorage();
    startMetronome();
  });

  // Advanced airway (optional button still present)
  UI.btnAdvAirway?.addEventListener("click", () => setAdvancedAirway(!state.advancedAirway));

  // Breath bar box is primary toggle
  if (UI.breathBarBox) {
    UI.breathBarBox.addEventListener("click", handleBreathBoxToggle);
    UI.breathBarBox.addEventListener("keydown", handleBreathBoxToggle);
  }

  // Pause reasons chips
  UI.reasonChips?.forEach((chip) => {
    chip.addEventListener("click", () => {
      const reason = chip.dataset.reason;
      const isPressed = chip.getAttribute("aria-pressed") === "true";
      const next = !isPressed;
      chip.setAttribute("aria-pressed", next ? "true" : "false");
      toggleReason(reason, next);
    });
  });

  UI.btnClearPauseReasons?.addEventListener("click", () => {
    state.currentReasons = [];
    UI.reasonChips?.forEach((chip) => chip.setAttribute("aria-pressed", "false"));
  });

  UI.btnResumePause?.addEventListener("click", () => {
    // Start CPR first (prevents getting stuck if overlay fails to hide)
    startCPR();
    hidePauseModal();
  });


  // Settings open/close
  UI.btnSettings?.addEventListener("click", () => {
    showSettings();
    setSettingsTab("about");
  });
  UI.btnSettingsClose?.addEventListener("click", hideSettings);

  // Close settings by tapping backdrop
  UI.settingsOverlay?.addEventListener("click", (e) => {
    if (e.target === UI.settingsOverlay) hideSettings();
  });

  // Tabs
  UI.tabAbout?.addEventListener("click", () => setSettingsTab("about"));
  UI.tabMet?.addEventListener("click", () => setSettingsTab("met"));
  UI.tabClass?.addEventListener("click", () => setSettingsTab("class"));

  // BPM slider
  UI.bpmSlider?.addEventListener("input", () => {
    const v = parseInt(UI.bpmSlider.value, 10);
    if (Number.isFinite(v)) {
      state.bpm = Math.min(200, Math.max(60, v));
      syncBpmUI();
      saveBpmToStorage();
      startMetronome();
    }
  });

  // Class setup save/clear
  UI.btnSaveClass?.addEventListener("click", () => {
    saveClassSetup();
    // quick feedback by momentarily changing button text
    const btn = UI.btnSaveClass;
    const old = btn.textContent;
    btn.textContent = "Saved ✓";
    setTimeout(() => (btn.textContent = old), 900);
  });
  UI.btnClearClass?.addEventListener("click", clearClassSetup);

  // Initial UI
  hidePauseModal();
  hideSettings();
  loadSettingsFromStorage();
  syncBpmUI();
  if (UI.bpmValue) UI.bpmValue.textContent = state.bpm;
  if (UI.metState) UI.metState.textContent = state.metronomeOn ? "ON" : "OFF";
  setAdvancedAirway(false);
  resetBreathBox();
}

// Make sure DOM is ready so buttons always wire up
window.addEventListener("DOMContentLoaded", init);
