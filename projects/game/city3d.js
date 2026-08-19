// projects/game/city3d.js — 3D Автосимулятор в открытом городе (Need for Speed style)
// Погоня, таран броневика террориста (Craig Reynolds Steering AI), дрифт, прыжки с трамплинов,
// процедурные PBR-текстуры и мощный басовый рев нитро без писка.
(() => {
  const THREE = window.THREE;
  if (!THREE) return;

  // --- СОСТОЯНИЕ ДВИЖКА ---
  let renderer = null, scene = null, camera = null, frame = null;
  let running = false, isPaused = false;
  let level = 1, driftScore = 0, currentCombo = 1, maxDriftScore = 0;
  let cameraMode = 0; // 0 = 3-е лицо (сзади), 1 = 1-е лицо (кокпит)
  
  // Объекты мира
  let playerCar = null, enemyCar = null;
  let cityColliders = []; // Массив физических боксов зданий
  let ramps = []; // Массив математических рамп
  let sparkParticles = null, smokeParticles = null, nitroParticles = null;
  let screenShake = { intensity: 0, duration: 0 };
  let slowMoTimer = 0;

  const keys = Object.create(null);

  // Параметры физики игрока (Raycast + Incline + Drift)
  const carState = {
    pos: new THREE.Vector3(0, 0.4, 0),
    vel: new THREE.Vector3(0, 0, 0),
    rot: new THREE.Euler(0, 0, 0, "YXZ"),
    quat: new THREE.Quaternion(),
    speed: 0, // км/ч
    verticalSpeed: 0, // м/с для прыжков и гравитации
    isGrounded: true,
    currentGroundY: 0.38,
    steering: 0,
    nitro: 1.0,
    isDrifting: false,
    driftAngle: 0,
    airTime: 0,
    pitchAngle: 0
  };

  // Параметры ИИ противника-террориста (Craig Reynolds Steering Behaviors)
  const enemyState = {
    pos: new THREE.Vector3(0, 0.4, -65),
    vel: new THREE.Vector3(0, 0, 0),
    rot: new THREE.Euler(0, Math.PI, 0, "YXZ"),
    quat: new THREE.Quaternion(),
    speed: 0,
    maxSpeed: 175,
    hp: 100,
    maxHp: 100,
    isDead: false,
    avoidanceRange: 28,
    steerAgility: 2.2,
    engineForce: 45
  };

  // --- ПРОЦЕДУРНАЯ ГЕНЕРАЦИЯ PBR ТЕКСТУР НА CANVAS ---
  const textures = {};

  function generateAsphaltTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#26292d";
    ctx.fillRect(0, 0, 512, 512);

    const imgData = ctx.getImageData(0, 0, 512, 512);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      const noise = (Math.random() - 0.5) * 32;
      data[i] = Math.min(255, Math.max(0, data[i] + noise));
      data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise));
      data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise));
    }
    ctx.putImageData(imgData, 0, 0);

    ctx.fillStyle = "#f0e68c";
    ctx.fillRect(250, 0, 4, 512);
    ctx.fillRect(258, 0, 4, 512);

    ctx.fillStyle = "#ffffff";
    for (let y = 0; y < 512; y += 64) {
      ctx.fillRect(128, y, 6, 36);
      ctx.fillRect(384, y, 6, 36);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 40);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  function generateBuildingTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 1024;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#16181d";
    ctx.fillRect(0, 0, 512, 1024);

    const windowColors = ["#ffd27d", "#7dc5ff", "#ff9e54", "#ffffff", "#0e1014", "#0e1014", "#0e1014"];
    for (let y = 20; y < 1000; y += 28) {
      for (let x = 16; x < 490; x += 22) {
        ctx.fillStyle = windowColors[Math.floor(Math.random() * windowColors.length)];
        ctx.fillRect(x, y, 14, 18);
      }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 4);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  function generateRampTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#2c2e35";
    ctx.fillRect(0, 0, 512, 512);

    ctx.lineWidth = 24;
    ctx.strokeStyle = "#ffb703";
    for (let i = -512; i < 1024; i += 48) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + 512, 512);
      ctx.stroke();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 2);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  // --- АУДИО СИНТЕЗАТОР (МОЩНЫЙ РЕВ V8 И ГЛУБОКИЙ БАС НИТРО) ---
  let audioCtx = null;
  let engineGain = null, engineOsc = null, engineSub = null, engineFilter = null;
  let driftGain = null, driftNoise = null;

  function initAudio() {
    if (audioCtx) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      audioCtx = new AudioContext();

      // 1. Осцилляторы двигателя (V8 агрессивный рокот)
      engineOsc = audioCtx.createOscillator();
      engineOsc.type = "sawtooth";
      engineOsc.frequency.setValueAtTime(42, audioCtx.currentTime);

      engineSub = audioCtx.createOscillator();
      engineSub.type = "triangle";
      engineSub.frequency.setValueAtTime(21, audioCtx.currentTime);

      engineFilter = audioCtx.createBiquadFilter();
      engineFilter.type = "lowpass";
      engineFilter.frequency.setValueAtTime(320, audioCtx.currentTime);

      engineGain = audioCtx.createGain();
      engineGain.gain.setValueAtTime(0.09, audioCtx.currentTime);

      engineOsc.connect(engineFilter);
      engineSub.connect(engineFilter);
      engineFilter.connect(engineGain);
      engineGain.connect(audioCtx.destination);
      engineOsc.start();
      engineSub.start();

      // 2. Визг шин при дрифте
      const bufferSize = audioCtx.sampleRate * 2;
      const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }

      driftNoise = audioCtx.createBufferSource();
      driftNoise.buffer = noiseBuffer;
      driftNoise.loop = true;

      const driftFilter = audioCtx.createBiquadFilter();
      driftFilter.type = "bandpass";
      driftFilter.frequency.setValueAtTime(950, audioCtx.currentTime);
      driftFilter.Q.setValueAtTime(3.2, audioCtx.currentTime);

      driftGain = audioCtx.createGain();
      driftGain.gain.setValueAtTime(0.0, audioCtx.currentTime);

      driftNoise.connect(driftFilter);
      driftFilter.connect(driftGain);
      driftGain.connect(audioCtx.destination);
      driftNoise.start();
    } catch (e) {
      console.warn("Web Audio init bypassed:", e);
    }
  }

  function playCrashSound(intensity = 1.0) {
    if (!audioCtx) return;
    try {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(110, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(30, audioCtx.currentTime + 0.35);

      gain.gain.setValueAtTime(Math.min(0.65, 0.35 * intensity), audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.35);

      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.36);
    } catch (e) {}
  }

  // --- ПОСТРОЕНИЕ ГОРОДА С РАМПАМИ ---
  function buildOpenCity() {
    cityColliders.length = 0;
    ramps.length = 0;

    textures.asphalt = generateAsphaltTexture();
    textures.building = generateBuildingTexture();
    textures.ramp = generateRampTexture();

    const groundMat = new THREE.MeshStandardMaterial({
      map: textures.asphalt,
      color: 0x32353a,
      roughness: 0.85,
      metalness: 0.15
    });

    const groundGeo = new THREE.PlaneGeometry(1000, 1000);
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const bldgMat = new THREE.MeshStandardMaterial({
      map: textures.building,
      roughness: 0.6,
      metalness: 0.4
    });

    const bldgGeo = new THREE.BoxGeometry(1, 1, 1);
    const instBldgs = new THREE.InstancedMesh(bldgGeo, bldgMat, 300);
    instBldgs.castShadow = true;
    instBldgs.receiveShadow = true;

    let bldgCount = 0;
    const dummy = new THREE.Object3D();

    for (let qX = -400; qX <= 400; qX += 90) {
      for (let qZ = -400; qZ <= 400; qZ += 90) {
        if (Math.abs(qX) < 45 && Math.abs(qZ) < 45) continue;

        const cX = qX + 45;
        const cZ = qZ + 45;

        for (let b = 0; b < 2; b++) {
          const w = 24 + Math.random() * 12;
          const d = 24 + Math.random() * 12;
          const h = 35 + Math.random() * 65;
          const posX = cX + (b === 0 ? -14 : 14);
          const posZ = cZ + (b === 0 ? -14 : 14);

          dummy.position.set(posX, h / 2, posZ);
          dummy.scale.set(w, h, d);
          dummy.rotation.set(0, 0, 0);
          dummy.updateMatrix();

          if (bldgCount < 300) {
            instBldgs.setMatrixAt(bldgCount++, dummy.matrix);
          }

          cityColliders.push({
            minX: posX - w / 2 - 1.2,
            maxX: posX + w / 2 + 1.2,
            minZ: posZ - d / 2 - 1.2,
            maxZ: posZ + d / 2 + 1.2,
            height: h
          });
        }
      }
    }
    instBldgs.instanceMatrix.needsUpdate = true;
    scene.add(instBldgs);

    // Рампы для прыжков (Box-примитивы)
    const rampMat = new THREE.MeshStandardMaterial({
      map: textures.ramp,
      roughness: 0.7,
      metalness: 0.3
    });

    const rampConfigs = [
      { x: 0, z: -120, width: 14, length: 22, height: 5.5, rotY: 0 },
      { x: 0, z: 120, width: 14, length: 22, height: 5.5, rotY: Math.PI },
      { x: -180, z: -60, width: 12, length: 18, height: 4.8, rotY: 0 },
      { x: 180, z: 60, width: 12, length: 18, height: 4.8, rotY: Math.PI },
      { x: -90, z: 200, width: 12, length: 20, height: 5.2, rotY: -Math.PI / 2 },
      { x: 90, z: -200, width: 12, length: 20, height: 5.2, rotY: Math.PI / 2 },
      { x: -90, z: 0, width: 16, length: 26, height: 7.2, rotY: Math.PI / 2 },
      { x: 90, z: 0, width: 16, length: 26, height: 7.2, rotY: -Math.PI / 2 }
    ];

    rampConfigs.forEach((cfg) => {
      const angle = Math.atan2(cfg.height, cfg.length);
      const rampGeo = new THREE.BoxGeometry(cfg.width, 0.6, cfg.length);
      const mesh = new THREE.Mesh(rampGeo, rampMat);
      mesh.rotation.x = -angle;
      mesh.position.set(0, cfg.height / 2, 0);
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      const group = new THREE.Group();
      group.add(mesh);

      const railMat = new THREE.MeshStandardMaterial({ color: 0xff3b30, metalness: 0.8, roughness: 0.2 });
      [-cfg.width / 2, cfg.width / 2].forEach((rx) => {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.2, cfg.length), railMat);
        rail.rotation.x = -angle;
        rail.position.set(rx, cfg.height / 2 + 0.4, 0);
        group.add(rail);
      });

      group.position.set(cfg.x, 0, cfg.z);
      group.rotation.y = cfg.rotY;
      scene.add(group);

      ramps.push({
        x: cfg.x,
        z: cfg.z,
        width: cfg.width,
        length: cfg.length,
        height: cfg.height,
        rotY: cfg.rotY,
        angle: angle
      });
    });

    // Уличные фонари
    const lightPoleMat = new THREE.MeshStandardMaterial({ color: 0x4a4d52, metalness: 0.9 });
    const lampGlowMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });

    for (let pZ = -360; pZ <= 360; pZ += 45) {
      [-18, 18].forEach((pX) => {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 7.5, 8), lightPoleMat);
        pole.position.set(pX, 3.75, pZ);
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 8), lampGlowMat);
        lamp.position.set(pX > 0 ? -1.2 : 1.2, 7.2, 0);
        pole.add(lamp);
        scene.add(pole);
      });
    }
  }

  // --- МАШИНА ИГРОКА (PBR RUBY METALLIC) ---
  function createPlayerCar() {
    const group = new THREE.Group();

    const bodyMat = new THREE.MeshPhysicalMaterial({
      color: 0xcc1122,
      metalness: 0.9,
      roughness: 0.14,
      clearcoat: 1.0,
      clearcoatRoughness: 0.04
    });

    const carbonMat = new THREE.MeshStandardMaterial({ color: 0x111315, roughness: 0.35, metalness: 0.85 });
    const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x08101a, metalness: 0.9, roughness: 0.05, transmission: 0.75, transparent: true, opacity: 0.9 });

    const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.48, 4.5), bodyMat);
    chassis.position.set(0, 0.42, 0);
    chassis.castShadow = true;
    group.add(chassis);

    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.32, 1.6), bodyMat);
    hood.position.set(0, 0.62, -1.4);
    hood.rotation.x = 0.07;
    group.add(hood);

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.6, 1.85), glassMat);
    cabin.position.set(0, 0.92, 0.2);
    group.add(cabin);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.08, 1.45), carbonMat);
    roof.position.set(0, 1.22, 0.15);
    group.add(roof);

    const wing = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.06, 0.4), carbonMat);
    wing.position.set(0, 1.05, 2.1);
    const postL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.38, 0.14), carbonMat);
    postL.position.set(-0.7, 0.84, 2.1);
    const postR = postL.clone();
    postR.position.x = 0.7;
    group.add(wing, postL, postR);

    // Передние LED фары
    const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x99e5ff, emissiveIntensity: 4.5 });
    [-0.75, 0.75].forEach((x) => {
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.14, 0.08), headMat);
      head.position.set(x, 0.55, -2.24);
      group.add(head);

      const spot = new THREE.SpotLight(0xaae8ff, 4.2, 65, Math.PI / 5, 0.35);
      spot.position.set(x, 0.55, -2.24);
      spot.target.position.set(x, 0.1, -35);
      group.add(spot, spot.target);
    });

    // Задние стоп-сигналы
    const tailMat = new THREE.MeshStandardMaterial({ color: 0xff1a1a, emissive: 0xff0022, emissiveIntensity: 3.5 });
    [-0.75, 0.75].forEach((x) => {
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.14, 0.08), tailMat);
      tail.position.set(x, 0.62, 2.24);
      group.add(tail);
    });

    // Колеса
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111113, roughness: 0.92 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.95, roughness: 0.15 });
    const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.32, 22);
    wheelGeo.rotateZ(Math.PI / 2);

    [-1.02, 1.02].forEach((x) => {
      [-1.38, 1.38].forEach((z) => {
        const wMesh = new THREE.Mesh(wheelGeo, wheelMat);
        const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.34, 14), rimMat);
        rim.rotateZ(Math.PI / 2);
        wMesh.add(rim);
        wMesh.position.set(x, 0.38, z);
        wMesh.castShadow = true;
        group.add(wMesh);
      });
    });

    // Кабина для 1-го лица
    const cockpit = new THREE.Group();
    const dash = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.35, 0.5), carbonMat);
    dash.position.set(0, 0.8, -0.45);
    cockpit.add(dash);

    const steerRing = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.025, 8, 20), wheelMat);
    steerRing.position.set(-0.38, 0.9, -0.28);
    steerRing.rotation.x = -0.35;
    cockpit.add(steerRing);
    group.userData.steeringWheel = steerRing;

    group.add(cockpit);
    return group;
  }

  // --- БРОНЕВИК ТЕРРОРИСТА (ВРАЖЕСКАЯ МАШИНА) ---
  function createEnemyCar() {
    const group = new THREE.Group();

    const armorMat = new THREE.MeshStandardMaterial({ color: 0x24282e, metalness: 0.85, roughness: 0.35 });
    const bullBarMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.95, roughness: 0.1 });
    const camoMat = new THREE.MeshStandardMaterial({ color: 0x3d4338, roughness: 0.7 });

    // Тяжелый корпус
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.85, 4.8), armorMat);
    body.position.set(0, 0.65, 0);
    body.castShadow = true;
    group.add(body);

    // Кабина
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.7, 2.4), camoMat);
    cabin.position.set(0, 1.35, 0.1);
    group.add(cabin);

    // Кенгурятник (Bull-Bar)
    const bullBar = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.8, 0.3), bullBarMat);
    bullBar.position.set(0, 0.65, -2.48);
    group.add(bullBar);

    // Красные вражеские фары
    const evilLightMat = new THREE.MeshStandardMaterial({ color: 0xff0022, emissive: 0xff0022, emissiveIntensity: 4.0 });
    [-0.85, 0.85].forEach((x) => {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.15, 0.1), evilLightMat);
      lamp.position.set(x, 0.75, -2.45);
      group.add(lamp);
    });

    // Маркер-маячок над машиной террориста
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff2200 });
    const beacon = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.9, 4), beaconMat);
    beacon.rotation.x = Math.PI;
    beacon.position.set(0, 2.6, 0);
    group.add(beacon);
    group.userData.beacon = beacon;

    // Внедорожные колеса
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.95 });
    const wheelGeo = new THREE.CylinderGeometry(0.48, 0.48, 0.42, 16);
    wheelGeo.rotateZ(Math.PI / 2);

    [-1.2, 1.2].forEach((x) => {
      [-1.5, 1.5].forEach((z) => {
        const wMesh = new THREE.Mesh(wheelGeo, wheelMat);
        wMesh.position.set(x, 0.48, z);
        wMesh.castShadow = true;
        group.add(wMesh);
      });
    });

    return group;
  }

  // --- СИСТЕМА ЧАСТИЦ ---
  function initParticleSystems() {
    const smokeGeo = new THREE.BufferGeometry();
    const smokeCount = 180;
    const smokePos = new Float32Array(smokeCount * 3);
    const smokeVel = [];
    for (let i = 0; i < smokeCount; i++) {
      smokePos[i * 3 + 1] = -500;
      smokeVel.push(new THREE.Vector3());
    }
    smokeGeo.setAttribute("position", new THREE.BufferAttribute(smokePos, 3));
    const smokeMat = new THREE.PointsMaterial({ color: 0xdddddd, size: 1.1, transparent: true, opacity: 0.4, depthWrite: false });
    smokeParticles = new THREE.Points(smokeGeo, smokeMat);
    smokeParticles.userData = { velocities: smokeVel, life: new Float32Array(smokeCount), nextIdx: 0 };
    scene.add(smokeParticles);

    const sparkGeo = new THREE.BufferGeometry();
    const sparkCount = 150;
    const sparkPos = new Float32Array(sparkCount * 3);
    const sparkVel = [];
    for (let i = 0; i < sparkCount; i++) {
      sparkPos[i * 3 + 1] = -500;
      sparkVel.push(new THREE.Vector3());
    }
    sparkGeo.setAttribute("position", new THREE.BufferAttribute(sparkPos, 3));
    const sparkMat = new THREE.PointsMaterial({ color: 0xffbb33, size: 0.42, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending });
    sparkParticles = new THREE.Points(sparkGeo, sparkMat);
    sparkParticles.userData = { velocities: sparkVel, life: new Float32Array(sparkCount) };
    scene.add(sparkParticles);

    const nitroGeo = new THREE.BufferGeometry();
    const nitroCount = 60;
    const nitroPos = new Float32Array(nitroCount * 3);
    const nitroVel = [];
    for (let i = 0; i < nitroCount; i++) {
      nitroPos[i * 3 + 1] = -500;
      nitroVel.push(new THREE.Vector3());
    }
    nitroGeo.setAttribute("position", new THREE.BufferAttribute(nitroPos, 3));
    const nitroMat = new THREE.PointsMaterial({ color: 0x00f0ff, size: 0.45, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending });
    nitroParticles = new THREE.Points(nitroGeo, nitroMat);
    nitroParticles.userData = { velocities: nitroVel, life: new Float32Array(nitroCount), nextIdx: 0 };
    scene.add(nitroParticles);
  }

  function emitSmoke(rearPos) {
    if (!smokeParticles) return;
    const pos = smokeParticles.geometry.attributes.position.array;
    const vels = smokeParticles.userData.velocities;
    const lives = smokeParticles.userData.life;
    const idx = smokeParticles.userData.nextIdx;

    pos[idx * 3] = rearPos.x + (Math.random() - 0.5) * 0.5;
    pos[idx * 3 + 1] = rearPos.y + 0.1;
    pos[idx * 3 + 2] = rearPos.z + (Math.random() - 0.5) * 0.5;

    vels[idx].set((Math.random() - 0.5) * 2, Math.random() * 1.8 + 0.6, (Math.random() - 0.5) * 2);
    lives[idx] = 1.0;

    smokeParticles.userData.nextIdx = (idx + 1) % 180;
    smokeParticles.geometry.attributes.position.needsUpdate = true;
  }

  function emitSparks(contactPos, count = 25) {
    if (!sparkParticles) return;
    const pos = sparkParticles.geometry.attributes.position.array;
    const vels = sparkParticles.userData.velocities;
    const lives = sparkParticles.userData.life;

    for (let i = 0; i < count; i++) {
      const idx = Math.floor(Math.random() * 150);
      pos[idx * 3] = contactPos.x;
      pos[idx * 3 + 1] = contactPos.y;
      pos[idx * 3 + 2] = contactPos.z;

      vels[idx].set((Math.random() - 0.5) * 18, Math.random() * 12 + 3, (Math.random() - 0.5) * 18);
      lives[idx] = 1.0;
    }
    sparkParticles.geometry.attributes.position.needsUpdate = true;
  }

  function emitNitroFlames(pipePos) {
    if (!nitroParticles) return;
    const pos = nitroParticles.geometry.attributes.position.array;
    const vels = nitroParticles.userData.velocities;
    const lives = nitroParticles.userData.life;
    const idx = nitroParticles.userData.nextIdx;

    pos[idx * 3] = pipePos.x + (Math.random() - 0.5) * 0.15;
    pos[idx * 3 + 1] = pipePos.y;
    pos[idx * 3 + 2] = pipePos.z;

    const backDir = new THREE.Vector3(0, 0, 1).applyQuaternion(carState.quat).multiplyScalar(16);
    vels[idx].copy(backDir).add(new THREE.Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, 0));
    lives[idx] = 1.0;

    nitroParticles.userData.nextIdx = (idx + 1) % 60;
    nitroParticles.geometry.attributes.position.needsUpdate = true;
  }

  function updateParticles(dt) {
    if (smokeParticles) {
      const pos = smokeParticles.geometry.attributes.position.array;
      const vels = smokeParticles.userData.velocities;
      const lives = smokeParticles.userData.life;
      for (let i = 0; i < 180; i++) {
        if (lives[i] > 0) {
          lives[i] -= dt * 1.5;
          pos[i * 3] += vels[i].x * dt;
          pos[i * 3 + 1] += vels[i].y * dt;
          pos[i * 3 + 2] += vels[i].z * dt;
          if (lives[i] <= 0) pos[i * 3 + 1] = -500;
        }
      }
      smokeParticles.geometry.attributes.position.needsUpdate = true;
    }

    if (sparkParticles) {
      const pos = sparkParticles.geometry.attributes.position.array;
      const vels = sparkParticles.userData.velocities;
      const lives = sparkParticles.userData.life;
      for (let i = 0; i < 150; i++) {
        if (lives[i] > 0) {
          lives[i] -= dt * 2.5;
          pos[i * 3] += vels[i].x * dt;
          pos[i * 3 + 1] += vels[i].y * dt;
          pos[i * 3 + 2] += vels[i].z * dt;
          vels[i].y -= 25 * dt;
          if (lives[i] <= 0 || pos[i * 3 + 1] < 0) pos[i * 3 + 1] = -500;
        }
      }
      sparkParticles.geometry.attributes.position.needsUpdate = true;
    }

    if (nitroParticles) {
      const pos = nitroParticles.geometry.attributes.position.array;
      const vels = nitroParticles.userData.velocities;
      const lives = nitroParticles.userData.life;
      for (let i = 0; i < 60; i++) {
        if (lives[i] > 0) {
          lives[i] -= dt * 4.0;
          pos[i * 3] += vels[i].x * dt;
          pos[i * 3 + 1] += vels[i].y * dt;
          pos[i * 3 + 2] += vels[i].z * dt;
          if (lives[i] <= 0) pos[i * 3 + 1] = -500;
        }
      }
      nitroParticles.geometry.attributes.position.needsUpdate = true;
    }
  }

  // --- ФИЗИКА РАМП ---
  function getRampHeightAt(posX, posZ) {
    for (let i = 0; i < ramps.length; i++) {
      const r = ramps[i];
      const dx = posX - r.x;
      const dz = posZ - r.z;
      const cos = Math.cos(-r.rotY);
      const sin = Math.sin(-r.rotY);
      const localX = dx * cos - dz * sin;
      const localZ = dx * sin + dz * cos;

      if (Math.abs(localX) <= r.width / 2 && Math.abs(localZ) <= r.length / 2) {
        const progress = (r.length / 2 - localZ) / r.length;
        if (progress >= 0 && progress <= 1.05) {
          return {
            height: progress * r.height + 0.38,
            angle: r.angle,
            rotY: r.rotY,
            isAtApex: progress >= 0.96
          };
        }
      }
    }
    return null;
  }

  // --- ИИ ТЕРРОРИСТА (CRAIG REYNOLDS STEERING BEHAVIORS) ---
  function checkRayObstacle(origin, dir, maxDist) {
    for (let i = 0; i < cityColliders.length; i++) {
      const b = cityColliders[i];
      const minX = b.minX, maxX = b.maxX, minZ = b.minZ, maxZ = b.maxZ;

      // Тест луча против AABB бокса
      let tmin = (minX - origin.x) / (dir.x || 0.0001);
      let tmax = (maxX - origin.x) / (dir.x || 0.0001);
      if (tmin > tmax) [tmin, tmax] = [tmax, tmin];

      let tzmin = (minZ - origin.z) / (dir.z || 0.0001);
      let tzmax = (maxZ - origin.z) / (dir.z || 0.0001);
      if (tzmin > tzmax) [tzmin, tzmax] = [tzmax, tzmin];

      if (tmin > tzmax || tzmin > tmax) continue;
      if (tzmin > tmin) tmin = tzmin;
      if (tzmax < tmax) tmax = tzmax;

      if (tmin > 0 && tmin < maxDist) {
        return tmin;
      }
    }
    return maxDist;
  }

  function updateEnemyAI(dt) {
    if (enemyState.isDead || !enemyCar) return;
    const e = enemyState;

    // 1. Вектор побега (Flee Vector) от игрока
    const toPlayer = carState.pos.clone().sub(e.pos);
    const distToPlayer = toPlayer.length();

    let desiredDir = toPlayer.clone().negate().normalize();
    desiredDir.y = 0;

    // 2. 3-Raycast сканирование препятствий (Уклонение от зданий)
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(e.quat);
    const leftRay = forward.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.55);
    const rightRay = forward.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -0.55);

    const distFwd = checkRayObstacle(e.pos, forward, e.avoidanceRange);
    const distLeft = checkRayObstacle(e.pos, leftRay, e.avoidanceRange * 0.85);
    const distRight = checkRayObstacle(e.pos, rightRay, e.avoidanceRange * 0.85);

    let avoidanceForce = new THREE.Vector3(0, 0, 0);
    if (distFwd < e.avoidanceRange) {
      if (distLeft > distRight) {
        avoidanceForce.add(leftRay.clone().multiplyScalar((1 - distFwd / e.avoidanceRange) * 3.5));
      } else {
        avoidanceForce.add(rightRay.clone().multiplyScalar((1 - distFwd / e.avoidanceRange) * 3.5));
      }
    } else if (distLeft < e.avoidanceRange * 0.6) {
      avoidanceForce.add(rightRay.clone().multiplyScalar(2.0));
    } else if (distRight < e.avoidanceRange * 0.6) {
      avoidanceForce.add(leftRay.clone().multiplyScalar(2.0));
    }

    const steerForce = desiredDir.add(avoidanceForce).normalize();
    const currentAngle = e.rot.y;
    const targetAngle = Math.atan2(-steerForce.x, -steerForce.z);

    // Плавный поворот ИИ
    let angleDiff = targetAngle - currentAngle;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;

    e.rot.y += Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), e.steerAgility * dt);
    e.quat.setFromEuler(e.rot);

    // Разгон противника
    e.speed = Math.min(e.maxSpeed, e.speed + e.engineForce * dt);
    const moveDir = new THREE.Vector3(0, 0, -1).applyQuaternion(e.quat);
    e.vel.copy(moveDir).multiplyScalar((e.speed / 3.6) * dt);

    const nextPos = e.pos.clone().add(e.vel);
    nextPos.x = Math.max(-460, Math.min(460, nextPos.x));
    nextPos.z = Math.max(-460, Math.min(460, nextPos.z));

    e.pos.copy(nextPos);
    enemyCar.position.copy(e.pos);
    enemyCar.quaternion.copy(e.quat);

    if (enemyCar.userData.beacon) {
      enemyCar.userData.beacon.rotation.y += dt * 4;
    }
  }

  // --- ФИЗИКА ИГРОКА И ДЕТЕКЦИЯ ТАРАНА ---
  function updateCarPhysics(dt) {
    const c = carState;

    const keyGas = keys.KeyW || keys.ArrowUp;
    const keyBrake = keys.KeyS || keys.ArrowDown;
    const keyLeft = keys.KeyA || keys.ArrowLeft;
    const keyRight = keys.KeyD || keys.ArrowRight;
    const keyDrift = keys.Space || keys.ShiftLeft || keys.ShiftRight;
    const keyNitro = (keys.KeyN || keyDrift) && keyGas;

    // Нитро-ускорение (Мощный басовый рев без писка)
    let maxSpeed = 220;
    let accel = 48;
    if (keyNitro && c.nitro > 0 && c.isGrounded) {
      maxSpeed = 290;
      accel = 92;
      c.nitro = Math.max(0, c.nitro - dt * 0.38);

      const pipeOffsetL = new THREE.Vector3(-0.45, 0.32, 2.3).applyQuaternion(c.quat);
      const pipeOffsetR = new THREE.Vector3(0.45, 0.32, 2.3).applyQuaternion(c.quat);
      emitNitroFlames(c.pos.clone().add(pipeOffsetL));
      emitNitroFlames(c.pos.clone().add(pipeOffsetR));

      if (engineFilter) engineFilter.frequency.setTargetAtTime(750, audioCtx?.currentTime || 0, 0.06);
      if (engineGain) engineGain.gain.setTargetAtTime(0.18, audioCtx?.currentTime || 0, 0.05);
    } else {
      c.nitro = Math.min(1.0, c.nitro + dt * 0.08);
      if (engineFilter) engineFilter.frequency.setTargetAtTime(320, audioCtx?.currentTime || 0, 0.08);
      if (engineGain) engineGain.gain.setTargetAtTime(0.09, audioCtx?.currentTime || 0, 0.05);
    }

    // Разгон и торможение
    if (c.isGrounded) {
      if (keyGas) {
        c.speed = Math.min(maxSpeed, c.speed + accel * dt);
      } else if (keyBrake) {
        if (c.speed > 5) {
          c.speed = Math.max(0, c.speed - 85 * dt);
        } else {
          c.speed = Math.max(-50, c.speed - 30 * dt);
        }
      } else {
        c.speed *= Math.pow(0.78, dt);
      }
    }

    // Руление
    const steerInput = (keyRight ? 1 : 0) - (keyLeft ? 1 : 0);
    const steerRate = Math.min(2.6, (Math.abs(c.speed) / 55) * 2.2);
    c.steering = THREE.MathUtils.lerp(c.steering, steerInput * 0.68, dt * 12);

    // Дрифт
    c.isDrifting = keyDrift && Math.abs(c.speed) > 45 && Math.abs(steerInput) > 0.15 && c.isGrounded;
    if (c.isDrifting) {
      c.driftAngle = THREE.MathUtils.lerp(c.driftAngle, -steerInput * 0.52, dt * 7.5);
      currentCombo = Math.min(4, Math.floor(Math.abs(c.speed) / 60) + 1);
      driftScore += Math.round(Math.abs(c.speed) * dt * 8 * currentCombo);
      if (driftScore > maxDriftScore) maxDriftScore = driftScore;

      const rearOffset = new THREE.Vector3(0, 0.2, 1.4).applyQuaternion(c.quat);
      emitSmoke(c.pos.clone().add(rearOffset));
      if (driftGain) driftGain.gain.setTargetAtTime(0.22, audioCtx?.currentTime || 0, 0.04);
    } else {
      c.driftAngle = THREE.MathUtils.lerp(c.driftAngle, 0, dt * 8.5);
      if (driftGain) driftGain.gain.setTargetAtTime(0.0, audioCtx?.currentTime || 0, 0.05);
    }

    // Поворот
    if (Math.abs(c.speed) > 2 && c.isGrounded) {
      const dirSign = c.speed >= 0 ? 1 : -1;
      c.rot.y -= c.steering * steerRate * dirSign * dt * 2.2;
    }

    // Проверка рамп
    const rampData = getRampHeightAt(c.pos.x, c.pos.z);
    if (rampData) {
      c.currentGroundY = rampData.height;
      c.pitchAngle = THREE.MathUtils.lerp(c.pitchAngle, -rampData.angle, dt * 10);

      if (rampData.isAtApex && c.speed > 60 && c.isGrounded) {
        c.isGrounded = false;
        c.verticalSpeed = (c.speed / 3.6) * Math.sin(rampData.angle) * 1.35 + 4.5;
        c.airTime = 0;
      }
    } else {
      c.currentGroundY = 0.38;
      if (c.pos.y > 0.42) {
        c.isGrounded = false;
      }
    }

    // Полет и стабилизация в воздухе
    if (!c.isGrounded) {
      c.airTime += dt;
      c.pos.y += c.verticalSpeed * dt;
      c.verticalSpeed -= 24 * dt;

      c.pitchAngle = THREE.MathUtils.lerp(c.pitchAngle, 0, dt * 3.5);
      c.driftAngle = THREE.MathUtils.lerp(c.driftAngle, 0, dt * 4.0);

      if (c.pos.y <= c.currentGroundY) {
        c.pos.y = c.currentGroundY;
        const impactHardness = Math.abs(c.verticalSpeed);
        c.verticalSpeed = 0;
        c.isGrounded = true;
        c.pitchAngle = 0;

        if (impactHardness > 8) {
          playCrashSound(impactHardness / 20);
          emitSparks(c.pos, 35);
          screenShake.intensity = Math.min(0.7, (impactHardness / 20) * 0.6);
          screenShake.duration = 0.22;
        }
      }
    } else {
      c.pos.y = THREE.MathUtils.lerp(c.pos.y, c.currentGroundY, dt * 20);
      c.verticalSpeed = 0;
    }

    c.quat.setFromEuler(new THREE.Euler(c.pitchAngle, c.rot.y + c.driftAngle, 0, "YXZ"));
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(c.quat);
    c.vel.copy(forward).multiplyScalar((c.speed / 3.6) * dt);

    const nextPos = c.pos.clone().add(c.vel);
    let collided = false;

    if (Math.abs(nextPos.x) > 480 || Math.abs(nextPos.z) > 480) {
      c.speed = -c.speed * 0.4;
      collided = true;
    }

    for (let i = 0; i < cityColliders.length; i++) {
      const bld = cityColliders[i];
      if (
        nextPos.x >= bld.minX &&
        nextPos.x <= bld.maxX &&
        nextPos.z >= bld.minZ &&
        nextPos.z <= bld.maxZ &&
        nextPos.y < bld.height
      ) {
        c.speed = -c.speed * 0.35;
        emitSparks(nextPos, 20);
        screenShake.intensity = 0.5;
        screenShake.duration = 0.2;
        collided = true;
        break;
      }
    }

    if (!collided) {
      c.pos.x = nextPos.x;
      c.pos.z = nextPos.z;
    }

    // --- ДЕТЕКЦИЯ ТАРАНА ТЕРРОРИСТА (TAKEDOWN) ---
    if (!enemyState.isDead && enemyCar) {
      const distToEnemy = c.pos.distanceTo(enemyState.pos);
      if (distToEnemy < 3.8) {
        const relSpeed = Math.abs(c.speed - enemyState.speed);
        if (c.speed > 55) {
          const damage = Math.round(Math.max(18, relSpeed * 0.65 + 15));
          enemyState.hp = Math.max(0, enemyState.hp - damage);

          const midPoint = c.pos.clone().add(enemyState.pos).multiplyScalar(0.5);
          emitSparks(midPoint, 45);
          playCrashSound(1.2);

          screenShake.intensity = 0.8;
          screenShake.duration = 0.3;

          // Отскок
          const pushDir = enemyState.pos.clone().sub(c.pos).normalize();
          enemyState.pos.add(pushDir.clone().multiplyScalar(4.5));
          c.speed *= 0.55;

          if (enemyState.hp <= 0) {
            // ПОБЕДА: ТАРАН ЗАВЕРШЕН (SLOW-MO)
            enemyState.isDead = true;
            slowMoTimer = 1.6;
            setTimeout(() => onLevelComplete(), 900);
          }
        }
      }
    }

    if (playerCar) {
      playerCar.position.copy(c.pos);
      playerCar.quaternion.copy(c.quat);
      if (playerCar.userData.steeringWheel) {
        playerCar.userData.steeringWheel.rotation.z = -c.steering * 1.8;
      }
    }

    if (engineOsc && engineSub && audioCtx) {
      const pitch = 42 + (Math.abs(c.speed) / 290) * 240;
      engineOsc.frequency.setTargetAtTime(pitch, audioCtx.currentTime, 0.05);
      engineSub.frequency.setTargetAtTime(pitch * 0.5, audioCtx.currentTime, 0.05);
    }
  }

  function onLevelComplete() {
    isPaused = true;
    const reward = 45000 + (level - 1) * 15000;

    const resModal = document.getElementById("city3d-result");
    const resTitle = document.getElementById("city3d-result-title");
    const resSub = document.getElementById("city3d-result-sub");

    if (resTitle) resTitle.textContent = `🎯 ТАРАН УСПЕШЕН! УРОВЕНЬ ${level} ПРОЙДЕН`;
    if (resSub) resSub.textContent = `Награда: +$${reward.toLocaleString("ru-RU")} | Трофеи зачислены на склад`;
    if (resModal) resModal.classList.remove("hidden");

    let bal = Number(localStorage.getItem("notWeaponWallet") || 0);
    bal += reward;
    localStorage.setItem("notWeaponWallet", String(bal));

    const stock = JSON.parse(localStorage.getItem("notWeaponStock") || '{"weapon":0,"grenade":0,"ammo":0}');
    stock.weapon = (stock.weapon || 0) + 12;
    stock.grenade = (stock.grenade || 0) + 18;
    stock.ammo = (stock.ammo || 0) + 30;
    localStorage.setItem("notWeaponStock", JSON.stringify(stock));
  }

  // --- ОБНОВЛЕНИЕ КАМЕРЫ И ИНТЕРФЕЙСА ---
  function updateCamera(dt) {
    if (!camera || !playerCar) return;

    let shake = new THREE.Vector3();
    if (screenShake.duration > 0) {
      screenShake.duration -= dt;
      shake.set(
        (Math.random() - 0.5) * screenShake.intensity,
        (Math.random() - 0.5) * screenShake.intensity,
        (Math.random() - 0.5) * screenShake.intensity
      );
    }

    if (cameraMode === 1) {
      const eyePos = carState.pos.clone().add(
        new THREE.Vector3(0, 1.05, -0.15).applyQuaternion(carState.quat)
      );
      camera.position.copy(eyePos).add(shake);

      const lookTarget = carState.pos.clone().add(
        new THREE.Vector3(0, 0.95, -35).applyQuaternion(carState.quat)
      );
      camera.lookAt(lookTarget);
      camera.fov = 76 + (carState.speed / 290) * 14;
    } else {
      const camDist = 9.5 + (carState.speed / 260) * 3.8;
      const camHeight = 3.3 + (carState.speed / 260) * 0.8 + (carState.isGrounded ? 0 : 1.2);

      const desiredPos = carState.pos.clone().add(
        new THREE.Vector3(0, camHeight, camDist).applyQuaternion(carState.quat)
      );
      camera.position.lerp(desiredPos, 0.16).add(shake);

      const lookTarget = carState.pos.clone().add(
        new THREE.Vector3(0, 1.15, -18).applyQuaternion(carState.quat)
      );
      camera.lookAt(lookTarget);
      camera.fov = 64 + (carState.speed / 290) * 16;
    }
    camera.updateProjectionMatrix();
  }

  function updateHUD() {
    const spdEl = document.getElementById("city3d-speed-value");
    if (spdEl) spdEl.textContent = String(Math.round(Math.abs(carState.speed)));

    const nitroEl = document.getElementById("city3d-nitro-fill");
    if (nitroEl) nitroEl.style.width = `${Math.round(carState.nitro * 100)}%`;

    const lvlEl = document.getElementById("city3d-level-badge");
    if (lvlEl) lvlEl.textContent = `УРОВЕНЬ ${level}`;

    const distEl = document.getElementById("city3d-enemy-dist");
    if (distEl) {
      const dist = Math.round(carState.pos.distanceTo(enemyState.pos));
      distEl.textContent = `🎯 ЦЕЛЬ: ${dist}м`;
    }

    const hpFill = document.getElementById("city3d-enemy-hp-fill");
    if (hpFill) {
      const pct = Math.max(0, Math.round((enemyState.hp / enemyState.maxHp) * 100));
      hpFill.style.width = `${pct}%`;
    }

    const driftEl = document.getElementById("city3d-drift-score");
    if (driftEl) {
      if (carState.isDrifting) {
        driftEl.classList.remove("hidden");
        driftEl.textContent = `🔥 DRIFT +${driftScore} (x${currentCombo})`;
      } else {
        driftEl.classList.add("hidden");
      }
    }
  }

  // --- ИГРОВОЙ ЦИКЛ ---
  let lastTime = 0;
  function animate(now = 0) {
    if (!running) return;
    let dt = Math.min(0.04, (now - (lastTime || now)) / 1000);
    lastTime = now;

    if (slowMoTimer > 0) {
      slowMoTimer -= dt;
      dt *= 0.25; // Замедление времени
    }

    if (!isPaused) {
      updateCarPhysics(dt);
      updateEnemyAI(dt);
      updateParticles(dt);
      updateCamera(dt);
      updateHUD();
    }

    renderer.render(scene, camera);
    frame = requestAnimationFrame(animate);
  }

  function resetCanvas() {
    const old = document.getElementById("city3d-canvas");
    if (!old) return;
    const canvas = old.cloneNode(false);
    old.replaceWith(canvas);

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(1100, 700, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a2233);
    scene.fog = new THREE.FogExp2(0x161d2b, 0.0018);

    camera = new THREE.PerspectiveCamera(64, 1100 / 700, 0.2, 1000);
    camera.position.set(0, 3.6, 9.5);
    camera.lookAt(0, 1.15, -18);

    const ambientLight = new THREE.AmbientLight(0xb0c8e8, 1.2);
    scene.add(ambientLight);

    const hemiLight = new THREE.HemisphereLight(0x90b8ff, 0x221828, 1.3);
    scene.add(hemiLight);

    const mainLight = new THREE.DirectionalLight(0xffeedd, 2.2);
    mainLight.position.set(-80, 150, -60);
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.set(2048, 2048);
    mainLight.shadow.camera.near = 10;
    mainLight.shadow.camera.far = 400;
    const d = 180;
    mainLight.shadow.camera.left = -d;
    mainLight.shadow.camera.right = d;
    mainLight.shadow.camera.top = d;
    mainLight.shadow.camera.bottom = -d;
    scene.add(mainLight);
  }

  window.addEventListener("keydown", (e) => {
    keys[e.code] = true;
    if (running && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) {
      e.preventDefault();
    }
    if (running && e.code === "KeyV") {
      cameraMode = cameraMode === 0 ? 1 : 0;
      const btn = document.getElementById("city3d-cam-btn");
      if (btn) btn.textContent = cameraMode === 0 ? "Камера [V]: Сзади" : "Камера [V]: Кокпит";
    }
  });

  window.addEventListener("keyup", (e) => {
    keys[e.code] = false;
  });

  // --- ПУБЛИЧНЫЙ API ---
  window.City3D = {
    start() {
      this.stop();
      initAudio();
      resetCanvas();

      driftScore = 0;
      currentCombo = 1;
      cameraMode = 0;
      slowMoTimer = 0;

      carState.pos.set(0, 0.4, 0);
      carState.rot.set(0, 0, 0);
      carState.speed = 0;
      carState.verticalSpeed = 0;
      carState.isGrounded = true;
      carState.steering = 0;
      carState.nitro = 1.0;
      carState.pitchAngle = 0;

      // Настройка противника в зависимости от уровня
      enemyState.pos.set(0, 0.4, -65);
      enemyState.rot.set(0, Math.PI, 0);
      enemyState.speed = 0;
      enemyState.maxHp = 100 + (level - 1) * 35;
      enemyState.hp = enemyState.maxHp;
      enemyState.maxSpeed = 165 + (level - 1) * 8;
      enemyState.avoidanceRange = 26 + (level - 1) * 4;
      enemyState.steerAgility = 2.2 + (level - 1) * 0.2;
      enemyState.isDead = false;

      buildOpenCity();
      initParticleSystems();

      playerCar = createPlayerCar();
      scene.add(playerCar);

      enemyCar = createEnemyCar();
      scene.add(enemyCar);

      camera.position.set(0, 3.6, 9.5);
      camera.lookAt(0, 1.15, -18);
      updateCamera(0.016);
      updateHUD();
      renderer.render(scene, camera);

      running = true;
      isPaused = false;
      lastTime = performance.now();
      frame = requestAnimationFrame(animate);
    },

    nextLevel() {
      level += 1;
      const resModal = document.getElementById("city3d-result");
      if (resModal) resModal.classList.add("hidden");
      this.start();
    },

    stop() {
      running = false;
      if (frame) cancelAnimationFrame(frame);
      if (engineGain) engineGain.gain.setValueAtTime(0, audioCtx?.currentTime || 0);
      if (driftGain) driftGain.gain.setValueAtTime(0, audioCtx?.currentTime || 0);
      if (renderer) renderer.dispose();
    },

    toggleCamera() {
      cameraMode = cameraMode === 0 ? 1 : 0;
      const btn = document.getElementById("city3d-cam-btn");
      if (btn) btn.textContent = cameraMode === 0 ? "Камера [V]: Сзади" : "Камера [V]: Кокпит";
    },

    isRunning() {
      return running;
    }
  };
})();
