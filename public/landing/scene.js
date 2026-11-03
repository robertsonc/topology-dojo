(()=>{
  document.documentElement.classList.add('js-active');
  const scene=document.getElementById('scene'),world=document.getElementById('world'),replay=document.getElementById('replay');
  const buttons=[...document.querySelectorAll('.step')];
  const head=document.getElementById('cap-top'),title=document.getElementById('cap-title'),sub=document.getElementById('cap-sub'),hud=document.getElementById('hud-state');
  const phases=[
    {head:'01 / DISCOVER',title:'The canvas is waiting.',sub:'From an idea to a visible system.',hud:'DISCOVERING'},
    {head:'02 / ASSEMBLE',title:'Every node finds its place.',sub:'Structure emerges. Complexity becomes legible.',hud:'COMPOSING'},
    {head:'03 / CONNECT',title:'Relationships become routes.',sub:'Links form. The architecture takes shape.',hud:'VALIDATING'},
    {head:'04 / LIVE FLOW',title:'Now watch the network breathe.',sub:'Every connection has a story to tell.',hud:'FLOW ACTIVE'}
  ];
  let phase=3,cycle=null,visible=true;
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  function setPhase(n){phase=(n+4)%4;const d=phases[phase];scene.dataset.phase=String(phase);head.textContent=d.head;title.textContent=d.title;sub.textContent=d.sub;hud.textContent=d.hud;buttons.forEach((b,i)=>{b.classList.toggle('on',i===phase);b.setAttribute('aria-pressed',i===phase?'true':'false')})}
  function syncMotion(){if(reduced.matches||!visible)world.pauseAnimations?.();else world.unpauseAnimations?.()}
  function stop(){if(cycle!==null){clearInterval(cycle);cycle=null}syncMotion()}
  function start(){stop();syncMotion();if(reduced.matches||!visible)return;cycle=setInterval(()=>setPhase(phase+1),4200)}
  function select(n){setPhase(n);start()}
  buttons.forEach((b)=>b.addEventListener('click',()=>select(Number(b.dataset.step))));
  replay.addEventListener('click',()=>{setPhase(reduced.matches?3:0);start()});
  document.addEventListener('visibilitychange',()=>{visible=!document.hidden;if(visible)start();else stop()});
  reduced.addEventListener?.('change',()=>{if(reduced.matches){stop();setPhase(3)}else{setPhase(0);start()}});
  if(reduced.matches||new URLSearchParams(location.search).has('poster')){setPhase(3);if(reduced.matches)world.pauseAnimations?.()}else{setPhase(0);start()}
  let tx=0,ty=0,raf=0;
  const visual=document.querySelector('.visual');
  visual.addEventListener('pointermove',e=>{if(reduced.matches||matchMedia('(pointer:coarse)').matches)return;const r=visual.getBoundingClientRect();tx=((e.clientX-r.left)/r.width-.5)*13;ty=((e.clientY-r.top)/r.height-.5)*9;if(!raf){raf=requestAnimationFrame(()=>{world.style.setProperty('--px',tx.toFixed(1)+'px');world.style.setProperty('--py',ty.toFixed(1)+'px');raf=0})}});
  visual.addEventListener('pointerleave',()=>{world.style.setProperty('--px','0px');world.style.setProperty('--py','0px')});
  if('IntersectionObserver' in window){new IntersectionObserver(([e])=>{visible=e.isIntersecting&&!document.hidden;if(visible)start();else stop()},{threshold:.08}).observe(scene)}
})();