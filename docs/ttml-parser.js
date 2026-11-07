(function(root){
  'use strict';
  function time(value){
    const s=String(value||'').trim(); let m=s.match(/^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/);
    if(m){if(Number(m[2])>=60||Number(m[3])>=60)return null;return Number(m[1])*3600+Number(m[2])*60+Number(m[3]);}
    m=s.match(/^(\d+):(\d{2}(?:\.\d+)?)$/);
    if(m){if(Number(m[2])>=60)return null;return Number(m[1])*60+Number(m[2]);}
    m=s.match(/^(\d+(?:\.\d+)?)(ms|s)$/);if(m)return Number(m[1])/(m[2]==='ms'?1000:1);
    return null;
  }
  function parseDocument(doc){
    if(!doc||doc.querySelector('parsererror'))return {lines:[]};
    const lines=[],timed=[];let complete=true;
    for(const p of Array.from(doc.getElementsByTagName('*')).filter(e=>e.localName==='p')){
      const text=String(p.textContent||'').trim();if(!text)continue;
      lines.push(text);const t=time(p.getAttribute('begin'));
      if(t===null)complete=false;else timed.push({time:t,text});
    }
    if(!complete||!timed.length)return {lines};
    timed.sort((a,b)=>a.time-b.time);return {lines:timed.map(x=>x.text),timedLyrics:timed};
  }
  function parse(raw){return parseDocument(new DOMParser().parseFromString(String(raw||''),'application/xml'));}
  const api={time,parseDocument,parse};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.TtmlParser=api;
})(typeof window!=='undefined'?window:globalThis);
