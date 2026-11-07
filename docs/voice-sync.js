/* Continue displayed lyrics using a free, approximate original-song time line. */
(function(root){
  'use strict';
  function parseLrc(input){
    const raw=String(input||''), offsetMatch=raw.match(/^\s*\[offset\s*:\s*([+-]?\d+)\]/im), shift=offsetMatch?Number(offsetMatch[1])/1000:0, rows=[];
    for(const line of raw.split(/\r?\n/)){
      const marks=[...line.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
      const text=line.replace(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g,'').trim();if(!text)continue;
      for(const m of marks){const frac=m[3]?Number(`0.${m[3]}`):0;rows.push({time:Math.max(0,Number(m[1])*60+Number(m[2])+frac+shift),text});}
    }
    return rows.sort((a,b)=>a.time-b.time);
  }
  function lineAt(lines,seconds){let lo=0,hi=lines.length;while(lo<hi){const mid=(lo+hi)>>1;if(lines[mid].time<=seconds)lo=mid+1;else hi=mid;}return lo-1;}
  function isRepeated(last,key,now){return !!last&&last.key===key&&now-last.at<10000;}
  const exports={parseLrc,lineAt,isRepeated};if(typeof module!=='undefined'&&module.exports){module.exports=exports;return;}
  const byId=id=>document.getElementById(id);let generation=0,pending=null,loaded=null,timer=null,playing=false,userStopped=false;
  let basePosition=0,baseAt=0,shift=0,lastLine=-2,lastRecognition=null,pendingChoice=null;
  function status(s){byId('voiceFollowStatus').textContent=s;}
  function controls(on){['voiceFollowToggle','voiceFollowStop','voiceFollowEarlier','voiceFollowLater'].forEach(id=>byId(id).disabled=!on);}
  function position(now=Date.now()){const t=basePosition+(playing?Math.max(0,(now-baseAt)/1000):0);return loaded?.external?t:Math.max(0,t);}
  function render(force=false){
    if(!loaded)return;const p=position(),at=lineAt(loaded.timed,loaded.external?p+shift:Math.max(0,p+shift));
    if(at<0 && (lastLine!==-1||force)){
      focusLine(loaded.displaySong,0);
      byId('lyricsList').querySelector('.lyric-line.active')?.classList.remove('active');
      currentLine=-1;lastLine=-1;
    }
    if(at>=0&&(at!==lastLine||force)){focusLine(loaded.displaySong,at);lastLine=at;}
    const name=loaded.displaySong.name,shown=Math.max(0,p);status(`${playing?'依原曲節奏跟隨':'已暫停'} · ${name} · ${Math.floor(shown/60)}:${String(Math.floor(shown%60)).padStart(2,'0')}；實際演唱速度可能不同`);
  }
  function stop(message,manual=true){
    generation++;if(pending){pending.abort();pending=null;}if(timer){clearInterval(timer);timer=null;}
    loaded=null;pendingChoice=null;playing=false;lastLine=-2;lastRecognition=null;userStopped=manual;controls(false);byId('voiceFollowToggle').textContent='暫停跟隨';
    status(message||'已停止跟隨；選擇歌詞可再次開始。');
  }
  function identify(song){
    const parts=String(song.name||'').split(' · '), title=parts.shift().trim(), artist=String(song.artist||parts.join(' · ')||'').trim();
    return {title,artist};
  }
  function same(a,b){a=normalize(a);b=normalize(b);return !!a&&!!b&&(a===b||(Math.min(a.length,b.length)>=3&&(a.includes(b)||b.includes(a))))}
  function matchLine(song,index,timed,near){
    const target=normalize(song.lines[index]||'');if(target.length<2)return null;let scored=[];
    for(let i=0;i<timed.length;i++){const candidate=normalize(timed[i].text);if(candidate.length<2)continue;const score=similarity(target,candidate);if(score>=.72)scored.push({index:i,score,time:timed[i].time});}
    if(!scored.length)return null;const max=Math.max(...scored.map(x=>x.score));scored=scored.filter(x=>x.score>=max-.03);
    if(Number.isFinite(near))scored.sort((a,b)=>Math.abs(a.time-near)-Math.abs(b.time-near)||a.index-b.index);else scored.sort((a,b)=>a.index-b.index);
    return scored[0];
  }
  function apply(song,index,manual){
    if(!loaded||loaded.key!==song.id)return;
    if(!playing&&!manual)return;
    const now=Date.now(),near=lastLine>=0?position(now):null,match=manual && loaded.isLocal && song.timedLyrics && song.timedLyrics[index] ? {index,time:loaded.timed[index].time} : matchLine(song,index,loaded.timed,near);
    if(!match){status('找不到這句的同步時間；請選擇歌詞手動定位。');return;}
    const phrase=normalize(song.lines[index]||''), key=`${song.id}|${phrase}`;
    if(!manual&&isRepeated(lastRecognition,key,now))return;
    if(!manual&&Number.isFinite(near)&&match.time<near-5)return;
    lastRecognition={key,at:now};
    if(manual||!Number.isFinite(near)||Math.abs(match.time-near)>2){basePosition=match.time;baseAt=now;lastLine=-2;}
    if(!timer)timer=setInterval(render,500);render(true);
  }
  async function align(song,index,{manual=false}={}){
    if(!song||!Array.isArray(song.lines)||!song.lines[index])return;
    if(manual)userStopped=false;
    if(userStopped){focusLine(song,index);return;}
    if(loaded&&loaded.key===song.id){if(manual)apply(song,index,true);return;}
    if(pendingChoice&&pendingChoice.song.id===song.id){pendingChoice={song,index,manual};return;}
    generation++;const run=generation;if(pending)pending.abort();if(timer){clearInterval(timer);timer=null;}
    loaded=null;playing=false;lastLine=-2;lastRecognition=null;controls(false);focusLine(song,index);
    const phoneLocal=/Android|iPhone|iPad/i.test(root.navigator?.userAgent||'')||!!root.matchMedia?.('(max-width: 760px)').matches;
    // Old Unison collections may contain text only. Refresh that exact source before
    // falling back to another provider, without replacing any saved user lyrics.
    if(!phoneLocal&&!song.timedLyrics&&!song.sourceTimedLyrics&&!song.cachedTimedLyrics&&song.source==='Unison'&&String(song.id).startsWith('online-')){
      pendingChoice={song,index,manual};const controller=new AbortController();pending=controller;
      const timeout=setTimeout(()=>controller.abort(),12000);status('正在取得這首歌原始版本的同步時間…');
      try{
        const res=await fetch(`https://unison.betterlyrics.org/lyrics/${encodeURIComponent(String(song.id).slice(7))}`,{signal:controller.signal});
        if(!res.ok)throw Error('source');const body=await res.json(),data=body.data||{};
        const parsed=parseLyricData(String(data.lyrics||''),String(data.format||''));
        if(run!==generation)return;
        if(parsed.timedLyrics&&parsed.timedLyrics.length){const saved=songs.find(x=>x.id===song.id);if(saved){saved.sourceTimedLyrics=parsed.timedLyrics;saveSongs();}song.sourceTimedLyrics=parsed.timedLyrics;}
      }catch(e){if(run!==generation)return;}
      finally{clearTimeout(timeout);if(pending===controller)pending=null;}
      if(run!==generation)return;
      if(pendingChoice){song=pendingChoice.song;index=pendingChoice.index;manual=pendingChoice.manual;pendingChoice=null;}
    }
    const ownTimed=Array.isArray(song.timedLyrics)?song.timedLyrics:null;
    const sourceTimed=Array.isArray(song.sourceTimedLyrics)?song.sourceTimedLyrics:null;
    const cached=Array.isArray(song.cachedTimedLyrics)?song.cachedTimedLyrics:null;
    const available=ownTimed||sourceTimed||cached;
    if(available&&available.length&&available.every(x=>x&&Number.isFinite(x.time)&&typeof x.text==='string')){
      const match=ownTimed&&ownTimed[index]?{index,time:ownTimed[index].time}:matchLine(song,index,available,null);
      if(match){shift=0;byId('voiceFollowOffset').textContent='0 秒';loaded={key:song.id,timed:available,isLocal:true,displaySong:ownTimed?song:{...song,lines:available.map(x=>x.text),timedLyrics:available,...(!sourceTimed&&cached?{source:'LRCLIB',sourceId:undefined}:{})}};
        playing=true;controls(true);byId('voiceFollowToggle').textContent='暫停跟隨';basePosition=match.time;baseAt=Date.now();lastLine=-2;
        timer=setInterval(render,500);render(true);return;}
    }
    if(phoneLocal){status('本機歌詞沒有相符的同步時間，請稍後再試。');return;}
    if(song.demo){status('示範歌詞沒有同步時間，可點選句子手動定位。');return;}
    const meta=identify(song);if(!meta.title){status('沒有歌曲名稱，無法查詢同步歌詞；可手動選句。');return;}
    pendingChoice={song,index,manual};const controller=new AbortController();pending=controller;const timeout=setTimeout(()=>controller.abort(),12000);
    status(`正在尋找 ${meta.title} 的同步歌詞…`);
    try{
      const params=new URLSearchParams({track_name:meta.title});if(meta.artist)params.set('artist_name',meta.artist);
      const response=await fetch(`https://lrclib.net/api/search?${params}`,{signal:controller.signal});if(!response.ok)throw Error('search');
      const body=await response.json();if(run!==generation)return;
      const candidates=Array.isArray(body)?body.filter(x=>x&&x.syncedLyrics&&same(x.trackName,meta.title)&&(!meta.artist||same(x.artistName,meta.artist))):[];
      let selected=null;
      for(const item of candidates){const timed=parseLrc(item.syncedLyrics),match=matchLine(pendingChoice.song,pendingChoice.index,timed,null);if(match&&(!selected||match.score>selected.match.score))selected={item,timed,match};}
      if(!selected){pending=null;pendingChoice=null;status('找不到這首歌的同步歌詞；目前可以手動選句。');return;}
      const choice=pendingChoice;pendingChoice=null;pending=null;const saved=songs.find(x=>x.id===song.id);if(saved){saved.cachedTimedLyrics=selected.timed;saveSongs();}shift=0;byId('voiceFollowOffset').textContent='0 秒';
      loaded={key:song.id,timed:selected.timed,isLocal:true,displaySong:{id:song.id,name:song.name,lines:selected.timed.map(x=>x.text),timedLyrics:selected.timed,source:'LRCLIB'}};
      playing=true;controls(true);byId('voiceFollowToggle').textContent='暫停跟隨';basePosition=selected.match.time;baseAt=Date.now();lastLine=-2;lastRecognition={key:`${song.id}|${normalize(choice.song.lines[choice.index]||'')}`,at:Date.now()};
      if(timer)clearInterval(timer);timer=setInterval(render,500);render(true);
    }catch(e){if(run===generation){pending=null;pendingChoice=null;status('同步歌詞暫時無法取得；目前可以手動選句。');}}
    finally{clearTimeout(timeout);if(pending===controller)pending=null;}
  }
  function toggle(){if(!loaded)return;if(loaded.external&&root.YTIntegration?.togglePlayback?.())return;if(playing){basePosition=position();playing=false;byId('voiceFollowToggle').textContent='繼續跟隨';}else{baseAt=Date.now();playing=true;byId('voiceFollowToggle').textContent='暫停跟隨';}render();}
  function startFromBeginning(song){
    if(!song){status('請先選擇歌曲。');return false;}
    if(song.referenceOnly){status('這個版本只有原曲歌詞參考，無法從頭同步。');return false;}
    const own=Array.isArray(song.timedLyrics)&&song.timedLyrics.length?song.timedLyrics:null;
    const timed=own || (Array.isArray(song.sourceTimedLyrics)&&song.sourceTimedLyrics.length?song.sourceTimedLyrics:null) || (Array.isArray(song.cachedTimedLyrics)&&song.cachedTimedLyrics.length?song.cachedTimedLyrics:null);
    if(!timed||!timed.every(x=>x&&Number.isFinite(x.time)&&typeof x.text==='string')){status('這首歌沒有可用的同步時間，請手動點選歌詞。');return false;}
    generation++;if(pending){pending.abort();pending=null;}if(timer){clearInterval(timer);timer=null;}
    pendingChoice=null;lastRecognition=null;userStopped=false;shift=0;byId('voiceFollowOffset').textContent='0 秒';
    loaded={key:song.id,timed,isLocal:true,displaySong:own?song:{...song,lines:timed.map(x=>x.text),timedLyrics:timed,...(!song.sourceTimedLyrics&&song.cachedTimedLyrics?{source:'LRCLIB',sourceId:undefined}:{})}};
    basePosition=0;baseAt=Date.now();playing=true;lastLine=-2;controls(true);byId('voiceFollowToggle').textContent='暫停跟隨';
    timer=setInterval(render,500);render(true);return true;
  }
  // A confirmed local music alignment specifies the query's current position.
  // Nudge a running same-song timeline only when the confirmed music hit is
  // nearby. Repeated choruses can otherwise cause a large, incorrect jump.
  function alignAt(song,seconds){
    if(userStopped||!song||!Number.isFinite(seconds)||seconds<0)return false;
    if(loaded&&loaded.key===song.id){
      if(!playing)return false;
      const now=Date.now(),current=position(now),delta=seconds-current;
      if(Math.abs(delta)>.75&&Math.abs(delta)<=4){
        basePosition=Math.max(0,current+Math.max(-1,Math.min(1,delta)));baseAt=now;render(true);
      }
      return true;
    }
    const own=Array.isArray(song.timedLyrics)?song.timedLyrics:null;
    const timed=own||(Array.isArray(song.sourceTimedLyrics)?song.sourceTimedLyrics:null)||(Array.isArray(song.cachedTimedLyrics)?song.cachedTimedLyrics:null);
    if(!timed||!timed.length||!timed.every(x=>x&&Number.isFinite(x.time)&&typeof x.text==='string'))return false;
    if(seconds>timed[timed.length-1].time+30)return false;
    generation++;if(pending){pending.abort();pending=null}if(timer){clearInterval(timer);timer=null}
    pendingChoice=null;lastRecognition=null;shift=0;byId('voiceFollowOffset').textContent='0 秒';
    loaded={key:song.id,timed,isLocal:true,displaySong:own?song:{...song,lines:timed.map(x=>x.text),timedLyrics:timed}};
    playing=true;controls(true);byId('voiceFollowToggle').textContent='暫停跟隨';basePosition=seconds;baseAt=Date.now();lastLine=-2;
    timer=setInterval(render,500);render(true);return true;
  }
  function followPlayer(song,seconds,isPlaying){
    if(userStopped||song?.referenceOnly||!song||!Number.isFinite(seconds)||seconds< -60)return false;
    const timed=Array.isArray(song.timedLyrics)?song.timedLyrics:null;
    if(!timed||!timed.length||!timed.every(x=>x&&Number.isFinite(x.time)&&typeof x.text==='string'))return false;
    if(seconds>timed[timed.length-1].time+30)return false;
    if(!loaded||loaded.key!==song.id||!loaded.external){
      generation++;if(pending){pending.abort();pending=null}if(timer){clearInterval(timer);timer=null}
      pendingChoice=null;lastRecognition=null;shift=0;byId('voiceFollowOffset').textContent='0 秒';
      loaded={key:song.id,timed,isLocal:true,displaySong:song,external:true};lastLine=-2;controls(true);
    }
    basePosition=seconds;baseAt=Date.now();playing=!!isPlaying;byId('voiceFollowToggle').textContent=playing?'暫停跟隨':'繼續跟隨';render();return true;
  }
  function adjust(n){if(!loaded)return;shift=Math.max(-120,Math.min(120,shift+n));byId('voiceFollowOffset').textContent=`${shift>0?'+':''}${shift} 秒`;render(true);}
  byId('voiceFollowToggle').onclick=toggle;byId('voiceFollowStop').onclick=()=>stop();byId('voiceFollowEarlier').onclick=()=>adjust(-1);byId('voiceFollowLater').onclick=()=>adjust(1);
  byId('voiceFollowStart').onclick=()=>startFromBeginning(currentSong);
  ['searchBtn','yoasobi'].forEach(id=>byId(id)?.addEventListener('click',()=>stop('已切換手動搜尋。'),{capture:true}));
  byId('search').addEventListener('keydown',e=>{if(e.key==='Enter')stop('已切換手動搜尋。');},{capture:true});
  byId('songList').addEventListener('click',e=>{if(e.target.closest('.song-select'))stop('已切換手動選歌。');},{capture:true});
  root.VoiceSync={align,alignAt,startFromBeginning,followPlayer,enable:()=>{userStopped=false;},stop,isActive:()=>!!loaded};controls(false);
})(typeof window!=='undefined'?window:globalThis);

