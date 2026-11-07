(function(root){
  'use strict';
  function parse(input){
    const raw=String(input||'').replace(/^\uFEFF/,''), rows=[], plain=[], problems=[];
    const offset=raw.match(/^\s*\[offset\s*:\s*([+-]?\d+)\s*\]/im);
    const shift=offset?Number(offset[1])/1000:0;
    const tag=/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
    const hasTime=/\[\d{1,3}:/.test(raw);
    for(const line of raw.split(/\r?\n/)){
      const s=line.trim(); if(!s)continue;
      if(/^(?:\s*\[(?:ti|ar|al|by|offset|re|ve|length):[^\]]*\]\s*)+$/i.test(s))continue;
      const marks=[...s.matchAll(tag)], remaining=s.replace(tag,'').trim();
      if(!hasTime){plain.push(s);continue;}
      if(!marks.length || /\[\d{1,3}:/.test(remaining) || marks.some(m=>Number(m[2])>=60)){problems.push(s);continue;}
      if(!remaining)continue;
      for(const m of marks)rows.push({time:Math.max(0,Number(m[1])*60+Number(m[2])+(m[3]?Number('0.'+m[3]):0)+shift),text:remaining});
    }
    if(!hasTime)return {kind:'plain',lines:plain};
    if(problems.length)return {kind:'lrc',error:'LRC 有未標記或格式錯誤的歌詞，請為每句加上 [分:秒.百分秒]；純文字請移除所有時間標記。',lines:[]};
    rows.sort((a,b)=>a.time-b.time);
    return {kind:'lrc',lines:rows.map(x=>x.text),timedLyrics:rows};
  }
  const api={parse};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LrcParser=api;
})(typeof window!=='undefined'?window:globalThis);
