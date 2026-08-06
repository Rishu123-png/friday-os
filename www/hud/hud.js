// hud.js — small frontend that polls the backend and updates HUD
const backendBase = window.FRIDAY_BACKEND || "http://localhost:8000";
async function safeFetch(path){
  try{
    const res = await fetch(backendBase + path, {headers:{Authorization: 'Bearer demo-token'}});
    if(!res.ok) throw new Error('not-ok')
    return await res.json();
  }catch(e){return null}
}

function setText(id, v){const el=document.getElementById(id); if(el) el.textContent = v}

async function refresh(){
  // health
  const health = await safeFetch('/health');
  if(health){
    setText('ip', health.serverMode ? 'local' : '--');
    // model as module
    const modules = document.getElementById('modules');
    modules.innerHTML = '';
    ['Voice Engine','Vision Engine','Memory Engine','Automation','Notifications'].forEach((m,i)=>{
      const li = document.createElement('li');
      li.textContent = m;
      const d = document.createElement('span'); d.className='dot ok';
      if(i===1 && (!health.engines || health.engines.stt==='not-installed')) d.className='dot warn';
      li.appendChild(d);
      modules.appendChild(li);
    })
  }

  // memory (sample)
  const mem = await safeFetch('/v1/memory');
  if(mem){
    const ag = document.getElementById('agenda');
    ag.innerHTML = '';
    if(mem.notes && mem.notes.length){
      mem.notes.slice(0,3).forEach(n=>{ const li=document.createElement('li'); li.textContent = n; ag.appendChild(li) })
    }else{ ag.innerHTML = '<li>No events</li>' }
  }

  // fake telemetry (simulate connected)
  setText('cpu', Math.floor(10 + Math.random()*30) + '%');
  setText('ram', Math.floor(30 + Math.random()*50) + '%');
  setText('stor', Math.floor(45 + Math.random()*35) + '%');
  setText('dl', (50 + Math.floor(Math.random()*400)) + ' Mbps');
  setText('ul', (5 + Math.floor(Math.random()*80)) + ' Mbps');
  setText('ip', '192.168.1.' + (10+Math.floor(Math.random()*200)));

  // bluetooth list mock
  const bt = document.getElementById('bt-list'); bt.innerHTML='';
  ['OnePlus Nord Buds','Redmi Watch 3','realme Buds Air 3'].forEach(name=>{ const li=document.createElement('li'); li.textContent = name; bt.appendChild(li) })
}

// simple canvas waveform animation
function startWave(){
  const c = document.getElementById('wave');
  if(!c) return; const ctx = c.getContext('2d'); c.width = c.offsetWidth; c.height = c.offsetHeight;
  let t=0;
  function draw(){
    ctx.clearRect(0,0,c.width,c.height);
    ctx.beginPath();
    for(let x=0;x<c.width;x++){
      const y = c.height/2 + Math.sin((x*0.03)+t) * (c.height/3) * Math.abs(Math.cos(t*0.2));
      ctx.lineTo(x,y);
    }
    ctx.strokeStyle = 'rgba(100,200,255,0.9)'; ctx.lineWidth=2; ctx.stroke();
    t+=0.08; requestAnimationFrame(draw);
  }
  draw();
}

window.addEventListener('load', ()=>{
  refresh(); startWave();
  setInterval(refresh, 5000);
});
