import * as THREE from 'three';
import type { LevelId } from './types';

interface TrackPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  rightX: number;
  rightZ: number;
}

const smoothstep = (value: number, from: number, to: number): number => {
  const t = THREE.MathUtils.clamp((value - from) / Math.max(0.001, to - from), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Maps the simulation's straight progress axis onto a curved, bankable 3D route. */
export class TrackPath {
  constructor(private readonly levelId: LevelId, private readonly levelEnd: number) {}

  pose(z: number): TrackPose {
    const point = this.center(z);
    const before = this.center(z - 0.35);
    const after = this.center(z + 0.35);
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    const dz = after.z - before.z;
    const horizontal = Math.hypot(dx, dz);
    const yaw = Math.atan2(dx, dz);
    return {
      ...point,
      yaw,
      pitch: Math.atan2(dy, Math.max(0.001, horizontal)),
      rightX: Math.cos(yaw),
      rightZ: -Math.sin(yaw),
    };
  }

  place(object: THREE.Object3D, z: number, lateral = 0, height = 0, align = true): void {
    const pose = this.pose(z);
    object.position.set(
      pose.x - lateral * pose.rightX,
      pose.y + height,
      pose.z - lateral * pose.rightZ,
    );
    if (!align) return;
    object.rotation.order = 'YXZ';
    object.rotation.y = pose.yaw;
    object.rotation.x = -pose.pitch;
  }

  point(z: number, lateral = 0, height = 0, target = new THREE.Vector3()): THREE.Vector3 {
    const pose = this.pose(z);
    return target.set(
      pose.x - lateral * pose.rightX,
      pose.y + height,
      pose.z - lateral * pose.rightZ,
    );
  }

  ribbonGeometry(
    startZ: number,
    endZ: number,
    width: number,
    height = 0,
    lateral = 0,
    step = 2.2,
  ): THREE.BufferGeometry {
    const count = Math.max(2, Math.ceil((endZ - startZ) / step) + 1);
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (let index = 0; index < count; index += 1) {
      const t = index / (count - 1);
      const z = THREE.MathUtils.lerp(startZ, endZ, t);
      const pose = this.pose(z);
      for (const side of [-1, 1]) {
        const offset = lateral + side * width * 0.5;
        positions.push(
          pose.x - offset * pose.rightX,
          pose.y + height,
          pose.z - offset * pose.rightZ,
        );
        uvs.push(side < 0 ? 0 : 1, t * (endZ - startZ) / 5);
      }
      if (index >= count - 1) continue;
      const base = index * 2;
      indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }

  private center(z: number): { x: number; y: number; z: number } {
    const end = this.levelEnd;
    if (this.levelId === 1) {
      return { x: Math.sin(z / 32) * 5 + Math.sin(z / 13) * 1.2, y: Math.sin(z / 31) * 0.65, z };
    }
    if (this.levelId === 2) {
      const ascent = smoothstep(z, 8, 105) * 9.5;
      const descent = smoothstep(z, end - 105, end - 8) * 6.8;
      return { x: Math.sin(z / 34) * 6.5 + Math.sin(z / 16) * 1.4, y: ascent - descent + Math.sin(z / 34) * 0.75, z };
    }
    if (this.levelId === 3) {
      const dive = smoothstep(z, 20, end * 0.48) * -4.2;
      const rise = smoothstep(z, end * 0.62, end - 15) * 3;
      return { x: Math.sin(z / 36) * 5.5 + Math.sin(z / 18) * 1.2, y: dive + rise + Math.sin(z / 29) * 0.55, z };
    }
    if (this.levelId === 4) {
      return { x: Math.sin(z / 30) * 5 + Math.sin(z / 15) * 1, y: Math.sin(z / 25) * 1.15 + smoothstep(z, end * 0.55, end) * 1.8, z };
    }
    const descent = smoothstep(z, 35, end * 0.48) * -3.2;
    const climb = smoothstep(z, end * 0.58, end - 18) * 2.5;
    return { x: Math.sin(z / 29) * 4.5 + Math.sin(z / 14) * 0.9, y: descent + climb + Math.sin(z / 24) * 0.45, z };
  }
}
