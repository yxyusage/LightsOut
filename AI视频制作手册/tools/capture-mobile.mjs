// 手机端真实界面（390x844，3x）— 第 06 支"三端"用
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT=9436, BASE='http://127.0.0.1:8123', W=390, H=844, DPR=3;
const OUT=path.resolve('assets/ui-master');
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const getJSON=async(u)=>(await fetch(u)).json();
const SHOTS=[{n:'m-home',r:'/#/',w:2600},{n:'m-note',r:'/#/note/2',w:3200},{n:'m-review',r:'/#/review',w:2600},{n:'m-stats',r:'/#/stats',w:3200}];
class CDP{constructor(ws){this.ws=ws;this.id=0;this.p=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&this.p.has(m.id)){const{resolve,reject}=this.p.get(m.id);this.p.delete(m.id);m.error?reject(new Error(JSON.stringify(m.error))):resolve(m.result);}});}
send(method,params={}){const id=++this.id;this.ws.send(JSON.stringify({id,method,params}));return new Promise((res,rej)=>this.p.set(id,{resolve:res,reject:rej}));}
static async connect(u){const ws=new WebSocket(u);await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true});});return new CDP(ws);}}
const prof=`/tmp/blm-${PORT}`; rmSync(prof,{recursive:true,force:true}); mkdirSync(OUT,{recursive:true});
const ch=spawn(CHROME,[`--remote-debugging-port=${PORT}`,'--headless','--disable-gpu','--no-sandbox','--hide-scrollbars',`--user-data-dir=${prof}`,`--window-size=${W},${H}`,'about:blank'],{stdio:'ignore'});
let cdp;
try{
  for(let i=0;i<120;i++){try{await getJSON(`http://127.0.0.1:${PORT}/json/version`);break;}catch{await sleep(250);}}
  const r=await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(BASE+'/')}`,{method:'PUT'});
  cdp=await CDP.connect((await r.json()).webSocketDebuggerUrl);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:W,height:H,deviceScaleFactor:DPR,mobile:true});
  await cdp.send('Runtime.evaluate',{expression:`localStorage.setItem('bililearn-theme','light');localStorage.setItem('bililearn-palette','paper');true`});
  let n=0;
  for(const s of SHOTS){
    const hash=s.r.slice(1);
    await cdp.send('Page.navigate',{url:`${BASE}/?m=${++n}${hash}`});
    await sleep(s.w);
    const shot=await cdp.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});
    writeFileSync(path.join(OUT,`${s.n}.png`),Buffer.from(shot.data,'base64'));
    console.log('  '+s.n);
  }
}finally{try{cdp?.ws.close();}catch{} ch.kill('SIGKILL');}
