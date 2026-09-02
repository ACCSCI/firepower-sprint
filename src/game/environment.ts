import * as THREE from 'three';
import type { TrackPath } from './track';
import type { BiomeType, LevelSegment } from './types';

interface AnimatedProp {
  object: THREE.Object3D;
  baseY: number;
  phase: number;
  motion: 'float' | 'spin' | 'bubble';
}

interface Theme {
  sky: number;
  fog: number;
  track: number;
  edge: number;
  ground: number;
  hemiSky: number;
  hemiGround: number;
  sun: number;
}

const THEMES: Record<BiomeType, Theme> = {
  surface: { sky: 0x83d7ff, fog: 0xa4e3ff, track: 0x65569a, edge: 0xd5ccff, ground: 0x43ad75, hemiSky: 0xdff8ff, hemiGround: 0x315545, sun: 0xfff0c2 },
  cloud: { sky: 0x4e92ea, fog: 0xc9e9ff, track: 0xd7e7ff, edge: 0xffffff, ground: 0x8dc7ff, hemiSky: 0xffffff, hemiGround: 0x5d83c0, sun: 0xfff8dc },
  mine: { sky: 0x131126, fog: 0x211b35, track: 0x423950, edge: 0xd49a42, ground: 0x17131e, hemiSky: 0x6f658d, hemiGround: 0x0a0810, sun: 0xffbd69 },
  ocean: { sky: 0x08657b, fog: 0x0d8190, track: 0x28788a, edge: 0x65e6e0, ground: 0x0b495b, hemiSky: 0x78efff, hemiGround: 0x042f45, sun: 0xb5fff6 },
  hell: { sky: 0x350b16, fog: 0x5b1019, track: 0x3b2832, edge: 0xff8b2c, ground: 0x16060b, hemiSky: 0xff7253, hemiGround: 0x120008, sun: 0xff9b45 },
};

export class EnvironmentVisual {
  private readonly root = new THREE.Group();
  private readonly animated: AnimatedProp[] = [];
  private readonly background = new THREE.Color();
  private readonly fogColor = new THREE.Color();
  private readonly target = new THREE.Color();
  private readonly geometries = {
    cone: new THREE.ConeGeometry(0.8, 2.5, 7),
    rock: new THREE.DodecahedronGeometry(0.75, 0),
    cloud: new THREE.SphereGeometry(0.8, 9, 7),
    crystal: new THREE.OctahedronGeometry(0.56, 0),
    coral: new THREE.CylinderGeometry(0.12, 0.28, 1.8, 7),
    bubble: new THREE.SphereGeometry(0.12, 7, 5),
    post: new THREE.BoxGeometry(0.18, 2.8, 0.18),
  };

  constructor(
    private readonly scene: THREE.Scene,
    private readonly hemisphere: THREE.HemisphereLight,
    private readonly sun: THREE.DirectionalLight,
    segments: LevelSegment[],
    private readonly track: TrackPath,
  ) {
    this.scene.add(this.root);
    this.build(segments);
    const first = THEMES[segments[0]?.biome ?? 'surface'];
    this.background.set(first.sky);
    this.fogColor.set(first.fog);
  }

  update(biome: BiomeType, elapsed: number, dt: number): void {
    const theme = THEMES[biome];
    const blend = Math.min(1, dt * 2.2);
    this.target.set(theme.sky);
    this.background.lerp(this.target, blend);
    this.target.set(theme.fog);
    this.fogColor.lerp(this.target, blend);
    this.scene.background = this.background;
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.copy(this.fogColor);
      this.scene.fog.near = biome === 'mine' || biome === 'ocean' ? 18 : 24;
      this.scene.fog.far = biome === 'mine' ? 42 : biome === 'ocean' ? 48 : 60;
    }
    this.hemisphere.color.lerp(this.target.set(theme.hemiSky), blend);
    this.hemisphere.groundColor.lerp(this.target.set(theme.hemiGround), blend);
    this.sun.color.lerp(this.target.set(theme.sun), blend);

    for (const prop of this.animated) {
      if (prop.motion === 'float') prop.object.position.y = prop.baseY + Math.sin(elapsed * 0.9 + prop.phase) * 0.2;
      if (prop.motion === 'spin') prop.object.rotation.y = elapsed * 0.75 + prop.phase;
      if (prop.motion === 'bubble') {
        prop.object.position.y = prop.baseY + ((elapsed * 0.7 + prop.phase) % 3.5);
        prop.object.scale.setScalar(0.75 + Math.sin(elapsed * 3 + prop.phase) * 0.18);
      }
    }
  }

  dispose(): void {
    this.scene.remove(this.root);
    this.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) value.dispose();
        }
        material.dispose();
      }
    });
    for (const geometry of Object.values(this.geometries)) geometry.dispose();
    this.root.clear();
    this.animated.length = 0;
  }

  private build(segments: LevelSegment[]): void {
    for (const segment of segments) {
      this.createRoad(segment);
      this.createBiomeProps(segment);
      this.createPortal(segment);
    }
  }

  private material(color: number, roughness = 0.85, emissive = 0): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color, roughness, emissive, emissiveIntensity: emissive ? 0.8 : 0 });
  }

  private createRoad(segment: LevelSegment): void {
    const theme = THEMES[segment.biome];
    const roadMaterial = this.material(theme.track, 0.78);
    roadMaterial.side = THREE.DoubleSide;
    const road = new THREE.Mesh(
      this.track.ribbonGeometry(segment.startZ, segment.endZ, 7.2, -0.07, 0, 1.35),
      roadMaterial,
    );
    road.receiveShadow = true;
    this.root.add(road);

    const landMaterial = this.material(theme.ground, 1, segment.biome === 'hell' ? 0x4b0800 : 0);
    landMaterial.side = THREE.DoubleSide;
    const land = new THREE.Mesh(
      this.track.ribbonGeometry(segment.startZ, segment.endZ, 72, -0.5, 0, 3.2),
      landMaterial,
    );
    land.receiveShadow = true;
    this.root.add(land);

    const edgeMaterial = this.material(theme.edge, 0.48, segment.biome === 'ocean' || segment.biome === 'hell' ? theme.edge : 0);
    this.createPlacedBoxes(segment, [-3.72, 3.72], [0.17, 0.18, 3.7], 0.07, 3.55, 0.5, edgeMaterial, segment.biome !== 'mine');

    const stripeMaterial = this.material(theme.edge, 0.6, segment.biome === 'mine' ? 0xd49a42 : 0);
    this.createPlacedBoxes(segment, [0], [0.09, 0.025, 2.3], -0.045, 6.5, 3, stripeMaterial);

    if (segment.biome === 'mine') {
      const railMaterial = this.material(0x9aa1ab, 0.3, 0x2c210e);
      const sleeperMaterial = this.material(0x6f4227, 0.95);
      this.createPlacedBoxes(segment, [-1.12, 1.12], [0.14, 0.12, 3.45], 0.08, 3.25, 0.5, railMaterial);
      this.createPlacedBoxes(segment, [0], [3.2, 0.12, 0.28], 0, 2.4, 1, sleeperMaterial);
    }
  }

  /** Builds repeated path-aligned details as one draw call per material. */
  private createPlacedBoxes(
    segment: LevelSegment,
    laterals: number[],
    size: [number, number, number],
    height: number,
    spacing: number,
    startOffset: number,
    material: THREE.Material,
    castShadow = false,
  ): void {
    const positions: Array<{ z: number; lateral: number }> = [];
    for (let z = segment.startZ + startOffset; z < segment.endZ; z += spacing) {
      for (const lateral of laterals) positions.push({ z, lateral });
    }
    if (!positions.length) return;
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(...size), material, positions.length);
    const anchor = new THREE.Object3D();
    positions.forEach(({ z, lateral }, index) => {
      this.track.place(anchor, z, lateral, height, true);
      anchor.updateMatrix();
      mesh.setMatrixAt(index, anchor.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    this.root.add(mesh);
  }

  private createBiomeProps(segment: LevelSegment): void {
    const mats = {
      leaf: this.material(0x1a9b68, 1),
      trunk: this.material(0x75462b, 1),
      white: this.material(0xe9f7ff, 0.95),
      stone: this.material(0x332c43, 1),
      crystal: this.material(0x9b78ff, 0.3, 0x5e35d8),
      timber: this.material(0x704225, 0.95),
      lantern: this.material(0xffbd55, 0.28, 0xff7a18),
      sea: this.material(0x17b7aa, 0.72),
      coral: this.material(0xff6d8d, 0.82),
      lava: this.material(0xff5d18, 0.55, 0xff2600),
      bone: this.material(0xe8d7b4, 0.9),
    };
    let row = 0;
    for (let z = segment.startZ + 6; z < segment.endZ - 2; z += 10) {
      for (const side of [-1, 1]) {
        const lateral = side * (5.7 + (row % 3) * 0.75);
        if (segment.biome === 'surface') {
          const tree = new THREE.Group();
          const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.25, 1.5, 7), mats.trunk);
          trunk.position.y = 0.75;
          const crown = new THREE.Mesh(this.geometries.cone, mats.leaf);
          crown.position.y = 2.3;
          tree.add(trunk, crown);
          this.track.place(tree, z, lateral, -0.48, true);
          tree.rotateY(row);
          this.root.add(tree);
        } else if (segment.biome === 'cloud') {
          const cloud = this.cloudCluster();
          this.track.place(cloud, z, lateral, -0.2 + (row % 2) * 1.7, true);
          this.root.add(cloud);
          this.animated.push({ object: cloud, baseY: cloud.position.y, phase: row + side, motion: 'float' });
        } else if (segment.biome === 'mine') {
          const rock = new THREE.Mesh(this.geometries.rock, mats.stone);
          rock.scale.set(1.3, 2.8, 1.2);
          this.track.place(rock, z, lateral, 1.1, true);
          this.root.add(rock);
          const crystal = new THREE.Mesh(this.geometries.crystal, mats.crystal);
          crystal.scale.set(0.7, 2.3, 0.7);
          this.track.place(crystal, z + 2, side * 4.65, 0.7, true);
          crystal.rotateZ(side * -0.35);
          this.root.add(crystal);
        } else if (segment.biome === 'ocean') {
          const coral = new THREE.Mesh(this.geometries.coral, row % 2 ? mats.coral : mats.sea);
          this.track.place(coral, z, lateral, 0.4, true);
          coral.rotateZ(side * 0.2);
          this.root.add(coral);
          for (let index = 0; index < 3; index += 1) {
            const bubble = new THREE.Mesh(this.geometries.bubble, new THREE.MeshBasicMaterial({ color: 0xa4fff8, transparent: true, opacity: 0.48 }));
            this.track.place(bubble, z + index * 0.5, side * (4.4 + index * 0.35), 0.2, false);
            this.root.add(bubble);
            this.animated.push({ object: bubble, baseY: bubble.position.y, phase: row * 0.7 + index, motion: 'bubble' });
          }
        } else {
          const spike = new THREE.Mesh(this.geometries.cone, row % 2 ? mats.lava : mats.stone);
          spike.scale.set(0.75, 1.8 + (row % 3), 0.75);
          this.track.place(spike, z, lateral, 1.45, true);
          this.root.add(spike);
          const bone = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.12, 6, 12, Math.PI), mats.bone);
          this.track.place(bone, z + 2, side * 4.8, 0.4, true);
          bone.rotateY(side * 0.45);
          this.root.add(bone);
        }
      }
      if (segment.biome === 'mine' && row % 2 === 0) {
        const support = new THREE.Group();
        for (const x of [-4.05, 4.05]) {
          support.add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 4.5, 0.34), mats.timber));
          support.children.at(-1)!.position.set(x, 1.75, 0);
        }
        const beam = new THREE.Mesh(new THREE.BoxGeometry(8.4, 0.34, 0.34), mats.timber);
        beam.position.y = 3.9;
        const lamp = new THREE.Mesh(new THREE.OctahedronGeometry(0.24, 0), mats.lantern);
        lamp.position.set(0, 3.55, 0.05);
        support.add(beam, lamp);
        this.track.place(support, z + 1.4, 0, 0, true);
        this.root.add(support);
      }
      row += 1;
    }
  }

  private createPortal(segment: LevelSegment): void {
    if (segment.startZ <= 0) return;
    const theme = THEMES[segment.biome];
    const portal = new THREE.Group();
    const material = this.material(theme.edge, 0.35, theme.edge);
    for (const x of [-3.25, 3.25]) {
      const post = new THREE.Mesh(this.geometries.post, material);
      post.position.set(x, 1.4, 0);
      portal.add(post);
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(6.68, 0.2, 0.2), material);
    top.position.y = 2.75;
    portal.add(top);
    this.track.place(portal, segment.startZ + 0.35, 0, 0, true);
    this.root.add(portal);
  }

  private cloudCluster(): THREE.Group {
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ color: 0xf1f8ff, roughness: 1, transparent: true, opacity: 0.94 });
    for (const [x, y, scale] of [[-0.7, 0, 0.8], [0, 0.18, 1.25], [0.8, 0, 0.9]] as const) {
      const puff = new THREE.Mesh(this.geometries.cloud, material);
      puff.position.set(x, y, 0);
      puff.scale.setScalar(scale);
      group.add(puff);
    }
    return group;
  }
}
