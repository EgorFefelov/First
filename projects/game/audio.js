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
  // 1. ВОЗДУШНАЯ ПЕРЕВОЗКА: Звук самолёта изнутри (салон / кабина)
  // ----------------------------------------------------
  let airState = { jetFlapGain: null, jetSpeedGain: null, jetFilter: null };

  function startAirMode() {
    stopCurrent();
    const c = getContext();
    if (!c) return;
    currentMode = "air";

    const airGain = c.createGain();
    airGain.gain.setValueAtTime(0.01, c.currentTime);
    airGain.gain.exponentialRampToValueAtTime(0.85, c.currentTime + 1.2);
    airGain.connect(masterGain);
    activeNodes.push(airGain);

    // Низкочастотный рокот турбин и фюзеляжа (60-120 Гц)
    const rumbleNoise = c.createBufferSource();
    rumbleNoise.buffer = createNoiseBuffer(6, "brown");
    rumbleNoise.loop = true;
    const rumbleFilter = c.createBiquadFilter();
    rumbleFilter.type = "lowpass";
    rumbleFilter.frequency.setValueAtTime(95, c.currentTime);
    const rumbleGain = c.createGain();
    rumbleGain.gain.setValueAtTime(0.72, c.currentTime);
    rumbleNoise.connect(rumbleFilter);
    rumbleFilter.connect(rumbleGain);
    rumbleGain.connect(airGain);
    rumbleNoise.start();
    activeNodes.push(rumbleNoise, rumbleGain);

    // Гармоники гула двигателей самолёта
    const freqs = [58, 116, 232, 464];
    freqs.forEach((freq, i) => {
      const osc = c.createOscillator();
      osc.type = i === 0 ? "sawtooth" : "sine";
      osc.frequency.setValueAtTime(freq, c.currentTime);
      const oscGain = c.createGain();
      oscGain.gain.setValueAtTime(0.09 / (i + 1), c.currentTime);
      const oscFilter = c.createBiquadFilter();
      oscFilter.type = "lowpass";
      oscFilter.frequency.setValueAtTime(450, c.currentTime);
      osc.connect(oscFilter);
      oscFilter.connect(oscGain);
      oscGain.connect(airGain);
      osc.start();
      activeNodes.push(osc, oscGain);
    });

    // Шум системы герметизации, кондиционирования и набегающего воздуха за бортом
    const cabinAir = c.createBufferSource();
    cabinAir.buffer = createNoiseBuffer(7, "pink");
    cabinAir.loop = true;
    const cabinFilter = c.createBiquadFilter();
    cabinFilter.type = "bandpass";
    cabinFilter.frequency.setValueAtTime(680, c.currentTime);
    cabinFilter.Q.setValueAtTime(0.85, c.currentTime);
    const cabinGain = c.createGain();
    cabinGain.gain.setValueAtTime(0.38, c.currentTime);
    cabinAir.connect(cabinFilter);
    cabinFilter.connect(cabinGain);
    cabinGain.connect(airGain);
    cabinAir.start();
    activeNodes.push(cabinAir, cabinGain);

    // Дополнительный отклик на закрылки/подъём высоты
    const flapGain = c.createGain();
    flapGain.gain.setValueAtTime(0, c.currentTime);
    cabinAir.connect(flapGain);
    flapGain.connect(airGain);
    airState.jetFlapGain = flapGain;
    airState.jetFilter = cabinFilter;
  }

  function pulseAirplane() {
    if (currentMode !== "air" || !ctx || !airState.jetFlapGain) return;
    try {
      const now = ctx.currentTime;
      airState.jetFlapGain.gain.cancelScheduledValues(now);
      airState.jetFlapGain.gain.setValueAtTime(0.22, now);
      airState.jetFlapGain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    } catch (_) {}
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
  // 4. ПРОДАЖА ОРУЖИЯ (Mac / Браузер): Спокойная офисная фоновая музыка
  // ----------------------------------------------------
  function startSaleOfficeMode() {
    stopCurrent();
    const c = getContext();
    if (!c) return;
    currentMode = "sale";

    const officeGain = c.createGain();
    officeGain.gain.setValueAtTime(0.01, c.currentTime);
    officeGain.gain.exponentialRampToValueAtTime(0.65, c.currentTime + 1.2);
    officeGain.connect(masterGain);
    activeNodes.push(officeGain);

    // Легкая реверберация/эхо для мягкого звучания клавиш
    const delay = c.createDelay(1.0);
    delay.delayTime.setValueAtTime(0.38, c.currentTime);
    const delayGain = c.createGain();
    delayGain.gain.setValueAtTime(0.28, c.currentTime);
    delay.connect(delayGain);
    delayGain.connect(delay);
    delay.connect(officeGain);
    activeNodes.push(delay, delayGain);

    // Спокойная джазовая / lofi последовательность аккордов (72 BPM)
    // Cmaj9 -> Am9 -> Fmaj7 -> Em7 -> Dm9 -> G7sus4
    const officeChords = [
      { notes: [261.63, 329.63, 392.0, 493.88, 587.33], bass: 65.41 },  // Cmaj9 (C2 bass)
      { notes: [220.0, 261.63, 329.63, 392.0, 493.88], bass: 55.0 },    // Am9 (A1 bass)
      { notes: [174.61, 220.0, 261.63, 329.63, 392.0], bass: 43.65 },   // Fmaj7 (F1 bass)
      { notes: [164.81, 196.0, 246.94, 293.66, 329.63], bass: 41.2 },   // Em7 (E1 bass)
      { notes: [146.83, 174.61, 220.0, 261.63, 329.63], bass: 73.42 },   // Dm9 (D2 bass)
      { notes: [196.0, 261.63, 293.66, 349.23, 440.0], bass: 49.0 }     // G7sus4 (G1 bass)
    ];

    let step = 0;
    const barDuration = 4.2; // ~4.2 секунды на аккорд (спокойный темп)

    function playRhodesNote(freq, time, velocity = 0.5) {
      if (!ctx || currentMode !== "sale") return;
      // FM синтез мягкого электропианино Rhodes
      const carrier = ctx.createOscillator();
      carrier.type = "sine";
      carrier.frequency.setValueAtTime(freq, time);

      const mod = ctx.createOscillator();
      mod.type = "sine";
      mod.frequency.setValueAtTime(freq * 2, time);
      const modGain = ctx.createGain();
      modGain.gain.setValueAtTime(freq * 0.45 * velocity, time);
      modGain.gain.exponentialRampToValueAtTime(1, time + 2.2);
      mod.connect(modGain);
      modGain.connect(carrier.frequency);

      const noteGain = ctx.createGain();
      noteGain.gain.setValueAtTime(0.001, time);
      noteGain.gain.exponentialRampToValueAtTime(0.09 * velocity, time + 0.03);
      noteGain.gain.exponentialRampToValueAtTime(0.0001, time + 3.8);

      carrier.connect(noteGain);
      noteGain.connect(officeGain);
      noteGain.connect(delay);

      mod.start(time);
      carrier.start(time);
      mod.stop(time + 4.0);
      carrier.stop(time + 4.0);
    }

    function playBassNote(freq, time) {
      if (!ctx || currentMode !== "sale") return;
      const bass = ctx.createOscillator();
      bass.type = "triangle";
      bass.frequency.setValueAtTime(freq, time);
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(160, time);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, time);
      gain.gain.exponentialRampToValueAtTime(0.24, time + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 3.2);

      bass.connect(filter);
      filter.connect(gain);
      gain.connect(officeGain);
      bass.start(time);
      bass.stop(time + 3.4);
    }

    function scheduleOfficeBar() {
      if (!ctx || currentMode !== "sale") return;
      const now = ctx.currentTime;
      const chord = officeChords[step % officeChords.length];
      step++;

      // Бас-нота на первую долю
      playBassNote(chord.bass, now + 0.05);

      // Аккорд Rhodes (мягко арпеджирован с микросдвигом 0.025с)
      chord.notes.forEach((f, i) => {
        playRhodesNote(f, now + 0.05 + i * 0.028, 0.7 - i * 0.08);
      });

      // Мягкое дополнение во второй половине такта
      setTimeout(() => {
        if (currentMode === "sale" && ctx) {
          const compNote = chord.notes[Math.floor(Math.random() * chord.notes.length)];
          playRhodesNote(compNote, ctx.currentTime, 0.45);
        }
      }, 2100);
    }

    scheduleOfficeBar();
    schedulerTimer = setInterval(scheduleOfficeBar, barDuration * 1000);
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
    pulseAirplane,
    setTruckSpeed,
    getCurrentMode: () => currentMode
  };
})();
