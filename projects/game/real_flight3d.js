// projects/game/real_flight3d.js — «Настоящий авиасимулятор» (Three.js Flight Simulator)
(() => {
  const THREE = window.THREE;
  if (!THREE) return;

  // --- СОСТОЯНИЕ РЕЖИМА ---
  let renderer = null, scene = null, camera = null, frame = null;
  let running = false, isPaused = false;
  let submode = "civil"; // "civil" | "military"
  let cameraMode = 0; // 0 = Сзади (3-е лицо), 1 = Кокпит (1-е лицо)

  // Свободный обзор мышью (Freelook)
  let lookYaw = 0, lookPitch = 0;
  let isPointerLocked = false;

  // Объекты сцены
  let aircraft = null, cockpitGroup = null, exteriorGroup = null;
  let terrainChunks = [];
  let clouds = [];
  let airports = [];
  let militaryTargets = [];
  let missiles = [];
  let explosions = [];

  // Гражданский цикл
  let civilState = "boarding";
  let civilTimer = 0;
  let distanceToNextAirport = 5000;

  // Военный цикл
  let militaryScore = 0;
  let militaryTarget = null;
  let missileCooldown = 0;

  const keys = Object.create(null);

  // Физика полета: старт на полосе аэропорта
  const flight = {
    pos: new THREE.Vector3(0, 12.5, -50),
    vel: new THREE.Vector3(0, 0, 0),
    rot: new THREE.Euler(0, 0, 0, "YXZ"),
    quat: new THREE.Quaternion(),
    throttle: 0.0,
    speed: 0,
    altitude: 2,
    pitch: 0,
    roll: 0,
    yaw: 0,
    verticalSpeed: 0,
    isGrounded: true
  };

  // --- ЗВУКОВОЙ ДВИЖОК И СИНТЕЗ ГОЛОСА ---
  let audioCtx = null;
  let turbineGain = null, turbineOsc = null, jetNoise = null, jetGain = null;

  function initFlightAudio() {
    if (audioCtx) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      audioCtx = new AudioContext();

      turbineOsc = audioCtx.createOscillator();
      turbineOsc.type = "sawtooth";
      turbineOsc.frequency.setValueAtTime(90, audioCtx.currentTime);

      const tFilter = audioCtx.createBiquadFilter();
      tFilter.type = "lowpass";
      tFilter.frequency.setValueAtTime(380, audioCtx.currentTime);

      turbineGain = audioCtx.createGain();
      turbineGain.gain.setValueAtTime(0.06, audioCtx.currentTime);

      turbineOsc.connect(tFilter);
      tFilter.connect(turbineGain);
      turbineGain.connect(audioCtx.destination);
      turbineOsc.start();

      const bufferSize = audioCtx.sampleRate * 2;
      const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

      jetNoise = audioCtx.createBufferSource();
      jetNoise.buffer = noiseBuffer;
      jetNoise.loop = true;

      const nFilter = audioCtx.createBiquadFilter();
      nFilter.type = "bandpass";
      nFilter.frequency.setValueAtTime(550, audioCtx.currentTime);
      nFilter.Q.setValueAtTime(1.8, audioCtx.currentTime);

      jetGain = audioCtx.createGain();
      jetGain.gain.setValueAtTime(0.04, audioCtx.currentTime);

      jetNoise.connect(nFilter);
      nFilter.connect(jetGain);
      jetGain.connect(audioCtx.destination);
      jetNoise.start();
    } catch (e) {}
  }

  function speakVoice(text) {
    try {
      if (!window.speechSynthesis) return;
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = "ru-RU";
      utter.rate = 1.05;
      utter.pitch = 0.95;
      window.speechSynthesis.speak(utter);
    } catch (e) {}
  }

  function playMissileSound() {
    if (!audioCtx) return;
    try {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(600, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(150, audioCtx.currentTime + 0.6);
      gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.6);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.61);
    } catch (e) {}
  }

  function playExplosionSound() {
    if (!audioCtx) return;
    try {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(90, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(20, audioCtx.currentTime + 0.8);
      gain.gain.setValueAtTime(0.6, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.8);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.81);
    } catch (e) {}
  }

  // --- ПРОЦЕДУРНЫЙ ЛАНДШАФТ (ГОРЫ, РЕКИ, ОЗЕРА) ---
  function getTerrainHeight(x, z) {
    const mountain = Math.sin(x * 0.0012) * Math.cos(z * 0.0012) * 160;
    const hills = Math.sin(x * 0.004 + 1.2) * Math.cos(z * 0.004 + 0.8) * 50;
    const detail = Math.sin(x * 0.015) * Math.cos(z * 0.015) * 10;
    const riverBed = Math.sin(x * 0.002 + z * 0.001) * 25;

    let h = mountain + hills + detail - riverBed;
    // Зона ВПП аэропорта плоская на высоте 10м
    if (Math.hypot(x, z) < 450) {
      h = 10;
    }
    return Math.max(0, h);
  }

  function createTerrainChunk(cx, cz) {
    const size = 1600;
    const segs = 36;
    const geo = new THREE.PlaneGeometry(size, size, segs, segs);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const colors = [];
    const color = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i) + cx;
      const vz = pos.getZ(i) + cz;
      const vy = getTerrainHeight(vx, vz);
      pos.setY(i, vy);

      if (vy <= 11) {
        color.setHex(0x2d6a4f); // Аэродромный газон и равнина
      } else if (vy < 45) {
        color.setHex(0x40916c); // Долины
      } else if (vy < 95) {
        color.setHex(0x52796f); // Холмы
      } else if (vy < 150) {
        color.setHex(0x6c757d); // Скалы
      } else {
        color.setHex(0xf8f9fa); // Снег
      }
      colors.push(color.r, color.g, color.b);
    }

    pos.needsUpdate = true;
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
      metalness: 0.1,
      flatShading: true
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx, 0, cz);

    // Озера и реки
    const waterGeo = new THREE.PlaneGeometry(size, size);
    waterGeo.rotateX(-Math.PI / 2);
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      roughness: 0.2,
      metalness: 0.7
    });
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.position.set(cx, 14, cz);

    const group = new THREE.Group();
    group.add(mesh, water);
    group.userData = { cx, cz };
    return group;
  }

  function updateTerrain(playerX, playerZ) {
    const chunkSize = 1600;
    const centerChunkX = Math.floor(playerX / chunkSize) * chunkSize;
    const centerChunkZ = Math.floor(playerZ / chunkSize) * chunkSize;

    const neededChunks = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        neededChunks.push({ x: centerChunkX + dx * chunkSize, z: centerChunkZ + dz * chunkSize });
      }
    }

    for (let i = terrainChunks.length - 1; i >= 0; i--) {
      const c = terrainChunks[i];
      const stillNeeded = neededChunks.some(nc => nc.x === c.userData.cx && nc.z === c.userData.cz);
      if (!stillNeeded) {
        scene.remove(c);
        terrainChunks.splice(i, 1);
      }
    }

    neededChunks.forEach(nc => {
      const exists = terrainChunks.some(c => c.userData.cx === nc.x && c.userData.cz === nc.z);
      if (!exists) {
        const chunk = createTerrainChunk(nc.x, nc.z);
        scene.add(chunk);
        terrainChunks.push(chunk);
      }
    });
  }

  // --- ОБЛАКА ---
  function initClouds() {
    clouds.forEach(c => scene.remove(c));
    clouds.length = 0;

    const cloudGeo = new THREE.DodecahedronGeometry(45, 1);
    const cloudMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.95,
      transparent: true,
      opacity: 0.85
    });

    for (let i = 0; i < 35; i++) {
      const cloudGroup = new THREE.Group();
      for (let p = 0; p < 5; p++) {
        const puff = new THREE.Mesh(cloudGeo, cloudMat);
        puff.position.set((Math.random() - 0.5) * 70, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 70);
        puff.scale.set(Math.random() * 0.8 + 0.6, Math.random() * 0.5 + 0.4, Math.random() * 0.8 + 0.6);
        cloudGroup.add(puff);
      }
      cloudGroup.position.set((Math.random() - 0.5) * 5000, 250 + Math.random() * 250, (Math.random() - 0.5) * 5000);
      scene.add(cloudGroup);
      clouds.push(cloudGroup);
    }
  }

  // --- АЭРОПОРТ (ВПП, ОГНИ, ВЫШКА) ---
  function createAirport(x, z, angle = 0) {
    const group = new THREE.Group();

    const runwayGeo = new THREE.BoxGeometry(50, 0.4, 700);
    const runwayMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.85 });
    const runway = new THREE.Mesh(runwayGeo, runwayMat);
    runway.position.set(0, 10.2, 0);
    group.add(runway);

    // Разметка ВПП (Белые полосы)
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (let rz = -300; rz <= 300; rz += 40) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(3, 20), lineMat);
      line.rotation.x = -Math.PI / 2;
      line.position.set(0, 10.45, rz);
      group.add(line);
    }

    const lightMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    for (let rz = -320; rz <= 320; rz += 30) {
      [-24, 24].forEach(rx => {
        const l = new THREE.Mesh(new THREE.SphereGeometry(0.55, 6, 6), lightMat);
        l.position.set(rx, 10.6, rz);
        group.add(l);
      });
    }

    const termMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.7 });
    const terminal = new THREE.Mesh(new THREE.BoxGeometry(100, 20, 50), termMat);
    terminal.position.set(70, 20, -60);
    group.add(terminal);

    const tower = new THREE.Mesh(new THREE.CylinderGeometry(5, 7, 45, 12), termMat);
    tower.position.set(70, 32.5, -110);
    group.add(tower);

    group.position.set(x, 0, z);
    group.rotation.y = angle;
    return group;
  }

  // --- ДЕТАЛИЗИРОВАННАЯ КАБИНА ПИЛОТА ---
  function createCockpitInterior() {
    const group = new THREE.Group();

    const panelMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.4, metalness: 0.8 });
    const screenMat = new THREE.MeshBasicMaterial({ color: 0x0284c7 });
    const buttonMatG = new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x16a34a, emissiveIntensity: 1.5 });
    const buttonMatR = new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xdc2626, emissiveIntensity: 1.5 });
    const buttonMatY = new THREE.MeshStandardMaterial({ color: 0xeab308, emissive: 0xca8a04, emissiveIntensity: 1.5 });

    const mainPanel = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 0.4), panelMat);
    mainPanel.position.set(0, -0.22, -0.9);
    mainPanel.rotation.x = -0.35;
    group.add(mainPanel);

    [-0.45, 0.45, 0].forEach((sx, idx) => {
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.22), idx === 0 ? screenMat : new THREE.MeshBasicMaterial({ color: 0x059669 }));
      scr.position.set(sx, -0.15, -0.72);
      scr.rotation.x = -0.35;
      group.add(scr);
    });

    for (let bx = -0.7; bx <= 0.7; bx += 0.08) {
      for (let by = -0.4; by <= -0.25; by += 0.06) {
        const mat = Math.random() > 0.6 ? buttonMatG : (Math.random() > 0.3 ? buttonMatY : buttonMatR);
        const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.03, 8), mat);
        btn.rotation.x = Math.PI / 2 - 0.35;
        btn.position.set(bx, by, -0.78);
        group.add(btn);
      }
    }

    const stickMat = new THREE.MeshStandardMaterial({ color: 0x09090b, roughness: 0.8 });
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.45, 10), stickMat);
    stick.position.set(-0.35, -0.4, -0.55);
    stick.rotation.x = -0.2;

    const yokeWheel = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.02, 8, 16, Math.PI * 1.5), stickMat);
    yokeWheel.position.set(0, 0.22, 0);
    yokeWheel.rotation.z = Math.PI / 4;
    stick.add(yokeWheel);
    group.add(stick);
    group.userData.flightStick = stick;

    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x27272a, metalness: 0.8 });
    const pillarL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.9, 0.06), pillarMat);
    pillarL.position.set(-0.75, 0.2, -0.85);
    pillarL.rotation.set(-0.4, 0, 0.35);

    const pillarR = pillarL.clone();
    pillarR.position.x = 0.75;
    pillarR.rotation.z = -0.35;

    const topBar = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 0.06), pillarMat);
    topBar.position.set(0, 0.55, -0.85);

    group.add(pillarL, pillarR, topBar);
    return group;
  }

  // --- ВНЕШНЯЯ МОДЕЛЬ САМОЛЕТА ---
  function createAircraftModel(isMilitary = false) {
    const group = new THREE.Group();
    exteriorGroup = new THREE.Group();

    const bodyMat = new THREE.MeshStandardMaterial({
      color: isMilitary ? 0x475569 : 0xf8fafc,
      metalness: 0.7,
      roughness: 0.25
    });
    const wingMat = new THREE.MeshStandardMaterial({
      color: isMilitary ? 0x1e293b : 0x0284c7,
      metalness: 0.8,
      roughness: 0.3
    });

    const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.8, 14, 18), bodyMat);
    fuselage.rotation.x = Math.PI / 2;
    exteriorGroup.add(fuselage);

    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.9, 3.2, 18), bodyMat);
    nose.rotation.x = -Math.PI / 2;
    nose.position.set(0, 0, -8.6);
    exteriorGroup.add(nose);

    const wings = new THREE.Mesh(new THREE.BoxGeometry(16, 0.18, 3.2), wingMat);
    wings.position.set(0, 0, -1);
    exteriorGroup.add(wings);

    const tailV = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3.2, 2.4), wingMat);
    tailV.position.set(0, 1.8, 5.8);
    tailV.rotation.x = -0.4;
    exteriorGroup.add(tailV);

    const tailH = new THREE.Mesh(new THREE.BoxGeometry(5.8, 0.14, 1.8), wingMat);
    tailH.position.set(0, 0.4, 6.2);
    exteriorGroup.add(tailH);

    // Шасси (Wheels)
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
    const wheelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.3, 12);
    wheelGeo.rotateZ(Math.PI / 2);

    [[-3.2, -1.2, 0.5], [3.2, -1.2, 0.5], [0, -1.2, -6.5]].forEach(wpos => {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.position.set(...wpos);
      exteriorGroup.add(w);
    });

    [-3.8, 3.8].forEach(wx => {
      const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.5, 3.2, 16), bodyMat);
      eng.rotation.x = Math.PI / 2;
      eng.position.set(wx, -0.6, 0);
      exteriorGroup.add(eng);
    });

    group.add(exteriorGroup);

    cockpitGroup = createCockpitInterior();
    cockpitGroup.position.set(0, 0.4, -2.8);
    group.add(cockpitGroup);

    return group;
  }

  // --- ВОЕННЫЕ ЦЕЛИ И РАКЕТЫ ---
  function spawnMilitaryTargets() {
    militaryTargets.forEach(t => scene.remove(t.mesh));
    militaryTargets.length = 0;

    const targetGeo = new THREE.BoxGeometry(45, 25, 45);
    const targetMat = new THREE.MeshStandardMaterial({ color: 0xef4444, metalness: 0.9, roughness: 0.2 });
    const targetMesh = new THREE.Mesh(targetGeo, targetMat);

    const tx = flight.pos.x + (Math.random() > 0.5 ? 1 : -1) * (1600 + Math.random() * 600);
    const tz = flight.pos.z - (2000 + Math.random() * 800);
    const ty = getTerrainHeight(tx, tz) + 12.5;

    targetMesh.position.set(tx, ty, tz);
    scene.add(targetMesh);

    militaryTarget = {
      mesh: targetMesh,
      pos: new THREE.Vector3(tx, ty, tz),
      hp: 100,
      isDead: false
    };
    militaryTargets.push(militaryTarget);
  }

  function fireMissile() {
    if (missileCooldown > 0) return;
    missileCooldown = 1.2;
    playMissileSound();

    const mGeo = new THREE.CylinderGeometry(0.12, 0.12, 2.2, 8);
    mGeo.rotateX(Math.PI / 2);
    const mMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const mMesh = new THREE.Mesh(mGeo, mMat);

    const spawnPos = flight.pos.clone().add(new THREE.Vector3(0, -1.2, -4).applyQuaternion(flight.quat));
    mMesh.position.copy(spawnPos);
    mMesh.quaternion.copy(flight.quat);
    scene.add(mMesh);

    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(flight.quat);
    missiles.push({
      mesh: mMesh,
      pos: spawnPos,
      vel: fwd.multiplyScalar(450),
      life: 5.0
    });
  }

  function updateMissiles(dt) {
    if (missileCooldown > 0) missileCooldown -= dt;

    for (let i = missiles.length - 1; i >= 0; i--) {
      const m = missiles[i];
      m.life -= dt;
      m.pos.add(m.vel.clone().multiplyScalar(dt));
      m.mesh.position.copy(m.pos);

      if (militaryTarget && !militaryTarget.isDead) {
        if (m.pos.distanceTo(militaryTarget.pos) < 35) {
          militaryTarget.hp -= 55;
          playExplosionSound();
          createExplosion(militaryTarget.pos);

          scene.remove(m.mesh);
          missiles.splice(i, 1);

          if (militaryTarget.hp <= 0) {
            militaryTarget.isDead = true;
            militaryScore++;
            setTimeout(() => onMilitaryVictory(), 800);
          }
          continue;
        }
      }

      if (m.life <= 0) {
        scene.remove(m.mesh);
        missiles.splice(i, 1);
      }
    }
  }

  function createExplosion(pos) {
    const expGeo = new THREE.SphereGeometry(18, 12, 12);
    const expMat = new THREE.MeshBasicMaterial({ color: 0xff4400, transparent: true, opacity: 0.95 });
    const mesh = new THREE.Mesh(expGeo, expMat);
    mesh.position.copy(pos);
    scene.add(mesh);
    explosions.push({ mesh, life: 0.7 });
  }

  function onMilitaryVictory() {
    isPaused = true;
    const modal = document.getElementById("real-flight-victory");
    if (modal) modal.classList.remove("hidden");
  }

  // --- УПРАВЛЕНИЕ ПОЛЕТОМ (WASD) ---
  function updateFlightPhysics(dt) {
    const keyW = keys.KeyW || keys.ArrowUp;
    const keyS = keys.KeyS || keys.ArrowDown;
    const keyA = keys.KeyA || keys.ArrowLeft;
    const keyD = keys.KeyD || keys.ArrowRight;
    const keyThrottleUp = keys.ShiftLeft || keys.ShiftRight;
    const keyThrottleDown = keys.ControlLeft || keys.ControlRight;
    const keyFire = keys.Space;

    if (submode === "military" && keyFire) {
      fireMissile();
    }

    // Регулировка тяги
    if (keyThrottleUp) flight.throttle = Math.min(1.0, flight.throttle + dt * 0.45);
    if (keyThrottleDown) flight.throttle = Math.max(0.0, flight.throttle - dt * 0.45);

    // Если на земле (Взлет)
    if (flight.isGrounded) {
      flight.speed = THREE.MathUtils.lerp(flight.speed, flight.throttle * 240, dt * 1.5);
      if (flight.speed > 130 && keyS) {
        // Отрыв от полосы!
        flight.isGrounded = false;
        flight.verticalSpeed = 8.5;
      }
    } else {
      flight.speed = 120 + flight.throttle * 240;
    }

    const pitchInput = (keyS ? 1 : 0) - (keyW ? 1 : 0);
    const rollInput = (keyA ? 1 : 0) - (keyD ? 1 : 0);

    if (!flight.isGrounded) {
      flight.pitch = THREE.MathUtils.lerp(flight.pitch, pitchInput * 0.85, dt * 4.5);
      flight.roll = THREE.MathUtils.lerp(flight.roll, rollInput * 1.15, dt * 5.0);
      flight.yaw += -flight.roll * dt * 0.65;
    } else {
      flight.pitch = 0;
      flight.roll = 0;
      flight.yaw -= rollInput * dt * 0.8;
    }

    flight.quat.setFromEuler(new THREE.Euler(flight.pitch, flight.yaw, flight.roll, "YXZ"));

    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(flight.quat);
    flight.vel.copy(fwd).multiplyScalar((flight.speed / 3.6) * dt);
    flight.pos.add(flight.vel);

    const groundH = getTerrainHeight(flight.pos.x, flight.pos.z);
    flight.altitude = Math.round(flight.pos.y - groundH);

    // Защита от крушения
    if (flight.pos.y <= groundH + 2.5) {
      flight.pos.y = groundH + 2.5;
      flight.pitch = Math.max(0, flight.pitch);
      if (flight.speed < 110) flight.isGrounded = true;
    }

    if (aircraft) {
      aircraft.position.copy(flight.pos);
      aircraft.quaternion.copy(flight.quat);

      if (exteriorGroup) exteriorGroup.visible = (cameraMode === 0);
      if (cockpitGroup) cockpitGroup.visible = true;
    }

    if (cockpitGroup && cockpitGroup.userData.flightStick) {
      cockpitGroup.userData.flightStick.rotation.x = -0.2 + flight.pitch * 0.4;
      cockpitGroup.userData.flightStick.rotation.z = -flight.roll * 0.6;
    }

    if (turbineOsc && audioCtx) {
      const pitch = 90 + flight.throttle * 140;
      turbineOsc.frequency.setTargetAtTime(pitch, audioCtx.currentTime, 0.05);
    }
  }

  // --- КАМЕРА (СВОБОДНЫЙ ОБЗОР МЫШЬЮ) ---
  function updateCamera() {
    if (!camera || !aircraft) return;

    if (cameraMode === 1) {
      // КОКПИТ (1-Е ЛИЦО)
      const eyePos = flight.pos.clone().add(
        new THREE.Vector3(0, 0.72, -2.6).applyQuaternion(flight.quat)
      );
      camera.position.copy(eyePos);

      const lookQuat = flight.quat.clone().multiply(
        new THREE.Quaternion().setFromEuler(new THREE.Euler(lookPitch, lookYaw, 0, "YXZ"))
      );
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(lookQuat);
      camera.lookAt(eyePos.clone().add(fwd));
      camera.fov = 68;
    } else {
      // 3-Е ЛИЦО (СЗАДИ С ПРЕКРАСНЫМ ОБЗОРОМ САМОЛЕТА И ЗЕМЛИ)
      const camDist = 26;
      const camHeight = 6.5;
      const orbitOffset = new THREE.Vector3(
        Math.sin(lookYaw) * camDist,
        Math.max(2.0, camHeight - Math.sin(lookPitch) * 14),
        Math.cos(lookYaw) * camDist
      );
      const desiredPos = flight.pos.clone().add(orbitOffset.applyQuaternion(flight.quat));
      camera.position.lerp(desiredPos, 0.2);
      camera.lookAt(flight.pos.clone().add(new THREE.Vector3(0, 1.2, -6).applyQuaternion(flight.quat)));
      camera.fov = 62;
    }
    camera.updateProjectionMatrix();
  }

  // --- ГРАЖДАНСКИЙ ЦИКЛ ---
  function updateCivilCycle(dt) {
    if (submode !== "civil") return;

    if (civilState === "boarding") {
      civilTimer += dt;
      if (civilTimer > 4.5) {
        civilState = "flight";
        civilTimer = 0;
        flight.throttle = 0.85;
        speakVoice("Уважаемые пассажиры, говорит командир корабля. Наш рейс начинает взлёт. Приятного полёта!");
      }
    } else if (civilState === "flight") {
      distanceToNextAirport = Math.max(0, distanceToNextAirport - (flight.speed / 3.6) * dt);
      if (distanceToNextAirport <= 0) {
        civilState = "service_fuel";
        civilTimer = 0;
        speakVoice("Борт успешно прибыл в пункт назначения. Начинаем обслуживание и заправку топливом.");
      }
    } else if (civilState === "service_fuel") {
      civilTimer += dt;
      if (civilTimer > 4.0) {
        civilState = "service_wash";
        civilTimer = 0;
      }
    } else if (civilState === "service_wash") {
      civilTimer += dt;
      if (civilTimer > 4.0) {
        civilState = "service_boarding";
        civilTimer = 0;
      }
    } else if (civilState === "service_boarding") {
      civilTimer += dt;
      if (civilTimer > 4.5) {
        civilState = "flight";
        civilTimer = 0;
        distanceToNextAirport = 6000;
        speakVoice("Посадка новых пассажиров завершена. Взлетаем к следующему аэропорту!");
      }
    }
  }

  function updateHUD() {
    const spdEl = document.getElementById("real-flight-spd");
    if (spdEl) spdEl.textContent = `${Math.round(flight.speed)} КМ/Ч`;

    const altEl = document.getElementById("real-flight-alt");
    if (altEl) altEl.textContent = `ВЫСОТА: ${Math.max(0, flight.altitude)} М`;

    const thrEl = document.getElementById("real-flight-throttle-fill");
    if (thrEl) thrEl.style.width = `${Math.round(flight.throttle * 100)}%`;

    const statusEl = document.getElementById("real-flight-status-text");
    if (statusEl) {
      if (submode === "civil") {
        if (civilState === "boarding") statusEl.textContent = "👥 ПОСАДКА ПАССАЖИРОВ...";
        else if (civilState === "flight") statusEl.textContent = `✈️ В ПОЛЁТЕ · ДО ПРИБЫТИЯ: ${Math.round(distanceToNextAirport)} М`;
        else if (civilState === "service_fuel") statusEl.textContent = "⛽ ЗАПРАВКА ТОПЛИВОМ...";
        else if (civilState === "service_wash") statusEl.textContent = "🚿 МОЙКА И ОБСЛУЖИВАНИЕ САМОЛЕТА...";
        else if (civilState === "service_boarding") statusEl.textContent = "👥 ПОСАДКА НОВЫХ ПАССАЖИРОВ...";
      } else {
        if (militaryTarget && !militaryTarget.isDead) {
          const dist = Math.round(flight.pos.distanceTo(militaryTarget.pos));
          statusEl.textContent = `🎯 ЦЕЛЬ ЗАХВАЧЕНА · ДИСТАНЦИЯ: ${dist} М [ПРОБЕЛ - РАКЕТА]`;
        } else {
          statusEl.textContent = "🎯 ПОИСК СЛЕДУЮЩЕЙ ЦЕЛИ...";
        }
      }
    }
  }

  // --- ИГРОВОЙ ЦИКЛ ---
  let lastTime = 0;
  function animate(now = 0) {
    if (!running) return;
    const dt = Math.min(0.04, (now - (lastTime || now)) / 1000);
    lastTime = now;

    if (!isPaused) {
      updateFlightPhysics(dt);
      updateTerrain(flight.pos.x, flight.pos.z);
      updateCivilCycle(dt);
      if (submode === "military") updateMissiles(dt);
      updateCamera();
      updateHUD();
    }

    renderer.render(scene, camera);
    frame = requestAnimationFrame(animate);
  }

  function resetCanvas() {
    const old = document.getElementById("real-flight-canvas");
    if (!old) return;
    const canvas = old.cloneNode(false);
    old.replaceWith(canvas);

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(1100, 700, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x38bdf8);
    scene.fog = new THREE.FogExp2(0x7dd3fc, 0.0003);

    camera = new THREE.PerspectiveCamera(62, 1100 / 700, 0.2, 9000);
    camera.position.set(0, 18, 26);
    camera.lookAt(0, 12, -40);

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.4);
    scene.add(ambientLight);

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x475569, 1.2);
    scene.add(hemiLight);

    const sun = new THREE.DirectionalLight(0xfffaed, 2.2);
    sun.position.set(500, 1200, 400);
    scene.add(sun);

    canvas.addEventListener("click", () => {
      if (!isPointerLocked) {
        canvas.requestPointerLock?.();
      }
    });

    document.addEventListener("pointerlockchange", () => {
      isPointerLocked = document.pointerLockElement === canvas;
    });

    window.addEventListener("mousemove", (e) => {
      if (isPointerLocked && running) {
        lookYaw -= e.movementX * 0.0024;
        lookPitch -= e.movementY * 0.0024;
        lookPitch = Math.max(-1.2, Math.min(1.2, lookPitch));
      }
    });
  }

  window.addEventListener("keydown", (e) => {
    keys[e.code] = true;
    if (running && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) {
      e.preventDefault();
    }
    if (running && e.code === "KeyV") {
      cameraMode = cameraMode === 0 ? 1 : 0;
      const btn = document.getElementById("real-flight-cam-btn");
      if (btn) btn.textContent = cameraMode === 1 ? "Камера [V]: Кабина" : "Камера [V]: Сзади";
    }
  });

  window.addEventListener("keyup", (e) => {
    keys[e.code] = false;
  });

  // --- ПУБЛИЧНЫЙ API ---
  window.RealFlight3D = {
    start(selectedSubmode = "civil") {
      this.stop();
      submode = selectedSubmode;
      initFlightAudio();
      resetCanvas();

      cameraMode = 0;
      lookYaw = 0;
      lookPitch = 0;
      civilState = "boarding";
      civilTimer = 0;
      distanceToNextAirport = 5000;
      isPaused = false;

      const btn = document.getElementById("real-flight-cam-btn");
      if (btn) btn.textContent = "Камера [V]: Сзади";

      // Старт на взлетной полосе аэропорта
      flight.pos.set(0, 12.5, -50);
      flight.rot.set(0, 0, 0);
      flight.pitch = 0;
      flight.roll = 0;
      flight.yaw = 0;
      flight.throttle = 0.0;
      flight.speed = 0;
      flight.isGrounded = true;

      const apt = createAirport(0, 0, 0);
      scene.add(apt);
      airports.push(apt);

      updateTerrain(0, 0);
      initClouds();

      aircraft = createAircraftModel(submode === "military");
      scene.add(aircraft);

      if (submode === "military") {
        flight.pos.set(0, 180, 0);
        flight.throttle = 0.75;
        flight.speed = 240;
        flight.isGrounded = false;
        spawnMilitaryTargets();
      } else {
        speakVoice("Добро пожаловать на борт. Идёт посадка пассажиров перед рейсом.");
      }

      camera.position.set(0, 18, 26);
      camera.lookAt(0, 12, -40);
      updateCamera();
      updateHUD();
      renderer.render(scene, camera);

      running = true;
      lastTime = performance.now();
      frame = requestAnimationFrame(animate);
    },

    nextMilitaryMission() {
      const modal = document.getElementById("real-flight-victory");
      if (modal) modal.classList.add("hidden");
      isPaused = false;
      spawnMilitaryTargets();
    },

    toggleCamera() {
      cameraMode = cameraMode === 0 ? 1 : 0;
      const btn = document.getElementById("real-flight-cam-btn");
      if (btn) btn.textContent = cameraMode === 1 ? "Камера [V]: Кабина" : "Камера [V]: Сзади";
    },

    stop() {
      running = false;
      if (frame) cancelAnimationFrame(frame);
      if (turbineGain) turbineGain.gain.setValueAtTime(0, audioCtx?.currentTime || 0);
      if (jetGain) jetGain.gain.setValueAtTime(0, audioCtx?.currentTime || 0);
      if (renderer) renderer.dispose();
      try { window.speechSynthesis?.cancel(); } catch (e) {}
    }
  };
})();
