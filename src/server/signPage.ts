// Page publique de signature à distance (aucun compte requis) : le client
// consulte le document, signe au doigt ou à la souris et valide.

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export function signPageHtml(opts: { company: any; doc: any; docHtml: string; state: 'ok' | 'signed' | 'expired'; token: string }) {
  const { company, doc, docHtml, state, token } = opts
  const color = /^#[0-9a-fA-F]{6}$/.test(company.doc_color ?? '') ? company.doc_color : '#1d6fd6'
  const title = `${esc(doc.number)} — ${esc(company.name)}`
  const message =
    state === 'signed'
      ? `<div class="done"><svg viewBox="0 0 52 52" class="check"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-16"/></svg><h2>Document signé</h2><p>Ce document a déjà été signé. Merci !</p></div>`
      : state === 'expired'
        ? `<div class="done"><h2>Lien expiré</h2><p>Ce lien de signature n'est plus valable. Demandez un nouveau lien à ${esc(company.name)}.</p></div>`
        : ''
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Signature — ${title}</title>
<style>
  :root { --c: ${color}; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; background: #f6f7fb; color: #2f2b3d; }
  header { background: #2f3349; color: #fff; padding: 16px 20px; display: flex; align-items: center; gap: 12px; }
  header .logo { width: 40px; height: 40px; border-radius: 8px; background: #fff; object-fit: contain; }
  header small { display: block; opacity: .75; }
  .weave { height: 5px; background: repeating-linear-gradient(90deg,#0b4f8a 0 12px,#e2a81f 12px 17px,#f4f6fa 17px 18px,#178a55 18px 22px,#2f6db3 22px 33px); }
  main { max-width: 980px; margin: 0 auto; padding: 20px 16px 40px; display: grid; gap: 18px; }
  .card { background: #fff; border-radius: 12px; box-shadow: 0 3px 12px rgba(47,43,61,.1); padding: 18px; }
  iframe { width: 100%; height: 70vh; border: 1px solid #e6e6ec; border-radius: 8px; background: #fff; }
  h1 { font-size: 20px; margin: 0 0 4px; } h2 { margin: 6px 0; }
  .muted { color: #6d6b77; font-size: 14px; }
  label { display: block; font-weight: 600; font-size: 13px; margin: 12px 0 6px; }
  input { width: 100%; font: inherit; font-size: 16px; padding: 11px 12px; border: 1px solid #8b8a99; border-radius: 6px; }
  .pad { position: relative; border: 2px dashed #c9c8d3; border-radius: 10px; background: #fbfbfd; touch-action: none; }
  .pad canvas { display: block; width: 100%; height: 200px; cursor: crosshair; }
  .pad span { position: absolute; left: 16px; bottom: 12px; color: #9a99a8; font-size: 13px; pointer-events: none; }
  .row { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 14px; }
  button { font: inherit; font-weight: 600; height: 46px; padding: 0 22px; border-radius: 8px; border: 1px solid #d2d3dc; background: #fff; cursor: pointer; }
  button.primary { background: var(--c); border-color: var(--c); color: #fff; box-shadow: 0 4px 12px color-mix(in srgb, var(--c) 40%, transparent); flex: 1; }
  button:disabled { opacity: .5; cursor: default; }
  .err { color: #b8321f; font-weight: 600; min-height: 20px; margin-top: 8px; }
  .legal { font-size: 12px; color: #6d6b77; margin-top: 10px; }
  .done { text-align: center; padding: 30px 10px; }
  .check { width: 72px; height: 72px; }
  .check circle { fill: none; stroke: #28c76f; stroke-width: 3; stroke-dasharray: 160; stroke-dashoffset: 160; animation: draw .6s ease-out forwards; }
  .check path { fill: none; stroke: #28c76f; stroke-width: 4; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 40; stroke-dashoffset: 40; animation: draw .4s .5s ease-out forwards; }
  @keyframes draw { to { stroke-dashoffset: 0; } }
  @media (prefers-reduced-motion: reduce) { .check * { animation: none; stroke-dashoffset: 0; } }
</style></head>
<body>
<header>${company.logo ? `<img class="logo" src="${company.logo}" alt="">` : ''}<div><strong>${esc(company.name)}</strong><small>Signature électronique sécurisée</small></div></header>
<div class="weave"></div>
<main>
  <section class="card"><h1>${esc(doc.typeLabel)} ${esc(doc.number)}</h1><p class="muted">Montant : <strong>${esc(doc.amount)}</strong> · Pour : ${esc(doc.party?.name)}</p>
    <iframe title="Document à signer" sandbox srcdoc="${esc(docHtml)}"></iframe></section>
  <section class="card" id="zone">
    ${message || `<h2>Signer le document</h2>
    <p class="muted">En signant, vous acceptez ce document dans son intégralité.</p>
    <label for="name">Nom et prénom du signataire</label>
    <input id="name" autocomplete="name" placeholder="Ex. Aminata Ouédraogo">
    <label>Signature</label>
    <div class="pad"><canvas id="pad" aria-label="Zone de signature"></canvas><span id="hint">Signez ici avec le doigt ou la souris</span></div>
    <div class="row"><button type="button" id="clear">Effacer</button><button type="button" class="primary" id="send">Signer et valider</button></div>
    <div class="err" id="err" role="alert"></div>
    <p class="legal">Votre nom, la date, l'adresse IP et une empreinte du document seront enregistrés comme preuve de signature.</p>`}
  </section>
</main>
${state === 'ok' ? `<script>
(function(){
  var c=document.getElementById('pad'),x=c.getContext('2d'),drawing=false,dirty=false,last=null;
  function size(){var r=c.getBoundingClientRect(),d=window.devicePixelRatio||1,img=dirty?c.toDataURL():null;c.width=r.width*d;c.height=r.height*d;x.scale(d,d);x.lineWidth=2.6;x.lineCap='round';x.lineJoin='round';x.strokeStyle='#1c2b4a';if(img){var i=new Image();i.onload=function(){x.drawImage(i,0,0,r.width,r.height)};i.src=img}}
  size();window.addEventListener('resize',size);
  function pos(e){var r=c.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}}
  c.addEventListener('pointerdown',function(e){drawing=true;last=pos(e);c.setPointerCapture(e.pointerId);document.getElementById('hint').style.display='none'});
  c.addEventListener('pointermove',function(e){if(!drawing)return;var p=pos(e);x.beginPath();x.moveTo(last.x,last.y);x.lineTo(p.x,p.y);x.stroke();last=p;dirty=true});
  ['pointerup','pointercancel','pointerleave'].forEach(function(t){c.addEventListener(t,function(){drawing=false})});
  document.getElementById('clear').onclick=function(){x.clearRect(0,0,c.width,c.height);dirty=false;document.getElementById('hint').style.display=''};
  document.getElementById('send').onclick=function(){
    var err=document.getElementById('err'),name=document.getElementById('name').value.trim(),b=this;
    if(name.length<2){err.textContent='Indiquez votre nom et prénom.';return}
    if(!dirty){err.textContent='Veuillez signer dans le cadre.';return}
    b.disabled=true;err.textContent='';
    fetch('/api/public/sign/${token}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name,image:c.toDataURL('image/png')})})
      .then(function(r){return r.json()}).then(function(r){
        if(!r.ok){err.textContent=r.error;b.disabled=false;return}
        document.getElementById('zone').innerHTML='<div class="done"><svg viewBox="0 0 52 52" class="check"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-16"/></svg><h2>Merci, document signé</h2><p class="muted">${esc(company.name)} a été informé de votre signature.</p></div>';
      }).catch(function(){err.textContent='Connexion impossible. Réessayez.';b.disabled=false});
  };
})();
</script>` : ''}
</body></html>`
}
