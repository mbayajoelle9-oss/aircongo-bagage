import React, { useRef, useEffect } from 'react';
import { WebView } from 'react-native-webview';

// Carte du monde réelle (tuiles OpenStreetMap / CARTO), dessinée par notre propre code dans une WebView :
// aucune bibliothèque externe à charger, donc rien qui puisse bloquer. Avions animés, trajectoires, aéroports.
const HTML = String.raw`<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
html,body{margin:0;height:100%;overflow:hidden;background:#cfe0ee;font-family:sans-serif;-webkit-user-select:none;user-select:none}
#c{position:absolute;left:0;top:0;right:0;bottom:0;touch-action:none;overflow:hidden;background:#cfe0ee}
.tl{position:absolute;width:256px;height:256px;max-width:none}
#s{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none}
.mk{position:absolute;left:0;top:0;width:0;height:0}
.pl{position:absolute;left:-22px;top:-22px;width:44px;height:44px}
.pl .cap{position:absolute;left:0;top:0;width:44px;height:44px}
.pl svg{width:40px;height:40px;margin:2px;filter:drop-shadow(0 3px 3px rgba(0,0,0,.45))}
.pl.vol:before{content:"";position:absolute;left:6px;top:6px;right:6px;bottom:6px;border-radius:50%;background:rgba(31,157,85,.3);animation:onde 2.2s ease-out infinite}
.pl.sel:before{background:rgba(246,194,28,.55)}
@keyframes onde{0%{transform:scale(.6);opacity:.9}100%{transform:scale(1.8);opacity:0}}
.et{position:absolute;left:50%;top:42px;transform:translateX(-50%);background:rgba(7,29,54,.92);color:#fff;font:700 10px monospace;padding:3px 6px;border-radius:6px;white-space:nowrap}
.pl.sel .et{background:#f6c21c;color:#0b2a4a}
.bag{position:absolute;left:24px;top:-18px;background:#14508c;color:#fff;font:700 11px sans-serif;padding:3px 7px;border-radius:10px;white-space:nowrap;border:2px solid #fff}
.ap{position:absolute;left:-6px;top:-6px;width:12px;height:12px;border-radius:50%;background:#fff;border:3px solid #0b2a4a;box-sizing:content-box;margin:-3px 0 0 -3px}
.apl{position:absolute;left:-18px;top:9px;width:36px;text-align:center;font:800 10px monospace;color:#0b2a4a;background:rgba(255,255,255,.92);border-radius:4px;padding:2px 0}
#z{position:absolute;right:10px;bottom:28px;display:flex;flex-direction:column;gap:6px;z-index:5}
#z button{width:40px;height:40px;border:0;border-radius:10px;background:#fff;font:700 22px sans-serif;color:#0b2a4a;box-shadow:0 2px 8px rgba(0,0,0,.3)}
#att{position:absolute;left:6px;bottom:4px;font:10px sans-serif;color:#33475b;background:rgba(255,255,255,.75);padding:1px 5px;border-radius:4px}
#dg{position:absolute;left:10px;right:10px;top:10px;background:#fff3cd;color:#7a5200;padding:8px 10px;border-radius:8px;font:12px sans-serif;display:none;z-index:6}
</style></head><body>
<div id="c"><div id="t"></div><svg id="s"></svg><div id="m"></div></div>
<div id="dg">Fond de carte indisponible (réseau). Les avions et trajectoires restent affichés.</div>
<div id="z"><button id="zp">+</button><button id="zm">−</button></div>
<div id="att">© OpenStreetMap · Esri</div>
<script>
var TS=256,W=300,H=300,V={lat:-4,lon:22,z:4},D={vols:[],aeroports:[],sel:null,suivre:null},CL={acc:1,sim:0,reel:0},tiles={},mk={},apm={},ok=0,ko=0,moved=0,lastView='',lastSuivre=null;
var T=document.getElementById('t'),M=document.getElementById('m'),S=document.getElementById('s'),C=document.getElementById('c');
var RAD=Math.PI/180,DEG=180/Math.PI;
function envoi(o){window.ReactNativeWebView.postMessage(JSON.stringify(o))}
function proj(lat,lon,z){var s=TS*Math.pow(2,z),sn=Math.sin(lat*RAD);return [(lon+180)/360*s,(0.5-Math.log((1+sn)/(1-sn))/(4*Math.PI))*s]}
function unproj(x,y,z){var s=TS*Math.pow(2,z),n=Math.PI-2*Math.PI*y/s;return [DEG*Math.atan(0.5*(Math.exp(n)-Math.exp(-n))),x/s*360-180]}
function size(){W=C.clientWidth||300;H=C.clientHeight||300}
var CV=[0,0];
function px(lat,lon){var p=proj(lat,lon,V.z);return [p[0]-CV[0]+W/2,p[1]-CV[1]+H/2]}
/* trajectoire : grand cercle */
function interp(a,b,f){
  var d=Math.acos(Math.min(1,Math.max(-1,Math.sin(a[0]*RAD)*Math.sin(b[0]*RAD)+Math.cos(a[0]*RAD)*Math.cos(b[0]*RAD)*Math.cos((b[1]-a[1])*RAD))));
  if(d<1e-9)return [a[0],a[1]];
  var A=Math.sin((1-f)*d)/Math.sin(d),B=Math.sin(f*d)/Math.sin(d);
  var x=A*Math.cos(a[0]*RAD)*Math.cos(a[1]*RAD)+B*Math.cos(b[0]*RAD)*Math.cos(b[1]*RAD);
  var y=A*Math.cos(a[0]*RAD)*Math.sin(a[1]*RAD)+B*Math.cos(b[0]*RAD)*Math.sin(b[1]*RAD);
  var z=A*Math.sin(a[0]*RAD)+B*Math.sin(b[0]*RAD);
  return [DEG*Math.atan2(z,Math.hypot(x,y)),DEG*Math.atan2(y,x)];
}
function brg(p,q){var dl=(q[1]-p[1])*RAD,y=Math.sin(dl)*Math.cos(q[0]*RAD),x=Math.cos(p[0]*RAD)*Math.sin(q[0]*RAD)-Math.sin(p[0]*RAD)*Math.cos(q[0]*RAD)*Math.cos(dl);return (DEG*Math.atan2(y,x)+360)%360}
function arc(a,b,f0,f1){var n=Math.max(2,Math.ceil(70*(f1-f0))+1),o=[];for(var i=0;i<=n;i++)o.push(interp(a,b,f0+(f1-f0)*i/n));return o}
function now(){var t=Date.now();return CL.acc>1?CL.sim+(t-CL.reel)*CL.acc:t}
function etat(v,t){
  var f,ph;
  if(!v.dep||!v.arr||v.fixe){f=v.f;ph=v.phase}
  else{f=t<v.dep?0:t>=v.arr?1:Math.min(0.97,Math.max(0.03,(t-v.dep)/(v.arr-v.dep)));ph=t<v.dep?'AU_SOL':t>=v.arr?'ARRIVE':'EN_VOL'}
  var f0=Math.min(Math.max(f,0),0.99);
  return {f:f,ph:ph,pos:interp(v.A,v.B,f),cap:brg(interp(v.A,v.B,f0),interp(v.A,v.B,f0+0.01))};
}
var COUL={EN_VOL:'#1f9d55',AU_SOL:'#1c8fd0',ARRIVE:'#8a97a8',ANNULE:'#d9302c'};
/* fond de carte : OpenStreetMap, puis Esri en secours */
var SRC=[function(z,x,y){return 'https://tile.openstreetmap.org/'+z+'/'+x+'/'+y+'.png'},function(z,x,y){return 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/'+z+'/'+y+'/'+x}];
function tiles_(){
  var n=Math.pow(2,V.z),need={};
  var x0=Math.floor((CV[0]-W/2)/TS),x1=Math.floor((CV[0]+W/2)/TS),y0=Math.floor((CV[1]-H/2)/TS),y1=Math.floor((CV[1]+H/2)/TS);
  for(var x=x0;x<=x1;x++)for(var y=y0;y<=y1;y++){
    if(y<0||y>=n)continue;
    var k=V.z+'/'+x+'/'+y;need[k]=1;var im=tiles[k];
    if(!im){im=new Image();im.className='tl';im.draggable=false;im._t=0;
      (function(im,xx,y,z){im._u=function(){im.src=SRC[im._t](z,xx,y)};im.onload=function(){ok++;document.getElementById('dg').style.display='none'};im.onerror=function(){if(im._t<SRC.length-1){im._t++;im._u()}else{ko++;if(ko>4&&ok===0)document.getElementById('dg').style.display='block'}}})(im,((x%n)+n)%n,y,V.z);
      im._u();T.appendChild(im);tiles[k]=im}
    im.style.left=Math.round(x*TS-CV[0]+W/2)+'px';im.style.top=Math.round(y*TS-CV[1]+H/2)+'px';
  }
  for(var k2 in tiles)if(!need[k2]){tiles[k2].remove();delete tiles[k2]}
}
var PLANE='<svg viewBox="0 0 32 32"><path d="M16 1.5c1.1 0 1.9 1.2 1.9 3v7.6l11.1 6.6v2.6l-11.1-3.1v6.2l3.2 2.5v2.1L16 27.9l-5.1 1.6v-2.1l3.2-2.5v-6.2L3 21.3v-2.6l11.1-6.6V4.5c0-1.8.8-3 1.9-3z" fill="COL" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>';
function path(pts,col,w,op,dash){var d='';pts.forEach(function(p,i){var q=px(p[0],p[1]);d+=(i?'L':'M')+q[0].toFixed(1)+' '+q[1].toFixed(1)});
  return '<path d="'+d+'" fill="none" stroke="'+col+'" stroke-width="'+w+'" stroke-opacity="'+op+'" stroke-linecap="round" stroke-linejoin="round"'+(dash?' stroke-dasharray="'+dash+'"':'')+'/>'}
function draw(pls){
  var h='',seen={};
  pls.forEach(function(o){
    var v=o.v,e=o.e,sel=v.id===D.sel,col=COUL[e.ph]||'#8a97a8';
    if(e.ph==='EN_VOL'||sel){
      var f=e.ph==='EN_VOL'?e.f:(e.ph==='ARRIVE'?1:0);
      if(f<1)h+=path(arc(v.A,v.B,f,1),sel?'#0b2a4a':col,sel?3:2,sel?.75:.4,sel?'8 8':'3 9');
      if(f>0){var tr=arc(v.A,v.B,0,f);tr[tr.length-1]=e.pos;h+=path(tr,col,sel?5:3,.95)}
    }
  });
  S.innerHTML=h;
  pls.forEach(function(o){
    var v=o.v,e=o.e,sel=v.id===D.sel,vol=e.ph==='EN_VOL',x=mk[v.id];seen[v.id]=1;
    if(!x){var d=document.createElement('div');d.className='mk';d.innerHTML='<div class="pl"><div class="cap"></div><div class="et"></div></div><div class="bag" style="display:none"></div>';
      d.onclick=function(){if(moved<8)envoi({t:'vol',id:v.id})};M.appendChild(d);x=mk[v.id]={d:d,pl:d.firstChild,cap:d.firstChild.firstChild,et:d.firstChild.childNodes[1],bag:d.lastChild,col:'',c:null}}
    var p=px(e.pos[0],e.pos[1]);x.d.style.transform='translate('+p[0].toFixed(1)+'px,'+p[1].toFixed(1)+'px)';x.d.style.zIndex=sel?30:(vol?20:10);
    var c=(vol?' vol':'')+(sel?' sel':'');if(x.c!==c){x.pl.className='pl'+c;x.c=c;x.et.style.display=(vol||sel)?'block':'none'}
    var col=COUL[e.ph]||'#8a97a8';if(x.col!==col){x.cap.innerHTML=PLANE.replace('COL',col);x.col=col}
    x.cap.style.transform='rotate('+e.cap.toFixed(1)+'deg)';
    if(x.num!==v.num){x.et.textContent=v.num;x.num=v.num}
    var bg=vol&&v.bag?'🧳 '+v.bag:'';if(x.b!==bg){x.bag.style.display=bg?'block':'none';x.bag.textContent=bg;x.b=bg}
  });
  for(var id in mk)if(!seen[id]){mk[id].d.remove();delete mk[id]}
  D.aeroports.forEach(function(a){
    var e=apm[a.c];if(!e){var d=document.createElement('div');d.className='mk';d.style.zIndex=5;d.innerHTML='<div class="ap"></div><div class="apl">'+a.c+'</div>';M.appendChild(d);e=apm[a.c]={d:d}}
    var p=px(a.lat,a.lon);e.d.style.transform='translate('+p[0].toFixed(1)+'px,'+p[1].toFixed(1)+'px)';
  });
  for(var c2 in apm)if(!D.aeroports.some(function(a){return a.c===c2})){apm[c2].d.remove();delete apm[c2]}
}
/* boucle d'animation : position recalculée à CHAQUE image (~60/s) = mouvement continu comme une vidéo */
function frame(){
  size();
  var t=now(),pls=D.vols.map(function(v){return {v:v,e:etat(v,t)}});
  if(D.suivre){pls.forEach(function(o){if(o.v.id===D.suivre&&o.e.ph==='EN_VOL'){V.lat=o.e.pos[0];V.lon=o.e.pos[1]}})}
  CV=proj(V.lat,V.lon,V.z);
  var vw=V.z+'|'+Math.round(CV[0])+'|'+Math.round(CV[1])+'|'+W+'|'+H;
  if(vw!==lastView){lastView=vw;tiles_()}
  draw(pls);
  requestAnimationFrame(frame);
}
function zoom(dz){var z=Math.max(3,Math.min(17,V.z+dz));if(z!==V.z)V.z=z}
function fit(pts){
  size();
  for(var z=12;z>=3;z--){var xs=[],ys=[];pts.forEach(function(p){var q=proj(p[0],p[1],z);xs.push(q[0]);ys.push(q[1])});
    var x0=Math.min.apply(0,xs),x1=Math.max.apply(0,xs),y0=Math.min.apply(0,ys),y1=Math.max.apply(0,ys);
    if(x1-x0<=W-110&&y1-y0<=H-110||z===3){V.z=z;var c=unproj((x0+x1)/2,(y0+y1)/2,z);V.lat=c[0];V.lon=c[1];return}}
}
window.maj=function(d){
  D.vols=d.vols;D.sel=d.sel;D.suivre=d.suivre;CL=d.clock;
  var ap={};d.vols.forEach(function(v){ap[v.dc]={c:v.dc,lat:v.A[0],lon:v.A[1]};ap[v.ac]={c:v.ac,lat:v.B[0],lon:v.B[1]}});
  D.aeroports=Object.keys(ap).map(function(k){return ap[k]});
  if(d.cadrer&&d.cadrer.length)fit(d.cadrer);
  if(d.suivre&&d.suivre!==lastSuivre&&V.z<9)V.z=10;
  lastSuivre=d.suivre;
};
var ptrs={},nb=0,d0=0;
function dist(){var k=Object.keys(ptrs);var a=ptrs[k[0]],b=ptrs[k[1]];return Math.hypot(a[0]-b[0],a[1]-b[1])}
C.addEventListener('pointerdown',function(e){ptrs[e.pointerId]=[e.clientX,e.clientY];nb=Object.keys(ptrs).length;moved=0;if(nb===2)d0=dist()});
C.addEventListener('pointermove',function(e){
  var p=ptrs[e.pointerId];if(!p)return;var dx=e.clientX-p[0],dy=e.clientY-p[1];ptrs[e.pointerId]=[e.clientX,e.clientY];
  if(nb===1){moved+=Math.abs(dx)+Math.abs(dy);if(moved>6){var n=unproj(CV[0]-dx,CV[1]-dy,V.z);V.lat=n[0];V.lon=n[1];if(D.suivre){D.suivre=null;envoi({t:'drag'})}}}
  else if(nb===2){moved=99;var d=dist();if(d0&&d/d0>1.5){zoom(1);d0=d}else if(d0&&d/d0<0.66){zoom(-1);d0=d}}
});
function fin(e){delete ptrs[e.pointerId];nb=Object.keys(ptrs).length}
C.addEventListener('pointerup',fin);C.addEventListener('pointercancel',fin);
document.getElementById('zp').onclick=function(){zoom(1)};document.getElementById('zm').onclick=function(){zoom(-1)};
requestAnimationFrame(frame);
envoi({t:'pret'});
</script></body></html>`;

export default function CarteOSM({ donnees, onVol, onDrag, style }) {
  const ref = useRef(null);
  const pret = useRef(false);
  const dernier = useRef(donnees);
  const envoyer = (d) => ref.current?.injectJavaScript(`window.maj&&window.maj(${JSON.stringify(d)});true;`);
  useEffect(() => { dernier.current = donnees; if (pret.current && donnees) envoyer(donnees); }, [donnees]);
  return (
    <WebView ref={ref} style={style} originWhitelist={['*']} source={{ html: HTML, baseUrl: 'https://localhost/' }}
      javaScriptEnabled domStorageEnabled mixedContentMode="always" overScrollMode="never" scrollEnabled={false}
      onMessage={(e) => {
        try {
          const m = JSON.parse(e.nativeEvent.data);
          if (m.t === 'pret') { pret.current = true; if (dernier.current) envoyer(dernier.current); }
          else if (m.t === 'vol') onVol?.(m.id);
          else if (m.t === 'drag') onDrag?.();
        } catch { /* ignoré */ }
      }} />
  );
}
