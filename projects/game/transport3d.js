(() => {
const THREE = window.THREE;

let renderer, scene, camera, truck, enemy, frame;
let running = false, speed = 15, playerX = 0, lives = 3, shotClock = 0, bonusClock = 0, damageCooldown = 0, speedBoostCount = 0, speedBoostUntil = 0, fuel = 1, activeRoute = "russia", crateCounts = {ammo:0,weapon:0,grenade:0};
const keys = Object.create(null), roadParts = [], trees = [], bullets = [], bonuses = [];

const mat = (color, roughness = .7, metalness = .05) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
function forestGroundMaterial() {
  const canvas=document.createElement("canvas");canvas.width=256;canvas.height=256;
  const ctx=canvas.getContext("2d");ctx.fillStyle="#315f2b";ctx.fillRect(0,0,256,256);
  for(let i=0;i<950;i++){
    const green=55+Math.floor(Math.random()*50),x=Math.random()*256,y=Math.random()*256,r=.5+Math.random()*2.6;
    ctx.fillStyle=i%7===0?`rgba(82,66,38,${.16+Math.random()*.22})`:`rgba(${24+Math.random()*28},${48+Math.random()*48},${20+Math.random()*26},${.2+Math.random()*.32})`;
    ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();
  }
  const texture=new THREE.CanvasTexture(canvas);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(22,70);texture.colorSpace=THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({map:texture,color:0xffffff,roughness:1});
}
function desertGroundMaterial(repeatX=16,repeatY=45) {
  const texture=new THREE.TextureLoader().load("afghan-desert-ground.png");
  texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(repeatX,repeatY);texture.colorSpace=THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({map:texture,color:0xd0ad78,roughness:1,metalness:0});
}
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
let sharedTreeTexture=null,sharedTreeMaterials=null,sharedTreeGeometries=null;
function magentaTreeMaterial(crop) {
  if(!sharedTreeTexture){sharedTreeTexture=new THREE.TextureLoader().load("realistic-conifers-sheet.png");sharedTreeTexture.colorSpace=THREE.SRGBColorSpace;}
  return new THREE.ShaderMaterial({
    uniforms:{map:{value:sharedTreeTexture},crop:{value:new THREE.Vector2(crop[0],crop[1])}},transparent:true,side:THREE.DoubleSide,
    vertexShader:"varying vec2 vUv;uniform vec2 crop;void main(){vUv=vec2(mix(crop.x,crop.y,uv.x),uv.y);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
    fragmentShader:"uniform sampler2D map;varying vec2 vUv;void main(){vec4 c=texture2D(map,vUv);float mag=min(c.r,c.b)-c.g;if(mag>.16&&c.r>.55&&c.b>.45)discard;gl_FragColor=c;}"
  });
}
function realisticTree(type=0) {
  const crops=[[0,.315],[.315,.665],[.665,1]], heights=[8.7,9.1,8.9], widths=[3.5,4.3,4.1];
  if(!sharedTreeMaterials)sharedTreeMaterials=crops.map(crop=>magentaTreeMaterial(crop));
  if(!sharedTreeGeometries)sharedTreeGeometries=heights.map((height,i)=>new THREE.PlaneGeometry(widths[i],height));
  const tree=new THREE.Mesh(sharedTreeGeometries[type],sharedTreeMaterials[type]); tree.position.y=heights[type]/2; return tree;
}
let tankTexture=null,tankMaterials=null,tankGeometry=null;
function tankWreck(type=0){
  const crops=[[0,.335],[.335,.665],[.665,1]];
  if(!tankTexture){tankTexture=new THREE.TextureLoader().load("destroyed-tanks-sheet.png");tankTexture.colorSpace=THREE.SRGBColorSpace;}
  if(!tankMaterials)tankMaterials=crops.map(crop=>new THREE.ShaderMaterial({uniforms:{map:{value:tankTexture},crop:{value:new THREE.Vector2(crop[0],crop[1])}},transparent:true,side:THREE.DoubleSide,vertexShader:"varying vec2 vUv;uniform vec2 crop;void main(){vUv=vec2(mix(crop.x,crop.y,uv.x),uv.y);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",fragmentShader:"uniform sampler2D map;varying vec2 vUv;void main(){vec4 c=texture2D(map,vUv);if(c.a<.08)discard;gl_FragColor=c;}"}));
  if(!tankGeometry)tankGeometry=new THREE.PlaneGeometry(7.2,3.8);
  const wreck=new THREE.Mesh(tankGeometry,tankMaterials[type]);wreck.position.y=1.9;return wreck;
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
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(240,700), route === "russia" ? forestGroundMaterial() : desertGroundMaterial()); ground.rotation.x=-Math.PI/2; ground.position.z=-250; ground.receiveShadow=true; scene.add(ground);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(24,700), mat(0x292d32,.96)); road.rotation.x=-Math.PI/2; road.position.set(0,.025,-250); road.receiveShadow=true; scene.add(road);
  const edgeMat = mat(0xf4f4ee,.8); [-11.65,11.65].forEach(x=>{ const e=new THREE.Mesh(new THREE.BoxGeometry(.28,.08,700),edgeMat); e.position.set(x,.09,-250); scene.add(e); });
  roadParts.length=0;
  for(let z=-340;z<20;z+=12) for(const x of [-6,0,6]) { const dash=new THREE.Mesh(new THREE.BoxGeometry(.22,.06,5.4),edgeMat); dash.position.set(x,.1,z); scene.add(dash); roadParts.push(dash); }
  trees.length=0;
  const forestRows=route==="russia"?[
    {distance:14.2,spacing:11,scale:.82,jitter:2.2},
    {distance:20.0,spacing:9.5,scale:1.02,jitter:2.8},
    {distance:27.0,spacing:8.5,scale:1.2,jitter:3.2}
  ]:[];
  forestRows.forEach((row,rowIndex)=>{
    for(let z=-310;z<26;z+=row.spacing){
      for(const side of [-1,1]){
        const t=new THREE.Group();
        const type=Math.floor(Math.random()*3),front=realisticTree(type),cross=realisticTree(type);
        cross.rotation.y=Math.PI/2;t.add(front,cross);
        const scale=row.scale*(.84+Math.random()*.32);t.scale.setScalar(scale);
        t.position.set(side*(row.distance+Math.random()*row.jitter),0,z+(rowIndex%2)*3+Math.random()*3);
        scene.add(t);trees.push(t);
      }
    }
  });
  if(route==="russia"){
    const rockGeometry=new THREE.DodecahedronGeometry(.48,0),rockMaterials=[mat(0x6f746b,1),mat(0x555c53,1),mat(0x817b68,1)];
    for(let z=-295;z<18;z+=13){
      for(const side of [-1,1]){
        if(Math.random()<.72){const rock=new THREE.Mesh(rockGeometry,rockMaterials[Math.floor(Math.random()*rockMaterials.length)]);const scale=.45+Math.random()*1.25;rock.scale.set(scale,.45+Math.random()*.55,scale);rock.rotation.set(Math.random(),Math.random()*Math.PI,Math.random()*.3);rock.position.set(side*(13+Math.random()*18),.18,z+Math.random()*8);scene.add(rock);trees.push(rock);}
        if(Math.random()<.8){const tuft=new THREE.Group();const grassMat=mat(0x2f6b2c,1);for(let blade=0;blade<4;blade++){const stalk=new THREE.Mesh(new THREE.ConeGeometry(.08,.85,4),grassMat);stalk.position.set((blade-1.5)*.12,.42,Math.sin(blade)*.12);stalk.rotation.z=(blade-1.5)*.13;tuft.add(stalk);}tuft.position.set(side*(12.8+Math.random()*14),0,z+Math.random()*8);scene.add(tuft);trees.push(tuft);}
      }
    }
  }else{
    const sandMats=[desertGroundMaterial(3,2),desertGroundMaterial(4,3),desertGroundMaterial(2,2)];
    for(let z=-300;z<10;z+=28){
      for(const side of [-1,1]){
        const hill=new THREE.Mesh(new THREE.SphereGeometry(1,18,10,0,Math.PI*2,0,Math.PI/2),sandMats[Math.floor(Math.random()*sandMats.length)]);
        hill.scale.set(11+Math.random()*10,3.5+Math.random()*4.5,9+Math.random()*13);hill.position.set(side*(37+Math.random()*18),-.35,z+Math.random()*12);scene.add(hill);trees.push(hill);
      }
    }
    for(let z=-260;z<-15;z+=42){
      for(const side of [-1,1]){
        const wreck=tankWreck(Math.floor(Math.random()*3));wreck.scale.setScalar(.72+Math.random()*.35);wreck.rotation.y=side<0?.28:-.28;wreck.position.x=side*(15+Math.random()*6);wreck.position.z=z+Math.random()*12;scene.add(wreck);trees.push(wreck);
      }
    }
  }
  truck=makeCanvasTruck(); truck.position.set(0,0,0); scene.add(truck);
  enemy=new THREE.Group(); const enemyBase=makeTruck(0x25282d,true); enemyBase.visible=false; enemy.add(enemyBase); enemy.add(vehicleCard("enemy-vehicle-cartoon.png",4.9,4.9)); enemy.position.set(0,0,-42); scene.add(enemy);
}
function spawnBonus() {
  const roll=Math.random(),type=roll<.22?"life":roll<.44?"speed":roll<.64?"fuel":roll<.76?"ammo":roll<.88?"weapon":"grenade", g=new THREE.Group();
  if(["ammo","weapon","grenade"].includes(type)){
    const files={ammo:"ammo-crate.png",weapon:"weapon-crate.png",grenade:"grenade-crate.png"};
    const texture=new THREE.TextureLoader().load(files[type]);texture.colorSpace=THREE.SRGBColorSpace;
    const material=new THREE.MeshBasicMaterial({map:texture,transparent:true,alphaTest:.08,side:THREE.DoubleSide});
    const card=new THREE.Mesh(new THREE.PlaneGeometry(2.25,2.25),material);g.add(card);
    g.userData.kind=type;g.position.set([-8,-3,3,8][Math.floor(Math.random()*4)],1.15,-125);scene.add(g);bonuses.push(g);return;
  }
  const color=type==="life"?0x16b84e:type==="speed"?0x22bfff:0xe32624;
  const coreMaterial=type==="life"?new THREE.MeshBasicMaterial({color:0x16b84e}):new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:1.6,metalness:.18,roughness:.25});
  const core=new THREE.Mesh(new THREE.BoxGeometry(1.35,1.35,.38),coreMaterial);
  g.add(core);
  const symbolMat=new THREE.MeshBasicMaterial({color:0xffffff});
  if(type==="life"){
    const vertical=new THREE.Mesh(new THREE.BoxGeometry(.25,.82,.12),symbolMat), horizontal=new THREE.Mesh(new THREE.BoxGeometry(.82,.25,.12),symbolMat); vertical.position.z=horizontal.position.z=.25; g.add(vertical,horizontal);
  }else if(type==="speed"){
    const bolt=new THREE.Mesh(new THREE.ConeGeometry(.34,.9,4),symbolMat); bolt.rotation.z=-.35; bolt.position.z=.25; g.add(bolt);
  }else{
    const can=box(.72,.9,.2,0xd51f22);can.position.z=.26;g.add(can);const cap=box(.22,.18,.22,0x17191c);cap.position.set(.2,.53,.26);g.add(cap);
  }
  const ringColor=type==="life"?0x20e868:color;
  const ring=new THREE.Mesh(new THREE.TorusGeometry(1.05,.09,10,28),new THREE.MeshBasicMaterial({color:ringColor})); ring.rotation.x=Math.PI/2; g.add(ring); g.userData.kind=type; g.position.set([-8,-3,3,8][Math.floor(Math.random()*4)],1.1,-125); scene.add(g); bonuses.push(g);
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
  if(speedBoostUntil&&now>=speedBoostUntil){speedBoostCount=0;speedBoostUntil=0;speed=Math.min(speed,42);}
  fuel=Math.max(0,fuel-dt/35);
  const baseSpeedLimit=activeRoute==="afghanistan"?50:42;
  const speedLimit=fuel<=0?8:baseSpeedLimit+speedBoostCount*2;
  speed=Math.max(5,Math.min(speedLimit,speed+(gas?18:brake?-30:-4)*dt)); playerX=THREE.MathUtils.clamp(playerX+steer*(4+speed*.08)*dt,-9.4,9.4);
  const visualSpeed=speed*(1+speedBoostCount*.12);
  truck.position.x=THREE.MathUtils.lerp(truck.position.x,playerX,.18); truck.rotation.z=THREE.MathUtils.lerp(truck.rotation.z,-steer*.08,.14); camera.position.x=THREE.MathUtils.lerp(camera.position.x,playerX*.48,.06); camera.lookAt(playerX*.35,1,-26);
  enemy.position.x=Math.sin(now*.00045)*5.2;
  roadParts.forEach(o=>{o.position.z+=visualSpeed*dt;if(o.position.z>18)o.position.z-=360;}); trees.forEach(o=>{o.position.z+=visualSpeed*dt;if(o.position.z>22)o.position.z-=320;});
  damageCooldown=Math.max(0,damageCooldown-dt); shotClock+=dt; bonusClock+=dt; if(shotClock>1.65){shoot();shotClock=0;} if(bonusClock>2.8){spawnBonus();bonusClock=0;}
  for(let i=bullets.length-1;i>=0;i--){const b=bullets[i];b.position.addScaledVector(b.userData.velocity,dt);if(b.position.z>3){if(Math.abs(b.position.x-truck.position.x)<1.7&&damageCooldown===0){lives=Math.max(0,lives-1);damageCooldown=.7;updateLives();}scene.remove(b);bullets.splice(i,1);}}
  for(let i=bonuses.length-1;i>=0;i--){const b=bonuses[i];b.position.z+=visualSpeed*dt;b.rotation.y+=dt*2.5;if(b.position.z>1){if(Math.abs(b.position.x-truck.position.x)<2){if(b.userData.kind==="life")lives=Math.min(3,lives+1);if(b.userData.kind==="speed"){speedBoostCount+=1;speedBoostUntil=now+5000;speed=Math.min(42+speedBoostCount*2,speed+2);}if(b.userData.kind==="fuel")fuel=Math.min(1,fuel+.2);if(crateCounts[b.userData.kind]!==undefined){crateCounts[b.userData.kind]++;const counter=document.querySelector(`[data-crate-count="${b.userData.kind}"]`);if(counter)counter.textContent=String(crateCounts[b.userData.kind]);const stock=JSON.parse(localStorage.getItem("notWeaponStock")||'{"weapon":0,"grenade":0,"ammo":0}');stock[b.userData.kind]=(stock[b.userData.kind]||0)+1;localStorage.setItem("notWeaponStock",JSON.stringify(stock));}updateLives();}scene.remove(b);bonuses.splice(i,1);}}
  const kmh=Math.round(speed*5);const speedDial=Math.max(0,Math.min(1,(kmh-100)/150));document.getElementById("speed-value").firstChild.nodeValue=String(kmh);document.getElementById("speed-needle").style.transform=`rotate(${speedDial*180}deg)`;document.getElementById("fuel-needle").style.transform=`rotate(${-180+fuel*180}deg)`;document.getElementById("fuel-arc").style.setProperty("--fuel-angle",`${fuel*180}deg`); renderer.render(scene,camera); frame=requestAnimationFrame(animate);
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
window.Transport3D={start(route){this.stop();bullets.length=0;bonuses.length=0;activeRoute=route;resetCanvas();buildWorld(route);running=true;speed=15;playerX=0;lives=3;shotClock=0;bonusClock=0;damageCooldown=0;speedBoostCount=0;speedBoostUntil=0;fuel=1;crateCounts={ammo:0,weapon:0,grenade:0};document.querySelectorAll("[data-crate-count]").forEach(el=>el.textContent="0");updateLives();animate.last=performance.now();frame=requestAnimationFrame(animate);},stop(){running=false;if(frame)cancelAnimationFrame(frame);if(renderer)renderer.dispose();},isRunning(){return running;}};
})();
