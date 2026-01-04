/* ===========================
   CCF CPR TIMER – app.js
   Fix: CPR button starts timer reliably
   + Breath bar toggles Advanced Airway
   + Both CPR buttons reset breath bar
   + Pause reasons modal w/ big RESUME CPR
   =========================== */

const $ = (id) => document.getElementById(id);
const now = () => Date.now();

// Reports storage
const SESSIONS_KEY = "ccf_sessions_v1";
const PRO_KEY = "ccf.proUnlocked"; // set to "1" by the native app after a successful one-time purchase

function isPro() {
  return localStorage.getItem(PRO_KEY) === "1";
}

function loadSessions() {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveSessions(arr) {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(arr));
  } catch {}
}

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

  // Training cues
  breathTimerEnabled: true,
  pulseCueEnabled: true,

  // CPR profile (affects breath cue when NO advanced airway)
  patientType: "adult", // adult | child | infant
  rescuerCount: 1,       // 1 | 2

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

  // If breath cues are disabled, hide/disable the entire breath UI.
  if (!state.breathTimerEnabled) {
    state.advancedAirway = false;
    if (UI?.advAirwayState) UI.advAirwayState.textContent = "OFF";
    if (UI?.btnAdvAirway) UI.btnAdvAirway.classList.remove("on");
    if (UI?.breathBarBox) {
      UI.breathBarBox.classList.add("barHidden");
      UI.breathBarBox.classList.add("disabled");
    }
    return;
  }

  // Ensure breath UI is visible when enabled
  if (UI?.breathBarBox) {
    UI.breathBarBox.classList.remove("barHidden");
    UI.breathBarBox.classList.remove("disabled");
  }

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
  if (!state.running) return;

  if (!confirm("End this session and save a report?")) return;
  stopMetronome();

  // If we end while paused, capture the last pause segment.
  finalizePauseEvent();

  // Build and save a session record for Reports.
  const totalMs = state.compMs + state.offMs;
  const finalCCF = totalMs > 0 ? Math.round((state.compMs / totalMs) * 100) : 0;
  const longestPauseMs = state.pauseEvents.reduce((m, p) => Math.max(m, p?.durMs || 0), 0);

  const classSetup = safeParseJSON(localStorage.getItem(LS_KEYS.classSetup) || "", null);

  const session = {
    endedAt: now(),
    totalMs,
    compMs: state.compMs,
    offMs: state.offMs,
    finalCCF,
    pauseCount: state.pauseEvents.length,
    longestPauseMs,
    advancedAirwayUsed: !!state.advancedAirway,
    bpm: state.bpm,
    metronomeOn: !!state.metronomeOn,

    cprProfile: {
      patientType: state.patientType,
      rescuerCount: state.rescuerCount,
      breathTimerEnabled: !!state.breathTimerEnabled,
      pulseCueEnabled: !!state.pulseCueEnabled,
    },

    // Keep a simple list for quick display (backward compatible with older reports.js)
    pauses: state.pauseEvents.map(p => ({
      reason: (p.reasons && p.reasons.length) ? p.reasons.join(", ") : "Unspecified",
      ms: p.durMs || 0,
      reasons: (p.reasons && p.reasons.length) ? [...p.reasons] : [],
      startMs: p.startMs,
      endMs: p.endMs,
    })),

    // Optional class context (editable in Settings)
    classContext: classSetup ? {
      name: classSetup.name || "",
      instructor: classSetup.instructor || "",
      location: classSetup.location || "",
      updatedAt: classSetup.updatedAt || null,
    } : null,

    // Assigned later in Pro reports (or by the native app)
    assignedTo: null,
  };

  const arr = loadSessions();
  arr.unshift(session);
  // Keep the newest 200 sessions to avoid unbounded storage growth.
  if (arr.length > 200) arr.length = 200;
  saveSessions(arr);

  // Optional: in Pro, you may later replace this with a nicer modal.
  const msg = isPro()
    ? `Session saved.\n\nYou can assign this report to a student in Reports.`
    : `Session saved.\n\nUpgrade in the app to unlock student assignment and downloadable report cards.`;
  alert(msg);

  // Stop the loop and reset for the next run.
  state.running = false;
  state.mode = "idle";
  state.startMs = 0;
  state.lastMs = 0;
  state.compMs = 0;
  state.offMs = 0;
  state.pauseStartMs = null;
  state.pauseCount = 0;
  state.currentReasons = [];
  state.pauseEvents = [];
  state.breathsDue = false;
  state.breathCprMs = 0;
  state.breathAdvMs = 0;

  // UI reset
  if (UI?.mainTimer) UI.mainTimer.textContent = "00:00";
  if (UI?.cprOnTime) UI.cprOnTime.textContent = "00:00";
  if (UI?.handsOffTime) UI.handsOffTime.textContent = "00:00";
  if (UI?.ccfScoreText) UI.ccfScoreText.textContent = "0%";
  if (UI?.statusTitle) UI.statusTitle.textContent = "READY";
  if (UI?.statusSub) UI.statusSub.textContent = "Press CPR to start";
  resetBreathBox();
}

/* ---------- BREATH / PULSE BARS ---------- */
function updateBreathBar(dt) {
  if (!UI?.breathBar || !UI?.breathMeta) return;

  if (!state.breathTimerEnabled) return;

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

  // No airway (BLS cue): breath cue is based on compression count per cycle.
  // Adult always uses 30:2. Child/infant uses 30:2 for 1 rescuer, 15:2 for 2 rescuers.
  const compressionsPerCycle = getCompressionsPerCycle();
  // Estimate time for that number of compressions at current BPM + small buffer.
  const cycleMs = clampMs(Math.round((compressionsPerCycle / Math.max(60, state.bpm)) * 60000) + 1000, 6000, 20000);
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

function getCompressionsPerCycle() {
  // Adult always uses 30:2.
  if (state.patientType === "adult") return 30;
  // Child/infant: 15:2 when 2-rescuer BLS, otherwise 30:2.
  return state.rescuerCount === 2 ? 15 : 30;
}

function clampMs(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function updatePulseBar() {
  if (!UI?.pulseBar || !UI?.pulseMeta) return;

  if (!state.pulseCueEnabled) {
    if (UI?.pulseBarBox) UI.pulseBarBox.classList.add("barHidden");
    return;
  }

  if (UI?.pulseBarBox) UI.pulseBarBox.classList.remove("barHidden");

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

/* ---------- SETTINGS (About / Metronome) ---------- */
const LS_KEYS = {
  bpm: "ccf.bpm",
  classSetup: "ccf.classSetup",
  pauseReason: "ccf.pauseReasonPrompt",
  breathTimer: "ccf.breathTimer",
  pulseCue: "ccf.pulseCue",
  patientType: "ccf.patientType",
  rescuerCount: "ccf.rescuerCount",
};

function safeParseJSON(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

function loadSettingsFromStorage() {
  const bpmStr = localStorage.getItem(LS_KEYS.bpm);
  const bpm = bpmStr ? parseInt(bpmStr, 10) : null;
  if (Number.isFinite(bpm)) state.bpm = Math.min(200, Math.max(60, bpm));

  const pr = localStorage.getItem(LS_KEYS.pauseReason);
  if (pr === "0") state.pauseReasonPromptEnabled = false;
  if (pr === "1") state.pauseReasonPromptEnabled = true;

  const bt = localStorage.getItem(LS_KEYS.breathTimer);
  if (bt === "0") state.breathTimerEnabled = false;
  if (bt === "1") state.breathTimerEnabled = true;

  const pc = localStorage.getItem(LS_KEYS.pulseCue);
  if (pc === "0") state.pulseCueEnabled = false;
  if (pc === "1") state.pulseCueEnabled = true;

  const pt = localStorage.getItem(LS_KEYS.patientType);
  if (pt === "adult" || pt === "child" || pt === "infant") state.patientType = pt;

  const rc = localStorage.getItem(LS_KEYS.rescuerCount);
  if (rc === "1" || rc === "2") state.rescuerCount = parseInt(rc, 10);
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
    { id: "setup", tab: UI?.tabSetup, panel: UI?.panelSetup },
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
    pulseBarBox: $("pulseBarBox"),

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
    tabSetup: $("tabSetup"),
    panelAbout: $("panelAbout"),
    panelMet: $("panelMet"),
    panelSetup: $("panelSetup"),
    bpmSlider: $("bpmSlider"),
    pauseReasonToggle: $("pauseReasonToggle"),
    breathTimerToggle: $("breathTimerToggle"),
    pulseCueToggle: $("pulseCueToggle"),
    patientTypeSelect: $("patientTypeSelect"),
    rescuerCountSelect: $("rescuerCountSelect"),

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
  UI.tabSetup?.addEventListener("click", () => setSettingsTab("setup"));

  // Pause reason prompt toggle
  UI.pauseReasonToggle?.addEventListener("change", () => {
    state.pauseReasonPromptEnabled = !!UI.pauseReasonToggle.checked;
    localStorage.setItem(LS_KEYS.pauseReason, state.pauseReasonPromptEnabled ? "1" : "0");
  });

  // Breath timer toggle
  UI.breathTimerToggle?.addEventListener("change", () => {
    state.breathTimerEnabled = !!UI.breathTimerToggle.checked;
    localStorage.setItem(LS_KEYS.breathTimer, state.breathTimerEnabled ? "1" : "0");
    resetBreathBox();
  });

  // Pulse cue toggle
  UI.pulseCueToggle?.addEventListener("change", () => {
    state.pulseCueEnabled = !!UI.pulseCueToggle.checked;
    localStorage.setItem(LS_KEYS.pulseCue, state.pulseCueEnabled ? "1" : "0");
    updatePulseBar();
  });

  // CPR profile selectors
  UI.patientTypeSelect?.addEventListener("change", () => {
    const v = UI.patientTypeSelect.value;
    if (v === "adult" || v === "child" || v === "infant") {
      state.patientType = v;
      localStorage.setItem(LS_KEYS.patientType, v);
      // Breath cue timing changes immediately
      state.breathCprMs = 0;
      state.breathsDue = false;
      resetBreathBox();
    }
  });

  UI.rescuerCountSelect?.addEventListener("change", () => {
    const v = UI.rescuerCountSelect.value;
    if (v === "1" || v === "2") {
      state.rescuerCount = parseInt(v, 10);
      localStorage.setItem(LS_KEYS.rescuerCount, v);
      state.breathCprMs = 0;
      state.breathsDue = false;
      resetBreathBox();
    }
  });

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

  // Initial UI
  hidePauseModal();
  hideSettings();
  loadSettingsFromStorage();
  syncBpmUI();
  if (UI?.pauseReasonToggle) UI.pauseReasonToggle.checked = !!state.pauseReasonPromptEnabled;
  if (UI?.breathTimerToggle) UI.breathTimerToggle.checked = !!state.breathTimerEnabled;
  if (UI?.pulseCueToggle) UI.pulseCueToggle.checked = !!state.pulseCueEnabled;
  if (UI?.patientTypeSelect) UI.patientTypeSelect.value = state.patientType;
  if (UI?.rescuerCountSelect) UI.rescuerCountSelect.value = String(state.rescuerCount);
  if (UI.bpmValue) UI.bpmValue.textContent = state.bpm;
  if (UI.metState) UI.metState.textContent = state.metronomeOn ? "ON" : "OFF";
  setAdvancedAirway(false);
  resetBreathBox();
  updatePulseBar();
}

// Make sure DOM is ready so buttons always wire up
window.addEventListener("DOMContentLoaded", init);
