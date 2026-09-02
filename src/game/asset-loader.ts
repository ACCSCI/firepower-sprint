import * as THREE from 'three';

export type RuntimeModelKey = 'rifle' | 'gatling' | 'boss' | 'car' | 'plane' | 'submarine';

interface ModelSpec {
  url: string;
  targetSize: number;
  kind: 'weapon' | 'character' | 'vehicle';
}

const MODEL_SPECS: Record<RuntimeModelKey, ModelSpec> = {
  rifle: { url: '/models/rifle.glb', targetSize: 1.8, kind: 'weapon' },
  gatling: { url: '/models/gatling.glb', targetSize: 2.05, kind: 'weapon' },
  boss: { url: '/models/boss.glb', targetSize: 4.8, kind: 'character' },
  car: { url: '/models/car.glb', targetSize: 4.2, kind: 'vehicle' },
  plane: { url: '/models/plane.glb', targetSize: 5.5, kind: 'vehicle' },
  submarine: { url: '/models/submarine.glb', targetSize: 4.8, kind: 'vehicle' },
};

const idle = (callback: () => void): void => {
  const idleWindow = window as Window & {
    requestIdleCallback?: (task: () => void, options?: { timeout: number }) => number;
  };
  if (idleWindow.requestIdleCallback) {
    idleWindow.requestIdleCallback(callback, { timeout: 1400 });
  } else {
    window.setTimeout(callback, 240);
  }
};

/**
 * Loads optional production assets after first paint. Every caller gets a clone;
 * a missing or malformed file simply resolves to undefined so procedural art remains usable.
 */
export class RuntimeModelLibrary {
  private readonly templates = new Map<RuntimeModelKey, THREE.Group>();
  private started = false;
  private disposed = false;

  start(onReady: (key: RuntimeModelKey) => void): void {
    if (this.started || this.disposed) return;
    this.started = true;
    idle(() => {
      if (this.disposed) return;
      void import('three/examples/jsm/loaders/GLTFLoader.js').then(({ GLTFLoader }) => {
        if (this.disposed) return;
        const loader = new GLTFLoader();
        for (const key of Object.keys(MODEL_SPECS) as RuntimeModelKey[]) {
          const spec = MODEL_SPECS[key];
          void loader.loadAsync(spec.url)
            .then((gltf) => {
              const template = this.normalize(gltf.scene, spec);
              if (this.disposed) {
                this.disposeObject(template);
                return;
              }
              this.templates.set(key, template);
              onReady(key);
            })
            .catch(() => {
              // Optional assets deliberately fail closed to the procedural fallback.
            });
        }
      });
    });
  }

  clone(key: RuntimeModelKey): THREE.Group | undefined {
    if (this.disposed) return undefined;
    const template = this.templates.get(key);
    return template?.clone(true);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const template of this.templates.values()) this.disposeObject(template);
    this.templates.clear();
  }

  private disposeObject(root: THREE.Object3D): void {
    root.traverse((object) => {
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
  }

  private normalize(source: THREE.Group, spec: ModelSpec): THREE.Group {
    const root = new THREE.Group();
    const model = source.clone(true);
    root.add(model);

    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = false;
      object.frustumCulled = true;
    });

    let bounds = new THREE.Box3().setFromObject(model);
    const initialSize = bounds.getSize(new THREE.Vector3());
    if (spec.kind === 'weapon') {
      if (initialSize.x > initialSize.y && initialSize.x > initialSize.z) model.rotation.y = Math.PI / 2;
      if (initialSize.y > initialSize.x && initialSize.y > initialSize.z) model.rotation.x = Math.PI / 2;
      model.updateMatrixWorld(true);
      bounds = new THREE.Box3().setFromObject(model);
    }

    const size = bounds.getSize(new THREE.Vector3());
    const extent = spec.kind === 'weapon' || spec.kind === 'vehicle' ? Math.max(size.x, size.y, size.z) : size.y;
    const scale = spec.targetSize / Math.max(0.001, extent);
    model.scale.setScalar(scale);
    model.updateMatrixWorld(true);
    bounds = new THREE.Box3().setFromObject(model);

    const center = bounds.getCenter(new THREE.Vector3());
    if (spec.kind === 'weapon') {
      model.position.set(-center.x, -center.y, -bounds.min.z);
    } else {
      model.position.set(-center.x, -bounds.min.y, -center.z);
    }
    model.updateMatrixWorld(true);
    return root;
  }
}
