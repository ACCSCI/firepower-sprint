import * as THREE from 'three';
import { RuntimeModelLibrary, type RuntimeModelKey } from './asset-loader';
import { EnvironmentVisual } from './environment';
import { selectGateSide } from './simulation';
import { SQUAD_OFFSETS } from './squad';
import { TrackPath } from './track';
import type {
  BiomeType, EnemyState, GameEvent, GameState, GateState, HazardState, ObstacleState,
  PickupState, VehicleMode, WeaponType,
} from './types';

interface Particle { mesh: THREE.Mesh; velocity: THREE.Vector3; life: number }
interface FloatingText { sprite: THREE.Sprite; life: number }
interface Shockwave { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial; life: number; maxLife: number }

export class GameWorld {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(48, 1, 0.1, 220);
  private readonly models = new RuntimeModelLibrary();
  private readonly player = this.createPlayer();
  private readonly allies: THREE.Group[] = [];
  private readonly enemyViews = new Map<number, THREE.Group>();
  private readonly obstacleViews = new Map<number, THREE.Group>();
  private readonly pickupViews = new Map<number, THREE.Group>();
  private readonly gateViews = new Map<number, THREE.Group>();
  private readonly hazardViews = new Map<number, THREE.Group>();
  private readonly bulletViews = new Map<number, THREE.Mesh>();
  private readonly bulletPool: THREE.Mesh[] = [];
  private readonly particles: Particle[] = [];
  private readonly floatingTexts: FloatingText[] = [];
  private readonly shockwaves: Shockwave[] = [];
  private readonly particleGeometry = new THREE.OctahedronGeometry(0.14, 0);
  private readonly bulletGeometry = new THREE.SphereGeometry(0.16, 8, 6);
  private readonly bulletMaterial = new THREE.MeshBasicMaterial({ color: 0xffef72 });
  private readonly particleMaterials = new Map<number, THREE.MeshBasicMaterial>();
  private readonly floatingTextTextures = new Map<string, THREE.CanvasTexture>();
  private readonly cameraTarget = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly clock = new THREE.Clock();
  private readonly vehicleRig = this.createVehicleRig();
  private readonly hemisphere = new THREE.HemisphereLight(0xd9f6ff, 0x4b3c73, 2.1);
  private readonly sun = new THREE.DirectionalLight(0xfff2d0, 3.3);
  private readonly track: TrackPath;
  private readonly environment: EnvironmentVisual;
  private muzzleLife = 0;
  private cameraShake = 0;
  private disposed = false;

  constructor(private readonly canvas: HTMLCanvasElement, state: GameState) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.background = new THREE.Color(0x8bd8ff);
    this.scene.fog = new THREE.Fog(0x8bd8ff, 24, 60);
    this.setupLights();
    this.track = new TrackPath(state.levelId, state.levelEnd);
    const segments = state.segments.length ? state.segments : [{
      id: 0, startZ: -8, endZ: state.levelEnd + 12, biome: 'surface' as const,
      vehicle: 'onFoot' as const, title: '地表前线',
    }];
    this.environment = new EnvironmentVisual(this.scene, this.hemisphere, this.sun, segments, this.track);
    this.scene.add(this.player, this.vehicleRig);
    for (let index = 1; index < SQUAD_OFFSETS.length; index += 1) {
      const ally = this.createPlayer(true);
      ally.visible = false;
      this.allies.push(ally);
      this.scene.add(ally);
    }
    state.gates.forEach((item) => this.addGate(item));
    state.enemies.forEach((item) => this.addEnemy(item));
    state.obstacles.forEach((item) => this.addObstacle(item));
    state.pickups.forEach((item) => this.addPickup(item));
    state.hazards.forEach((item) => this.addHazard(item));
    this.models.start((key) => this.applyLoadedModel(key));
    this.camera.position.set(0, 7.6, -8.5);
    this.camera.lookAt(0, 1.1, 6);
    this.resize();
  }

  resize(): void {
    if (this.disposed) return;
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.fov = width > height ? 38 : 48;
    this.camera.updateProjectionMatrix();
  }

  update(state: GameState, dt: number): void {
    if (this.disposed) return;
    const elapsed = this.clock.getElapsedTime();
    const baseAltitude = this.vehicleAltitude(state.vehicle, state.player.z);
    const segment = state.segments.find((item) => item.id === state.currentSegmentId)
      ?? state.segments.find((item) => state.player.z >= item.startZ && state.player.z < item.endZ);
    this.environment.update((segment?.biome ?? 'surface') as BiomeType, elapsed, dt);
    this.muzzleLife = Math.max(0, this.muzzleLife - dt);
    this.updateVehicle(state.vehicle, state.player.x, state.player.z, state.player.weapon, state.player.projectileCount, elapsed);
    this.updateSoldier(this.player, 0, state.player, state.vehicle, elapsed);
    for (let index = 1; index < SQUAD_OFFSETS.length; index += 1) {
      const ally = this.allies[index - 1];
      ally.visible = index < state.player.crewCount;
      if (ally.visible) this.updateSoldier(ally, index, state.player, state.vehicle, elapsed);
    }
    const nextGate = state.gates
      .filter((gate) => !gate.used && gate.z >= state.player.z - 0.5)
      .sort((a, b) => a.z - b.z)[0];
    const nextPair = nextGate
      ? state.gates.filter((gate) => gate.pairId === nextGate.pairId)
      : [];
    const previewSide = nextPair.length ? selectGateSide(nextPair, state.player.x) : 0;
    for (const gate of state.gates) {
      const view = this.gateViews.get(gate.id) ?? this.addGate(gate);
      view.visible = !gate.used;
      this.track.place(view, gate.z, gate.x, baseAltitude);
      const selected = gate.pairId === nextGate?.pairId && gate.side === previewSide;
      const frameMaterial = view.userData.frameMaterial as THREE.MeshStandardMaterial;
      const halo = view.userData.halo as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
      const selector = view.userData.selector as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
      const displayColor = gate.hitFlash > 0 ? 0xffffff : gate.color;
      frameMaterial.color.setHex(gate.color);
      frameMaterial.emissive.setHex(displayColor);
      halo.material.color.setHex(gate.color);
      selector.material.emissive.setHex(gate.color);
      frameMaterial.opacity = selected ? 0.98 : 0.66;
      frameMaterial.emissiveIntensity = selected ? 0.9 : 0.22;
      halo.material.opacity = selected ? 0.38 : 0.1;
      halo.scale.setScalar((selected ? 1.04 : 1) + Math.sin(elapsed * 4 + gate.id) * 0.025);
      selector.visible = selected;
      selector.position.y = 3.4 + Math.sin(elapsed * 7) * 0.1;
      this.updateGateLabel(view, gate);
      this.updateHealthBar(view, gate.shotCharge, gate.shotChargeMax, gate.shootable && !gate.used);
    }
    for (const enemy of state.enemies) this.updateEnemy(this.enemyViews.get(enemy.id) ?? this.addEnemy(enemy), enemy, elapsed, baseAltitude);
    for (const obstacle of state.obstacles) this.updateObstacle(this.obstacleViews.get(obstacle.id) ?? this.addObstacle(obstacle), obstacle, elapsed, baseAltitude);
    for (const pickup of state.pickups) {
      const view = this.pickupViews.get(pickup.id) ?? this.addPickup(pickup);
      view.visible = !pickup.collected;
      this.track.place(view, pickup.z, pickup.x, baseAltitude + 0.9 + Math.sin(elapsed * 3 + pickup.id) * 0.18);
      view.rotation.y += elapsed * 1.7 + pickup.id;
    }
    for (const hazard of state.hazards) {
      this.updateHazard(this.hazardViews.get(hazard.id) ?? this.addHazard(hazard), hazard, elapsed, baseAltitude);
    }
    this.updateBullets(state);
    this.handleEvents(state.events);
    this.updateParticles(dt);
    this.updateFloatingTexts(dt);
    this.updateShockwaves(dt);
    this.updateCamera(state, elapsed, dt);
    this.renderer.render(this.scene, this.camera);
  }

  /** Releases every GPU/runtime resource so a new level can reuse the same canvas. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.models.dispose();
    this.environment.dispose();
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Sprite)) return;
      if (object instanceof THREE.Mesh) object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) value.dispose();
        }
        material.dispose();
      }
    });
    this.particleGeometry.dispose();
    this.bulletGeometry.dispose();
    this.bulletMaterial.dispose();
    for (const material of this.particleMaterials.values()) material.dispose();
    for (const texture of this.floatingTextTextures.values()) texture.dispose();
    this.scene.clear();
    this.enemyViews.clear();
    this.obstacleViews.clear();
    this.pickupViews.clear();
    this.gateViews.clear();
    this.hazardViews.clear();
    this.bulletViews.clear();
    this.bulletPool.length = 0;
    this.particles.length = 0;
    this.floatingTexts.length = 0;
    for (const wave of this.shockwaves) {
      wave.mesh.geometry.dispose();
      wave.material.dispose();
    }
    this.shockwaves.length = 0;
    this.particleMaterials.clear();
    this.floatingTextTextures.clear();
    this.clock.stop();
    this.renderer.setAnimationLoop(null);
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
  }

  private setupLights(): void {
    this.scene.add(this.hemisphere);
    this.sun.position.set(-8, 14, -6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.left = -9;
    this.sun.shadow.camera.right = 9;
    this.sun.shadow.camera.top = 15;
    this.sun.shadow.camera.bottom = -5;
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun);
  }

  private updateCamera(state: GameState, elapsed: number, dt: number): void {
    const altitude = this.vehicleAltitude(state.vehicle, state.player.z);
    this.track.point(state.player.z - 9.2, state.player.x * 0.2, altitude + (state.vehicle === 'plane' ? 7.4 : 7.1), this.cameraTarget);
    this.camera.position.lerp(this.cameraTarget, Math.min(1, dt * 4.5));
    this.cameraShake = Math.max(0, this.cameraShake - dt * 1.7);
    if (this.cameraShake > 0) {
      this.camera.position.x += Math.sin(elapsed * 77) * this.cameraShake;
      this.camera.position.y += Math.cos(elapsed * 69) * this.cameraShake * 0.45;
    }
    this.track.point(state.player.z + 7.5, state.player.x * 0.12, altitude + 1.15, this.lookTarget);
    this.camera.lookAt(this.lookTarget);
  }

  private updateBullets(state: GameState): void {
    const active = new Set<number>();
    const y = this.vehicleAltitude(state.vehicle, state.player.z) + 1.2;
    for (const bullet of state.bullets) {
      if (!bullet.alive) continue;
      active.add(bullet.id);
      let view = this.bulletViews.get(bullet.id);
      if (!view) {
        view = this.bulletPool.pop() ?? new THREE.Mesh(this.bulletGeometry, this.bulletMaterial);
        view.visible = true;
        this.bulletViews.set(bullet.id, view);
        this.scene.add(view);
      }
      this.track.place(view, bullet.z, bullet.x, y, false);
      view.scale.set(0.8, 0.8, state.player.weapon === 'gatling' ? 1.8 : 1.25);
    }
    for (const [id, view] of this.bulletViews) {
      if (active.has(id)) continue;
      this.scene.remove(view);
      view.visible = false;
      this.bulletPool.push(view);
      this.bulletViews.delete(id);
    }
  }

  private updateSoldier(
    soldier: THREE.Group,
    index: number,
    player: GameState['player'],
    vehicle: VehicleMode,
    elapsed: number,
  ): void {
    const offset = SQUAD_OFFSETS[index];
    const phase = elapsed * (vehicle === 'onFoot' ? 11 : 6) + index * 0.7;
    const formation = vehicle === 'plane' ? 0.45 : vehicle === 'car' || vehicle === 'minecart' ? 0.65 : 1;
    const soldierZ = player.z + offset.z * formation;
    this.track.place(
      soldier,
      soldierZ,
      player.x + offset.x * formation,
      this.vehicleAltitude(vehicle, soldierZ) + 0.05 + Math.sin(phase) * (vehicle === 'onFoot' ? 0.045 : 0.018),
    );
    const legs = soldier.userData.legs as THREE.Group[];
    const stride = vehicle === 'onFoot' ? 0.55 : 0.08;
    legs[0].rotation.x = Math.sin(phase) * stride;
    legs[1].rotation.x = Math.sin(phase + Math.PI) * stride;
    const arms = soldier.userData.arms as THREE.Group[];
    arms[0].rotation.x = -0.45 + Math.sin(phase) * stride * 0.25;
    arms[1].rotation.x = -0.65 - Math.sin(phase) * stride * 0.25;
    const weapons = soldier.userData.weapons as Record<WeaponType, THREE.Group>;
    Object.entries(weapons).forEach(([name, view]) => { view.visible = name === player.weapon; });
    const current = weapons[player.weapon];
    const spinPart = current.userData.spinPart as THREE.Group | undefined;
    if (spinPart) spinPart.rotation.z = elapsed * 22;
    const flash = current.userData.muzzleFlash as THREE.Mesh;
    flash.visible = this.muzzleLife > 0;
    if (flash.visible) flash.scale.setScalar(0.75 + this.muzzleLife * 8);
  }

  private createPlayer(ally = false): THREE.Group {
    const group = new THREE.Group();
    const suit = this.standard(ally ? 0x0891b2 : 0x2563eb, 0.42);
    const armor = this.standard(ally ? 0x0e7490 : 0x1d4ed8, 0.34, 0.35);
    const skin = this.standard(0xffc49d, 0.65);
    const dark = this.standard(0x172554, 0.45, 0.25);
    const glow = new THREE.MeshStandardMaterial({ color: 0x67e8f9, emissive: 0x0891b2, emissiveIntensity: 2 });
    const body = this.mesh(new THREE.CapsuleGeometry(0.48, 0.7, 5, 10), suit, [0, 1.15, 0]);
    const chest = this.mesh(new THREE.BoxGeometry(0.82, 0.62, 0.22), armor, [0, 1.33, 0.4]);
    const chestLight = this.mesh(new THREE.BoxGeometry(0.28, 0.08, 0.05), glow, [0, 1.36, 0.53], false);
    const backpack = this.mesh(new THREE.BoxGeometry(0.64, 0.7, 0.3), dark, [0, 1.3, -0.45]);
    const antenna = this.mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.72, 6), dark, [-0.25, 1.95, -0.48], false);
    antenna.rotation.z = -0.1;
    const head = this.mesh(new THREE.SphereGeometry(0.38, 12, 10), skin, [0, 2.05, 0]);
    const helmet = this.mesh(new THREE.SphereGeometry(0.44, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.58), armor, [0, 2.13, 0]);
    const visor = this.mesh(new THREE.BoxGeometry(0.54, 0.18, 0.12), dark, [0, 2.08, 0.35], false);
    group.add(body, chest, chestLight, backpack, antenna, head, helmet, visor);
    for (const x of [-0.42, 0.42]) {
      const ear = this.mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 8), armor, [x, 2.09, 0], false);
      ear.rotation.z = Math.PI / 2;
      group.add(ear);
    }
    const arms: THREE.Group[] = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.54, 1.55, 0.05);
      const shoulder = this.mesh(new THREE.SphereGeometry(0.23, 8, 6), armor, [0, 0, 0]);
      shoulder.scale.set(1.15, 0.8, 1);
      const forearm = this.mesh(new THREE.CapsuleGeometry(0.12, 0.48, 3, 7), suit, [0, -0.38, 0.18]);
      forearm.rotation.x = 0.25;
      pivot.add(shoulder, forearm);
      group.add(pivot);
      arms.push(pivot);
    }
    const weapons: Record<WeaponType, THREE.Group> = {
      pistol: this.createWeapon('pistol', dark, glow), rifle: this.createWeapon('rifle', dark, glow), gatling: this.createWeapon('gatling', dark, glow),
    };
    Object.entries(weapons).forEach(([name, view]) => { view.visible = name === 'pistol'; group.add(view); });
    const legs: THREE.Group[] = [];
    for (const x of [-0.23, 0.23]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.77, 0);
      const leg = this.mesh(new THREE.CapsuleGeometry(0.16, 0.45, 4, 8), dark, [0, -0.42, 0]);
      const boot = this.mesh(new THREE.BoxGeometry(0.3, 0.22, 0.48), armor, [0, -0.78, 0.12]);
      pivot.add(leg, boot);
      group.add(pivot);
      legs.push(pivot);
    }
    group.userData.legs = legs;
    group.userData.arms = arms;
    group.userData.weapons = weapons;
    if (ally) group.scale.setScalar(0.82);
    return group;
  }

  private createWeapon(type: WeaponType, dark: THREE.MeshStandardMaterial, glow: THREE.MeshStandardMaterial): THREE.Group {
    const group = new THREE.Group();
    group.position.set(0.52, 1.36, 0.48);
    const procedural = new THREE.Group();
    group.add(procedural);
    group.userData.procedural = procedural;
    const metal = this.standard(type === 'gatling' ? 0x334155 : 0x1e293b, 0.27, 0.72);
    const accent = this.standard(type === 'rifle' ? 0x8b5a34 : 0xf97316, 0.5);
    if (type === 'pistol') {
      procedural.add(this.mesh(new THREE.BoxGeometry(0.24, 0.2, 0.82), metal, [0, 0, 0.12]));
      procedural.add(this.mesh(new THREE.BoxGeometry(0.26, 0.16, 0.55), dark, [0, -0.12, 0.02]));
      const grip = this.mesh(new THREE.BoxGeometry(0.18, 0.43, 0.22), dark, [0, -0.32, -0.08]);
      grip.rotation.x = -0.18;
      procedural.add(grip, this.mesh(new THREE.BoxGeometry(0.08, 0.07, 0.12), glow, [0, 0.14, 0.34], false));
    } else if (type === 'rifle') {
      procedural.add(this.mesh(new THREE.BoxGeometry(0.32, 0.32, 1.12), metal, [0, 0, 0.2]));
      procedural.add(this.mesh(new THREE.BoxGeometry(0.42, 0.45, 0.52), accent, [0, -0.02, -0.61]));
      const mag = this.mesh(new THREE.BoxGeometry(0.22, 0.48, 0.27), accent, [0, -0.37, 0.18]);
      mag.rotation.x = 0.2;
      procedural.add(mag, this.mesh(new THREE.BoxGeometry(0.28, 0.25, 0.58), accent, [0, 0, 0.86]));
      const barrel = this.mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.72, 8), metal, [0, 0, 1.28]);
      barrel.rotation.x = Math.PI / 2;
      const scope = this.mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.4, 8), dark, [0, 0.26, 0.2]);
      scope.rotation.x = Math.PI / 2;
      procedural.add(barrel, scope);
    } else {
      const drum = this.mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.52, 12), accent, [0, 0, 0.04]);
      drum.rotation.x = Math.PI / 2;
      procedural.add(drum);
      const barrelRig = new THREE.Group();
      for (const [x, y] of [[-0.14, -0.11], [0.14, -0.11], [0, 0.16], [0, -0.02]] as const) {
        const barrel = this.mesh(new THREE.CylinderGeometry(0.052, 0.052, 1.3, 7), metal, [x, y, 0.86]);
        barrel.rotation.x = Math.PI / 2;
        barrelRig.add(barrel);
      }
      procedural.add(barrelRig, this.mesh(new THREE.TorusGeometry(0.24, 0.055, 7, 14), metal, [0, 0, 1.48]));
      group.userData.spinPart = barrelRig;
    }
    const muzzleZ = type === 'pistol' ? 0.58 : type === 'rifle' ? 1.65 : 1.58;
    const muzzle = this.mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.16, 8), glow, [0, 0, muzzleZ], false);
    muzzle.rotation.x = Math.PI / 2;
    const flash = new THREE.Mesh(new THREE.OctahedronGeometry(type === 'gatling' ? 0.3 : 0.24, 0), new THREE.MeshBasicMaterial({ color: 0xfff27a }));
    flash.position.z = muzzleZ + 0.2;
    flash.visible = false;
    group.add(muzzle, flash);
    group.userData.muzzleFlash = flash;
    return group;
  }

  private createEnemy(enemy: EnemyState): THREE.Group {
    const root = new THREE.Group();
    const boss = enemy.boss || enemy.archetype === 'boss';
    const rig = new THREE.Group();
    root.add(rig);
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: boss ? 0x8f1239 : enemy.archetype === 'tank' ? 0x7f1d1d : enemy.archetype === 'flyer' ? 0x7c3aed : 0xe11d48,
      roughness: 0.48, metalness: enemy.archetype === 'tank' || boss ? 0.28 : 0.05,
      emissive: boss ? 0x5b1021 : 0x27040b, emissiveIntensity: 0.5,
    });
    const dark = this.standard(0x281629, 0.72);
    const horn = this.standard(0xffe4d6, 0.8);
    const eye = new THREE.MeshBasicMaterial({ color: 0xfff27a });
    const bodyMaterials = [bodyMaterial];
    if (enemy.archetype === 'tank') {
      rig.add(this.mesh(new THREE.BoxGeometry(1.45, 1.25, 1.15), bodyMaterial, [0, 0.9, 0]));
      for (const side of [-1, 1]) {
        rig.add(this.mesh(new THREE.BoxGeometry(0.45, 0.65, 1.35), dark, [side * 0.86, 1.05, 0]));
        const tusk = this.mesh(new THREE.ConeGeometry(0.13, 0.65, 7), horn, [side * 0.5, 0.72, 0.78]);
        tusk.rotation.x = Math.PI / 2;
        rig.add(tusk);
      }
    } else if (enemy.archetype === 'sprinter') {
      const body = this.mesh(new THREE.CapsuleGeometry(0.42, 0.85, 4, 8), bodyMaterial, [0, 1.05, 0]);
      body.rotation.x = 0.18;
      rig.add(body);
      for (const side of [-1, 1]) {
        const leg = this.mesh(new THREE.CapsuleGeometry(0.11, 0.8, 3, 6), dark, [side * 0.32, 0.25, -0.08]);
        leg.rotation.z = side * -0.18;
        rig.add(leg);
      }
    } else if (enemy.archetype === 'flyer') {
      rig.add(this.mesh(new THREE.SphereGeometry(0.62, 10, 8), bodyMaterial, [0, 1.2, 0]));
      const wings: THREE.Mesh[] = [];
      for (const side of [-1, 1]) {
        const wing = this.mesh(new THREE.ConeGeometry(0.55, 1.6, 4), bodyMaterial, [side * 0.92, 1.25, 0]);
        wing.rotation.z = side * -Math.PI / 2;
        wing.scale.z = 0.18;
        rig.add(wing);
        wings.push(wing);
      }
      root.userData.wings = wings;
    } else if (boss) {
      rig.add(this.mesh(new THREE.DodecahedronGeometry(1.45, 1), bodyMaterial, [0, 1.9, 0]));
      const armor = new THREE.MeshStandardMaterial({ color: 0x2f1b38, metalness: 0.65, roughness: 0.24, emissive: 0x3c102a, emissiveIntensity: 0.4 });
      bodyMaterials.push(armor);
      for (const side of [-1, 1]) {
        rig.add(this.mesh(new THREE.OctahedronGeometry(0.82, 0), armor, [side * 1.55, 2.3, 0]));
        rig.add(this.mesh(new THREE.DodecahedronGeometry(0.62, 0), bodyMaterial, [side * 2, 1.15, 0.1]));
      }
      for (let index = -2; index <= 2; index += 1) {
        const spike = this.mesh(new THREE.ConeGeometry(0.2, 1.05 + Math.abs(index) * 0.15, 7), horn, [index * 0.42, 3.55, 0]);
        spike.rotation.z = -index * 0.12;
        rig.add(spike);
      }
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.46, 0), eye);
      core.position.set(0, 2, 1.34);
      rig.add(core);
      root.userData.core = core;
    } else {
      rig.add(this.mesh(new THREE.DodecahedronGeometry(0.72, 0), bodyMaterial, [0, 0.82, 0]));
      for (const side of [-1, 1]) {
        const spike = this.mesh(new THREE.ConeGeometry(0.12, 0.5, 7), horn, [side * 0.38, 1.45, 0]);
        spike.rotation.z = side * -0.35;
        rig.add(spike);
      }
    }
    const faceScale = boss ? 1.55 : enemy.archetype === 'tank' ? 1.1 : 1;
    for (const side of [-1, 1]) rig.add(this.mesh(new THREE.SphereGeometry(0.08 * faceScale, 7, 5), eye, [side * 0.2 * faceScale, (boss ? 1.4 : 1.02) * faceScale, 0.57 * faceScale], false));
    this.addHealthBar(root, enemy.boss ? 1.9 : enemy.archetype === 'tank' ? 1.35 : 1, boss ? 4.25 : enemy.archetype === 'flyer' ? 2.3 : 2, enemy.boss ? 0xfbbf24 : 0x78ef68);
    root.userData.rig = rig;
    root.userData.proceduralModel = rig;
    root.userData.bodyMaterials = bodyMaterials;
    if (boss) {
      const aura = new THREE.Mesh(new THREE.TorusGeometry(1.75, 0.09, 8, 32), new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.72 }));
      aura.rotation.x = Math.PI / 2;
      aura.position.y = 0.08;
      root.add(aura);
      root.userData.aura = aura;
    }
    return root;
  }

  private addHealthBar(root: THREE.Group, width: number, y: number, color: number): void {
    const bar = new THREE.Group();
    bar.position.set(0, y, 0.05);
    const back = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x170f22, depthTest: false, depthWrite: false, toneMapped: false }));
    back.scale.set(width + 0.18, 0.2, 1);
    back.renderOrder = 20;
    const fill = new THREE.Sprite(new THREE.SpriteMaterial({ color, depthTest: false, depthWrite: false, toneMapped: false }));
    fill.scale.set(width, 0.105, 1);
    fill.position.z = 0.01;
    fill.renderOrder = 21;
    back.frustumCulled = false;
    fill.frustumCulled = false;
    bar.add(back, fill);
    root.add(bar);
    root.userData.healthBar = bar;
    root.userData.hpFill = fill;
    root.userData.hpWidth = width;
  }

  private updateHealthBar(view: THREE.Group, hp: number, maxHp: number, alive: boolean): void {
    const bar = view.userData.healthBar as THREE.Group | undefined;
    const fill = view.userData.hpFill as THREE.Sprite | undefined;
    const width = view.userData.hpWidth as number | undefined;
    if (!bar || !fill || width === undefined) return;
    bar.visible = alive;
    const ratio = THREE.MathUtils.clamp(maxHp > 0 ? hp / maxHp : 0, 0, 1);
    fill.visible = alive && ratio > 0;
    fill.scale.x = width * ratio;
    fill.position.x = -(1 - ratio) * width * 0.5;
  }

  private updateEnemy(view: THREE.Group, enemy: EnemyState, elapsed: number, baseAltitude: number): void {
    view.visible = enemy.alive;
    const hover = enemy.archetype === 'flyer' ? Math.sin(elapsed * 5 + enemy.movementPhase) * 0.18 : Math.sin(elapsed * 4 + enemy.id) * 0.08;
    this.track.place(view, enemy.z, enemy.x, baseAltitude + 0.06 + enemy.altitude + hover);
    const idleTurn = Math.sin(elapsed * 2.2 + enemy.id) * (enemy.archetype === 'tank' ? 0.04 : 0.12);
    // Enemies advance toward decreasing track progress, so they must face
    // opposite the track's forward tangent. This also corrects the Boss GLB.
    view.rotation.y += Math.PI + idleTurn;
    const bodyMaterials = view.userData.bodyMaterials as THREE.MeshStandardMaterial[];
    for (const material of bodyMaterials) material.emissive.setHex(enemy.hitFlash > 0 ? 0xffffff : enemy.boss ? 0x5b1021 : 0x27040b);
    this.updateHealthBar(view, enemy.hp, enemy.maxHp, enemy.alive);
    const aura = view.userData.aura as THREE.Mesh | undefined;
    if (aura) aura.rotation.z = elapsed * 0.8;
    const wings = view.userData.wings as THREE.Mesh[] | undefined;
    if (wings) { wings[0].rotation.y = Math.sin(elapsed * 12) * 0.7; wings[1].rotation.y = -Math.sin(elapsed * 12) * 0.7; }
    const core = view.userData.core as THREE.Mesh | undefined;
    if (core) core.scale.setScalar(0.85 + Math.sin(elapsed * 5) * 0.18);
  }

  private createObstacle(obstacle: ObstacleState): THREE.Group {
    const group = new THREE.Group();
    const dangerous = new THREE.MeshStandardMaterial({ color: obstacle.fatal ? 0x52101b : 0xb45309, roughness: 0.62, emissive: obstacle.fatal ? 0x3b060b : 0x2b1100, emissiveIntensity: 0.42 });
    const metal = this.standard(0x303846, 0.35, 0.62);
    const stripe = new THREE.MeshStandardMaterial({ color: 0xffc928, emissive: 0x5c2e00, emissiveIntensity: 0.4 });
    const model = new THREE.Group();
    if (obstacle.fatal) {
      const rock = this.mesh(new THREE.DodecahedronGeometry(Math.max(0.7, obstacle.radius), 1), dangerous, [0, obstacle.radius, 0]);
      rock.scale.y = 1.2;
      model.add(rock);
      for (let index = 0; index < 5; index += 1) {
        const spike = this.mesh(new THREE.ConeGeometry(0.12, 0.65, 7), metal, [Math.sin(index * 2.4) * obstacle.radius * 0.7, obstacle.radius * (0.7 + (index % 2) * 0.6), Math.cos(index * 2.4) * obstacle.radius * 0.65]);
        spike.rotation.z = Math.sin(index) * 0.6;
        model.add(spike);
      }
    } else {
      model.add(this.mesh(new THREE.BoxGeometry(obstacle.radius * 1.8, Math.max(1.2, obstacle.radius * 1.7), obstacle.radius * 1.4), dangerous, [0, Math.max(0.6, obstacle.radius * 0.85), 0]));
      for (const y of [0.28, 1.15]) model.add(this.mesh(new THREE.BoxGeometry(obstacle.radius * 1.92, 0.16, obstacle.radius * 1.5), stripe, [0, y, 0], false));
      model.add(this.mesh(new THREE.BoxGeometry(0.16, 1.3, obstacle.radius * 1.5), metal, [0, 0.72, 0], false));
    }
    group.add(model);
    const label = this.createTextSprite(`${obstacle.label} · 击破得${obstacle.rewardLabel}`, obstacle.fatal ? 0xff3f56 : 0xffb629);
    label.position.set(0, obstacle.radius * 2 + 0.8, 0.1);
    label.scale.set(3.35, 0.8, 1);
    group.add(label);
    this.addHealthBar(group, 1.4, obstacle.radius * 2 + 0.3, obstacle.fatal ? 0xff6a58 : 0x5dff7b);
    group.userData.model = model;
    group.userData.material = dangerous;
    return group;
  }

  private updateObstacle(view: THREE.Group, obstacle: ObstacleState, elapsed: number, baseAltitude: number): void {
    view.visible = obstacle.alive;
    this.track.place(view, obstacle.z, obstacle.x, baseAltitude);
    if (obstacle.fatal) (view.userData.model as THREE.Group).rotation.y = elapsed * 0.45 + obstacle.id;
    (view.userData.material as THREE.MeshStandardMaterial).emissive.setHex(obstacle.hitFlash > 0 ? 0xffffff : obstacle.fatal ? 0x3b060b : 0x2b1100);
    this.updateHealthBar(view, obstacle.hp, obstacle.maxHp, obstacle.alive);
  }

  private createPickup(pickup: PickupState): THREE.Group {
    const group = new THREE.Group();
    const colors = { shield: 0x41d9ff, bomb: 0xff713b, magnet: 0xd65cff, heal: 0x53f28a } as const;
    const color = colors[pickup.type];
    const material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.72, metalness: 0.28, roughness: 0.3 });
    if (pickup.type === 'shield') {
      const icon = this.mesh(new THREE.IcosahedronGeometry(0.5, 1), material, [0, 0, 0], false); icon.scale.set(0.8, 1.1, 0.3); group.add(icon);
    } else if (pickup.type === 'bomb') {
      group.add(this.mesh(new THREE.SphereGeometry(0.42, 10, 8), material, [0, 0, 0], false));
      group.add(this.mesh(new THREE.TorusGeometry(0.18, 0.045, 6, 10, Math.PI), material, [0.15, 0.42, 0], false));
    } else if (pickup.type === 'magnet') {
      const magnet = this.mesh(new THREE.TorusGeometry(0.45, 0.14, 7, 12, Math.PI * 1.45), material, [0, 0, 0], false); magnet.rotation.z = -Math.PI * 0.72; group.add(magnet);
    } else {
      group.add(this.mesh(new THREE.BoxGeometry(0.85, 0.25, 0.25), material, [0, 0, 0], false));
      group.add(this.mesh(new THREE.BoxGeometry(0.25, 0.85, 0.25), material, [0, 0, 0], false));
    }
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.05, 7, 22), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.72 }));
    halo.rotation.x = Math.PI / 2;
    group.add(halo);
    return group;
  }

  private createVehicleRig(): THREE.Group {
    const root = new THREE.Group();
    const vehicles: Record<Exclude<VehicleMode, 'onFoot'>, THREE.Group> = {
      car: this.createCar(),
      minecart: this.createMinecart(),
      plane: this.createPlane(),
      submarine: this.createSubmarine(),
    };
    Object.values(vehicles).forEach((vehicle) => { vehicle.visible = false; root.add(vehicle); });
    root.userData.vehicles = vehicles;
    return root;
  }

  private createCar(): THREE.Group {
    const group = new THREE.Group();
    const blue = this.standard(0x2563eb, 0.28, 0.58);
    const dark = this.standard(0x151b2a, 0.46, 0.45);
    group.add(this.mesh(new THREE.BoxGeometry(3.25, 0.58, 4.2), blue, [0, 0.68, 0]));
    group.add(this.mesh(new THREE.BoxGeometry(2.55, 0.42, 1.6), blue, [0, 1.08, 1.2]));
    group.add(this.mesh(new THREE.BoxGeometry(2.15, 0.75, 1.65), dark, [0, 1.22, -0.72]));
    const wheels: THREE.Mesh[] = [];
    for (const x of [-1.72, 1.72]) for (const z of [-1.25, 1.25]) {
      const wheel = this.mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.38, 12), dark, [x, 0.5, z]);
      wheel.rotation.z = Math.PI / 2;
      group.add(wheel);
      wheels.push(wheel);
    }
    group.userData.spinParts = wheels;
    const weaponMount = this.createVehicleWeaponMount('car');
    group.add(weaponMount);
    group.userData.weaponMount = weaponMount;
    return group;
  }

  private createMinecart(): THREE.Group {
    const group = new THREE.Group();
    const iron = this.standard(0x59616d, 0.42, 0.72);
    const dark = this.standard(0x171a20, 0.5, 0.55);
    const timber = this.standard(0x7a4726, 0.9, 0.08);
    const crystal = this.standard(0x9b78ff, 0.24, 0.48);
    group.add(this.mesh(new THREE.BoxGeometry(2.75, 0.32, 3.2), dark, [0, 0.48, 0]));
    group.add(this.mesh(new THREE.BoxGeometry(2.4, 0.95, 2.55), iron, [0, 1.02, 0.15]));
    group.add(this.mesh(new THREE.BoxGeometry(1.95, 0.76, 2.15), dark, [0, 1.2, 0.18]));
    for (const x of [-1.38, 1.38]) {
      group.add(this.mesh(new THREE.BoxGeometry(0.18, 0.9, 2.75), timber, [x, 1.03, 0.12]));
    }
    const wheels: THREE.Mesh[] = [];
    for (const x of [-1.25, 1.25]) for (const z of [-1.05, 1.05]) {
      const wheel = this.mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.25, 12), dark, [x, 0.36, z]);
      wheel.rotation.z = Math.PI / 2;
      group.add(wheel);
      wheels.push(wheel);
    }
    const lamp = this.mesh(new THREE.OctahedronGeometry(0.3, 0), crystal, [0, 1.42, 1.55], false);
    group.add(lamp);
    group.userData.spinParts = wheels;
    const weaponMount = this.createVehicleWeaponMount('minecart');
    group.add(weaponMount);
    group.userData.weaponMount = weaponMount;
    return group;
  }

  private createPlane(): THREE.Group {
    const group = new THREE.Group();
    const metal = this.standard(0x4f8ef7, 0.28, 0.55);
    const accent = this.standard(0xff8a2b, 0.35, 0.38);
    const body = this.mesh(new THREE.CapsuleGeometry(0.58, 3.5, 7, 12), metal, [0, 0.25, 0]); body.rotation.x = Math.PI / 2;
    group.add(body, this.mesh(new THREE.BoxGeometry(5.5, 0.16, 1.4), metal, [0, 0, -0.2]));
    group.add(this.mesh(new THREE.BoxGeometry(2.2, 0.12, 0.65), accent, [0, 0, -1.75]));
    const fin = this.mesh(new THREE.ConeGeometry(0.42, 1.1, 4), accent, [0, 0.72, -1.68]); fin.rotation.z = Math.PI / 4; group.add(fin);
    for (const x of [-1.85, 1.85]) { const engine = this.mesh(new THREE.CylinderGeometry(0.32, 0.42, 1.25, 10), accent, [x, -0.15, 0.18]); engine.rotation.x = Math.PI / 2; group.add(engine); }
    const weaponMount = this.createVehicleWeaponMount('plane');
    group.add(weaponMount);
    group.userData.weaponMount = weaponMount;
    return group;
  }

  private createSubmarine(): THREE.Group {
    const group = new THREE.Group();
    const yellow = this.standard(0xf5b82e, 0.3, 0.5);
    const dark = this.standard(0x17334b, 0.25, 0.58);
    const hull = this.mesh(new THREE.CapsuleGeometry(0.92, 3.2, 8, 14), yellow, [0, 0, 0]); hull.rotation.x = Math.PI / 2;
    group.add(hull, this.mesh(new THREE.BoxGeometry(0.85, 0.65, 1.1), dark, [0, 0.78, -0.2]));
    for (const x of [-0.55, 0.55]) group.add(this.mesh(new THREE.SphereGeometry(0.2, 8, 6), new THREE.MeshBasicMaterial({ color: 0x72ecff }), [x, 0.18, 0.75], false));
    group.add(this.mesh(new THREE.BoxGeometry(3, 0.12, 0.85), dark, [0, 0, -0.65]));
    const weaponMount = this.createVehicleWeaponMount('submarine');
    group.add(weaponMount);
    group.userData.weaponMount = weaponMount;
    return group;
  }

  private createVehicleWeaponMount(mode: Exclude<VehicleMode, 'onFoot'>): THREE.Group {
    const root = new THREE.Group();
    const metal = this.standard(0x202938, 0.3, 0.78);
    const accent = this.standard(mode === 'submarine' ? 0x45e7ff : mode === 'plane' ? 0xff9d2e : 0xf3c846, 0.28, 0.52);
    const makeBarrel = (x: number, radius: number, length: number): THREE.Mesh => {
      const barrel = this.mesh(new THREE.CylinderGeometry(radius, radius, length, 10), accent, [x, 0, length * 0.5]);
      barrel.rotation.x = Math.PI / 2;
      return barrel;
    };
    const single = new THREE.Group();
    single.add(makeBarrel(0, 0.13, 1.5));
    const twin = new THREE.Group();
    const twinSpread = mode === 'plane' ? 1.35 : mode === 'submarine' ? 0.52 : 0.32;
    twin.add(makeBarrel(-twinSpread, 0.11, 1.62), makeBarrel(twinSpread, 0.11, 1.62));
    const gatling = new THREE.Group();
    const spinner = new THREE.Group();
    for (let index = 0; index < 6; index += 1) {
      const angle = index / 6 * Math.PI * 2;
      const barrel = makeBarrel(Math.cos(angle) * 0.22, 0.065, 1.75);
      barrel.position.y = Math.sin(angle) * 0.22;
      spinner.add(barrel);
    }
    gatling.add(spinner);
    gatling.add(this.mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.48, 12), accent, [0, 0, 0.28]));
    (gatling.children.at(-1) as THREE.Mesh).rotation.x = Math.PI / 2;
    const flash = this.mesh(new THREE.OctahedronGeometry(0.28, 0), new THREE.MeshBasicMaterial({ color: 0xffec75 }), [0, 0, 1.95], false);
    flash.visible = false;
    root.add(this.mesh(new THREE.SphereGeometry(0.34, 10, 7), metal, [0, 0, 0], false), single, twin, gatling, flash);
    const positions = {
      car: [0, 2.05, 0.65],
      minecart: [0, 2.15, 0.72],
      plane: [0, 0.62, 1.05],
      submarine: [0, 1.28, 1.02],
    } as const;
    const [mountX, mountY, mountZ] = positions[mode];
    root.position.set(mountX, mountY, mountZ);
    root.userData.single = single;
    root.userData.twin = twin;
    root.userData.gatling = gatling;
    root.userData.spinner = spinner;
    root.userData.flash = flash;
    return root;
  }

  private updateVehicle(
    mode: VehicleMode,
    x: number,
    z: number,
    weapon: WeaponType,
    projectileCount: number,
    elapsed: number,
  ): void {
    const vehicles = this.vehicleRig.userData.vehicles as Record<Exclude<VehicleMode, 'onFoot'>, THREE.Group>;
    Object.entries(vehicles).forEach(([name, vehicle]) => { vehicle.visible = name === mode; });
    this.track.place(this.vehicleRig, z, x, this.vehicleAltitude(mode, z));
    this.vehicleRig.rotation.z = mode === 'plane' ? Math.sin(elapsed * 1.9) * 0.055 : 0;
    if (mode === 'car') for (const wheel of vehicles.car.userData.spinParts as THREE.Mesh[]) wheel.rotation.x = elapsed * 9;
    if (mode === 'minecart') for (const wheel of vehicles.minecart.userData.spinParts as THREE.Mesh[]) wheel.rotation.x = elapsed * 11;
    if (mode === 'onFoot') return;
    const mount = vehicles[mode].userData.weaponMount as THREE.Group;
    const useGatling = weapon === 'gatling';
    const useTwin = !useGatling && projectileCount > 1;
    (mount.userData.single as THREE.Group).visible = !useGatling && !useTwin;
    (mount.userData.twin as THREE.Group).visible = useTwin;
    (mount.userData.gatling as THREE.Group).visible = useGatling;
    (mount.userData.spinner as THREE.Group).rotation.z = elapsed * 26;
    const flash = mount.userData.flash as THREE.Mesh;
    flash.visible = this.muzzleLife > 0;
    if (flash.visible) flash.scale.setScalar(0.8 + this.muzzleLife * 10);
  }

  private vehicleAltitude(mode: VehicleMode, z = 0): number {
    if (mode === 'plane') {
      const takeoff = THREE.MathUtils.smoothstep(z, 2, 52);
      return 0.62 + takeoff * 2.58;
    }
    if (mode === 'submarine') return 0.85;
    if (mode === 'car') return 0.62;
    if (mode === 'minecart') return 0.45;
    return 0;
  }

  private applyLoadedModel(key: RuntimeModelKey): void {
    if (this.disposed) return;
    if (key === 'boss') {
      for (const view of this.enemyViews.values()) {
        if (!view.userData.aura || view.userData.productionModel) continue;
        const clone = this.models.clone('boss');
        if (!clone) continue;
        (view.userData.proceduralModel as THREE.Group).visible = false;
        view.add(clone);
        view.userData.productionModel = clone;
      }
      return;
    }
    if (key === 'car' || key === 'plane' || key === 'submarine') {
      const vehicles = this.vehicleRig.userData.vehicles as Record<Exclude<VehicleMode, 'onFoot'>, THREE.Group>;
      const vehicle = vehicles[key];
      if (vehicle.userData.productionModel) return;
      const clone = this.models.clone(key);
      if (!clone) return;
      const weaponMount = vehicle.userData.weaponMount as THREE.Group | undefined;
      for (const child of vehicle.children) child.visible = child === weaponMount;
      if (key === 'submarine') clone.rotation.y = Math.PI / 2;
      vehicle.add(clone);
      vehicle.userData.productionModel = clone;
      return;
    }
    for (const soldier of [this.player, ...this.allies]) {
      const weapon = (soldier.userData.weapons as Record<WeaponType, THREE.Group>)[key];
      if (!weapon || weapon.userData.productionModel) continue;
      const clone = this.models.clone(key);
      if (!clone) continue;
      clone.position.z = key === 'gatling' ? -0.02 : -0.08;
      weapon.add(clone);
      (weapon.userData.procedural as THREE.Group).visible = false;
      weapon.userData.productionModel = clone;
    }
  }

  private addGate(item: GateState): THREE.Group { const view = this.createGate(item); this.gateViews.set(item.id, view); this.scene.add(view); return view; }
  private addEnemy(item: EnemyState): THREE.Group { const view = this.createEnemy(item); this.enemyViews.set(item.id, view); this.scene.add(view); if (item.boss && this.models.clone('boss')) this.applyLoadedModel('boss'); return view; }
  private addObstacle(item: ObstacleState): THREE.Group { const view = this.createObstacle(item); this.obstacleViews.set(item.id, view); this.scene.add(view); return view; }
  private addPickup(item: PickupState): THREE.Group { const view = this.createPickup(item); this.pickupViews.set(item.id, view); this.scene.add(view); return view; }
  private addHazard(item: HazardState): THREE.Group { const view = this.createHazard(item); this.hazardViews.set(item.id, view); this.scene.add(view); return view; }

  private createHazard(hazard: HazardState): THREE.Group {
    const group = new THREE.Group();
    this.track.place(group, hazard.z, hazard.x);
    const discMaterial = new THREE.MeshBasicMaterial({
      color: hazard.color,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: hazard.color,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
    });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(hazard.radius, 28), discMaterial);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.045;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(hazard.radius, 0.075, 7, 28), ringMaterial);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.065;
    const cross = new THREE.Group();
    for (const rotation of [0, Math.PI / 2]) {
      const line = this.mesh(new THREE.BoxGeometry(hazard.radius * 1.45, 0.035, 0.075), ringMaterial, [0, 0.08, 0], false);
      line.rotation.y = rotation;
      cross.add(line);
    }
    const beaconMaterial = new THREE.MeshBasicMaterial({ color: hazard.color, transparent: true, opacity: 0.2, depthWrite: false });
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.04, hazard.radius * 0.48, 5.2, 16, 1, true), beaconMaterial);
    beacon.position.y = 2.6;
    group.add(disc, ring, cross, beacon);
    if (hazard.showLabel) {
      const label = this.createTextSprite(`⚠ ${hazard.label} · 躲开红区`, hazard.color);
      label.position.set(0.7, 2.15, 0.08);
      label.scale.set(2.45, 0.76, 1);
      group.add(label);
    }
    group.userData.discMaterial = discMaterial;
    group.userData.ringMaterial = ringMaterial;
    group.userData.beaconMaterial = beaconMaterial;
    group.userData.ring = ring;
    group.userData.waveId = hazard.waveId;
    return group;
  }

  private updateHazard(view: THREE.Group, hazard: HazardState, elapsed: number, baseAltitude: number): void {
    view.visible = !hazard.resolved;
    if (!view.visible) return;
    this.track.place(view, hazard.z, hazard.x, baseAltitude + 0.03);
    const pulse = 0.5 + Math.sin(elapsed * 4.2 + hazard.id) * 0.5;
    const ring = view.userData.ring as THREE.Mesh;
    ring.scale.setScalar(0.92 + pulse * 0.13);
    (view.userData.discMaterial as THREE.MeshBasicMaterial).opacity = hazard.warned ? 0.28 + pulse * 0.16 : 0.12 + pulse * 0.08;
    (view.userData.ringMaterial as THREE.MeshBasicMaterial).opacity = hazard.warned ? 0.72 + pulse * 0.26 : 0.42 + pulse * 0.22;
    (view.userData.beaconMaterial as THREE.MeshBasicMaterial).opacity = hazard.warned ? 0.12 + pulse * 0.2 : 0.05;
  }

  private createGate(gate: GateState): THREE.Group {
    const group = new THREE.Group();
    this.track.place(group, gate.z, gate.x);
    const material = new THREE.MeshStandardMaterial({ color: gate.color, emissive: gate.color, emissiveIntensity: 0.25, transparent: true, opacity: 0.82, roughness: 0.36 });
    for (const x of [-1.12, 1.12]) group.add(this.mesh(new THREE.BoxGeometry(0.16, 2.75, 0.16), material, [x, 1.38, 0], false));
    group.add(this.mesh(new THREE.BoxGeometry(2.4, 0.16, 0.16), material, [0, 2.72, 0], false));
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(2.16, 2.45), new THREE.MeshBasicMaterial({ color: gate.color, transparent: true, opacity: 0.1, side: THREE.DoubleSide }));
    halo.position.y = 1.38;
    group.add(halo);
    const selector = this.mesh(
      new THREE.OctahedronGeometry(0.24, 0),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: gate.color, emissiveIntensity: 2.2 }),
      [0, 3.08, 0],
      false,
    );
    selector.visible = false;
    group.add(selector);
    group.userData.halo = halo;
    group.userData.frameMaterial = material;
    group.userData.selector = selector;
    const label = this.createTextSprite(gate.label, gate.color); label.position.set(0, 2.15, 0.08); group.add(label);
    group.userData.label = label;
    group.userData.labelText = gate.label;
    if (gate.shootable) this.addHealthBar(group, 1.75, 2.93, 0x67e8f9);
    return group;
  }

  private updateGateLabel(view: THREE.Group, gate: GateState): void {
    if (view.userData.labelText === gate.label) return;
    const previous = view.userData.label as THREE.Sprite | undefined;
    if (previous) {
      view.remove(previous);
      previous.material.map?.dispose();
      previous.material.dispose();
    }
    const label = this.createTextSprite(gate.label, gate.color);
    label.position.set(0, 2.15, 0.08);
    view.add(label);
    view.userData.label = label;
    view.userData.labelText = gate.label;
  }

  private createTextSprite(text: string, color: number): THREE.Sprite {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 160;
    const context = canvas.getContext('2d');
    if (context) {
      context.fillStyle = 'rgba(16,20,45,.84)'; context.beginPath(); context.roundRect(18, 16, 476, 128, 32); context.fill();
      context.strokeStyle = `#${color.toString(16).padStart(6, '0')}`; context.lineWidth = 8; context.stroke();
      const fontSize = Math.max(30, Math.min(58, Math.floor(750 / Math.max(8, text.length))));
      context.fillStyle = '#fff'; context.font = `700 ${fontSize}px system-ui,sans-serif`; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(text, 256, 82);
    }
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
    sprite.scale.set(3.2, 1, 1); sprite.renderOrder = 6; return sprite;
  }

  private handleEvents(events: GameEvent[]): void {
    for (const event of events) {
      if (event.type === 'shot') this.muzzleLife = 0.065;
      if (event.type === 'enemyHit') {
        const position = this.enemyViews.get(event.enemyId)?.position ?? this.player.position;
        this.spawnBurst(position.x, position.z, 0xffd65c, 4, position.y + 0.8);
        this.spawnFloatingText(`-${Math.round(event.damage)}`, position.x, position.z, 0xfff27a, position.y + 1.8);
        this.cameraShake = Math.max(this.cameraShake, 0.025);
      }
      if (event.type === 'enemyDefeated') {
        const position = this.enemyViews.get(event.enemyId)?.position ?? this.player.position;
        this.spawnBurst(position.x, position.z, event.boss ? 0xfbbf24 : 0xfb7185, event.boss ? 22 : 10, position.y + 0.8);
        if (event.combo > 1 && !event.boss) this.spawnFloatingText(`连击 ×${event.combo}`, position.x, position.z, 0xb9f34a, position.y + 1.8);
        this.cameraShake = Math.max(this.cameraShake, event.boss ? 0.42 : 0.09);
      }
      if (event.type === 'gate') this.spawnBurst(this.player.position.x, this.player.position.z + 0.5, event.color, 14);
      if (event.type === 'gateCharged') {
        const position = this.gateViews.get(event.gateId)?.position ?? this.player.position;
        this.spawnBurst(position.x, position.z, event.color, event.converted ? 16 : 5, position.y + 1.4);
        if (event.converted) this.spawnFloatingText('负面已转正', position.x, position.z, event.color, position.y + 2.7);
        else if (event.progress >= 1) this.spawnFloatingText('强化已充满', position.x, position.z, event.color, position.y + 2.7);
      }
      if (event.type === 'playerHit') { this.spawnBurst(this.player.position.x, this.player.position.z, 0xff3b5c, 8); this.spawnFloatingText(`-${event.amount}`, this.player.position.x, this.player.position.z, 0xff5470); this.cameraShake = Math.max(this.cameraShake, 0.22); }
      if (event.type === 'obstacleHit') {
        const position = this.obstacleViews.get(event.obstacleId)?.position ?? this.player.position;
        this.spawnBurst(position.x, position.z, 0xffa62b, 7, position.y + 0.8);
        this.spawnFloatingText(`-${Math.round(event.damage)}`, position.x, position.z, 0xffd65c, position.y + 1.8);
        this.cameraShake = Math.max(this.cameraShake, 0.045);
      }
      if (event.type === 'obstacleDestroyed') {
        const position = this.obstacleViews.get(event.obstacleId)?.position ?? this.player.position;
        this.spawnBurst(position.x, position.z, 0xff713b, 18, position.y + 0.8);
        this.spawnFloatingText('路障击破', position.x, position.z, 0xffd36b, position.y + 1.8);
        this.cameraShake = Math.max(this.cameraShake, 0.18);
      }
      if (event.type === 'obstacleReward') {
        this.spawnBurst(this.player.position.x, this.player.position.z, event.color, 18, this.player.position.y + 0.9);
        this.spawnFloatingText(event.label, this.player.position.x, this.player.position.z, event.color, this.player.position.y + 2.5);
      }
      if (event.type === 'hazardWarning') {
        const view = [...this.hazardViews.values()].find((item) => item.userData.waveId === event.waveId);
        const position = view?.position ?? this.player.position;
        this.spawnFloatingText(`⚠ ${event.label}`, position.x, position.z, event.color, position.y + 2.5);
        this.spawnBurst(position.x, position.z, event.color, 9, position.y + 0.3);
      }
      if (event.type === 'hazardHit') {
        const view = [...this.hazardViews.values()].find((item) => item.userData.waveId === event.waveId);
        const position = view?.position ?? this.player.position;
        this.spawnBurst(position.x, position.z, event.color, 22, position.y + 0.8);
        this.spawnFloatingText(`${event.label} -${event.amount}`, this.player.position.x, this.player.position.z, 0xff6b5d, this.player.position.y + 2.4);
        this.cameraShake = Math.max(this.cameraShake, 0.34);
      }
      if (event.type === 'hazardAvoided') {
        this.spawnBurst(this.player.position.x, this.player.position.z, event.color, 15, this.player.position.y + 0.7);
        this.spawnFloatingText(`完美闪避 +${event.score}`, this.player.position.x, this.player.position.z, event.color, this.player.position.y + 2.4);
      }
      if (event.type === 'obstacleCollision') this.cameraShake = Math.max(this.cameraShake, event.fatal ? 0.48 : 0.3);
      if (event.type === 'pickup') { const colors = { shield: 0x41d9ff, bomb: 0xff713b, magnet: 0xd65cff, heal: 0x53f28a } as const; this.spawnBurst(this.player.position.x, this.player.position.z, colors[event.pickupType], 18); }
      if (event.type === 'bombDetonated') this.spawnBombWave(event.targetsHit, event.targetsDestroyed);
      if (event.type === 'shieldHit') { this.spawnBurst(this.player.position.x, this.player.position.z, 0x41d9ff, 9); this.cameraShake = Math.max(this.cameraShake, 0.08); }
      if (event.type === 'segmentChanged') this.spawnFloatingText(event.title, this.player.position.x, this.player.position.z + 2.5, 0xffffff);
    }
  }

  private spawnBurst(x: number, z: number, color: number, count: number, y = this.player.position.y + 0.8): void {
    let material = this.particleMaterials.get(color);
    if (!material) { material = new THREE.MeshBasicMaterial({ color }); this.particleMaterials.set(color, material); }
    for (let index = 0; index < count; index += 1) {
      const mesh = new THREE.Mesh(this.particleGeometry, material); mesh.scale.setScalar(0.6 + Math.random() * 0.75); mesh.position.set(x, y + Math.random() * 0.8, z); this.scene.add(mesh);
      this.particles.push({ mesh, velocity: new THREE.Vector3((Math.random() - 0.5) * 5, 2 + Math.random() * 4, (Math.random() - 0.5) * 5), life: 0.45 + Math.random() * 0.35 });
    }
  }

  private updateParticles(dt: number): void {
    for (let index = this.particles.length - 1; index >= 0; index -= 1) {
      const item = this.particles[index]; item.life -= dt; item.velocity.y -= dt * 8; item.mesh.position.addScaledVector(item.velocity, dt); item.mesh.rotation.x += dt * 8; item.mesh.rotation.y += dt * 6; item.mesh.scale.setScalar(Math.max(0.01, item.life * 1.7));
      if (item.life <= 0) { this.scene.remove(item.mesh); this.particles.splice(index, 1); }
    }
  }

  private spawnFloatingText(text: string, x: number, z: number, color: number, y = this.player.position.y + 2.1): void {
    const key = `${text}:${color}`;
    let texture = this.floatingTextTextures.get(key);
    if (!texture) {
      const canvas = document.createElement('canvas'); canvas.width = 384; canvas.height = 128; const context = canvas.getContext('2d');
      if (context) { context.fillStyle = `#${color.toString(16).padStart(6, '0')}`; context.strokeStyle = '#172036'; context.lineWidth = 12; context.font = '900 58px system-ui,sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.strokeText(text, 192, 64); context.fillText(text, 192, 64); }
      texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; this.floatingTextTextures.set(key, texture);
    }
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false })); sprite.position.set(x, y, z); sprite.scale.set(2.4, 0.8, 1); sprite.renderOrder = 9; this.scene.add(sprite); this.floatingTexts.push({ sprite, life: 0.78 });
  }

  private updateFloatingTexts(dt: number): void {
    for (let index = this.floatingTexts.length - 1; index >= 0; index -= 1) {
      const item = this.floatingTexts[index]; item.life -= dt; item.sprite.position.y += dt * 1.55; const material = item.sprite.material as THREE.SpriteMaterial; material.opacity = Math.min(1, item.life * 2.5);
      if (item.life <= 0) { this.scene.remove(item.sprite); material.dispose(); this.floatingTexts.splice(index, 1); }
    }
  }

  private spawnBombWave(targetsHit: number, targetsDestroyed: number): void {
    const material = new THREE.MeshBasicMaterial({
      color: 0xff8a32,
      transparent: true,
      opacity: 0.58,
      wireframe: true,
      depthWrite: false,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), material);
    mesh.position.copy(this.player.position);
    mesh.position.y += 0.9;
    mesh.scale.setScalar(0.35);
    mesh.renderOrder = 15;
    this.scene.add(mesh);
    this.shockwaves.push({ mesh, material, life: 0.85, maxLife: 0.85 });
    this.spawnBurst(this.player.position.x, this.player.position.z, 0xffb12f, 54, this.player.position.y + 0.35);
    this.spawnFloatingText(`全屏爆破 ${targetsHit} / 击破 ${targetsDestroyed}`, this.player.position.x, this.player.position.z + 1.4, 0xffe56b, this.player.position.y + 3.1);
    this.cameraShake = Math.max(this.cameraShake, 0.52);
  }

  private updateShockwaves(dt: number): void {
    for (let index = this.shockwaves.length - 1; index >= 0; index -= 1) {
      const wave = this.shockwaves[index];
      wave.life -= dt;
      const progress = 1 - Math.max(0, wave.life) / wave.maxLife;
      const scale = 0.35 + progress * 14;
      wave.mesh.scale.setScalar(scale);
      wave.mesh.rotation.y += dt * 2.4;
      wave.material.opacity = (1 - progress) * 0.58;
      if (wave.life > 0) continue;
      this.scene.remove(wave.mesh);
      wave.mesh.geometry.dispose();
      wave.material.dispose();
      this.shockwaves.splice(index, 1);
    }
  }

  private standard(color: number, roughness: number, metalness = 0): THREE.MeshStandardMaterial { return new THREE.MeshStandardMaterial({ color, roughness, metalness }); }
  private mesh(geometry: THREE.BufferGeometry, material: THREE.Material, position: readonly [number, number, number], castShadow = true): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(...position); mesh.castShadow = castShadow; return mesh;
  }
}
