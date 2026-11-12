import React, { useRef, useEffect } from 'react';
import { WebView } from 'react-native-webview';

// Vraie carte OpenStreetMap (Leaflet dans une WebView locale : pas besoin de clé Google).
// L'appli envoie les positions ; la WebView anime les avions en continu.
const HTML = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>html,body,#m{height:100%;margin:0}.av{font-size:26px;line-height:26px;text-align:center;transition:transform 1s linear;filter:drop-shadow(0 1px 2px #0008)}
.av span{display:inline-block}.sel span{filter:drop-shadow(0 0 6px #ffb400)}
.bag{position:absolute;left:20px;top:-12px;background:#14508c;color:#fff;font:700 11px sans-serif;padding:2px 6px;border-radius:9px;white-space:nowrap}
.apt{background:#0b2a4a;border-radius:50%;width:10px;height:10px;border:2px solid #fff}
#e{position:absolute;z-index:999;top:50%;left:10%;right:10%;background:#fff;padding:10px;border-radius:8px;display:none;font:13px sans-serif}</style></head>
<body><div id="m"></div><div id="e">Carte indisponible : vérifiez la connexion internet.</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.min.js"></script>
<script>
function envoi(o){window.ReactNativeWebView.postMessage(JSON.stringify(o))}
if(!window.L){document.getElementById('e').style.display='block'}else{
var map=L.map('m',{zoomControl:true,attributionControl:true}).setView([-2,23],5);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,attribution:'© OpenStreetMap'}).addTo(map);
var mk={},ligne=null,apts=[],centre=true,suivi=null;
map.on('dragstart',function(){suivi=null});
window.maj=function(d){
  var vus={};
  d.avions.forEach(function(a){
    vus[a.id]=1;
    var html='<span style="transform:rotate('+(a.cap-45)+'deg)">✈️</span>'+(a.bag?'<div class="bag">🧳 '+a.bag+'</div>':'');
    var ic=L.divIcon({className:'av'+(a.sel?' sel':''),html:html,iconSize:[26,26],iconAnchor:[13,13]});
    if(!mk[a.id]){mk[a.id]=L.marker([a.lat,a.lon],{icon:ic}).addTo(map).on('click',function(){envoi({t:'vol',id:a.id})})}
    else{mk[a.id].setLatLng([a.lat,a.lon]);mk[a.id].setIcon(ic)}
  });
  Object.keys(mk).forEach(function(k){if(!vus[k]){map.removeLayer(mk[k]);delete mk[k]}});
  if(ligne){map.removeLayer(ligne);ligne=null}apts.forEach(function(x){map.removeLayer(x)});apts=[];
  if(d.trace){ligne=L.polyline(d.trace,{color:'#14508c',weight:2,dashArray:'6 6'}).addTo(map);
    d.trace.forEach(function(p){apts.push(L.marker(p,{icon:L.divIcon({className:'',html:'<div class="apt"></div>',iconSize:[10,10]})}).addTo(map))})}
  if(d.suivre){var a=d.avions.filter(function(x){return x.id===d.suivre})[0];if(a)map.panTo([a.lat,a.lon],{animate:true,duration:1})}
  if(d.cadrer&&d.trace){map.fitBounds(d.trace,{padding:[60,60]});}
};
document.addEventListener('message',function(e){try{window.maj(JSON.parse(e.data))}catch(x){}});
window.addEventListener('message',function(e){try{window.maj(JSON.parse(e.data))}catch(x){}});
}
</script></body></html>`;

export default function CarteOSM({ donnees, onVol, style }) {
  const ref = useRef(null);
  const pret = useRef(false);
  const dernier = useRef(donnees);
  const envoyer = (d) => ref.current?.injectJavaScript(`window.maj&&window.maj(${JSON.stringify(d)});true;`);
  useEffect(() => { dernier.current = donnees; if (pret.current && donnees) envoyer(donnees); }, [donnees]);
  return (
    <WebView ref={ref} style={style} originWhitelist={['*']} source={{ html: HTML, baseUrl: 'https://localhost/' }}
      javaScriptEnabled domStorageEnabled
      onLoadEnd={() => { pret.current = true; if (dernier.current) envoyer(dernier.current); }}
      onMessage={(e) => { try { const m = JSON.parse(e.nativeEvent.data); if (m.t === 'vol') onVol?.(m.id); } catch {} }} />
  );
}
