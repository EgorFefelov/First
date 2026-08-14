(() => {
  const THREE = window.THREE;
  const SIZE = 27;
  const CELL = 9;
  const WALL_HEIGHT = 15;
  const WALL_THICKNESS = 0.72;
  const EYE_HEIGHT = 1.78;
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
  let walkTime = 0;
  let exitBeacon;
  let currentSector = "";

  const keys = Object.create(null);
  const collected = { weapon: 0, grenade: 0, ammo: 0 };
  const pickups = [];
  const canvas = document.getElementById("supply-maze-canvas");
  const overlay = document.getElementById("maze-overlay");
  const help = document.querySelector(".maze-help");
  const title = document.querySelector(".maze-title");
  const distanceLabel = document.getElementById("maze-exit-distance");
  const box = (w, h, d, material) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);

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
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  function configureTexture(texture, repeatX, repeatY) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeatX, repeatY);
    texture.anisotropy = Math.min(8, renderer?.capabilities.getMaxAnisotropy?.() || 4);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
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
      scene.add(mesh, caps);
    }
    addInstancedWalls(horizontalWalls, true);
    addInstancedWalls(verticalWalls, false);

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
    for (let i = 0; i < 22; i++) {
      const x = 2 + Math.floor(Math.random() * (SIZE - 4));
      const y = 2 + Math.floor(Math.random() * (SIZE - 4));
      const position = cellPosition(x, y);
      const pole = box(0.16, 3.8, 0.16, metalMaterial);
      pole.position.set(position.x + (i % 2 ? 3.55 : -3.55), 1.9, position.z + (i % 3 - 1) * 2.1);
      const lamp = box(0.55, 0.25, 0.42, lampMaterial);
      lamp.position.set(pole.position.x, 3.8, pole.position.z);
      scene.add(pole, lamp);
      if (i % 3 === 0) {
        const light = new THREE.PointLight(0xffa044, 2.2, 15, 2);
        light.position.copy(lamp.position);
        scene.add(light);
      }
    }

    // Tall pines remain visible above the walls and root the scene in the Miami forest story.
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x49382a, roughness: 1 });
    const pineMaterials = [0x1d3b2b, 0x294934, 0x36543a].map(color => new THREE.MeshStandardMaterial({ color, roughness: 1 }));
    for (let i = 0; i < 85; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = SIZE * CELL * 0.56 + 12 + Math.random() * 50;
      const height = 18 + Math.random() * 18;
      const trunk = box(0.6, height * 0.62, 0.6, trunkMaterial);
      trunk.position.set(Math.cos(angle) * radius, height * 0.31, Math.sin(angle) * radius);
      const crown = new THREE.Mesh(new THREE.ConeGeometry(3.6 + Math.random() * 2, height, 8), pineMaterials[i % pineMaterials.length]);
      crown.position.set(trunk.position.x, height * 0.72, trunk.position.z);
      scene.add(trunk, crown);
    }

    createExit(exitBeacon => { window.__mazeExitBeacon = exitBeacon; }, metalMaterial);
    createPickups(metalMaterial);

    const start = cellPosition(START.x, START.y);
    camera.position.set(start.x, EYE_HEIGHT, start.z);
    yaw = Math.PI;
    pitch = -0.03;
    camera.rotation.set(pitch, yaw, 0);
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
      const texture = loader.load(files[type]);
      texture.colorSpace = THREE.SRGBColorSpace;
      for (let i = 0; i < 11; i++) {
        let x;
        let y;
        do {
          x = Math.floor(Math.random() * SIZE);
          y = Math.floor(Math.random() * SIZE);
        } while ((x < 3 && y < 3) || (x > SIZE - 4 && y > SIZE - 4));
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

  function animate(time = 0) {
    if (!running) return;
    const delta = Math.min((time - lastTime) / 1000 || 0.016, 0.04);
    lastTime = time;

    const forward = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
    const side = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    const keyboardTurn = (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0);
    yaw -= keyboardTurn * delta * 1.7;

    const moving = forward !== 0 || side !== 0;
    const diagonalScale = forward && side ? Math.SQRT1_2 : 1;
    const speed = (keys.ShiftLeft || keys.ShiftRight ? 8.6 : 5.25) * delta * diagonalScale;
    const dx = (-Math.sin(yaw) * forward + Math.cos(yaw) * side) * speed;
    const dz = (-Math.cos(yaw) * forward - Math.sin(yaw) * side) * speed;
    if (canMove(camera.position.x + dx, camera.position.z)) camera.position.x += dx;
    if (canMove(camera.position.x, camera.position.z + dz)) camera.position.z += dz;

    if (moving) walkTime += delta * (keys.ShiftLeft || keys.ShiftRight ? 13 : 8.5);
    camera.position.y = EYE_HEIGHT + (moving ? Math.sin(walkTime) * 0.045 : 0);
    camera.rotation.set(pitch, yaw, moving ? Math.sin(walkTime * 0.5) * 0.006 : 0);

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
        scene.remove(item);
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
    document.getElementById("maze-menu").classList.add("hidden");
    document.getElementById("maze-message").textContent = "В заложниках";
    document.getElementById("maze-description").textContent = "Высокие стены старого комплекса скрывают оружейный склад. Собирай ящики, запоминай номера секторов и найди светящиеся ворота. Награда: $50,000.";
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
    Object.keys(collected).forEach(type => {
      collected[type] = 0;
      document.querySelector(`[data-maze-crate="${type}"]`).textContent = "0";
    });
    pickups.length = 0;
    currentSector = "";
    carveMaze();
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    buildWorld();
    resizeRenderer();
    overlay.classList.add("hidden");
    running = true;
    lastTime = performance.now();
    help.textContent = "Клик · обзор мышью · WASD · бег Shift · Esc курсор";
    lockPointer();
    animationFrame = requestAnimationFrame(animate);
  }

  function win() {
    running = false;
    cancelAnimationFrame(animationFrame);
    document.exitPointerLock?.();
    window.dispatchEvent(new CustomEvent("supply-maze-win", { detail: { ...collected } }));
    overlay.classList.remove("hidden");
    document.getElementById("maze-message").textContent = "Выход найден · +$50,000";
    document.getElementById("maze-description").textContent = `Склад пополнен: оружие ${collected.weapon}, гранаты ${collected.grenade}, пули ${collected.ammo}.`;
    document.getElementById("maze-start").textContent = "Новый лабиринт";
    document.getElementById("maze-menu").classList.remove("hidden");
  }

  function stop() {
    running = false;
    if (animationFrame) cancelAnimationFrame(animationFrame);
    Object.keys(keys).forEach(code => { keys[code] = false; });
    if (document.pointerLockElement === canvas) document.exitPointerLock?.();
    if (renderer) renderer.dispose();
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
    help.textContent = document.pointerLockElement === canvas
      ? "WASD · бег Shift · мышь: полный обзор · Esc курсор"
      : "Кликни по игре, чтобы вернуть обзор мышью";
  });
  window.addEventListener("resize", resizeRenderer);

  window.SupplyMaze = { prepare, start, stop };
})();
