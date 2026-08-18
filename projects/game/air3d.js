// projects/game/air3d.js — Полноценный 3D Авиасимулятор «Воздушная перевозка оружия».
// Three.js: Мгновенный рендеринг без чёрного экрана, взлёт с военной полосы,
// физика 6-DOF, сбор ящиков в воздухе, смена видов (V), военное небо и HUD.

(() => {
  const THREE = window.THREE;
  if (!THREE) {
    console.error("Three.js not found for Air3D simulator!");
    return;
  }

  let canvas, renderer, scene, camera;
  let animId = null;
  let isRunning = false;
  let isPreviewMode = true; // true = самолёт ждёт взлёта на полосе (кинематографичный предпросмотр)
  let isPaused = false;
  let cameraMode = 0; // 0 = 3-е лицо (сзади), 1 = 1-е лицо (кокпит)

  // Состояние самолета и физика
  const planeState = {
    pos: new THREE.Vector3(0, 1.8, 280),
    vel: new THREE.Vector3(0, 0, 0),
    rot: new THREE.Euler(0, Math.PI, 0, "YXZ"),
    quat: new THREE.Quaternion(),
    speed: 0,
    throttle: 0.0,
    afterburner: false,
    airbrake: false,
    altitude: 1.8,
    isGrounded: true,
    gearExtended: 1.0,
    gearTarget: 1.0,
    pitchRate: 0,
    rollRate: 0,
    yawRate: 0,
    gForce: 1.0,
    health: 100,
    maxHealth: 100,
    flares: 16,
    collected: { ammo: 0, weapon: 0, grenade: 0 },
    totalCollected: 0,
    distanceToTarget: 0,
    nearestCrate: null,
    traveledDistance: 0,
    isDelivered: false
  };

  const keys = Object.create(null);
  const mouse = {
    x: 0,
    y: 0,
    targetPitch: 0,
    targetRoll: 0,
    targetYaw: 0
  };

  let airplaneGroup, airplaneBody, canopyMesh;
  let landingGears = [];
  let afterburnerFlames = [];
  let cockpitInterior, hudCanvas, hudCtx, hudTexture, hudMesh;
  let terrainMesh, runwayGroup, cloudsGroup = [], cratesGroup = [], flaresList = [], smokePuffs = [];
  let sunLight, ambientLight, hemiLight;
  let targetDropZone;

  // Звуковой движок
  let audioCtx = null;
  let turbineGain = null, turbineOsc = null, roarGain = null, roarFilter = null, roarSource = null;
  let windGain = null, windFilter = null, afterburnerGain = null;

  const matLib = {};

  function initAudio() {
    try {
      const AudioEngine = window.AudioContext || window.webkitAudioContext;
      if (!AudioEngine) return;
      if (!audioCtx) audioCtx = new AudioEngine();
      if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});

      if (turbineOsc) return; // уже инициализирован

      // 1. Свист турбины
      turbineOsc = audioCtx.createOscillator();
      turbineOsc.type = "sawtooth";
      turbineOsc.frequency.setValueAtTime(140, audioCtx.currentTime);

      const turbineFilter = audioCtx.createBiquadFilter();
      turbineFilter.type = "bandpass";
      turbineFilter.frequency.setValueAtTime(650, audioCtx.currentTime);
      turbineFilter.Q.setValueAtTime(4.5, audioCtx.currentTime);

      turbineGain = audioCtx.createGain();
      turbineGain.gain.setValueAtTime(0, audioCtx.currentTime);

      turbineOsc.connect(turbineFilter);
      turbineFilter.connect(turbineGain);
      turbineGain.connect(audioCtx.destination);
      turbineOsc.start();

      // 2. Гул тяги
      const bufferSize = audioCtx.sampleRate * 2;
      const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) output[i] = Math.random() * 2 - 1;

      roarSource = audioCtx.createBufferSource();
      roarSource.buffer = noiseBuffer;
      roarSource.loop = true;

      roarFilter = audioCtx.createBiquadFilter();
      roarFilter.type = "lowpass";
      roarFilter.frequency.setValueAtTime(280, audioCtx.currentTime);

      roarGain = audioCtx.createGain();
      roarGain.gain.setValueAtTime(0, audioCtx.currentTime);

      roarSource.connect(roarFilter);
      roarFilter.connect(roarGain);
      roarGain.connect(audioCtx.destination);
      roarSource.start();

      // 3. Форсажный бас
      const abFilter = audioCtx.createBiquadFilter();
      abFilter.type = "lowpass";
      abFilter.frequency.setValueAtTime(180, audioCtx.currentTime);
      afterburnerGain = audioCtx.createGain();
      afterburnerGain.gain.setValueAtTime(0, audioCtx.currentTime);
      roarSource.connect(abFilter);
      abFilter.connect(afterburnerGain);
      afterburnerGain.connect(audioCtx.destination);

      // 4. Шум ветра
      windFilter = audioCtx.createBiquadFilter();
      windFilter.type = "bandpass";
      windFilter.frequency.setValueAtTime(400, audioCtx.currentTime);
      windFilter.Q.setValueAtTime(1.2, audioCtx.currentTime);

      windGain = audioCtx.createGain();
      windGain.gain.setValueAtTime(0, audioCtx.currentTime);

      roarSource.connect(windFilter);
      windFilter.connect(windGain);
      windGain.connect(audioCtx.destination);
    } catch (e) {
      console.warn("Audio init error:", e);
    }
  }

  function updateAudio() {
    if (!audioCtx || !turbineGain || audioCtx.state !== "running" || isPreviewMode) {
      if (turbineGain) turbineGain.gain.setValueAtTime(0.015, audioCtx ? audioCtx.currentTime : 0);
      return;
    }
    const now = audioCtx.currentTime;
    const spdFrac = Math.min(1.5, planeState.speed / 400);
    const thr = planeState.throttle;

    const targetFreq = 160 + thr * 650 + spdFrac * 350;
    turbineOsc.frequency.setTargetAtTime(targetFreq, now, 0.08);
    turbineGain.gain.setTargetAtTime(0.06 + thr * 0.14, now, 0.08);

    const roarFreq = 120 + thr * 450 + spdFrac * 300;
    roarFilter.frequency.setTargetAtTime(roarFreq, now, 0.08);
    roarGain.gain.setTargetAtTime(0.1 + thr * 0.28, now, 0.08);

    if (planeState.afterburner) {
      afterburnerGain.gain.setTargetAtTime(0.45, now, 0.05);
    } else {
      afterburnerGain.gain.setTargetAtTime(0, now, 0.1);
    }

    windFilter.frequency.setTargetAtTime(250 + spdFrac * 800, now, 0.08);
    windGain.gain.setTargetAtTime(spdFrac * 0.22, now, 0.08);
  }

  function stopAudio() {
    try {
      if (turbineGain) turbineGain.gain.setValueAtTime(0, audioCtx.currentTime);
      if (roarGain) roarGain.gain.setValueAtTime(0, audioCtx.currentTime);
      if (afterburnerGain) afterburnerGain.gain.setValueAtTime(0, audioCtx.currentTime);
      if (windGain) windGain.gain.setValueAtTime(0, audioCtx.currentTime);
    } catch (e) {}
  }

  function playSfx(type) {
    if (!audioCtx) return;
    try {
      const now = audioCtx.currentTime;
      if (type === "pickup") {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(587.33, now);
        osc.frequency.setValueAtTime(880.00, now + 0.08);
        osc.frequency.setValueAtTime(1174.66, now + 0.16);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.46);
      } else if (type === "flare") {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(320, now);
        osc.frequency.exponentialRampToValueAtTime(60, now + 0.25);
        gain.gain.setValueAtTime(0.35, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.26);
      } else if (type === "switch_cam") {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "square";
        osc.frequency.setValueAtTime(1200, now);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.07);
      } else if (type === "takeoff") {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.exponentialRampToValueAtTime(440, now + 0.4);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.5);
      } else if (type === "victory") {
        const notes = [440, 554.37, 659.25, 880];
        notes.forEach((freq, i) => {
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = "triangle";
          osc.frequency.setValueAtTime(freq, now + i * 0.12);
          gain.gain.setValueAtTime(0.3, now + i * 0.12);
          gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.6);
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.start(now + i * 0.12);
          osc.stop(now + i * 0.12 + 0.65);
        });
      }
    } catch (e) {}
  }

  function initMaterials() {
    matLib.camoDark = new THREE.MeshStandardMaterial({ color: 0x1f272e, roughness: 0.6, metalness: 0.4 });
    matLib.camoGrey = new THREE.MeshStandardMaterial({ color: 0x424d57, roughness: 0.55, metalness: 0.45 });
    matLib.camoSand = new THREE.MeshStandardMaterial({ color: 0x6e6b5a, roughness: 0.7, metalness: 0.2 });
    matLib.darkMetal = new THREE.MeshStandardMaterial({ color: 0x111315, roughness: 0.4, metalness: 0.85 });
    matLib.chrome = new THREE.MeshStandardMaterial({ color: 0xd4d8db, roughness: 0.2, metalness: 0.95 });
    matLib.rubber = new THREE.MeshStandardMaterial({ color: 0x111112, roughness: 0.95, metalness: 0.05 });
    matLib.canopy = new THREE.MeshPhysicalMaterial({
      color: 0x68a0b5, transparent: true, opacity: 0.4, roughness: 0.1, metalness: 0.15, transmission: 0.85, ior: 1.45
    });
    matLib.glowOrange = new THREE.MeshBasicMaterial({ color: 0xff6600 });
    matLib.glowCyan = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
    matLib.glowGreen = new THREE.MeshBasicMaterial({ color: 0x00ff66 });
    matLib.glowRed = new THREE.MeshBasicMaterial({ color: 0xff1122 });
    matLib.runway = new THREE.MeshStandardMaterial({ color: 0x222428, roughness: 0.92, metalness: 0.08 });
    matLib.runwayLine = new THREE.MeshBasicMaterial({ color: 0xffffff });
    matLib.runwayYellow = new THREE.MeshBasicMaterial({ color: 0xffbb00 });
  }

  function buildAirplane() {
    airplaneGroup = new THREE.Group();

    // Нос
    const noseGeo = new THREE.ConeGeometry(0.7, 4.2, 7);
    noseGeo.rotateX(Math.PI / 2);
    const nose = new THREE.Mesh(noseGeo, matLib.camoDark);
    nose.position.set(0, 0, -4.6);
    airplaneGroup.add(nose);

    // ПВД
    const pitot = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.9, 6), matLib.chrome);
    pitot.rotation.x = Math.PI / 2;
    pitot.position.set(0, 0, -6.8);
    airplaneGroup.add(pitot);

    // Корпус
    const bodyGeo = new THREE.BoxGeometry(1.65, 1.15, 7.8);
    airplaneBody = new THREE.Mesh(bodyGeo, matLib.camoGrey);
    airplaneBody.position.set(0, 0, -0.6);
    airplaneGroup.add(airplaneBody);

    // Воздухозаборники
    [-1.05, 1.05].forEach(x => {
      const intake = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.8, 3.2), matLib.camoDark);
      intake.position.set(x, -0.15, -1.2);
      airplaneGroup.add(intake);

      const intakeHole = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.7), new THREE.MeshBasicMaterial({ color: 0x050505 }));
      intakeHole.position.set(x, -0.15, -2.81);
      intakeHole.rotation.y = Math.PI;
      airplaneGroup.add(intakeHole);
    });

    // Фонарь
    const canopyGeo = new THREE.BoxGeometry(0.85, 0.65, 3.2);
    canopyMesh = new THREE.Mesh(canopyGeo, matLib.canopy);
    canopyMesh.position.set(0, 0.72, -2.2);
    airplaneGroup.add(canopyMesh);

    // Пилот
    const pilotHead = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 10), new THREE.MeshStandardMaterial({ color: 0x1f3020, roughness: 0.8 }));
    pilotHead.position.set(0, 0.65, -2.1);
    airplaneGroup.add(pilotHead);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.15), new THREE.MeshStandardMaterial({ color: 0x0f1510, metalness: 0.9, roughness: 0.1 }));
    visor.position.set(0, 0.67, -2.25);
    airplaneGroup.add(visor);

    // Крылья
    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, 0);
    wingShape.lineTo(6.4, 2.2);
    wingShape.lineTo(6.2, 3.4);
    wingShape.lineTo(0, 2.1);
    wingShape.closePath();

    const extrudeSettings = { depth: 0.12, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.03, bevelThickness: 0.03 };
    const wingGeo = new THREE.ExtrudeGeometry(wingShape, extrudeSettings);
    wingGeo.rotateX(Math.PI / 2);

    const leftWing = new THREE.Mesh(wingGeo, matLib.camoDark);
    leftWing.position.set(0.7, -0.05, -2.2);
    airplaneGroup.add(leftWing);

    const rightWingGeo = wingGeo.clone();
    rightWingGeo.scale(-1, 1, 1);
    const rightWing = new THREE.Mesh(rightWingGeo, matLib.camoDark);
    rightWing.position.set(-0.7, -0.05, -2.2);
    airplaneGroup.add(rightWing);

    // Огни крыльев
    const leftNavLight = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 6), matLib.glowGreen);
    leftNavLight.position.set(7.1, 0, 0.5);
    airplaneGroup.add(leftNavLight);

    const rightNavLight = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 6), matLib.glowRed);
    rightNavLight.position.set(-7.1, 0, 0.5);
    airplaneGroup.add(rightNavLight);

    // Ракеты
    [-3.8, 3.8, -2.2, 2.2].forEach(x => {
      const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.35, 1.4), matLib.darkMetal);
      pylon.position.set(x, -0.25, -0.2);
      airplaneGroup.add(pylon);

      const missile = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 2.4, 8), matLib.camoSand);
      missile.rotation.x = Math.PI / 2;
      missile.position.set(x, -0.45, -0.2);
      airplaneGroup.add(missile);
    });

    // Хвост
    [-0.85, 0.85].forEach((x, i) => {
      const tailFinGeo = new THREE.BoxGeometry(0.12, 2.1, 1.9);
      const fin = new THREE.Mesh(tailFinGeo, matLib.camoGrey);
      fin.position.set(x, 1.05, 3.2);
      fin.rotation.z = (i === 0 ? 1 : -1) * 0.22;
      airplaneGroup.add(fin);
    });

    [-1.7, 1.7].forEach(x => {
      const elev = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 1.4), matLib.camoDark);
      elev.position.set(x, 0.1, 3.5);
      airplaneGroup.add(elev);
    });

    // Сопла
    [-0.52, 0.52].forEach(x => {
      const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, 0.8, 14), matLib.darkMetal);
      nozzle.rotation.x = Math.PI / 2;
      nozzle.position.set(x, 0.05, 3.4);
      airplaneGroup.add(nozzle);

      const coreGlow = new THREE.Mesh(new THREE.CircleGeometry(0.38, 12), matLib.glowOrange);
      coreGlow.position.set(x, 0.05, 3.81);
      airplaneGroup.add(coreGlow);

      const flameGeo = new THREE.ConeGeometry(0.4, 2.8, 10);
      flameGeo.rotateX(-Math.PI / 2);
      const flameMat = new THREE.MeshBasicMaterial({
        color: 0x3399ff,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending
      });
      const flame = new THREE.Mesh(flameGeo, flameMat);
      flame.position.set(x, 0.05, 5.2);
      flame.visible = false;
      airplaneGroup.add(flame);
      afterburnerFlames.push(flame);
    });

    // Шасси
    const frontGear = new THREE.Group();
    const frontStrut = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 8), matLib.chrome);
    frontStrut.position.y = -0.6;
    frontGear.add(frontStrut);
    const frontWheel = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.16, 12), matLib.rubber);
    frontWheel.rotation.z = Math.PI / 2;
    frontWheel.position.y = -1.15;
    frontGear.add(frontWheel);
    frontGear.position.set(0, -0.3, -3.2);
    airplaneGroup.add(frontGear);
    landingGears.push(frontGear);

    [-1.2, 1.2].forEach(x => {
      const mainGear = new THREE.Group();
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.2, 8), matLib.chrome);
      strut.position.y = -0.6;
      mainGear.add(strut);
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.22, 14), matLib.rubber);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.y = -1.15;
      mainGear.add(wheel);
      mainGear.position.set(x, -0.3, 0.6);
      airplaneGroup.add(mainGear);
      landingGears.push(mainGear);
    });

    buildCockpitInterior();

    airplaneGroup.scale.set(1.4, 1.4, 1.4);
    airplaneGroup.position.set(0, 1.8, 280);
    scene.add(airplaneGroup);
  }

  function buildCockpitInterior() {
    cockpitInterior = new THREE.Group();

    const dashGeo = new THREE.BoxGeometry(1.2, 0.6, 0.8);
    const dash = new THREE.Mesh(dashGeo, matLib.darkMetal);
    dash.position.set(0, 0.35, -2.6);
    dash.rotation.x = -0.35;
    cockpitInterior.add(dash);

    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.45, 8), matLib.chrome);
    stick.position.set(0, 0.25, -2.1);
    stick.rotation.x = 0.2;
    cockpitInterior.add(stick);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.08), matLib.rubber);
    handle.position.set(0, 0.45, -2.05);
    cockpitInterior.add(handle);

    const hudGlassGeo = new THREE.PlaneGeometry(0.7, 0.55);
    hudCanvas = document.createElement("canvas");
    hudCanvas.width = 512;
    hudCanvas.height = 512;
    hudCtx = hudCanvas.getContext("2d");

    hudTexture = new THREE.CanvasTexture(hudCanvas);
    hudTexture.generateMipmaps = false;
    hudTexture.minFilter = THREE.LinearFilter;

    const hudGlassMat = new THREE.MeshBasicMaterial({
      map: hudTexture,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });
    hudMesh = new THREE.Mesh(hudGlassGeo, hudGlassMat);
    hudMesh.position.set(0, 0.72, -2.48);
    hudMesh.rotation.x = -0.15;
    cockpitInterior.add(hudMesh);

    airplaneGroup.add(cockpitInterior);
  }

  function drawHud() {
    if (!hudCtx) return;
    const ctx = hudCtx;
    ctx.clearRect(0, 0, 512, 512);

    const green = "#00ff66";
    const brightGreen = "#77ffaa";
    const yellow = "#ffdd44";
    const red = "#ff3344";

    ctx.strokeStyle = green;
    ctx.fillStyle = green;
    ctx.lineWidth = 3;
    ctx.font = "bold 20px 'Courier New', monospace";
    ctx.textAlign = "center";

    const cx = 256, cy = 256;
    ctx.beginPath();
    ctx.arc(cx, cy, 14, 0, Math.PI * 2);
    ctx.moveTo(cx - 35, cy); ctx.lineTo(cx - 16, cy);
    ctx.moveTo(cx + 16, cy); ctx.lineTo(cx + 35, cy);
    ctx.moveTo(cx, cy - 35); ctx.lineTo(cx, cy - 16);
    ctx.stroke();

    const pitchDeg = (planeState.rot.x * 180 / Math.PI);
    const rollRad = planeState.rot.z;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-rollRad);

    for (let p = -40; p <= 40; p += 10) {
      if (p === 0) {
        ctx.setLineDash([12, 8]);
        ctx.beginPath();
        ctx.moveTo(-110, p * 4 + pitchDeg * 4);
        ctx.lineTo(110, p * 4 + pitchDeg * 4);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        const yOffset = -p * 4 + pitchDeg * 4;
        if (yOffset > -180 && yOffset < 180) {
          ctx.beginPath();
          ctx.moveTo(-45, yOffset); ctx.lineTo(-20, yOffset); ctx.lineTo(-20, yOffset + (p > 0 ? 6 : -6));
          ctx.moveTo(45, yOffset); ctx.lineTo(20, yOffset); ctx.lineTo(20, yOffset + (p > 0 ? 6 : -6));
          ctx.stroke();
          ctx.fillText(Math.abs(p).toString(), -60, yOffset + 6);
          ctx.fillText(Math.abs(p).toString(), 60, yOffset + 6);
        }
      }
    }
    ctx.restore();

    ctx.textAlign = "left";
    ctx.strokeRect(30, 160, 80, 192);
    ctx.fillText("SPD", 42, 190);
    ctx.font = "bold 26px 'Courier New', monospace";
    ctx.fillText(Math.round(planeState.speed).toString(), 40, 240);
    ctx.font = "bold 15px 'Courier New', monospace";
    ctx.fillText("KM/H", 42, 270);
    if (planeState.afterburner) {
      ctx.fillStyle = yellow;
      ctx.fillText("AB [ON]", 38, 330);
      ctx.fillStyle = green;
    }

    ctx.textAlign = "right";
    ctx.strokeRect(402, 160, 80, 192);
    ctx.fillText("ALT", 468, 190);
    ctx.font = "bold 26px 'Courier New', monospace";
    ctx.fillText(Math.round(planeState.altitude).toString(), 472, 240);
    ctx.font = "bold 15px 'Courier New', monospace";
    ctx.fillText("M", 450, 270);
    ctx.fillText(`G: ${planeState.gForce.toFixed(1)}`, 470, 330);

    ctx.textAlign = "center";
    ctx.strokeRect(140, 30, 232, 45);
    const heading = ((planeState.rot.y * 180 / Math.PI) % 360 + 360) % 360;
    ctx.font = "bold 22px 'Courier New', monospace";
    ctx.fillText(`HDG: ${Math.round(heading).toString().padStart(3, "0")}°`, 256, 62);

    ctx.font = "bold 18px 'Courier New', monospace";
    if (planeState.isGrounded) {
      ctx.fillStyle = yellow;
      ctx.fillText("RUNWAY TAKEOFF · PRESS [W] TO SPOOL UP", 256, 420);
    } else if (planeState.altitude < 15 && planeState.speed > 100) {
      ctx.fillStyle = red;
      ctx.fillText("⚠️ PULL UP · TERRAIN WARNING", 256, 420);
    } else if (planeState.speed < 110 && !planeState.isGrounded) {
      ctx.fillStyle = red;
      ctx.fillText("⚠️ STALL WARNING · ADD THROTTLE", 256, 420);
    } else {
      ctx.fillStyle = brightGreen;
      ctx.fillText(`GEAR: ${planeState.gearExtended > 0.5 ? "DOWN" : "UP"} | FLARES: ${planeState.flares}`, 256, 420);
    }

    if (planeState.nearestCrate) {
      ctx.strokeStyle = yellow;
      ctx.fillStyle = yellow;
      ctx.strokeRect(216, 100, 80, 28);
      ctx.font = "bold 15px 'Courier New', monospace";
      ctx.fillText(`BOX: ${Math.round(planeState.distanceToTarget)}M`, 256, 120);
    }

    hudTexture.needsUpdate = true;
  }

  function buildWorld() {
    // 1. Военное небо (градиент)
    const skyGeo = new THREE.SphereGeometry(6000, 32, 20);
    const canvasSky = document.createElement("canvas");
    canvasSky.width = 512;
    canvasSky.height = 512;
    const sCtx = canvasSky.getContext("2d");
    const grad = sCtx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, "#08101e");
    grad.addColorStop(0.35, "#182b45");
    grad.addColorStop(0.65, "#7a3e26");
    grad.addColorStop(0.82, "#d66c28");
    grad.addColorStop(1.0, "#2c1c14");
    sCtx.fillStyle = grad;
    sCtx.fillRect(0, 0, 512, 512);

    const skyTex = new THREE.CanvasTexture(canvasSky);
    const skyMat = new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    scene.add(sky);

    // 2. Свет
    ambientLight = new THREE.AmbientLight(0xdde5ee, 0.85);
    scene.add(ambientLight);

    sunLight = new THREE.DirectionalLight(0xffaa55, 2.4);
    sunLight.position.set(-800, 1200, -1500);
    scene.add(sunLight);

    hemiLight = new THREE.HemisphereLight(0x7090b0, 0x403020, 0.9);
    scene.add(hemiLight);

    // 3. Ландшафт
    const terrainGeo = new THREE.PlaneGeometry(12000, 12000, 80, 80);
    terrainGeo.rotateX(-Math.PI / 2);

    const pos = terrainGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const distFromCenter = Math.abs(x);
      let h = 0;
      if (distFromCenter > 250) {
        const factor = (distFromCenter - 250) / 1200;
        h = (Math.sin(x * 0.003) * Math.cos(z * 0.003) * 350 + Math.sin(x * 0.01 + z * 0.01) * 120) * factor;
        h = Math.max(0, h);
      }
      pos.setY(i, h);
    }
    terrainGeo.computeVertexNormals();

    const groundTex = new THREE.TextureLoader().load("afghan-desert-ground.png");
    groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
    groundTex.repeat.set(64, 64);
    const terrainMat = new THREE.MeshStandardMaterial({
      map: groundTex,
      color: 0x735c46,
      roughness: 0.95,
      metalness: 0.05,
      flatShading: true
    });
    terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
    terrainMesh.position.y = -0.5;
    scene.add(terrainMesh);

    // 4. Взлётная полоса
    runwayGroup = new THREE.Group();
    const runwayMesh = new THREE.Mesh(new THREE.PlaneGeometry(55, 1400), matLib.runway);
    runwayMesh.rotation.x = -Math.PI / 2;
    runwayMesh.position.set(0, 0.05, 0);
    runwayGroup.add(runwayMesh);

    for (let z = -650; z <= 650; z += 35) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 20), matLib.runwayLine);
      line.rotation.x = -Math.PI / 2;
      line.position.set(0, 0.1, z);
      runwayGroup.add(line);
    }

    [-24, 24].forEach(x => {
      const edge = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1400), matLib.runwayLine);
      edge.rotation.x = -Math.PI / 2;
      edge.position.set(x, 0.1, 0);
      runwayGroup.add(edge);
    });

    for (let z = -680; z <= 680; z += 40) {
      [-26, 26].forEach(x => {
        let col = matLib.glowCyan;
        if (z > 580) col = matLib.glowGreen;
        if (z < -580) col = matLib.glowRed;
        const light = new THREE.Mesh(new THREE.SphereGeometry(0.35, 6, 6), col);
        light.position.set(x, 0.4, z);
        runwayGroup.add(light);
      });
    }

    [-65, 65].forEach(x => {
      for (let z = 100; z <= 400; z += 120) {
        const hangar = new THREE.Mesh(new THREE.CylinderGeometry(18, 18, 45, 16, 1, false, 0, Math.PI), matLib.camoGrey);
        hangar.rotation.z = Math.PI / 2;
        hangar.rotation.y = Math.PI / 2;
        hangar.position.set(x, 0, z);
        runwayGroup.add(hangar);
      }
    });

    const towerBase = new THREE.Mesh(new THREE.CylinderGeometry(4, 6, 35, 8), matLib.camoDark);
    towerBase.position.set(-85, 17.5, 250);
    runwayGroup.add(towerBase);
    const towerTop = new THREE.Mesh(new THREE.CylinderGeometry(8, 7, 8, 10), matLib.canopy);
    towerTop.position.set(-85, 38, 250);
    runwayGroup.add(towerTop);

    scene.add(runwayGroup);

    // 5. Зона доставки
    targetDropZone = new THREE.Group();
    const zoneRing = new THREE.Mesh(new THREE.RingGeometry(25, 32, 32), matLib.glowGreen);
    zoneRing.rotation.x = -Math.PI / 2;
    zoneRing.position.set(0, 1.5, -4500);
    targetDropZone.add(zoneRing);

    const beaconLight = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 18, 300, 16), new THREE.MeshBasicMaterial({
      color: 0x00ff88, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
    }));
    beaconLight.position.set(0, 150, -4500);
    targetDropZone.add(beaconLight);
    scene.add(targetDropZone);

    buildClouds();
    spawnCargoCrates();
  }

  function buildClouds() {
    const cloudMat = new THREE.MeshStandardMaterial({
      color: 0xdfd8d0,
      roughness: 1,
      metalness: 0,
      transparent: true,
      opacity: 0.72,
      flatShading: true
    });

    for (let i = 0; i < 45; i++) {
      const cluster = new THREE.Group();
      const numPuffs = 5 + Math.floor(Math.random() * 6);
      for (let j = 0; j < numPuffs; j++) {
        const r = 25 + Math.random() * 35;
        const puff = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 1), cloudMat);
        puff.position.set((Math.random() - 0.5) * 80, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 80);
        cluster.add(puff);
      }
      cluster.position.set(
        (Math.random() - 0.5) * 3500,
        180 + Math.random() * 420,
        -Math.random() * 4600 + 300
      );
      scene.add(cluster);
      cloudsGroup.push(cluster);
    }
  }

  function spawnCargoCrates() {
    cratesGroup.forEach(c => scene.remove(c.mesh));
    cratesGroup = [];

    const crateTypes = [
      { type: "weapon", name: "Оружие", color: 0xffaa00, tex: "weapon-crate.png" },
      { type: "ammo", name: "Патроны", color: 0x00e5ff, tex: "ammo-crate.png" },
      { type: "grenade", name: "Гранаты", color: 0xff2244, tex: "grenade-crate.png" }
    ];

    for (let i = 0; i < 24; i++) {
      const info = crateTypes[i % 3];
      const crateObj = new THREE.Group();

      const boxGeo = new THREE.BoxGeometry(4.5, 4.5, 4.5);
      const boxTex = new THREE.TextureLoader().load(info.tex);
      const boxMat = new THREE.MeshStandardMaterial({ map: boxTex, roughness: 0.7, metalness: 0.2 });
      const boxMesh = new THREE.Mesh(boxGeo, boxMat);
      crateObj.add(boxMesh);

      const glowMat = new THREE.MeshBasicMaterial({ color: info.color, transparent: true, opacity: 0.65, blending: THREE.AdditiveBlending });
      const glowOrb = new THREE.Mesh(new THREE.SphereGeometry(6, 12, 12), glowMat);
      crateObj.add(glowOrb);

      const chuteGeo = new THREE.ConeGeometry(7, 4, 12, 1, true);
      const chuteMat = new THREE.MeshStandardMaterial({ color: 0x3d4b38, side: THREE.DoubleSide, roughness: 0.9 });
      const chute = new THREE.Mesh(chuteGeo, chuteMat);
      chute.position.y = 8;
      crateObj.add(chute);

      for (let k = 0; k < 4; k++) {
        const lineGeo = new THREE.CylinderGeometry(0.04, 0.04, 8);
        const line = new THREE.Mesh(lineGeo, matLib.darkMetal);
        const ang = (k * Math.PI) / 2;
        line.position.set(Math.cos(ang) * 2.8, 4.2, Math.sin(ang) * 2.8);
        line.rotation.z = (Math.cos(ang) > 0 ? 1 : -1) * 0.35;
        crateObj.add(line);
      }

      const zPos = -180 - i * 175 - Math.random() * 40;
      const xPos = (Math.sin(i * 0.8) * 220) + (Math.random() - 0.5) * 80;
      const yPos = 60 + Math.sin(i * 1.2) * 45 + Math.random() * 30;

      crateObj.position.set(xPos, yPos, zPos);
      scene.add(crateObj);

      cratesGroup.push({
        mesh: crateObj,
        type: info.type,
        collected: false,
        initialY: yPos,
        bobPhase: Math.random() * Math.PI * 2
      });
    }
  }

  function launchFlares() {
    if (planeState.flares <= 0) return;
    planeState.flares -= 1;
    playSfx("flare");

    [-1.2, 1.2].forEach(sideX => {
      const flareGeo = new THREE.SphereGeometry(0.6, 8, 8);
      const flareMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const flare = new THREE.Mesh(flareGeo, flareMat);
      flare.position.copy(planeState.pos);
      flare.position.add(new THREE.Vector3(sideX, -0.5, 2).applyQuaternion(planeState.quat));

      const vel = new THREE.Vector3(sideX * 18, -8, 25).applyQuaternion(planeState.quat).add(planeState.vel.clone().multiplyScalar(0.4));
      scene.add(flare);
      flaresList.push({ mesh: flare, vel, life: 1.0 });
    });
  }

  function createPickupFx(pos, color) {
    const pGroup = new THREE.Group();
    for (let i = 0; i < 16; i++) {
      const spark = new THREE.Mesh(new THREE.SphereGeometry(0.5, 6, 6), new THREE.MeshBasicMaterial({ color, blending: THREE.AdditiveBlending }));
      spark.position.copy(pos);
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 35,
        (Math.random() - 0.5) * 35,
        (Math.random() - 0.5) * 35
      );
      pGroup.add(spark);
      smokePuffs.push({ mesh: spark, vel, life: 1.0, decay: 2.2 });
    }
    scene.add(pGroup);
  }

  function setupInput() {
    window.addEventListener("keydown", e => {
      if (!isRunning) return;
      keys[e.code] = true;

      if (e.code === "KeyV") {
        cameraMode = cameraMode === 0 ? 1 : 0;
        playSfx("switch_cam");
        const camLabel = document.getElementById("air3d-cam-mode");
        if (camLabel) camLabel.textContent = cameraMode === 0 ? "Камера [V]: 3-е лицо (Сзади)" : "Камера [V]: 1-е лицо (Кокпит)";
      }

      if (e.code === "KeyF") launchFlares();

      if (e.code === "KeyG") {
        planeState.gearTarget = planeState.gearTarget === 1.0 ? 0.0 : 1.0;
        playSfx("switch_cam");
      }
    });

    window.addEventListener("keyup", e => {
      keys[e.code] = false;
    });

    window.addEventListener("mousemove", e => {
      if (!isRunning || isPreviewMode) return;
      const w = window.innerWidth, h = window.innerHeight;
      mouse.x = (e.clientX / w) * 2 - 1;
      mouse.y = -(e.clientY / h) * 2 + 1;

      mouse.targetPitch = mouse.y * 1.4;
      mouse.targetRoll = -mouse.x * 1.8;
      mouse.targetYaw = -mouse.x * 0.6;
    });
  }

  function updatePhysics(dt) {
    const s = planeState;
    if (isPreviewMode) return;

    s.afterburner = !!(keys["ShiftLeft"] || keys["ShiftRight"] || keys["Space"]);
    s.airbrake = !!keys["KeyB"];

    if (keys["KeyW"]) s.throttle = Math.min(1.0, s.throttle + dt * 0.45);
    if (keys["KeyS"] && s.isGrounded) s.throttle = Math.max(0.0, s.throttle - dt * 0.45);
    if (keys["KeyS"] && !s.isGrounded) mouse.targetPitch = -1.0;

    const maxSpeed = s.afterburner ? 680 : 420;
    const baseAccel = s.throttle * 95 + (s.afterburner ? 180 : 0);
    const drag = (s.speed / 400) * (s.speed / 400) * 45 + (s.airbrake ? 80 : 0);

    s.speed = Math.max(0, Math.min(maxSpeed, s.speed + (baseAccel - drag) * dt));

    if (s.isGrounded) {
      s.altitude = 1.8;
      s.pos.y = 1.8;
      s.rot.x = 0;
      s.rot.z = 0;

      if (keys["KeyA"]) s.rot.y += dt * 0.45;
      if (keys["KeyD"]) s.rot.y -= dt * 0.45;

      if (s.speed > 115 && (mouse.y > 0.15 || keys["KeyS"] || keys["ArrowDown"])) {
        s.isGrounded = false;
        s.gearTarget = 0.0;
        playSfx("takeoff");
        const msg = document.getElementById("air3d-takeoff-banner");
        if (msg) {
          msg.classList.remove("hidden");
          setTimeout(() => msg.classList.add("hidden"), 3000);
        }
      }
    } else {
      const liftFactor = Math.min(1.2, (s.speed / 160) * (s.speed / 160));
      const gravity = 9.81 * (1.0 - liftFactor);

      let pitchInput = mouse.targetPitch;
      let rollInput = mouse.targetRoll;
      let yawInput = mouse.targetYaw;

      if (keys["ArrowUp"]) pitchInput = 1.0;
      if (keys["ArrowDown"]) pitchInput = -1.0;
      if (keys["KeyA"] || keys["ArrowLeft"]) rollInput = 1.2;
      if (keys["KeyD"] || keys["ArrowRight"]) rollInput = -1.2;
      if (keys["KeyQ"]) yawInput = 1.0;
      if (keys["KeyE"]) yawInput = -1.0;

      const controlResponsiveness = Math.min(1.0, s.speed / 80);
      s.rot.x += pitchInput * dt * 1.4 * controlResponsiveness;
      s.rot.z += rollInput * dt * 2.2 * controlResponsiveness;
      s.rot.y += (yawInput * 0.7 - Math.sin(s.rot.z) * 0.85) * dt * controlResponsiveness;

      s.rot.x = Math.max(-Math.PI * 0.45, Math.min(Math.PI * 0.45, s.rot.x));
      s.quat.setFromEuler(s.rot);

      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(s.quat);
      const velocity = forward.clone().multiplyScalar((s.speed / 3.6) * dt);

      velocity.y -= gravity * dt;

      s.pos.add(velocity);
      s.altitude = Math.max(0.5, s.pos.y);

      s.gForce = 1.0 + Math.abs(pitchInput) * (s.speed / 180) * 3.5;

      if (s.pos.y <= 1.8) {
        s.pos.y = 1.8;
        s.altitude = 1.8;
        if (s.speed < 150) {
          s.isGrounded = true;
          s.gearTarget = 1.0;
        } else {
          s.health -= 15 * dt;
        }
      }
    }

    s.gearExtended += (s.gearTarget - s.gearExtended) * dt * 2.5;
    landingGears.forEach(gear => {
      gear.position.y = -0.3 - s.gearExtended * 0.85;
      gear.scale.setScalar(s.gearExtended > 0.05 ? 1 : 0.001);
    });

    afterburnerFlames.forEach(flame => {
      flame.visible = s.afterburner;
      if (s.afterburner) {
        const flicker = 0.85 + Math.random() * 0.35;
        flame.scale.set(flicker, flicker, flicker * 1.3);
      }
    });

    airplaneGroup.position.copy(s.pos);
    airplaneGroup.quaternion.copy(s.quat);

    s.distanceToTarget = Math.max(0, -4500 - s.pos.z);
    s.traveledDistance = Math.abs(s.pos.z - 280);

    updateCrateCollisions();

    if (s.pos.z <= -4400 && !s.isDelivered) {
      triggerDeliverySuccess();
    }
  }

  function updateCrateCollisions() {
    const s = planeState;
    let closestDist = Infinity;
    let closestCrate = null;

    cratesGroup.forEach(crate => {
      if (crate.collected) return;

      crate.mesh.position.y = crate.initialY + Math.sin(Date.now() * 0.002 + crate.bobPhase) * 2.5;
      crate.mesh.rotation.y += 0.015;

      const dist = s.pos.distanceTo(crate.mesh.position);
      if (dist < closestDist) {
        closestDist = dist;
        closestCrate = crate;
      }

      if (dist < 18) {
        crate.collected = true;
        scene.remove(crate.mesh);
        s.collected[crate.type] = (s.collected[crate.type] || 0) + 1;
        s.totalCollected += 1;

        playSfx("pickup");
        createPickupFx(crate.mesh.position, crate.type === "weapon" ? 0xffbb00 : crate.type === "ammo" ? 0x00f0ff : 0xff2244);

        updateCargoHud();
      }
    });

    s.nearestCrate = closestCrate;
    s.distanceToTarget = closestDist;
  }

  function updateCargoHud() {
    const s = planeState;
    const wEl = document.querySelector("[data-air3d-crate='weapon']");
    const gEl = document.querySelector("[data-air3d-crate='grenade']");
    const aEl = document.querySelector("[data-air3d-crate='ammo']");
    if (wEl) wEl.textContent = s.collected.weapon;
    if (gEl) gEl.textContent = s.collected.grenade;
    if (aEl) aEl.textContent = s.collected.ammo;
  }

  function triggerDeliverySuccess() {
    planeState.isDelivered = true;
    playSfx("victory");

    const stock = JSON.parse(localStorage.getItem("notWeaponStock") || '{"weapon":0,"grenade":0,"ammo":0}');
    stock.weapon = (stock.weapon || 0) + planeState.collected.weapon;
    stock.grenade = (stock.grenade || 0) + planeState.collected.grenade;
    stock.ammo = (stock.ammo || 0) + planeState.collected.ammo;
    localStorage.setItem("notWeaponStock", JSON.stringify(stock));

    const reward = 35000 + planeState.totalCollected * 4500;
    let wallet = Number(localStorage.getItem("notWeaponWallet") || 0);
    wallet += reward;
    localStorage.setItem("notWeaponWallet", String(wallet));

    const resultOverlay = document.getElementById("air3d-result");
    const titleEl = document.getElementById("air3d-result-title");
    const rewardEl = document.getElementById("air3d-result-reward");
    if (titleEl) titleEl.textContent = "МИССИЯ ВЫПОЛНЕНА! ГРУЗ ДОСТАВЛЕН";
    if (rewardEl) rewardEl.textContent = `+$${reward.toLocaleString("en-US")} | Собрано ящиков: ${planeState.totalCollected}`;
    if (resultOverlay) resultOverlay.classList.remove("hidden");
  }

  function updateCameras() {
    const s = planeState;

    if (isPreviewMode) {
      // Кинематографичный ракурс на самолёт перед взлётом
      cockpitInterior.visible = false;
      canopyMesh.visible = true;
      const angle = Date.now() * 0.0003;
      const camX = Math.sin(angle) * 22;
      const camZ = s.pos.z + Math.cos(angle) * 22;
      camera.position.set(camX, 4.5, camZ);
      camera.lookAt(s.pos.x, s.pos.y + 1.2, s.pos.z);
      return;
    }

    if (cameraMode === 1) {
      cockpitInterior.visible = true;
      canopyMesh.visible = false;

      const headPos = s.pos.clone().add(new THREE.Vector3(0, 0.65, -2.1).applyQuaternion(s.quat));
      camera.position.copy(headPos);
      camera.quaternion.copy(s.quat);
    } else {
      cockpitInterior.visible = false;
      canopyMesh.visible = true;

      const offsetDist = 14 + (s.speed / 400) * 6;
      const offsetHeight = 3.8 + (s.speed / 400) * 1.5;
      const desiredPos = s.pos.clone().add(new THREE.Vector3(0, offsetHeight, offsetDist).applyQuaternion(s.quat));

      camera.position.lerp(desiredPos, 0.15);
      const lookTarget = s.pos.clone().add(new THREE.Vector3(0, 0.5, -25).applyQuaternion(s.quat));
      camera.lookAt(lookTarget);
    }

    const targetFov = s.afterburner ? 82 : 68;
    camera.fov += (targetFov - camera.fov) * 0.1;
    camera.updateProjectionMatrix();
  }

  function updateFx(dt) {
    for (let i = flaresList.length - 1; i >= 0; i--) {
      const f = flaresList[i];
      f.life -= dt * 0.45;
      f.mesh.position.add(f.vel.clone().multiplyScalar(dt));
      f.mesh.scale.setScalar(f.life * 1.2);
      if (f.life <= 0) {
        scene.remove(f.mesh);
        flaresList.splice(i, 1);
      }
    }

    for (let i = smokePuffs.length - 1; i >= 0; i--) {
      const p = smokePuffs[i];
      p.life -= dt * (p.decay || 1.0);
      p.mesh.position.add(p.vel.clone().multiplyScalar(dt));
      p.mesh.scale.setScalar(p.life);
      if (p.life <= 0) {
        scene.remove(p.mesh);
        smokePuffs.splice(i, 1);
      }
    }
  }

  let lastFrameTime = performance.now();
  function loop(now) {
    if (!isRunning) return;
    animId = requestAnimationFrame(loop);

    const dt = Math.min(0.1, (now - lastFrameTime) / 1000);
    lastFrameTime = now;

    if (!isPaused) {
      updatePhysics(dt);
      updateCameras();
      updateFx(dt);
      drawHud();
      updateAudio();
    }

    renderer.render(scene, camera);
  }

  function initEngine() {
    canvas = document.getElementById("air-canvas");
    if (!canvas) return;

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    const rect = canvas.parentElement.getBoundingClientRect();
    const w = rect.width || window.innerWidth || 1100;
    const h = rect.height || window.innerHeight || 700;
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x3a2c22, 0.00035);

    camera = new THREE.PerspectiveCamera(70, w / h, 0.2, 8000);
    camera.position.set(0, 4.5, 305);

    initMaterials();
    buildWorld();
    buildAirplane();
    setupInput();

    window.addEventListener("resize", () => {
      if (!canvas || !renderer || !camera) return;
      const rect = canvas.parentElement.getBoundingClientRect();
      const rw = rect.width || window.innerWidth || 1100;
      const rh = rect.height || window.innerHeight || 700;
      camera.aspect = rw / rh;
      camera.updateProjectionMatrix();
      renderer.setSize(rw, rh);
    });
  }

  window.Air3D = {
    // Вызывается при открытии вкладки (мгновенно показывает полосу и 3D мир)
    initPreview: () => {
      if (!renderer) initEngine();
      initAudio();

      planeState.pos.set(0, 1.8, 280);
      planeState.rot.set(0, Math.PI, 0);
      planeState.quat.setFromEuler(planeState.rot);
      planeState.speed = 0;
      planeState.throttle = 0.0;
      planeState.isGrounded = true;
      planeState.gearExtended = 1.0;
      planeState.gearTarget = 1.0;
      planeState.health = 100;
      planeState.flares = 16;
      planeState.collected = { ammo: 0, weapon: 0, grenade: 0 };
      planeState.totalCollected = 0;
      planeState.isDelivered = false;

      isPreviewMode = true;
      isRunning = true;
      isPaused = false;
      lastFrameTime = performance.now();
      cancelAnimationFrame(animId);
      animId = requestAnimationFrame(loop);
    },

    // Вызывается при клике «Взлёт с полосы»
    takeoff: () => {
      if (!renderer) initEngine();
      initAudio();

      isPreviewMode = false;
      planeState.throttle = 0.5; // стартовая тяга
      playSfx("takeoff");
    },

    stop: () => {
      isRunning = false;
      cancelAnimationFrame(animId);
      stopAudio();
    },

    pause: () => { isPaused = true; },
    resume: () => { isPaused = false; lastFrameTime = performance.now(); },
    toggleCamera: () => {
      cameraMode = cameraMode === 0 ? 1 : 0;
      playSfx("switch_cam");
      const camLabel = document.getElementById("air3d-cam-mode");
      if (camLabel) camLabel.textContent = cameraMode === 0 ? "Камера [V]: 3-е лицо (Сзади)" : "Камера [V]: 1-е лицо (Кокпит)";
    }
  };
})();
