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

  // coach bars
  breathFill: $("breathFill"),
  breathPrompt: $("breathPrompt"),
  breathMeta: $("breathMeta"),
  pulseFill2: $("pulseFill2"),
  pulseMeta: $("pulseMeta"),
  pulsePrompt: $("pulsePrompt"),
  breathDots: Array.from(document.querySelectorAll("#coachBreaths .coachDots span")),

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

  // coach timers
  breathMs: 0,       // time worth of ~30 compressions (estimated using BPM)
  breathDue: false,
  pulseMs: 0,        // 2-min cycle timer (counts while session running)
  pulseDue: false,
  intervalId: null,
  audioCtx: null,
};

// ---- persistence (Reports page) ----
const STORAGE_KEY = "ccf_sessions_v1";

function loadSessions(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  }catch(_e){ return []; }
}

function saveSessions(arr){
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(arr)); }catch(_e){}
}

function pushSession(session){
  const arr = loadSessions();
  arr.unshift(session); // newest first
  // keep last 50
  if (arr.length > 50) arr.length = 50;
  saveSessions(arr);
}


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
  UI.overlay.classList.toggle("hidden", !open);
  UI.pauseOverlayCard.classList.toggle("hidden", !open);
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


function updateCoachBars(){
  if(!UI.breathFill || !UI.pulseFill2) return;

  const msPerCompression = 60000 / Math.max(60, Math.min(200, state.bpm || 110));
  const breathTargetMs = 30 * msPerCompression;
  const pulseTargetMs  = 120000;

  // Breath bar
  const breathPct = Math.max(0, Math.min(1, state.breathMs / breathTargetMs));
  const breathRemainingMs = Math.max(0, breathTargetMs - state.breathMs);
  UI.breathFill.style.width = `${Math.round((1 - breathPct)*100)}%`;

  // Dots
  if(UI.breathDots?.length){
    const lit = Math.min(UI.breathDots.length, Math.floor(breathPct * UI.breathDots.length));
    UI.breathDots.forEach((el, i)=> el.classList.toggle("on", i < lit));
  }

  if(state.breathDue){
    UI.breathMeta.textContent = "Give 2 Breaths";
    UI.breathPrompt.textContent = "GIVE 2 BREATHS";
    UI.breathPrompt.classList.add("due");
  } else {
    UI.breathMeta.textContent = "Next breaths";
    UI.breathPrompt.textContent = `Next breaths in ${Math.max(1, Math.round(breathRemainingMs/1000))}s (~30 compressions)`;
    UI.breathPrompt.classList.remove("due");
  }

  // Pulse check bar
  const pulsePct = Math.max(0, Math.min(1, state.pulseMs / pulseTargetMs));
  UI.pulseFill2.style.width = `${Math.round(pulsePct*100)}%`;
  const pulseRemainingMs = Math.max(0, pulseTargetMs - state.pulseMs);
  UI.pulseMeta.textContent = fmt(pulseRemainingMs);

  if(state.pulseDue){
    UI.pulsePrompt.textContent = "PULSE CHECK";
    UI.pulsePrompt.classList.add("due");
  } else {
    UI.pulsePrompt.textContent = "Pulse Check";
    UI.pulsePrompt.classList.remove("due");
  }
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
  UI.scoreOverlay.classList.toggle("hidden", !open);
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

  // coach timers (estimated using BPM)
  if (state.mode === "cpr"){
    const msPerCompression = 60000 / Math.max(60, Math.min(200, state.bpm || 110));
    const breathTargetMs = 30 * msPerCompression;
    if (!state.breathDue){
      state.breathMs += dt;
      if (state.breathMs >= breathTargetMs){
        state.breathMs = breathTargetMs;
        state.breathDue = true;
      }
    }
  }

  // 2-min pulse check timer (counts while session is running)
  if (state.mode === "cpr" || state.mode === "paused"){
    if (!state.pulseDue){
      state.pulseMs += dt;
      if (state.pulseMs >= 120000){
        state.pulseMs = 120000;
        state.pulseDue = true;
      }
    }
  }

  UI.sessionTime.textContent = fmt(state.compMs + state.offMs);
  UI.cprTime.textContent = fmt(state.compMs);
  UI.handsOff.textContent = fmt(state.offMs);

  setStateBar();
  setActiveButtons();
  renderTimeline();
  updateCoachBars();

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


  // If a coaching cycle was due, treat this resume as "we completed the check/breaths"
  if (state.breathDue){
    state.breathDue = false;
    state.breathMs = 0;
  }
  if (state.pulseDue){
    state.pulseDue = false;
    state.pulseMs = 0;
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
  // Save session for Reports page
  const finalCCF = calcCCF(state.compMs, state.offMs) ?? 0;
  const total = state.compMs + state.offMs;
  const endedAt = new Date().toISOString();

  pushSession({
    endedAt,
    totalMs: total,
    compMs: state.compMs,
    offMs: state.offMs,
    finalCCF,
    pauseCount: state.pauseCount,
    longestPauseMs: state.longestPauseMs,
    pauses: state.pauses,
  });

  // Go to Reports page (ads can live there)
  window.location.href = "./reports.html";
  setStateBar();
  setActiveButtons();
  renderTimeline();
}

function resetAll(){
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

  // coach timers
  state.breathMs = 0;
  state.breathDue = false;
  state.pulseMs = 0;
  state.pulseDue = false;

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
  if (!UI.reasonGrid) return;

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
if (UI.btnCPR) UI.btnCPR.addEventListener("click", startCPR);
if (UI.btnPause) UI.btnPause.addEventListener("click", startPause);

if (UI.btnEnd) UI.btnEnd.addEventListener("click", () => {
  if (confirm("End session and view score?")) endSession();
});

if (UI.btnMetro) UI.btnMetro.addEventListener("click", () => {
  if (!state.running) return;
  ensureAudio();
  state.metroOn = !state.metroOn;
  if (state.metroOn) metroStart();
  else metroStop();
  updateMetroUI();
});

if (UI.btnBpmDown) UI.btnBpmDown.addEventListener("click", () => {
  state.bpm = Math.max(60, state.bpm - 5);
  updateMetroUI();
  if (state.metroOn) metroStart();
});

if (UI.btnBpmUp) UI.btnBpmUp.addEventListener("click", () => {
  state.bpm = Math.min(200, state.bpm + 5);
  updateMetroUI();
  if (state.metroOn) metroStart();
});

if (UI.btnScoreClose) UI.btnScoreClose.addEventListener("click", () => openScore(false));
if (UI.btnNewSession) UI.btnNewSession.addEventListener("click", () => resetAll());

// Optional: tap outside to close pause overlay
if (UI.overlay) UI.overlay.addEventListener("click", () => openPauseOverlay(false));

// ---- init ----
window.addEventListener("DOMContentLoaded", () => {
  try {
    buildReasons();
    resetAll();
  } catch (e) {
    console.error("Init error:", e);
    alert("App failed to start. Check console for details.");
  }
});
