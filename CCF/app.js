/*
function showErrorBanner(msg){
  let bar = document.getElementById("errorBanner");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "errorBanner";
    bar.style.position = "fixed";
    bar.style.left = "12px";
    bar.style.right = "12px";
    bar.style.bottom = "80px";
    bar.style.zIndex = "9999";
    bar.style.padding = "10px 12px";
    bar.style.borderRadius = "14px";
    bar.style.background = "rgba(190,30,60,0.92)";
    bar.style.color = "white";
    bar.style.fontWeight = "800";
    bar.style.fontSize = "13px";
    bar.style.boxShadow = "0 12px 30px rgba(0,0,0,0.35)";
    bar.style.pointerEvents = "auto";
    bar.addEventListener("click", () => bar.remove());
    document.body.appendChild(bar);
  }
  bar.textContent = "Error: " + msg + " (tap to dismiss)";
  clearTimeout(bar._t);
  bar._t = setTimeout(() => { try { bar.remove(); } catch {} }, 8000);
}
 ===========================
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
  sessionEnded: false,
  lastSummary: null,
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
  // If a session was ended and the user presses CPR, start fresh.
  if (state.sessionEnded) resetSession();

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

function setEndButtonMode(mode) {
  // mode: "end" | "reset"
  state.endButtonMode = mode;
  if (UI?.btnEndLabel) UI.btnEndLabel.textContent = mode === "reset" ? "RESET" : "END";
}

function showEndSummary(summary) {
  state.lastSummary = summary;
  state.sessionEnded = true;
  setEndButtonMode("reset");

  if (UI?.endSummaryMeta) {
    const ts = new Date(summary.endedAt || Date.now());
    UI.endSummaryMeta.textContent = `Ended ${ts.toLocaleString()}`;
  }
  if (UI?.endSummaryCcf) UI.endSummaryCcf.textContent = `${summary.finalCCF}%`;
  if (UI?.endSummaryPauses) UI.endSummaryPauses.textContent = String(summary.pauseCount);
  if (UI?.endSummaryLongest) UI.endSummaryLongest.textContent = fmt(summary.longestPauseMs || 0);
  if (UI?.endSummaryLongestReason) UI.endSummaryLongestReason.textContent = `Reason: ${summary.longestPauseReason || "—"}`;

  if (UI?.endSummaryCard) UI.endSummaryCard.style.display = "block";
}

function clearEndSummary() {
  state.lastSummary = null;
  state.sessionEnded = false;
  setEndButtonMode("end");
  if (UI?.endSummaryCard) UI.endSummaryCard.style.display = "none";
}

function resetSession() {
  stopMetronome();

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
  updateBars();
  clearEndSummary();
}

function endSession() {
  // If we already ended, END becomes RESET.
  if (state.sessionEnded) {
    resetSession();
    return;
  }

  if (!state.running) return;

  stopMetronome();

  // If we end while paused, capture the last pause segment.
  finalizePauseEvent();
  hidePauseModal();

  // Compute final stats.
  const totalMs = state.compMs + state.offMs;
  const finalCCF = totalMs > 0 ? Math.round((state.compMs / totalMs) * 100) : 0;

  // Find longest pause + its reason.
  let longestPauseMs = 0;
  let longestPauseReason = "Unspecified";
  for (const p of (state.pauseEvents || [])) {
    const dur = p?.durMs || 0;
    if (dur > longestPauseMs) {
      longestPauseMs = dur;
      const reasons = (p?.reasons && p.reasons.length) ? p.reasons : [];
      longestPauseReason = reasons.length ? reasons.join(", ") : (p?.reason || "Unspecified");
    }
  }

  // Save a session record for the Reports tab (Pro later).
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

    pauses: state.pauseEvents.map(p => ({
      reason: (p.reasons && p.reasons.length) ? p.reasons.join(", ") : (p.reason || "Unspecified"),
      ms: p.durMs || 0,
      reasons: (p.reasons && p.reasons.length) ? [...p.reasons] : [],
      startMs: p.startMs,
      endMs: p.endMs,
    })),

    classContext: classSetup ? {
      name: classSetup.name || "",
      instructor: classSetup.instructor || "",
      location: classSetup.location || "",
      updatedAt: classSetup.updatedAt || null,
    } : null,

    assignedTo: null,
  };

  const arr = loadSessions();
  arr.unshift(session);
  if (arr.length > 200) arr.length = 200;
  saveSessions(arr);

  // Stop the loop but keep the final numbers on screen until RESET.
  state.running = false;
  state.mode = "idle";

  if (UI?.statusTitle) UI.statusTitle.textContent = "ENDED";
  if (UI?.statusSub) UI.statusSub.textContent = "Review summary, then press RESET";

  showEndSummary({
    endedAt: session.endedAt,
    finalCCF,
    pauseCount: session.pauseCount,
    longestPauseMs,
    longestPauseReason,
  });
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
  // Robust press handler: binds pointerup + click (deduped) so controls
  // work reliably on desktop and mobile across responsive layouts.
  function onPress(el, handler) {
    if (!el) return;

    // Desktop-first reliability: use plain click.
    // (Pointer events + aggressive preventDefault can break mouse clicks on some desktop layouts.)
    const wrapped = (e) => {
      try {
        handler(e);
      } catch (err) {
        console.error("Handler error:", err);
        // Show a small banner if something goes wrong so the UI never "silently" fails.
        try { showErrorBanner(String(err?.message || err)); } catch {}
      }
    };

    el.addEventListener("click", wrapped, { passive: true });
  }

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
    btnEndLabel: document.querySelector("#btnEnd .ctlLabel"),

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
    patientTypePills: $("patientTypePills"),
    rescuerCountPills: $("rescuerCountPills"),

    cprOnTime: $("cprOnTime"),
    handsOffTime: $("handsOffTime"),

    endSummaryCard: $("endSummaryCard"),
    endSummaryMeta: $("endSummaryMeta"),
    endSummaryCcf: $("endSummaryCcf"),
    endSummaryPauses: $("endSummaryPauses"),
    endSummaryLongest: $("endSummaryLongest"),
    endSummaryLongestReason: $("endSummaryLongestReason"),

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
  onPress(UI.btnCpr, startCPR);
  onPress(UI.btnPause, startPause);
  onPress(UI.btnEnd, endSession);

  // Metronome
  onPress(UI.btnMet, () => {
    if (!state.running) return;
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    state.metronomeOn = !state.metronomeOn;
    if (UI.metState) UI.metState.textContent = state.metronomeOn ? "ON" : "OFF";
    startMetronome();
  });

  onPress(UI.bpmDown, () => {
    state.bpm = Math.max(60, state.bpm - 5);
    syncBpmUI();
    saveBpmToStorage();
    startMetronome();
  });

  onPress(UI.bpmUp, () => {
    state.bpm = Math.min(200, state.bpm + 5);
    syncBpmUI();
    saveBpmToStorage();
    startMetronome();
  });

  // Advanced airway (optional button still present)
  onPress(UI.btnAdvAirway, () => setAdvancedAirway(!state.advancedAirway));

  // Breath bar box is primary toggle
  if (UI.breathBarBox) {
    onPress(UI.breathBarBox, handleBreathBoxToggle);
    UI.breathBarBox.addEventListener("keydown", handleBreathBoxToggle);
  }

  // Pause reasons chips
  UI.reasonChips?.forEach((chip) => {
    onPress(chip, () => {
      const reason = chip.dataset.reason;
      const isPressed = chip.getAttribute("aria-pressed") === "true";
      const next = !isPressed;
      chip.setAttribute("aria-pressed", next ? "true" : "false");
      toggleReason(reason, next);
    });
  });

  onPress(UI.btnClearPauseReasons, () => {
    state.currentReasons = [];
    UI.reasonChips?.forEach((chip) => chip.setAttribute("aria-pressed", "false"));
  });

  onPress(UI.btnResumePause, () => {
    // Start CPR first (prevents getting stuck if overlay fails to hide)
    startCPR();
    hidePauseModal();
  });


  // Settings open/close
  onPress(UI.btnSettings, () => {
    showSettings();
    setSettingsTab("about");
  });
  onPress(UI.btnSettingsClose, hideSettings);

  // Close settings by tapping backdrop
  UI.settingsOverlay?.addEventListener("click", (e) => {
    if (e.target === UI.settingsOverlay) hideSettings();
  });

  // Tabs
  onPress(UI.tabAbout, () => setSettingsTab("about"));
  onPress(UI.tabMet, () => setSettingsTab("met"));
  onPress(UI.tabSetup, () => setSettingsTab("setup"));

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


  // CPR profile pills
  function setActivePill(groupEl, value) {
    if (!groupEl) return;
    const btns = groupEl.querySelectorAll(".pillBtn");
    btns.forEach((b) => {
      const v = b.getAttribute("data-value");
      if (String(v) === String(value)) b.classList.add("active");
      else b.classList.remove("active");
    });
  }

  function wirePillGroup(groupEl, onPick) {
    if (!groupEl) return;
    groupEl.querySelectorAll(".pillBtn").forEach((btn) => {
      onPress(btn, () => {
        const v = btn.getAttribute("data-value");
        if (v != null) onPick(v);
      });
    });
  }

  wirePillGroup(UI.patientTypePills, (v) => {
    if (v === "adult" || v === "child" || v === "infant") {
      state.patientType = v;
      localStorage.setItem(LS_KEYS.patientType, v);
      setActivePill(UI.patientTypePills, v);

      // Breath cue timing changes immediately
      state.breathCprMs = 0;
      state.breathsDue = false;
      resetBreathBox();
    }
  });

  wirePillGroup(UI.rescuerCountPills, (v) => {
    if (v === "1" || v === "2") {
      state.rescuerCount = parseInt(v, 10);
      localStorage.setItem(LS_KEYS.rescuerCount, v);
      setActivePill(UI.rescuerCountPills, v);

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
  if (UI?.patientTypePills) setActivePill(UI.patientTypePills, state.patientType);
  if (UI?.rescuerCountPills) setActivePill(UI.rescuerCountPills, String(state.rescuerCount));
  if (UI.bpmValue) UI.bpmValue.textContent = state.bpm;
  if (UI.metState) UI.metState.textContent = state.metronomeOn ? "ON" : "OFF";
  setAdvancedAirway(false);
  resetBreathBox();
  updatePulseBar();
}

// Make sure DOM is ready so buttons always wire up
window.addEventListener("DOMContentLoaded", init);
