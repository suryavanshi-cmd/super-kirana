// GET /try — a small test page for phones (demo shop only). Not part of the Super Kirana app.
// Hold the mic, speak one entry, see the draft JSON + timings. Signs in with the DEMO code only.
export const TRY_PAGE = `<!doctype html><html lang="mr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Voice entry test</title>
<style>
:root{--o:#c2570c;--ink:#121826;--mut:#4a5263}*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,sans-serif;color:var(--ink);background:#f2f4f8}
main{max-width:520px;margin:auto;padding:16px}h1{font-size:18px;margin:4px 0 12px}.card{background:#fff;border-radius:16px;padding:14px;margin-bottom:12px;box-shadow:0 1px 3px #0002}
input{width:100%;font:inherit;padding:10px 12px;border:1px solid #9aa3b2;border-radius:10px}button{font:inherit;font-weight:700;border:0;border-radius:12px;padding:12px 16px;background:var(--o);color:#fff}
#mic{display:block;width:140px;height:140px;border-radius:50%;margin:8px auto;font-size:15px;touch-action:none;user-select:none;-webkit-user-select:none}
#mic.rec{background:#c62828;animation:p 1s infinite}@keyframes p{50%{transform:scale(1.05)}}pre{white-space:pre-wrap;word-break:break-word;font-size:12px;background:#0f172a;color:#e2e8f0;padding:10px;border-radius:10px;max-height:50vh;overflow:auto}
.mut{color:var(--mut);font-size:13px}.err{color:#b91c1c;font-weight:600}.row{display:flex;gap:8px}.row input{flex:1}
</style></head><body><main>
<h1>आवाज नोंद चाचणी · Voice entry test (demo shop)</h1>
<div class="card" id="login"><p class="mut">Demo code टाका (फक्त डेमो दुकान).</p><div class="row"><input id="code" type="password" autocomplete="off" placeholder="Demo code"><button id="go">Start</button></div><p id="lerr" class="err"></p></div>
<div class="card" id="talk" hidden>
<p><b>कसे बोलायचे:</b> नाव → रक्कम → वस्तू → घेतले/दिले. एका वेळी एकच नोंद.<br><span class="mut">उदा. "रमेश पाटील दोनशे पन्नास रुपये साखर घेतले" · "सुनीता ताई पन्नास रुपये दिले"</span></p>
<button id="mic">धरून ठेवा आणि बोला<br><small>Hold &amp; speak</small></button>
<p id="st" class="mut" style="text-align:center"></p><pre id="out" hidden></pre></div>
<script>
const $=id=>document.getElementById(id);let jwt='',rec=null,chunks=[],stream=null,t0=0,stopT=null;
$('go').onclick=async()=>{ $('lerr').textContent='';try{const r=await fetch('/try/demo-login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:$('code').value})});const j=await r.json();if(!r.ok)throw new Error(j.error?.message||r.status);jwt=j.access_token;$('login').hidden=true;$('talk').hidden=false;fetch('/healthz')}catch(e){$('lerr').textContent=e.message}};
const mime=['audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/mp4'].find(m=>window.MediaRecorder&&MediaRecorder.isTypeSupported(m))||'';
async function start(e){e.preventDefault();if(rec)return;$('out').hidden=true;try{stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1,sampleRate:16000}})}catch(err){$('st').textContent='Mic blocked: '+err.message;return}
 rec=new MediaRecorder(stream,mime?{mimeType:mime,audioBitsPerSecond:32000}:undefined);chunks=[];rec.ondataavailable=ev=>chunks.push(ev.data);rec.onstop=send;rec.start();t0=performance.now();$('mic').classList.add('rec');$('st').textContent='ऐकत आहे… listening';
 const ctx=new AudioContext(),src=ctx.createMediaStreamSource(stream),an=ctx.createAnalyser();an.fftSize=512;src.connect(an);const buf=new Float32Array(an.fftSize);let lastVoice=performance.now(),heard=false;
 (function loop(){if(!rec||rec.state!=='recording'){ctx.close();return}an.getFloatTimeDomainData(buf);let s=0;for(const v of buf)s+=v*v;const rms=Math.sqrt(s/buf.length);if(rms>0.02){lastVoice=performance.now();heard=true}
  const now=performance.now();if(now-t0>8000||(heard&&now-lastVoice>1200))stop();else requestAnimationFrame(loop)})();}
function stop(){if(rec&&rec.state==='recording'){rec.stop();stream.getTracks().forEach(t=>t.stop());$('mic').classList.remove('rec')}}
async function send(){const ms=performance.now()-t0,blob=new Blob(chunks,{type:rec.mimeType||mime});rec=null;if(ms<600){$('st').textContent='खूप छोटे — बटण धरून बोला (too short)';return}
 $('st').textContent='पाठवत आहे… sending '+Math.round(blob.size/1024)+' KB';const f=new FormData();f.append('audio',blob,'clip');const c0=performance.now();
 try{const r=await fetch('/v1/voice-entry',{method:'POST',headers:{authorization:'Bearer '+jwt},body:f});const j=await r.json();$('out').hidden=false;$('out').textContent=JSON.stringify(j,null,2);
  $('st').innerHTML=r.ok?'✓ '+Math.round(performance.now()-c0)+' ms round trip · server '+j.timings_ms.total+' ms (STT '+j.timings_ms.stt+' ms)':'<span class="err">'+(j.error?.message_mr||'')+'<br>'+(j.error?.message||r.status)+' · ref '+j.request_id+'</span>'}catch(e){$('st').textContent='Network: '+e.message}}
const m=$('mic');m.addEventListener('pointerdown',start);m.addEventListener('pointerup',stop);m.addEventListener('pointerleave',stop);m.addEventListener('contextmenu',e=>e.preventDefault());
</script></main></body></html>`;
