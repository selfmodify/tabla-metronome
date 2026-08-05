(function(){
  "use strict";

  const USE_AUDIO_SAMPLES = false;

  // ---------- Taal data ----------
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

  function beatInfoTable(taal){
    const table = [];
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

  // Default sound parameters
  const DEFAULT_SOUND_PROFILE = {
    samFreq1: 1046, samDur1: 0.16, samPeak1: 1.0,
    samFreq2: 196, samDur2: 0.22, samPeak2: 0.6,
    taliFreq: 784, taliDur: 0.13, taliPeak: 0.75,
    khaliFilterFreq: 1400, khaliDur: 0.14, khaliPeak: 0.45,
    plainFreq: 440, plainDur: 0.07, plainPeak: 0.28
  };

  // ---------- State ----------
  let currentTaalKey = localStorage.getItem('tablaTaal') || "teentaal";
  let bpm = parseInt(localStorage.getItem('tablaBpm'), 10) || 80;
  let volume = parseFloat(localStorage.getItem('tablaVol')) || 0.8;
  let currentTheme = localStorage.getItem('tablaTheme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

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

  // Practice features state
  let tapAlongMode = false;
  let loopMode = false;
  let loopStart = 0;
  let loopEnd = 0;
  let tempoRampMode = false;
  let tempoRampAmount = 2;
  let tempoRampInterval = 4;
  let tempoRampCounter = 0;
  let sessionTimerMode = false;
  let sessionTimerDuration = 10;
  let sessionTimerStart = 0;
  let lastTapTime = 0;
  let tapTimings = [];
  let tapStats = { totalTaps: 0, accuracyScores: [], avgAccuracy: 0, bestAccuracy: 100, worstAccuracy: 0 };
  let micStream = null;
  let audioAnalyser = null;
  let lastDetectedPeakTime = 0;
  let peakHistory = [];

  const LOOKAHEAD_MS = 25;
  const SCHEDULE_AHEAD = 0.12;
  const TAP_SYNC_TOLERANCE_MS = 100;
  const MIC_PEAK_THRESHOLD = 0.15;
  const MIC_PEAK_DEBOUNCE_MS = 150;

  // ---------- DOM refs ----------
  const taalSelector = document.getElementById("taalSelector");
  const taalTitle = document.getElementById("taalTitle");
  const beatStrip = document.getElementById("beatStrip");
  const bigBol = document.getElementById("bigBol");
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
  const themeToggle = document.getElementById("themeToggle");
  const tapAlongCb = document.getElementById("tapAlongMode");
  const loopModeCb = document.getElementById("loopMode");
  const tempoRampCb = document.getElementById("tempoRamp");
  const sessionTimerCb = document.getElementById("sessionTimer");
  const loopControls = document.getElementById("loopControls");
  const loopStartSel = document.getElementById("loopStart");
  const loopEndSel = document.getElementById("loopEnd");
  const tempoRampControls = document.getElementById("tempoRampControls");
  const rampAmount = document.getElementById("rampAmount");
  const rampInterval = document.getElementById("rampInterval");
  const sessionTimerControls = document.getElementById("sessionTimerControls");
  const timerDuration = document.getElementById("timerDuration");
  const timerDisplay = document.getElementById("timerDisplay");
  const tapFeedback = document.getElementById("tapFeedback");

  // ---------- Theme ----------
  function applyTheme(theme){
    currentTheme = theme;
    localStorage.setItem('tablaTheme', theme);
    document.documentElement.setAttribute('data-theme', theme);
    themeToggle.textContent = theme === 'dark' ? '☀️' : '🌙';
  }

  themeToggle.addEventListener('click', ()=> {
    applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
  });

  // ---------- Build taal selector ----------
  function buildTaalSelector(){
    taalSelector.innerHTML = "";
    Object.keys(TAALS).forEach(key=>{
      const t = TAALS[key];
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = `${t.name} (${totalBeats(t)} beats)`;
      if (key === currentTaalKey) opt.selected = true;
      taalSelector.appendChild(opt);
    });
  }
  taalSelector.addEventListener("change", (e)=> selectTaal(e.target.value));

  function selectTaal(key){
    if (key === currentTaalKey) return;
    currentTaalKey = key;
    localStorage.setItem('tablaTaal', key);
    beatTable = beatInfoTable(TAALS[key]);
    stopPlayback(true);
    buildBeatStrip();
    updateLoopSelects();
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
    elapsedEl.textContent = "00:00:00";
    beatCircleEls.forEach(el=> el.classList.remove("current"));
  }

  function updateLoopSelects(){
    const taal = TAALS[currentTaalKey];
    const totalBeats = beatTable.length;
    loopStartSel.innerHTML = "";
    loopEndSel.innerHTML = "";
    for (let i=0;i<totalBeats;i++){
      const optStart = document.createElement("option");
      optStart.value = i;
      optStart.textContent = `Beat ${i+1}`;
      loopStartSel.appendChild(optStart);

      const optEnd = document.createElement("option");
      optEnd.value = i;
      optEnd.textContent = `Beat ${i+1}`;
      loopEndSel.appendChild(optEnd);
    }
    loopEnd = totalBeats - 1;
    loopEndSel.value = loopEnd;
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
    const profile = DEFAULT_SOUND_PROFILE;
    let volume_mult = 1.0;
    if (accent === "sam") volume_mult = 1.2;
    else if (accent === "tali") volume_mult = 1.1;

    if (accent === "sam"){
      tone(profile.samFreq1, time, profile.samDur1, profile.samPeak1 * volume_mult);
      tone(profile.samFreq2, time, profile.samDur2, profile.samPeak2 * volume_mult);
    }
    else if (accent === "tali"){
      tone(profile.taliFreq, time, profile.taliDur, profile.taliPeak * volume_mult);
    }
    else if (accent === "khali"){
      noiseHit(time, profile.khaliDur, profile.khaliPeak, profile.khaliFilterFreq);
    }
    else {
      tone(profile.plainFreq, time, profile.plainDur, profile.plainPeak);
    }
  }

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
      playClick(accent, time);
      return;
    }
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    if (accent === 'sam' || accent === 'tali'){
      const gain = audioCtx.createGain();
      gain.gain.value = 1.2;
      source.connect(gain).connect(masterGain);
    } else {
      source.connect(masterGain);
    }
    source.start(time);
  }

  // ---------- Scheduler ----------
  function secondsPerBeat(){ return 60.0 / bpm; }

  function scheduleNote(beatNumber, time){
    if (loopMode && (beatNumber < loopStart || beatNumber > loopEnd)) return;
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
    if (loopMode){
      currentBeatNumber++;
      if (currentBeatNumber > loopEnd) currentBeatNumber = loopStart;
    } else {
      currentBeatNumber = (currentBeatNumber + 1) % beatTable.length;
    }
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

    if (sessionTimerMode){
      const sessionElapsed = elapsed - sessionTimerStart;
      const sessionRemaining = Math.max(0, sessionTimerDuration * 60 - sessionElapsed);
      timerDisplay.textContent = formatTime(sessionRemaining);
      if (sessionRemaining <= 0){
        stopPlayback(false);
        alert("Practice session complete!");
      }
    }

    if (tempoRampMode){
      const cycleElapsed = Math.floor((now - playbackStartCtxTime) / (secondsPerBeat() * beatTable.length));
      if (cycleElapsed > tempoRampCounter){
        tempoRampCounter = cycleElapsed;
        if (tempoRampCounter % tempoRampInterval === 0 && tempoRampCounter > 0){
          setBpm(bpm + tempoRampAmount);
        }
      }
    }

    rafID = requestAnimationFrame(uiLoop);
  }

  function renderBeat(beatNumber){
    const taal = TAALS[currentTaalKey];
    beatCircleEls.forEach((el,i)=> el.classList.toggle("current", i===beatNumber));
    const info = beatTable[beatNumber];
    beatCountEl.textContent = `${beatNumber+1} / ${beatTable.length}`;
    vibhagCountEl.textContent = `${info.vibhagIndex+1} / ${taal.vibhags.length}`;
    bigBol.textContent = taal.bols[beatNumber] || "";
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
    ensureAudio();
    if (isLoading) return;
    audioCtx.resume();
    isPlaying = true;
    currentBeatNumber = loopMode ? loopStart : 0;
    beatQueue = [];
    nextNoteTime = audioCtx.currentTime + 0.06;
    playbackStartCtxTime = audioCtx.currentTime;
    elapsedAccum = 0;
    tempoRampCounter = 0;
    if (sessionTimerMode) sessionTimerStart = 0;
    playBtn.textContent = "Stop";
    playBtn.classList.add("playing");
    scheduler();
    renderBeat(currentBeatNumber);
    rafID = requestAnimationFrame(uiLoop);
    if (tapAlongMode) {
      startMicDetection();
    }
  }

  function stopPlayback(silent){
    isPlaying = false;
    if (timerID) clearTimeout(timerID);
    if (rafID) cancelAnimationFrame(rafID);
    beatQueue = [];
    playBtn.textContent = "Start";
    playBtn.classList.remove("playing");
    stopMicDetection();
    if (!silent) { updateStatsIdle(); }
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

  // ---------- Tap-along mode ----------
  function detectTapSync(){
    const now = performance.now();
    tapTimings.push(now);
    tapTimings = tapTimings.filter(t => now - t < 3000);

    const feedbackEl = document.getElementById("tapIndicator");
    if (feedbackEl) {
      feedbackEl.classList.add("tap-flash");
      setTimeout(() => feedbackEl?.classList.remove("tap-flash"), 200);
    }

    if (tapTimings.length < 2){
      tapFeedback.textContent = "Tap again to sync...";
      tapFeedback.className = "tap-feedback";
      tapFeedback.style.display = "block";
      return;
    }

    const intervals = [];
    for (let i=1;i<tapTimings.length;i++){
      intervals.push(tapTimings[i] - tapTimings[i-1]);
    }
    const avgTapInterval = intervals.reduce((a,b)=>a+b,0) / intervals.length;
    const expectedInterval = secondsPerBeat() * 1000;
    const diffMs = Math.abs(avgTapInterval - expectedInterval);
    const accuracy = Math.max(0, 100 - (diffMs / expectedInterval) * 100);

    tapStats.totalTaps++;
    tapStats.accuracyScores.push(accuracy);
    tapStats.avgAccuracy = tapStats.accuracyScores.reduce((a,b)=>a+b,0) / tapStats.accuracyScores.length;
    tapStats.bestAccuracy = Math.max(tapStats.bestAccuracy, accuracy);
    tapStats.worstAccuracy = tapStats.accuracyScores.length === 1 ? accuracy : Math.min(...tapStats.accuracyScores);

    if (diffMs < TAP_SYNC_TOLERANCE_MS){
      tapFeedback.textContent = `✓ In sync! (${accuracy.toFixed(0)}%)`;
      tapFeedback.className = "tap-feedback good";
    } else if (diffMs < TAP_SYNC_TOLERANCE_MS * 2){
      tapFeedback.textContent = `${diffMs < expectedInterval ? "→ Speed up" : "← Slow down"} (${accuracy.toFixed(0)}%)`;
      tapFeedback.className = "tap-feedback";
    } else {
      tapFeedback.textContent = `${diffMs < expectedInterval ? "→ Speed up more" : "← Slow down more"} (${accuracy.toFixed(0)}%)`;
      tapFeedback.className = "tap-feedback bad";
    }
    tapFeedback.style.display = "block";
    updateTapStats();
  }

  function updateTapStats(){
    const statsEl = document.getElementById("tapStats");
    if (statsEl && tapStats.totalTaps > 0){
      statsEl.innerHTML = `
        <div style="font-size:.75rem;color:var(--text-dim);">
          Taps: ${tapStats.totalTaps} | Avg: ${tapStats.avgAccuracy.toFixed(0)}% | Best: ${tapStats.bestAccuracy.toFixed(0)}% | Worst: ${tapStats.worstAccuracy.toFixed(0)}%
        </div>
      `;
    }
  }

  document.addEventListener("keydown", (e)=>{
    if (tapAlongMode && isPlaying && (e.code === "KeyT" || e.code === "Enter")){
      e.preventDefault();
      detectTapSync();
    }
  });

  // Test: Mouse click to manually trigger tap feedback (for testing)
  document.addEventListener("click", (e)=>{
    if (tapAlongMode && isPlaying && e.target.id !== "playBtn"){
      detectTableaTap();
    }
  });

  // Microphone-based tabla beat detection using ScriptProcessorNode
  async function startMicDetection(){
    if (!window.isSecureContext) {
      const msg = "Microphone input requires a secure context (HTTPS).";
      console.error(msg);
      tapFeedback.textContent = msg;
      tapFeedback.className = "tap-feedback bad";
      tapFeedback.style.display = "block";
      return;
    }

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.error("getUserMedia not supported");
        tapFeedback.textContent = "Your browser does not support microphone access.";
        tapFeedback.className = "tap-feedback bad";
        tapFeedback.style.display = "block";
        return;
      }

      // Request both audio and video (video won't be displayed, but this helps with permissions)
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false
      });
      console.log("Microphone stream acquired");

      // Use the existing metronome AudioContext
      ensureAudio();
      console.log("Using existing AudioContext:", audioCtx.constructor.name);
      console.log("AudioContext state:", audioCtx.state);

      // Resume the audio context if it's suspended
      if (audioCtx.state === 'suspended') {
        console.log("AudioContext suspended, resuming...");
        await audioCtx.resume();
        console.log("AudioContext resumed, state:", audioCtx.state);
      }

      const source = audioCtx.createMediaStreamSource(micStream);
      console.log("MediaStream source created successfully");

      audioAnalyser = audioCtx.createAnalyser();
      audioAnalyser.fftSize = 512;
      source.connect(audioAnalyser);
      console.log("Microphone pipeline connected successfully");

      function detectTableaHits(){
        if (!tapAlongMode || !isPlaying) return;

        let rms = 0;
        // Ensure audioAnalyser is still valid
        if (audioAnalyser && micStream?.active) {
            const timeDomain = new Uint8Array(audioAnalyser.fftSize);
            audioAnalyser.getByteTimeDomainData(timeDomain);
            for (let i = 0; i < timeDomain.length; i++){
                const normalized = (timeDomain[i] - 128) / 128;
                rms += normalized * normalized;
            }
            rms = Math.sqrt(rms / timeDomain.length);
        } else {
            // Stop the loop if the stream is gone
            stopMicDetection();
            return;
        }

        const now = performance.now();
        if (rms > MIC_PEAK_THRESHOLD && now - lastDetectedPeakTime > MIC_PEAK_DEBOUNCE_MS){
          detectTableaTap();
          lastDetectedPeakTime = now;
        }
        requestAnimationFrame(detectTableaHits);
      }
      detectTableaHits();
      console.log("Microphone listening started");
    } catch (err) {
      console.error("Mic error:", err.name, err.message);
      let message = "Microphone access denied or not supported.";
      if (err.name === 'NotAllowedError') {
        message = "Microphone permission was denied. Please allow it in your browser settings.";
      } else if (err.name === 'NotFoundError') {
        message = "No microphone was found on your device.";
      } else if (err.name === 'NotReadableError') {
        message = "A hardware error occurred. Please try again or restart your browser.";
      } else if (err.name === 'SecurityError') {
        message = "Microphone access is blocked by your browser's security settings.";
      }
      tapFeedback.textContent = message;
      tapFeedback.className = "tap-feedback bad";
      tapFeedback.style.display = "block";
    }
  }

  function detectTableaTap(){
    // Use the AudioContext's clock for an accurate comparison with note schedule times.
    // performance.now() and audioCtx.currentTime have different origins and are not comparable.
    const now = audioCtx.currentTime;
    const expectedInterval = secondsPerBeat() * 1000;
    const timeSincePlaybackStart = now - playbackStartCtxTime;
    const beatDurationSec = secondsPerBeat();
    
    // Find the closest beat time to the current tap time
    const offsetFromBeat = timeSincePlaybackStart % beatDurationSec;
    const timingOffset = offsetFromBeat > beatDurationSec / 2 ? offsetFromBeat - beatDurationSec : offsetFromBeat;
    const accuracy = Math.max(0, 100 - (Math.abs(timingOffset) / beatDurationSec) * 100);

    tapStats.totalTaps++;
    tapStats.accuracyScores.push(accuracy);
    tapStats.avgAccuracy = tapStats.accuracyScores.reduce((a,b)=>a+b,0) / tapStats.accuracyScores.length;
    tapStats.bestAccuracy = Math.max(tapStats.bestAccuracy, accuracy);
    tapStats.worstAccuracy = Math.min(...tapStats.accuracyScores);

    const feedbackEl = document.getElementById("tapIndicator");
    if (feedbackEl) {
      feedbackEl.classList.add("tap-flash");
      setTimeout(() => feedbackEl?.classList.remove("tap-flash"), 150);
    }

    if (Math.abs(timingOffset) < TAP_SYNC_TOLERANCE_MS){
      tapFeedback.textContent = `✓ Perfect! (${accuracy.toFixed(0)}%)`;
      tapFeedback.className = "tap-feedback good";
    } else if (timingOffset > 0){
      tapFeedback.textContent = `→ Late by ${(timingOffset * 1000).toFixed(0)}ms (${accuracy.toFixed(0)}%)`;
      tapFeedback.className = "tap-feedback";
    } else {
      tapFeedback.textContent = `← Ahead by ${Math.abs(timingOffset * 1000).toFixed(0)}ms (${accuracy.toFixed(0)}%)`;
      tapFeedback.className = "tap-feedback";
    }
    tapFeedback.style.display = "block";
    updateTapStats();
  }

  function stopMicDetection(){
    if (micStream){
      micStream.getTracks().forEach(t => t.stop());
      micStream = null;
      audioAnalyser = null;
    }
  }

  // ---------- Practice features setup ----------
  tapAlongCb.addEventListener("change", (e)=> {
    tapAlongMode = e.target.checked;
    tapFeedback.style.display = tapAlongMode && isPlaying ? "block" : "none";
    tapTimings = [];
    tapStats = { totalTaps: 0, accuracyScores: [], avgAccuracy: 0, bestAccuracy: 100, worstAccuracy: 0 };
    const statsEl = document.getElementById("tapStats");
    if (statsEl) statsEl.innerHTML = "";
    if (tapAlongMode && isPlaying){
      startMicDetection();
    } else {
      stopMicDetection();
    }
  });

  loopModeCb.addEventListener("change", (e)=> {
    loopMode = e.target.checked;
    loopControls.style.display = loopMode ? "flex" : "none";
  });

  loopStartSel.addEventListener("change", (e)=> {
    loopStart = parseInt(e.target.value, 10);
    loopEnd = Math.max(loopStart, loopEnd);
    loopEndSel.value = loopEnd;
  });

  loopEndSel.addEventListener("change", (e)=> {
    loopEnd = parseInt(e.target.value, 10);
    loopStart = Math.min(loopStart, loopEnd);
    loopStartSel.value = loopStart;
  });

  tempoRampCb.addEventListener("change", (e)=> {
    tempoRampMode = e.target.checked;
    tempoRampControls.style.display = tempoRampMode ? "flex" : "none";
  });

  rampAmount.addEventListener("change", (e)=> {
    tempoRampAmount = Math.max(1, parseInt(e.target.value, 10));
  });

  rampInterval.addEventListener("change", (e)=> {
    tempoRampInterval = Math.max(1, parseInt(e.target.value, 10));
  });

  sessionTimerCb.addEventListener("change", (e)=> {
    sessionTimerMode = e.target.checked;
    sessionTimerControls.style.display = sessionTimerMode ? "flex" : "none";
  });

  timerDuration.addEventListener("change", (e)=> {
    sessionTimerDuration = Math.max(1, parseInt(e.target.value, 10));
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
  applyTheme(currentTheme);
  buildTaalSelector();
  buildBeatStrip();
  updateLoopSelects();
  updateStatsIdle();
  setBpm(bpm);
  setVolume(volume*100);

  ensureAudio();
})();
