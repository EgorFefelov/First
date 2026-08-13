(() => {
const THREE = window.THREE;

let renderer, scene, camera, truck, enemy, frame;
let running = false, speed = 15, playerX = 0, lives = 3, shotClock = 0, bonusClock = 0, damageCooldown = 0;
const keys = Object.create(null), roadParts = [], trees = [], bullets = [], bonuses = [];

const mat = (color, roughness = .7, metalness = .05) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
function box(w, h, d, color) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
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
    uniforms:{map:{value:texture}}, transparent:true, side:THREE.DoubleSide,
    vertexShader:"varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
    fragmentShader:"uniform sampler2D map; varying vec2 vUv; void main(){vec4 c=texture2D(map,vUv);float green=c.g-max(c.r,c.b);if(green>.12&&c.g>.35)discard;gl_FragColor=c;}"
  });
}
function vehicleCard(file, width, height) {
  const card = new THREE.Mesh(new THREE.PlaneGeometry(width,height), chromaTexture(file));
  card.position.y=height*.47; card.rotation.y=Math.PI; return card;
}
function makeCanvasTruck() {
  const g=new THREE.Group();
  const rear=vehicleCard("transport-truck-cartoon.png",4.15,4.15);
  rear.position.set(0,2.02,0);
  rear.rotation.y=0;
  g.add(rear);
  return g;
}
function makeTruck(color = 0x1268a8, enemyMode = false) {
  const g = new THREE.Group();
  const trailer = box(enemyMode ? 2.8 : 3.2, enemyMode ? 1.7 : 2.5, enemyMode ? 4.7 : 6.6, enemyMode ? 0x20252b : 0x34383e);
  trailer.position.set(0, enemyMode ? 1.25 : 1.65, enemyMode ? 0 : .5); g.add(trailer);
  const cab = box(enemyMode ? 2.6 : 2.7, enemyMode ? 1.6 : 2.3, enemyMode ? 2.2 : 2.4, color);
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
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(1100,700,false);
  renderer.shadowMap.enabled = true; renderer.outputColorSpace = THREE.SRGBColorSpace;
}
function buildWorld(route) {
  scene = new THREE.Scene(); scene.background = new THREE.Color(route === "russia" ? 0x83c9ef : 0xdba96a); scene.fog = new THREE.Fog(0xa8cde0, 45, 190);
  camera = new THREE.PerspectiveCamera(63, 1100/700, .1, 500); camera.position.set(0,6.2,12); camera.lookAt(0,1,-25);
  scene.add(new THREE.HemisphereLight(0xdff5ff,0x355124,2.4)); const sun = new THREE.DirectionalLight(0xffffff,2.6); sun.position.set(-20,35,15); sun.castShadow=true; scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(240,700), mat(route === "russia" ? 0x355f2c : 0xb37a39)); ground.rotation.x=-Math.PI/2; ground.position.z=-250; scene.add(ground);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(24,700), mat(0x292d32,.96)); road.rotation.x=-Math.PI/2; road.position.set(0,.025,-250); road.receiveShadow=true; scene.add(road);
  const edgeMat = mat(0xf4f4ee,.8); [-11.65,11.65].forEach(x=>{ const e=new THREE.Mesh(new THREE.BoxGeometry(.28,.08,700),edgeMat); e.position.set(x,.09,-250); scene.add(e); });
  roadParts.length=0;
  for(let z=-340;z<20;z+=12) for(const x of [-6,0,6]) { const dash=new THREE.Mesh(new THREE.BoxGeometry(.22,.06,5.4),edgeMat); dash.position.set(x,.1,z); scene.add(dash); roadParts.push(dash); }
  trees.length=0;
  const trunkMat=mat(0x5d3b24), leafMat=mat(route === "russia" ? 0x174c2b : 0x8b6732);
  for(let z=-300;z<20;z+=9) for(const side of [-1,1]) { const t=new THREE.Group(); const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.22,.32,2.2,7),trunkMat); trunk.position.y=1.1; const crown=new THREE.Mesh(new THREE.ConeGeometry(1.7,5.5,8),leafMat); crown.position.y=4.3; t.add(trunk,crown); t.position.set(side*(15+Math.random()*8),0,z+Math.random()*5); scene.add(t); trees.push(t); }
  truck=makeCanvasTruck(); truck.position.set(0,0,0); scene.add(truck);
  enemy=new THREE.Group(); const enemyBase=makeTruck(0x25282d,true); enemyBase.visible=false; enemy.add(enemyBase); enemy.add(vehicleCard("enemy-vehicle-cartoon.png",4.9,4.9)); enemy.position.set(0,0,-42); scene.add(enemy);
}
function spawnBonus() {
  const type=Math.random()<.45?"life":"speed", g=new THREE.Group();
  const color=type==="life"?0x19e86f:0x22bfff;
  const core=new THREE.Mesh(new THREE.BoxGeometry(1.35,1.35,.38),new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:1.6,metalness:.18,roughness:.25}));
  g.add(core);
  const symbolMat=new THREE.MeshBasicMaterial({color:0xffffff});
  if(type==="life"){
    const vertical=new THREE.Mesh(new THREE.BoxGeometry(.25,.82,.12),symbolMat), horizontal=new THREE.Mesh(new THREE.BoxGeometry(.82,.25,.12),symbolMat); vertical.position.z=horizontal.position.z=.25; g.add(vertical,horizontal);
  }else{
    const bolt=new THREE.Mesh(new THREE.ConeGeometry(.34,.9,4),symbolMat); bolt.rotation.z=-.35; bolt.position.z=.25; g.add(bolt);
  }
  const ring=new THREE.Mesh(new THREE.TorusGeometry(1.05,.09,10,28),new THREE.MeshBasicMaterial({color})); ring.rotation.x=Math.PI/2; g.add(ring); g.userData.kind=type; g.position.set([-8,-3,3,8][Math.floor(Math.random()*4)],1.1,-125); scene.add(g); bonuses.push(g);
}
function shoot() {
  const origin=new THREE.Vector3(enemy.position.x,2.7,enemy.position.z+1.4), target=new THREE.Vector3(playerX,1.25,1);
  const direction=target.clone().sub(origin).normalize();
  const tracer=new THREE.Mesh(new THREE.CylinderGeometry(.07,.07,1.9,8),new THREE.MeshStandardMaterial({color:0xffd35b,emissive:0xff5a00,emissiveIntensity:4}));
  tracer.position.copy(origin); tracer.userData.velocity=direction.clone().multiplyScalar(36); tracer.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction); scene.add(tracer); bullets.push(tracer);
}
function animate(now=0) {
  if(!running)return; const dt=Math.min(.035,(now-(animate.last||now))/1000); animate.last=now;
  const gas=keys.KeyW||keys.ArrowUp, brake=keys.KeyS||keys.ArrowDown, steer=(keys.KeyD||keys.ArrowRight?1:0)-(keys.KeyA||keys.ArrowLeft?1:0);
  speed=Math.max(5,Math.min(42,speed+(gas?18:brake?-30:-4)*dt)); playerX=THREE.MathUtils.clamp(playerX+steer*(4+speed*.08)*dt,-9.4,9.4);
  truck.position.x=THREE.MathUtils.lerp(truck.position.x,playerX,.18); truck.rotation.z=THREE.MathUtils.lerp(truck.rotation.z,-steer*.08,.14); camera.position.x=THREE.MathUtils.lerp(camera.position.x,playerX*.48,.06); camera.lookAt(playerX*.35,1,-26);
  enemy.position.x=Math.sin(now*.00045)*5.2;
  roadParts.forEach(o=>{o.position.z+=speed*dt;if(o.position.z>18)o.position.z-=360;}); trees.forEach(o=>{o.position.z+=speed*dt;if(o.position.z>22)o.position.z-=320;});
  damageCooldown=Math.max(0,damageCooldown-dt); shotClock+=dt; bonusClock+=dt; if(shotClock>1.65){shoot();shotClock=0;} if(bonusClock>2.8){spawnBonus();bonusClock=0;}
  for(let i=bullets.length-1;i>=0;i--){const b=bullets[i];b.position.addScaledVector(b.userData.velocity,dt);if(b.position.z>3){if(Math.abs(b.position.x-truck.position.x)<1.7&&damageCooldown===0){lives=Math.max(0,lives-1);damageCooldown=.7;updateLives();}scene.remove(b);bullets.splice(i,1);}}
  for(let i=bonuses.length-1;i>=0;i--){const b=bonuses[i];b.position.z+=speed*dt;b.rotation.y+=dt*2.5;if(b.position.z>1){if(Math.abs(b.position.x-truck.position.x)<2){if(b.userData.kind==="life")lives=Math.min(3,lives+1);if(b.userData.kind==="speed")speed=Math.min(42,speed+12);updateLives();}scene.remove(b);bonuses.splice(i,1);}}
  document.getElementById("transport-speed").textContent=`${Math.round(speed*5)} км/ч`; renderer.render(scene,camera); frame=requestAnimationFrame(animate);
}
function updateLives(){
  document.getElementById("transport-lives").textContent="❤️".repeat(Math.max(0,lives))+"🖤".repeat(Math.max(0,3-lives));
  if(lives<=0&&running){
    running=false;
    if(frame)cancelAnimationFrame(frame);
    document.getElementById("transport-result-title").textContent="Груз потерян";
    document.getElementById("transport-result").classList.remove("hidden");
  }
}
window.addEventListener("keydown",e=>{keys[e.code]=true;if(running&&e.code.startsWith("Arrow"))e.preventDefault();}); window.addEventListener("keyup",e=>keys[e.code]=false);
window.Transport3D={start(route){this.stop();bullets.length=0;bonuses.length=0;resetCanvas();buildWorld(route);running=true;speed=15;playerX=0;lives=3;shotClock=0;bonusClock=0;damageCooldown=0;updateLives();animate.last=performance.now();frame=requestAnimationFrame(animate);},stop(){running=false;if(frame)cancelAnimationFrame(frame);if(renderer)renderer.dispose();}};
})();
