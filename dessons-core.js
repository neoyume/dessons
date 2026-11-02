/* ============================================================
   Dessons — shared core
   ============================================================
   Plain functions shared by index.html (the loop workshop) and
   compose.html (the song arranger). A classic <script src>, not an ES
   module: modules are blocked on file://, and "double-click index.html
   and it works" must keep holding. Everything here is a global, exactly
   as it was when it lived inline in index.html.

   Only page-independent code belongs here — nothing that reads the DOM
   or a page's own state (layers, lastNotes, $('...')).
   ------------------------------------------------------------ */

/* ---- MIDI file encoding (SMF type 1, hand-written) ---- */
function writeVarLen(value){
  let buffer = value & 0x7F;
  const bytes=[];
  while((value >>=7) > 0){
    buffer <<= 8;
    buffer |= ((value & 0x7F) | 0x80);
  }
  while(true){
    bytes.push(buffer & 0xFF);
    if(buffer & 0x80) buffer >>=8; else break;
  }
  return bytes;
}
function u32(n){return [(n>>24)&255,(n>>16)&255,(n>>8)&255,n&255];}
function u16(n){return [(n>>8)&255,n&255];}
function str(s){return Array.from(s).map(c=>c.charCodeAt(0));}

// meta track: tempo at tick 0, plus optional markers [{tick, text}]
// (Logic shows FF 06 markers in its marker track — used for song sections)
function midiTempoTrack(tempo, markers){
  let ev = [];
  ev = ev.concat(writeVarLen(0), [0xFF,0x51,0x03, ...u32(Math.round(60000000/tempo)).slice(1)]);
  let last = 0;
  (markers || []).forEach(m=>{
    const b = str(m.text.slice(0,60));
    ev = ev.concat(writeVarLen(Math.max(0, m.tick - last)), [0xFF,0x06, b.length, ...b]);
    last = m.tick;
  });
  ev = ev.concat(writeVarLen(0), [0xFF,0x2F,0x00]);
  return ev;
}

// one track: name meta, then {tick, bytes} events (sorted here), then end-of-track
function midiTrack(name, events){
  events.sort((a,b)=>a.tick-b.tick);
  let trackBytes = [];
  const nameBytes = str(name.slice(0,30));
  trackBytes = trackBytes.concat(writeVarLen(0), [0xFF,0x03, nameBytes.length, ...nameBytes]);
  let last=0;
  events.forEach(e=>{
    const delta = e.tick-last; last = e.tick;
    trackBytes = trackBytes.concat(writeVarLen(Math.max(0,Math.round(delta))), e.bytes);
  });
  trackBytes = trackBytes.concat(writeVarLen(0), [0xFF,0x2F,0x00]);
  return trackBytes;
}

function midiFile(tracks, ppq){
  let file = [];
  file = file.concat(str('MThd'), u32(6), u16(1), u16(tracks.length), u16(ppq));
  tracks.forEach(tr=>{
    file = file.concat(str('MTrk'), u32(tr.length), tr);
  });
  return new Uint8Array(file);
}

function downloadBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

/* ---- Playback curve ---- */
// custom curve: 3 handles at x = .25/.5/.75 (endpoints fixed at 0/1),
// piecewise-linear between them. pts = [0, y1, y2, y3, 1], always monotonic.
function customCurveAt(p, pts){
  const xs = [0, 0.25, 0.5, 0.75, 1];
  for(let i=0;i<4;i++){
    if(p <= xs[i+1] || i===3){
      const t = (p - xs[i]) / (xs[i+1] - xs[i]);
      return pts[i] + (pts[i+1] - pts[i]) * t;
    }
  }
  return p;
}

// For grid step k of n, the fraction of the loop (0..1) at which it sounds.
// Linear -> k/n. The others bend that so notes rush / drag / swing.
function curveFracAt(mode, k, n, customPts){
  if(k <= 0) return 0;
  if(k >= n) return 1;
  const p = k / n;
  switch(mode){
    case 'accel': return 1 - (1 - p) * (1 - p);                 // slow start, fast end
    case 'decel': return p * p;                                 // fast start, slow end
    case 'pulse': return p < 0.5                                // dense at both edges of the loop
      ? 0.5 * (1 - (1 - 2*p) * (1 - 2*p))
      : 0.5 + 0.5 * (2*p - 1) * (2*p - 1);
    case 'swing': return Math.min(1, p + ((k % 2) ? 0.28 / n : 0)); // delay every other step
    case 'custom': return customCurveAt(p, customPts || [0, 0.25, 0.5, 0.75, 1]);
    default:      return p;                                     // linear
  }
}

/* ---- Preview synth (Web Audio) ---- */
function audioSupported(){
  return typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);
}

// iPhone/iPad detection (iPadOS 13+ reports as "Mac" but has touch points).
// Used only to decide the output routing in createSynthBus().
function isIOS(){
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
         (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// iOS Safari unlock trick: start a silent buffer synchronously, in the same
// gesture that created the context, before anything else touches the audio
// timeline. Harmless everywhere else. Callers must stay synchronous up to here.
function unlockAudio(ac){
  try{
    const buf = ac.createBuffer(1, 1, 22050);
    const src = ac.createBufferSource();
    src.buffer = buf; src.connect(ac.destination); src.start(0);
  }catch(e){}
}

function makeImpulse(ac, seconds, decay){
  const rate = ac.sampleRate, len = Math.max(1, Math.floor(rate * seconds));
  const buf = ac.createBuffer(2, len, rate);
  for(let ch = 0; ch < 2; ch++){
    const d = buf.getChannelData(ch);
    for(let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

// master gain -> dry + small reverb -> compressor -> speakers.
// Returns { master, out, iosEl }: voices connect to `master`; `out` (the
// compressor) is the last node before the speakers, for parallel taps.
function createSynthBus(ac){
  const master = ac.createGain();
  master.gain.value = 0.9;
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -12; comp.knee.value = 24; comp.ratio.value = 4;
  comp.attack.value = 0.004; comp.release.value = 0.2;
  const dry = ac.createGain(); dry.gain.value = 0.85;
  const wet = ac.createGain(); wet.gain.value = 0.16;
  const conv = ac.createConvolver();
  conv.buffer = makeImpulse(ac, 1.8, 2.5);
  master.connect(dry); dry.connect(comp);
  master.connect(conv); conv.connect(wet); wet.connect(comp);

  let iosEl = null;
  if(isIOS() && typeof ac.createMediaStreamDestination === 'function'){
    // iOS Safari mutes plain Web Audio output (ac.destination) whenever the
    // physical ring/silent switch is set to silent — it treats it as an
    // "ambient" sound. Routing the signal through a real <audio> element
    // instead makes it use the "playback" audio session category, which iOS
    // does NOT silence. This is the standard workaround for that switch.
    try{
      const dest = ac.createMediaStreamDestination();
      comp.connect(dest);
      const el = document.createElement('audio');
      el.srcObject = dest.stream;
      el.autoplay = true;
      el.setAttribute('playsinline', '');
      el.style.display = 'none';
      document.body.appendChild(el);
      el.play().catch(()=>{});
      iosEl = el; // caller keeps a reference so nothing garbage-collects it mid-loop
    }catch(e){
      comp.connect(ac.destination); // routing failed for some reason: fall back
    }
  } else {
    comp.connect(ac.destination);
  }
  return { master, out: comp, iosEl };
}

// rough General MIDI family -> synth voice shape
function timbreFor(prog){
  prog = prog | 0;
  if(prog >= 8  && prog <= 15)  return {wave:'triangle', atk:0.003, dec:0.5,  sus:0.0,  rel:0.4,  cut:6500, q:0.5, gain:0.24};            // mallets / bells / music box
  if(prog >= 16 && prog <= 23)  return {wave:'sawtooth', atk:0.02,  dec:0.06, sus:0.85, rel:0.14, cut:2200, q:0.4, gain:0.14};            // organ
  if(prog >= 24 && prog <= 31)  return {wave:'triangle', atk:0.004, dec:0.35, sus:0.12, rel:0.25, cut:3400, q:0.6, gain:0.22};            // guitar
  if(prog >= 32 && prog <= 39)  return {wave:'sine',     atk:0.006, dec:0.22, sus:0.45, rel:0.2,  cut:1100, q:0.7, gain:0.28, sub:true};  // bass
  if(prog >= 40 && prog <= 55)  return {wave:'sawtooth', atk:0.09,  dec:0.2,  sus:0.7,  rel:0.35, cut:2600, q:0.3, gain:0.13};            // strings / ensemble
  if(prog >= 72 && prog <= 79)  return {wave:'sine',     atk:0.04,  dec:0.1,  sus:0.7,  rel:0.2,  cut:5200, q:0.4, gain:0.20};            // flute / pipe
  if(prog >= 80 && prog <= 87)  return {wave:'sawtooth', atk:0.006, dec:0.15, sus:0.6,  rel:0.2,  cut:3600, q:0.6, gain:0.15};            // synth lead
  if(prog >= 88 && prog <= 95)  return {wave:'sawtooth', atk:0.13,  dec:0.3,  sus:0.8,  rel:0.5,  cut:1900, q:0.3, gain:0.12};            // synth pad
  if(prog >= 96 && prog <= 111) return {wave:'triangle', atk:0.003, dec:0.45, sus:0.0,  rel:0.4,  cut:5800, q:0.5, gain:0.22};            // kalimba / atmospheres
  if(prog === 114)              return {wave:'square',   atk:0.003, dec:0.4,  sus:0.0,  rel:0.35, cut:4200, q:0.6, gain:0.20};            // steel drums
  return {wave:'triangle', atk:0.004, dec:0.3, sus:0.22, rel:0.25, cut:3400, q:0.6, gain:0.23};                                          // piano-ish default
}

// one note on the bus; returns { osc, g, sub } — the caller tracks it
// (voice cap, onended cleanup)
function playSynthVoice(ac, master, prog, midi, vel, whenSec, durSec, sustain){
  const tb = timbreFor(prog);
  const freq = 440 * Math.pow(2, (midi - 69) / 12);
  const amp = tb.gain * Math.max(0.06, vel / 127);
  const t0 = Math.max(whenSec, ac.currentTime + 0.003);
  const off = Math.max(t0 + durSec, t0 + tb.atk + 0.03);
  // sustain "pedal" feel for the preview synth: besides ringing the full step
  // (durSec, set by the caller), boost the held level and stretch the release
  // tail — this is what actually makes it audible, since most timbres decay
  // to near-silence during their hold (sus:0 on mallets/steel drums) and have
  // a short release; a longer note-on time alone barely changes what you hear.
  const rel = sustain ? tb.rel * 4 : tb.rel;
  const sus = sustain ? Math.max(tb.sus, 0.55) : tb.sus;
  const end = off + rel;
  const decEnd = Math.min(t0 + tb.atk + tb.dec, off);
  const susLvl = Math.max(0.0002, amp * sus);

  const osc = ac.createOscillator();
  osc.type = tb.wave;
  osc.frequency.setValueAtTime(freq, t0);

  const filt = ac.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.setValueAtTime(Math.min(tb.cut, ac.sampleRate / 2 - 800), t0);
  filt.Q.value = tb.q;

  const g = ac.createGain();
  g.gain.setValueAtTime(0.0002, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0003, amp), t0 + tb.atk);
  g.gain.exponentialRampToValueAtTime(susLvl, decEnd);
  if(decEnd < off) g.gain.setValueAtTime(susLvl, off);
  g.gain.exponentialRampToValueAtTime(0.0002, end);

  osc.connect(filt); filt.connect(g); g.connect(master);

  let sub = null;
  if(tb.sub){
    sub = ac.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(freq / 2, t0);
    const sg = ac.createGain();
    sg.gain.setValueAtTime(0.0002, t0);
    sg.gain.exponentialRampToValueAtTime(Math.max(0.0003, amp * 0.7), t0 + tb.atk);
    sg.gain.exponentialRampToValueAtTime(0.0002, end);
    sub.connect(sg); sg.connect(master);
    sub.start(t0); sub.stop(end + 0.05);
  }

  osc.start(t0);
  osc.stop(end + 0.05);
  return { osc, g, sub };
}

// 50 ms fade then stop — no click
function fadeOutVoice(ac, v){
  const now = ac.currentTime;
  try{
    v.g.gain.cancelScheduledValues(now);
    v.g.gain.setValueAtTime(Math.max(0.0002, v.g.gain.value), now);
    v.g.gain.exponentialRampToValueAtTime(0.0002, now + 0.05);
    v.osc.stop(now + 0.06);
    if(v.sub) v.sub.stop(now + 0.06);
  }catch(e){}
}

/* ---- Song scenes (IndexedDB, shared by the workshop and the arranger) ----
   A scene is a frozen loop: the notes the workshop computed, plus what's
   needed to place them in time (bars/steps/curve/gate) and to show them
   (thumbnail, layer names/colors). The image itself is only kept as a
   thumbnail. IndexedDB rather than localStorage: thumbnails add up fast
   past localStorage's ~5 MB. */
const SONG_DB = 'dessons', SONG_DB_VERSION = 1, SCENE_STORE = 'scenes';
let songDbPromise = null;
function openSongDb(){
  if(songDbPromise) return songDbPromise;
  songDbPromise = new Promise((resolve, reject)=>{
    if(typeof indexedDB === 'undefined'){ reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(SONG_DB, SONG_DB_VERSION);
    req.onupgradeneeded = ()=>{
      if(!req.result.objectStoreNames.contains(SCENE_STORE)) req.result.createObjectStore(SCENE_STORE, {keyPath:'id'});
    };
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=> reject(req.error);
  });
  songDbPromise.catch(()=>{ songDbPromise = null; });   // retry on next call
  return songDbPromise;
}
function sceneTx(mode, fn){
  return openSongDb().then(db => new Promise((resolve, reject)=>{
    const tx = db.transaction(SCENE_STORE, mode);
    const req = fn(tx.objectStore(SCENE_STORE));
    tx.oncomplete = ()=> resolve(req ? req.result : undefined);
    tx.onerror = ()=> reject(tx.error);
  }));
}
function loadScenes(){ return sceneTx('readonly', s => s.getAll()).then(list => (list || []).sort((a,b)=>a.created-b.created)); }
function saveScene(scene){ return sceneTx('readwrite', s => s.put(scene)); }
function deleteScene(id){ return sceneTx('readwrite', s => s.delete(id)); }

// tells an already-open compose.html tab that the scene bank changed
// (it also reloads on focus, for browsers/file:// where this is unavailable)
function notifyScenesChanged(){
  try{ const bc = new BroadcastChannel('dessons-song'); bc.postMessage('scenes'); bc.close(); }catch(e){}
}

function newSceneId(){ return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
