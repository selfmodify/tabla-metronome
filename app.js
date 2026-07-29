(function(){
  "use strict";

  const USE_AUDIO_SAMPLES = false; // Set this to true to enable audio samples

  // ---------- Taal data ----------
  // vibhagAccents[0] is conventionally the Sam, but beat 0 is ALWAYS rendered as Sam
  // regardless of its accent value (Rupak famously opens on a khali instead of a clap).
  const TAALS = {
    teentaal: {
      name: "Teentaal", vibhags: [4,4,4,4],
      vibhagAccents: ["sam","tali","khali","tali"],
      bols: ["Dha","Dhin","Dhin","Dha","Dha","Dhin","Dhin","Dha","Dha","Tin","Tin","Ta","Ta","Dhin","Dhin","Dha"]
    },
    ektaal: {
      name: "Ektaal", vibhags: [2,2,2,2,2,2],
      vibhagAccents: ["sam","tali","khali","tali","tali","tali"],
      bols: ["Dhin","Dhin","Dha","Ge","Ti","Ra","Ki","Ta","Dhin","Dhin","Dha","Ge"]
    },
    jhaptaal: {
      name: "Jhaptaal", vibhags: [2,3,2,3],
      vibhagAccents: ["sam","tali","khali","tali"],
      bols: ["Dhin","Na","Dhin","Dhin","Na","Tin","Na","Dhin","Dhin","Na"]
    },
    rupak: {
      name: "Rupak", vibhags: [3,2,2],
      vibhagAccents: ["khali","tali","tali"],
      bols: ["Tin","Tin","Na","Dhin","Na","Dhin","Na"]
    },
    dadra: {
      name: "Dadra", vibhags: [3,3],
      vibhagAccents: ["sam","khali"],
      bols: ["Dha","Dhin","Na","Dha","Tin","Na"]
    },
    kehrawa: {
      name: "Kehrawa", vibhags: [4,4],
      vibhagAccents: ["sam","khali"],
      bols: ["Dha","Ge","Na","Ti","Na","Ka","Dhin","Na"]
    },
    bhajani: {
      name: "Bhajani", vibhags: [4,4],
      vibhagAccents: ["sam","khali"],
      bols: ["Dhin","Ka","Dhin","Na","Tin","Ka","Tin","Na"]
    }
  };

  function totalBeats(taal){ return taal.vibhags.reduce((a,b)=>a+b,0); }

  // Precompute per-beat info: {vibhagIndex, isVibhagStart, accent}
  function beatInfoTable(taal){
    const table = [];
    let vIdx = 0, count = 0;
    for (let i=0;i<taal.vibhags.length;i++){
      for (let j=0;j<taal.vibhags[i];j++){
        const isStart = j===0;
        let accent = "plain";
        if (i===0 && isStart) accent = "sam";
        else if (isStart) accent = taal.vibhagAccents[i];
        table.push({ vibhagIndex:i, isVibhagStart:isStart, accent });
      }
    }
    return table;
  }

  // ---------- State ----------
  let currentTaalKey = localStorage.getItem('tablaTaal') || "teentaal";
  let bpm = parseInt(localStorage.getItem('tablaBpm'), 10) || 80;
  let volume = parseFloat(localStorage.getItem('tablaVol')) || 0.8;
  let audioBuffers = {};
  let isLoading = USE_AUDIO_SAMPLES;
  let isPlaying = false;
  let beatTable = beatInfoTable(TAALS[currentTaalKey]);
  let beatCircleEls = [];

  let audioCtx = null;
  let masterGain = null;
  let currentBeatNumber = 0;
  let nextNoteTime = 0;
  let timerID = null;
  let beatQueue = [];
  let rafID = null;
  let playbackStartCtxTime = 0;
  let elapsedAccum = 0;

  const LOOKAHEAD_MS = 25;
  const SCHEDULE_AHEAD = 0.12;

  // ---------- DOM refs ----------
  const taalGrid = document.getElementById("taalGrid");
  const taalTitle = document.getElementById("taalTitle");
  const beatStrip = document.getElementById("beatStrip");
  const bigBol = document.getElementById("bigBol");
  const cycleSub = document.getElementById("cycleSub");
  const beatCountEl = document.getElementById("beatCount");
  const vibhagCountEl = document.getElementById("vibhagCount");
  const elapsedEl = document.getElementById("elapsedTime");
  const bpmSlider = document.getElementById("bpmSlider");
  const bpmLabel = document.getElementById("bpmLabel");
  const bpmDown = document.getElementById("bpmDown");
  const bpmUp = document.getElementById("bpmUp");
  const bpmDown5 = document.getElementById("bpmDown5");
  const bpmUp5 = document.getElementById("bpmUp5");
  const bpmHalf = document.getElementById("bpmHalf");
  const bpmDouble = document.getElementById("bpmDouble");
  const volSlider = document.getElementById("volSlider");
  const volLabel = document.getElementById("volLabel");
  const volDown = document.getElementById("volDown");
  const volUp = document.getElementById("volUp");
  const playBtn = document.getElementById("playBtn");

  // ---------- Build taal selector ----------
  function buildTaalGrid(){
    taalGrid.innerHTML = "";
    Object.keys(TAALS).forEach(key=>{
      const t = TAALS[key];
      const btn = document.createElement("button");
      btn.className = "taal-btn" + (key===currentTaalKey ? " active":"");
      btn.dataset.key = key;
      btn.innerHTML = `<div class="name">${t.name}</div><div class="meta">${totalBeats(t)} beats &middot; ${t.vibhags.length} vibhags</div>`;
      btn.addEventListener("click", ()=> selectTaal(key));
      taalGrid.appendChild(btn);
    });
  }

  function selectTaal(key){
    if (key === currentTaalKey) return;
    currentTaalKey = key;
    localStorage.setItem('tablaTaal', key);
    beatTable = beatInfoTable(TAALS[key]);
    stopPlayback(true);
    [...taalGrid.children].forEach(b=> b.classList.toggle("active", b.dataset.key===key));
    buildBeatStrip();
    updateStatsIdle();
  }

  // ---------- Build beat strip ----------
  function buildBeatStrip(){
    const taal = TAALS[currentTaalKey];
    taalTitle.textContent = `Beat Cycle — ${taal.name}`;
    beatStrip.innerHTML = "";
    beatCircleEls = [];
    let beatIdx = 0;
    taal.vibhags.forEach((len, vI)=>{
      const group = document.createElement("div");
      group.className = "vibhag-group";
      for (let j=0;j<len;j++){
        const info = beatTable[beatIdx];
        const wrap = document.createElement("div");
        wrap.className = "beat";
        const dot = document.createElement("div");
        dot.className = "dot " + info.accent;
        dot.textContent = info.accent === "sam" ? "X" : (info.isVibhagStart ? (info.accent==="khali" ? "O" : String(vI+1)) : "");
        const bol = document.createElement("div");
        bol.className = "bol";
        bol.textContent = taal.bols[beatIdx] || "";
        wrap.appendChild(dot);
        wrap.appendChild(bol);
        group.appendChild(wrap);
        beatCircleEls.push(wrap);
        beatIdx++;
      }
      beatStrip.appendChild(group);
    });
  }

  function updateStatsIdle(){
    const taal = TAALS[currentTaalKey];
    beatCountEl.textContent = `— / ${totalBeats(taal)}`;
    vibhagCountEl.textContent = `— / ${taal.vibhags.length}`;
    bigBol.innerHTML = "&nbsp;";
    cycleSub.textContent = "Press Start to begin";
    elapsedEl.textContent = "00:00:00";
    beatCircleEls.forEach(el=> el.classList.remove("current"));
  }

  // ---------- Audio ----------
  function ensureAudio(){
    if (!audioCtx){
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = volume;
      masterGain.connect(audioCtx.destination);
      if (USE_AUDIO_SAMPLES) loadAudioSamples();
    }
  }

  // --- Synthesized sounds (default) ---
  function tone(freq, time, dur, peak){
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(peak, time + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.connect(gain).connect(masterGain);
    osc.start(time);
    osc.stop(time + dur + 0.02);
  }

  function noiseHit(time, dur, peak, filterFreq){
    const bufferSize = Math.floor(audioCtx.sampleRate * dur);
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i=0;i<bufferSize;i++){ data[i] = (Math.random()*2-1) * (1 - i/bufferSize); }
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    const filter = audioCtx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = filterFreq;
    filter.Q.value = 1.2;
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(peak, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    src.connect(filter).connect(gain).connect(masterGain);
    src.start(time);
  }

  function playClick(accent, time){
    if (accent === "sam") { tone(1046, time, 0.16, 1.0); tone(196, time, 0.22, 0.6); }
    else if (accent === "tali") { tone(784, time, 0.13, 0.75); }
    else if (accent === "khali") { noiseHit(time, 0.14, 0.45, 1400); }
    else { tone(440, time, 0.07, 0.28); }
  }

  // --- Audio sample logic (optional) ---
  async function loadAudioSamples(){
    const uniqueBols = [...new Set(Object.values(TAALS).flatMap(t => t.bols))];
    playBtn.disabled = true;
    playBtn.textContent = "Loading...";
    const promises = uniqueBols.map(async bol => {
      try {
        const response = await fetch(`audio/${bol}.mp3`);
        const arrayBuffer = await response.arrayBuffer();
        audioBuffers[bol] = await audioCtx.decodeAudioData(arrayBuffer);
      } catch (e) { console.error(`Could not load audio for bol: ${bol}`, e); }
    });
    await Promise.all(promises);
    isLoading = false;
    playBtn.disabled = false;
    playBtn.textContent = "Start";
  }

  function playSample(bol, time, accent){
    const buffer = audioBuffers[bol];
    if (!buffer) {
      playClick(accent, time); // Fallback to synthesized sound
      return;
    }

    const source = audioCtx.createBufferSource();
    source.buffer = buffer;

    // Optional: Make sam/tali slightly louder
    if (accent === 'sam' || accent === 'tali'){
      const gain = audioCtx.createGain();
      gain.gain.value = 1.2; // 20% louder
      source.connect(gain).connect(masterGain);
    } else {
      source.connect(masterGain);
    }
    source.start(time);
  }

  // ---------- Scheduler ----------
  function secondsPerBeat(){ return 60.0 / bpm; }

  function scheduleNote(beatNumber, time){
    beatQueue.push({ beatNumber, time });
    const accent = beatTable[beatNumber].accent;
    if (USE_AUDIO_SAMPLES){
      const bol = TAALS[currentTaalKey].bols[beatNumber];
      playSample(bol, time, accent);
    } else {
      playClick(accent, time);
    }
  }

  function advanceBeat(){
    nextNoteTime += secondsPerBeat();
    currentBeatNumber = (currentBeatNumber + 1) % beatTable.length;
  }

  function scheduler(){
    while (nextNoteTime < audioCtx.currentTime + SCHEDULE_AHEAD){
      scheduleNote(currentBeatNumber, nextNoteTime);
      advanceBeat();
    }
    timerID = setTimeout(scheduler, LOOKAHEAD_MS);
  }

  // ---------- UI sync loop ----------
  function uiLoop(){
    if (!isPlaying) return;
    const now = audioCtx.currentTime;
    let latest = null;
    while (beatQueue.length && beatQueue[0].time <= now){
      latest = beatQueue.shift();
    }
    if (latest){
      renderBeat(latest.beatNumber);
    }
    const elapsed = elapsedAccum + (now - playbackStartCtxTime);
    elapsedEl.textContent = formatTime(elapsed);
    rafID = requestAnimationFrame(uiLoop); // This was missing
  }

  function renderBeat(beatNumber){
    const taal = TAALS[currentTaalKey];
    beatCircleEls.forEach((el,i)=> el.classList.toggle("current", i===beatNumber));
    const info = beatTable[beatNumber];
    beatCountEl.textContent = `${beatNumber+1} / ${beatTable.length}`;
    vibhagCountEl.textContent = `${info.vibhagIndex+1} / ${taal.vibhags.length}`;
    bigBol.textContent = taal.bols[beatNumber] || "";
    const accentLabel = info.accent==="sam" ? "Sam" : info.accent==="tali" ? "Tali (clap)" : info.accent==="khali" ? "Khali (wave)" : "";
    cycleSub.textContent = accentLabel;
  }

  function formatTime(totalSeconds){
    const s = Math.max(0, Math.floor(totalSeconds));
    const hh = String(Math.floor(s/3600)).padStart(2,"0");
    const mm = String(Math.floor((s%3600)/60)).padStart(2,"0");
    const ss = String(s%60).padStart(2,"0");
    return `${hh}:${mm}:${ss}`;
  }

  // ---------- Transport ----------
  function startPlayback(){
    if (isLoading) return;
    ensureAudio();
    audioCtx.resume();
    isPlaying = true;
    currentBeatNumber = 0;
    beatQueue = [];
    nextNoteTime = audioCtx.currentTime + 0.06;
    playbackStartCtxTime = audioCtx.currentTime;
    elapsedAccum = 0;
    playBtn.textContent = "Stop";
    playBtn.classList.add("playing");
    scheduler();
    renderBeat(0); // Immediately highlight the first beat
    rafID = requestAnimationFrame(uiLoop);
  }

  function stopPlayback(silent){
    isPlaying = false;
    if (timerID) clearTimeout(timerID);
    if (rafID) cancelAnimationFrame(rafID);
    beatQueue = [];
    playBtn.textContent = "Start";
    playBtn.classList.remove("playing");
    if (!silent) updateStatsIdle();
    else updateStatsIdle();
  }

  playBtn.addEventListener("click", ()=>{
    if (isPlaying) stopPlayback(false);
    else startPlayback();
  });

  document.addEventListener("keydown", (e)=>{
    if (e.code === "Space" && e.target === document.body){
      e.preventDefault();
      playBtn.click();
    }
  });

  // ---------- Tempo controls ----------
  function setBpm(v){
    bpm = Math.min(300, Math.max(20, Math.round(v)));
    bpmSlider.value = bpm;
    localStorage.setItem('tablaBpm', bpm);
    bpmLabel.textContent = `${bpm} BPM`;
    updatePresetButtons();
  }

  function updatePresetButtons(){
    document.querySelectorAll('.preset-btn').forEach(btn => {
      // Use a small tolerance for float values from bpm/2
      btn.classList.toggle('active', Math.abs(bpm - btn.dataset.bpm) < 0.1);
    });
  }
  bpmSlider.addEventListener("input", e=> setBpm(e.target.value));
  bpmDown.addEventListener("click", ()=> setBpm(bpm-1));
  bpmUp.addEventListener("click", ()=> setBpm(bpm+1));
  bpmDown5.addEventListener("click", ()=> setBpm(bpm-5));
  bpmUp5.addEventListener("click", ()=> setBpm(bpm+5));
  bpmHalf.addEventListener("click", ()=> setBpm(bpm/2));
  bpmDouble.addEventListener("click", ()=> setBpm(bpm*2));
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const presetBpm = parseInt(btn.dataset.bpm, 10);
      setBpm(presetBpm);
    });
  });

  // ---------- Volume ----------
  function setVolume(v){
    volume = Math.min(100, Math.max(0, v)) / 100;
    volSlider.value = v;
    localStorage.setItem('tablaVol', volume);
    volLabel.textContent = `${Math.round(v)}%`;
    if (masterGain) masterGain.gain.value = volume;
  }
  volSlider.addEventListener("input", e=> setVolume(e.target.value));
  volDown.addEventListener("click", ()=> setVolume(parseInt(volSlider.value,10)-5));
  volUp.addEventListener("click", ()=> setVolume(parseInt(volSlider.value,10)+5));

  // ---------- Init ----------
  buildTaalGrid();
  buildBeatStrip();
  updateStatsIdle();
  setBpm(bpm);
  setVolume(volume*100);
  ensureAudio(); // Start loading audio immediately
})();