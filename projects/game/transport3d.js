// projects/game/transport3d.js — 3D Перевозка оружия по трассе с видом от 1-го лица из кабины.
(() => {
const THREE = window.THREE;
if (!THREE) return;

let renderer, scene, camera, truck, enemy, frame;
let running = false, speed = 15, playerX = 0, lives = 3, shotClock = 0, bonusClock = 0, damageCooldown = 0, speedBoostCount = 0, speedBoostUntil = 0, fuel = 1, activeRoute = "russia", crateCounts = {ammo:0,weapon:0,grenade:0};
let cameraMode = 0; // 0 = 3-е лицо (сзади), 1 = 1-е лицо (кокпит из кабины)
let steeringWheel = null, speedoNeedle = null, truckRoof = null, truckCanvasBody = null;
const keys = Object.create(null), roadParts = [], trees = [], bullets = [], bonuses = [];

const mat = (color, roughness = .7, metalness = .05) => new THREE.MeshStandardMaterial({ color, roughness, metalness });

function forestGroundMaterial() {
  const texture = new THREE.TextureLoader().load("forest-floor.jpg");
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(24, 72);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: texture, color: 0x59664d, roughness: 1, metalness: 0 });
}

function asphaltMaterial(color = 0x777b7d) {
  const texture = new THREE.TextureLoader().load("road-asphalt.jpg");
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 92);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: texture, color, roughness: .96, metalness: .01 });
}

function desertGroundMaterial(repeatX = 16, repeatY = 45) {
  const texture = new THREE.TextureLoader().load("afghan-desert-ground.png");
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: texture, color: 0x8f6846, roughness: 1, metalness: 0 });
}

function box(w, h, d, color, roughness = .7, metalness = .05) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, roughness, metalness));
}

function wheel() {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(.46, .46, .32, 18), mat(0x111318, .9));
  m.rotation.z = Math.PI / 2;
  return m;
}

function chromaTexture(file) {
  const texture = new THREE.TextureLoader().load(file);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: texture } },
    transparent: true,
    side: THREE.DoubleSide,
    vertexShader: "varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
    fragmentShader: "uniform sampler2D map; varying vec2 vUv; void main(){vec4 c=texture2D(map,vUv);float green=c.g-max(c.r,c.b);if(green>.12&&c.g>.35)discard;gl_FragColor=c;}"
  });
}

function canvasMaterial() {
  const texture = new THREE.TextureLoader().load("truck-textures/khaki-canvas.png");
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return new THREE.MeshStandardMaterial({ map: texture, color: 0x4b4938, roughness: 1, metalness: 0 });
}

let sharedTreeTexture = null;
function realisticTree(type = 0) {
  if (!sharedTreeTexture) {
    sharedTreeTexture = new THREE.TextureLoader().load("realistic-conifers-sheet.png");
    sharedTreeTexture.colorSpace = THREE.SRGBColorSpace;
  }
  const crops = [[0, .33], [.33, .66], [.66, 1]];
  const crop = crops[type % 3];
  const treeMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: sharedTreeTexture }, crop: { value: new THREE.Vector2(crop[0], crop[1]) } },
    transparent: true,
    side: THREE.DoubleSide,
    vertexShader: "varying vec2 vUv;uniform vec2 crop;void main(){vUv=vec2(mix(crop.x,crop.y,uv.x),uv.y);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
    fragmentShader: "uniform sampler2D map;varying vec2 vUv;void main(){vec4 c=texture2D(map,vUv);float key=max(0.0,min(c.r,c.b)-c.g);float mask=smoothstep(.035,.16,key)*smoothstep(.24,.58,min(c.r,c.b));c.a*=1.0-mask;c.r=mix(c.r,c.g*.78,mask);c.b=mix(c.b,c.g*.72,mask);if(c.a<.1)discard;gl_FragColor=c;}"
  });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 12), treeMat);
  plane.position.y = 6;
  return plane;
}

function vehicleCard(file, width, height) {
  const card = new THREE.Mesh(new THREE.PlaneGeometry(width, height), chromaTexture(file));
  card.position.y = height * .47;
  card.rotation.y = Math.PI;
  return card;
}

function makeCanvasTruck() {
  const g = new THREE.Group(), olive = 0x27321f, dark = 0x171b1d;
  
  // Шасси и кузов
  const chassis = box(2.25, .28, 7.55, dark, .82, .25); chassis.position.set(0, .72, -.25); g.add(chassis);
  const bed = box(2.45, .72, 4.65, olive, .82); bed.position.set(0, 1.2, 1.15); g.add(bed);
  
  truckCanvasBody = new THREE.Mesh(new THREE.BoxGeometry(2.38, 1.55, 4.5), canvasMaterial());
  truckCanvasBody.position.set(0, 2.3, 1.12);
  g.add(truckCanvasBody);

  const cab = box(2.22, 1.8, 1.92, olive, .72); cab.position.set(0, 1.65, -2.35); g.add(cab);
  const hood = box(2.05, .72, 1.55, olive, .72); hood.position.set(0, 1.3, -4.02); g.add(hood);
  
  truckRoof = box(2.3, .18, 2.05, 0x303b24, .9); truckRoof.position.set(0, 2.62, -2.34); g.add(truckRoof);
  
  const windshield = box(1.82, .68, .06, 0x7fa5ad, .3, .05); windshield.position.set(0, 2.06, -3.33); g.add(windshield);
  const grille = box(1.48, .62, .08, 0x242a24, .55, .5); grille.position.set(0, 1.35, -4.82); g.add(grille);
  const bumper = box(2.42, .22, .22, 0x202326, .48, .65); bumper.position.set(0, .86, -4.92); g.add(bumper);
  
  const rearGate = box(2.38, .72, .12, olive, .82); rearGate.position.set(0, 1.2, 3.5); g.add(rearGate);

  // Колёса
  [-1.03, 1.03].forEach(x => [-2.65, .7, 2.35].forEach(z => {
    const wh = wheel(); wh.scale.set(1.2, 1.2, 1.2); wh.position.set(x, .58, z); g.add(wh);
  }));

  // Задние фонари
  const tailMat = new THREE.MeshStandardMaterial({ color: 0xff391f, emissive: 0xff2415, emissiveIntensity: 1.5 });
  [-.72, .72].forEach(x => {
    const light = new THREE.Mesh(new THREE.BoxGeometry(.34, .2, .08), tailMat);
    light.position.set(x, 1.02, 3.58);
    g.add(light);
  });

  // --- ИНТЕРЬЕР КАБИНЫ (для вида от 1-го лица) ---
  const cockpit = new THREE.Group();
  
  // Торпеда / Приборная панель
  const dash = box(1.86, .46, .68, 0x181a1d, .85, .15);
  dash.position.set(0, 1.62, -2.95);
  dash.rotation.x = -0.22;
  cockpit.add(dash);

  // Спидометр и тахометр на панели
  const speedoDial = new THREE.Mesh(new THREE.CircleGeometry(.11, 16), new THREE.MeshBasicMaterial({ color: 0x00f0ff }));
  speedoDial.position.set(-.46, 1.76, -2.76);
  speedoDial.rotation.x = -0.22;
  cockpit.add(speedoDial);

  speedoNeedle = box(.015, .08, .01, 0xff3300);
  speedoNeedle.position.set(-.46, 1.76, -2.75);
  cockpit.add(speedoNeedle);

  const tachoDial = new THREE.Mesh(new THREE.CircleGeometry(.09, 14), new THREE.MeshBasicMaterial({ color: 0xffaa00 }));
  tachoDial.position.set(-.22, 1.76, -2.76);
  tachoDial.rotation.x = -0.22;
  cockpit.add(tachoDial);

  // Руль грузовика
  steeringWheel = new THREE.Group();
  const wheelRing = new THREE.Mesh(new THREE.TorusGeometry(.23, .032, 12, 28), mat(0x111315, .9, .1));
  steeringWheel.add(wheelRing);
  const hub = box(.09, .09, .06, 0x222629);
  steeringWheel.add(hub);
  const spokeA = box(.03, .22, .02, 0x111315); spokeA.position.y = .1; steeringWheel.add(spokeA);
  const spokeB = box(.22, .03, .02, 0x111315); steeringWheel.add(spokeB);

  steeringWheel.position.set(-.46, 1.82, -2.62);
  steeringWheel.rotation.x = -0.55;
  cockpit.add(steeringWheel);

  // Зеркало заднего вида
  const mirror = box(.36, .14, .04, 0x99ccdd, .1, .9);
  mirror.position.set(0, 2.38, -3.12);
  cockpit.add(mirror);

  g.add(cockpit);
  return g;
}

function makeTruck(color = 0x1268a8, enemyMode = false) {
  const g = new THREE.Group();
  const trailer = box(enemyMode ? 2.8 : 2.52, enemyMode ? 1.7 : 2.5, enemyMode ? 4.7 : 6.35, enemyMode ? 0x20252b : 0x34383e);
  trailer.position.set(0, enemyMode ? 1.25 : 1.65, enemyMode ? 0 : .5); g.add(trailer);
  const cab = box(enemyMode ? 2.6 : 2.36, enemyMode ? 1.6 : 2.3, enemyMode ? 2.2 : 2.4, color);
  cab.position.set(0, enemyMode ? 1.15 : 1.55, enemyMode ? -2.3 : -4); g.add(cab);
  const glass = box(enemyMode ? 2.25 : 2.3, .72, .08, 0x8fd5ed); glass.position.set(0, enemyMode ? 1.55 : 2.08, enemyMode ? -3.42 : -5.23); g.add(glass);
  [-1.25, 1.25].forEach(x => [-2.8, 2.2].forEach(z => { const wh = wheel(); wh.position.set(x, .48, z); g.add(wh); }));
  const tailMat = new THREE.MeshStandardMaterial({ color: 0xff2318, emissive: 0xff1308, emissiveIntensity: 2 });
  [-.75, .75].forEach(x => { const light = new THREE.Mesh(new THREE.BoxGeometry(.38,.22,.08), tailMat); light.position.set(x,1.1,enemyMode ? 2.38 : 3.83); g.add(light); });
  if (enemyMode) {
    const gunner = new THREE.Mesh(new THREE.CapsuleGeometry(.38,.7,5,12), mat(0x423e33)); gunner.position.set(0,2.6,-.2); g.add(gunner);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(.07,.1,2.3,10), mat(0x151719,.4,.8)); barrel.rotation.x = Math.PI/2; barrel.position.set(0,2.65,1.25); barrel.name = "muzzle"; g.add(barrel);
  }
  return g;
}

function resetCanvas() {
  const old = document.getElementById("transport-canvas");
  const canvas = old.cloneNode(false); old.replaceWith(canvas);
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(1100, 700, false);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .96;
}

function buildWorld(route) {
  renderer.toneMappingExposure = route === "russia" ? .94 : .72;
  scene = new THREE.Scene();
  scene.background = new THREE.Color(route === "russia" ? 0x7898a2 : 0xdba96a);
  scene.fog = new THREE.Fog(route === "russia" ? 0x718b88 : 0xc5a276, 38, route === "russia" ? 175 : 190);

  if (route === "afghanistan") {
    new THREE.TextureLoader().load("air-battlefield-bg.png", texture => {
      texture.colorSpace = THREE.SRGBColorSpace;
      scene.background = texture;
    });
  }

  camera = new THREE.PerspectiveCamera(63, 1100 / 700, .1, 500);
  camera.position.set(0, 6.2, 12);
  camera.lookAt(0, 1, -25);

  scene.add(new THREE.HemisphereLight(route === "russia" ? 0xbad4d0 : 0xd59a62, route === "russia" ? 0x202c1d : 0x261b18, route === "russia" ? 1.25 : .62));
  const sun = new THREE.DirectionalLight(route === "russia" ? 0xffe1a6 : 0xe59b58, route === "russia" ? 1.75 : .88);
  sun.position.set(-20, 35, 15);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  scene.add(sun);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(240, 700), route === "russia" ? forestGroundMaterial() : desertGroundMaterial());
  ground.rotation.x = -Math.PI / 2; ground.position.z = -250; ground.receiveShadow = true; scene.add(ground);

  const road = new THREE.Mesh(new THREE.PlaneGeometry(24, 700), asphaltMaterial(route === "russia" ? 0x777b7d : 0x766758));
  road.rotation.x = -Math.PI / 2; road.position.set(0, .025, -250); road.receiveShadow = true; scene.add(road);

  const edgeMat = mat(0xf4f4ee, .8);
  [-11.65, 11.65].forEach(x => {
    const e = new THREE.Mesh(new THREE.BoxGeometry(.28, .08, 700), edgeMat);
    e.position.set(x, .09, -250);
    scene.add(e);
  });

  roadParts.length = 0;
  for (let z = -340; z < 20; z += 12) {
    for (const x of [-6, 0, 6]) {
      const dash = new THREE.Mesh(new THREE.BoxGeometry(.22, .06, 5.4), edgeMat);
      dash.position.set(x, .1, z);
      scene.add(dash);
      roadParts.push(dash);
    }
  }

  trees.length = 0;
  if (route === "russia") {
    for (let z = -310; z < 26; z += 9) {
      for (const side of [-1, 1]) {
        const t = new THREE.Group();
        const type = Math.floor(Math.random() * 3);
        const front = realisticTree(type), cross = realisticTree(type);
        cross.rotation.y = Math.PI / 2;
        t.add(front, cross);
        t.position.set(side * (16 + Math.random() * 18), 0, z + Math.random() * 4);
        scene.add(t);
        trees.push(t);
      }
    }
  } else {
    for (let z = -300; z < 16; z += 26) {
      for (const side of [-1, 1]) {
        const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x805839, 1));
        hill.scale.set(16 + Math.random() * 12, 5 + Math.random() * 6, 12 + Math.random() * 14);
        hill.position.set(side * (36 + Math.random() * 16), -.3, z + Math.random() * 9);
        scene.add(hill);
        trees.push(hill);
      }
    }
  }

  truck = makeCanvasTruck();
  truck.position.set(0, 0, 0);
  scene.add(truck);

  enemy = new THREE.Group();
  const enemyBase = makeTruck(0x25282d, true);
  enemyBase.visible = false;
  enemy.add(enemyBase);
  enemy.add(vehicleCard("enemy-vehicle-cartoon.png", 4.9, 4.9));
  enemy.position.set(0, 0, -42);
  scene.add(enemy);
}

function spawnBonus(forcedType = "") {
  const roll = Math.random(), type = forcedType || (roll < .22 ? "life" : roll < .44 ? "speed" : roll < .64 ? "fuel" : roll < .76 ? "ammo" : roll < .88 ? "weapon" : "grenade");
  const g = new THREE.Group();
  
  if (["ammo", "weapon", "grenade"].includes(type)) {
    const files = { ammo: "ammo-crate.png", weapon: "weapon-crate.png", grenade: "grenade-crate.png" };
    const texture = new THREE.TextureLoader().load(files[type]); texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: .08, side: THREE.DoubleSide });
    const card = new THREE.Mesh(new THREE.PlaneGeometry(2.45, 2.45), material); card.position.y = .2; g.add(card);
    g.userData.kind = type; g.userData.baseY = 1.25; g.userData.phase = Math.random() * Math.PI * 2;
    g.position.set([-8, -3, 3, 8][Math.floor(Math.random() * 4)], 1.25, -72);
    scene.add(g); bonuses.push(g); return;
  }

  const item = box(1.1, 1.1, .4, type === "life" ? 0x48ff72 : type === "speed" ? 0x38dcff : 0xff5948);
  g.add(item);
  g.userData.kind = type; g.userData.baseY = 1.35; g.userData.phase = Math.random() * Math.PI * 2;
  g.position.set([-8, -3, 3, 8][Math.floor(Math.random() * 4)], 1.35, -72);
  scene.add(g); bonuses.push(g);
}

function shoot() {
  const origin = new THREE.Vector3(enemy.position.x, 2.7, enemy.position.z + 1.4);
  const target = new THREE.Vector3(playerX, 1.25, 1);
  const direction = target.clone().sub(origin).normalize();
  const tracer = new THREE.Mesh(new THREE.CylinderGeometry(.07, .07, 1.9, 8), new THREE.MeshStandardMaterial({ color: 0xffd35b, emissive: 0xff5a00, emissiveIntensity: 4 }));
  tracer.position.copy(origin);
  tracer.userData.velocity = direction.clone().multiplyScalar(36);
  tracer.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  scene.add(tracer);
  bullets.push(tracer);
}

function animate(now = 0) {
  if (!running) return;
  const dt = Math.min(.035, (now - (animate.last || now)) / 1000);
  animate.last = now;

  const gas = keys.KeyW || keys.ArrowUp, brake = keys.KeyS || keys.ArrowDown;
  const steer = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);

  if (speedBoostUntil && now >= speedBoostUntil) { speedBoostCount = 0; speedBoostUntil = 0; speed = Math.min(speed, 42); }
  fuel = Math.max(0, fuel - dt / 35);
  const baseSpeedLimit = activeRoute === "afghanistan" ? 50 : 42;
  const speedLimit = fuel <= 0 ? 8 : baseSpeedLimit + speedBoostCount * 2;
  speed = Math.max(5, Math.min(speedLimit, speed + (gas ? 18 : brake ? -30 : -4) * dt));
  playerX = THREE.MathUtils.clamp(playerX + steer * (4 + speed * .08) * dt, -9.4, 9.4);
  const visualSpeed = speed * (1 + speedBoostCount * .12);

  truck.position.x = THREE.MathUtils.lerp(truck.position.x, playerX, .18);
  truck.rotation.z = THREE.MathUtils.lerp(truck.rotation.z, -steer * .08, .14);

  // Вращение руля в кабине
  if (steeringWheel) {
    steeringWheel.rotation.z = THREE.MathUtils.lerp(steeringWheel.rotation.z, -steer * 1.5, .25);
  }
  if (speedoNeedle) {
    speedoNeedle.rotation.z = -(speed / 50) * Math.PI * 1.2;
  }

  // Обновление камеры (3-е лицо сзади / 1-е лицо Кокпит)
  if (cameraMode === 1) {
    // 1-е ЛИЦО: ИЗ КАБИНЫ С РУЛЁМ И СПИДОМЕТРОМ
    if (truckRoof) truckRoof.visible = false;
    if (truckCanvasBody) truckCanvasBody.visible = false;

    const camX = truck.position.x - 0.46;
    camera.position.set(camX, 2.18, -2.25);
    camera.lookAt(camX + steer * 0.45, 1.65, -30);
    camera.fov = 72;
  } else {
    // 3-е ЛИЦО: СЗАДИ ГРУЗОВИКА
    if (truckRoof) truckRoof.visible = true;
    if (truckCanvasBody) truckCanvasBody.visible = true;

    camera.position.x = THREE.MathUtils.lerp(camera.position.x, playerX * .48, .06);
    camera.position.y = 6.2;
    camera.position.z = 12;
    camera.lookAt(playerX * .35, 1, -26);
    camera.fov = 63;
  }
  camera.updateProjectionMatrix();

  enemy.position.x = Math.sin(now * .00045) * 5.2;

  roadParts.forEach(o => { o.position.z += visualSpeed * dt; if (o.position.z > 18) o.position.z -= 360; });
  trees.forEach(o => { o.position.z += visualSpeed * dt; if (o.position.z > 22) o.position.z -= 320; });

  damageCooldown = Math.max(0, damageCooldown - dt);
  shotClock += dt;
  bonusClock += dt;
  if (shotClock > 1.65) { shoot(); shotClock = 0; }
  if (bonusClock > 2.8) { spawnBonus(); bonusClock = 0; }

  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.position.addScaledVector(b.userData.velocity, dt);
    if (b.position.z > 3) {
      if (Math.abs(b.position.x - truck.position.x) < 1.7 && damageCooldown === 0) {
        lives = Math.max(0, lives - 1);
        damageCooldown = .7;
        updateLives();
      }
      scene.remove(b);
      bullets.splice(i, 1);
    }
  }

  for (let i = bonuses.length - 1; i >= 0; i--) {
    const b = bonuses[i];
    b.position.z += visualSpeed * dt;
    b.rotation.y += dt * 1.35;
    b.position.y = b.userData.baseY + Math.sin(now * .003 + b.userData.phase) * .16;
    if (b.position.z > 1) {
      if (Math.abs(b.position.x - truck.position.x) < 2) {
        if (b.userData.kind === "life") lives = Math.min(3, lives + 1);
        if (b.userData.kind === "speed") { speedBoostCount += 1; speedBoostUntil = now + 5000; speed = Math.min(42 + speedBoostCount * 2, speed + 2); }
        if (b.userData.kind === "fuel") fuel = Math.min(1, fuel + 1 / 3);
        if (crateCounts[b.userData.kind] !== undefined) {
          crateCounts[b.userData.kind]++;
          const counter = document.querySelector(`[data-crate-count="${b.userData.kind}"]`);
          if (counter) counter.textContent = String(crateCounts[b.userData.kind]);
          const stock = JSON.parse(localStorage.getItem("notWeaponStock") || '{"weapon":0,"grenade":0,"ammo":0}');
          stock[b.userData.kind] = (stock[b.userData.kind] || 0) + 1;
          localStorage.setItem("notWeaponStock", JSON.stringify(stock));
        }
        updateLives();
      }
      scene.remove(b);
      bonuses.splice(i, 1);
    }
  }

  const kmh = Math.round(speed * 5);
  const speedDial = Math.max(0, Math.min(1, (kmh - 100) / 150));
  const speedVal = document.getElementById("speed-value");
  if (speedVal && speedVal.firstChild) speedVal.firstChild.nodeValue = String(kmh);
  const spNeedle = document.getElementById("speed-needle");
  if (spNeedle) spNeedle.style.transform = `rotate(${speedDial * 180}deg)`;
  const fNeedle = document.getElementById("fuel-needle");
  if (fNeedle) fNeedle.style.transform = `rotate(${-180 + fuel * 180}deg)`;
  const fArc = document.getElementById("fuel-arc");
  if (fArc) fArc.style.setProperty("--fuel-angle", `${fuel * 180}deg`);

  window.GameAudio?.setTruckSpeed(speed / 42);
  renderer.render(scene, camera);
  frame = requestAnimationFrame(animate);
}

function updateLives() {
  const el = document.getElementById("transport-lives");
  if (el) el.textContent = "❤️".repeat(Math.max(0, lives)) + "🖤".repeat(Math.max(0, 3 - lives));
  if (lives <= 0 && running) {
    running = false;
    window.GameAudio?.stop();
    if (frame) cancelAnimationFrame(frame);
    const resTitle = document.getElementById("transport-result-title");
    if (resTitle) resTitle.textContent = "Груз потерян";
    const res = document.getElementById("transport-result");
    if (res) res.classList.remove("hidden");
  }
}

window.addEventListener("keydown", e => {
  keys[e.code] = true;
  if (running && e.code.startsWith("Arrow")) e.preventDefault();
  if (running && e.code === "KeyV") {
    cameraMode = cameraMode === 0 ? 1 : 0;
    const camLabel = document.getElementById("transport-camera");
    if (camLabel) camLabel.textContent = cameraMode === 0 ? "Камера [V]: 3-е лицо (Сзади)" : "Камера [V]: 1-е лицо (Кабина)";
    const camBtn = document.getElementById("transport-cam-mode");
    if (camBtn) camBtn.textContent = cameraMode === 0 ? "Камера [V]: 3-е лицо" : "Камера [V]: Кокпит";
  }
});

window.addEventListener("keyup", e => keys[e.code] = false);

window.Transport3D = {
  start(route) {
    this.stop();
    bullets.length = 0;
    bonuses.length = 0;
    activeRoute = route;
    cameraMode = 0;
    resetCanvas();
    buildWorld(route);
    running = true;
    speed = 15;
    playerX = 0;
    lives = 3;
    shotClock = 0;
    bonusClock = 0;
    damageCooldown = 0;
    speedBoostCount = 0;
    speedBoostUntil = 0;
    fuel = 1;
    crateCounts = { ammo: 0, weapon: 0, grenade: 0 };
    document.querySelectorAll("[data-crate-count]").forEach(el => el.textContent = "0");
    spawnBonus("fuel");
    bonuses[0].position.z = -42;
    updateLives();
    window.GameAudio?.playMode("transport");
    animate.last = performance.now();
    frame = requestAnimationFrame(animate);
  },
  stop() {
    running = false;
    window.GameAudio?.stop();
    if (frame) cancelAnimationFrame(frame);
    if (renderer) renderer.dispose();
  },
  toggleCamera() {
    cameraMode = cameraMode === 0 ? 1 : 0;
    const camLabel = document.getElementById("transport-camera");
    if (camLabel) camLabel.textContent = cameraMode === 0 ? "Камера [V]: 3-е лицо (Сзади)" : "Камера [V]: 1-е лицо (Кабина)";
    const camBtn = document.getElementById("transport-cam-mode");
    if (camBtn) camBtn.textContent = cameraMode === 0 ? "Камера [V]: 3-е лицо" : "Камера [V]: Кокпит";
  },
  isRunning() { return running; }
};
})();
