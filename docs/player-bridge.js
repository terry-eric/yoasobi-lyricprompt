(function(){
  'use strict';
  // This static page contains no user data. Only the exact local app origins
  // may control a player; all messages are tied to this iframe's nonce.
  const parents=new Set(['https://demo.terry878.org']);
  const videos=new Set(["J9SAZlsM-ZM", "vcGbefQBvJ4", "kzdJkT4kp-A", "sAuEeM_6zpk", "tYP-i_tShDY", "Y4nEEZwckuU", "vd3IlOjSUGQ", "by4SYYWlhEs", "qDL3zhB8-MM", "nhOhFOoURnE", "wJQ9ig_d8yY", "VfATdDI3604", "iykAM_McguQ", "dy90tA3TT1c", "I0kytvnHG-Q", "mnta9Pp2LqA", "mctEybOqY6s", "3eytpBOkOFA", "7G0ovtPqHnI", "2-c0DFt6vK4", "ZRtdQ81jPUQ", "0yoM7ETNPIY", "VmUZooM4ZtE", "WQ6ePunO8uY", "fCh0qfxElm8", "ARqP5ohiubY", "Jj1_mfUzjOs", "ZfR_FP_7w00", "sJ-2X3rHtXw", "tWqZxTAy7rU", "evtoG-4dLM4", "shZyg5VFI1Y", "HRlW6yZo6Kc", "ZSr3P-Rn6x0", "GWDzKel_vuQ", "GuIkxXiVHps", "qwYhKlY4Tx0", "PNQ-k7qj9r4", "BNiPHiEjkkA", "8nha9wNQvK0", "1lOYyzBq4IM", "lU1wZMytGvY", "QnFRBzxmC4s", "LJBHySglLXU", "1dr4HfjgtUU"]);
  let config;try{config=JSON.parse(decodeURIComponent(location.hash.slice(1)))}catch{return;}
  if(!config||!parents.has(config.parent)||!videos.has(config.video)||!/^[a-f0-9]{32}$/.test(config.nonce||'')||window.parent===window)return;
  const send=(type,data={})=>window.parent.postMessage({kind:'lyric-youtube-v1',nonce:config.nonce,type,...data},config.parent);
  let player=null,ready=false;
  function update(){if(!ready||!player)return;try{const seconds=player.getCurrentTime(),state=player.getPlayerState();if(Number.isFinite(seconds)&&seconds>=0)send('progress',{seconds,state});}catch{}}
  window.addEventListener('message',event=>{
    if(event.origin!==config.parent||event.source!==window.parent)return;
    const msg=event.data;if(!msg||msg.kind!=='lyric-youtube-v1'||msg.nonce!==config.nonce||!ready)return;
    try{if(msg.type==='seek'&&Number.isFinite(msg.seconds)&&msg.seconds>=0&&msg.seconds<86400){player.seekTo(msg.seconds,true);update();}
      else if(msg.type==='pause')player.pauseVideo();else if(msg.type==='play')player.playVideo();}catch{}
  });
  window.onYouTubeIframeAPIReady=()=>{player=new YT.Player('player',{height:'200',width:'100%',videoId:config.video,playerVars:{origin:location.origin,playsinline:1},events:{
    onReady:()=>{ready=true;send('ready');update();},onStateChange:update,
    onError:e=>{ready=false;send('error',{code:Number.isInteger(e.data)?e.data:0});}
  }});};
  const script=document.createElement('script');script.src='https://www.youtube.com/iframe_api';script.onerror=()=>send('error',{code:0});document.head.append(script);
  // More frequent position updates reduce lyric highlight latency during playback.
  setInterval(update,150);
})();
