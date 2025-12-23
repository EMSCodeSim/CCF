const STORAGE_KEY = "ccf_sessions_v1";

function fmt(ms){
  ms = Math.max(0, ms|0);
  const s = Math.floor(ms/1000);
  return `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;
}

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

function downloadText(filename, text){
  const blob = new Blob([text], {type:"text/plain;charset=utf-8"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
}

function toLocal(ts){
  try{
    const d = new Date(ts);
    return d.toLocaleString();
  }catch(_e){ return ts; }
}

function badgeForCCF(ccf){
  if (ccf >= 90) return { text:"Excellent", cls:"good" };
  if (ccf >= 80) return { text:"Meets Goal", cls:"good" };
  if (ccf >= 70) return { text:"Needs Work", cls:"bad" };
  return { text:"Low", cls:"bad" };
}

function renderLatest(session){
  const el = document.getElementById("latestCard");
  if (!session){
    el.innerHTML = `
      <div class="emptyCard">
        <div class="emptyTitle">No sessions yet</div>
        <div class="emptySub">Go back to the timer and run a scenario.</div>
        <a class="newBtn" href="./index.html" style="text-decoration:none; display:block; text-align:center;">Start Timer</a>
      </div>
    `;
    return;
  }

  const b = badgeForCCF(session.finalCCF);
  el.innerHTML = `
    <div class="scoreTop">
      <div>
        <div class="scoreTitle">Most Recent</div>
        <div class="scoreSub">${toLocal(session.endedAt)}</div>
      </div>
      <div class="scoreBadge ${b.cls}">${b.text}</div>
    </div>

    <div class="scoreBigRow" style="margin-top:12px;">
      <div class="scoreBig">
        <div class="scoreLabel">Final CCF</div>
        <div class="scoreValue">${session.finalCCF}%</div>
      </div>
      <div style="text-align:right;">
        <div class="scoreLabel">Total</div>
        <div style="font-weight:1000; font-size:18px; margin-top:6px;">${fmt(session.totalMs)}</div>
      </div>
    </div>

    <div class="scoreGrid">
      <div class="miniCard">
        <div class="miniLabel">CPR On</div>
        <div class="miniValue">${fmt(session.compMs)}</div>
      </div>
      <div class="miniCard">
        <div class="miniLabel">Hands-Off</div>
        <div class="miniValue">${fmt(session.offMs)}</div>
      </div>
      <div class="miniCard">
        <div class="miniLabel">Longest Pause</div>
        <div class="miniValue">${fmt(session.longestPauseMs)}</div>
      </div>
      <div class="miniCard">
        <div class="miniLabel">Pauses</div>
        <div class="miniValue">${session.pauseCount}</div>
      </div>
    </div>

    <div class="breakdownBlock">
      <div class="breakTitle">Pauses (most recent)</div>
      <div class="breakList">
        ${(session.pauses && session.pauses.length)
          ? session.pauses.slice().reverse().slice(0,8).map(p=>`
              <div class="breakItem">
                <div>
                  <div class="strong">${p.reason}</div>
                  <div class="muted">pause</div>
                </div>
                <div class="strong">${fmt(p.ms)}</div>
              </div>
            `).join("")
          : `<div class="breakItem"><div class="strong">No pauses recorded</div><div class="muted">Nice work</div></div>`
        }
      </div>
    </div>
  `;
}

function renderHistory(list){
  const el = document.getElementById("historyList");
  if (!list.length){
    el.innerHTML = `<div class="historyEmpty">No saved sessions.</div>`;
    return;
  }

  el.innerHTML = list.map((s, idx) => {
    const b = badgeForCCF(s.finalCCF);
    return `
      <div class="histRow">
        <div>
          <div class="histTopLine">
            <div class="histCCF">${s.finalCCF}%</div>
            <div class="histBadge ${b.cls}">${b.text}</div>
          </div>
          <div class="histMeta">${toLocal(s.endedAt)} • Total ${fmt(s.totalMs)} • Hands-Off ${fmt(s.offMs)}</div>
        </div>
        <button class="histBtn" data-idx="${idx}" aria-label="Delete">🗑</button>
      </div>
    `;
  }).join("");

  el.querySelectorAll(".histBtn").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const i = Number(btn.dataset.idx);
      const arr = loadSessions();
      arr.splice(i,1);
      saveSessions(arr);
      boot();
    });
  });
}

function exportCSV(){
  const arr = loadSessions();
  if (!arr.length){
    alert("No sessions to export.");
    return;
  }
  const header = ["endedAt","finalCCF","totalMs","compMs","offMs","pauseCount","longestPauseMs"].join(",");
  const rows = arr.map(s => [
    s.endedAt,
    s.finalCCF,
    s.totalMs,
    s.compMs,
    s.offMs,
    s.pauseCount,
    s.longestPauseMs
  ].join(","));
  const csv = [header, ...rows].join("\n");
  downloadText("ccf_sessions.csv", csv);
}

function boot(){
  const sessions = loadSessions();
  document.getElementById("reportCount").textContent = `${sessions.length} saved`;
  renderLatest(sessions[0]);
  renderHistory(sessions);
}

document.getElementById("btnClear").addEventListener("click", ()=>{
  if (confirm("Clear all saved sessions?")){
    saveSessions([]);
    boot();
  }
});

document.getElementById("btnExport").addEventListener("click", exportCSV);

boot();
