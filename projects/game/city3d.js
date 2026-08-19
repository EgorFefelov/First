// projects/game/city3d.js — 3D Автосимулятор в открытом разрушенном городе (Need for Speed style)
// Физика дрифта, ИИ Крейга Рейнольдса (Steering Behaviors), InstancedMesh город, PBR и бесконечные миссии.
(() => {
  const THREE = window.THREE;
  if (!THREE) return;

  // --- СОСТОЯНИЕ ДВИЖКА ---
  let renderer = null, scene = null, camera = null, frame = null;
  let running = false, isPaused = false, isPreview = false;
  let level = 1, takedownScore = 0, currentDriftScore = 0;
  let cameraMode = 0; // 0 = 3-е лицо (сзади), 1 = 1-е лицо (кокпит)
  
  // Объекты мира
  let playerCar = null, enemyCar = null;
  let cityColliders = []; // Пространственные боксы для Raycast и коллизий
  let sparkParticles = null, smokeParticles = null;
  let skidmarkMesh = null;
  let screenShake = { intensity: 0, duration: 0 };
  let slowMoTimer = 0;

  const keys = Object.create(null);

  // Параметры игрока
  const playerState = {
    pos: new THREE.Vector3(0, 0.4, 0),
    vel: new THREE.Vector3(0, 0, 0),
    rot: new THREE.Euler(0, 0, 0, "YXZ"),
    quat: new THREE.Quaternion(),
    speed: 0, // км/ч
    steering: 0,
    throttle: 0,
    brake: 0,
    nitro: 1.0,
    isDrifting: false,
    driftAngle: 0,
    health: 100
  };

  // Параметры врага (ИИ террориста)
  const enemyState = {
    pos: new THREE.Vector3(0, 0.4, -60),
    vel: new THREE.Vector3(0, 0, 0),
    rot: new THREE.Euler(0, 0, 0, "YXZ"),
    quat: new THREE.Quaternion(),
    speed: 0,
    steering: 0,
    health: 100,
    maxHealth: 100,
    isDestroyed: false,
    takedownTriggered: false,
    // Параметры масштабирования сложности
    maxSpeed: 160,
    engineForce: 38,
    avoidRange: 26,
    agility: 2.2,
    mass: 1.0
  };

  // --- АУДИО СИНТЕЗАТОР ДВИГАТЕЛЯ И ЭФФЕКТОВ ---
  let audioCtx = null;
  let engineGain = null, engineOsc = null;
  let driftGain = null, driftNoise = null;

  function initAudio() {
    if (audioCtx) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      audioCtx = new AudioContext();

      // Осциллятор двигателя
      engineOsc = audioCtx.createOscillator();
      engineOsc.type = "sawtooth";
      engineOsc.frequency.setValueAtTime(45, audioCtx.currentTime);

      const engineFilter = audioCtx.createBiquadFilter();
      engineFilter.type = "lowpass";
      engineFilter.frequency.setValueAtTime(280, audioCtx.currentTime);

      engineGain = audioCtx.createGain();
      engineGain.gain.setValueAtTime(0.08, audioCtx.currentTime);

      engineOsc.connect(engineFilter);
      engineFilter.connect(engineGain);
      engineGain.connect(audioCtx.destination);
      engineOsc.start();

      // Генератор шума дрифта/шин
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
      driftFilter.frequency.setValueAtTime(800, audioCtx.currentTime);
      driftFilter.Q.setValueAtTime(2.5, audioCtx.currentTime);

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
      osc.type = "triangle";
      osc.frequency.setValueAtTime(120, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(30, audioCtx.currentTime + 0.35);

      gain.gain.setValueAtTime(Math.min(0.6, 0.2 * intensity), audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.35);

      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.36);
    } catch (e) {}
  }

  // --- ПОСТРОЕНИЕ ГОРОДА И ОКРУЖЕНИЯ (INSTANCED MESH) ---
  function buildDestroyedCity() {
    cityColliders.length = 0;

    // 1. Асфальтовое покрытие города (огромная плоскость 800x800)
    const groundGeo = new THREE.PlaneGeometry(800, 800, 32, 32);
    const groundTex = new THREE.TextureLoader().load("road-asphalt.jpg");
    groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
    groundTex.repeat.set(80, 80);
    groundTex.colorSpace = THREE.SRGBColorSpace;

    const groundMat = new THREE.MeshStandardMaterial({
      map: groundTex,
      color: 0x383a3d,
      roughness: 0.88,
      metalness: 0.12
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // 2. Дорожная разметка главных проспектов (Инстансинг)
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xf5f5eb });
    const lineGeo = new THREE.PlaneGeometry(0.3, 4.5);
    lineGeo.rotateX(-Math.PI / 2);

    const roadDashes = new THREE.InstancedMesh(lineGeo, lineMat, 800);
    let dashIdx = 0;
    const dummy = new THREE.Object3D();

    // Сетка дорог: проспекты через каждые 80 метров вдоль X и Z
    for (let axis = -320; axis <= 320; axis += 80) {
      // Дороги вдоль Z
      for (let z = -360; z <= 360; z += 12) {
        if (dashIdx < 800) {
          dummy.position.set(axis, 0.03, z);
          dummy.rotation.set(0, 0, 0);
          dummy.updateMatrix();
          roadDashes.setMatrixAt(dashIdx++, dummy.matrix);
        }
      }
      // Дороги вдоль X
      for (let x = -360; x <= 360; x += 12) {
        if (dashIdx < 800) {
          dummy.position.set(x, 0.03, axis);
          dummy.rotation.set(0, Math.PI / 2, 0);
          dummy.updateMatrix();
          roadDashes.setMatrixAt(dashIdx++, dummy.matrix);
        }
      }
    }
    roadDashes.instanceMatrix.needsUpdate = true;
    scene.add(roadDashes);

    // 3. Разрушенные небоскрёбы и здания через InstancedMesh
    const bldgMatA = new THREE.MeshStandardMaterial({
      color: 0x22262b,
      roughness: 0.92,
      metalness: 0.15
    });
    const bldgMatB = new THREE.MeshStandardMaterial({
      color: 0x363430,
      roughness: 0.95,
      metalness: 0.08
    });

    const bldgGeoA = new THREE.BoxGeometry(1, 1, 1);
    const instBldgA = new THREE.InstancedMesh(bldgGeoA, bldgMatA, 250);
    const instBldgB = new THREE.InstancedMesh(bldgGeoA, bldgMatB, 250);
    instBldgA.castShadow = true;
    instBldgA.receiveShadow = true;
    instBldgB.castShadow = true;
    instBldgB.receiveShadow = true;

    let bldgCountA = 0, bldgCountB = 0;

    // Расстановка кварталов зданий между дорогами (размеры кварталов 55x55)
    for (let qX = -320; qX < 320; qX += 80) {
      for (let qZ = -320; qZ < 320; qZ += 80) {
        // Центр квартала
        const cX = qX + 40;
        const cZ = qZ + 40;

        // 2-3 здания на квартал с разной высотой и сколами
        const numBldg = 2 + Math.floor(Math.random() * 2);
        for (let b = 0; b < numBldg; b++) {
          const w = 18 + Math.random() * 14;
          const d = 18 + Math.random() * 14;
          const h = 25 + Math.random() * 55; // Высота до 80м
          const posX = cX + (b === 0 ? -12 : 12) + (Math.random() - 0.5) * 6;
          const posZ = cZ + (b === 0 ? -12 : 12) + (Math.random() - 0.5) * 6;

          dummy.position.set(posX, h / 2, posZ);
          dummy.scale.set(w, h, d);
          dummy.rotation.set(0, (Math.floor(Math.random() * 4) * Math.PI) / 2, 0);
          dummy.updateMatrix();

          if (Math.random() < 0.5 && bldgCountA < 250) {
            instBldgA.setMatrixAt(bldgCountA++, dummy.matrix);
          } else if (bldgCountB < 250) {
            instBldgB.setMatrixAt(bldgCountB++, dummy.matrix);
          }

          // Добавляем коллайдер здания для физики и Raycast ИИ
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
    instBldgA.instanceMatrix.needsUpdate = true;
    instBldgB.instanceMatrix.needsUpdate = true;
    scene.add(instBldgA);
    scene.add(instBldgB);

    // 4. Бетонные блоки, обломки и трамплины (Ramps)
    const barrierMat = new THREE.MeshStandardMaterial({ color: 0x4f4c47, roughness: 0.95 });
    const barrierGeo = new THREE.BoxGeometry(4.2, 1.4, 1.2);
    const instBarriers = new THREE.InstancedMesh(barrierGeo, barrierMat, 120);
    instBarriers.castShadow = true;
    instBarriers.receiveShadow = true;

    let barIdx = 0;
    // Размещаем завалы и препятствия на перекрёстках
    for (let rX = -240; rX <= 240; rX += 80) {
      for (let rZ = -240; rZ <= 240; rZ += 80) {
        if (Math.random() < 0.45 && barIdx < 120) {
          const side = Math.random() < 0.5 ? -1 : 1;
          const pX = rX + side * 14;
          const pZ = rZ + (Math.random() - 0.5) * 16;
          dummy.position.set(pX, 0.7, pZ);
          dummy.rotation.set(0, Math.random() * Math.PI, 0);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          instBarriers.setMatrixAt(barIdx++, dummy.matrix);

          cityColliders.push({
            minX: pX - 2.5,
            maxX: pX + 2.5,
            minZ: pZ - 1.5,
            maxZ: pZ + 1.5,
            height: 1.5
          });
        }
      }
    }
    instBarriers.instanceMatrix.needsUpdate = true;
    scene.add(instBarriers);

    // 5. Трамплины для прыжков (Ramps)
    const rampMat = new THREE.MeshStandardMaterial({ color: 0x8a4513, roughness: 0.8 });
    for (let i = 0; i < 8; i++) {
      const rampGroup = new THREE.Group();
      const rampGeo = new THREE.BoxGeometry(6.5, 1.2, 8.0);
      const rampMesh = new THREE.Mesh(rampGeo, rampMat);
      rampMesh.rotation.x = -0.18;
      rampMesh.position.set(0, 0.5, 0);
      rampMesh.castShadow = true;
      rampMesh.receiveShadow = true;
      rampGroup.add(rampMesh);

      const rX = [-160, 0, 160][i % 3];
      const rZ = [-160, -80, 80, 160][Math.floor(i / 2) % 4];
      rampGroup.position.set(rX + (i % 2 === 0 ? 0 : 80), 0, rZ);
      scene.add(rampGroup);
    }
  }

  // --- ПОСТРОЕНИЕ 3D МОДЕЛЕЙ АВТОМОБИЛЕЙ ---
  function createPlayerCarMesh() {
    const group = new THREE.Group();

    // 1. Кузов спорткара (Ruby Red Metallic с Clearcoat эффектом)
    const bodyMat = new THREE.MeshPhysicalMaterial({
      color: 0xd61828,
      metalness: 0.85,
      roughness: 0.18,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05
    });

    const carbonMat = new THREE.MeshStandardMaterial({
      color: 0x141416,
      roughness: 0.4,
      metalness: 0.8
    });

    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x0a141e,
      metalness: 0.9,
      roughness: 0.05,
      transmission: 0.7,
      transparent: true,
      opacity: 0.85
    });

    // Нижняя часть шасси
    const chassisGeo = new THREE.BoxGeometry(2.0, 0.5, 4.4);
    const chassis = new THREE.Mesh(chassisGeo, bodyMat);
    chassis.position.set(0, 0.45, 0);
    chassis.castShadow = true;
    group.add(chassis);

    // Капот и передняя часть
    const hoodGeo = new THREE.BoxGeometry(1.9, 0.35, 1.5);
    const hood = new THREE.Mesh(hoodGeo, bodyMat);
    hood.position.set(0, 0.65, -1.35);
    hood.rotation.x = 0.08;
    group.add(hood);

    // Кабина и стёкла
    const cabinGeo = new THREE.BoxGeometry(1.65, 0.58, 1.8);
    const cabin = new THREE.Mesh(cabinGeo, glassMat);
    cabin.position.set(0, 0.95, 0.2);
    group.add(cabin);

    // Крыша
    const roofGeo = new THREE.BoxGeometry(1.58, 0.08, 1.4);
    const roof = new THREE.Mesh(roofGeo, carbonMat);
    roof.position.set(0, 1.25, 0.15);
    group.add(roof);

    // Спойлер на багажнике
    const spoilerWing = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.06, 0.35), carbonMat);
    spoilerWing.position.set(0, 1.05, 2.05);
    const postL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.35, 0.12), carbonMat);
    postL.position.set(-0.65, 0.85, 2.05);
    const postR = postL.clone();
    postR.position.x = 0.65;
    group.add(spoilerWing, postL, postR);

    // Фары передние (LED с ярким свечением)
    const headMat = new THREE.MeshStandardMaterial({
      color: 0xe0f7ff,
      emissive: 0x88e2ff,
      emissiveIntensity: 3.5
    });
    [-0.72, 0.72].forEach((x) => {
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, 0.08), headMat);
      head.position.set(x, 0.58, -2.18);
      group.add(head);

      // Источник света фар
      const light = new THREE.SpotLight(0xaae8ff, 3.5, 55, Math.PI / 6, 0.4);
      light.position.set(x, 0.58, -2.18);
      light.target.position.set(x, 0.1, -30);
      group.add(light, light.target);
    });

    // Задние фонари
    const tailMat = new THREE.MeshStandardMaterial({
      color: 0xff1e1e,
      emissive: 0xff0000,
      emissiveIntensity: 2.8
    });
    [-0.72, 0.72].forEach((x) => {
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.08), tailMat);
      tail.position.set(x, 0.65, 2.18);
      group.add(tail);
    });

    // Колёса (Литые диски + резина)
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111113, roughness: 0.9 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.9, roughness: 0.2 });
    const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.32, 20);
    wheelGeo.rotateZ(Math.PI / 2);

    [-0.98, 0.98].forEach((x) => {
      [-1.35, 1.35].forEach((z) => {
        const wMesh = new THREE.Mesh(wheelGeo, wheelMat);
        const rimMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.34, 12), rimMat);
        rimMesh.rotateZ(Math.PI / 2);
        wMesh.add(rimMesh);
        wMesh.position.set(x, 0.38, z);
        wMesh.castShadow = true;
        group.add(wMesh);
      });
    });

    // Интерьер кабины (для вида от 1-го лица)
    const cockpit = new THREE.Group();
    const dash = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.35, 0.5), carbonMat);
    dash.position.set(0, 0.82, -0.45);
    cockpit.add(dash);

    const steerGroup = new THREE.Group();
    const steerRing = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.025, 8, 20), wheelMat);
    steerGroup.add(steerRing);
    steerGroup.position.set(-0.38, 0.92, -0.28);
    steerGroup.rotation.x = -0.35;
    cockpit.add(steerGroup);
    group.userData.steeringWheel = steerGroup;

    group.add(cockpit);
    return group;
  }

  function createEnemyCarMesh() {
    const group = new THREE.Group();

    // Бронированный чёрно-камуфляжный корпус
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x1c1e22,
      metalness: 0.7,
      roughness: 0.5
    });
    const armorMat = new THREE.MeshStandardMaterial({
      color: 0x3d3835,
      metalness: 0.9,
      roughness: 0.3
    });

    // Кузов внедорожника
    const mainBody = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.9, 4.6), bodyMat);
    mainBody.position.set(0, 0.75, 0);
    mainBody.castShadow = true;
    group.add(mainBody);

    // Бронированная крыша
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.75, 2.5), bodyMat);
    cabin.position.set(0, 1.45, 0.2);
    cabin.castShadow = true;
    group.add(cabin);

    // Мощный передний силовой кенгурятник (Bull-Bar)
    const bullBar = new THREE.Mesh(new THREE.BoxGeometry(2.25, 0.65, 0.25), armorMat);
    bullBar.position.set(0, 0.65, -2.4);
    group.add(bullBar);

    // Агрессивные красные фары
    const evilHeadMat = new THREE.MeshStandardMaterial({
      color: 0xff2200,
      emissive: 0xff1100,
      emissiveIntensity: 4.0
    });
    [-0.8, 0.8].forEach((x) => {
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.16, 0.08), evilHeadMat);
      head.position.set(x, 0.75, -2.32);
      group.add(head);
    });

    // Тяжёлые колёса
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111113, roughness: 0.95 });
    const wheelGeo = new THREE.CylinderGeometry(0.46, 0.46, 0.38, 16);
    wheelGeo.rotateZ(Math.PI / 2);

    [-1.08, 1.08].forEach((x) => {
      [-1.45, 1.45].forEach((z) => {
        const w = new THREE.Mesh(wheelGeo, wheelMat);
        w.position.set(x, 0.46, z);
        w.castShadow = true;
        group.add(w);
      });
    });

    // Маркер цели над машиной (3D ромб)
    const targetMarker = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.65, 0),
      new THREE.MeshBasicMaterial({ color: 0xff3300, wireframe: true })
    );
    targetMarker.position.set(0, 2.9, 0);
    group.add(targetMarker);
    group.userData.marker = targetMarker;

    return group;
  }

  // --- СИСТЕМА ЧАСТИЦ (ИСКРЫ ТАРАНА И ДЫМ ДРИФТА) ---
  function initParticleSystems() {
    // 1. Искры при столкновениях
    const sparkGeo = new THREE.BufferGeometry();
    const sparkCount = 120;
    const sparkPositions = new Float32Array(sparkCount * 3);
    const sparkVelocities = [];

    for (let i = 0; i < sparkCount; i++) {
      sparkPositions[i * 3 + 1] = -500; // прячем за сценой
      sparkVelocities.push(new THREE.Vector3());
    }
    sparkGeo.setAttribute("position", new THREE.BufferAttribute(sparkPositions, 3));

    const sparkMat = new THREE.PointsMaterial({
      color: 0xffaa22,
      size: 0.35,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending
    });
    sparkParticles = new THREE.Points(sparkGeo, sparkMat);
    sparkParticles.userData = { velocities: sparkVelocities, life: new Float32Array(sparkCount) };
    scene.add(sparkParticles);

    // 2. Дым из-под колес при дрифте
    const smokeGeo = new THREE.BufferGeometry();
    const smokeCount = 160;
    const smokePos = new Float32Array(smokeCount * 3);
    const smokeVel = [];

    for (let i = 0; i < smokeCount; i++) {
      smokePos[i * 3 + 1] = -500;
      smokeVel.push(new THREE.Vector3());
    }
    smokeGeo.setAttribute("position", new THREE.BufferAttribute(smokePos, 3));

    const smokeMat = new THREE.PointsMaterial({
      color: 0xcccccc,
      size: 0.9,
      transparent: true,
      opacity: 0.35,
      depthWrite: false
    });
    smokeParticles = new THREE.Points(smokeGeo, smokeMat);
    smokeParticles.userData = { velocities: smokeVel, life: new Float32Array(smokeCount), nextIdx: 0 };
    scene.add(smokeParticles);
  }

  function emitSparks(contactPoint, count = 25) {
    if (!sparkParticles) return;
    const pos = sparkParticles.geometry.attributes.position.array;
    const vels = sparkParticles.userData.velocities;
    const lives = sparkParticles.userData.life;

    for (let i = 0; i < count; i++) {
      const idx = Math.floor(Math.random() * 120);
      pos[idx * 3] = contactPoint.x;
      pos[idx * 3 + 1] = contactPoint.y;
      pos[idx * 3 + 2] = contactPoint.z;

      vels[idx].set(
        (Math.random() - 0.5) * 18,
        Math.random() * 12 + 2,
        (Math.random() - 0.5) * 18
      );
      lives[idx] = 1.0;
    }
    sparkParticles.geometry.attributes.position.needsUpdate = true;
  }

  function emitDriftSmoke(rearWheelPos) {
    if (!smokeParticles) return;
    const pos = smokeParticles.geometry.attributes.position.array;
    const vels = smokeParticles.userData.velocities;
    const lives = smokeParticles.userData.life;
    let idx = smokeParticles.userData.nextIdx;

    pos[idx * 3] = rearWheelPos.x + (Math.random() - 0.5) * 0.4;
    pos[idx * 3 + 1] = rearWheelPos.y + 0.1;
    pos[idx * 3 + 2] = rearWheelPos.z + (Math.random() - 0.5) * 0.4;

    vels[idx].set((Math.random() - 0.5) * 2, Math.random() * 1.5 + 0.5, (Math.random() - 0.5) * 2);
    lives[idx] = 1.0;

    smokeParticles.userData.nextIdx = (idx + 1) % 160;
    smokeParticles.geometry.attributes.position.needsUpdate = true;
  }

  function updateParticles(dt) {
    // Искры
    if (sparkParticles) {
      const pos = sparkParticles.geometry.attributes.position.array;
      const vels = sparkParticles.userData.velocities;
      const lives = sparkParticles.userData.life;

      for (let i = 0; i < 120; i++) {
        if (lives[i] > 0) {
          lives[i] -= dt * 2.8;
          pos[i * 3] += vels[i].x * dt;
          pos[i * 3 + 1] += vels[i].y * dt;
          pos[i * 3 + 2] += vels[i].z * dt;
          vels[i].y -= 25 * dt; // Гравитация
          if (lives[i] <= 0 || pos[i * 3 + 1] < 0) {
            pos[i * 3 + 1] = -500;
          }
        }
      }
      sparkParticles.geometry.attributes.position.needsUpdate = true;
    }

    // Дым
    if (smokeParticles) {
      const pos = smokeParticles.geometry.attributes.position.array;
      const vels = smokeParticles.userData.velocities;
      const lives = smokeParticles.userData.life;

      for (let i = 0; i < 160; i++) {
        if (lives[i] > 0) {
          lives[i] -= dt * 1.6;
          pos[i * 3] += vels[i].x * dt;
          pos[i * 3 + 1] += vels[i].y * dt;
          pos[i * 3 + 2] += vels[i].z * dt;
          if (lives[i] <= 0) pos[i * 3 + 1] = -500;
        }
      }
      smokeParticles.geometry.attributes.position.needsUpdate = true;
    }
  }

  // --- АРКАДНАЯ ФИЗИКА ИГРОКА (RAYCAST & DRIFT) ---
  function updatePlayerPhysics(dt) {
    const p = playerState;

    const keyGas = keys.KeyW || keys.ArrowUp;
    const keyBrake = keys.KeyS || keys.ArrowDown;
    const keyLeft = keys.KeyA || keys.ArrowLeft;
    const keyRight = keys.KeyD || keys.ArrowRight;
    const keyDrift = keys.ShiftLeft || keys.ShiftRight || keys.Space;
    const keyNitro = (keys.KeyN || keyDrift) && keyGas;

    // Нитро ускорение
    let maxSpeed = 210;
    let accelRate = 42;
    if (keyNitro && p.nitro > 0) {
      maxSpeed = 275;
      accelRate = 85;
      p.nitro = Math.max(0, p.nitro - dt * 0.35);
    } else {
      p.nitro = Math.min(1.0, p.nitro + dt * 0.08);
    }

    // Разгон и торможение
    if (keyGas) {
      p.speed = Math.min(maxSpeed, p.speed + accelRate * dt);
    } else if (keyBrake) {
      if (p.speed > 5) {
        p.speed = Math.max(0, p.speed - 75 * dt); // Тормоз
      } else {
        p.speed = Math.max(-45, p.speed - 25 * dt); // Задний ход
      }
    } else {
      // Естественное замедление трением
      p.speed *= Math.pow(0.72, dt);
    }

    // Рулевое управление
    const steerInput = (keyRight ? 1 : 0) - (keyLeft ? 1 : 0);
    const steerAgility = Math.min(2.8, (p.speed / 50) * 2.2);
    p.steering = THREE.MathUtils.lerp(p.steering, steerInput * 0.65, dt * 10);

    // Механика дрифта (Need for Speed)
    p.isDrifting = keyDrift && Math.abs(p.speed) > 40 && Math.abs(steerInput) > 0.2;
    if (p.isDrifting) {
      p.driftAngle = THREE.MathUtils.lerp(p.driftAngle, -steerInput * 0.45, dt * 6.5);
      currentDriftScore += Math.round(Math.abs(p.speed) * dt * 5);
      // Эмиссия дыма из-под задних колес
      const backOffset = new THREE.Vector3(0, 0.2, 1.4).applyQuaternion(p.quat);
      emitDriftSmoke(p.pos.clone().add(backOffset));
      if (driftGain) driftGain.gain.setTargetAtTime(0.18, audioCtx?.currentTime || 0, 0.05);
    } else {
      p.driftAngle = THREE.MathUtils.lerp(p.driftAngle, 0, dt * 8);
      if (driftGain) driftGain.gain.setTargetAtTime(0.0, audioCtx?.currentTime || 0, 0.05);
    }

    // Вращение кузова по курсу
    if (Math.abs(p.speed) > 2) {
      const dirSign = p.speed >= 0 ? 1 : -1;
      p.rot.y -= p.steering * steerAgility * dirSign * dt * 2.2;
    }
    p.quat.setFromEuler(new THREE.Euler(0, p.rot.y + p.driftAngle, 0, "YXZ"));

    // Расчет вектора движения
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(p.quat);
    p.vel.copy(forward).multiplyScalar((p.speed / 3.6) * dt);

    // Проверка коллизий с границами карты и зданиями
    const nextPos = p.pos.clone().add(p.vel);
    let collided = false;

    // Границы карты (+-380м)
    if (Math.abs(nextPos.x) > 380 || Math.abs(nextPos.z) > 380) {
      p.speed = -p.speed * 0.4;
      collided = true;
    }

    // Коллизии со зданиями
    for (let i = 0; i < cityColliders.length; i++) {
      const c = cityColliders[i];
      if (
        nextPos.x >= c.minX &&
        nextPos.x <= c.maxX &&
        nextPos.z >= c.minZ &&
        nextPos.z <= c.maxZ
      ) {
        // Удар о стену здания
        p.speed = -p.speed * 0.35;
        emitSparks(nextPos, 15);
        playCrashSound(0.8);
        screenShake.intensity = 0.4;
        screenShake.duration = 0.2;
        collided = true;
        break;
      }
    }

    if (!collided) {
      p.pos.copy(nextPos);
    }

    // Позиционирование 3D меша игрока
    if (playerCar) {
      playerCar.position.copy(p.pos);
      playerCar.quaternion.copy(p.quat);
      if (playerCar.userData.steeringWheel) {
        playerCar.userData.steeringWheel.rotation.z = -p.steering * 1.8;
      }
    }

    // Звук мотора
    if (engineOsc && engineGain && audioCtx) {
      const freq = 45 + (Math.abs(p.speed) / 280) * 220;
      engineOsc.frequency.setTargetAtTime(freq, audioCtx.currentTime, 0.05);
    }
  }

  // --- ИИ ТЕРРОРИСТА: CRAIG REYNOLDS STEERING BEHAVIORS ---
  function updateEnemyAI(dt) {
    const e = enemyState;
    const p = playerState;
    if (e.isDestroyed) return;

    // 1. Вектор убегания (Flee Vector от позиции игрока)
    const fleeDir = e.pos.clone().sub(p.pos).setY(0);
    const distToPlayer = fleeDir.length();
    fleeDir.normalize();

    // 2. Система 3-лучевого обхода препятствий (Raycast Obstacle Avoidance)
    const forward = new THREE.Vector3(0, 0, -1).applyEuler(e.rot);
    const leftRay = forward.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.55);
    const rightRay = forward.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -0.55);

    let avoidSteer = 0;
    const checkDist = e.avoidRange;

    // Проверяем коллизии лучей со зданиями
    function checkRay(rayDir, len) {
      const probe = e.pos.clone().addScaledVector(rayDir, len);
      for (let i = 0; i < cityColliders.length; i++) {
        const c = cityColliders[i];
        if (probe.x >= c.minX && probe.x <= c.maxX && probe.z >= c.minZ && probe.z <= c.maxZ) {
          return true;
        }
      }
      return Math.abs(probe.x) > 370 || Math.abs(probe.z) > 370;
    }

    const hitCenter = checkRay(forward, checkDist);
    const hitLeft = checkRay(leftRay, checkDist * 0.85);
    const hitRight = checkRay(rightRay, checkDist * 0.85);

    if (hitCenter) {
      avoidSteer = hitLeft ? -1.8 : 1.8;
    } else if (hitLeft) {
      avoidSteer = -1.4;
    } else if (hitRight) {
      avoidSteer = 1.4;
    }

    // 3. Комбинирование векторов убегания и уклонения
    const targetAngle = Math.atan2(-fleeDir.x, -fleeDir.z);
    let diffAngle = targetAngle - e.rot.y;
    while (diffAngle > Math.PI) diffAngle -= Math.PI * 2;
    while (diffAngle < -Math.PI) diffAngle += Math.PI * 2;

    const fleeSteer = THREE.MathUtils.clamp(diffAngle * 1.8, -1.0, 1.0);
    const combinedSteer = avoidSteer !== 0 ? avoidSteer : fleeSteer;

    e.steering = THREE.MathUtils.lerp(e.steering, combinedSteer, dt * e.agility);
    e.rot.y += e.steering * dt * 2.2;
    e.quat.setFromEuler(e.rot);

    // Разгон врага (быстрее убегает при приближении игрока)
    const urgency = Math.max(1.0, Math.min(1.6, 120 / Math.max(10, distToPlayer)));
    e.speed = Math.min(e.maxSpeed * urgency, e.speed + e.engineForce * dt);

    const moveVel = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(e.quat)
      .multiplyScalar((e.speed / 3.6) * dt);

    const nextEnemyPos = e.pos.clone().add(moveVel);

    // Проверка столкновения врага со зданиями
    let hitBuilding = false;
    for (let i = 0; i < cityColliders.length; i++) {
      const c = cityColliders[i];
      if (
        nextEnemyPos.x >= c.minX &&
        nextEnemyPos.x <= c.maxX &&
        nextEnemyPos.z >= c.minZ &&
        nextEnemyPos.z <= c.maxZ
      ) {
        e.speed *= 0.5;
        e.rot.y += (Math.random() < 0.5 ? 1 : -1) * 1.2;
        hitBuilding = true;
        break;
      }
    }

    if (!hitBuilding) {
      e.pos.copy(nextEnemyPos);
    }

    if (enemyCar) {
      enemyCar.position.copy(e.pos);
      enemyCar.quaternion.copy(e.quat);
      if (enemyCar.userData.marker) {
        enemyCar.userData.marker.rotation.y += dt * 3.5;
      }
    }
  }

  // --- ДЕТЕКЦИЯ ТАРАНА И СТОЛКНОВЕНИЙ (TAKEDOWN SYSTEM) ---
  function checkVehicleCollision() {
    const p = playerState;
    const e = enemyState;
    if (e.isDestroyed) return;

    const diff = p.pos.clone().sub(e.pos);
    const dist = diff.length();

    // Столкновение кузовов (дистанция < 3.2м)
    if (dist < 3.2) {
      const relSpeed = Math.abs(p.speed - e.speed) + Math.abs(p.speed) * 0.5;

      if (relSpeed > 25) {
        const damage = Math.round((relSpeed / 180) * 55 * (p.speed > e.speed ? 1.4 : 0.8));
        e.health = Math.max(0, e.health - damage);

        // Физический отскок
        const impactDir = diff.clone().normalize();
        e.pos.addScaledVector(impactDir, -1.8);
        p.pos.addScaledVector(impactDir, 1.2);
        p.speed *= 0.75;
        e.speed *= 0.6;

        // Эффекты
        const contact = p.pos.clone().add(e.pos).multiplyScalar(0.5);
        emitSparks(contact, 45);
        playCrashSound(1.5);
        screenShake.intensity = 0.8;
        screenShake.duration = 0.35;

        // Проверка уничтожения (Takedown)
        if (e.health <= 0 && !e.takedownTriggered) {
          triggerTakedown();
        }
      }
    }
  }

  function triggerTakedown() {
    const e = enemyState;
    e.takedownTriggered = true;
    e.isDestroyed = true;
    slowMoTimer = 1.6; // 1.6 секунды зрелищного замедления

    playCrashSound(2.5);
    emitSparks(e.pos, 80);

    // Награда
    const reward = 45000 + level * 15000;
    let wallet = Number(localStorage.getItem("notWeaponWallet") || 0);
    wallet += reward;
    localStorage.setItem("notWeaponWallet", String(wallet));

    // Добавляем трофейное оружие на склад
    const stock = JSON.parse(localStorage.getItem("notWeaponStock") || '{"weapon":0,"grenade":0,"ammo":0}');
    stock.weapon = (stock.weapon || 0) + 3 + level;
    stock.ammo = (stock.ammo || 0) + 5 + level * 2;
    stock.grenade = (stock.grenade || 0) + 2 + level;
    localStorage.setItem("notWeaponStock", JSON.stringify(stock));

    // Показываем окно победы
    setTimeout(() => {
      const overlay = document.getElementById("city3d-result");
      const title = document.getElementById("city3d-result-title");
      const sub = document.getElementById("city3d-result-sub");
      if (title) title.textContent = `🎯 ТАРАН УСПЕШЕН! УРОВЕНЬ ${level} ПРОЙДЕН`;
      if (sub) sub.textContent = `Награда: +$${reward.toLocaleString("en-US")} | Трофеи зачислены на склад`;
      if (overlay) overlay.classList.remove("hidden");
    }, 1200);
  }

  function nextLevel() {
    level++;
    const overlay = document.getElementById("city3d-result");
    if (overlay) overlay.classList.add("hidden");

    // Алгоритмическое масштабирование сложности
    enemyState.maxSpeed = 160 + level * 14;
    enemyState.engineForce = 38 + level * 8;
    enemyState.avoidRange = 26 + level * 4;
    enemyState.agility = 2.2 + level * 0.25;
    enemyState.mass = 1.0 + level * 0.15;
    enemyState.maxHealth = 100 + level * 30;
    enemyState.health = enemyState.maxHealth;
    enemyState.isDestroyed = false;
    enemyState.takedownTriggered = false;

    // Респавн врага в случайной части открытого города
    const angle = Math.random() * Math.PI * 2;
    const spawnDist = 90 + Math.random() * 60;
    enemyState.pos.set(
      playerState.pos.x + Math.sin(angle) * spawnDist,
      0.4,
      playerState.pos.z + Math.cos(angle) * spawnDist
    );
    enemyState.speed = 40;
  }

  // --- СИСТЕМА КАМЕР И РЕНДЕРА ---
  function updateCamera(dt) {
    if (!camera || !playerCar) return;

    // Screen Shake
    let shakeOffset = new THREE.Vector3();
    if (screenShake.duration > 0) {
      screenShake.duration -= dt;
      shakeOffset.set(
        (Math.random() - 0.5) * screenShake.intensity,
        (Math.random() - 0.5) * screenShake.intensity,
        (Math.random() - 0.5) * screenShake.intensity
      );
    }

    if (cameraMode === 1) {
      // 1-е лицо: КОКПИТ (вид из салона)
      const eyePos = playerState.pos.clone().add(
        new THREE.Vector3(0, 1.05, -0.15).applyQuaternion(playerState.quat)
      );
      camera.position.copy(eyePos).add(shakeOffset);

      const lookTarget = playerState.pos.clone().add(
        new THREE.Vector3(0, 0.95, -35).applyQuaternion(playerState.quat)
      );
      camera.lookAt(lookTarget);
      camera.fov = 76 + (playerState.speed / 280) * 14;
    } else {
      // 3-е лицо: ДИНАМИЧЕСКАЯ ПОГОНЯ СЗАДИ
      const camDist = 9.5 + (playerState.speed / 250) * 3.5;
      const camHeight = 3.4 + (playerState.speed / 250) * 0.8;

      const desiredPos = playerState.pos.clone().add(
        new THREE.Vector3(0, camHeight, camDist).applyQuaternion(playerState.quat)
      );
      camera.position.lerp(desiredPos, 0.16).add(shakeOffset);

      const lookTarget = playerState.pos.clone().add(
        new THREE.Vector3(0, 1.2, -18).applyQuaternion(playerState.quat)
      );
      camera.lookAt(lookTarget);
      camera.fov = 64 + (playerState.speed / 280) * 16;
    }
    camera.updateProjectionMatrix();
  }

  function updateHUD() {
    const spdEl = document.getElementById("city3d-speed-value");
    if (spdEl) spdEl.textContent = String(Math.round(Math.abs(playerState.speed)));

    const nitroEl = document.getElementById("city3d-nitro-fill");
    if (nitroEl) nitroEl.style.width = `${Math.round(playerState.nitro * 100)}%`;

    const enemyHpEl = document.getElementById("city3d-enemy-hp-fill");
    if (enemyHpEl) {
      const hpPct = Math.max(0, Math.min(100, Math.round((enemyState.health / enemyState.maxHealth) * 100)));
      enemyHpEl.style.width = `${hpPct}%`;
    }

    const distEl = document.getElementById("city3d-enemy-dist");
    if (distEl) {
      const dist = Math.round(playerState.pos.distanceTo(enemyState.pos));
      distEl.textContent = `🎯 ЦЕЛЬ: ${dist}м`;
    }

    const lvlEl = document.getElementById("city3d-level-badge");
    if (lvlEl) lvlEl.textContent = `УРОВЕНЬ ${level}`;

    const driftEl = document.getElementById("city3d-drift-score");
    if (driftEl) {
      if (playerState.isDrifting) {
        driftEl.classList.remove("hidden");
        driftEl.textContent = `🔥 DRIFT +${currentDriftScore}`;
      } else {
        driftEl.classList.add("hidden");
      }
    }
  }

  // --- ИГРОВОЙ ЦИКЛ (MAIN ANIMATION LOOP) ---
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
      updatePlayerPhysics(dt);
      updateEnemyAI(dt);
      checkVehicleCollision();
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
    renderer.toneMappingExposure = 1.05;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1622);
    scene.fog = new THREE.FogExp2(0x18141e, 0.0032);

    camera = new THREE.PerspectiveCamera(64, 1100 / 700, 0.2, 800);

    // Освещение (Постапокалиптический закат)
    const hemiLight = new THREE.HemisphereLight(0xffb87a, 0x1e1428, 1.2);
    scene.add(hemiLight);

    const sun = new THREE.DirectionalLight(0xff7a38, 2.2);
    sun.position.set(-80, 120, -50);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 350;
    const d = 140;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    scene.add(sun);
  }

  // --- СЛУШАТЕЛИ КЛАВИАТУРЫ ---
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

  // --- ПУБЛИЧНЫЙ API ДВИЖКА (window.City3D) ---
  window.City3D = {
    start() {
      this.stop();
      initAudio();
      resetCanvas();

      level = 1;
      currentDriftScore = 0;
      slowMoTimer = 0;
      cameraMode = 0;

      // Сброс состояний
      playerState.pos.set(0, 0.4, 0);
      playerState.rot.set(0, 0, 0);
      playerState.speed = 0;
      playerState.steering = 0;
      playerState.nitro = 1.0;

      enemyState.pos.set(0, 0.4, -75);
      enemyState.rot.set(0, 0, 0);
      enemyState.speed = 35;
      enemyState.health = 100;
      enemyState.maxHealth = 100;
      enemyState.isDestroyed = false;
      enemyState.takedownTriggered = false;
      enemyState.maxSpeed = 160;
      enemyState.engineForce = 38;
      enemyState.avoidRange = 26;
      enemyState.agility = 2.2;

      buildDestroyedCity();
      initParticleSystems();

      playerCar = createPlayerCarMesh();
      scene.add(playerCar);

      enemyCar = createEnemyCarMesh();
      scene.add(enemyCar);

      running = true;
      isPaused = false;
      lastTime = performance.now();
      frame = requestAnimationFrame(animate);
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

    nextLevel() {
      nextLevel();
    },

    isRunning() {
      return running;
    }
  };
})();
