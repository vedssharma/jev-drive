import * as THREE from '/vendor/three.module.js';
import {worldPoint, junctionSignal, turnGeometry, turnPose} from './network.js';

export class CityRenderer {
  constructor(container, sim) {
    this.sim = sim; this.container = container; this.view = 0; this.materials = new Map(); this.actorMeshes = new Map();
    this.scene = new THREE.Scene();
    this.renderer = new THREE.WebGLRenderer({antialias: true, powerPreference: 'high-performance'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.25;
    container.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(43, 1, .3, 650);
    this.camera.position.set(35, 37, 47);
    this.ambient = new THREE.HemisphereLight(0xe5f4ee, 0x83968a, 2.5); this.scene.add(this.ambient);
    this.sun = new THREE.DirectionalLight(0xfff3d6, 3); this.sun.position.set(-45,80,35);
    this.sun.castShadow = true; this.sun.shadow.mapSize.set(2048,2048);
    Object.assign(this.sun.shadow.camera, {left:-80,right:80,top:80,bottom:-100,far:200});
    this.sun.shadow.bias = -.0003; this.sun.shadow.normalBias = .05; this.scene.add(this.sun);
    this.boxGeometry = new THREE.BoxGeometry(1,1,1);
    this.wheelGeometry = new THREE.CylinderGeometry(.36,.36,.25,12);
    this.wheelGeometry.rotateZ(Math.PI/2);
    this.crownGeometry = new THREE.IcosahedronGeometry(1,1);
    this.poleGeometry = new THREE.CylinderGeometry(.08,.08,1,6);
    this.scene.add(this.box(0,-.8,0,1500,1,1500,0xb9cdb8));
    this.tiles = [];
    for (let i = 0; i < 25; i++) this.tiles.push(this.makeTile(i));
    this.ego = this.car(0xa4e6be, true); this.scene.add(this.ego);
    this.headlight = new THREE.SpotLight(0xecffdc, 70, 65, .48, .65, 1.4);
    this.headlight.position.set(6,1.3,-2); this.headlight.target.position.set(6,0,-40);
    this.scene.add(this.headlight, this.headlight.target);
    this.path = new THREE.Group();
    for (let i = 0; i < 24; i++) {
      const dot = this.box(0,.07,-i*2.1, .18,.04,1,0x96edc6); this.path.add(dot);
    }
    this.scene.add(this.path);
    const ringGeometry = new THREE.RingGeometry(7.9,8,80);
    this.ring = new THREE.Mesh(ringGeometry,new THREE.MeshBasicMaterial({color:0x91d7b8,transparent:true,opacity:.5,side:THREE.DoubleSide}));
    this.ring.rotation.x=-Math.PI/2; this.ring.position.y=.08; this.scene.add(this.ring);
    this.particlePositions = new Float32Array(1700*3);
    for (let i=0;i<1700;i++) {this.particlePositions[i*3]=(Math.random()-.5)*130;this.particlePositions[i*3+1]=Math.random()*50;this.particlePositions[i*3+2]=(Math.random()-.6)*130;}
    this.particleGeometry = new THREE.BufferGeometry(); this.particleGeometry.setAttribute('position',new THREE.BufferAttribute(this.particlePositions,3));
    this.particleMaterial = new THREE.PointsMaterial({color:0xe6f4fb,size:.12,transparent:true,opacity:.6});
    this.particles = new THREE.Points(this.particleGeometry,this.particleMaterial); this.scene.add(this.particles);
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(container); this.resize();
  }
  material(color, emissive = false) {
    const key = `${color}-${emissive}`;
    if (!this.materials.has(key)) this.materials.set(key,new THREE.MeshStandardMaterial({color, roughness: .8,
      ...(emissive ? {emissive:color,emissiveIntensity:.45} : {})}));
    return this.materials.get(key);
  }
  box(x,y,z,w,h,d,color,parent=null,emissive=false) {
    const mesh = new THREE.Mesh(this.boxGeometry,this.material(color,emissive));
    mesh.position.set(x,y,z);mesh.scale.set(w,h,d);mesh.castShadow=h>.3;mesh.receiveShadow=true;
    if(parent)parent.add(mesh);return mesh;
  }
  car(color, ego=false, ambulance=false) {
    const group = new THREE.Group();
    this.box(0,.65,0,1.85,.65,4.2,color,group);
    this.box(0,1.14,.1,1.58,.57,2.15,color,group);
    this.box(0,1.19,-.83,1.48,.45,.12,0x334b49,group).rotation.x=.2;
    this.box(0,1.2,1.12,1.43,.4,.12,0x334b49,group).rotation.x=-.2;
    this.box(0,1.46,.12,1.4,.05,1.65,0x3d5854,group);
    for(const x of [-.81,.81]) this.box(x,1.2,.12,.04,.36,1.65,0x37534e,group);
    for(const x of [-.61,.61]) {
      this.box(x,.69,-2.12,.42,.17,.06,0xf1fbd0,group,true);
      const tail=this.box(x,.72,2.12,.45,.14,.07,0xc96953,group,true);
      if(!group.userData.tails)group.userData.tails=[];group.userData.tails.push(tail);
    }
    for(const x of [-.94,.94])for(const z of [-1.28,1.29]) {
      const wheel=new THREE.Mesh(this.wheelGeometry,this.material(0x26322f));wheel.position.set(x,.4,z);group.add(wheel);
    }
    if(ego) {
      this.box(0,1.57,.1,.48,.18,.55,0xf0f6e9,group);
      this.box(0,1.71,.1,.32,.13,.32,0x40584f,group);
    }
    if(ambulance){this.box(0,1.6,.1,1.4,.19,.4,0x517daf,group,true);this.box(0,1.61,.1,.3,.2,.41,0xff695c,group,true);}
    return group;
  }
  tree(parent,x,z,size=1) {
    this.box(x,1.1,z,.28,2.2,.28,0x8f9580,parent);
    const crown=new THREE.Mesh(this.crownGeometry,this.material([0x779b78,0x87aa80,0x9bb388][Math.abs(Math.round(x+z))%3]));
    crown.position.set(x,3.6*size,z);crown.scale.set(2*size,2.5*size,2*size);crown.castShadow=true;parent.add(crown);
  }
  makeTile(index) {
    const group=new THREE.Group();this.scene.add(group);
    this.box(0,-.15,0,17,.3,160,0x7a8988,group);
    for(const x of [-10.8,10.8])for(const z of [-47,47])this.box(x,.03,z,4.5,.38,66,0xd9dfd0,group);
    for(const z of [-10.8,10.8])for(const x of [-47,47])this.box(x,.03,z,66,.38,4.5,0xd9dfd0,group);
    for(const x of [-8.5,8.5])for(const z of [-47,47])this.box(x,.2,z,.18,.3,66,0xedeee1,group);
    for(const z of [-8.5,8.5])for(const x of [-47,47])this.box(x,.2,z,66,.3,.18,0xedeee1,group);
    for(const x of [-.13,.13])this.box(x,.025,0,.085,.035,160,0xe7d49c,group);
    for(const z of Array.from({length:20},(_,i)=>i*8-76))for(const x of [-4,4]) {
      if(Math.abs(z)>11)this.box(x,.03,z,.1,.035,3,0xe4e8de,group);
    }
    this.box(0,-.08,0,160,.25,17,0x7a8988,group);
    this.box(0,.02,0,28,.08,28,0x7a8988,group);
    for(const z of [-.13,.13])for(const x of [-47,47])this.box(x,.06,z,66,.03,.085,0xe7d49c,group);
    this.box(-14,.08,4,.3,.04,7.5,0xf3f1dd,group);
    this.box(14,.08,-4,.3,.04,7.5,0xf3f1dd,group);
    for(const x of [-10.2,10.2])for(let n=-7;n<=7;n++)this.box(x,.085,n,3.1,.025,.5,0xe8ecdf,group);
    for(const x of [-1,1])for(const z of [-10.2,10.2]) {
      for(let n=0;n<7;n++)this.box(x*(n+ .7),.085,z,.5,.035,3.1,0xe8ecdf,group);
    }
    this.box(4,.085,14,7.5,.04,.3,0xf3f1dd,group);
    this.box(-4,.085,-14,7.5,.04,.3,0xf3f1dd,group);
    for(let n=-5;n<=5;n++)if(Math.abs(n)>1)for(const z of [-4,4])this.box(n*10,.07,z,4,.04,.12,0xcbd5cf,group);
    const signals=[];
    for(const axis of [0,1])for(const sign of [-1,1]) {
      const signalGroup=new THREE.Group();signalGroup.rotation.y=-axis*Math.PI/2;group.add(signalGroup);
      const x=sign*9.3,z=sign*14;
      this.box(x,2.7,z,.16,5.4,.16,0x5c7064,signalGroup);
      this.box(x-sign*2.4,5.35,z,4.8,.16,.16,0x5c7064,signalGroup);
      this.box(x-sign*4.6,4.9,z,.65,1.4,.35,0x33463e,signalGroup);
      const lights=[];
      for(let l=0;l<3;l++){
        const light=this.box(x-sign*4.6,5.3-l*.4,z+sign*.2,.29,.29,.05,0x526457,signalGroup,true);lights.push(light);
      }
      signals.push({axis,lights});
    }
    // Blocks, small storefronts and planted courtyards.
    const heights=[10,18,8,24,12,16];const colors=[0xd3d7c5,0xe1dcc8,0xc0ccc3,0xb6c6bc,0xe0d5c3,0xc8d0c2];
    for(const side of [-1,1])for(let j=0;j<4;j++){
      const z=-62+j*37;
      if(Math.abs(z)<20)continue;
      const h=heights[(index+j+(side>0?2:0))%6],x=side*(24+(j%2)*3);
      this.box(x,h/2+.2,z,18,h,24,colors[(index+j)%6],group);
      this.box(x,h+.45,z,18.5,.5,24.5,0xe1e4d6,group);
      this.box(x,h+.9,z+4,5,1,6,0xb1c0b0,group);
      for(let floor=2;floor<h-1;floor+=3.3)for(let col=-8;col<10;col+=6)
        this.box(x-side*9.03,floor,z+col,.06,1.45,2.5,0x8faaa0,group,true);
      if(j%2===0){
        this.box(x-side*9.2,2,z,1.2,.25,16,side>0?0x91aa8c:0xc6a58c,group);
        for(let c=-6;c<=6;c+=4)this.box(x-side*9.07,1,z+c,.05,1.6,2.6,0x6d8c82,group);
      }
      this.tree(group,side*12,z+9,.85);this.tree(group,side*12,z-10,.9);
      this.box(side*11.6,.6,z, .6,.12,2,0x9d947d,group);
    }
    for(const side of [-1,1])for(const z of [-35,35,70]){
      this.box(side*8.9,3,z,.09,6,.09,0x7f9284,group);
      this.box(side*8.25,6,z,1.4,.12,.3,0x6e8375,group);
      this.box(side*7.8,5.9,z,.5,.08,.28,0xf7f2c4,group,true);
    }
    // Roadside speed sign and green avenue placard.
    this.box(9.6,1.4,-37,.08,2.8,.08,0x869a8b,group);
    this.box(9.6,2.4,-37,.9,1,.08,0xf8f6e6,group);
    this.box(-10,4,-14,4,.65,.1,0x638c79,group);
    return {group,index,signals,center:0};
  }
  pedestrian() {
    const g=new THREE.Group();
    this.box(0,.87,0,.45,.62,.28,0xd69b6f,g);
    const head=new THREE.Mesh(this.crownGeometry,this.material(0xd8bd9b));head.scale.set(.2,.22,.2);head.position.y=1.42;g.add(head);
    for(const x of [-.13,.13])this.box(x,.33,0,.14,.6,.16,0x4d665d,g);
    return g;
  }
  obstacle() {
    const g=new THREE.Group();this.box(0,.9,0,2.6,.8,.35,0xe2a66b,g);
    for(const x of [-.85,0,.85])this.box(x,.91,-.19,.35,.7,.02,0xf5e9ca,g).rotation.z=-.4;
    for(const x of [-1,1])this.box(x,.4,0,.15,.8,.7,0x9b9f89,g);
    return g;
  }
  syncActors() {
    const entities=[...this.sim.vehicles.map(v=>({...v,type:'car'})),...this.sim.pedestrians.map(p=>({...p,type:'pedestrian'})),
      ...this.sim.obstacles.map(o=>({...o,type:'obstacle'}))];
    const ids=new Set(entities.map(e=>e.id));
    for(const [id,m] of this.actorMeshes)if(!ids.has(id)){this.scene.remove(m);this.actorMeshes.delete(id);}
    for(const e of entities){
      let m=this.actorMeshes.get(e.id);
      if(!m){m=e.type==='pedestrian'?this.pedestrian():e.type==='obstacle'?this.obstacle():this.car(e.kind==='ambulance'?0xf1eedd:[0xe0c39d,0x96b5ae,0xb4aaa0,0xccdad2,0x727e82][e.color||0],false,e.kind==='ambulance');this.actorMeshes.set(e.id,m);this.scene.add(m);}
      const p=this.sim.actorPose(e),ego=this.sim.pose;
      m.position.set(p.east-ego.east,0,-(p.north-ego.north));
      m.rotation.y=-p.heading+(e.type==='pedestrian'?Math.PI/2:0);
      if(e.type==='pedestrian')m.position.y=Math.sin(this.sim.time*10+e.id)*.035;
    }
  }
  resize() {const w=this.container.clientWidth,h=this.container.clientHeight;this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.renderer.setSize(w,h);}
  egoScreenPosition() {
    const point=new THREE.Vector3(0,3.4,0).project(this.camera);
    return {x:(point.x+1)/2*this.container.clientWidth,y:(1-point.y)/2*this.container.clientHeight};
  }
  render(dt) {
    const s=this.sim,weather=s.weather,night=s.night;
    const fogColor=night?0x1d3438:weather==='fog'?0xc6d3ce:weather==='rain'?0xa7beb6:weather==='snow'?0xd7e0dc:0xd3e4dc;
    this.scene.background=new THREE.Color(fogColor);
    const far=weather==='fog'?100:weather==='snow'?180:weather==='rain'?230:390;
    this.scene.fog=new THREE.Fog(fogColor,weather==='fog'?18:75,far);
    this.sun.intensity=night?.2:weather==='clear'?3:1.1;
    this.ambient.intensity=night?.65:2.2;this.headlight.intensity=night?100:0;
    for(const mat of this.materials.values())if(mat.emissiveIntensity)mat.emissiveIntensity=night?1.3:.18;
    const ego=s.pose,ix=Math.round(ego.east/160),iy=Math.round((ego.north-100)/160);
    for(let i=0;i<this.tiles.length;i++){
      const tile=this.tiles[i],point={east:(ix+i%5-2)*160,north:100+(iy+Math.floor(i/5)-2)*160};
      tile.group.position.set(point.east-ego.east,0,-(point.north-ego.north));
      for(const {axis,lights} of tile.signals){
        const sig=junctionSignal(point,axis,s.time,s.override);
        for(let l=0;l<3;l++)lights[l].material=this.material(l===({red:0,amber:1,green:2}[sig.color])?[0xeb7764,0xf6c967,0x89e6a5][l]:0x40534b,true);
      }
    }
    this.ego.position.set(0,0,0);this.ego.rotation.y=-ego.heading-(s.turn?0:(s.targetLane*4+2-s.x)*.035);
    for(const tail of this.ego.userData.tails)tail.material=this.material(s.targetSpeed<s.speed||s.intervention?0xff574b:0xb46c5b,true);
    const forward=new THREE.Vector3(Math.sin(ego.heading),0,-Math.cos(ego.heading));
    const right=new THREE.Vector3(Math.cos(ego.heading),0,Math.sin(ego.heading));
    this.headlight.position.copy(forward.clone().multiplyScalar(2));this.headlight.position.y=1.3;
    this.headlight.target.position.copy(forward.clone().multiplyScalar(40));
    this.path.children.forEach((dot,i)=>{
      const distance=i*2.1;
      let point=worldPoint(s.frame,s.targetLane*4+2,s.s+distance),angle=s.frame.heading*Math.PI/2;
      const turn=s.turn||(s.plan&&s.plan.direction!=='straight'?turnGeometry(s.frame,s.plan.center,s.plan.direction):null);
      if(turn){
        const progress=s.turn?turn.progress+distance:distance-(turn.center-14-s.s);
        if(progress>=0){
          if(progress<=turn.length){const p=turnPose(turn,progress);point=p;angle=p.heading;}
          else {point=worldPoint(turn.exitFrame,turn.lane*4+2,14+progress-turn.length);angle=turn.exitFrame.heading*Math.PI/2;}
        }
      }
      dot.position.set(point.east-ego.east,.09,-(point.north-ego.north));dot.rotation.y=-angle;
      dot.visible=distance<Math.max(18,s.speed*4);
    });
    this.ring.visible=this.view!==2;this.path.visible=this.view!==2;
    this.syncActors();
    const position=this.view===0?right.clone().multiplyScalar(22).addScaledVector(forward,-42):this.view===1?new THREE.Vector3(0,90,25):forward.clone().multiplyScalar(-.3);
    position.y=this.view===0?46:this.view===1?90:2.5;
    this.camera.position.lerp(position,1-Math.exp(-dt*4));
    const look=this.view===1?new THREE.Vector3(0,0,-10):forward.clone().multiplyScalar(this.view===2?60:10);
    this.camera.lookAt(look);
    this.ego.visible=this.view!==2;
    this.particles.visible=weather==='rain'||weather==='snow';
    if(this.particles.visible){
      this.particleMaterial.size=weather==='snow'?.23:.09;
      const speed=weather==='rain'?35:3;
      for(let i=0;i<this.particlePositions.length;i+=3){
        this.particlePositions[i+1]-=dt*speed;
        this.particlePositions[i]+=dt*(weather==='snow'?.5:2);
        this.particlePositions[i+2]+=dt*s.speed;
        if(this.particlePositions[i+1]<0)this.particlePositions[i+1]=50;
        if(this.particlePositions[i+2]>60)this.particlePositions[i+2]=-70;
        if(this.particlePositions[i]>65)this.particlePositions[i]=-65;
      }
      this.particleGeometry.attributes.position.needsUpdate=true;
    }
    this.renderer.render(this.scene,this.camera);
  }
}
