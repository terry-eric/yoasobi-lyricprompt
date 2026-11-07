'use strict';
const $ = id => document.getElementById(id);
const STORAGE_KEY = 'lyric-companion-v1';
const demos = [];
// Close source details when the user taps elsewhere, without intercepting links.
document.addEventListener('pointerdown', event => {
  document.querySelectorAll('details.reading-attribution[open]').forEach(details => {
    if (!details.contains(event.target)) details.open = false;
  });
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  document.querySelectorAll('details.reading-attribution[open]').forEach(details => {
    details.open = false;
    details.querySelector('summary')?.focus({preventScroll:true});
  });
});
let songs;
try { const saved = localStorage.getItem(STORAGE_KEY); songs = saved ? JSON.parse(saved) : demos; if (!Array.isArray(songs)) songs = demos; }
catch { songs = demos; }
songs = songs.filter(s => s && !s.demo && typeof s.name === 'string' && Array.isArray(s.lines) && s.lines.every(l => typeof l === 'string'));
let currentSong = null, currentLine = -1, listening = false, recognizer = null, restartTimer = null, searchSequence = 0, lastAuto = '';
function saveSongs() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(songs)); return true; } catch { $('listenStatus').textContent = '儲存空間不足，歌詞可能無法在重新整理後保留'; return false; } }
function el(tag, text, className) { const e = document.createElement(tag); e.textContent = text; if (className) e.className = className; return e; }
function normalize(value) { return String(value).toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, ''); }
function parseLyrics(text, format = '') {
  if (format.toLowerCase() === 'ttml' || /^\s*(<\?xml|<tt[\s>])/i.test(text)) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.querySelector('parsererror')) return [];
    return Array.from(doc.getElementsByTagName('*')).filter(e => e.localName === 'p').map(e => e.textContent.trim()).filter(Boolean);
  }
  return text.replace(/^\uFEFF/, '').split(/\r?\n/).map(line => line.replace(/\[(?:\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?)\]/g, '').trim()).filter(line => line && !/^\[[a-z]+\s*:/i.test(line));
}
function parseLyricData(text, format = '') {
  if (format.toLowerCase() === 'ttml' || /^\s*(<\?xml|<tt[\s>])/i.test(text)) return window.TtmlParser.parse(text);
  const parsed = window.LrcParser.parse(text);
  return parsed.error ? {lines:parseLyrics(text, format)} : parsed;
}
function similarity(a, b) {
  if (!a || !b) return 0;
  // Short fragments are common between songs; do not treat them as an exact match.
  if (a.length >= 4 && b.includes(a)) return .88 + .12 * a.length / b.length;
  // A transcription window can cover several lyrics lines. A complete line inside
  // that window is strong evidence regardless of the rest of the transcript.
  if (b.length >= 5 && a.includes(b)) return .96;
  if (a.length < 3 || b.length < 3) return 0;
  const grams = s => { const set = new Set(); for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2)); return set; };
  const y = grams(b);
  const dice = part => { const x = grams(part); let overlap = 0; x.forEach(g => { if (y.has(g)) overlap++; }); return 2 * overlap / (x.size + y.size); };
  let best = dice(a);
  // Compare local windows so nearby lyric lines don't dilute an imperfect match.
  if (a.length > b.length + 3) {
    for (const size of [Math.max(3, b.length - 2), b.length, b.length + 2]) {
      if (size > a.length) continue;
      for (let i = 0; i <= a.length - size; i++) best = Math.max(best, dice(a.slice(i, i + size)));
    }
  }
  return best;
}
function findMatches(query) {
  const q = normalize(query); if (q.length < 2) return [];
  const progressDistance = m => m.song !== currentSong || currentLine < 0 ? Infinity :
    (m.index >= currentLine ? m.index - currentLine : currentLine - m.index + 8);
  return songs.flatMap(song => song.lines.map((line, index) => {
    const normalizedLine = normalize(line);
    return {song, index, score: similarity(q, normalizedLine), matchEnd: normalizedLine.length >= 5 ? q.lastIndexOf(normalizedLine) : -1};
  }))
    .filter(m => m.score >= .3).sort((a,b) => b.score - a.score || b.matchEnd - a.matchEnd ||
      Number(b.song === currentSong) - Number(a.song === currentSong) || progressDistance(a) - progressDistance(b) || a.index - b.index).slice(0, 8);
}
function selectSongPosition(song, index) {
  if(window.YTIntegration?.seekToLyric?.(song,index))return;
  // Songs with an embedded player wait for playback rather than running an
  // independent lyric clock during the automatic player preload.
  if(window.YTIntegration?.supportsSong?.(song)) {
    focusLine(song, index);
    return;
  }
  // A related recording can use the original's words only as an explicitly
  // marked reference. Its live/arranged timing must never be inferred.
  if (song && song.referenceOnly) {
    if (window.VoiceSync) window.VoiceSync.stop('原曲歌詞參考，無法同步此版本。');
    focusLine(song, index);
    return;
  }
  if (window.MediaFollow && window.MediaFollow.pauseForVoice) window.MediaFollow.pauseForVoice();
  if (window.FingerprintControl && window.FingerprintControl.stop) window.FingerprintControl.stop();
  if (window.VoiceSync) window.VoiceSync.align(song, index, {manual:true}); else focusLine(song, index);
}
// Keep the attribution tied to the text actually being displayed. User-added
// entries have no automatic source claim; links are fixed allow-listed URLs.
function updateLyricSource(song) {
  const summary = $('lyricSourceSummary'), original = $('lyricOriginalSource');
  if (!summary || !original) return;
  const origin = String(song?.source || '').trim().toLowerCase();
  let name = '未標明／自行加入', url = '';
  if (origin === 'lrclib') {
    name = 'LRCLIB';
    const match = String(song.sourceId || song.id || '').match(/(?:^|lrclib-)(\d+)/i);
    url = match ? `https://lrclib.net/api/get/${match[1]}` : 'https://lrclib.net/';
  } else if (origin === 'unison') {
    name = 'Unison'; url = 'https://unison.betterlyrics.org/';
  }
  summary.textContent = `原詞：${name} · 中文：機器翻譯`;
  original.replaceChildren();
  if (url) { const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=name;original.append(a); }
  else original.textContent=name;
  if(song?.syncAttribution?.provider==='LRCLIB' && Number(song.syncAttribution.id)===38695675){
    const label=document.createTextNode('；同步時間：');const a=document.createElement('a');a.href='https://lrclib.net/api/get/38695675';a.target='_blank';a.rel='noopener noreferrer';a.textContent='LRCLIB（來源標為伴奏，分句時間估算）';original.append(label,a);
  }
  if(song?.syncAttribution?.provider==='LRCLIB' && Number(song.syncAttribution.id)===36422971){
    const label=document.createTextNode('；同步時間：');const a=document.createElement('a');a.href='https://lrclib.net/api/get/36422971';a.target='_blank';a.rel='noopener noreferrer';a.textContent='LRCLIB（分句時間估算）';original.append(label,a);
  }
}
function focusLine(song, index) {
  window.AlbumTheme?.setSong(song);
  updateLyricSource(song);
  window.YTMusicLink?.setSong(song);
  window.YTIntegration?.songChanged?.(song);
  // Reuse the rendered lyric lines during ordinary timeline updates. Ruby and
  // translations can otherwise create thousands of nodes every few seconds.
  const list = $('lyricsList'), next = Math.max(0, Math.min(index, song.lines.length - 1));
  if (currentSong === song && list.children.length === song.lines.length && list.children[next]?.classList.contains('lyric-line')) {
    currentLine = next;
    const previous = list.querySelector('.lyric-line.active'); if (previous) previous.classList.remove('active');
    const active = list.children[next]; active.classList.add('active');
    const top = active.offsetTop - list.offsetTop; list.scrollTop = Math.max(0, top - list.clientHeight / 3);
    return;
  }
  currentSong = song; currentLine = Math.max(0, Math.min(index, song.lines.length - 1));
  $('trackTitle').textContent = song.name; $('trackAiLabel').hidden = !window.LyricReading?.hasRevisions?.(song); $('trackMeta').textContent = `${song.demo ? '原創示範 · ' : ''}${song.lines.length} 句歌詞 · 點選任一句可手動定位`; $('playerTag').textContent = '正在跟隨歌詞';
  list.replaceChildren();
  song.lines.forEach((line, i) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'lyric-line' + (i === currentLine ? ' active' : '');
    const reading=el('span', line); if(window.LyricReading) window.LyricReading.render(reading,{title:song.name,text:line});
    button.append(el('span', String(i + 1).padStart(2, '0'), 'line-index'), reading); button.onclick = () => selectSongPosition(song, i); list.append(button);
  });
  const active = list.querySelector('.active'); if (active) { const top = active.offsetTop - list.offsetTop; list.scrollTop = Math.max(0, top - list.clientHeight / 3); }
  renderSongs();
}
function renderSongs() {
  $('songCount').textContent = `${songs.length} 首作品`; const list = $('songList'); list.replaceChildren();
  if (!songs.length) { const empty = el('div', '歌詞庫還是空的，加入歌詞就能開始。', 'empty-library'); list.append(empty); return; }
  songs.forEach(song => {
    const row = document.createElement('div'); row.className = 'song';
    const select = document.createElement('button'); select.type = 'button'; select.className = 'song-select'; select.append(el('span', '♫', 'song-icon'));
    const label = el('span', song.name, 'song-name'); if (song.demo) label.append(el('span', '示範', 'demo-label'));
    label.append(el('small', `${song.lines.length} 句歌詞${song.timedLyrics || song.sourceTimedLyrics || song.cachedTimedLyrics ? ' · 時間軸已就緒' : ' · 點選時查詢時間軸'}${currentSong && song.id === currentSong.id ? ' · 已選擇' : ''}`, 'song-details')); select.append(label); select.onclick = () => selectSongPosition(song, 0);
    const remove = el('button', '×', 'delete-song'); remove.type = 'button'; remove.setAttribute('aria-label', `移除 ${song.name}`);
    remove.onclick = () => { songs = songs.filter(s => s !== song); if (currentSong && currentSong.id === song.id) { if (window.VoiceSync) window.VoiceSync.stop('目前歌曲已從歌詞庫移除。'); currentSong = null; currentLine = -1; $('trackAiLabel').hidden = true; $('trackTitle').textContent = '準備接上下一句'; $('trackMeta').textContent = '從歌詞庫選擇歌曲，再點歌詞定位'; $('playerTag').textContent = '等待選歌'; $('lyricsList').replaceChildren(el('div', '目前歌詞與後續歌詞會在這裡顯示。', 'lyric-placeholder')); } saveSongs(); renderSongs(); };
    row.append(select, remove); list.append(row);
  });
}
function localResult(item) {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'result';
  const label = document.createElement('span'); label.className = 'result-text'; label.append(el('strong', item.song.lines[item.index]), el('small', `${item.song.name}${item.song.demo ? ' · 示範' : ''}`));
  button.append(el('span', String(item.index + 1).padStart(2,'0'), 'result-time'), label, el('span', '↗', 'result-arrow')); button.onclick = () => selectSongPosition(item.song, item.index); return button;
}
let yoasobiItems = null, yoasobiQuery = null, yoasobiLoading = null, yoasobiUpgrade = null;
const YOASOBI_CACHE_KEY = 'lyric-companion-yoasobi-cache-v1';
async function fetchYoasobiItems() {
  if (yoasobiItems) return yoasobiItems;
  if (yoasobiQuery) return yoasobiQuery;
  yoasobiQuery = (async () => {
    const res = await fetch('https://unison.betterlyrics.org/lyrics/search?q=YOASOBI', {signal: AbortSignal.timeout(12000)});
    if (!res.ok) throw new Error('search');
    const body = await res.json();
    if (!Array.isArray(body.data)) throw new Error('results');
    yoasobiItems = body.data; return yoasobiItems;
  })();
  try { return await yoasobiQuery; } finally { yoasobiQuery = null; }
}
async function upgradeCachedYoasobi(ids, status) {
  if (yoasobiUpgrade) return yoasobiUpgrade;
  yoasobiUpgrade = (async () => {
    const old = ids.map(id => songs.find(s => s.id === id)).filter(s => s && s.source === 'Unison' && !s.timedLyrics && !s.sourceTimedLyrics);
    let cursor = 0, completed = 0;
    async function worker() {
      while (cursor < old.length) {
        const song = old[cursor++];
        try {
          const response = await fetch(`https://unison.betterlyrics.org/lyrics/${encodeURIComponent(String(song.id).slice(7))}`, {signal:AbortSignal.timeout(15000)});
          if (!response.ok) throw Error('source'); const data = (await response.json()).data || {};
          const parsed = parseLyricData(String(data.lyrics || ''), String(data.format || ''));
          if (parsed.timedLyrics && parsed.timedLyrics.length && songs.includes(song)) song.sourceTimedLyrics = parsed.timedLyrics;
        } catch {}
        completed++; status.textContent = `正在準備同步時間 ${completed} / ${old.length} 首`;
      }
    }
    if (old.length) { status.textContent = `正在準備同步時間 0 / ${old.length} 首`; await Promise.all(Array.from({length:Math.min(3,old.length)}, worker)); saveSongs(); renderSongs(); }
    const ready=ids.map(id=>songs.find(s=>s.id===id)).filter(s=>s&&(s.timedLyrics||s.sourceTimedLyrics||s.cachedTimedLyrics)).length;
    status.textContent=`已準備 ${ids.length} 首 YOASOBI 歌詞，其中 ${ready} 首有同步時間`;
  })();
  try { return await yoasobiUpgrade; } finally { yoasobiUpgrade = null; }
}
async function preloadYoasobi(force = false) {
  if (yoasobiLoading) return yoasobiLoading;
  const status = $('artistStatus');
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(YOASOBI_CACHE_KEY) || 'null'); } catch {}
  const cachedSongs = cached && Array.isArray(cached.ids) ? cached.ids.filter(id => songs.some(s => s.id === id)).length : 0;
  if (!force && cached && Array.isArray(cached.ids) && cached.ids.length > 0 && cachedSongs === cached.ids.length && Date.now() - cached.timestamp < 7 * 24 * 60 * 60 * 1000) {
    await upgradeCachedYoasobi(cached.ids, status); return;
  }
  yoasobiLoading = (async () => {
    status.textContent = '正在尋找 YOASOBI 作品…';
    try {
      const items = await fetchYoasobiItems();
      const seen = new Set();
      const selected = items.filter(item => {
        const artist = String(item.artist || ''); const id = String(item.id ?? '');
        if (!id || !/yoasobi/i.test(artist) || seen.has(id)) return false;
        seen.add(id); return true;
      }).slice(0, 15);
      if (!selected.length) { status.textContent = '線上資料庫沒有找到 YOASOBI 作品，可按上方入口重試'; return; }
      let done = 0, errors = 0, cursor = 0; const loadedIds = [];
      async function worker() {
        while (cursor < selected.length) {
          const item = selected[cursor++]; const id = `online-${String(item.id)}`;
          try {
            const existing = songs.find(s => s.id === id);
            if (!existing) {
              const res = await fetch(`https://unison.betterlyrics.org/lyrics/${encodeURIComponent(item.id)}`, {signal: AbortSignal.timeout(15000)});
              if (!res.ok) throw new Error('fetch'); const body = await res.json(), data = body.data || {};
              const parsed = parseLyricData(String(data.lyrics || ''), String(data.format || item.format || '')), lines = parsed.lines;
              if (!lines.length) throw new Error('lyrics');
              if (!songs.some(s => s.id === id)) songs.push({id, name: `${data.song || item.song || '未命名歌曲'} · ${data.artist || item.artist || 'YOASOBI'}`, lines, ...(parsed.timedLyrics ? {timedLyrics:parsed.timedLyrics} : {}), source: 'Unison', artist: String(data.artist || item.artist || 'YOASOBI')});
            }
            loadedIds.push(id);
          } catch { errors++; }
          done++; status.textContent = `正在準備 YOASOBI 歌詞 ${done} / ${selected.length} 首${errors ? `（${errors} 首未載入）` : ''}`;
          renderSongs();
        }
      }
      await Promise.all(Array.from({length: Math.min(3, selected.length)}, () => worker()));
      const persisted = saveSongs();
      if (!errors && persisted) { try { localStorage.setItem(YOASOBI_CACHE_KEY, JSON.stringify({timestamp: Date.now(), ids: loadedIds})); } catch {} }
      await upgradeCachedYoasobi(loadedIds, status);
      if (errors) status.textContent += `；${errors} 首載入失敗，可重試`;
      if (!persisted) status.textContent += '（本次瀏覽有效）';
    } catch { status.textContent = 'YOASOBI 歌詞載入失敗，可按上方入口重試'; }
  })();
  try { await yoasobiLoading; } finally { yoasobiLoading = null; }
}
async function searchOnline(query, sequence, append = false) {
  const results = $('results'), area = document.createElement('div');
  if (!append) results.replaceChildren(); results.append(area);
  area.append(el('div', '正在搜尋線上歌詞庫…', 'empty-search'));
  try {
    let items;
    if (query.toUpperCase() === 'YOASOBI') items = (await fetchYoasobiItems()).filter(item => /yoasobi/i.test(String(item.artist || ''))).slice(0, 15);
    else { const res = await fetch(`https://unison.betterlyrics.org/lyrics/search?q=${encodeURIComponent(query)}`, {signal: AbortSignal.timeout(12000)}); if (!res.ok) throw new Error('search failed'); const body = await res.json(); items = Array.isArray(body.data) ? body.data.slice(0, 8) : []; }
    if (sequence !== searchSequence) return;
    area.replaceChildren();
    if (!items.length) { area.append(el('div', append ? '線上沒有找到其他結果。' : '歌詞庫與線上搜尋都沒有找到。試試另一句，或自行加入歌詞。', 'empty-search')); return; }
    area.append(el('div', '線上搜尋結果 · 點選載入完整歌詞', 'results-heading'));
    items.forEach(item => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'result';
      const label = document.createElement('span'); label.className = 'result-text'; label.append(el('strong', String(item.song || '未命名歌曲')), el('small', `${String(item.artist || '未知歌手')} · 線上歌詞`));
      button.append(el('span', '♫', 'result-time'), label, el('span', '↗', 'result-arrow')); button.onclick = () => loadOnline(item, query, button); area.append(button);
    });
  } catch { if (sequence === searchSequence) { area.replaceChildren(el('div', '線上搜尋暫時無法使用，仍可加入歌詞或使用本機歌詞庫。', 'empty-search')); } }
}
async function loadOnline(item, query, button) {
  button.disabled = true; const activeSequence = searchSequence; button.querySelector('.result-arrow').textContent = '…';
  try {
    const res = await fetch(`https://unison.betterlyrics.org/lyrics/${encodeURIComponent(item.id)}`, {signal: AbortSignal.timeout(12000)}); if (!res.ok) throw new Error('fetch');
    const body = await res.json(), data = body.data || {}; if (activeSequence !== searchSequence) return; const parsed = parseLyricData(String(data.lyrics || ''), String(data.format || item.format || '')), lines = parsed.lines;
    if (!lines.length) throw new Error('empty');
    const song = {id: `online-${String(item.id)}`, name: `${data.song || item.song || '未命名歌曲'}${data.artist || item.artist ? ` · ${data.artist || item.artist}` : ''}`, lines, ...(parsed.timedLyrics ? {timedLyrics:parsed.timedLyrics} : {}), source:'Unison'};
    const existing = songs.find(s => s.id === song.id); if (!existing) songs.push(song); const selected = existing || song; saveSongs();
    let index = 0, best = 0; selected.lines.forEach((line, i) => { const score = similarity(normalize(query), normalize(line)); if (score > best) { best = score; index = i; } });
    focusLine(selected, index); $('listenStatus').textContent = best >= .3 ? '已載入線上歌詞並定位相似句子' : '已載入歌詞，請手動選擇句子';
  } catch { $('listenStatus').textContent = '無法載入這首歌的線上歌詞，請重試或自行加入。'; }
  finally { button.disabled = false; if (button.querySelector('.result-arrow')) button.querySelector('.result-arrow').textContent = '↗'; }
}
function search(query, automatic = false) {
  const sequence = ++searchSequence; const area = $('results'); area.replaceChildren();
  const q = normalize(query);
  if (q.length < 2) { area.append(el('div', '請輸入至少兩個字。', 'empty-search')); return; }
  const matches = findMatches(query);
  const useful = matches.filter(m => m.score >= .55);
  if (useful.length) {
    area.append(el('div', '歌詞庫中的相似句子', 'results-heading')); useful.forEach(m => area.append(localResult(m)));
    const nextSong = useful.find(m => m.song.id !== useful[0].song.id);
    if (automatic && q.length >= 4 && useful[0].score >= .90 && (!nextSong || useful[0].score-nextSong.score >= .12)) { focusLine(useful[0].song, useful[0].index); $('listenStatus').textContent = listening ? '正在聆聽 · 已定位相似歌詞' : '已定位相似歌詞'; }
    else if (automatic) $('listenStatus').textContent = listening ? '正在聆聽 · 請選擇相似的句子' : '請選擇相似的句子';
  }
  // Search online even when a plausible local result exists; do not suppress matches.
  searchOnline(query, sequence, useful.length > 0);
}
$('yoasobi').onclick = () => { $('search').value = 'YOASOBI'; searchOnline('YOASOBI', ++searchSequence); preloadYoasobi(); };
$('searchBtn').onclick = () => search($('search').value, true);
$('search').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); search($('search').value, true); } });
$('addOpen').onclick = () => $('addDialog').showModal(); $('closeDialog').onclick = () => $('addDialog').close();
$('addDialog').addEventListener('close', () => { $('addForm').reset(); $('formError').textContent = ''; });
$('addForm').addEventListener('submit', async e => {
  e.preventDefault(); $('formError').textContent = '';
  try { const file = $('lrcFile').files[0], raw = $('lrcText').value.trim() || (file ? await file.text() : ''), parsed = /^\s*(<\?xml|<tt[\s>])/i.test(raw) ? {kind:'plain',lines:parseLyrics(raw,'ttml')} : window.LrcParser.parse(raw), lines = parsed.lines;
    if (parsed.error) { $('formError').textContent = parsed.error; return; }
    if (!lines.length) { $('formError').textContent = '請貼上歌詞或選擇歌詞檔。'; return; }
    const song = {id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, name: $('songName').value.trim(), lines}; if (parsed.kind === 'lrc') song.timedLyrics = parsed.timedLyrics; if (!song.name) { $('formError').textContent = '請輸入歌曲名稱。'; return; }
    songs.push(song); saveSongs(); $('addDialog').close(); selectSongPosition(song, 0);
  } catch { $('formError').textContent = '讀取檔案失敗，請重新選擇檔案。'; }
});
saveSongs();
renderSongs();
/* The verified YOASOBI catalog hydrates via yoasobi-extra.js. */
$('results').append(el('div', '✦ 輸入歌曲名稱或一段歌詞來搜尋。', 'empty-search'));


/* Public version: no root-scope service worker. */
