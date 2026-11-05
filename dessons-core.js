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

/* ---- Image analysis primitives (pure: pixel buffers in, numbers out) ----
   Used by index.html's process() and by nodes.html's node graph. */
function rgbToHue(r,g,b){
  r/=255; g/=255; b/=255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b);
  let h=0; const d=max-min;
  if(d===0) h=0;
  else if(max===r) h=60*(((g-b)/d)%6);
  else if(max===g) h=60*((b-r)/d+2);
  else h=60*((r-g)/d+4);
  if(h<0) h+=360;
  return h;
}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}

function rgbToHex(r,g,b){
  const h = x => Math.round(clamp(x,0,255)).toString(16).padStart(2,'0');
  return '#'+h(r)+h(g)+h(b);
}
function hexToRgb(hex){
  const n = parseInt(hex.slice(1), 16) || 0;
  return [(n>>16)&255, (n>>8)&255, n&255];
}

// box blur approximates a gaussian in 3 passes (horizontal+vertical each) —
// visually near-identical to a true gaussian, much cheaper in plain JS.
// Sliding-window sum keeps each pass O(w*h) regardless of radius.
function boxBlurPass(data, w, h, r, horizontal){
  const out = new Uint8ClampedArray(data.length);
  const size = r*2+1;
  if(horizontal){
    for(let y=0;y<h;y++){
      const row = y*w*4;
      for(let c=0;c<4;c++){
        let sum=0;
        for(let k=-r;k<=r;k++) sum += data[row + clamp(k,0,w-1)*4 + c];
        for(let x=0;x<w;x++){
          out[row + x*4 + c] = sum/size;
          sum += data[row + clamp(x+r+1,0,w-1)*4+c] - data[row + clamp(x-r,0,w-1)*4+c];
        }
      }
    }
  } else {
    for(let x=0;x<w;x++){
      for(let c=0;c<4;c++){
        let sum=0;
        for(let k=-r;k<=r;k++) sum += data[(clamp(k,0,h-1)*w+x)*4+c];
        for(let y=0;y<h;y++){
          out[(y*w+x)*4+c] = sum/size;
          sum += data[(clamp(y+r+1,0,h-1)*w+x)*4+c] - data[(clamp(y-r,0,h-1)*w+x)*4+c];
        }
      }
    }
  }
  return out;
}
function boxBlur(data, w, h, radius, passes){
  let cur = data;
  for(let p=0;p<passes;p++){
    cur = boxBlurPass(cur, w, h, radius, true);
    cur = boxBlurPass(cur, w, h, radius, false);
  }
  return cur;
}

// tone curve: black point / white point / gamma -> a 256-entry lookup table.
// Applied via direct index (data[i] -> lut[data[i]]), so it's O(1) per pixel
// however elaborate the curve. Defaults (21 / 234 / 1.00) reproduce the old
// fixed "Contrast 120%" slider almost exactly.
function buildToneLUT(blackPt, whitePt, gamma){
  const lut = new Uint8Array(256);
  const range = Math.max(1, whitePt - blackPt);
  for(let i=0;i<256;i++){
    let v = clamp((i - blackPt) / range, 0, 1);
    if(gamma !== 1) v = Math.pow(v, 1/gamma);
    lut[i] = Math.round(v*255);
  }
  return lut;
}
// tone curve + saturation for one pixel — the single place both the analysis
// (process) and the preview/eyedropper (via adjCanvas) get their colors from.
function adjustPixel(r,g,b,lut,satPct){
  r=lut[r]; g=lut[g]; b=lut[b];
  const y = 0.299*r + 0.587*g + 0.114*b;
  return [clamp(y+(r-y)*satPct,0,255), clamp(y+(g-y)*satPct,0,255), clamp(y+(b-y)*satPct,0,255)];
}

// Sobel gradient at one pixel (edges clamped/replicated) — returns [gx,gy].
function sobelAt(lum, w, h, x, y){
  const xm = x>0?x-1:0, xp = x<w-1?x+1:w-1;
  const ym = y>0?y-1:0, yp = y<h-1?y+1:h-1;
  const tl=lum[ym*w+xm], tc=lum[ym*w+x], tr=lum[ym*w+xp];
  const ml=lum[y*w+xm],                 mr=lum[y*w+xp];
  const bl=lum[yp*w+xm], bc=lum[yp*w+x], br=lum[yp*w+xp];
  return [ (tr+2*mr+br) - (tl+2*ml+bl), (bl+2*bc+br) - (tl+2*tc+tr) ];
}

// Otsu's method on an arbitrary histogram: the threshold bin that maximizes
// between-class variance. Standard algorithm, ~15 lines.
function otsuThreshold(hist, total){
  let sum=0; for(let i=0;i<256;i++) sum += i*hist[i];
  let sumB=0, wB=0, varMax=0, threshold=0;
  for(let t=0;t<256;t++){
    wB += hist[t]; if(wB===0) continue;
    const wF = total - wB; if(wF===0) break;
    sumB += t*hist[t];
    const mB = sumB/wB, mF = (sum-sumB)/wF;
    const varBetween = wB*wF*(mB-mF)*(mB-mF);
    if(varBetween > varMax){ varMax = varBetween; threshold = t; }
  }
  return threshold;
}

/* ---- Musical constants ---- */
const SCALES = {
  majPenta:[0,2,4,7,9], minPenta:[0,3,5,7,10],
  major:[0,2,4,5,7,9,11], minor:[0,2,3,5,7,8,10],
  dorian:[0,2,3,5,7,9,10], wholetone:[0,2,4,6,8,10], chromatic:[0,1,2,3,4,5,6,7,8,9,10,11]
};

// Playback direction: maps normalized image coords (nx,ny ∈ [0,1), y downward)
// to (τ,ρ) = (time fraction, pitch fraction), both ∈ [0,1). fwd is used to sort
// pixels into the grid; inv (its exact algebraic inverse) is used to place note
// dots and the playhead back onto the image. All 8 are affine in (nx,ny), so a
// line of constant τ (the playhead) is always a straight line in image space —
// horizontal/vertical for the 4 cardinal directions, a real diagonal for the
// other 4. Diagonal pitch runs along the *other* diagonal, high on the
// top-right side — same "top/right = high" convention as the cardinal modes.
const DIR_DEFS = {
  lr:   { fwd:(nx,ny)=>[nx,               1-ny],       inv:(t,r)=>[t,           1-r] },
  rl:   { fwd:(nx,ny)=>[1-nx,             1-ny],       inv:(t,r)=>[1-t,         1-r] },
  tb:   { fwd:(nx,ny)=>[ny,               nx],         inv:(t,r)=>[r,           t]   },
  bt:   { fwd:(nx,ny)=>[1-ny,             nx],         inv:(t,r)=>[r,           1-t] },
  tlbr: { fwd:(nx,ny)=>[(nx+ny)/2,        (nx-ny+1)/2], inv:(t,r)=>[t+r-0.5,    t-r+0.5] },
  brtl: { fwd:(nx,ny)=>[1-(nx+ny)/2,      (nx-ny+1)/2], inv:(t,r)=>[0.5-t+r,    1.5-t-r] },
  trbl: { fwd:(nx,ny)=>[(ny-nx+1)/2,      (nx+ny)/2],   inv:(t,r)=>[r-t+0.5,    r+t-0.5] },
  bltr: { fwd:(nx,ny)=>[(nx-ny+1)/2,      (nx+ny)/2],   inv:(t,r)=>[r+t-0.5,    r-t+0.5] }
};

/* ---- Hand-drawn instrument icons, one per GM_INSTR entry below. Inlined
   as SVG markup (not external <img src> files) so the zero-dependency /
   works-from-file:// promise holds — nothing to fetch. Kept verbatim from
   the source drawings (viewBox 0 0 78.8 80, class="st0"/"st1" on every
   shape); the theme re-colouring is done entirely in .instrIcon CSS, the
   only local edit here is class="ic-cut" on the shapes that must punch
   through as dark cutouts (piano + bass keys). ---- */
const INSTR_ICONS = {
  piano:'<svg viewBox="0 0 78.8 80"><rect class="st1" x="3.7" y="4" width="71.8" height="71.8"/><rect class="st1" x="26.2" y="4" width="24.5" height="71.8"/><rect class="ic-cut" x="19" y="5.5" width="13.4" height="46.2"/><rect class="ic-cut" x="45.1" y="5.5" width="13.4" height="46.2"/></svg>',
  organ:'<svg viewBox="0 0 78.8 80"><rect class="st0" x="2.8" y="31.8" width="13.2" height="45.6"/><rect class="st0" x="63.2" y="31.9" width="13.2" height="45.6"/><rect class="st0" x="17.9" y="18.4" width="13.2" height="59"/><rect class="st0" x="48.1" y="18.4" width="13.2" height="59"/><rect class="st0" x="33" y="7.3" width="13.2" height="70.1"/></svg>',
  vibraphone:'<svg viewBox="0 0 78.8 80"><rect class="st0" x="32.2" y="3.2" width="13.4" height="46.2" transform="translate(77.7 52.5) rotate(-180)"/><rect class="st0" x="47.1" y="3.2" width="13.4" height="59.8" transform="translate(107.6 66.1) rotate(-180)"/><rect class="st0" x="2.3" y="3.2" width="13.4" height="27.5" transform="translate(18 33.9) rotate(-180)"/><rect class="st0" x="17.2" y="3.2" width="13.4" height="35.6" transform="translate(47.8 42) rotate(-180)"/><rect class="st0" x="62.1" y="3.2" width="13.4" height="71" transform="translate(137.5 77.3) rotate(-180)"/></svg>',
  bass:'<svg viewBox="0 0 78.8 80"><rect class="st1" x="3.7" y="4.9" width="71.8" height="71.8"/><rect class="st1" x="3.6" y="2.9" width="71.8" height="26.8"/><rect class="st1" x="26.2" y="29.7" width="24.5" height="46.7"/><rect class="ic-cut" x="18.9" y="28.3" width="13.4" height="30.5"/><rect class="ic-cut" x="45.1" y="28.3" width="13.4" height="30.5"/><circle class="st1" cx="24.9" cy="15.9" r="9"/><circle class="st1" cx="53.7" cy="15.9" r="9"/></svg>',
  flute:'<svg viewBox="0 0 78.8 80"><rect class="st0" x="32.7" y="8.1" width="12.5" height="66.2" transform="translate(34.8 97.8) rotate(-132.4)"/><rect class="st0" x="60.4" y="7.8" width="12.5" height="16.2" rx="4.5" ry="4.5" transform="translate(99.8 75.9) rotate(-132.4)"/><rect class="st0" x="7.2" y="56.8" width="8.6" height="19.7" rx="4.3" ry="4.3" transform="translate(-42.2 25.6) rotate(-42.8)"/><rect class="st0" x="20.3" y="46.4" width="4" height="19.7" rx="2" ry="2" transform="translate(-31.5 28.6) rotate(-41.2)"/><rect class="st0" x="65.3" y="14.5" width="2.2" height="3.7" rx=".8" ry=".8" transform="translate(5.7 47.8) rotate(-41.2)"/><circle class="st0" cx="30.8" cy="48.8" r="2.2"/><circle class="st0" cx="38.7" cy="41.7" r="2.2"/><circle class="st0" cx="46.3" cy="34.8" r="2.2"/><circle class="st0" cx="54.8" cy="27.2" r="2.2"/></svg>',
  steel:'<svg viewBox="0 0 78.8 80"><rect class="st0" x="3.5" y="4" width="71.8" height="71.8" rx="31" ry="31"/><rect class="st0" x="24.7" y="25.2" width="28.9" height="28.9" rx="14.4" ry="14.4"/><rect class="st0" x="46.7" y="9.8" width="20.8" height="20.8" rx="10.4" ry="10.4"/><rect class="st0" x="10.3" y="10.6" width="20.8" height="20.8" rx="10.4" ry="10.4"/><rect class="st0" x="9.4" y="47.4" width="20.8" height="20.8" rx="10.4" ry="10.4"/><rect class="st0" x="47.4" y="47.9" width="20.8" height="20.8" rx="10.4" ry="10.4"/><rect class="st0" x="5.6" y="31.5" width="15.7" height="15.7" rx="7.8" ry="7.8"/><rect class="st0" x="56.9" y="31.5" width="15.7" height="15.7" rx="7.8" ry="7.8"/><rect class="st0" x="30.4" y="5.5" width="15.7" height="15.7" rx="7.8" ry="7.8" transform="translate(51.6 -25) rotate(90)"/><rect class="st0" x="30.4" y="56.8" width="15.7" height="15.7" rx="7.8" ry="7.8" transform="translate(102.9 26.4) rotate(90)"/></svg>'
};

/* ---- General MIDI instrument shortlist (bilingual label + program number
   + a small hand-drawn SVG icon shown at rest instead of the name, see
   .instrPicker in renderLayerList()). Limited to exactly 6 — one per layer at the max —
   deliberately picked one per timbreFor() bucket (see the Web Audio synth
   further down) rather than a broad GM sampling: the original 19-entry
   list had several instruments landing in the *same* timbreFor() branch
   (e.g. Celesta/Vibraphone/Marimba/Music Box/Tubular Bells/Xylophone all
   hit the 8-15 "mallets" bucket and sounded byte-for-byte identical in the
   preview synth) — user feedback after actually listening to all of them.
   Each of these 6 hits a different branch: default/triangle (Piano),
   sawtooth-sustained (Organ), triangle-no-sustain-bright (Vibraphone),
   sine+sub-lowpass (Synth Bass), sine-sustained-bright (Flute), and the
   only square-wave branch (Steel Drums) — maximally distinct in the
   browser preview *and* still sensible, common General MIDI picks for
   the real .mid export. ---- */
const GM_INSTR = [
  {fr:"Piano acoustique",  en:"Acoustic Piano",    prog:0,   icon:INSTR_ICONS.piano},
  {fr:"Orgue",             en:"Organ",             prog:19,  icon:INSTR_ICONS.organ},
  {fr:"Vibraphone",        en:"Vibraphone",        prog:11,  icon:INSTR_ICONS.vibraphone},
  {fr:"Basse synthé",      en:"Synth Bass",        prog:38,  icon:INSTR_ICONS.bass},
  {fr:"Flûte",             en:"Flute",             prog:73,  icon:INSTR_ICONS.flute},
  {fr:"Steel drums",       en:"Steel Drums",       prog:114, icon:INSTR_ICONS.steel}
];

/* ---- Drawn path ('path' direction) ----
   raw = [[nx,ny],...] normalized on the image, ar = image width/height.
   Resampled at equal arc length in aspect-corrected space; τ = position of
   the nearest point on the path, ρ from the signed distance to it, scaled by
   dmax (the farthest pixel). See index.html's DIR_DEFS.path for the mapping. */
const PATH_N = 160;
function buildPathModel(raw, ar){
  const P = raw.map(([x,y]) => [x*ar, y]);
  const cum = [0];
  for(let i=1;i<P.length;i++) cum.push(cum[i-1] + Math.hypot(P[i][0]-P[i-1][0], P[i][1]-P[i-1][1]));
  const total = cum[cum.length-1] || 1;
  // resample at equal arc length: even time per unit of path, whatever the drawing speed
  const qx = new Float64Array(PATH_N), qy = new Float64Array(PATH_N);
  for(let k=0, j=0; k<PATH_N; k++){
    const target = total * k/(PATH_N-1);
    while(j < P.length-2 && cum[j+1] < target) j++;
    const seg = (cum[j+1]-cum[j]) || 1, u = clamp((target-cum[j])/seg, 0, 1);
    qx[k] = P[j][0] + (P[j+1][0]-P[j][0])*u;
    qy[k] = P[j][1] + (P[j+1][1]-P[j][1])*u;
  }
  const m = { ar, qx, qy, dmax: 1 };
  let dmax = 1e-3;
  for(let gy=0; gy<=40; gy++) for(let gx=0; gx<=40; gx++){
    const d = Math.abs(pathProject(m, gx/40*ar, gy/40)[1]);
    if(d > dmax) dmax = d;
  }
  m.dmax = dmax * 1.001;
  return m;
}
// -> [τ, signed distance] for a point in aspect-corrected space
function pathProject(m, x, y){
  const {qx, qy} = m;
  let best = Infinity, bt = 0, bs = 0;
  for(let i=0;i<PATH_N-1;i++){
    const ax = qx[i], ay = qy[i], dx = qx[i+1]-ax, dy = qy[i+1]-ay;
    const l2 = dx*dx+dy*dy || 1e-12;
    const u = clamp(((x-ax)*dx + (y-ay)*dy)/l2, 0, 1);
    const ex = x-(ax+dx*u), ey = y-(ay+dy*u), d2 = ex*ex+ey*ey;
    if(d2 < best){ best = d2; bt = (i+u)/(PATH_N-1); bs = (dx*(y-ay) - dy*(x-ax)) >= 0 ? 1 : -1; }
  }
  return [bt, bs*Math.sqrt(best)];
}
function pathPointAt(m, t){
  const f = clamp(t, 0, 1)*(PATH_N-1), i = Math.min(PATH_N-2, Math.floor(f)), u = f-i;
  const dx = m.qx[i+1]-m.qx[i], dy = m.qy[i+1]-m.qy[i], l = Math.hypot(dx,dy) || 1;
  return [m.qx[i]+dx*u, m.qy[i]+dy*u, -dy/l, dx/l];   // point + unit normal (positive side)
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
