const $ = (id) => document.getElementById(id);

const UI = {
  // state bar
  stateBar: $("stateBar"),
  stateLabel: $("stateLabel"),
  stateSub: $("stateSub"),
  stateMini: $("stateMini"),

  // time/stats
  sessionTime: $("sessionTime"),
  ccfLive: $("ccfLive"),
  cprTime: $("cprTime"),
  handsOff: $("handsOff"),

  // timeline
  timeline: $("timelineStrip"),

  // buttons
  btnCPR: $("btnCPR"),
  btnPause: $("btnPause"),
  btnEnd: $("btnEnd"),
  tagCPR: $("tagCPR"),
  tagPause: $("tagPause"),

  // pause overlay
  overlay: $("overlay"),
  pauseOverlayCard: $("pauseOverlayCard"),
  reasonGrid: $("reasonGrid"),
  selectedReason: $("selectedReason"),

  // metronome
  btnMetro: $("btnMetro"),
  btnBpmDown: $("btnBpmDown"),
  btnBpmUp: $("btnBpmUp"),
  metroBpm: $("metroBpm"),
  pulseDot: $("pulseDot"),
  pulseFill: $("pulseFill"),
  metroHint: $("metroHint"),

  // score
  scoreOverlay: $("scoreOverlay"),
  btnScoreClose: $("btnScoreClose"),
  btnNewSession: $("btnNewSession"),
  scoreWhen: $("scoreWhen"),
  finalCCF: $("finalCCF"),
  scoreBadge: $("scoreBadge"),
  finalTime: $("finalTime"),
  finalHandsOff: $("finalHandsOff"),
  finalLongest: $("finalLongest"),
  finalPauses: $("finalPauses"),
  breakdownList: $("breakdownList"),
};

const REASONS = [
  { key: "Rhythm/Analysis", icon: "🫀" },
  { key: "Shock",          icon: "⚡" },
  { key: "Airway/Vent",    icon: "💨" },
  { key: "Pulse Check",    icon: "✋" },
  { key: "IV/IO/Meds",     icon: "💉" },
  { key: "Move/Transport", icon: "🚑" },
  { key: "Other",          icon: "❓" },
];

const CCF_GOAL = 80;

const state = {
  running: false,
  mode: "ready", // ready | cpr | paused

  startMs: 0,
  lastMs: 0,

  compMs: 0,
  offMs: 0,

  pauseCount: 0,
  pauseStartMs: null,
  longestPauseMs: 0,

  currentReason: null,
  pauses: [], // { reason, ms }

  segments: [], // { kind:'green'|'red', ms:number }
  currentSeg: null, // { kind, t }

  metroOn: false,
  bpm: 110,
  intervalId: null,
  audioCtx: null,
};

// ---- helpers ----
function now(){ return performance.now(); }
function fmt(ms){
  ms = Math.max(0, ms|0);
  const s = Math.floor(ms/1000);
  return `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;
}
function calcCCF(compMs, offMs){
  const total = compMs + offMs;
  if (total <= 0) return null;
  return Math.round((compMs / total) * 100);
}

// ---- visuals ----
function setStateBar(){
  const ccf = calcCCF(state.compMs, state.offMs);
  const ccfText = ccf == null ? "—%" : `${ccf}%`;
  UI.stateMini.textContent = `CCF ${ccfText}`;
  UI.ccfLive.textContent = ccfText;

  UI.stateBar.classList.remove("stateReady","stateCPR","statePause");

  if (state.mode === "cpr"){
    UI.stateBar.classList.add("stateCPR");
    UI.stateLabel.textContent = "CPR ON";
    UI.stateSub.textContent = "Compressions ON";
  } else if (state.mode === "paused"){
    UI.stateBar.classList.add("statePause");
    UI.stateLabel.textContent = "HANDS-OFF";
    UI.stateSub.textContent = state.currentReason ? `Reason: ${state.currentReason}` : "Select pause reason";
  } else {
    UI.stateBar.classList.add("stateReady");
    UI.stateLabel.textContent = "READY";
    UI.stateSub.textContent = "Tap CPR to start";
  }
}

function setActiveButtons(){
  UI.btnCPR.classList.remove("activeCPR");
  UI.btnPause.classList.remove("activePAUSE");
  UI.tagCPR.classList.add("hidden");
  UI.tagPause.classList.add("hidden");

  if (state.mode === "cpr"){
    UI.btnCPR.classList.add("activeCPR");
    UI.tagCPR.classList.remove("hidden");
  } else if (state.mode === "paused"){
    UI.btnPause.classList.add("activePAUSE");
    UI.tagPause.classList.remove("hidden");
  }
}

// ---- timeline ----
function startSegment(kind){
  const t = now();
  if (state.currentSeg){
    const dur = t - state.currentSeg.t;
    if (dur > 0) state.segments.push({ kind: state.currentSeg.kind, ms: dur });
  }
  state.currentSeg = { kind, t };
}
function stopCurrentSegment(){
  const t = now();
  if (!state.currentSeg) return;
  const dur = t - state.currentSeg.t;
  if (dur > 0) state.segments.push({ kind: state.currentSeg.kind, ms: dur });
  state.currentSeg = null;
}
function renderTimeline(){
  const t = now();
  const segs = state.segments.slice();
  if (state.currentSeg) segs.push({ kind: state.currentSeg.kind, ms: t - state.currentSeg.t });

  const total = segs.reduce((a,s)=>a+s.ms,0);
  UI.timeline.innerHTML = "";
  if (total <= 0) return;

  for (const s of segs){
    const div = document.createElement("div");
    div.className = `seg ${s.kind}`;
    div.style.width = `${(s.ms/total)*100}%`;
    UI.timeline.appendChild(div);
  }
}

// ---- pause overlay (non-layout shifting) ----
function openPauseOverlay(open){
  if (!UI.overlay || !UI.pauseOverlayCard) return;
  UI.overlay.classList.toggle("hidden", !open);
  UI.pauseOverlayCard.classList.toggle("hidden", !open);
  UI.overlay.style.display = open ? "flex" : "none";
  UI.pauseOverlayCard.style.display = open ? "block" : "none";
}
function clearReasonSelectionUI(){
  UI.reasonGrid.querySelectorAll("button").forEach(b=>b.classList.remove("selected"));
}

// ---- metronome ----
function ensureAudio(){
  if (!state.audioCtx){
    const Ctx = window.AudioContext || window.webkitAudioContext;
    state.audioCtx = new Ctx();
  }
  if (state.audioCtx.state === "suspended") state.audioCtx.resume();
}
function playClick(){
  if (!state.audioCtx) return;
  const t = state.audioCtx.currentTime;
  const osc = state.audioCtx.createOscillator();
  const gain = state.audioCtx.createGain();

  osc.type = "square";
  osc.frequency.setValueAtTime(1200, t);

  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.18, t + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);

  osc.connect(gain);
  gain.connect(state.audioCtx.destination);

  osc.start(t);
  osc.stop(t + 0.06);
}
function metronomePulseVisual(){
  UI.pulseDot.style.background = "rgba(34,197,94,.95)";
  UI.pulseDot.style.boxShadow = "0 0 18px rgba(34,197,94,.55)";
  UI.pulseFill.style.width = "100%";
  setTimeout(() => {
    UI.pulseDot.style.background = "rgba(255,255,255,.18)";
    UI.pulseDot.style.boxShadow = "none";
    UI.pulseFill.style.width = "0%";
  }, 90);
}
function metroStop(){
  if (state.intervalId){
    clearInterval(state.intervalId);
    state.intervalId = null;
  }
}
function metroStart(){
  metroStop();
  const msPerBeat = Math.round(60000 / state.bpm);

  if (state.mode === "cpr"){
    playClick();
    metronomePulseVisual();
  }

  state.intervalId = setInterval(() => {
    if (!state.metroOn) return;
    if (state.mode !== "cpr") return;
    playClick();
    metronomePulseVisual();
  }, msPerBeat);
}
function updateMetroUI(){
  UI.metroBpm.textContent = `${state.bpm} BPM`;
  UI.btnMetro.textContent = `🔊 Metronome: ${state.metroOn ? "ON" : "OFF"}`;

  const enabled = state.running;
  UI.btnMetro.disabled = !enabled;
  UI.btnBpmDown.disabled = !enabled;
  UI.btnBpmUp.disabled = !enabled;

  UI.metroHint.textContent = enabled
    ? (state.metroOn ? "Metronome visual active during CPR" : "Turn on metronome for visual + click")
    : "Metronome visual runs during CPR (turn on below)";
}

// ---- scoring ----
function pausesByReason(){
  const map = {};
  for (const p of state.pauses){
    map[p.reason] = map[p.reason] || { count:0, ms:0 };
    map[p.reason].count += 1;
    map[p.reason].ms += p.ms;
  }
  return Object.entries(map).sort((a,b)=>b[1].ms - a[1].ms);
}
function renderScore(){
  const ccf = calcCCF(state.compMs, state.offMs) ?? 0;
  const total = state.compMs + state.offMs;

  UI.scoreWhen.textContent = new Date().toLocaleString();
  UI.finalCCF.textContent = `${ccf}%`;
  UI.finalTime.textContent = fmt(total);
  UI.finalHandsOff.textContent = fmt(state.offMs);
  UI.finalLongest.textContent = fmt(state.longestPauseMs);
  UI.finalPauses.textContent = String(state.pauseCount);

  const meets = ccf >= CCF_GOAL;
  UI.scoreBadge.textContent = meets ? `Meets Goal (≥${CCF_GOAL}%)` : `Below Goal (<${CCF_GOAL}%)`;
  UI.scoreBadge.classList.toggle("good", meets);
  UI.scoreBadge.classList.toggle("bad", !meets);

  UI.breakdownList.innerHTML = "";
  const list = pausesByReason();
  if (list.length === 0){
    UI.breakdownList.innerHTML = `<div class="breakItem"><div class="strong">No pauses recorded</div><div class="muted">Nice work</div></div>`;
  } else {
    for (const [reason, info] of list){
      const div = document.createElement("div");
      div.className = "breakItem";
      div.innerHTML = `
        <div>
          <div class="strong">${reason}</div>
          <div class="muted">${info.count} pause${info.count===1?"":"s"}</div>
        </div>
        <div class="strong">${fmt(info.ms)}</div>
      `;
      UI.breakdownList.appendChild(div);
    }
  }
}
function openScore(open){
  if (!UI.scoreOverlay) return;
  // Hard-toggle display so the overlay can never remain "stuck" on top
  UI.scoreOverlay.classList.toggle("hidden", !open);
  UI.scoreOverlay.style.display = open ? "flex" : "none";
  document.body.classList.toggle("modal-open", open);
}

function hardHideAllOverlays(){
  // Force overlays closed on startup (helps when Safari caches stale DOM/CSS)
  [UI.scoreOverlay, UI.pauseOverlay, UI.reportOverlay].forEach(el => {
    if (!el) return;
    el.classList.add("hidden");
    el.style.display = "none";
  });
  document.body.classList.remove("modal-open");
}

// ---- loop ----
function tick(){
  if (!state.running) return requestAnimationFrame(tick);

  const t = now();
  const dt = t - state.lastMs;
  state.lastMs = t;

  if (state.mode === "cpr"){
    state.compMs += dt;
  } else if (state.mode === "paused"){
    state.offMs += dt;
    if (state.pauseStartMs != null){
      const pauseDur = t - state.pauseStartMs;
      state.longestPauseMs = Math.max(state.longestPauseMs, pauseDur);
    }
  }

  UI.sessionTime.textContent = fmt(state.compMs + state.offMs);
  UI.cprTime.textContent = fmt(state.compMs);
  UI.handsOff.textContent = fmt(state.offMs);

  setStateBar();
  setActiveButtons();
  renderTimeline();

  requestAnimationFrame(tick);
}

// ---- transitions ----
function startSessionIfNeeded(){
  if (state.running) return;
  state.running = true;
  state.mode = "ready";
  state.startMs = now();
  state.lastMs = state.startMs;
  UI.btnEnd.disabled = false;
  updateMetroUI();
  requestAnimationFrame(tick);
}

function startCPR(){
  startSessionIfNeeded();

  // finalize pause if we were paused
  if (state.mode === "paused" && state.pauseStartMs != null){
    const t = now();
    const dur = t - state.pauseStartMs;
    state.pauses.push({ reason: state.currentReason || "Other", ms: dur });
    state.pauseStartMs = null;
  }

  state.mode = "cpr";
  UI.btnPause.disabled = false;

  // close pause overlay if open
  openPauseOverlay(false);

  startSegment("green");

  if (state.metroOn) metroStart();
}

function startPause(){
  if (!state.running) return;
  if (state.mode === "paused") return;

  state.mode = "paused";
  state.pauseCount += 1;
  state.pauseStartMs = now();

  startSegment("red");

  // show overlay but DO NOT change layout
  openPauseOverlay(true);
}

function endSession(){
  if (!state.running) return;

  // finalize pause if paused
  if (state.mode === "paused" && state.pauseStartMs != null){
    const t = now();
    const dur = t - state.pauseStartMs;
    state.pauses.push({ reason: state.currentReason || "Other", ms: dur });
    state.pauseStartMs = null;
  }

  stopCurrentSegment();

  state.running = false;
  state.mode = "ready";

  state.metroOn = false;
  metroStop();
  updateMetroUI();

  UI.btnPause.disabled = true;
  UI.btnEnd.disabled = true;

  openPauseOverlay(false);

  renderScore();
  openScore(true);

  setStateBar();
  setActiveButtons();
  renderTimeline();
}

function resetAll(){
  // Ensure all overlays are truly hidden on app start/reset
  hardHideAllOverlays();

  metroStop();
  state.metroOn = false;

  state.running = false;
  state.mode = "ready";

  state.startMs = 0;
  state.lastMs = 0;

  state.compMs = 0;
  state.offMs = 0;

  state.pauseCount = 0;
  state.pauseStartMs = null;
  state.longestPauseMs = 0;

  state.currentReason = null;
  state.pauses = [];

  state.segments = [];
  state.currentSeg = null;

  UI.btnPause.disabled = true;
  UI.btnEnd.disabled = true;

  UI.sessionTime.textContent = "00:00";
  UI.cprTime.textContent = "00:00";
  UI.handsOff.textContent = "00:00";
  UI.ccfLive.textContent = "—%";
  UI.selectedReason.textContent = "None";
  clearReasonSelectionUI();

  openPauseOverlay(false);
  openScore(false);

  updateMetroUI();
  setStateBar();
  setActiveButtons();
  renderTimeline();
}

// ---- build reasons (auto-hide after selection) ----
function buildReasons(){
  UI.reasonGrid.innerHTML = "";
  for (const r of REASONS){
    const b = document.createElement("button");
    b.textContent = `${r.icon} ${r.key}`;
    b.addEventListener("click", () => {
      state.currentReason = r.key;
      UI.selectedReason.textContent = r.key;

      clearReasonSelectionUI();
      b.classList.add("selected");

      // auto-hide after selection
      openPauseOverlay(false);
    });
    UI.reasonGrid.appendChild(b);
  }
}

// ---- events ----
UI.btnCPR.addEventListener("click", startCPR);
UI.btnPause.addEventListener("click", startPause);

UI.btnEnd.addEventListener("click", () => {
  if (confirm("End session and view score?")) endSession();
});

UI.btnMetro.addEventListener("click", () => {
  if (!state.running) return;
  ensureAudio();
  state.metroOn = !state.metroOn;
  if (state.metroOn) metroStart();
  else metroStop();
  updateMetroUI();
});

UI.btnBpmDown.addEventListener("click", () => {
  state.bpm = Math.max(60, state.bpm - 5);
  updateMetroUI();
  if (state.metroOn) metroStart();
});

UI.btnBpmUp.addEventListener("click", () => {
  state.bpm = Math.min(200, state.bpm + 5);
  updateMetroUI();
  if (state.metroOn) metroStart();
});

UI.btnScoreClose.addEventListener("click", () => openScore(false));
UI.btnNewSession.addEventListener("click", () => resetAll());

// Optional: tap outside to close pause overlay
UI.overlay.addEventListener("click", () => openPauseOverlay(false));

// ---- init ----
buildReasons();
resetAll();
