/* =========================
   CCF CPR TIMER – APP LOGIC
   ========================= */

/* ---- DOM ---- */
const btnCPR = document.getElementById("btnCPR");
const btnPause = document.getElementById("btnPause");
const btnEnd = document.getElementById("btnEnd");
const btnReports = document.getElementById("btnReports");

const mainTimer = document.getElementById("mainTimer");
const ccfDisplay = document.getElementById("ccfDisplay");
const ccfTop = document.getElementById("ccfTop");

const cprTimeEl = document.getElementById("cprTime");
const pauseTimeEl = document.getElementById("pauseTime");
const timelineFill = document.getElementById("timelineFill");

const breathText = document.getElementById("breathText");
const pulseText = document.getElementById("pulseText");

const pauseOverlay = document.getElementById("pauseOverlay");
const pauseReasons = document.getElementById("pauseReasons");

const scoreOverlay = document.getElementById("scoreOverlay");
const btnCloseScore = document.getElementById("btnCloseScore");
const btnNewSession = document.getElementById("btnNewSession");

const btnMetronome = document.getElementById("btnMetronome");
const bpmDown = document.getElementById("bpmDown");
const bpmUp = document.getElementById("bpmUp");
const bpmValue = document.getElementById("bpmValue");

/* ---- STATE ---- */
let running = false;
let paused = false;

let totalMs = 0;
let cprMs = 0;
let pauseMs = 0;
let longestPause = 0;
let pauseCount = 0;

let breathMs = 0;
let pulseMs = 0;

let metronomeOn = false;
let bpm = 110;

const BREATH_CYCLE = 30000; // ~30 compressions
const PULSE_CYCLE = 120000;

let lastTick = performance.now();

/* ---- HELPERS ---- */
function fmt(ms) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2,"0")}:${String(s % 60).padStart(2,"0")}`;
}

function updateCCF() {
  const ccf = totalMs > 0 ? Math.round((cprMs / totalMs) * 100) : 0;
  ccfDisplay.textContent = `CCF ${ccf}%`;
  ccfTop.textContent = `CCF ${ccf}%`;
}

/* ---- TIMER LOOP ---- */
function tick(now) {
  const dt = now - lastTick;
  lastTick = now;

  if (running) {
    totalMs += dt;

    if (!paused) {
      cprMs += dt;
      breathMs += dt;
      pulseMs += dt;

      if (breathMs >= BREATH_CYCLE) {
        breathMs = 0;
        breathText.textContent = "🫁 GIVE 2 BREATHS";
      } else {
        breathText.textContent = "30 compressions";
      }

      if (pulseMs >= PULSE_CYCLE) {
        pulseMs = 0;
      }

    } else {
      pauseMs += dt;
    }

    longestPause = Math.max(longestPause, pauseMs);
    updateCCF();

    mainTimer.textContent = fmt(totalMs);
    cprTimeEl.textContent = fmt(cprMs);
    pauseTimeEl.textContent = fmt(pauseMs);

    const remain = Math.max(0, PULSE_CYCLE - pulseMs);
    pulseText.textContent = `Next pulse check in ${fmt(remain)}`;

    timelineFill.style.width =
      totalMs > 0 ? `${(cprMs / totalMs) * 100}%` : "0%";
  }

  requestAnimationFrame(tick);
}

/* ---- CONTROLS ---- */
btnCPR.onclick = () => {
  running = true;
  paused = false;
  btnPause.disabled = false;
  btnEnd.disabled = false;
  pauseOverlay.classList.add("hidden");
};

btnPause.onclick = () => {
  if (!running) return;
  paused = true;
  pauseMs = 0;
  pauseCount++;
  pauseOverlay.classList.remove("hidden");
};

pauseReasons.onclick = (e) => {
  if (!e.target.dataset.reason) return;
  pauseOverlay.classList.add("hidden");
};

btnEnd.onclick = () => {
  running = false;
  scoreOverlay.classList.remove("hidden");
  document.getElementById("finalCCF").textContent =
    Math.round((cprMs / totalMs) * 100) || 0;
  document.getElementById("totalTime").textContent = fmt(totalMs);
  document.getElementById("totalPause").textContent = fmt(pauseMs);
  document.getElementById("longestPause").textContent = fmt(longestPause);
  document.getElementById("pauseCount").textContent = pauseCount;
};

btnCloseScore.onclick = () => {
  scoreOverlay.classList.add("hidden");
};

btnNewSession.onclick = () => {
  location.reload();
};

/* ---- METRONOME ---- */
btnMetronome.onclick = () => {
  metronomeOn = !metronomeOn;
  btnMetronome.textContent = metronomeOn
    ? "🎵 Metronome: ON"
    : "🎵 Metronome: OFF";
};

bpmUp.onclick = () => {
  bpm = Math.min(140, bpm + 5);
  bpmValue.textContent = `${bpm} BPM`;
};

bpmDown.onclick = () => {
  bpm = Math.max(80, bpm - 5);
  bpmValue.textContent = `${bpm} BPM`;
};

/* ---- START LOOP ---- */
requestAnimationFrame(tick);
