const breathBar = document.getElementById("breathBar");
const pulseBar  = document.getElementById("pulseBar");
const breathHint = document.getElementById("breathHint");
const pulseHint  = document.getElementById("pulseHint");

let breathMs = 0;
let pulseMs  = 0;

const BREATH_CYCLE = 30000; // ~30 compressions
const PULSE_CYCLE  = 120000;

function tickBars(dt) {
  breathMs += dt;
  pulseMs  += dt;

  if (breathMs >= BREATH_CYCLE) {
    breathMs = 0;
    breathHint.textContent = "Give 2 breaths";
  } else {
    breathHint.textContent = "Keep compressions going";
  }

  if (pulseMs >= PULSE_CYCLE) {
    pulseMs = 0;
  }

  breathBar.style.width = `${(breathMs / BREATH_CYCLE) * 100}%`;
  pulseBar.style.width  = `${(pulseMs / PULSE_CYCLE) * 100}%`;

  const remaining = Math.max(0, PULSE_CYCLE - pulseMs);
  const sec = Math.floor(remaining / 1000);
  pulseHint.textContent = `Next pulse check in ${Math.floor(sec/60)}:${String(sec%60).padStart(2,"0")}`;
}

/* integrate with your existing tick loop */
let last = performance.now();
function loop(t) {
  const dt = t - last;
  last = t;
  tickBars(dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
