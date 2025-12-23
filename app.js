const $ = id => document.getElementById(id);

const UI = {
  sessionTime: $("sessionTime"),
  ccfLive: $("ccfLive"),
  timeline: $("timelineStrip"),
  btnCPR: $("btnCPR"),
  btnPause: $("btnPause"),
  handsOff: $("handsOff"),
  cprTime: $("cprTime"),
  overlay: $("overlay"),
  pauseSheet: $("pauseSheet"),
  reasonGrid: $("reasonGrid"),
  btnMetro: $("btnMetro"),
  metroBpm: $("metroBpm")
};

const REASONS = [
  "Rhythm Check",
  "Shock",
  "Airway",
  "Pulse Check",
  "Move",
  "Other"
];

let state = {
  running:false,
  compressing:false,
  start:0,
  last:0,
  compMs:0,
  offMs:0,
  segments:[],
  current:null
};

function now(){return performance.now()}
function fmt(ms){
  const s=Math.floor(ms/1000);
  return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`
}

function startSeg(kind){
  const t=now();
  if(state.current){
    state.segments.push({kind,ms:t-state.current.t});
  }
  state.current={kind,t};
}

function renderTimeline(){
  const total=state.segments.reduce((a,b)=>a+b.ms,0);
  UI.timeline.innerHTML="";
  state.segments.forEach(s=>{
    const d=document.createElement("div");
    d.className=`seg ${s.kind}`;
    d.style.width=`${(s.ms/total)*100}%`;
    UI.timeline.appendChild(d);
  });
}

function tick(){
  if(!state.running) return requestAnimationFrame(tick);
  const t=now();
  const dt=t-state.last;
  state.last=t;

  if(state.compressing){
    state.compMs+=dt;
  }else{
    state.offMs+=dt;
  }

  UI.sessionTime.textContent=fmt(state.compMs+state.offMs);
  UI.cprTime.textContent=fmt(state.compMs);
  UI.handsOff.textContent=fmt(state.offMs);
  UI.ccfLive.textContent=`${Math.round(state.compMs/(state.compMs+state.offMs)*100)||0}%`;

  renderTimeline();
  requestAnimationFrame(tick);
}

UI.btnCPR.onclick=()=>{
  if(!state.running){
    state.running=true;
    state.start=state.last=now();
    startSeg("green");
    tick();
  }
  state.compressing=true;
  startSeg("green");
  UI.btnPause.disabled=false;
};

UI.btnPause.onclick=()=>{
  state.compressing=false;
  startSeg("red");
  UI.overlay.classList.remove("hidden");
  UI.pauseSheet.classList.remove("hidden");
};

UI.overlay.onclick=()=>{
  UI.overlay.classList.add("hidden");
  UI.pauseSheet.classList.add("hidden");
};

REASONS.forEach(r=>{
  const b=document.createElement("button");
  b.textContent=r;
  b.onclick=()=>{
    UI.overlay.classList.add("hidden");
    UI.pauseSheet.classList.add("hidden");
  };
  UI.reasonGrid.appendChild(b);
});
