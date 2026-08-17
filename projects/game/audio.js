// projects/game/audio.js — звуковое и музыкальное сопровождение всех режимов игры.
// Работает через Web Audio API: 100% автономно, без внешних файлов и без задержек.

(() => {
  let ctx = null;
  let masterGain = null;
  let currentMode = null;
  let activeNodes = [];
  let schedulerTimer = null;
  let initialized = false;

  function getContext() {
    if (!ctx) {
      const AudioEngine = window.AudioContext || window.webkitAudioContext;
      if (AudioEngine) {
        ctx = new AudioEngine();
        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.setValueAtTime(-18, ctx.currentTime);
        compressor.knee.setValueAtTime(12, ctx.currentTime);
        compressor.ratio.setValueAtTime(4, ctx.currentTime);
        compressor.attack.setValueAtTime(0.005, ctx.currentTime);
        compressor.release.setValueAtTime(0.12, ctx.currentTime);

        masterGain = ctx.createGain();
        masterGain.gain.setValueAtTime(0.85, ctx.currentTime);
        masterGain.connect(compressor);
        compressor.connect(ctx.destination);
      }
    }
    if (ctx && ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    return ctx;
  }

  function initOnGesture() {
    if (initialized) return;
    const unlock = () => {
      const c = getContext();
      if (c && c.state === "running") {
        initialized = true;
        window.removeEventListener("click", unlock);
        window.removeEventListener("keydown", unlock);
        window.removeEventListener("pointerdown", unlock);
      }
    };
    window.addEventListener("click", unlock, { passive: true });
    window.addEventListener("keydown", unlock, { passive: true });
    window.addEventListener("pointerdown", unlock, { passive: true });
  }
  initOnGesture();

  function stopCurrent() {
    if (schedulerTimer) {
      clearInterval(schedulerTimer);
      clearTimeout(schedulerTimer);
      schedulerTimer = null;
    }
    activeNodes.forEach(node => {
      try {
        if (node.stop) node.stop();
        if (node.gain && node.gain.setTargetAtTime && ctx) {
          node.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
        }
        setTimeout(() => {
          try { node.disconnect(); } catch (_) {}
        }, 300);
      } catch (_) {}
    });
    activeNodes = [];
    currentMode = null;
  }

  function createNoiseBuffer(duration = 5, type = "pink") {
    const context = getContext();
    if (!context) return null;
    const sampleRate = context.sampleRate;
    const buffer = context.createBuffer(2, sampleRate * duration, sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      let lastOut = 0;
      for (let i = 0; i < data.length; i++) {
        const white = Math.random() * 2 - 1;
        if (type === "pink") {
          b0 = 0.99886 * b0 + white * 0.0555179;
          b1 = 0.99332 * b1 + white * 0.0750759;
          b2 = 0.96900 * b2 + white * 0.1538520;
          b3 = 0.86650 * b3 + white * 0.3104856;
          b4 = 0.55000 * b4 + white * 0.5329522;
          b5 = -0.7616 * b5 - white * 0.0168980;
          data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
          b6 = white * 0.115926;
        } else if (type === "brown") {
          lastOut = (lastOut + 0.02 * white) / 1.02;
          data[i] = lastOut * 3.5;
        } else {
          data[i] = white * 0.2;
        }
      }
    }
    return buffer;
  }

  // ----------------------------------------------------
  // 1. ВОЗДУШНАЯ ПЕРЕВОЗКА: Аркадная музыка (Flappy/Retro Arcade) + звуки взмаха и поражения
  // ----------------------------------------------------
  let airSequenceTimer = null;

  function playAirFlap() {
    const c = getContext();
    if (!c) return;
    try {
      const now = c.currentTime;
      const osc = c.createOscillator();
      const gain = c.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(260, now);
      osc.frequency.exponentialRampToValueAtTime(680, now + 0.11);

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.18, now + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);

      osc.connect(gain);
      gain.connect(masterGain);

      osc.start(now);
      osc.stop(now + 0.13);
    } catch (_) {}
  }

  function playAirGameOver() {
    const c = getContext();
    if (!c) return;
    try {
      const now = c.currentTime;
      // Классический аркадный нисходящий звук проигрыша (8-bit Defeat)
      const notes = [311.13, 293.66, 277.18, 261.63, 220.0]; // Eb4, D4, C#4, C4, A3
      notes.forEach((freq, i) => {
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = "triangle";
        const noteTime = now + i * 0.11;
        osc.frequency.setValueAtTime(freq, noteTime);
        osc.frequency.exponentialRampToValueAtTime(freq * 0.88, noteTime + 0.1);

        gain.gain.setValueAtTime(0.0001, noteTime);
        gain.gain.linearRampToValueAtTime(0.22, noteTime + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, noteTime + 0.12);

        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(noteTime);
        osc.stop(noteTime + 0.13);
      });

      // Финальный шум затухания
      const noise = c.createBufferSource();
      noise.buffer = createNoiseBuffer(0.4, "pink");
      const noiseFilter = c.createBiquadFilter();
      noiseFilter.type = "lowpass";
      noiseFilter.frequency.setValueAtTime(600, now + 0.45);
      noiseFilter.frequency.exponentialRampToValueAtTime(80, now + 0.85);

      const noiseGain = c.createGain();
      noiseGain.gain.setValueAtTime(0.0001, now + 0.45);
      noiseGain.gain.linearRampToValueAtTime(0.15, now + 0.48);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.88);

      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(masterGain);
      noise.start(now + 0.45);
      noise.stop(now + 0.9);
    } catch (_) {}
  }

  function playAirPickup() {
    const c = getContext();
    if (!c) return;
    try {
      const now = c.currentTime;
      const pitches = [587.33, 880.0]; // D5 -> A5
      pitches.forEach((freq, i) => {
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = "square";
        const t = now + i * 0.06;
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.linearRampToValueAtTime(0.08, t + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);

        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(t);
        osc.stop(t + 0.1);
      });
    } catch (_) {}
  }

  function startAirMode() {
    stopCurrent();
    const c = getContext();
    if (!c) return;
    currentMode = "air";

    const arcadeMaster = c.createGain();
    arcadeMaster.gain.setValueAtTime(0.01, c.currentTime);
    arcadeMaster.gain.exponentialRampToValueAtTime(0.62, c.currentTime + 0.5);
    arcadeMaster.connect(masterGain);
    activeNodes.push(arcadeMaster);

    // Весёлая аркадная мелодия и басс (132 BPM, 8-bit / Chiptune стиль)
    const bpm = 132;
    const stepDuration = 60 / bpm / 2; // 16-е доли (~0.114 сек)

    // Аркадные аккорды: C -> G -> Am -> F
    const bassline = [
      130.81, 130.81, 196.0, 130.81, 164.81, 130.81, 196.0, 164.81, // C
      98.0, 98.0, 146.83, 98.0, 123.47, 98.0, 146.83, 123.47,        // G
      110.0, 110.0, 164.81, 110.0, 130.81, 110.0, 164.81, 130.81,    // Am
      87.31, 87.31, 130.81, 87.31, 110.0, 87.31, 130.81, 110.0       // F
    ];

    const leadMelody = [
      523.25, 0, 659.25, 0, 783.99, 659.25, 523.25, 0,
      392.0, 0, 493.88, 0, 587.33, 493.88, 392.0, 0,
      440.0, 0, 523.25, 0, 659.25, 523.25, 440.0, 0,
      349.23, 0, 440.0, 0, 523.25, 440.0, 392.0, 523.25
    ];

    let tick = 0;
    function playArcadeTick() {
      if (currentMode !== "air" || !ctx) return;
      const now = ctx.currentTime;
      const stepIdx = tick % bassline.length;

      // Басовая 8-битная нота (Triangle)
      const bFreq = bassline[stepIdx];
      if (bFreq > 0) {
        const bOsc = ctx.createOscillator();
        const bGain = ctx.createGain();
        bOsc.type = "triangle";
        bOsc.frequency.setValueAtTime(bFreq, now);

        bGain.gain.setValueAtTime(0.0001, now);
        bGain.gain.linearRampToValueAtTime(0.24, now + 0.008);
        bGain.gain.exponentialRampToValueAtTime(0.0001, now + stepDuration * 0.9);

        bOsc.connect(bGain);
        bGain.connect(arcadeMaster);
        bOsc.start(now);
        bOsc.stop(now + stepDuration);
      }

      // Мелодическая 8-битная нота (Square)
      const mFreq = leadMelody[stepIdx];
      if (mFreq > 0) {
        const mOsc = ctx.createOscillator();
        const mGain = ctx.createGain();
        mOsc.type = "pulse" in mOsc ? "pulse" : "square";
        mOsc.frequency.setValueAtTime(mFreq, now);

        mGain.gain.setValueAtTime(0.0001, now);
        mGain.gain.linearRampToValueAtTime(0.09, now + 0.01);
        mGain.gain.exponentialRampToValueAtTime(0.0001, now + stepDuration * 0.85);

        mOsc.connect(mGain);
        mGain.connect(arcadeMaster);
        mOsc.start(now);
        mOsc.stop(now + stepDuration);
      }

      // Аркадный шумовой хэт/снэр на каждую 4-ю долю
      if (stepIdx % 4 === 2) {
        const hat = ctx.createBufferSource();
        hat.buffer = createNoiseBuffer(0.05, "pink");
        const hFilter = ctx.createBiquadFilter();
        hFilter.type = "highpass";
        hFilter.frequency.setValueAtTime(3500, now);
        const hGain = ctx.createGain();
        hGain.gain.setValueAtTime(0.05, now);
        hGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
        hat.connect(hFilter);
        hFilter.connect(hGain);
        hGain.connect(arcadeMaster);
        hat.start(now);
        hat.stop(now + 0.05);
      }

      tick++;
    }

    schedulerTimer = setInterval(playArcadeTick, stepDuration * 1000);
  }

  // ----------------------------------------------------
  // 2. В ЗАЛОЖНИКАХ: Мистическая музыка/эмбиент для бродилок (3+ минуты)
  // ----------------------------------------------------
  function startHostageMode() {
    stopCurrent();
    const c = getContext();
    if (!c) return;
    currentMode = "hostage";

    const hostageGain = c.createGain();
    hostageGain.gain.setValueAtTime(0.01, c.currentTime);
    hostageGain.gain.exponentialRampToValueAtTime(0.9, c.currentTime + 1.5);
    hostageGain.connect(masterGain);
    activeNodes.push(hostageGain);

    // Задержка / эхо для мистического пространства коридоров
    const delay = c.createDelay(1.5);
    delay.delayTime.setValueAtTime(0.62, c.currentTime);
    const delayFeedback = c.createGain();
    delayFeedback.gain.setValueAtTime(0.46, c.currentTime);
    const delayFilter = c.createBiquadFilter();
    delayFilter.type = "lowpass";
    delayFilter.frequency.setValueAtTime(1400, c.currentTime);
    delay.connect(delayFilter);
    delayFilter.connect(delayFeedback);
    delayFeedback.connect(delay);
    delay.connect(hostageGain);
    activeNodes.push(delay, delayFeedback);

    // Тягучий зловещий низкочастотный дрон (Sub & Ominous Drone)
    const droneOsc1 = c.createOscillator();
    droneOsc1.type = "sawtooth";
    droneOsc1.frequency.setValueAtTime(36.7, c.currentTime); // D1
    const droneOsc2 = c.createOscillator();
    droneOsc2.type = "sine";
    droneOsc2.frequency.setValueAtTime(73.4, c.currentTime); // D2
    const droneFilter = c.createBiquadFilter();
    droneFilter.type = "lowpass";
    droneFilter.frequency.setValueAtTime(180, c.currentTime);
    droneFilter.Q.setValueAtTime(3.5, c.currentTime);

    // Медленная модуляция фильтра дрона (LFO 0.08 Гц)
    const droneLfo = c.createOscillator();
    droneLfo.frequency.setValueAtTime(0.08, c.currentTime);
    const droneLfoGain = c.createGain();
    droneLfoGain.gain.setValueAtTime(90, c.currentTime);
    droneLfo.connect(droneLfoGain);
    droneLfoGain.connect(droneFilter.frequency);
    droneLfo.start();

    const droneGain = c.createGain();
    droneGain.gain.setValueAtTime(0.42, c.currentTime);
    droneOsc1.connect(droneFilter);
    droneOsc2.connect(droneFilter);
    droneFilter.connect(droneGain);
    droneGain.connect(hostageGain);
    droneOsc1.start();
    droneOsc2.start();
    activeNodes.push(droneOsc1, droneOsc2, droneLfo, droneGain);

    // Эволюция гармоний и мистических аккордов на 180+ секунд (3+ минуты)
    const progression = [
      { chord: [146.83, 220.0, 261.63, 329.63], name: "Dm9", duration: 45 },      // D3, A3, C4, E4
      { chord: [116.54, 174.61, 233.08, 293.66], name: "Bbmaj7", duration: 45 },  // Bb2, F3, Bb3, D4
      { chord: [98.0, 164.81, 196.0, 293.66], name: "Gm7", duration: 45 },        // G2, E3, G3, D4
      { chord: [110.0, 164.81, 220.0, 277.18], name: "A7b13", duration: 45 }      // A2, E3, A3, C#4
    ];

    let sectionIndex = 0;
    function playEerieChimes(baseFreq) {
      if (currentMode !== "hostage" || !ctx) return;
      const now = ctx.currentTime;
      const chimeFreqs = [baseFreq * 1.5, baseFreq * 2, baseFreq * 2.4, baseFreq * 3];
      const targetFreq = chimeFreqs[Math.floor(Math.random() * chimeFreqs.length)];

      const chime = ctx.createOscillator();
      chime.type = "sine";
      chime.frequency.setValueAtTime(targetFreq, now);

      // FM модулятор для колокольного металлического призвука
      const mod = ctx.createOscillator();
      mod.type = "triangle";
      mod.frequency.setValueAtTime(targetFreq * 2.76, now);
      const modGain = ctx.createGain();
      modGain.gain.setValueAtTime(targetFreq * 1.8, now);
      modGain.gain.exponentialRampToValueAtTime(1, now + 3.2);
      mod.connect(modGain);
      modGain.connect(chime.frequency);

      const chimeEnv = ctx.createGain();
      chimeEnv.gain.setValueAtTime(0.001, now);
      chimeEnv.gain.exponentialRampToValueAtTime(0.12, now + 0.05);
      chimeEnv.gain.exponentialRampToValueAtTime(0.0001, now + 4.5);

      chime.connect(chimeEnv);
      chimeEnv.connect(hostageGain);
      chimeEnv.connect(delay);

      mod.start(now);
      chime.start(now);
      mod.stop(now + 4.6);
      chime.stop(now + 4.6);
    }

    function scheduleHostageAtmosphere() {
      if (currentMode !== "hostage" || !ctx) return;
      const sec = progression[sectionIndex % progression.length];
      sectionIndex++;

      // Запуск ноты/аккорда
      sec.chord.forEach((noteFreq, i) => {
        const osc = ctx.createOscillator();
        osc.type = i % 2 === 0 ? "sine" : "triangle";
        osc.frequency.setValueAtTime(noteFreq, ctx.currentTime);

        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(600, ctx.currentTime);

        const env = ctx.createGain();
        env.gain.setValueAtTime(0.001, ctx.currentTime);
        env.gain.exponentialRampToValueAtTime(0.06 / (i + 1), ctx.currentTime + 3.5);
        env.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + sec.duration);

        osc.connect(filter);
        filter.connect(env);
        env.connect(hostageGain);
        env.connect(delay);
        osc.start();
        osc.stop(ctx.currentTime + sec.duration + 1);
      });

      // Периодические одиночные мистические отзвуки
      for (let t = 4; t < sec.duration - 4; t += 7 + Math.random() * 5) {
        setTimeout(() => {
          if (currentMode === "hostage") playEerieChimes(sec.chord[0]);
        }, t * 1000);
      }
    }

    scheduleHostageAtmosphere();
    schedulerTimer = setInterval(scheduleHostageAtmosphere, 45000);
  }

  // ----------------------------------------------------
  // 3. ПЕРЕВОЗКА ОРУЖИЯ: Звук двигателя и движения машины / грузовика
  // ----------------------------------------------------
  let truckEngineState = { osc1: null, osc2: null, filter: null, noiseGain: null, gain: null };

  function startTransportMode() {
    stopCurrent();
    const c = getContext();
    if (!c) return;
    currentMode = "transport";

    const transportGain = c.createGain();
    transportGain.gain.setValueAtTime(0.01, c.currentTime);
    transportGain.gain.exponentialRampToValueAtTime(0.85, c.currentTime + 1.0);
    transportGain.connect(masterGain);
    activeNodes.push(transportGain);

    // Основной осциллятор тактов дизельного двигателя
    const engineOsc = c.createOscillator();
    engineOsc.type = "sawtooth";
    engineOsc.frequency.setValueAtTime(32, c.currentTime); // Базовый холостой ход ~950 RPM

    const subOsc = c.createOscillator();
    subOsc.type = "triangle";
    subOsc.frequency.setValueAtTime(16, c.currentTime);

    const engineFilter = c.createBiquadFilter();
    engineFilter.type = "lowpass";
    engineFilter.frequency.setValueAtTime(180, c.currentTime);
    engineFilter.Q.setValueAtTime(4.2, c.currentTime);

    const engineGain = c.createGain();
    engineGain.gain.setValueAtTime(0.68, c.currentTime);

    engineOsc.connect(engineFilter);
    subOsc.connect(engineFilter);
    engineFilter.connect(engineGain);
    engineGain.connect(transportGain);
    engineOsc.start();
    subOsc.start();
    activeNodes.push(engineOsc, subOsc, engineGain);

    // Звук трения шин об асфальт/грунт и набегающего ветра
    const tireNoise = c.createBufferSource();
    tireNoise.buffer = createNoiseBuffer(6, "pink");
    tireNoise.loop = true;
    const tireFilter = c.createBiquadFilter();
    tireFilter.type = "bandpass";
    tireFilter.frequency.setValueAtTime(340, c.currentTime);
    tireFilter.Q.setValueAtTime(1.1, c.currentTime);
    const tireGain = c.createGain();
    tireGain.gain.setValueAtTime(0.24, c.currentTime);
    tireNoise.connect(tireFilter);
    tireFilter.connect(tireGain);
    tireGain.connect(transportGain);
    tireNoise.start();
    activeNodes.push(tireNoise, tireGain);

    truckEngineState = {
      osc1: engineOsc,
      osc2: subOsc,
      filter: engineFilter,
      noiseGain: tireGain,
      gain: engineGain
    };
  }

  function setTruckSpeed(ratio) { // ratio от 0 (холостой) до 1 (максимальная скорость)
    if ((currentMode !== "transport" && currentMode !== "offroad") || !ctx || !truckEngineState.osc1) return;
    try {
      const clamped = Math.max(0, Math.min(1.4, ratio));
      const targetFreq = 26 + clamped * 54;
      const now = ctx.currentTime;
      truckEngineState.osc1.frequency.setTargetAtTime(targetFreq, now, 0.08);
      if (truckEngineState.osc2) truckEngineState.osc2.frequency.setTargetAtTime(targetFreq * 0.5, now, 0.08);
      if (truckEngineState.filter) truckEngineState.filter.frequency.setTargetAtTime(140 + clamped * 280, now, 0.08);
      if (truckEngineState.noiseGain) truckEngineState.noiseGain.gain.setTargetAtTime(0.12 + clamped * 0.35, now, 0.08);
    } catch (_) {}
  }

  // ----------------------------------------------------
  // 4. ПРОДАЖА ОРУЖИЯ (Mac / Браузер): Ультра-спокойный, тёплый Lo-Fi джаз
  // ----------------------------------------------------
  function startSaleOfficeMode() {
    stopCurrent();
    const c = getContext();
    if (!c) return;
    currentMode = "sale";

    const lofiMaster = c.createGain();
    lofiMaster.gain.setValueAtTime(0.01, c.currentTime);
    lofiMaster.gain.exponentialRampToValueAtTime(0.68, c.currentTime + 1.2);
    lofiMaster.connect(masterGain);
    activeNodes.push(lofiMaster);

    // Уютный лёгкий шум винила и теплоты плёнки
    const vinylNoise = c.createBufferSource();
    vinylNoise.buffer = createNoiseBuffer(8, "pink");
    vinylNoise.loop = true;
    const vinylFilter = c.createBiquadFilter();
    vinylFilter.type = "bandpass";
    vinylFilter.frequency.setValueAtTime(1200, c.currentTime);
    vinylFilter.Q.setValueAtTime(0.6, c.currentTime);
    const vinylGain = c.createGain();
    vinylGain.gain.setValueAtTime(0.045, c.currentTime);
    vinylNoise.connect(vinylFilter);
    vinylFilter.connect(vinylGain);
    vinylGain.connect(lofiMaster);
    vinylNoise.start();
    activeNodes.push(vinylNoise, vinylGain);

    // Мягкий стерео-дилэй для объёмного звучания клавиш
    const delay = c.createDelay(1.2);
    delay.delayTime.setValueAtTime(0.44, c.currentTime);
    const delayFilter = c.createBiquadFilter();
    delayFilter.type = "lowpass";
    delayFilter.frequency.setValueAtTime(1100, c.currentTime);
    const delayGain = c.createGain();
    delayGain.gain.setValueAtTime(0.32, c.currentTime);
    delay.connect(delayFilter);
    delayFilter.connect(delayGain);
    delayGain.connect(delay);
    delay.connect(lofiMaster);
    activeNodes.push(delay, delayGain);

    // Очень мягкая, успокаивающая гармония Lo-Fi Jazz (Dbmaj9 -> Abmaj7 -> Bbm9 -> Gbmaj7 -> Fm7 -> Ebm9 -> Ab13)
    const lofiChords = [
      { notes: [277.18, 349.23, 415.30, 523.25, 622.25], bass: 69.30 }, // Dbmaj9 (Db2)
      { notes: [207.65, 261.63, 311.13, 392.00, 523.25], bass: 51.91 }, // Abmaj7 (Ab1)
      { notes: [233.08, 277.18, 349.23, 415.30, 523.25], bass: 58.27 }, // Bbm9 (Bb1)
      { notes: [185.00, 233.08, 277.18, 349.23, 466.16], bass: 46.25 }, // Gbmaj7 (Gb1)
      { notes: [174.61, 207.65, 261.63, 311.13, 392.00], bass: 43.65 }, // Fm7 (F1)
      { notes: [155.56, 185.00, 233.08, 277.18, 349.23], bass: 77.78 }, // Ebm9 (Eb2)
      { notes: [207.65, 261.63, 311.13, 369.99, 440.00], bass: 51.91 }  // Ab13 (Ab1)
    ];

    let chordIndex = 0;
    const chordDuration = 4.8; // ~4.8 секунды на аккорд (очень спокойный чилловый темп)

    function playWarmRhodes(freq, time, velocity = 0.5) {
      if (!ctx || currentMode !== "sale") return;
      const carrier = ctx.createOscillator();
      carrier.type = "sine";
      carrier.frequency.setValueAtTime(freq, time);

      // Микро-детонация / flutter плёнки
      const lfo = ctx.createOscillator();
      lfo.frequency.setValueAtTime(4.2, time);
      const lfoGain = ctx.createGain();
      lfoGain.gain.setValueAtTime(freq * 0.003, time);
      lfo.connect(lfoGain);
      lfoGain.connect(carrier.frequency);

      const mod = ctx.createOscillator();
      mod.type = "sine";
      mod.frequency.setValueAtTime(freq * 2, time);
      const modGain = ctx.createGain();
      modGain.gain.setValueAtTime(freq * 0.35 * velocity, time);
      modGain.gain.exponentialRampToValueAtTime(1, time + 2.6);
      mod.connect(modGain);
      modGain.connect(carrier.frequency);

      const noteGain = ctx.createGain();
      noteGain.gain.setValueAtTime(0.0001, time);
      noteGain.gain.linearRampToValueAtTime(0.085 * velocity, time + 0.04);
      noteGain.gain.exponentialRampToValueAtTime(0.0001, time + 4.4);

      carrier.connect(noteGain);
      noteGain.connect(lofiMaster);
      noteGain.connect(delay);

      lfo.start(time);
      mod.start(time);
      carrier.start(time);
      lfo.stop(time + 4.5);
      mod.stop(time + 4.5);
      carrier.stop(time + 4.5);
    }

    function playWarmBass(freq, time) {
      if (!ctx || currentMode !== "sale") return;
      const bass = ctx.createOscillator();
      bass.type = "triangle";
      bass.frequency.setValueAtTime(freq, time);

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(130, time);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.linearRampToValueAtTime(0.26, time + 0.06);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 3.8);

      bass.connect(filter);
      filter.connect(gain);
      gain.connect(lofiMaster);
      bass.start(time);
      bass.stop(time + 4.0);
    }

    function playLoFiBell(freq, time) {
      if (!ctx || currentMode !== "sale") return;
      const bell = ctx.createOscillator();
      bell.type = "sine";
      bell.frequency.setValueAtTime(freq, time);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.linearRampToValueAtTime(0.045, time + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 1.8);

      bell.connect(gain);
      gain.connect(lofiMaster);
      gain.connect(delay);
      bell.start(time);
      bell.stop(time + 1.9);
    }

    function scheduleLoFiBar() {
      if (!ctx || currentMode !== "sale") return;
      const now = ctx.currentTime;
      const chord = lofiChords[chordIndex % lofiChords.length];
      chordIndex++;

      // Тёплый бас
      playWarmBass(chord.bass, now + 0.05);

      // Мягкий джазовый аккорд
      chord.notes.forEach((f, i) => {
        playWarmRhodes(f, now + 0.05 + i * 0.035, 0.65 - i * 0.07);
      });

      // Нежные одиночные ноты на заднем плане
      setTimeout(() => {
        if (currentMode === "sale" && ctx) {
          const highNote = chord.notes[Math.floor(Math.random() * chord.notes.length)] * 1.5;
          playLoFiBell(highNote, ctx.currentTime);
        }
      }, 1600);

      setTimeout(() => {
        if (currentMode === "sale" && ctx) {
          const secondNote = chord.notes[2];
          playWarmRhodes(secondNote, ctx.currentTime, 0.4);
        }
      }, 2900);
    }

    scheduleLoFiBar();
    schedulerTimer = setInterval(scheduleLoFiBar, chordDuration * 1000);
  }

  // ----------------------------------------------------
  // Экспорт единого менеджера аудио
  // ----------------------------------------------------
  window.GameAudio = {
    init: () => getContext(),
    playMode: mode => {
      getContext();
      if (mode === "air") startAirMode();
      else if (mode === "hostage") startHostageMode();
      else if (mode === "transport" || mode === "offroad") startTransportMode();
      else if (mode === "sale") startSaleOfficeMode();
      else stopCurrent();
    },
    stop: stopCurrent,
    playAirFlap,
    playAirGameOver,
    playAirPickup,
    pulseAirplane: playAirFlap,
    setTruckSpeed,
    getCurrentMode: () => currentMode
  };
})();
