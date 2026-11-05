import type { Point } from '../domain/operations';
import { advanceConveyor } from '../utils/conveyor';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import gsap from 'gsap';
import type { StorageSlot } from '../stores/warehouse';

interface AgvTrail {
  line: THREE.Line;
  positions: Float32Array;
  maxPoints: number;
}

interface AlarmVisual {
  ring: THREE.Mesh;
  light: THREE.PointLight;
  active: boolean;
}

interface LidarVisual {
  fan: THREE.Mesh;
  beam: THREE.Line;
}

export type PoiKey = 'RACK' | 'CHARGER' | 'CONVEYOR';

interface PoiConfig {
  name: string;
  tag: string;
  position: THREE.Vector3;
  cameraPos: THREE.Vector3;
  targetPos: THREE.Vector3;
}

export type CameraViewMode = 'OVERVIEW' | 'FOCUS' | 'FPV' | 'TOUR';

export class SceneManager {
  private container: HTMLElement;
  private onSelect: (id: string | null) => void;
  private onSlotClick: (slotId: string) => void;

  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private labelRenderer!: CSS2DRenderer;
  private controls!: OrbitControls;

  private composer!: EffectComposer;
  private bloomPass!: UnrealBloomPass;

  private heatmapMesh!: THREE.Mesh;
  private ambientLight!: THREE.AmbientLight;
  private dirLight!: THREE.DirectionalLight;
  private floorMesh!: THREE.Mesh;

  private agvMeshes = new Map<string, THREE.Group>();
  private targetPositions = new Map<string, THREE.Vector3>();
  private targetRotations = new Map<string, number>();

  private agvPayloadMeshes = new Map<string, THREE.Mesh>();
  private mixers: THREE.AnimationMixer[] = [];

  // 立库合批渲染属性
  private slotInstancedMesh!: THREE.InstancedMesh;
  private slotIdToIndex = new Map<string, number>();
  private indexToSlotId = new Map<number, string>();
  private dummyTransform = new THREE.Object3D();

  private alarmVisuals = new Map<string, AlarmVisual>();
  private lidarVisuals = new Map<string, LidarVisual>();

  // 两车动态安全间距指示线
  private safetyDistanceLine!: THREE.Line;

  private chargingStationPos = new THREE.Vector3(-4.5, 0, 2.0);
  private chargingAgvs = new Set<string>();

  private conveyorTexture!: THREE.CanvasTexture;
  private conveyorBoxes: { id?: string; mesh: THREE.Mesh; startZ: number; currentZ: number }[] = [];
  private envRadarRing!: THREE.Mesh;

  private viewMode: CameraViewMode = 'OVERVIEW';
  private currentAgvId: string | null = null;
  private isCameraTweening: boolean = false;
  private isAutoTouring: boolean = false;
  private tourStep: number = 0;
  private tourTimeline: gsap.core.Timeline | null = null;

  private defaultCameraPos = new THREE.Vector3(7, 6, 8);
  private defaultControlsTarget = new THREE.Vector3(0, 0.5, 0);

  // 电子围栏 3D 视觉元素
  private geofenceMesh!: THREE.Mesh;
  private geofenceActive: boolean = false;

  private waypoints = [
    { cam: new THREE.Vector3(7, 6, 8), target: new THREE.Vector3(0, 0.5, 0), dur: 4 },
    { cam: new THREE.Vector3(-4.5, 2.8, -0.5), target: new THREE.Vector3(-2, 1.2, -2), dur: 4 },
    { cam: new THREE.Vector3(1.5, 3.2, 3.5), target: new THREE.Vector3(3.5, 0.5, 1.0), dur: 4 },
    { cam: new THREE.Vector3(2.5, 2.0, -1.0), target: new THREE.Vector3(0, 0.4, 0), dur: 4 }
  ];

  private trails = new Map<string, AgvTrail>();
  private lastRecordedPos = new Map<string, THREE.Vector3>();
  private labelElements = new Map<string, HTMLElement>();

  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private animId: number = 0;
  private clock = new THREE.Clock();

  // 出货输送线光电传感器光束与状态
  private photoSensorBeam!: THREE.Line;
  private routeLines = new Map<string, THREE.Line>();
  private liftMasts = new Map<string, THREE.Mesh>();
  private liftPlatforms = new Map<string, THREE.Mesh>();
  private conveyorAuthoritative = false;
  public authoritativePose = false;
  private disposed = false;
  private clickHandler: ((event: MouseEvent) => void) | null = null;
  private onConveyorPass?: () => void;

  private poiGroup: THREE.Group = new THREE.Group();
  private poiConfigs: Record<PoiKey, PoiConfig> = {
    RACK: {
      name: '智能高位立体仓库',
      tag: '12 单元储位 / 自动化分拣',
      position: new THREE.Vector3(-1.0, 3.2, -1.8),
      cameraPos: new THREE.Vector3(-1.0, 4.0, 3.5),
      targetPos: new THREE.Vector3(-1.0, 1.2, -1.8)
    },
    CHARGER: {
      name: 'AGV 智能快充基站',
      tag: 'DC 48V / 自动对接桩',
      position: new THREE.Vector3(-3.2, 1.8, 0.0),
      cameraPos: new THREE.Vector3(-1.5, 2.5, 2.0),
      targetPos: new THREE.Vector3(-3.2, 0.8, 0.0)
    },
    CONVEYOR: {
      name: '出货滚筒流水线',
      tag: '变频传动 / 光电测距',
      position: new THREE.Vector3(1.8, 1.6, -1.0),
      cameraPos: new THREE.Vector3(0.5, 3.0, 1.5),
      targetPos: new THREE.Vector3(1.8, 0.5, -1.0)
    }
  };

  constructor(
    container: HTMLElement,
    onSelect: (id: string | null) => void,
    onSlotClick: (slotId: string) => void,
    onConveyorPass?: () => void
  ) {
    this.container = container;
    this.onSelect = onSelect;
    this.onSlotClick = onSlotClick;
    this.onConveyorPass = onConveyorPass;
    this.initScene();
    this.setupPostProcessing();
    this.buildWarehouseEnvironment();
    this.setupEvents();
    this.startLoop();
  }

  private initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07090e);
    this.scene.fog = new THREE.FogExp2(0x07090e, 0.035);

    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;

    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 500);
    this.camera.position.copy(this.defaultCameraPos);

    try {
      this.renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: 'high-performance',
        failIfMajorPerformanceCaveat: false
      });
    } catch (e) {
      console.error('WebGL 初始化失败', e);
      return;
    }

    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.toneMapping = THREE.ReinhardToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    this.container.appendChild(this.renderer.domElement);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(width, height);
    this.labelRenderer.domElement.style.position = 'absolute';
    this.labelRenderer.domElement.style.top = '0';
    this.labelRenderer.domElement.style.left = '0';
    this.labelRenderer.domElement.style.pointerEvents = 'none';
    this.labelRenderer.domElement.style.zIndex = '5';
    this.container.appendChild(this.labelRenderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.target.copy(this.defaultControlsTarget);

    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    this.dirLight = new THREE.DirectionalLight(0xe2e8f0, 1.4);
    this.dirLight.position.set(8, 12, 6);
    this.dirLight.castShadow = true;
    this.scene.add(this.ambientLight, this.dirLight);

    this.scene.add(this.poiGroup);
    this.createSpatialPoiMarkers();

    // 初始化两车间距激光虚线
    const distGeo = new THREE.BufferGeometry();
    distGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const distMat = new THREE.LineDashedMaterial({
      color: 0x10b981,
      dashSize: 0.2,
      gapSize: 0.1,
      transparent: true,
      opacity: 0.7
    });
    this.safetyDistanceLine = new THREE.Line(distGeo, distMat);
    this.safetyDistanceLine.computeLineDistances();
    this.scene.add(this.safetyDistanceLine);


    // 1. 立体圆柱光墙（半透明发光，带高度）
    const fenceGeo = new THREE.CylinderGeometry(2.0, 2.0, 1.6, 32, 1, true);
    const fenceMat = new THREE.MeshBasicMaterial({
      color: 0xef4444,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.geofenceMesh = new THREE.Mesh(fenceGeo, fenceMat);
    this.geofenceMesh.position.set(-0.2, 0.8, -0.2); // 高度中心抬高到 0.8m

    // 2. 顶部与底部的高亮激光锁边环（相对父级 geofenceMesh 定位）
    const edgeRingGeo = new THREE.RingGeometry(1.98, 2.02, 32);
    const edgeRingMat = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    
    // 底部环（相对于中心 y=0.8，向下偏移 0.79m 即接近地面 0.01m）
    const bottomRing = new THREE.Mesh(edgeRingGeo, edgeRingMat);
    bottomRing.rotation.x = -Math.PI / 2;
    bottomRing.position.set(0, -0.79, 0);

    // 顶部环（向上偏移 0.8m 即达到顶部高度 1.6m）
    const topRing = new THREE.Mesh(edgeRingGeo, edgeRingMat.clone());
    topRing.rotation.x = -Math.PI / 2;
    topRing.position.set(0, 0.8, 0);

    this.geofenceMesh.add(bottomRing, topRing);
    this.scene.add(this.geofenceMesh);
    
  }

  private createSpatialPoiMarkers() {
    Object.entries(this.poiConfigs).forEach(([key, cfg]) => {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 120;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(10, 10, 300, 100, 12);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 24px monospace';
      ctx.fillText(cfg.name, 26, 48);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '18px monospace';
      ctx.fillText(cfg.tag, 26, 85);

      const texture = new THREE.CanvasTexture(canvas);
      const spriteMat = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false
      });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.position.copy(cfg.position);
      sprite.scale.set(1.6, 0.6, 1.0);
      sprite.userData = { key, baseY: cfg.position.y };
      this.poiGroup.add(sprite);
    });
  }

  public flyToPoi(poi: PoiKey, onComplete?: () => void) {
    const target = this.poiConfigs[poi];
    if (!target) return;

    this.stopAutoTour();
    this.controls.enabled = true;
    this.isCameraTweening = true;

    gsap.to(this.camera.position, {
      x: target.cameraPos.x,
      y: target.cameraPos.y,
      z: target.cameraPos.z,
      duration: 1.5,
      ease: 'power2.inOut'
    });

    gsap.to(this.controls.target, {
      x: target.targetPos.x,
      y: target.targetPos.y,
      z: target.targetPos.z,
      duration: 1.5,
      ease: 'power2.inOut',
      onComplete: () => {
        this.isCameraTweening = false;
        if (onComplete) onComplete();
      }
    });
  }

  private setupPostProcessing() {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;

    const renderScene = new RenderPass(this.scene, this.camera);
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 0.65, 0.4, 0.22);

    const outputPass = new OutputPass();
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(renderScene);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(outputPass);
  }

  private createWarningStripeTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#eab308';
    ctx.fillRect(0, 0, 128, 128);

    ctx.fillStyle = '#111827';
    ctx.beginPath();
    for (let i = -128; i < 256; i += 32) {
      ctx.moveTo(i, 0);
      ctx.lineTo(i + 16, 0);
      ctx.lineTo(i + 16 + 128, 128);
      ctx.lineTo(i + 128, 128);
      ctx.closePath();
    }
    ctx.fill();

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    return texture;
  }

  private createConveyorTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, 128, 128);

    ctx.fillStyle = '#38bdf8';
    for (let y = 0; y < 128; y += 16) {
      ctx.fillRect(0, y, 128, 4);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, 6);
    return texture;
  }

  private buildWarehouseEnvironment() {
    const floorGeo = new THREE.PlaneGeometry(30, 30);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x070b12, roughness: 0.9 });
    this.floorMesh = new THREE.Mesh(floorGeo, floorMat);
    this.floorMesh.rotation.x = -Math.PI / 2;
    this.floorMesh.receiveShadow = true;
    this.scene.add(this.floorMesh);

    const grid = new THREE.GridHelper(30, 30, 0x0284c7, 0x1e293b);
    grid.position.y = 0.005;
    this.scene.add(grid);

    // 1. 通行热力图
    const heatGeo = new THREE.PlaneGeometry(28, 28, 32, 32);
    const count = heatGeo.attributes.position.count;
    const colors = new Float32Array(count * 3);
    const posAttr = heatGeo.attributes.position;

    for (let i = 0; i < count; i++) {
      const x = posAttr.getX(i);
      const y = posAttr.getY(i);
      const distToCorridor = Math.abs(y - 0.6) + Math.abs(x + 1.0) * 0.3;
      const heat = Math.max(0, 1 - distToCorridor / 6);

      colors[i * 3] = heat * 0.95;
      colors[i * 3 + 1] = Math.sin(heat * Math.PI) * 0.7;
      colors[i * 3 + 2] = (1 - heat) * 0.8;
    }
    heatGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const heatMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.heatmapMesh = new THREE.Mesh(heatGeo, heatMat);
    this.heatmapMesh.rotation.x = -Math.PI / 2;
    this.heatmapMesh.position.y = 0.009;
    this.heatmapMesh.visible = false;
    this.scene.add(this.heatmapMesh);

    // 2. 环境扫描波
    const radarGeo = new THREE.RingGeometry(0.98, 1.0, 64);
    const radarMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.envRadarRing = new THREE.Mesh(radarGeo, radarMat);
    this.envRadarRing.rotation.x = -Math.PI / 2;
    this.envRadarRing.position.set(0, 0.006, 0);
    this.scene.add(this.envRadarRing);

    // 3. 智能充电桩工位
    const chargerGroup = new THREE.Group();
    const cx = this.chargingStationPos.x;
    const cz = this.chargingStationPos.z;

    const dockFloorMat = new THREE.MeshStandardMaterial({
      color: 0x10b981,
      roughness: 0.6,
      polygonOffset: true,
      polygonOffsetFactor: -1.0
    });
    const dockFloor = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.0), dockFloorMat);
    dockFloor.rotation.x = -Math.PI / 2;
    dockFloor.position.set(cx, 0.007, cz);
    chargerGroup.add(dockFloor);

    const cabinetMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8, roughness: 0.3 });
    const cabinet = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.6, 0.4), cabinetMat);
    cabinet.position.set(cx, 0.8, cz - 1.1);
    cabinet.castShadow = true;
    chargerGroup.add(cabinet);

    const screenMat = new THREE.MeshStandardMaterial({
      color: 0x10b981,
      emissive: 0x10b981,
      emissiveIntensity: 0.8
    });
    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.25, 0.05), screenMat);
    screen.position.set(cx, 1.3, cz - 0.88);
    chargerGroup.add(screen);
    this.scene.add(chargerGroup);

    // 4. 安全防撞立柱
    const bollardMat = new THREE.MeshStandardMaterial({ color: 0xeab308, roughness: 0.4, metalness: 0.6 });
    const bollardGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.7, 16);
    const bollardPositions = [
      [-4.6, 0.35, -1.2],
      [-4.6, 0.35, -2.8],
      [0.6, 0.35, -1.2],
      [0.6, 0.35, -2.8],
      [4.2, 0.35, -2.0],
      [4.2, 0.35, 4.0]
    ];
    bollardPositions.forEach(([bx, by, bz]) => {
      const bollard = new THREE.Mesh(bollardGeo, bollardMat);
      bollard.position.set(bx, by, bz);
      bollard.castShadow = true;
      this.scene.add(bollard);
    });

    // 5. 警戒斑马带
    const stripeTex = this.createWarningStripeTexture();
    stripeTex.repeat.set(10, 1);
    const hazardMat = new THREE.MeshStandardMaterial({
      map: stripeTex,
      roughness: 0.8,
      polygonOffset: true,
      polygonOffsetFactor: -1.0
    });
    const hazardGeo = new THREE.PlaneGeometry(5.2, 0.3);

    const frontStripe = new THREE.Mesh(hazardGeo, hazardMat);
    frontStripe.rotation.x = -Math.PI / 2;
    frontStripe.position.set(-2.0, 0.008, -1.3);
    this.scene.add(frontStripe);

    const backStripe = new THREE.Mesh(hazardGeo, hazardMat);
    backStripe.rotation.x = -Math.PI / 2;
    backStripe.position.set(-2.0, 0.008, -2.7);
    this.scene.add(backStripe);

    // 6. 通道中心线
    const laneGeo = new THREE.PlaneGeometry(0.12, 6.0);
    const laneMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.4
    });
    const mainLane = new THREE.Mesh(laneGeo, laneMat);
    mainLane.rotation.x = -Math.PI / 2;
    mainLane.rotation.z = Math.PI / 2;
    mainLane.position.set(0, 0.007, 0);
    this.scene.add(mainLane);

    // 7. 输送带系统
    const conveyorGroup = new THREE.Group();
    const beltLength = 6.0;
    const beltWidth = 0.9;
    const beltHeight = 0.45;
    const posX = 3.5;
    const posZ = 1.0;

    const frameMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8, roughness: 0.4 });
    const frameMesh = new THREE.Mesh(new THREE.BoxGeometry(beltWidth + 0.1, beltHeight, beltLength), frameMat);
    frameMesh.position.set(posX, beltHeight / 2, posZ);
    frameMesh.castShadow = true;
    conveyorGroup.add(frameMesh);

    this.conveyorTexture = this.createConveyorTexture();
    const beltMat = new THREE.MeshStandardMaterial({
      map: this.conveyorTexture,
      roughness: 0.5,
      metalness: 0.2
    });
    const beltMesh = new THREE.Mesh(new THREE.BoxGeometry(beltWidth, 0.05, beltLength), beltMat);
    beltMesh.position.set(posX, beltHeight + 0.02, posZ);
    conveyorGroup.add(beltMesh);

    const railMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      emissive: 0x0284c7,
      emissiveIntensity: 0.35,
      metalness: 0.7
    });
    const leftRail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.15, beltLength), railMat);
    leftRail.position.set(posX - beltWidth / 2, beltHeight + 0.08, posZ);
    const rightRail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.15, beltLength), railMat);
    rightRail.position.set(posX + beltWidth / 2, beltHeight + 0.08, posZ);
    conveyorGroup.add(leftRail, rightRail);
    this.scene.add(conveyorGroup);

    // 搭建光电传感器门架与感应对射光束
    const sensorGroup = new THREE.Group();
    const sensorMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.8 });
    const postLeft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.45, 12), sensorMat);
    postLeft.position.set(posX - beltWidth / 2 - 0.05, beltHeight + 0.225, 0.5);
    const postRight = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.45, 12), sensorMat);
    postRight.position.set(posX + beltWidth / 2 + 0.05, beltHeight + 0.225, 0.5);
    sensorGroup.add(postLeft, postRight);

    // 传感器发射透镜发光点
    const emitterLens = new THREE.Mesh(
      new THREE.SphereGeometry(0.03, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xef4444 })
    );
    emitterLens.position.set(posX - beltWidth / 2 - 0.05, beltHeight + 0.25, 0.5);
    sensorGroup.add(emitterLens);

    // 红色对射激光束
    const beamGeo = new THREE.BufferGeometry();
    const beamPos = new Float32Array([
      posX - beltWidth / 2 - 0.05, beltHeight + 0.25, 0.5,
      posX + beltWidth / 2 + 0.05, beltHeight + 0.25, 0.5
    ]);
    beamGeo.setAttribute('position', new THREE.BufferAttribute(beamPos, 3));
    const beamMat = new THREE.LineBasicMaterial({
      color: 0xef4444,
      transparent: true,
      opacity: 0.8
    });
    this.photoSensorBeam = new THREE.Line(beamGeo, beamMat);
    sensorGroup.add(this.photoSensorBeam);
    this.scene.add(sensorGroup);

    // 8. 立库货架与 InstancedMesh 合批货位
    const rackGroup = new THREE.Group();
    const rackMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.6 });
    const shelfLength = 4.0;
    const shelfDepth = 1.0;
    const colWidth = shelfLength / 4;
    const tierHeight = 0.8;
    const rackBaseX = -2.0;
    const rackBaseZ = -2.0;

    const totalTiers = 3;
    const totalCols = 4;
    const totalSlots = totalTiers * totalCols;

    const boxGeo = new THREE.BoxGeometry(0.65, 0.35, 0.7);
    const boxMat = new THREE.MeshStandardMaterial({
      roughness: 0.3,
      metalness: 0.5
    });
    this.slotInstancedMesh = new THREE.InstancedMesh(boxGeo, boxMat, totalSlots);
    this.slotInstancedMesh.castShadow = true;
    this.slotInstancedMesh.receiveShadow = true;

    let instanceIdx = 0;
    for (let t = 1; t <= totalTiers; t++) {
      const y = t * tierHeight;
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(shelfLength, 0.06, shelfDepth), rackMat);
      shelf.position.set(rackBaseX, y, rackBaseZ);
      shelf.castShadow = true;
      rackGroup.add(shelf);

      for (let c = 1; c <= totalCols; c++) {
        const slotId = `LOC-${t}-${c}`;
        const x = rackBaseX - shelfLength / 2 + (c - 0.5) * colWidth;

        this.slotIdToIndex.set(slotId, instanceIdx);
        this.indexToSlotId.set(instanceIdx, slotId);

        this.dummyTransform.position.set(x, y + 0.2, rackBaseZ);
        this.dummyTransform.updateMatrix();
        this.slotInstancedMesh.setMatrixAt(instanceIdx, this.dummyTransform.matrix);
        this.slotInstancedMesh.setColorAt(instanceIdx, new THREE.Color(0x0284c7));

        instanceIdx++;
      }
    }

    this.slotInstancedMesh.instanceMatrix.needsUpdate = true;
    if (this.slotInstancedMesh.instanceColor) {
      this.slotInstancedMesh.instanceColor.needsUpdate = true;
    }
    rackGroup.add(this.slotInstancedMesh);

    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8 });
    const pillarGeo = new THREE.BoxGeometry(0.08, 3.2, 0.08);
    const postOffsets = [
      [-shelfLength / 2, -shelfDepth / 2],
      [shelfLength / 2, -shelfDepth / 2],
      [-shelfLength / 2, shelfDepth / 2],
      [shelfLength / 2, shelfDepth / 2]
    ];
    postOffsets.forEach(([dx, dz]) => {
      const post = new THREE.Mesh(pillarGeo, pillarMat);
      post.position.set(rackBaseX + dx, 1.6, rackBaseZ + dz);
      post.castShadow = true;
      rackGroup.add(post);
    });

    this.scene.add(rackGroup);

    this.createAgvMesh('AGV_01', '01·拣选机器人', 0x0284c7, new THREE.Vector3(-3.5, 0, -0.75));
    this.createAgvMesh('AGV_02', '02·补货机器人', 0x10b981, new THREE.Vector3(1.5, 0, 2.5));
  }

  public toggleHeatmap(visible: boolean) {
    if (this.heatmapMesh) {
      this.heatmapMesh.visible = visible;
    }
  }

  public spawnConveyorBox(id?: string, position = -1.8) {
    const boxGeo = new THREE.BoxGeometry(0.5, 0.3, 0.5);
    const boxMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x38bdf8,
      emissiveIntensity: 0.4,
      roughness: 0.3
    });
    const box = new THREE.Mesh(boxGeo, boxMat);
    const startZ = position;
    box.position.set(3.5, 0.65, startZ);
    box.castShadow = true;
    this.scene.add(box);

    this.conveyorBoxes.push({
      id,
      mesh: box,
      startZ,
      currentZ: startZ
    });
  }

  public syncConveyorState(boxes: { id: string; currentZ: number }[]) {
    this.conveyorAuthoritative = true;
    const ids = new Set(boxes.map(b => b.id));
    for (let i = this.conveyorBoxes.length - 1; i >= 0; i--) {
      const box = this.conveyorBoxes[i]!;
      if (!box.id || !ids.has(box.id)) {
        this.scene.remove(box.mesh); box.mesh.geometry.dispose();
        (box.mesh.material as THREE.Material).dispose(); this.conveyorBoxes.splice(i, 1);
      }
    }
    boxes.forEach(box => {
      const existing = this.conveyorBoxes.find(b => b.id === box.id);
      if (existing) existing.currentZ = box.currentZ;
      else this.spawnConveyorBox(box.id, box.currentZ);
    });
  }

  public setRoutes(robots: { id: string; position: Point; route: Point[] }[]) {
    this.routeLines.forEach(line => { line.visible = false; });
    for (const robot of robots) {
      let line = this.routeLines.get(robot.id);
      if (!line) {
        line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({
          color: robot.id === 'AGV_01' ? 0x38bdf8 : 0x10b981, transparent: true, opacity: 0.8
        }));
        this.routeLines.set(robot.id, line); this.scene.add(line);
      }
      line.visible = robot.route.length > 0;
      line.geometry.dispose();
      line.geometry = new THREE.BufferGeometry().setFromPoints([robot.position, ...robot.route].map(p => new THREE.Vector3(p.x, 0.035, p.z)));
    }
  }

  public setAgvLift(id: string, height: number) {
    const payload = this.agvPayloadMeshes.get(id);
    if (payload) payload.position.y = height;
    const platform = this.liftPlatforms.get(id);
    if (platform) platform.position.y = height - 0.16;
    const mast = this.liftMasts.get(id);
    if (mast) { mast.scale.y = Math.max(0.1, height - 0.2); mast.position.y = (height + 0.2) / 2; }
  }

  public syncSlots(slots: StorageSlot[]) {
    if (!this.slotInstancedMesh) return;

    slots.forEach((slot) => {
      const idx = this.slotIdToIndex.get(slot.id);
      if (idx === undefined) return;

      if (slot.status === 'EMPTY') {
        this.dummyTransform.matrix.identity();
        this.slotInstancedMesh.getMatrixAt(idx, this.dummyTransform.matrix);
        this.dummyTransform.matrix.decompose(
          this.dummyTransform.position,
          this.dummyTransform.quaternion,
          this.dummyTransform.scale
        );
        this.dummyTransform.scale.set(0, 0, 0);
        this.dummyTransform.updateMatrix();
        this.slotInstancedMesh.setMatrixAt(idx, this.dummyTransform.matrix);
      } else {
        this.dummyTransform.matrix.identity();
        this.slotInstancedMesh.getMatrixAt(idx, this.dummyTransform.matrix);
        this.dummyTransform.matrix.decompose(
          this.dummyTransform.position,
          this.dummyTransform.quaternion,
          this.dummyTransform.scale
        );
        this.dummyTransform.scale.set(1, 1, 1);
        this.dummyTransform.updateMatrix();
        this.slotInstancedMesh.setMatrixAt(idx, this.dummyTransform.matrix);

        if (slot.status === 'OCCUPIED') {
          this.slotInstancedMesh.setColorAt(idx, new THREE.Color(0x0284c7));
        } else if (slot.status === 'PICKING') {
          this.slotInstancedMesh.setColorAt(idx, new THREE.Color(0xf59e0b));
        }
      }
    });

    this.slotInstancedMesh.instanceMatrix.needsUpdate = true;
    if (this.slotInstancedMesh.instanceColor) {
      this.slotInstancedMesh.instanceColor.needsUpdate = true;
    }
  }

  private createAgvMesh(id: string, name: string, color: number, initPos: THREE.Vector3) {
    const group = new THREE.Group();
    group.position.copy(initPos);

    const loader = new GLTFLoader();
    loader.load(
      '/models/robot.glb',
      (gltf) => {
        if (this.disposed) { this.disposeTree(gltf.scene); return; }
        const model = gltf.scene;
        model.scale.set(0.25, 0.25, 0.25);
        model.position.y = 0;

        model.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            child.userData = { deviceId: id };
          }
        });

        if (gltf.animations && gltf.animations.length > 0) {
          const mixer = new THREE.AnimationMixer(model);
          const action = mixer.clipAction(gltf.animations[0]);
          action.play();
          this.mixers.push(mixer);
        }

        group.add(model);
      },
      undefined,
      () => {
        if (this.disposed) return;
        const fallback = new THREE.Mesh(
          new THREE.BoxGeometry(0.8, 0.35, 1.1),
          new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.8 })
        );
        fallback.position.y = 0.175;
        fallback.userData = { deviceId: id };
        group.add(fallback);
      }
    );

    const payloadGeo = new THREE.BoxGeometry(0.5, 0.28, 0.5);
    const payloadMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x38bdf8,
      emissiveIntensity: 0.35,
      roughness: 0.4
    });
    const payloadMesh = new THREE.Mesh(payloadGeo, payloadMat);
    payloadMesh.position.set(0, 0.7, -0.15);
    payloadMesh.visible = false;
    payloadMesh.castShadow = true;
    group.add(payloadMesh);
    this.agvPayloadMeshes.set(id, payloadMesh);
    const platform = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.035, 0.65), new THREE.MeshStandardMaterial({ color: 0xeab308, metalness: 0.6 }));
    platform.position.set(0, 0.54, -0.15);
    group.add(platform);
    this.liftPlatforms.set(id, platform);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 1, 8), new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8 }));
    mast.position.set(0, 0.45, -0.4); mast.scale.y = 0.5;
    group.add(mast); this.liftMasts.set(id, mast);

    const lidarGeo = new THREE.CircleGeometry(1.6, 24, Math.PI / 2 - 0.6, 1.2);
    const lidarMat = new THREE.MeshBasicMaterial({
      color: 0x06b6d4,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide
    });
    const lidarFan = new THREE.Mesh(lidarGeo, lidarMat);
    lidarFan.rotation.x = -Math.PI / 2;
    lidarFan.position.set(0, 0.025, 0.3);
    group.add(lidarFan);

    const beamPositions = new Float32Array(6);
    const beamGeo = new THREE.BufferGeometry();
    beamGeo.setAttribute('position', new THREE.BufferAttribute(beamPositions, 3));
    const beamMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.8
    });
    const beamLine = new THREE.Line(beamGeo, beamMat);
    this.scene.add(beamLine);

    this.lidarVisuals.set(id, { fan: lidarFan, beam: beamLine });

    const ringGeo = new THREE.RingGeometry(0.5, 0.7, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xef4444,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.0
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.rotation.x = -Math.PI / 2;
    ringMesh.position.y = 0.03;
    group.add(ringMesh);

    const alarmLight = new THREE.PointLight(0xef4444, 0, 5);
    alarmLight.position.set(0, 0.9, 0);
    group.add(alarmLight);

    this.alarmVisuals.set(id, {
      ring: ringMesh,
      light: alarmLight,
      active: false
    });

    const labelDiv = document.createElement('div');
    labelDiv.className = 'agv-3d-tag';
    labelDiv.innerHTML = `
      <div class="tag-title">${name}</div>
      <div class="tag-sub">状态: 正常作业</div>
    `;

    const labelObj = new CSS2DObject(labelDiv);
    labelObj.position.set(0, 1.25, 0);
    group.add(labelObj);

    this.labelElements.set(id, labelDiv);
    this.scene.add(group);
    this.agvMeshes.set(id, group);
    this.targetPositions.set(id, initPos.clone());
    this.targetRotations.set(id, 0);
    this.lastRecordedPos.set(id, initPos.clone());

    const maxPoints = 80;
    const positions = new Float32Array(maxPoints * 3);
    for (let i = 0; i < maxPoints; i++) {
      positions[i * 3] = initPos.x;
      positions[i * 3 + 1] = 0.02;
      positions[i * 3 + 2] = initPos.z;
    }

    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const trailMat = new THREE.LineBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.95
    });

    const trailLine = new THREE.Line(trailGeo, trailMat);
    this.scene.add(trailLine);

    this.trails.set(id, { line: trailLine, positions, maxPoints });
  }

  public setAgvPayload(id: string, hasPayload: boolean) {
    const mesh = this.agvPayloadMeshes.get(id);
    if (mesh) {
      mesh.visible = hasPayload;
    }
  }

  public setAgvCharging(id: string, isCharging: boolean) {
    const visual = this.alarmVisuals.get(id);
    const lidar = this.lidarVisuals.get(id);

    if (isCharging) {
      this.chargingAgvs.add(id);
      const pos = this.targetPositions.get(id);
      if (pos && !this.authoritativePose) pos.copy(this.chargingStationPos);
      if (!this.authoritativePose) this.targetRotations.set(id, 0);

      if (lidar) lidar.fan.visible = false;
      if (visual) {
        visual.light.color.setHex(0x10b981);
        visual.light.intensity = 2.0;
        (visual.ring.material as THREE.MeshBasicMaterial).color.setHex(0x10b981);
      }
    } else {
      this.chargingAgvs.delete(id);
      if (lidar) lidar.fan.visible = true;
      if (visual) {
        visual.light.color.setHex(0xef4444);
        visual.light.intensity = 0;
        (visual.ring.material as THREE.MeshBasicMaterial).color.setHex(0xef4444);
      }
    }
  }

  public setAgvAlarm(id: string, isAlarm: boolean) {
    const visual = this.alarmVisuals.get(id);
    const lidar = this.lidarVisuals.get(id);

    if (visual && !this.chargingAgvs.has(id)) {
      visual.active = isAlarm;
      if (!isAlarm) {
        visual.light.intensity = 0;
        (visual.ring.material as THREE.MeshBasicMaterial).opacity = 0;
        visual.ring.scale.set(1, 1, 1);
        if (lidar) {
          (lidar.fan.material as THREE.MeshBasicMaterial).color.setHex(0x06b6d4);
        }
      } else {
        if (lidar) {
          (lidar.fan.material as THREE.MeshBasicMaterial).color.setHex(0xef4444);
        }
      }
    }
  }

  private updateTrail(id: string, currentPos: THREE.Vector3) {
    const trail = this.trails.get(id);
    const lastPos = this.lastRecordedPos.get(id);
    if (!trail || !lastPos) return;

    if (currentPos.distanceTo(lastPos) > 0.05) {
      const posArray = trail.positions;
      for (let i = trail.maxPoints - 1; i > 0; i--) {
        posArray[i * 3] = posArray[(i - 1) * 3];
        posArray[i * 3 + 1] = posArray[(i - 1) * 3 + 1];
        posArray[i * 3 + 2] = posArray[(i - 1) * 3 + 2];
      }

      posArray[0] = currentPos.x;
      posArray[1] = 0.02;
      posArray[2] = currentPos.z;

      lastPos.copy(currentPos);
      const attr = trail.line.geometry.getAttribute('position') as THREE.BufferAttribute;
      attr.needsUpdate = true;
    }
  }

  private updateLidarBeam(id: string, currentPos: THREE.Vector3) {
    const lidar = this.lidarVisuals.get(id);
    if (!lidar || this.chargingAgvs.has(id)) {
      if (lidar) lidar.beam.visible = false;
      return;
    }
    lidar.beam.visible = true;

    const target = new THREE.Vector3(-2, 0.4, -2);
    const attr = lidar.beam.geometry.getAttribute('position') as THREE.BufferAttribute;
    const array = attr.array as Float32Array;

    array[0] = currentPos.x;
    array[1] = currentPos.y + 0.35;
    array[2] = currentPos.z;

    array[3] = target.x;
    array[4] = target.y;
    array[5] = target.z;

    attr.needsUpdate = true;
  }

  public updateLabelState(
    id: string,
    statusText: string,
    isSelected: boolean,
    isAlarm: boolean = false
  ) {
    const el = this.labelElements.get(id);
    if (!el) return;
    const subText = el.querySelector('.tag-sub');
    if (subText && statusText) subText.textContent = `状态: ${statusText}`;

    if (isAlarm) {
      el.classList.add('alarm');
    } else {
      el.classList.remove('alarm');
    }

    if (isSelected) {
      el.classList.add('selected');
    } else {
      el.classList.remove('selected');
    }
  }

  public setTargetPose(id: string, x: number, z: number, heading: number) {
    if (this.chargingAgvs.has(id) && !this.authoritativePose) return;

    const pos = this.targetPositions.get(id);
    if (pos) pos.set(x, 0, z);
    this.targetRotations.set(id, heading);
  }

  public setTheme(theme: 'DARK' | 'LIGHT') {
    if (theme === 'LIGHT') {
      this.scene.background = new THREE.Color(0xf1f5f9);
      this.scene.fog = new THREE.FogExp2(0xf1f5f9, 0.015);
      this.ambientLight.intensity = 1.6;
      this.dirLight.intensity = 2.0;
      (this.floorMesh.material as THREE.MeshStandardMaterial).color.setHex(0xe2e8f0);
      this.bloomPass.strength = 0.2;
    } else {
      this.scene.background = new THREE.Color(0x07090e);
      this.scene.fog = new THREE.FogExp2(0x07090e, 0.035);
      this.ambientLight.intensity = 0.7;
      this.dirLight.intensity = 1.4;
      (this.floorMesh.material as THREE.MeshStandardMaterial).color.setHex(0x070b12);
      this.bloomPass.strength = 0.65;
    }
  }

  private stopAutoTour() {
    this.isAutoTouring = false;
    if (this.tourTimeline) {
      this.tourTimeline.kill();
      this.tourTimeline = null;
    }
  }

  private runNextTourLeg() {
    if (!this.isAutoTouring) return;

    const currentWP = this.waypoints[this.tourStep % this.waypoints.length];
    this.tourStep++;

    this.isCameraTweening = true;
    this.controls.enabled = false;

    gsap.to(this.camera.position, {
      x: currentWP.cam.x,
      y: currentWP.cam.y,
      z: currentWP.cam.z,
      duration: 3.5,
      ease: 'power2.inOut'
    });

    gsap.to(this.controls.target, {
      x: currentWP.target.x,
      y: currentWP.target.y,
      z: currentWP.target.z,
      duration: 3.5,
      ease: 'power2.inOut',
      onComplete: () => {
        if (this.isAutoTouring) {
          gsap.delayedCall(currentWP.dur, () => this.runNextTourLeg());
        }
      }
    });
  }

  public setViewMode(mode: CameraViewMode, targetId: string | null = null) {
    this.viewMode = mode;
    this.currentAgvId = targetId;
    gsap.killTweensOf(this.camera.position);
    gsap.killTweensOf(this.controls.target);
    this.stopAutoTour();

    if (this.camera.parent !== this.scene) {
      this.scene.attach(this.camera);
    }

    if (mode === 'TOUR') {
      this.isAutoTouring = true;
      this.tourStep = 0;
      this.runNextTourLeg();
      return;
    }

    if (mode === 'OVERVIEW' || !targetId) {
      this.controls.enabled = true;
      this.isCameraTweening = true;
      gsap.to(this.camera.position, {
        x: this.defaultCameraPos.x,
        y: this.defaultCameraPos.y,
        z: this.defaultCameraPos.z,
        duration: 1.2,
        ease: 'power2.inOut'
      });
      gsap.to(this.controls.target, {
        x: this.defaultControlsTarget.x,
        y: this.defaultControlsTarget.y,
        z: this.defaultControlsTarget.z,
        duration: 1.2,
        ease: 'power2.inOut',
        onComplete: () => {
          this.isCameraTweening = false;
        }
      });
      return;
    }

    const group = this.agvMeshes.get(targetId);
    if (!group) return;

    if (mode === 'FOCUS') {
      this.controls.enabled = true;
      this.isCameraTweening = true;
      const targetCenter = group.position;
      const destCamPos = new THREE.Vector3(
        targetCenter.x + 1.8,
        targetCenter.y + 1.5,
        targetCenter.z + 2.0
      );

      gsap.to(this.camera.position, {
        x: destCamPos.x,
        y: destCamPos.y,
        z: destCamPos.z,
        duration: 1.2,
        ease: 'power2.inOut'
      });

      gsap.to(this.controls.target, {
        x: targetCenter.x,
        y: targetCenter.y + 0.3,
        z: targetCenter.z,
        duration: 1.2,
        ease: 'power2.inOut',
        onComplete: () => {
          this.isCameraTweening = false;
        }
      });
    } else if (mode === 'FPV') {
      this.controls.enabled = false;
      this.isCameraTweening = true;
      const worldPos = new THREE.Vector3();
      group.getWorldPosition(worldPos);

      gsap.to(this.camera.position, {
        x: worldPos.x,
        y: worldPos.y + 0.65,
        z: worldPos.z,
        duration: 1.0,
        ease: 'power2.inOut',
        onComplete: () => {
          group.attach(this.camera);
          this.camera.position.set(0, 0.65, 0.45);
          this.camera.rotation.set(-0.1, 0, 0);
          this.isCameraTweening = false;
        }
      });
    }
  }

  private setupEvents() {
    this.clickHandler = (event: MouseEvent) => {
      if (this.viewMode === 'FPV' || this.isAutoTouring) return;

      const rect = this.container.getBoundingClientRect();
      this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      this.raycaster.setFromCamera(this.mouse, this.camera);
      const intersects = this.raycaster.intersectObjects(this.scene.children, true);

      for (const hit of intersects) {
        // 1. 命中合批库位实例
        if (hit.object === this.slotInstancedMesh && hit.instanceId !== undefined) {
          const slotId = this.indexToSlotId.get(hit.instanceId);
          if (slotId) {
            this.onSlotClick(slotId);
            return;
          }
        }

        // 2. 命中 AGV 机器人模型
        let curr: THREE.Object3D | null = hit.object;
        while (curr && curr !== this.scene) {
          if (curr.userData && curr.userData.deviceId) {
            this.onSelect(curr.userData.deviceId);
            return;
          }
          curr = curr.parent;
        }
      }
      this.onSelect(null);
    };
    this.container.addEventListener('click', this.clickHandler);
  }

  private startLoop() {
    let elapsed = 0;

    const tick = () => {
      if (this.disposed) return;
      this.animId = requestAnimationFrame(tick);
      const delta = this.clock.getDelta();
      elapsed += delta;
      const factor = 1.0 - Math.exp(-10.0 * delta);

      this.mixers.forEach((m) => m.update(delta));

      // 3D POI 标牌呼吸浮动
      const poiTime = performance.now() * 0.002;
      this.poiGroup.children.forEach((child) => {
        if (child.userData && child.userData.baseY !== undefined) {
          child.position.y = child.userData.baseY + Math.sin(poiTime) * 0.08;
        }
      });

      if (this.conveyorTexture) {
        this.conveyorTexture.offset.y -= delta * 0.4;
      }

      if (this.envRadarRing) {
        const pulse = (elapsed * 0.25) % 1.0;
        const rScale = 0.5 + pulse * 14.0;
        this.envRadarRing.scale.set(rScale, rScale, 1);
        (this.envRadarRing.material as THREE.MeshBasicMaterial).opacity = (1.0 - pulse) * 0.25;
      }

      if (this.conveyorAuthoritative) {
        this.conveyorBoxes.forEach(box => { box.mesh.position.z = THREE.MathUtils.lerp(box.mesh.position.z, box.currentZ, factor); });
        const blocked = this.conveyorBoxes.some(box => Math.abs(box.currentZ - 0.5) < 0.25);
        (this.photoSensorBeam.material as THREE.LineBasicMaterial).color.setHex(blocked ? 0x10b981 : 0xef4444);
      } else {
        const conveyor = advanceConveyor(this.conveyorBoxes, delta);
        this.conveyorBoxes.forEach(item => { item.mesh.position.z = item.currentZ; });
        conveyor.exited.forEach(item => {
          this.scene.remove(item.mesh); item.mesh.geometry.dispose();
          (item.mesh.material as THREE.Material).dispose();
        });
        for (let i = 0; i < conveyor.passes; i++) this.onConveyorPass?.();
        (this.photoSensorBeam.material as THREE.LineBasicMaterial).color.setHex(conveyor.blocking ? 0x10b981 : 0xef4444);
      }

      this.agvMeshes.forEach((mesh, id) => {
        const visual = this.alarmVisuals.get(id);
        const isCharging = this.chargingAgvs.has(id);

        if (this.authoritativePose || !visual || (!visual.active && !isCharging)) {
          const targetPos = this.targetPositions.get(id);
          const targetRot = this.targetRotations.get(id);
          if (targetPos) {
            mesh.position.lerp(targetPos, factor);
            this.updateTrail(id, mesh.position);
            this.updateLidarBeam(id, mesh.position);
          }
          if (targetRot !== undefined) {
            mesh.rotation.y += Math.atan2(Math.sin(targetRot - mesh.rotation.y), Math.cos(targetRot - mesh.rotation.y)) * factor;
          }
        }
        if (visual && isCharging) {
          const targetPos = this.targetPositions.get(id);
          if (targetPos && !this.authoritativePose) mesh.position.lerp(targetPos, factor);
          const greenBreath = Math.sin(elapsed * 4) * 0.5 + 0.5;
          visual.light.intensity = 1.0 + greenBreath * 2.5;
        } else if (visual?.active) {
          const wavePhase = (elapsed * 2.5) % 1.0;
          const scale = 1.0 + wavePhase * 1.5;
          visual.ring.scale.set(scale, scale, 1);
          (visual.ring.material as THREE.MeshBasicMaterial).opacity = (1.0 - wavePhase) * 0.85;
          visual.light.intensity = Math.sin(elapsed * 12) > 0 ? 4.5 : 0.3;
        }
      });

      // 动态计算两车相对距离与激光警戒虚线
      const agv1 = this.agvMeshes.get('AGV_01');
      const agv2 = this.agvMeshes.get('AGV_02');
      if (agv1 && agv2 && this.safetyDistanceLine) {
        const p1 = agv1.position;
        const p2 = agv2.position;
        const dist = p1.distanceTo(p2);

        const posAttr = this.safetyDistanceLine.geometry.getAttribute('position') as THREE.BufferAttribute;
        const arr = posAttr.array as Float32Array;
        arr[0] = p1.x; arr[1] = 0.15; arr[2] = p1.z;
        arr[3] = p2.x; arr[4] = 0.15; arr[5] = p2.z;
        posAttr.needsUpdate = true;
        this.safetyDistanceLine.computeLineDistances();

        const lineMat = this.safetyDistanceLine.material as THREE.LineDashedMaterial;
        if (dist < 1.4) {
          lineMat.color.setHex(0xef4444);
          lineMat.opacity = 1.0;
        } else if (dist < 2.2) {
          lineMat.color.setHex(0xf59e0b);
          lineMat.opacity = 0.85;
        } else {
          lineMat.color.setHex(0x10b981);
          lineMat.opacity = 0.35;
        }
      }

      if (this.viewMode === 'FOCUS' && this.currentAgvId && !this.isCameraTweening) {
        const targetGroup = this.agvMeshes.get(this.currentAgvId);
        if (targetGroup) {
          const desiredTarget = new THREE.Vector3(
            targetGroup.position.x,
            targetGroup.position.y + 0.3,
            targetGroup.position.z
          );
          const offset = desiredTarget.clone().sub(this.controls.target);
          this.controls.target.lerp(desiredTarget, factor);
          this.camera.position.add(offset.multiplyScalar(factor));
        }
      }

      // 电子围栏立体光幕脉冲动效
      if (this.geofenceMesh) {
        if (this.geofenceActive) {
          const fencePhase = (elapsed * 3.5) % (Math.PI * 2);
          const fenceMat = this.geofenceMesh.material as THREE.MeshBasicMaterial;
          
          // 呼吸透明度提升，形成明显光幕感
          fenceMat.opacity = 0.45 + Math.sin(fencePhase) * 0.25;

          // 子网格（顶部和底部锁边环）维持高亮
          this.geofenceMesh.children.forEach((child) => {
            if ((child as THREE.Mesh).material) {
              ((child as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity =
                0.85 + Math.sin(fencePhase) * 0.15;
            }
          });

          // 整体轻微径向膨胀呼吸
          const s = 1.0 + Math.sin(fencePhase) * 0.04;
          this.geofenceMesh.scale.set(s, 1.0, s);
        } else {
          (this.geofenceMesh.material as THREE.MeshBasicMaterial).opacity = 0;
          this.geofenceMesh.children.forEach((child) => {
            if ((child as THREE.Mesh).material) {
              ((child as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0;
            }
          });
        }
      }

      if (this.controls.enabled) {
        this.controls.update();
      }

      if (this.composer) {
        this.composer.render();
      } else {
        this.renderer.render(this.scene, this.camera);
      }

      if (this.labelRenderer) {
        this.labelRenderer.render(this.scene, this.camera);
      }
    };
    tick();
  }

  public resize() {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    if (this.composer) {
      this.composer.setSize(width, height);
    }
    if (this.labelRenderer) {
      this.labelRenderer.setSize(width, height);
    }
  }

  public setGeofenceState(active: boolean) {
    this.geofenceActive = active;
  }

  private disposeTree(root: THREE.Object3D) {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    root.traverse(object => {
      const renderable = object as THREE.Mesh;
      if (renderable.geometry) geometries.add(renderable.geometry);
      const list = Array.isArray(renderable.material) ? renderable.material : [renderable.material];
      list.filter(Boolean).forEach(material => {
        materials.add(material);
        Object.values(material).forEach(value => { if (value instanceof THREE.Texture) textures.add(value); });
      });
    });
    textures.forEach(texture => texture.dispose());
    materials.forEach(material => material.dispose());
    geometries.forEach(geometry => geometry.dispose());
  }

  public dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.animId);
    this.stopAutoTour();
    if (this.clickHandler) this.container.removeEventListener('click', this.clickHandler);
    gsap.killTweensOf(this.camera.position);
    gsap.killTweensOf(this.controls.target);
    this.mixers.forEach(mixer => { mixer.stopAllAction(); mixer.uncacheRoot(mixer.getRoot()); });
    this.controls.dispose();
    this.composer.passes.forEach(pass => pass.dispose());
    this.composer.dispose();
    this.disposeTree(this.scene);
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.labelRenderer.domElement.remove();
    this.labelElements.clear();
    this.mixers.length = 0;
    this.conveyorBoxes.length = 0;
  }
}
