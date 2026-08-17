(() => {
const THREE = window.THREE;

let renderer, scene, camera, truck, enemy, frame;
let running = false, speed = 15, playerX = 0, lives = 3, shotClock = 0, bonusClock = 0, damageCooldown = 0, speedBoostCount = 0, speedBoostUntil = 0, fuel = 1, activeRoute = "russia", crateCounts = {ammo:0,weapon:0,grenade:0};
const keys = Object.create(null), roadParts = [], trees = [], bullets = [], bonuses = [];

const mat = (color, roughness = .7, metalness = .05) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
function forestGroundMaterial() {
  const texture=new THREE.TextureLoader().load("forest-floor.jpg");texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(24,72);texture.colorSpace=THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({map:texture,color:0x59664d,roughness:1,metalness:0});
}
function asphaltMaterial(color=0x777b7d) {
  const texture=new THREE.TextureLoader().load("road-asphalt.jpg");texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(4,92);texture.colorSpace=THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({map:texture,color,roughness:.96,metalness:.01});
}
function desertGroundMaterial(repeatX=16,repeatY=45) {
  const texture=new THREE.TextureLoader().load("afghan-desert-ground.png");
  texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(repeatX,repeatY);texture.colorSpace=THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({map:texture,color:0x8f6846,roughness:1,metalness:0});
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
function whiteKeyTexture(file) {
  const texture=new THREE.TextureLoader().load(file);texture.colorSpace=THREE.SRGBColorSpace;
  return new THREE.ShaderMaterial({uniforms:{map:{value:texture}},transparent:true,side:THREE.DoubleSide,vertexShader:"varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",fragmentShader:"uniform sampler2D map;varying vec2 vUv;void main(){vec4 c=texture2D(map,vUv);float white=min(c.r,min(c.g,c.b));float spread=max(c.r,max(c.g,c.b))-min(c.r,min(c.g,c.b));if(white>.91&&spread<.07)discard;gl_FragColor=c;}"});
}
function truckTopTexture(file) {
  const texture=new THREE.TextureLoader().load(file);texture.colorSpace=THREE.SRGBColorSpace;
  return new THREE.ShaderMaterial({uniforms:{map:{value:texture}},transparent:true,side:THREE.DoubleSide,vertexShader:"varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",fragmentShader:"uniform sampler2D map;varying vec2 vUv;void main(){vec2 source=vec2(mix(.93,.07,vUv.y),mix(.84,.16,vUv.x));vec4 c=texture2D(map,source);float white=min(c.r,min(c.g,c.b));float spread=max(c.r,max(c.g,c.b))-min(c.r,min(c.g,c.b));if(white>.91&&spread<.07)discard;gl_FragColor=c;}"});
}
function canvasMaterial() {
  const texture=new THREE.TextureLoader().load("truck-textures/khaki-canvas.png");texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
  return new THREE.MeshStandardMaterial({map:texture,color:0x4b4938,roughness:1,metalness:0});
}
let sharedTreeTexture=null,sharedTreeMaterials=null,sharedTreeGeometries=null;
function magentaTreeMaterial(crop) {
  if(!sharedTreeTexture){sharedTreeTexture=new THREE.TextureLoader().load("realistic-conifers-sheet.png");sharedTreeTexture.colorSpace=THREE.SRGBColorSpace;}
  return new THREE.ShaderMaterial({
    uniforms:{map:{value:sharedTreeTexture},crop:{value:new THREE.Vector2(crop[0],crop[1])}},transparent:true,side:THREE.DoubleSide,
    vertexShader:"varying vec2 vUv;uniform vec2 crop;void main(){vUv=vec2(mix(crop.x,crop.y,uv.x),uv.y);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
    fragmentShader:"uniform sampler2D map;varying vec2 vUv;void main(){vec4 c=texture2D(map,vUv);float key=max(0.0,min(c.r,c.b)-c.g);float mask=smoothstep(.035,.16,key)*smoothstep(.24,.58,min(c.r,c.b));c.a*=1.0-mask;c.r=mix(c.r,c.g*.78,mask);c.b=mix(c.b,c.g*.72,mask);if(c.a<.1)discard;gl_FragColor=c;}"
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
  const g=new THREE.Group(),olive=0x27321f,canvasColor=0x474635,dark=0x171b1d;
  const chassis=box(2.25,.28,7.55,dark,.82,.25);chassis.position.set(0,.72,-.25);g.add(chassis);
  const bed=box(2.45,.72,4.65,olive,.82);bed.position.set(0,1.2,1.15);g.add(bed);
  const canvasBody=new THREE.Mesh(new THREE.BoxGeometry(2.38,1.55,4.5),canvasMaterial());canvasBody.position.set(0,2.3,1.12);g.add(canvasBody);
  const cab=box(2.22,1.8,1.92,olive,.72);cab.position.set(0,1.65,-2.35);g.add(cab);
  const hood=box(2.05,.72,1.55,olive,.72);hood.position.set(0,1.3,-4.02);g.add(hood);
  const roof=box(2.3,.18,2.05,0x303b24,.9);roof.position.set(0,2.62,-2.34);g.add(roof);
  const windshield=box(1.82,.68,.06,0x7fa5ad,.3,.05);windshield.position.set(0,2.06,-3.33);g.add(windshield);
  const grille=box(1.48,.62,.08,0x242a24,.55,.5);grille.position.set(0,1.35,-4.82);g.add(grille);
  const bumper=box(2.42,.22,.22,0x202326,.48,.65);bumper.position.set(0,.86,-4.92);g.add(bumper);
  const canvasRoof=new THREE.Mesh(new THREE.BoxGeometry(2.4,.12,4.52),canvasMaterial());canvasRoof.position.set(0,3.09,1.12);g.add(canvasRoof);
  const rearGate=box(2.38,.72,.12,olive,.82);rearGate.position.set(0,1.2,3.5);g.add(rearGate);
  [-1.03,1.03].forEach(x=>[-2.65,.7,2.35].forEach(z=>{const wh=wheel();wh.scale.set(1.2,1.2,1.2);wh.position.set(x,.58,z);g.add(wh)}));
  const tailMat=new THREE.MeshStandardMaterial({color:0xff391f,emissive:0xff2415,emissiveIntensity:1.5});
  [-.72,.72].forEach(x=>{const light=new THREE.Mesh(new THREE.BoxGeometry(.34,.2,.08),tailMat);light.position.set(x,1.02,3.58);g.add(light)});
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
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(1100,700,false);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type=THREE.PCFSoftShadowMap; renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.96;
}
function buildWorld(route) {
  renderer.toneMappingExposure=route==="russia"?.94:.72;
  scene = new THREE.Scene(); scene.background = new THREE.Color(route === "russia" ? 0x7898a2 : 0xdba96a); scene.fog = new THREE.Fog(route === "russia"?0x718b88:0xc5a276, 38, route === "russia"?175:190);
  if(route==="afghanistan"){
    new THREE.TextureLoader().load("air-battlefield-bg.png",texture=>{texture.colorSpace=THREE.SRGBColorSpace;scene.background=texture;});
  }
  camera = new THREE.PerspectiveCamera(63, 1100/700, .1, 500); camera.position.set(0,6.2,12); camera.lookAt(0,1,-25);
  scene.add(new THREE.HemisphereLight(route==="russia"?0xbad4d0:0xd59a62,route==="russia"?0x202c1d:0x261b18,route==="russia"?1.25:.62)); const sun = new THREE.DirectionalLight(route==="russia"?0xffe1a6:0xe59b58,route==="russia"?1.75:.88); sun.position.set(-20,35,15); sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(240,700), route === "russia" ? forestGroundMaterial() : desertGroundMaterial()); ground.rotation.x=-Math.PI/2; ground.position.z=-250; ground.receiveShadow=true; scene.add(ground);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(24,700), asphaltMaterial(route==="russia"?0x777b7d:0x766758)); road.rotation.x=-Math.PI/2; road.position.set(0,.025,-250); road.receiveShadow=true; scene.add(road);
  const shoulderTexture=new THREE.TextureLoader().load(route==="russia"?"maze-mud-ground.jpg":"afghan-desert-ground.png");shoulderTexture.wrapS=shoulderTexture.wrapT=THREE.RepeatWrapping;shoulderTexture.repeat.set(2,70);shoulderTexture.colorSpace=THREE.SRGBColorSpace;
  const shoulderMat=new THREE.MeshStandardMaterial({map:shoulderTexture,color:route==="russia"?0x5f5a49:0x805b3d,roughness:1});
  [-12.8,12.8].forEach(x=>{const shoulder=new THREE.Mesh(new THREE.PlaneGeometry(2.4,700),shoulderMat);shoulder.rotation.x=-Math.PI/2;shoulder.position.set(x,.035,-250);scene.add(shoulder)});
  const edgeMat = mat(0xf4f4ee,.8); [-11.65,11.65].forEach(x=>{ const e=new THREE.Mesh(new THREE.BoxGeometry(.28,.08,700),edgeMat); e.position.set(x,.09,-250); scene.add(e); });
  roadParts.length=0;
  for(let z=-340;z<20;z+=12) for(const x of [-6,0,6]) { const dash=new THREE.Mesh(new THREE.BoxGeometry(.22,.06,5.4),edgeMat); dash.position.set(x,.1,z); scene.add(dash); roadParts.push(dash); }
  trees.length=0;
  const forestRows=route==="russia"?[
    {distance:15.0,spacing:10.5,scale:.82,jitter:2.6},
    {distance:21.5,spacing:8.8,scale:1.05,jitter:3.5},
    {distance:29.0,spacing:7.6,scale:1.3,jitter:4.5},
    {distance:39.0,spacing:7.2,scale:1.55,jitter:6.0}
  ]:[];
  forestRows.forEach((row,rowIndex)=>{
    for(let z=-310;z<26;z+=row.spacing){
      for(const side of [-1,1]){
        const t=new THREE.Group();
        const type=Math.floor(Math.random()*3),front=realisticTree(type),cross=realisticTree(type);
        cross.rotation.y=Math.PI/2;t.add(front,cross);
        const scale=row.scale*(.84+Math.random()*.32);t.scale.setScalar(scale);t.rotation.y=Math.random()*Math.PI;
        t.position.set(side*(row.distance+Math.random()*row.jitter),0,z+(rowIndex%2)*3+Math.random()*3);
        scene.add(t);trees.push(t);
      }
    }
  });
  if(route==="russia"){
    const hillMaterials=[mat(0x263827,1),mat(0x314431,1),mat(0x3a4d38,1)];
    for(let z=-300;z<25;z+=38){
      for(const side of [-1,1]){
        const hill=new THREE.Mesh(new THREE.SphereGeometry(1,16,8,0,Math.PI*2,0,Math.PI/2),hillMaterials[Math.floor(Math.random()*hillMaterials.length)]);
        hill.scale.set(17+Math.random()*15,5+Math.random()*7,13+Math.random()*15);hill.position.set(side*(47+Math.random()*14),-.4,z+Math.random()*13);scene.add(hill);trees.push(hill);
      }
    }
    const rockGeometry=new THREE.DodecahedronGeometry(.48,0),rockMaterials=[mat(0x6f746b,1),mat(0x555c53,1),mat(0x817b68,1)];
    const grassMaterials=[mat(0x315f2d,1),mat(0x466f36,1),mat(0x253f25,1)];
    for(let z=-305;z<20;z+=8){
      for(const side of [-1,1]){
        if(Math.random()<.48){const rock=new THREE.Mesh(rockGeometry,rockMaterials[Math.floor(Math.random()*rockMaterials.length)]);const scale=.45+Math.random()*1.5;rock.scale.set(scale,.45+Math.random()*.55,scale);rock.rotation.set(Math.random(),Math.random()*Math.PI,Math.random()*.3);rock.position.set(side*(14.2+Math.random()*22),.18,z+Math.random()*7);scene.add(rock);trees.push(rock);}
        const bush=new THREE.Group();for(let leaf=0;leaf<4;leaf++){const materialIndex=(leaf+Math.floor(Math.abs(z)))%grassMaterials.length,crown=new THREE.Mesh(new THREE.DodecahedronGeometry(.48+Math.random()*.22,1),grassMaterials[materialIndex]);crown.position.set((Math.random()-.5)*.9,.35+Math.random()*.35,(Math.random()-.5)*.7);crown.scale.y=.65+Math.random()*.45;bush.add(crown);}bush.position.set(side*(13.2+Math.random()*15),0,z+Math.random()*6);const bushScale=.7+Math.random()*.85;bush.scale.setScalar(bushScale);scene.add(bush);trees.push(bush);
      }
    }
    const postMat=mat(0xd8d7c8,.72),reflectorMat=new THREE.MeshStandardMaterial({color:0xffd65a,emissive:0xff7a00,emissiveIntensity:1.45});
    for(let z=-310;z<20;z+=24){for(const side of [-1,1]){const post=new THREE.Group(),body=box(.18,1.15,.18,0xd8d7c8);body.position.y=.58;const reflector=box(.22,.18,.08,0xffc13d);reflector.material=reflectorMat;reflector.position.set(0,1,.06);post.add(body,reflector);post.position.set(side*12.25,0,z+(side>0?8:0));scene.add(post);trees.push(post)}}
  }else{
    const duneMaterials=[mat(0x805839,1),mat(0x9a6841,1),mat(0x6c4b36,1)];
    const cliffMaterials=[mat(0x50372d,1),mat(0x69452f,1),mat(0x43352e,1)];
    for(let z=-305;z<16;z+=24){
      for(const side of [-1,1]){
        const hill=new THREE.Mesh(new THREE.SphereGeometry(1,18,10,0,Math.PI*2,0,Math.PI/2),duneMaterials[Math.floor(Math.random()*duneMaterials.length)]);
        hill.scale.set(14+Math.random()*14,4+Math.random()*6,11+Math.random()*16);hill.position.set(side*(38+Math.random()*19),-.35,z+Math.random()*11);scene.add(hill);trees.push(hill);
        if(Math.random()<.72){const cliff=new THREE.Group();for(let part=0;part<3;part++){const rock=new THREE.Mesh(new THREE.DodecahedronGeometry(1,1),cliffMaterials[(part+Math.floor(z))%cliffMaterials.length]);rock.scale.set(3+Math.random()*4,4+Math.random()*8,3+Math.random()*5);rock.position.set((Math.random()-.5)*5,rock.scale.y*.65,(Math.random()-.5)*5);rock.rotation.set(Math.random()*.3,Math.random()*Math.PI,Math.random()*.2);cliff.add(rock);}cliff.position.set(side*(31+Math.random()*17),0,z+Math.random()*9);scene.add(cliff);trees.push(cliff);}
      }
    }
    for(let z=-270;z<-20;z+=68){
      for(const side of [-1,1]){
        const wreck=tankWreck(Math.floor(Math.random()*3));wreck.scale.setScalar(.72+Math.random()*.35);wreck.rotation.y=side<0?.28:-.28;wreck.position.x=side*(15+Math.random()*6);wreck.position.z=z+Math.random()*12;scene.add(wreck);trees.push(wreck);
      }
    }
    const ruinMat=mat(0x5b4434,1),darkRuin=mat(0x29231f,1),barrierMat=mat(0x6d665a,.95);
    for(let z=-280;z<-10;z+=72){
      for(const side of [-1,1]){
        const ruin=new THREE.Group(),width=5+Math.random()*4,height=3+Math.random()*5;
        const base=box(width,height,.7,0x5b4434);base.material=ruinMat;base.position.y=height/2;ruin.add(base);
        const tower=box(1.5,height+2,1.5,0x3f3028);tower.material=ruinMat;tower.position.set(side<0?width*.28:-width*.28,(height+2)/2,0);ruin.add(tower);
        for(let w=-1;w<=1;w+=2){const windowHole=box(.8,.9,.12,0x1d1b18);windowHole.material=darkRuin;windowHole.position.set(w*width*.25,height*.55,-.41);ruin.add(windowHole);}
        ruin.position.set(side*(25+Math.random()*14),0,z+Math.random()*13);ruin.rotation.y=side<0?.18:-.18;scene.add(ruin);trees.push(ruin);
      }
    }
    for(let z=-300;z<12;z+=32){
      for(const side of [-1,1]){
        const barrier=new THREE.Group();for(let block=0;block<3;block++){const concrete=box(1.15,.75,.75,0x6d665a);concrete.material=barrierMat;concrete.position.set(block*1.05,0.38,0);barrier.add(concrete);}barrier.position.set(side*(14.5+Math.random()*3),0,z+(side>0?11:0));barrier.rotation.y=side<0?.16:-.16;scene.add(barrier);trees.push(barrier);
      }
    }
    const smokeMat=new THREE.MeshBasicMaterial({color:0x292522,transparent:true,opacity:.32,depthWrite:false});
    for(let z=-270;z<-30;z+=78){const plume=new THREE.Group();for(let puff=0;puff<7;puff++){const smoke=new THREE.Mesh(new THREE.SphereGeometry(1.2+puff*.32,10,8),smokeMat);smoke.position.set((Math.random()-.5)*1.5,2+puff*2.1,(Math.random()-.5)*1.4);plume.add(smoke);}plume.position.set((Math.random()<.5?-1:1)*(30+Math.random()*24),0,z+Math.random()*18);scene.add(plume);trees.push(plume);}
  }
  truck=makeCanvasTruck(); truck.position.set(0,0,0); scene.add(truck);
  enemy=new THREE.Group(); const enemyBase=makeTruck(0x25282d,true); enemyBase.visible=false; enemy.add(enemyBase); enemy.add(vehicleCard("enemy-vehicle-cartoon.png",4.9,4.9)); enemy.position.set(0,0,-42); scene.add(enemy);
}
function addPickupGlow(group,color){
  const disc=new THREE.Mesh(new THREE.CylinderGeometry(1.18,1.28,.14,28),new THREE.MeshStandardMaterial({color:0x20282b,metalness:.72,roughness:.28}));disc.position.y=-.82;group.add(disc);
  const ring=new THREE.Mesh(new THREE.TorusGeometry(1.08,.075,10,32),new THREE.MeshBasicMaterial({color}));ring.rotation.x=Math.PI/2;ring.position.y=-.7;group.add(ring);
  const beam=new THREE.Mesh(new THREE.CylinderGeometry(.62,.95,2.8,20,1,true),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.11,side:THREE.DoubleSide,depthWrite:false}));beam.position.y=.42;group.add(beam);
}
function makeJerrycan(){
  const group=new THREE.Group(),red=new THREE.MeshStandardMaterial({color:0xa8241d,roughness:.43,metalness:.35}),dark=mat(0x1b1e1f,.48,.65),ridge=mat(0x671914,.62,.22);
  const body=new THREE.Mesh(new THREE.BoxGeometry(1.05,1.32,.42),red);group.add(body);
  [-1,1].forEach(direction=>{const rib=box(.09,1.02,.05,0x671914);rib.material=ridge;rib.rotation.z=direction*.58;rib.position.z=.235;group.add(rib)});
  const handle=new THREE.Mesh(new THREE.TorusGeometry(.29,.075,8,20,Math.PI),dark);handle.position.set(-.08,.76,0);group.add(handle);
  const neck=box(.25,.22,.28,0xa8241d);neck.material=red;neck.position.set(.33,.75,0);group.add(neck);
  const cap=new THREE.Mesh(new THREE.CylinderGeometry(.13,.13,.2,12),dark);cap.rotation.z=Math.PI/2;cap.position.set(.43,.88,0);group.add(cap);return group;
}
function makeMedkit(){
  const group=new THREE.Group(),red=new THREE.MeshStandardMaterial({color:0xb52b25,roughness:.38,metalness:.25}),white=new THREE.MeshBasicMaterial({color:0xffffff});
  const body=new THREE.Mesh(new THREE.BoxGeometry(1.28,1,.42),red);group.add(body);
  const handle=new THREE.Mesh(new THREE.TorusGeometry(.27,.065,8,18,Math.PI),red);handle.position.y=.58;group.add(handle);
  const vertical=box(.22,.66,.06,0xffffff),horizontal=box(.66,.22,.06,0xffffff);vertical.material=horizontal.material=white;vertical.position.z=horizontal.position.z=.24;group.add(vertical,horizontal);return group;
}
function makeNitro(){
  const group=new THREE.Group(),blue=new THREE.MeshStandardMaterial({color:0x168eb8,emissive:0x075c80,emissiveIntensity:.65,roughness:.25,metalness:.6}),steel=mat(0xc7d3d6,.25,.82),white=new THREE.MeshBasicMaterial({color:0xeaffff});
  const bottle=new THREE.Mesh(new THREE.CylinderGeometry(.4,.43,1.25,18),blue);group.add(bottle);
  const shoulder=new THREE.Mesh(new THREE.ConeGeometry(.4,.3,18),blue);shoulder.position.y=.76;group.add(shoulder);
  const valve=new THREE.Mesh(new THREE.CylinderGeometry(.14,.14,.25,12),steel);valve.position.y=.98;group.add(valve);
  const boltA=box(.17,.62,.055,0xffffff),boltB=box(.17,.5,.055,0xffffff);boltA.material=boltB.material=white;boltA.rotation.z=-.46;boltB.rotation.z=.46;boltA.position.set(-.1,.12,.44);boltB.position.set(.1,-.18,.44);group.add(boltA,boltB);return group;
}
function spawnBonus(forcedType="") {
  const roll=Math.random(),type=forcedType||(roll<.22?"life":roll<.44?"speed":roll<.64?"fuel":roll<.76?"ammo":roll<.88?"weapon":"grenade"), g=new THREE.Group();
  if(["ammo","weapon","grenade"].includes(type)){
    const files={ammo:"ammo-crate.png",weapon:"weapon-crate.png",grenade:"grenade-crate.png"};
    const texture=new THREE.TextureLoader().load(files[type]);texture.colorSpace=THREE.SRGBColorSpace;
    const material=new THREE.MeshBasicMaterial({map:texture,transparent:true,alphaTest:.08,side:THREE.DoubleSide});
    const card=new THREE.Mesh(new THREE.PlaneGeometry(2.45,2.45),material);card.position.y=.2;g.add(card);addPickupGlow(g,type==="ammo"?0xff9a4f:type==="weapon"?0xffd95b:0x6ce879);
    g.userData.kind=type;g.userData.baseY=1.25;g.userData.phase=Math.random()*Math.PI*2;g.position.set([-8,-3,3,8][Math.floor(Math.random()*4)],1.25,-72);scene.add(g);bonuses.push(g);return;
  }
  const color=type==="life"?0x48ff72:type==="speed"?0x38dcff:0xff5948,item=type==="life"?makeMedkit():type==="speed"?makeNitro():makeJerrycan();item.position.y=.1;g.add(item);addPickupGlow(g,color);
  g.userData.kind=type;g.userData.baseY=1.35;g.userData.phase=Math.random()*Math.PI*2;g.position.set([-8,-3,3,8][Math.floor(Math.random()*4)],1.35,-72);scene.add(g);bonuses.push(g);
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
  for(let i=bonuses.length-1;i>=0;i--){const b=bonuses[i];b.position.z+=visualSpeed*dt;b.rotation.y+=dt*1.35;b.position.y=b.userData.baseY+Math.sin(now*.003+b.userData.phase)*.16;if(b.position.z>1){if(Math.abs(b.position.x-truck.position.x)<2){if(b.userData.kind==="life")lives=Math.min(3,lives+1);if(b.userData.kind==="speed"){speedBoostCount+=1;speedBoostUntil=now+5000;speed=Math.min(42+speedBoostCount*2,speed+2);}if(b.userData.kind==="fuel")fuel=Math.min(1,fuel+1/3);if(crateCounts[b.userData.kind]!==undefined){crateCounts[b.userData.kind]++;const counter=document.querySelector(`[data-crate-count="${b.userData.kind}"]`);if(counter)counter.textContent=String(crateCounts[b.userData.kind]);const stock=JSON.parse(localStorage.getItem("notWeaponStock")||'{"weapon":0,"grenade":0,"ammo":0}');stock[b.userData.kind]=(stock[b.userData.kind]||0)+1;localStorage.setItem("notWeaponStock",JSON.stringify(stock));}updateLives();}scene.remove(b);bonuses.splice(i,1);}}
  const kmh=Math.round(speed*5);const speedDial=Math.max(0,Math.min(1,(kmh-100)/150));document.getElementById("speed-value").firstChild.nodeValue=String(kmh);document.getElementById("speed-needle").style.transform=`rotate(${speedDial*180}deg)`;document.getElementById("fuel-needle").style.transform=`rotate(${-180+fuel*180}deg)`;document.getElementById("fuel-arc").style.setProperty("--fuel-angle",`${fuel*180}deg`);
  window.GameAudio?.setTruckSpeed(speed / 42);
  renderer.render(scene,camera); frame=requestAnimationFrame(animate);
}
function updateLives(){
  document.getElementById("transport-lives").textContent="❤️".repeat(Math.max(0,lives))+"🖤".repeat(Math.max(0,3-lives));
  if(lives<=0&&running){
    running=false;
    window.GameAudio?.stop();
    if(frame)cancelAnimationFrame(frame);
    document.getElementById("transport-result-title").textContent="Груз потерян";
    document.getElementById("transport-result").classList.remove("hidden");
  }
}
window.addEventListener("keydown",e=>{keys[e.code]=true;if(running&&e.code.startsWith("Arrow"))e.preventDefault();}); window.addEventListener("keyup",e=>keys[e.code]=false);
window.Transport3D={start(route){this.stop();bullets.length=0;bonuses.length=0;activeRoute=route;resetCanvas();buildWorld(route);running=true;speed=15;playerX=0;lives=3;shotClock=0;bonusClock=0;damageCooldown=0;speedBoostCount=0;speedBoostUntil=0;fuel=1;crateCounts={ammo:0,weapon:0,grenade:0};document.querySelectorAll("[data-crate-count]").forEach(el=>el.textContent="0");spawnBonus("fuel");bonuses[0].position.z=-42;updateLives();window.GameAudio?.playMode("transport");animate.last=performance.now();frame=requestAnimationFrame(animate);},stop(){running=false;window.GameAudio?.stop();if(frame)cancelAnimationFrame(frame);if(renderer)renderer.dispose();},isRunning(){return running;}};
})();
