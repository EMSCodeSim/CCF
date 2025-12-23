const $ = (id) => document.getElementById(id);

const UI = {
  // Mode banner
  modeLabel: $("modeLabel"),
  modeSub: $("modeSub"),

  // Time / stats
  sessionTime: $("sessionTime"),
  ccfLive: $("ccfLive"),
  cprTime: $("cprTime"),
  handsOff: $("handsOff"),

  // Timeline
  timeline: $("timelineStrip"),

  // Buttons
  btnCPR: $("btnCPR"),
  btnPause: $("btnPause"),
  btnEnd: $("btnEnd"),

  // Metronome
  btnMetro: $("btnMetro"),
  btnBpmDown: $("btnBpmDown"),
  btnBpmUp: $("btnBpmUp"),
  metroBpm: $("metroBpm"),
  pulseDot: $("pulseDot"),
  pulseFill: $("pulseFill"),
  metroHint: $("metroHint"),

  // Pause modal
  overlay: $("overlay"),
  pauseSheet: $("pauseSheet"),
  reasonGrid: $("reasonGrid"),
  selectedReason: $("selectedReason"),

  // Score modal
  scoreModal: $("scoreModal"),
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
  { key: "Shock", icon: "⚡" },
  { key: "Airway/Ventilate", icon: "💨" },
  { key: "Pulse Check", icon: "✋" },
  { key: "IV/IO/Meds", icon: "💉" },
  { key: "Move/Transport", icon: "🚑" },
  { key: "Other", icon: "❓" },
];

const CCF_GOAL = 80;

// ---------------- State ----------------
const state = {
  running: false,
  mode: "ready", // ready | cpr | paused | ended

  startMs: 0,
  lastMs: 0,

  compMs: 0,
  offMs: 0,

  pauseCount: 0,
  longestPauseMs: 0,
  pauseStartMs: null,

  pauses: [], // { reason, ms }
  currentReason: null,

  // Timeline segments
  segments: [], // { kind:'green'|'red', ms:number }
  currentSeg: null, // { kind, t:number }

  // Metronome
  metroOn: false,
  bpm: 110,
  intervalId: null,
  audioCtx: null,
};

function now() { return performance.now(); }

function fmt(ms) {
  ms = Math.max(0, ms|0);
  const s = Math.floor(ms/1000);
  const m = String(Math.floor(s/60)).padStart(2,"0");
  const ss = String(s%60).padStart(2,"0");
  return `${m}:${ss}`;
}

function calcCCF(compMs, offMs){
  const total = compMs + offMs;
  if (total <= 0) return null;
  return Math.round((compMs / total) * 100);
}

// ---------------- UI helpers ----------------
function setMode(label, sub){
  UI.modeLabel.textContent = label;
  UI.modeSub.textContent = sub;
}

function setActiveButtons(){
  // Clear all emphasis
  UI.btnCPR.classList.remove("isActive","isPulsing");
  UI.btnPause.classList.remove("isActive","isPulsing");

  if (state.mode === "cpr"){
    UI.btnCPR.classList.add("isActive","isPulsing");
  }
  if (state.mode === "paused"){
    UI.btnPause.classList.add("isActive","isPulsing");
  }
}

function openPauseSheet(){
  UI.overlay.classList.remove("hidden");
  UI.pauseSheet.classList.remove("hidden");
}
function closePauseSheet(){
  UI.overlay.classList.add("hidden");
  UI.pauseSheet.classList.add("hidden");
}

// NOTE: Overlay click should NOT close during pause (you wanted reasons to stay up).
// We’ll keep overlay click disabled behavior by not attaching a close handler.

function openScore(){
  UI.scoreModal.classList.remove("hidden");
}
function closeScore(){
  UI.scoreModal.classList.add("hidden");
}

// ---------------- Timeline ----------------
function startSegment(kind){
  const t = now();
  // close previous seg
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
  if (state.currentSeg){
    segs.push({ kind: state.currentSeg.kind, ms: t - state.currentSeg.t });
  }

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

// ---------------- Metronome audio + visual ----------------
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
  // Dot + bar “tick”
  UI.pulseDot.style.background = "rgba(34,197,94,.95)";
  UI.pulseDot.style.boxShadow = "0 0 18px rgba(34,197,94,.55)";
  UI.pulseFill.style.width = "100%";

  setTimeout(() => {
    UI.pulseDot.style.background = "rgba(255,255,255,.18)";
    UI.pulseDot.style.boxShadow = "none";
    UI.pulseFill.style.width = "0%";
  }, 90);
}

function metroStart(){
  metroStop();
  const msPerBeat = Math.round(60000 / state.bpm);

  // immediate tick
  if (state.mode === "cpr"){
    playClick();
    metronomePulseVisual();
  }

  state.intervalId = setInterval(() => {
    if (!state.metroOn) return;
    if (state.mode !== "cpr") return; // visual only during CPR
    playClick();
    metronomePulseVisual();
  }, msPerBeat);
}

function metroStop(){
  if (state.intervalId){
    clearInterval(state.intervalId);
    state.intervalId = null;
  }
}

function updateMetroUI(){
  UI.metroBpm.textContent = `${state.bpm} BPM`;
  UI.btnMetro.textContent = `🔊 Metronome: ${state.metroOn ? "ON" : "OFF"}`;

  if (state.running){
    UI.btnMetro.disabled = false;
    UI.btnBpmDown.disabled = false;
    UI.btnBpmUp.disabled = false;
    UI.metroHint.textContent = state.metroOn
      ? "Metronome visual active during CPR"
      : "Turn on metronome for visual + click";
  } else {
    UI.btnMetro.disabled = true;
    UI.btnBpmDown.disabled = true;
    UI.btnBpmUp.disabled = true;
    UI.metroHint.textContent = "Metronome visual (turn on below)";
  }
}

// ---------------- Pause reason tracking ----------------
function addPauseRecord(reason, ms){
  state.pauses.push({ reason, ms });
}

function pausesByReason(){
  const map = {};
  for (const p of state.pauses){
    map[p.reason] = map[p.reason] || { count:0, ms:0 };
    map[p.reason].count += 1;
    map[p.reason].ms += p.ms;
  }
  return Object.entries(map).sort((a,b)=>b[1].ms - a[1].ms);
}

// ---------------- Core loop ----------------
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

  const total = state.compMs + state.offMs;
  UI.sessionTime.textContent = fmt(total);
  UI.cprTime.textContent = fmt(state.compMs);
  UI.handsOff.textContent = fmt(state.offMs);

  const ccf = calcCCF(state.compMs, state.offMs);
  UI.ccfLive.textContent = ccf == null ? "—%" : `${ccf}%`;

  renderTimeline();
  setActiveButtons();

  requestAnimationFrame(tick);
}

// ---------------- Session control ----------------
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

  // If we were paused, finalize the pause
  if (state.mode === "paused" && state.pauseStartMs != null){
    const t = now();
    const dur = t - state.pauseStartMs;
    addPauseRecord(state.currentReason || "Other", dur);
    state.pauseStartMs = null;
  }

  state.mode = "cpr";
  UI.btnPause.disabled = false;

  // Close pause sheet when CPR resumes
  closePauseSheet();

  startSegment("green");
  setMode("CPR", "Compressions ON");
  setActiveButtons();

  // If metronome on, ensure running interval
  if (state.metroOn) metroStart();
}

function startPause(){
  if (!state.running) return;

  state.mode = "paused";
  state.pauseCount += 1;
  state.pauseStartMs = now();

  startSegment("red");
  setMode("PAUSED", "Select a reason (sheet stays open)");
  setActiveButtons();

  // Open and KEEP open
  openPauseSheet();

  // No metronome while paused (interval can keep running but won’t tick)
}

function endSession(){
  if (!state.running) return;

  // finalize current pause segment
  if (state.mode === "paused" && state.pauseStartMs != null){
    const t = now();
    const dur = t - state.pauseStartMs;
    addPauseRecord(state.currentReason || "Other", dur);
    state.pauseStartMs = null;
  }

  stopCurrentSegment();

  state.mode = "ended";
  state.running = false;
  UI.btnPause.disabled = true;
  UI.btnEnd.disabled = true;

  // Stop metronome
  state.metroOn = false;
  metroStop();
  updateMetroUI();

  closePauseSheet();

  // Render score
  renderScore();
  openScore();

  setMode("ENDED", "Session saved (BLS)");
  setActiveButtons();
}

function resetAll(){
  // stop any metro
  metroStop();
  state.metroOn = false;

  state.running = false;
  state.mode = "ready";

  state.startMs = 0;
  state.lastMs = 0;
  state.compMs = 0;
  state.offMs = 0;

  state.pauseCount = 0;
  state.longestPauseMs = 0;
  state.pauseStartMs = null;
  state.pauses = [];
  state.currentReason = null;

  state.segments = [];
  state.currentSeg = null;

  UI.btnPause.disabled = true;
  UI.btnEnd.disabled = true;
  UI.ccfLive.textContent = "—%";
  UI.sessionTime.textContent = "00:00";
  UI.cprTime.textContent = "00:00";
  UI.handsOff.textContent = "00:00";

  UI.selectedReason.textContent = "None";
  clearReasonSelectionUI();

  setMode("READY", "Tap CPR to start");
  closePauseSheet();
  closeScore();

  updateMetroUI();
  renderTimeline();
  setActiveButtons();
}

// ---------------- Score rendering ----------------
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
    return;
  }

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

// ---------------- Pause reason UI ----------------
function clearReasonSelectionUI(){
  const btns = UI.reasonGrid.querySelectorAll("button");
  btns.forEach(b => b.classList.remove("selected"));
}

function buildReasons(){
  UI.reasonGrid.innerHTML = "";
  REASONS.forEach((r) => {
    const b = document.createElement("button");
    b.innerHTML = `${r.icon} ${r.key}`;
    b.addEventListener("click", () => {
      state.currentReason = r.key;
      UI.selectedReason.textContent = r.key;

      clearReasonSelectionUI();
      b.classList.add("selected");
    });
    UI.reasonGrid.appendChild(b);
  });
}

// ---------------- Events ----------------
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

UI.btnScoreClose.addEventListener("click", closeScore);
UI.btnNewSession.addEventListener("click", () => {
  resetAll();
});

// IMPORTANT: overlay DOES NOT close pause sheet (by request).
// So we do nothing on overlay click.

// ---------------- Init ----------------
buildReasons();
resetAll();
