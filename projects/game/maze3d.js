(() => {
  const THREE = window.THREE;
  const SIZE = 27;
  const CELL = 9;
  const WALL_HEIGHT = 15;
  const WALL_THICKNESS = 0.72;
  const EYE_HEIGHT = 1.78;
  const MAX_HEALTH = 5;
  const ENEMY_COUNT = 25;
  const START = { x: 1, y: 1 };
  const EXIT = { x: SIZE - 2, y: SIZE - 2 };

  let renderer;
  let scene;
  let camera;
  let animationFrame;
  let running = false;
  let grid = [];
  let yaw = Math.PI;
  let pitch = 0;
  let lastTime = 0;
  let simulationTime = 0;
  let walkTime = 0;
  let exitBeacon;
  let currentSector = "";
  let health = MAX_HEALTH;
  let damageCooldown = 0;
  let damageFlashUntil = 0;
  let dustCloud;
  let audioContext;
  let pointerLockEverActive = false;

  const keys = Object.create(null);
  const collected = { weapon: 0, grenade: 0, ammo: 0 };
  const pickups = [];
  const enemies = [];
  const enemyBullets = [];
  const horrorLights = [];
  const wallOccluders = [];
  const reservedCells = new Set();
  const losRaycaster = new THREE.Raycaster();
  const canvas = document.getElementById("supply-maze-canvas");
  const overlay = document.getElementById("maze-overlay");
  const help = document.querySelector(".maze-help");
  const title = document.querySelector(".maze-title");
  const distanceLabel = document.getElementById("maze-exit-distance");
  const healthHud = document.getElementById("maze-health");
  const threatLabel = document.getElementById("maze-threat");
  const damageFlash = document.getElementById("maze-damage-flash");
  const box = (w, h, d, material) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  const upVector = new THREE.Vector3(0, 1, 0);

  function useSrgb(texture) {
    if (!texture) return texture;
    if ("colorSpace" in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    if ("encoding" in texture && THREE.sRGBEncoding) texture.encoding = THREE.sRGBEncoding;
    return texture;
  }

  function carveMaze() {
    grid = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => ({
      n: true, e: true, s: true, w: true, seen: false
    })));

    const stack = [[START.x, START.y]];
    grid[START.y][START.x].seen = true;
    while (stack.length) {
      const [x, y] = stack[stack.length - 1];
      const choices = [];
      if (y > 0 && !grid[y - 1][x].seen) choices.push([x, y - 1, "n", "s"]);
      if (x < SIZE - 1 && !grid[y][x + 1].seen) choices.push([x + 1, y, "e", "w"]);
      if (y < SIZE - 1 && !grid[y + 1][x].seen) choices.push([x, y + 1, "s", "n"]);
      if (x > 0 && !grid[y][x - 1].seen) choices.push([x - 1, y, "w", "e"]);
      if (!choices.length) {
        stack.pop();
        continue;
      }
      const next = choices[Math.floor(Math.random() * choices.length)];
      grid[y][x][next[2]] = false;
      grid[next[1]][next[0]][next[3]] = false;
      grid[next[1]][next[0]].seen = true;
      stack.push([next[0], next[1]]);
    }

    // Create wider routes and a small starting glade without breaking the maze.
    for (let i = 0; i < Math.floor(SIZE * SIZE * 0.12); i++) {
      const x = 1 + Math.floor(Math.random() * (SIZE - 2));
      const y = 1 + Math.floor(Math.random() * (SIZE - 2));
      if (Math.random() < 0.5) {
        grid[y][x].e = false;
        grid[y][x + 1].w = false;
      } else {
        grid[y][x].s = false;
        grid[y + 1][x].n = false;
      }
    }
    for (let y = 0; y <= 2; y++) {
      for (let x = 0; x <= 2; x++) {
        if (x < 2) {
          grid[y][x].e = false;
          grid[y][x + 1].w = false;
        }
        if (y < 2) {
          grid[y][x].s = false;
          grid[y + 1][x].n = false;
        }
      }
    }
    grid[EXIT.y][EXIT.x].e = false;
  }

  function cellPosition(x, y) {
    return new THREE.Vector3((x - (SIZE - 1) / 2) * CELL, 0, (y - (SIZE - 1) / 2) * CELL);
  }

  function randomCell({ minStart = 4, minExit = 3, used } = {}) {
    for (let attempt = 0; attempt < 300; attempt++) {
      const x = 1 + Math.floor(Math.random() * (SIZE - 2));
      const y = 1 + Math.floor(Math.random() * (SIZE - 2));
      const key = `${x}:${y}`;
      if (used?.has(key)) continue;
      if (Math.hypot(x - START.x, y - START.y) < minStart) continue;
      if (Math.hypot(x - EXIT.x, y - EXIT.y) < minExit) continue;
      used?.add(key);
      return { x, y };
    }
    return { x: Math.floor(SIZE / 2), y: Math.floor(SIZE / 2) };
  }

  function addSegment(parent, start, end, radius, material, radialSegments = 8) {
    const direction = end.clone().sub(start);
    const segment = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius * 0.92, direction.length(), radialSegments),
      material
    );
    segment.position.copy(start).add(end).multiplyScalar(0.5);
    segment.quaternion.setFromUnitVectors(upVector, direction.normalize());
    parent.add(segment);
    return segment;
  }

  function mergeGeometryParts(parts) {
    const geometries = parts.map(({ geometry, matrix }) => {
      let copy = geometry.clone();
      copy.applyMatrix4(matrix);
      if (copy.index) {
        const flat = copy.toNonIndexed();
        copy.dispose();
        copy = flat;
      }
      return copy;
    });
    const attributeNames = Object.keys(geometries[0].attributes).filter(name => {
      const first = geometries[0].getAttribute(name);
      return geometries.every(geometry => {
        const attribute = geometry.getAttribute(name);
        return attribute && attribute.itemSize === first.itemSize && attribute.normalized === first.normalized
          && attribute.array.constructor === first.array.constructor;
      });
    });
    const merged = new THREE.BufferGeometry();
    attributeNames.forEach(name => {
      const first = geometries[0].getAttribute(name);
      const total = geometries.reduce((sum, geometry) => sum + geometry.getAttribute(name).array.length, 0);
      const values = new first.array.constructor(total);
      let offset = 0;
      geometries.forEach(geometry => {
        const source = geometry.getAttribute(name).array;
        values.set(source, offset);
        offset += source.length;
      });
      merged.setAttribute(name, new THREE.BufferAttribute(values, first.itemSize, first.normalized));
    });
    if (!merged.getAttribute("normal")) merged.computeVertexNormals();
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    geometries.forEach(geometry => geometry.dispose());
    return merged;
  }

  function collapseStaticModel(group, preserve = []) {
    const preserved = new Set(preserve);
    const batches = new Map();
    const sourceGeometries = new Set();
    group.updateMatrixWorld(true);
    const inverse = group.matrixWorld.clone().invert();
    group.traverse(object => {
      if (!object.isMesh || preserved.has(object) || Array.isArray(object.material)) return;
      if (!batches.has(object.material)) batches.set(object.material, []);
      batches.get(object.material).push({
        geometry: object.geometry,
        matrix: new THREE.Matrix4().multiplyMatrices(inverse, object.matrixWorld)
      });
      sourceGeometries.add(object.geometry);
    });
    const mergedMeshes = [];
    batches.forEach((parts, material) => mergedMeshes.push(new THREE.Mesh(mergeGeometryParts(parts), material)));
    while (group.children.length) group.remove(group.children[group.children.length - 1]);
    group.add(...mergedMeshes, ...preserve);
    sourceGeometries.forEach(geometry => geometry.dispose());
    return mergedMeshes;
  }

  function updateHealthHud() {
    healthHud.innerHTML = "";
    for (let i = 0; i < MAX_HEALTH; i++) {
      const heart = document.createElement("span");
      heart.textContent = "♥";
      if (i >= health) heart.className = "lost";
      healthHud.appendChild(heart);
    }
    healthHud.classList.toggle("critical", health === 1);
    healthHud.setAttribute("aria-label", `Здоровье: ${health} из ${MAX_HEALTH}`);
  }

  function makeTextTexture(text, foreground = "#e8e2cd", background = "#263028") {
    const surface = document.createElement("canvas");
    surface.width = 512;
    surface.height = 192;
    const context = surface.getContext("2d");
    context.fillStyle = background;
    context.fillRect(0, 0, surface.width, surface.height);
    context.strokeStyle = "#77816d";
    context.lineWidth = 12;
    context.strokeRect(10, 10, surface.width - 20, surface.height - 20);
    context.fillStyle = foreground;
    context.font = "900 82px Arial";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, surface.width / 2, surface.height / 2 + 5);
    const texture = new THREE.CanvasTexture(surface);
    return useSrgb(texture);
  }

  function configureTexture(texture, repeatX, repeatY) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeatX, repeatY);
    texture.anisotropy = Math.min(8, renderer?.capabilities.getMaxAnisotropy?.() || 4);
    return useSrgb(texture);
  }

  function openNeighbors(x, y) {
    const cell = grid[y][x];
    const result = [];
    if (!cell.n && y > 0) result.push({ x, y: y - 1 });
    if (!cell.e && x < SIZE - 1) result.push({ x: x + 1, y });
    if (!cell.s && y < SIZE - 1) result.push({ x, y: y + 1 });
    if (!cell.w && x > 0) result.push({ x: x - 1, y });
    return result;
  }

  function mazeDistances(origin) {
    const distances = Array.from({ length: SIZE }, () => Array(SIZE).fill(Infinity));
    const queue = [origin];
    distances[origin.y][origin.x] = 0;
    for (let index = 0; index < queue.length; index++) {
      const current = queue[index];
      openNeighbors(current.x, current.y).forEach(next => {
        if (distances[next.y][next.x] !== Infinity) return;
        distances[next.y][next.x] = distances[current.y][current.x] + 1;
        queue.push(next);
      });
    }
    return distances;
  }

  function createEnemyModel(index, palettes) {
    const palette = palettes[index % palettes.length];
    const enemy = new THREE.Group();
    const armor = new THREE.MeshStandardMaterial({ color: palette.armor, roughness: 0.76, metalness: 0.2 });
    const cloth = new THREE.MeshStandardMaterial({ color: palette.cloth, roughness: 1 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x111517, roughness: 0.78, metalness: 0.34 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x252b2e, roughness: 0.4, metalness: 0.72 });
    const eye = new THREE.MeshBasicMaterial({ color: 0xd9e1d7 });

    [-0.22, 0.22].forEach((x, sideIndex) => {
      addSegment(enemy, new THREE.Vector3(x, 0.12, 0), new THREE.Vector3(x, 0.92, sideIndex ? 0.02 : -0.02), 0.115, cloth, 9);
      const boot = box(0.31, 0.2, 0.48, dark);
      boot.position.set(x, 0.12, 0.12);
      enemy.add(boot);
      const knee = box(0.26, 0.28, 0.13, armor);
      knee.position.set(x, 0.72, 0.12);
      enemy.add(knee);
    });

    const torso = box(0.82, 0.96, 0.43, cloth);
    torso.position.set(0, 1.34, 0);
    enemy.add(torso);
    const vestFront = box(0.88, 0.68, 0.16, armor);
    vestFront.position.set(0, 1.38, 0.28);
    enemy.add(vestFront);
    const vestBack = box(0.74, 0.72, 0.18, armor);
    vestBack.position.set(0, 1.39, -0.28);
    enemy.add(vestBack);
    const belt = box(0.9, 0.12, 0.48, dark);
    belt.position.set(0, 0.94, 0);
    enemy.add(belt);
    for (let i = -1; i <= 1; i++) {
      const pouch = box(0.2, 0.25, 0.13, dark);
      pouch.position.set(i * 0.24, 1.17, 0.39);
      enemy.add(pouch);
    }

    addSegment(enemy, new THREE.Vector3(-0.46, 1.62, 0), new THREE.Vector3(-0.29, 1.34, 0.48), 0.1, cloth, 9);
    addSegment(enemy, new THREE.Vector3(0.46, 1.62, 0), new THREE.Vector3(0.25, 1.37, 0.72), 0.1, cloth, 9);
    [-0.29, 0.25].forEach((x, handIndex) => {
      const glove = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 7), dark);
      glove.position.set(x, handIndex ? 1.37 : 1.34, handIndex ? 0.72 : 0.48);
      enemy.add(glove);
    });
    [-0.46, 0.46].forEach(x => {
      const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 7), armor);
      shoulder.scale.set(1.15, 0.8, 1);
      shoulder.position.set(x, 1.66, 0);
      enemy.add(shoulder);
    });

    const mask = new THREE.Mesh(new THREE.SphereGeometry(0.31, 16, 11), dark);
    mask.scale.set(0.92, 1.08, 0.9);
    mask.position.set(0, 2.02, 0.02);
    enemy.add(mask);
    const eyeBand = box(0.46, 0.12, 0.08, dark);
    eyeBand.position.set(0, 2.07, 0.28);
    enemy.add(eyeBand);
    [-0.105, 0.105].forEach(x => {
      const visibleEye = new THREE.Mesh(new THREE.SphereGeometry(0.034, 8, 6), eye);
      visibleEye.position.set(x, 2.08, 0.326);
      enemy.add(visibleEye);
    });
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.36, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.58), armor);
    helmet.scale.y = 0.7;
    helmet.position.set(0, 2.16, 0.01);
    enemy.add(helmet);
    const headset = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.035, 7, 18, Math.PI), dark);
    headset.rotation.z = Math.PI / 2;
    headset.position.set(0, 2.04, 0);
    enemy.add(headset);

    const rifle = new THREE.Group();
    const receiver = box(0.16, 0.18, 0.72, steel);
    receiver.position.z = 0.08;
    rifle.add(receiver);
    const stock = box(0.2, 0.22, 0.48, dark);
    stock.position.z = -0.48;
    rifle.add(stock);
    const handguard = box(0.13, 0.14, 0.58, armor);
    handguard.position.z = 0.7;
    rifle.add(handguard);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.78, 9), steel);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = 1.28;
    rifle.add(barrel);
    const magazine = box(0.14, 0.42, 0.22, dark);
    magazine.rotation.x = -0.22;
    magazine.position.set(0, -0.25, 0.15);
    rifle.add(magazine);
    const optic = box(0.11, 0.12, 0.22, dark);
    optic.position.set(0, 0.15, 0.22);
    rifle.add(optic);
    rifle.position.set(0.04, 1.43, 0.5);
    enemy.add(rifle);

    const muzzle = new THREE.Object3D();
    muzzle.name = "muzzle";
    muzzle.position.set(0.04, 1.43, 2.18);
    enemy.add(muzzle);
    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffb12b })
    );
    flash.scale.set(0.65, 0.65, 2.2);
    flash.position.copy(muzzle.position);
    flash.visible = false;
    enemy.add(flash);

    const backpack = box(0.55, 0.72, 0.26, armor);
    backpack.position.set(0, 1.4, -0.43);
    enemy.add(backpack);
    collapseStaticModel(enemy, [muzzle, flash]);
    enemy.userData = { muzzle, flash, phase: Math.random() * Math.PI * 2 };
    return enemy;
  }

  function createEnemies() {
    const palettes = [
      { cloth: 0x263126, armor: 0x46533d },
      { cloth: 0x282b2b, armor: 0x3d4447 },
      { cloth: 0x4b4432, armor: 0x655d43 }
    ];
    const fromStart = mazeDistances(START);
    const fromExit = mazeDistances(EXIT);
    const candidates = [];
    for (let y = 1; y < SIZE - 1; y++) {
      for (let x = 1; x < SIZE - 1; x++) {
        if (fromStart[y][x] < 8 || fromExit[y][x] < 4) continue;
        if (openNeighbors(x, y).length < 2 || reservedCells.has(`${x}:${y}`)) continue;
        candidates.push({ x, y, distance: fromStart[y][x] });
      }
    }
    const chosen = [];
    while (chosen.length < ENEMY_COUNT && candidates.length) {
      let bestIndex = 0;
      let bestScore = -Infinity;
      candidates.forEach((candidate, index) => {
        const spacing = chosen.length
          ? Math.min(...chosen.map(other => Math.hypot(candidate.x - other.x, candidate.y - other.y)))
          : candidate.distance;
        const score = spacing * 10 + candidate.distance * 0.08 + Math.random();
        if (score > bestScore) { bestScore = score; bestIndex = index; }
      });
      chosen.push(candidates.splice(bestIndex, 1)[0]);
    }
    chosen.forEach((cell, index) => {
      const enemy = createEnemyModel(index, palettes);
      const position = cellPosition(cell.x, cell.y);
      enemy.position.set(position.x + (Math.random() - 0.5) * 1.8, 0, position.z + (Math.random() - 0.5) * 1.8);
      enemy.rotation.y = Math.random() * Math.PI * 2;
      Object.assign(enemy.userData, {
        cell,
        nextSenseAt: 0,
        nextShotAt: 0,
        acquiredAt: Infinity,
        visible: false,
        muzzleFlashUntil: 0
      });
      scene.add(enemy);
      enemies.push(enemy);
      reservedCells.add(`${cell.x}:${cell.y}`);
    });
    threatLabel.textContent = `Угроз в лабиринте: ${enemies.length}`;
  }

  function hasLineOfSight(enemy, distance) {
    if (distance > 42) return false;
    const origin = new THREE.Vector3();
    enemy.userData.muzzle.getWorldPosition(origin);
    const direction = camera.position.clone().sub(origin);
    const rayDistance = direction.length();
    if (distance > 7) {
      const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(enemy.quaternion);
      if (facing.dot(direction.clone().normalize()) < Math.cos(THREE.MathUtils.degToRad(70))) return false;
    }
    losRaycaster.set(origin, direction.normalize());
    losRaycaster.near = 0.12;
    losRaycaster.far = Math.max(0.15, rayDistance - 0.45);
    return losRaycaster.intersectObjects(wallOccluders, false).length === 0;
  }

  function playGunshot(distance) {
    if (!audioContext || audioContext.state !== "running") return;
    const duration = 0.075;
    const buffer = audioContext.createBuffer(1, Math.floor(audioContext.sampleRate * duration), audioContext.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3);
    const source = audioContext.createBufferSource();
    const filter = audioContext.createBiquadFilter();
    const gain = audioContext.createGain();
    filter.type = "lowpass";
    filter.frequency.value = 1200;
    gain.gain.value = Math.max(0.015, 0.13 * (1 - distance / 55));
    source.buffer = buffer;
    source.connect(filter).connect(gain).connect(audioContext.destination);
    source.start();
  }

  function fireEnemyBullet(enemy, time, distance) {
    if (enemyBullets.length >= 40) return;
    const origin = new THREE.Vector3();
    enemy.userData.muzzle.getWorldPosition(origin);
    const spread = 0.045 + distance * 0.0012;
    const target = camera.position.clone();
    target.x += (Math.random() - 0.5) * spread * distance;
    target.y += (Math.random() - 0.5) * spread * distance * 0.45;
    target.z += (Math.random() - 0.5) * spread * distance;
    const direction = target.sub(origin).normalize();
    losRaycaster.set(origin, direction);
    losRaycaster.near = 0.15;
    losRaycaster.far = 65;
    const wallHit = losRaycaster.intersectObjects(wallOccluders, false)[0];
    const tracer = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.06, 0.85, 7),
      new THREE.MeshBasicMaterial({ color: 0xffa029 })
    );
    tracer.position.copy(origin);
    tracer.quaternion.setFromUnitVectors(upVector, direction);
    tracer.userData = {
      velocity: direction.multiplyScalar(24),
      remaining: wallHit ? Math.max(0.2, wallHit.distance - 0.18) : 65,
      bornAt: time
    };
    scene.add(tracer);
    enemyBullets.push(tracer);
    enemy.userData.muzzleFlashUntil = time + 85;
    playGunshot(distance);
  }

  function wrappedAngle(current, target, amount) {
    const difference = Math.atan2(Math.sin(target - current), Math.cos(target - current));
    return current + difference * amount;
  }

  function updateEnemies(time, delta) {
    enemies.forEach(enemy => {
      const dx = camera.position.x - enemy.position.x;
      const dz = camera.position.z - enemy.position.z;
      const distance = Math.hypot(dx, dz);
      enemy.position.y = Math.sin(time * 0.002 + enemy.userData.phase) * 0.018;
      enemy.userData.flash.visible = time < enemy.userData.muzzleFlashUntil;
      if (time >= enemy.userData.nextSenseAt) {
        const wasVisible = enemy.userData.visible;
        enemy.userData.visible = hasLineOfSight(enemy, distance);
        enemy.userData.nextSenseAt = time + 340 + Math.random() * 140;
        if (enemy.userData.visible && !wasVisible) {
          enemy.userData.acquiredAt = time + 650 + Math.random() * 300;
          enemy.userData.nextShotAt = enemy.userData.acquiredAt + 350;
        }
      }
      if (!enemy.userData.visible) return;
      const targetYaw = Math.atan2(dx, dz);
      enemy.rotation.y = wrappedAngle(enemy.rotation.y, targetYaw, Math.min(1, delta * 4.2));
      if (time >= enemy.userData.acquiredAt && time >= enemy.userData.nextShotAt) {
        fireEnemyBullet(enemy, time, distance);
        enemy.userData.nextShotAt = time + 2100 + Math.random() * 1500;
      }
    });
  }

  function distanceToSegment(point, start, end) {
    const segment = end.clone().sub(start);
    const lengthSquared = segment.lengthSq();
    if (!lengthSquared) return point.distanceTo(start);
    const amount = THREE.MathUtils.clamp(point.clone().sub(start).dot(segment) / lengthSquared, 0, 1);
    return point.distanceTo(start.clone().addScaledVector(segment, amount));
  }

  function removeEnemyBullet(index) {
    const bullet = enemyBullets[index];
    scene.remove(bullet);
    bullet.geometry.dispose();
    bullet.material.dispose();
    enemyBullets.splice(index, 1);
  }

  function damagePlayer(time) {
    if (damageCooldown > 0 || health <= 0) return;
    health = Math.max(0, health - 1);
    damageCooldown = 0.65;
    damageFlashUntil = time + 260;
    updateHealthHud();
    if (health === 0) lose();
  }

  function updateEnemyBullets(time, delta) {
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
      const bullet = enemyBullets[i];
      const previous = bullet.position.clone();
      const travel = Math.min(bullet.userData.remaining, bullet.userData.velocity.length() * delta);
      bullet.position.addScaledVector(bullet.userData.velocity, travel / bullet.userData.velocity.length());
      bullet.userData.remaining -= travel;
      if (distanceToSegment(camera.position, previous, bullet.position) < 0.58) {
        removeEnemyBullet(i);
        damagePlayer(time);
        if (!running) return;
        continue;
      }
      if (bullet.userData.remaining <= 0 || time - bullet.userData.bornAt > 3200) removeEnemyBullet(i);
    }
  }

  function makeHorrorDecalTexture(type) {
    const surface = document.createElement("canvas");
    surface.width = surface.height = 512;
    const context = surface.getContext("2d");
    context.lineCap = "round";
    context.lineJoin = "round";
    context.shadowBlur = 16;
    if (type === 0) {
      context.shadowColor = "#d9d0b1";
      context.fillStyle = "rgba(205,198,169,.9)";
      context.beginPath();
      context.ellipse(256, 210, 112, 132, 0, 0, Math.PI * 2);
      context.fill();
      context.fillRect(188, 282, 136, 82);
      context.fillStyle = "rgba(28,24,20,.94)";
      context.beginPath();context.ellipse(215, 215, 38, 48, -0.2, 0, Math.PI * 2);context.fill();
      context.beginPath();context.ellipse(297, 215, 38, 48, 0.2, 0, Math.PI * 2);context.fill();
      context.beginPath();context.moveTo(256,248);context.lineTo(233,292);context.lineTo(279,292);context.closePath();context.fill();
      context.strokeStyle = "rgba(39,31,24,.9)";context.lineWidth = 11;
      for (let x = 210; x <= 302; x += 23) { context.beginPath();context.moveTo(x,310);context.lineTo(x,355);context.stroke(); }
      context.strokeStyle = "rgba(128,16,22,.82)";context.lineWidth = 9;
      for (let i = 0; i < 7; i++) { context.beginPath();context.moveTo(175+i*28,370);context.lineTo(164+i*31,420+Math.random()*35);context.stroke(); }
    } else if (type === 1) {
      context.strokeStyle = "rgba(180,19,30,.92)";
      context.shadowColor = "#7e0810";
      context.lineWidth = 17;
      context.beginPath();context.moveTo(256,68);context.lineTo(430,374);context.lineTo(82,374);context.closePath();context.stroke();
      context.beginPath();context.ellipse(256,258,104,60,0,0,Math.PI*2);context.stroke();
      context.fillStyle = "rgba(223,48,52,.9)";context.beginPath();context.arc(256,258,27,0,Math.PI*2);context.fill();
      for (let i = 0; i < 6; i++) { context.beginPath();context.moveTo(124+i*53,376);context.lineTo(118+i*54,430+Math.random()*52);context.stroke(); }
    } else if (type === 2) {
      context.strokeStyle = "rgba(164,15,24,.88)";
      context.shadowColor = "#63030a";
      context.lineWidth = 22;
      for (let i = 0; i < 5; i++) {
        context.beginPath();
        context.moveTo(142 + i * 55, 72 + Math.random() * 45);
        context.bezierCurveTo(105 + i * 58, 205, 179 + i * 46, 297, 116 + i * 63, 448);
        context.stroke();
      }
      context.fillStyle = "rgba(190,20,29,.75)";
      context.beginPath();context.ellipse(256,250,66,82,-.1,0,Math.PI*2);context.fill();
      for (let i = 0; i < 5; i++) { context.beginPath();context.arc(200+i*28,158-Math.abs(2-i)*17,24,0,Math.PI*2);context.fill(); }
    } else {
      context.fillStyle = "rgba(198,29,35,.94)";
      context.shadowColor = "#65060b";
      context.font = "900 116px Arial";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.save();context.rotate(-0.055);context.fillText("БЕГИ",256,218);context.restore();
      context.font = "900 44px Arial";
      context.fillText("НЕ ОГЛЯДЫВАЙСЯ",256,325);
      context.strokeStyle = "rgba(198,29,35,.82)";context.lineWidth=10;
      for(let i=0;i<9;i++){context.beginPath();context.moveTo(95+i*40,350);context.lineTo(89+i*41,420+Math.random()*68);context.stroke();}
    }
    const texture = new THREE.CanvasTexture(surface);
    return useSrgb(texture);
  }

  function createWallHorror(horizontalWalls, verticalWalls) {
    const walls = [
      ...horizontalWalls.map(([x, z]) => ({ x, z, horizontal: true })),
      ...verticalWalls.map(([x, z]) => ({ x, z, horizontal: false }))
    ].sort(() => Math.random() - 0.5).slice(0, 42);
    for (let type = 0; type < 4; type++) {
      const selected = walls.filter((_, index) => index % 4 === type);
      const material = new THREE.MeshBasicMaterial({
        map: makeHorrorDecalTexture(type),
        transparent: true,
        alphaTest: 0.08,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        side: THREE.FrontSide
      });
      const decals = new THREE.InstancedMesh(new THREE.PlaneGeometry(2.6, 2.6), material, selected.length);
      const dummy = new THREE.Object3D();
      selected.forEach((wall, index) => {
        const boundary = SIZE * CELL / 2;
        const wallAxis = wall.horizontal ? wall.z : wall.x;
        const side = Math.abs(wallAxis) >= boundary - 0.01
          ? (wallAxis < 0 ? 1 : -1)
          : (Math.random() < 0.5 ? -1 : 1);
        const along = (Math.random() - 0.5) * 3.4;
        const height = 2.4 + Math.random() * 3.1;
        const scale = 0.76 + Math.random() * 0.58;
        if (wall.horizontal) {
          dummy.position.set(wall.x + along, height, wall.z + side * (WALL_THICKNESS / 2 + 0.018));
          dummy.rotation.set(0, side > 0 ? 0 : Math.PI, (Math.random() - 0.5) * 0.08);
        } else {
          dummy.position.set(wall.x + side * (WALL_THICKNESS / 2 + 0.018), height, wall.z + along);
          dummy.rotation.set(0, side > 0 ? Math.PI / 2 : -Math.PI / 2, (Math.random() - 0.5) * 0.08);
        }
        dummy.scale.set(scale, scale, scale);
        dummy.updateMatrix();
        decals.setMatrixAt(index, dummy.matrix);
      });
      decals.instanceMatrix.needsUpdate = true;
      decals.userData.kind = "decor";
      scene.add(decals);
    }
  }

  function createSkull(boneMaterial, socketMaterial) {
    const skull = new THREE.Group();
    const cranium = new THREE.Mesh(new THREE.SphereGeometry(0.29, 14, 10), boneMaterial);
    cranium.scale.set(0.9, 1.02, 0.88);
    cranium.position.y = 0.31;
    skull.add(cranium);
    const jaw = box(0.38, 0.19, 0.29, boneMaterial);
    jaw.position.set(0, 0.08, 0.035);
    skull.add(jaw);
    [-0.105, 0.105].forEach(x => {
      const socket = new THREE.Mesh(new THREE.SphereGeometry(0.078, 9, 6), socketMaterial);
      socket.scale.z = 0.45;
      socket.position.set(x, 0.34, 0.247);
      skull.add(socket);
    });
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.13, 3), socketMaterial);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 0.23, 0.27);
    skull.add(nose);
    for (let i = -2; i <= 2; i++) {
      const tooth = box(0.045, 0.095, 0.04, boneMaterial);
      tooth.position.set(i * 0.052, 0.08, 0.19);
      skull.add(tooth);
    }
    collapseStaticModel(skull);
    return skull;
  }

  function createSkeleton(boneMaterial, socketMaterial) {
    const skeleton = new THREE.Group();
    const skull = createSkull(boneMaterial, socketMaterial);
    skull.position.set(0, 0.05, -1.05);
    skull.rotation.x = -0.22;
    skeleton.add(skull);
    addSegment(skeleton, new THREE.Vector3(0, 0.16, -0.7), new THREE.Vector3(0, 0.16, 0.45), 0.055, boneMaterial, 7);
    for (let i = 0; i < 4; i++) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(0.26 + i * 0.045, 0.035, 6, 17), boneMaterial);
      rib.rotation.x = Math.PI / 2;
      rib.scale.z = 0.58;
      rib.position.set(0, 0.16, -0.48 + i * 0.22);
      skeleton.add(rib);
    }
    const pelvis = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.075, 7, 16, Math.PI), boneMaterial);
    pelvis.rotation.set(Math.PI / 2, 0, Math.PI);
    pelvis.position.set(0, 0.16, 0.48);
    skeleton.add(pelvis);
    addSegment(skeleton, new THREE.Vector3(-0.22, 0.16, -0.43), new THREE.Vector3(-0.78, 0.13, 0.12), 0.05, boneMaterial, 7);
    addSegment(skeleton, new THREE.Vector3(0.22, 0.16, -0.43), new THREE.Vector3(0.85, 0.13, -0.05), 0.05, boneMaterial, 7);
    addSegment(skeleton, new THREE.Vector3(-0.17, 0.16, 0.5), new THREE.Vector3(-0.36, 0.14, 1.55), 0.065, boneMaterial, 7);
    addSegment(skeleton, new THREE.Vector3(0.17, 0.16, 0.5), new THREE.Vector3(0.48, 0.14, 1.48), 0.065, boneMaterial, 7);
    collapseStaticModel(skeleton);
    skeleton.userData.kind = "decor";
    return skeleton;
  }

  function createFallenBody(index) {
    const body = new THREE.Group();
    const uniforms = [0x252b25, 0x333536, 0x4b4231, 0x29323a];
    const cloth = new THREE.MeshStandardMaterial({ color: uniforms[index % uniforms.length], roughness: 1 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x111416, roughness: 0.86 });
    const skin = new THREE.MeshStandardMaterial({ color: 0x8c735e, roughness: 1 });
    const torso = box(0.88, 0.36, 1.02, cloth);
    torso.position.set(0, 0.27, 0);
    body.add(torso);
    const vest = box(0.92, 0.2, 0.62, dark);
    vest.position.set(0, 0.48, -0.06);
    body.add(vest);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 8), skin);
    head.position.set(0.08, 0.26, -0.76);
    body.add(head);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.56), dark);
    helmet.scale.y = 0.65;
    helmet.position.set(0.08, 0.36, -0.77);
    body.add(helmet);
    addSegment(body, new THREE.Vector3(-0.38, 0.2, -0.25), new THREE.Vector3(-0.95, 0.14, 0.28), 0.1, cloth, 8);
    addSegment(body, new THREE.Vector3(0.38, 0.2, -0.25), new THREE.Vector3(0.82, 0.13, -0.65), 0.1, cloth, 8);
    addSegment(body, new THREE.Vector3(-0.2, 0.18, 0.45), new THREE.Vector3(-0.42, 0.13, 1.48), 0.13, cloth, 8);
    addSegment(body, new THREE.Vector3(0.2, 0.18, 0.45), new THREE.Vector3(0.5, 0.13, 1.36), 0.13, cloth, 8);
    collapseStaticModel(body);
    body.userData.kind = "decor";
    return body;
  }

  function createHorrorProps() {
    const boneMaterial = new THREE.MeshStandardMaterial({ color: 0xb8aa88, roughness: 0.92 });
    const socketMaterial = new THREE.MeshBasicMaterial({ color: 0x171512 });
    const boneGeometry = new THREE.CylinderGeometry(0.055, 0.072, 1, 7);
    const jointGeometry = new THREE.SphereGeometry(0.085, 8, 6);
    const scatteredBones = new THREE.InstancedMesh(boneGeometry, boneMaterial, 58);
    const boneJoints = new THREE.InstancedMesh(jointGeometry, boneMaterial, 116);
    const dummy = new THREE.Object3D();
    let jointIndex = 0;
    for (let i = 0; i < 58; i++) {
      const cell = randomCell({ minStart: 4, minExit: 3 });
      const center = cellPosition(cell.x, cell.y);
      const angle = Math.random() * Math.PI * 2;
      const length = 0.55 + Math.random() * 0.85;
      const direction = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      center.x += (Math.random() < 0.5 ? -1 : 1) * (2.15 + Math.random() * 1.05);
      center.z += (Math.random() - 0.5) * 4.8;
      center.y = 0.1;
      dummy.position.copy(center);
      dummy.quaternion.setFromUnitVectors(upVector, direction);
      dummy.scale.set(1, length, 1);
      dummy.updateMatrix();
      scatteredBones.setMatrixAt(i, dummy.matrix);
      [-0.5, 0.5].forEach(side => {
        dummy.position.copy(center).addScaledVector(direction, length * side);
        dummy.quaternion.identity();dummy.scale.set(1,1,1);dummy.updateMatrix();
        boneJoints.setMatrixAt(jointIndex++, dummy.matrix);
      });
    }
    scatteredBones.instanceMatrix.needsUpdate = true;
    boneJoints.instanceMatrix.needsUpdate = true;
    scatteredBones.userData.kind = boneJoints.userData.kind = "decor";
    scene.add(scatteredBones, boneJoints);

    for (let i = 0; i < 14; i++) {
      const cell = randomCell({ minStart: 4, minExit: 3, used: reservedCells });
      const position = cellPosition(cell.x, cell.y);
      const skull = createSkull(boneMaterial, socketMaterial);
      skull.position.set(position.x + (Math.random() - 0.5) * 5.6, 0.03, position.z + (Math.random() - 0.5) * 5.6);
      skull.rotation.set((Math.random() - 0.5) * 0.8, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.55);
      skull.scale.setScalar(0.75 + Math.random() * 0.5);
      skull.userData.kind = "decor";
      scene.add(skull);
    }
    for (let i = 0; i < 6; i++) {
      const cell = randomCell({ minStart: 5, minExit: 3, used: reservedCells });
      const position = cellPosition(cell.x, cell.y);
      const skeleton = createSkeleton(boneMaterial, socketMaterial);
      skeleton.position.set(position.x + (Math.random() - 0.5) * 2.8, 0, position.z + (Math.random() - 0.5) * 2.8);
      skeleton.rotation.y = Math.random() * Math.PI * 2;
      skeleton.scale.setScalar(0.88 + Math.random() * 0.3);
      scene.add(skeleton);
    }
    for (let i = 0; i < 5; i++) {
      const cell = randomCell({ minStart: 5, minExit: 4, used: reservedCells });
      const position = cellPosition(cell.x, cell.y);
      const body = createFallenBody(i);
      body.position.set(position.x + (Math.random() - 0.5) * 2.2, 0, position.z + (Math.random() - 0.5) * 2.2);
      body.rotation.y = Math.random() * Math.PI * 2;
      scene.add(body);
      if (i < 3) {
        const beaconMaterial = new THREE.MeshStandardMaterial({ color: 0x52131a, emissive: 0xc81423, emissiveIntensity: 2.4 });
        const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.15, 0.24, 10), beaconMaterial);
        beacon.position.set(body.position.x + 0.8, 0.14, body.position.z - 0.5);
        const light = new THREE.PointLight(0xb51020, 1.4, 10, 2);
        light.position.set(beacon.position.x, 0.8, beacon.position.z);
        light.userData = { base: 1.4, phase: Math.random() * Math.PI * 2 };
        horrorLights.push(light);
        scene.add(beacon, light);
      }
    }

    const dustPositions = new Float32Array(520 * 3);
    for (let i = 0; i < 520; i++) {
      dustPositions[i * 3] = (Math.random() - 0.5) * SIZE * CELL;
      dustPositions[i * 3 + 1] = 0.3 + Math.random() * 7;
      dustPositions[i * 3 + 2] = (Math.random() - 0.5) * SIZE * CELL;
    }
    const dustGeometry = new THREE.BufferGeometry();
    dustGeometry.setAttribute("position", new THREE.BufferAttribute(dustPositions, 3));
    dustCloud = new THREE.Points(dustGeometry, new THREE.PointsMaterial({ color: 0xc9b995, size: 0.055, transparent: true, opacity: 0.32, depthWrite: false }));
    scene.add(dustCloud);
  }

  function createSky() {
    const geometry = new THREE.SphereGeometry(340, 32, 18);
    const material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        topColor: { value: new THREE.Color(0x64777b) },
        bottomColor: { value: new THREE.Color(0xc1b994) },
        offset: { value: 18 },
        exponent: { value: 0.75 }
      },
      vertexShader: "varying vec3 vWorldPosition; void main(){ vec4 worldPosition=modelMatrix*vec4(position,1.0); vWorldPosition=worldPosition.xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
      fragmentShader: "uniform vec3 topColor; uniform vec3 bottomColor; uniform float offset; uniform float exponent; varying vec3 vWorldPosition; void main(){ float h=normalize(vWorldPosition+offset).y; gl_FragColor=vec4(mix(bottomColor,topColor,max(pow(max(h,0.0),exponent),0.0)),1.0); }"
    });
    scene.add(new THREE.Mesh(geometry, material));
  }

  function buildWorld() {
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x58655f, 0.013);
    camera = new THREE.PerspectiveCamera(70, 1100 / 700, 0.08, 550);
    camera.rotation.order = "YXZ";
    createSky();

    scene.add(new THREE.HemisphereLight(0xaec4c2, 0x20271b, 0.82));
    const sun = new THREE.DirectionalLight(0xffdfae, 1.28);
    sun.position.set(-90, 130, -50);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0x7aa0a3, 0.28);
    fill.position.set(80, 30, 90);
    scene.add(fill);

    const textureLoader = new THREE.TextureLoader();
    const diffuse = configureTexture(textureLoader.load("maze-concrete-moss.jpg"), 1.25, 2.4);
    const normal = textureLoader.load("maze-concrete-moss-normal.jpg");
    normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
    normal.repeat.set(1.25, 2.4);
    const roughness = textureLoader.load("maze-concrete-moss-rough.jpg");
    roughness.wrapS = roughness.wrapT = THREE.RepeatWrapping;
    roughness.repeat.set(1.25, 2.4);

    const wallMaterial = new THREE.MeshStandardMaterial({
      map: diffuse,
      normalMap: normal,
      normalScale: new THREE.Vector2(0.75, 0.75),
      roughnessMap: roughness,
      color: 0x777b70,
      roughness: 0.98,
      metalness: 0.02
    });
    const capMaterial = new THREE.MeshStandardMaterial({ color: 0x2c332d, roughness: 1 });
    const ribMaterial = new THREE.MeshStandardMaterial({ color: 0x3a403b, roughness: 0.88, metalness: 0.18 });
    const groundTexture = configureTexture(textureLoader.load("maze-mud-ground.jpg"), 18, 18);
    const groundMaterial = new THREE.MeshStandardMaterial({ map: groundTexture, color: 0x66705a, roughness: 1 });
    const mudMaterial = new THREE.MeshStandardMaterial({ color: 0x3d3527, roughness: 1 });
    const mossMaterial = new THREE.MeshStandardMaterial({ color: 0x38512d, roughness: 1 });
    const metalMaterial = new THREE.MeshStandardMaterial({ color: 0x26312e, roughness: 0.72, metalness: 0.42 });

    const ground = box(SIZE * CELL + 45, 0.5, SIZE * CELL + 45, groundMaterial);
    ground.position.y = -0.28;
    scene.add(ground);

    const horizontalWalls = [];
    const verticalWalls = [];
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const position = cellPosition(x, y);
        const cell = grid[y][x];
        if (cell.n) horizontalWalls.push([position.x, position.z - CELL / 2]);
        if (cell.w) verticalWalls.push([position.x - CELL / 2, position.z]);
        if (y === SIZE - 1 && cell.s) horizontalWalls.push([position.x, position.z + CELL / 2]);
        if (x === SIZE - 1 && cell.e) verticalWalls.push([position.x + CELL / 2, position.z]);
      }
    }

    function addInstancedWalls(list, horizontal) {
      const geometry = new THREE.BoxGeometry(
        horizontal ? CELL + 0.2 : WALL_THICKNESS,
        WALL_HEIGHT,
        horizontal ? WALL_THICKNESS : CELL + 0.2
      );
      const mesh = new THREE.InstancedMesh(geometry, wallMaterial, list.length);
      const capGeometry = new THREE.BoxGeometry(
        horizontal ? CELL + 0.34 : WALL_THICKNESS + 0.16,
        0.28,
        horizontal ? WALL_THICKNESS + 0.16 : CELL + 0.34
      );
      const caps = new THREE.InstancedMesh(capGeometry, capMaterial, list.length);
      const dummy = new THREE.Object3D();
      list.forEach(([x, z], index) => {
        dummy.position.set(x, WALL_HEIGHT / 2, z);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
        dummy.position.y = WALL_HEIGHT + 0.08;
        dummy.updateMatrix();
        caps.setMatrixAt(index, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      caps.instanceMatrix.needsUpdate = true;
      mesh.userData.mazeOccluder = true;
      wallOccluders.push(mesh);
      scene.add(mesh, caps);
    }
    addInstancedWalls(horizontalWalls, true);
    addInstancedWalls(verticalWalls, false);
    createWallHorror(horizontalWalls, verticalWalls);

    const ribs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.32, WALL_HEIGHT + 0.5, 0.32), ribMaterial, (SIZE + 1) * (SIZE + 1));
    const dummy = new THREE.Object3D();
    let ribIndex = 0;
    for (let y = 0; y <= SIZE; y++) {
      for (let x = 0; x <= SIZE; x++) {
        dummy.position.set((x - SIZE / 2) * CELL, WALL_HEIGHT / 2, (y - SIZE / 2) * CELL);
        dummy.updateMatrix();
        ribs.setMatrixAt(ribIndex++, dummy.matrix);
      }
    }
    ribs.instanceMatrix.needsUpdate = true;
    scene.add(ribs);

    // Mud tracks, rubble and vegetation break up the long corridors.
    const trackGeometry = new THREE.BoxGeometry(2.5, 0.035, 0.32);
    const tracks = new THREE.InstancedMesh(trackGeometry, mudMaterial, 170);
    for (let i = 0; i < 170; i++) {
      const x = Math.floor(Math.random() * SIZE);
      const y = Math.floor(Math.random() * SIZE);
      const position = cellPosition(x, y);
      dummy.position.set(position.x + (Math.random() - 0.5) * 5.2, 0.025, position.z + (Math.random() - 0.5) * 5.2);
      dummy.rotation.set(0, Math.random() * Math.PI, 0);
      dummy.scale.set(0.55 + Math.random(), 1, 1);
      dummy.updateMatrix();
      tracks.setMatrixAt(i, dummy.matrix);
    }
    tracks.instanceMatrix.needsUpdate = true;
    scene.add(tracks);

    const shrubGeometry = new THREE.ConeGeometry(0.42, 1.5, 6);
    const shrubs = new THREE.InstancedMesh(shrubGeometry, mossMaterial, 240);
    for (let i = 0; i < 240; i++) {
      const x = Math.floor(Math.random() * SIZE);
      const y = Math.floor(Math.random() * SIZE);
      const position = cellPosition(x, y);
      const edge = Math.random() < 0.5;
      dummy.position.set(
        position.x + (edge ? (Math.random() < 0.5 ? -3.55 : 3.55) : (Math.random() - 0.5) * 6.6),
        0.7,
        position.z + (!edge ? (Math.random() < 0.5 ? -3.55 : 3.55) : (Math.random() - 0.5) * 6.6)
      );
      dummy.rotation.set(0, Math.random() * Math.PI, (Math.random() - 0.5) * 0.24);
      dummy.scale.setScalar(0.6 + Math.random() * 1.1);
      dummy.updateMatrix();
      shrubs.setMatrixAt(i, dummy.matrix);
    }
    shrubs.instanceMatrix.needsUpdate = true;
    scene.add(shrubs);

    const rubbleGeometry = new THREE.BoxGeometry(0.75, 0.55, 0.9);
    const rubble = new THREE.InstancedMesh(rubbleGeometry, wallMaterial, 90);
    for (let i = 0; i < 90; i++) {
      const x = Math.floor(Math.random() * SIZE);
      const y = Math.floor(Math.random() * SIZE);
      const position = cellPosition(x, y);
      dummy.position.set(position.x + (Math.random() < 0.5 ? -3.3 : 3.3), 0.3, position.z + (Math.random() - 0.5) * 6);
      dummy.rotation.set(Math.random() * 0.25, Math.random() * Math.PI, Math.random() * 0.2);
      dummy.scale.set(0.5 + Math.random(), 0.45 + Math.random(), 0.5 + Math.random());
      dummy.updateMatrix();
      rubble.setMatrixAt(i, dummy.matrix);
    }
    rubble.instanceMatrix.needsUpdate = true;
    scene.add(rubble);

    // Sector signs provide readable landmarks instead of identical passages.
    for (let i = 0; i < 34; i++) {
      const x = 2 + Math.floor(Math.random() * (SIZE - 4));
      const y = 2 + Math.floor(Math.random() * (SIZE - 4));
      const position = cellPosition(x, y);
      const sector = `${String.fromCharCode(65 + Math.floor(x / 5))}-${String(y + 1).padStart(2, "0")}`;
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(2.8, 1.05),
        new THREE.MeshBasicMaterial({ map: makeTextTexture(sector), side: THREE.DoubleSide })
      );
      sign.position.set(position.x, 4.4, position.z - CELL / 2 + 0.38);
      scene.add(sign);
    }

    // Industrial lamps create warm islands in the cold green maze.
    const lampMaterial = new THREE.MeshStandardMaterial({ color: 0xf2b64d, emissive: 0xff7a18, emissiveIntensity: 2.2 });
    const lampPoles = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 3.8, 0.16), metalMaterial, 22);
    const lampHeads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.55, 0.25, 0.42), lampMaterial, 22);
    for (let i = 0; i < 22; i++) {
      const x = 2 + Math.floor(Math.random() * (SIZE - 4));
      const y = 2 + Math.floor(Math.random() * (SIZE - 4));
      const position = cellPosition(x, y);
      const lampPosition = new THREE.Vector3(position.x + (i % 2 ? 3.55 : -3.55), 3.8, position.z + (i % 3 - 1) * 2.1);
      dummy.position.set(lampPosition.x, 1.9, lampPosition.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      lampPoles.setMatrixAt(i, dummy.matrix);
      dummy.position.copy(lampPosition);
      dummy.updateMatrix();
      lampHeads.setMatrixAt(i, dummy.matrix);
      if (i % 5 === 0) {
        const light = new THREE.PointLight(0xffa044, 2.2, 15, 2);
        light.position.copy(lampPosition);
        scene.add(light);
      }
    }
    lampPoles.instanceMatrix.needsUpdate = true;
    lampHeads.instanceMatrix.needsUpdate = true;
    scene.add(lampPoles, lampHeads);

    // Tall pines remain visible above the walls and root the scene in the Miami forest story.
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x49382a, roughness: 1 });
    const pineMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, vertexColors: true });
    const trunks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 1, 0.6), trunkMaterial, 85);
    const crowns = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 8), pineMaterial, 85);
    const pineColors = [0x1d3b2b, 0x294934, 0x36543a].map(color => new THREE.Color(color));
    for (let i = 0; i < 85; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = SIZE * CELL * 0.56 + 12 + Math.random() * 50;
      const height = 18 + Math.random() * 18;
      const treeX = Math.cos(angle) * radius;
      const treeZ = Math.sin(angle) * radius;
      dummy.position.set(treeX, height * 0.31, treeZ);
      dummy.rotation.set(0, angle, 0);
      dummy.scale.set(1, height * 0.62, 1);
      dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix);
      const crownRadius = 3.6 + Math.random() * 2;
      dummy.position.set(treeX, height * 0.72, treeZ);
      dummy.rotation.set(0, angle + Math.random() * 0.45, 0);
      dummy.scale.set(crownRadius, height, crownRadius);
      dummy.updateMatrix();
      crowns.setMatrixAt(i, dummy.matrix);
      crowns.setColorAt(i, pineColors[i % pineColors.length]);
    }
    trunks.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
    if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
    scene.add(trunks, crowns);

    createExit(exitBeacon => { window.__mazeExitBeacon = exitBeacon; }, metalMaterial);
    createPickups(metalMaterial);
    createHorrorProps();
    createEnemies();

    const start = cellPosition(START.x, START.y);
    camera.position.set(start.x, EYE_HEIGHT, start.z);
    yaw = Math.PI;
    pitch = -0.03;
    camera.rotation.set(pitch, yaw, 0);
    scene.updateMatrixWorld(true);
  }

  function createExit(setBeacon, metalMaterial) {
    const position = cellPosition(EXIT.x, EXIT.y);
    const gate = new THREE.Group();
    gate.position.copy(position);

    const cyanMaterial = new THREE.MeshStandardMaterial({
      color: 0xbefaff,
      emissive: 0x2bdfff,
      emissiveIntensity: 3.4,
      roughness: 0.22,
      metalness: 0.15
    });
    const hazardMaterial = new THREE.MeshStandardMaterial({
      color: 0xffbd2e,
      emissive: 0xff7b00,
      emissiveIntensity: 0.75,
      roughness: 0.62
    });
    const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x151b1c, roughness: 0.72, metalness: 0.62 });
    const portalMaterial = new THREE.MeshBasicMaterial({
      color: 0x54e9ff,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    const leftTower = box(1.35, WALL_HEIGHT + 2.5, 1.35, metalMaterial);
    const rightTower = leftTower.clone();
    leftTower.position.set(CELL / 2, (WALL_HEIGHT + 2.5) / 2, -CELL / 2 + 0.75);
    rightTower.position.set(CELL / 2, (WALL_HEIGHT + 2.5) / 2, CELL / 2 - 0.75);
    const lintel = box(1.45, 1.35, CELL - 1.25, metalMaterial);
    lintel.position.set(CELL / 2, WALL_HEIGHT - 0.75, 0);

    // Yellow-black armor plates make the extraction gate readable from far away.
    const hazardPlates = [];
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < 7; i++) {
        const plate = box(0.16, 0.82, 0.78, i % 2 ? darkMaterial : hazardMaterial);
        plate.position.set(CELL / 2 - 0.76, 2.05 + i * 1.12, side * (CELL / 2 - 0.73));
        plate.rotation.x = side * 0.1;
        hazardPlates.push(plate);
      }
    }

    const portal = new THREE.Mesh(new THREE.PlaneGeometry(CELL - 2.05, WALL_HEIGHT - 3.1), portalMaterial);
    portal.rotation.y = Math.PI / 2;
    portal.position.set(CELL / 2 + 0.22, (WALL_HEIGHT - 3.1) / 2 + 0.4, 0);

    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.15, 0.14, 10, 56), cyanMaterial);
    ring.rotation.y = Math.PI / 2;
    ring.scale.set(0.92, 1.48, 1);
    ring.position.set(CELL / 2 - 0.04, 5.65, 0);

    const floorMarkers = [];
    for (let i = 0; i < 6; i++) {
      const marker = box(1.1, 0.055, 0.24, cyanMaterial.clone());
      marker.position.set(CELL / 2 - 1.4 - i * 1.35, 0.055, 0);
      marker.material.emissiveIntensity = 1.4 + i * 0.25;
      floorMarkers.push(marker);
    }

    // Three luminous chevrons point directly through the gate.
    const chevrons = [];
    for (let i = 0; i < 3; i++) {
      const chevron = new THREE.Group();
      const left = box(0.62, 0.06, 0.13, cyanMaterial);
      const right = left.clone();
      left.rotation.y = Math.PI / 4;
      right.rotation.y = -Math.PI / 4;
      left.position.z = -0.19;
      right.position.z = 0.19;
      chevron.add(left, right);
      chevron.position.set(CELL / 2 - 2.1 - i * 1.55, 0.085, 0);
      chevrons.push(chevron);
    }

    const exitLight = new THREE.PointLight(0x65eaff, 7.5, 42, 1.35);
    exitLight.position.set(CELL / 2 - 2.2, 5.5, 0);
    const warmLight = new THREE.PointLight(0xffa62f, 3.2, 20, 1.7);
    warmLight.position.set(CELL / 2 - 1.1, 2.3, 0);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(6.25, 1.72),
      new THREE.MeshBasicMaterial({ map: makeTextTexture("ЭВАКУАЦИЯ", "#e8fdff", "#102b31"), side: THREE.DoubleSide })
    );
    sign.rotation.y = -Math.PI / 2;
    sign.position.set(CELL / 2 - 0.78, WALL_HEIGHT - 2.05, 0);

    gate.add(leftTower, rightTower, lintel, portal, ring, exitLight, warmLight, sign, ...hazardPlates, ...floorMarkers, ...chevrons);
    gate.userData = { portal, ring, floorMarkers, chevrons, exitLight };
    scene.add(gate);
    exitBeacon = gate;
    setBeacon(gate);
  }

  function createPickups(metalMaterial) {
    const files = {
      weapon: "weapon-crate.png",
      grenade: "grenade-crate.png",
      ammo: "ammo-crate.png"
    };
    const colors = { weapon: 0xf0b746, grenade: 0x75d77a, ammo: 0xe47b55 };
    const loader = new THREE.TextureLoader();
    Object.keys(files).forEach(type => {
      const texture = useSrgb(loader.load(files[type]));
      for (let i = 0; i < 11; i++) {
        let x;
        let y;
        let key;
        do {
          x = Math.floor(Math.random() * SIZE);
          y = Math.floor(Math.random() * SIZE);
          key = `${x}:${y}`;
        } while ((x < 3 && y < 3) || (x > SIZE - 4 && y > SIZE - 4) || reservedCells.has(key));
        reservedCells.add(key);
        const group = new THREE.Group();
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
        sprite.scale.set(2.8, 2.8, 1);
        sprite.position.y = 1.6;
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(1.15, 0.075, 8, 28),
          new THREE.MeshStandardMaterial({ color: colors[type], emissive: colors[type], emissiveIntensity: 2.1 })
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.08;
        const pedestal = box(2.35, 0.14, 2.35, metalMaterial);
        pedestal.position.y = 0.02;
        group.add(sprite, ring, pedestal);
        const position = cellPosition(x, y);
        group.position.set(position.x, 0, position.z);
        group.userData = { type, ring, baseY: 0, phase: Math.random() * Math.PI * 2 };
        scene.add(group);
        pickups.push(group);
      }
    });
  }

  function canMove(x, z) {
    const cx = Math.round(x / CELL + (SIZE - 1) / 2);
    const cy = Math.round(z / CELL + (SIZE - 1) / 2);
    if (cx < 0 || cy < 0 || cx >= SIZE || cy >= SIZE) return false;
    const position = cellPosition(cx, cy);
    const cell = grid[cy][cx];
    const margin = WALL_THICKNESS / 2 + 0.48;
    if (cell.w && x < position.x - CELL / 2 + margin) return false;
    if (cell.e && x > position.x + CELL / 2 - margin) return false;
    if (cell.n && z < position.z - CELL / 2 + margin) return false;
    if (cell.s && z > position.z + CELL / 2 - margin) return false;
    if (enemies.some(enemy => Math.hypot(x - enemy.position.x, z - enemy.position.z) < 0.78)) return false;
    return true;
  }

  function updateHud() {
    const cx = Math.max(0, Math.min(SIZE - 1, Math.round(camera.position.x / CELL + (SIZE - 1) / 2)));
    const cy = Math.max(0, Math.min(SIZE - 1, Math.round(camera.position.z / CELL + (SIZE - 1) / 2)));
    const sector = `${String.fromCharCode(65 + Math.floor(cx / 5))}-${String(cy + 1).padStart(2, "0")}`;
    if (sector !== currentSector) {
      currentSector = sector;
      title.textContent = `В заложниках · сектор ${sector}`;
    }
    const exitPosition = cellPosition(EXIT.x, EXIT.y);
    const distance = Math.round(Math.hypot(camera.position.x - exitPosition.x, camera.position.z - exitPosition.z));
    distanceLabel.textContent = `До выхода: ${distance} м`;
  }

  function animate(frameTime = 0) {
    if (!running) return;
    const delta = Math.min((frameTime - lastTime) / 1000 || 0.016, 0.04);
    lastTime = frameTime;

    // Esc releases the cursor, so pause the entire simulation instead of only the gunfight.
    if (pointerLockEverActive && document.pointerLockElement !== canvas) {
      renderer.render(scene, camera);
      animationFrame = requestAnimationFrame(animate);
      return;
    }
    simulationTime += delta * 1000;
    const time = simulationTime;

    const forward = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
    const side = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    const keyboardTurn = (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0);
    yaw -= keyboardTurn * delta * 1.7;

    const moving = forward !== 0 || side !== 0;
    const diagonalScale = forward && side ? Math.SQRT1_2 : 1;
    const healthSpeed = health === 1 ? 0.54 : 1;
    const speed = (keys.ShiftLeft || keys.ShiftRight ? 8.6 : 5.25) * healthSpeed * delta * diagonalScale;
    const dx = (-Math.sin(yaw) * forward + Math.cos(yaw) * side) * speed;
    const dz = (-Math.cos(yaw) * forward - Math.sin(yaw) * side) * speed;
    if (canMove(camera.position.x + dx, camera.position.z)) camera.position.x += dx;
    if (canMove(camera.position.x, camera.position.z + dz)) camera.position.z += dz;

    if (moving) walkTime += delta * (keys.ShiftLeft || keys.ShiftRight ? 13 : 8.5) * healthSpeed;
    camera.position.y = EYE_HEIGHT + (moving ? Math.sin(walkTime) * 0.045 : 0);
    camera.rotation.set(pitch, yaw, moving ? Math.sin(walkTime * 0.5) * 0.006 : 0);

    damageCooldown = Math.max(0, damageCooldown - delta);
    damageFlash.classList.toggle("active", time < damageFlashUntil);
    updateEnemies(time, delta);
    updateEnemyBullets(time, delta);
    if (!running) return;
    horrorLights.forEach(light => {
      light.intensity = light.userData.base * (0.72 + (Math.sin(time * 0.006 + light.userData.phase) + 1) * 0.18);
    });
    if (dustCloud) dustCloud.rotation.y += delta * 0.008;

    pickups.forEach(item => {
      item.rotation.y += delta * 0.55;
      item.position.y = item.userData.baseY + Math.sin(time * 0.0018 + item.userData.phase) * 0.12;
      item.userData.ring.rotation.z += delta * 1.5;
    });
    for (let i = pickups.length - 1; i >= 0; i--) {
      const item = pickups[i];
      if (Math.hypot(item.position.x - camera.position.x, item.position.z - camera.position.z) < 1.65) {
        const type = item.userData.type;
        collected[type]++;
        document.querySelector(`[data-maze-crate="${type}"]`).textContent = collected[type];
        item.visible = false;
        pickups.splice(i, 1);
      }
    }

    if (exitBeacon) {
      const pulse = Math.sin(time * 0.004);
      const { portal, ring, floorMarkers, chevrons, exitLight } = exitBeacon.userData;
      portal.material.opacity = 0.14 + (pulse + 1) * 0.055;
      ring.scale.set(0.92 + pulse * 0.025, 1.48 + pulse * 0.035, 1);
      ring.material.emissiveIntensity = 3.2 + pulse * 0.8;
      exitLight.intensity = 6.5 + (pulse + 1) * 1.15;
      floorMarkers.forEach((marker, index) => {
        marker.material.emissiveIntensity = 1.25 + (Math.sin(time * 0.006 - index * 0.9) + 1) * 1.15;
      });
      chevrons.forEach((chevron, index) => {
        chevron.position.y = 0.085 + Math.sin(time * 0.005 - index * 0.7) * 0.025;
      });
    }
    updateHud();

    const exitPosition = cellPosition(EXIT.x, EXIT.y);
    if (camera.position.x > exitPosition.x + CELL / 2 - 0.75 && Math.abs(camera.position.z - exitPosition.z) < CELL / 2) {
      win();
      return;
    }

    renderer.render(scene, camera);
    animationFrame = requestAnimationFrame(animate);
  }

  function prepare() {
    overlay.classList.remove("hidden");
    health = MAX_HEALTH;
    updateHealthHud();
    document.getElementById("maze-menu").classList.add("hidden");
    document.getElementById("maze-message").textContent = "В заложниках";
    document.getElementById("maze-description").textContent = "Внутри комплекса тебя ждут 25 вооружённых террористов. Избегай огня, собирай припасы и доберись до ворот эвакуации. Награда: $50,000.";
    document.getElementById("maze-start").textContent = "Войти в лабиринт";
  }

  function resizeRenderer() {
    if (!renderer || !camera) return;
    const width = Math.max(1, canvas.clientWidth || 1100);
    const height = Math.max(1, canvas.clientHeight || 700);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function lockPointer() {
    if (!canvas.requestPointerLock) return;
    try {
      const request = canvas.requestPointerLock();
      if (request?.catch) request.catch(() => {});
    } catch (_) {
      // Some embedded browsers intentionally block pointer lock.
    }
  }

  function start() {
    stop();
    health = MAX_HEALTH;
    damageCooldown = 0;
    damageFlashUntil = 0;
    simulationTime = 0;
    walkTime = 0;
    pointerLockEverActive = false;
    updateHealthHud();
    damageFlash.classList.remove("active");
    reservedCells.clear();
    wallOccluders.length = 0;
    enemies.length = 0;
    enemyBullets.length = 0;
    horrorLights.length = 0;
    Object.keys(collected).forEach(type => {
      collected[type] = 0;
      document.querySelector(`[data-maze-crate="${type}"]`).textContent = "0";
    });
    pickups.length = 0;
    currentSector = "";
    carveMaze();
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    if ("outputColorSpace" in renderer && THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
    if ("outputEncoding" in renderer && THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    try {
      const AudioEngine = window.AudioContext || window.webkitAudioContext;
      if (AudioEngine && !audioContext) audioContext = new AudioEngine();
      audioContext?.resume?.();
    } catch (_) {}
    buildWorld();
    resizeRenderer();
    overlay.classList.add("hidden");
    running = true;
    window.GameAudio?.playMode("hostage");
    lastTime = performance.now();
    help.textContent = "Клик · обзор мышью · WASD · бег Shift · Esc курсор";
    lockPointer();
    animationFrame = requestAnimationFrame(animate);
  }

  function win() {
    running = false;
    window.GameAudio?.stop();
    cancelAnimationFrame(animationFrame);
    document.exitPointerLock?.();
    window.dispatchEvent(new CustomEvent("supply-maze-win", { detail: { ...collected } }));
    overlay.classList.remove("hidden");
    document.getElementById("maze-message").textContent = "Выход найден · +$50,000";
    document.getElementById("maze-description").textContent = `Склад пополнен: оружие ${collected.weapon}, гранаты ${collected.grenade}, пули ${collected.ammo}.`;
    document.getElementById("maze-start").textContent = "Новый лабиринт";
    document.getElementById("maze-menu").classList.remove("hidden");
  }

  function lose() {
    running = false;
    window.GameAudio?.stop();
    cancelAnimationFrame(animationFrame);
    document.exitPointerLock?.();
    damageFlash.classList.remove("active");
    overlay.classList.remove("hidden");
    document.getElementById("maze-message").textContent = "Ты ранен";
    document.getElementById("maze-description").textContent = "Террористы перекрыли путь к эвакуации. В новом лабиринте их позиции изменятся — используй стены как укрытие.";
    document.getElementById("maze-start").textContent = "Попробовать снова";
    document.getElementById("maze-menu").classList.remove("hidden");
  }

  function stop() {
    running = false;
    window.GameAudio?.stop();
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    Object.keys(keys).forEach(code => { keys[code] = false; });
    if (document.pointerLockElement === canvas) document.exitPointerLock?.();
    if (scene) {
      const geometries = new Set();
      const materials = new Set();
      const textures = new Set();
      scene.traverse(object => {
        if (object.geometry) geometries.add(object.geometry);
        const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
        objectMaterials.filter(Boolean).forEach(material => materials.add(material));
      });
      geometries.forEach(geometry => geometry.dispose?.());
      materials.forEach(material => {
        ["map", "normalMap", "roughnessMap", "metalnessMap", "alphaMap", "emissiveMap"].forEach(key => {
          if (material[key]) textures.add(material[key]);
        });
        material.dispose?.();
      });
      textures.forEach(texture => texture.dispose?.());
    }
    if (renderer) {
      renderer.renderLists?.dispose?.();
      renderer.dispose();
    }
    renderer = null;
    scene = null;
    camera = null;
    exitBeacon = null;
    window.__mazeExitBeacon = null;
    pickups.length = 0;
    enemies.length = 0;
    enemyBullets.length = 0;
    wallOccluders.length = 0;
    horrorLights.length = 0;
    reservedCells.clear();
    dustCloud = null;
    damageFlash.classList.remove("active");
  }

  window.addEventListener("keydown", event => {
    keys[event.code] = true;
    if (running && event.code.startsWith("Arrow")) event.preventDefault();
  });
  window.addEventListener("keyup", event => { keys[event.code] = false; });
  window.addEventListener("blur", () => Object.keys(keys).forEach(code => { keys[code] = false; }));
  canvas.addEventListener("click", () => {
    if (running && document.pointerLockElement !== canvas) lockPointer();
  });
  window.addEventListener("mousemove", event => {
    if (!running || document.pointerLockElement !== canvas) return;
    yaw -= event.movementX * 0.0022;
    pitch -= event.movementY * 0.002;
    pitch = Math.max(-1.42, Math.min(1.42, pitch));
  });
  document.addEventListener("pointerlockchange", () => {
    if (!running) return;
    if (document.pointerLockElement === canvas) pointerLockEverActive = true;
    help.textContent = document.pointerLockElement === canvas
      ? "WASD · бег Shift · мышь: полный обзор · Esc курсор"
      : "Кликни по игре, чтобы вернуть обзор мышью";
  });
  window.addEventListener("resize", resizeRenderer);

  window.SupplyMaze = { prepare, start, stop };
})();
