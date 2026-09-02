export type GameStatus = 'ready' | 'running' | 'won' | 'lost';

export type LevelId = 1 | 2 | 3 | 4 | 5;

export type WeaponType = 'pistol' | 'rifle' | 'gatling';

export type EnemyArchetype = 'grunt' | 'tank' | 'sprinter' | 'flyer' | 'boss';

export type PickupType = 'shield' | 'bomb' | 'magnet' | 'heal';

export type ObstacleRewardType = 'damage' | 'fireRate' | 'crew' | 'shield';

export type HazardType = 'rockfall' | 'lightning' | 'caveBlast' | 'depthCharge' | 'lavaBurst';

export type BiomeType = 'surface' | 'cloud' | 'mine' | 'ocean' | 'hell';

export type VehicleMode = 'onFoot' | 'car' | 'minecart' | 'plane' | 'submarine';

export interface LevelSummary {
  id: LevelId;
  title: string;
  subtitle: string;
  biomes: BiomeType[];
  vehicle: VehicleMode;
  accent: number;
}

export type UpgradeType =
  | 'damage'
  | 'fireRate'
  | 'heal'
  | 'multishot'
  | 'crew'
  | 'weaponRifle'
  | 'weaponGatling'
  | 'damageDown'
  | 'fireRateDown'
  | 'crewDown';

export interface PlayerState {
  x: number;
  z: number;
  hp: number;
  maxHp: number;
  damage: number;
  shotsPerSecond: number;
  projectileCount: number;
  crewCount: number;
  weapon: WeaponType;
  shotCooldown: number;
  shield: number;
  shieldMax: number;
  magnetTimer: number;
}

export interface EnemyState {
  id: number;
  x: number;
  z: number;
  hp: number;
  maxHp: number;
  speed: number;
  radius: number;
  damage: number;
  boss: boolean;
  archetype: EnemyArchetype;
  altitude: number;
  movementPhase: number;
  alive: boolean;
  hitFlash: number;
}

export interface ObstacleState {
  id: number;
  x: number;
  z: number;
  hp: number;
  maxHp: number;
  radius: number;
  collisionDamage: number;
  fatal: boolean;
  alive: boolean;
  hitFlash: number;
  label: string;
  rewardType: ObstacleRewardType;
  rewardAmount: number;
  rewardLabel: string;
}

export interface PickupState {
  id: number;
  x: number;
  z: number;
  type: PickupType;
  amount: number;
  radius: number;
  collected: boolean;
}

export interface LevelSegment {
  id: number;
  startZ: number;
  endZ: number;
  biome: BiomeType;
  vehicle: VehicleMode;
  title: string;
}

export interface GateState {
  id: number;
  pairId: number;
  side: -1 | 1;
  x: number;
  z: number;
  type: UpgradeType;
  amount: number;
  label: string;
  color: number;
  negative: boolean;
  used: boolean;
  baseType: UpgradeType;
  baseAmount: number;
  baseLabel: string;
  baseColor: number;
  shootable: boolean;
  shotCharge: number;
  shotChargeMax: number;
  hitFlash: number;
}

export interface BulletState {
  id: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  damage: number;
  remainingRange: number;
  alive: boolean;
}

export interface HazardState {
  id: number;
  waveId: number;
  x: number;
  z: number;
  radius: number;
  damage: number;
  type: HazardType;
  label: string;
  color: number;
  showLabel: boolean;
  warned: boolean;
  resolved: boolean;
}

export type GameEvent =
  | { type: 'shot'; x: number; z: number }
  | { type: 'enemyHit'; enemyId: number; x: number; z: number; damage: number }
  | { type: 'enemyDefeated'; enemyId: number; x: number; z: number; boss: boolean; combo: number }
  | { type: 'playerHit'; amount: number }
  | { type: 'gate'; label: string; color: number; negative: boolean }
  | { type: 'gateCharged'; gateId: number; label: string; color: number; converted: boolean; progress: number }
  | { type: 'obstacleHit'; obstacleId: number; x: number; z: number; damage: number }
  | { type: 'obstacleDestroyed'; obstacleId: number; x: number; z: number }
  | { type: 'obstacleReward'; obstacleId: number; label: string; color: number }
  | { type: 'hazardWarning'; waveId: number; label: string; color: number }
  | { type: 'hazardHit'; waveId: number; x: number; z: number; amount: number; label: string; color: number }
  | { type: 'hazardAvoided'; waveId: number; x: number; z: number; score: number; color: number }
  | { type: 'obstacleCollision'; obstacleId: number; amount: number; fatal: boolean }
  | { type: 'pickup'; pickupId: number; pickupType: PickupType; amount: number }
  | {
    type: 'bombDetonated';
    x: number;
    z: number;
    damage: number;
    radius: number;
    targetsHit: number;
    targetsDestroyed: number;
    enemiesHit: number;
    enemiesDefeated: number;
    obstaclesHit: number;
    obstaclesDestroyed: number;
  }
  | { type: 'shieldHit'; absorbed: number; remaining: number }
  | {
    type: 'segmentChanged';
    segmentId: number;
    biome: BiomeType;
    vehicle: VehicleMode;
    title: string;
  };

export interface GameState {
  levelId: LevelId;
  status: GameStatus;
  time: number;
  score: number;
  combo: number;
  comboTimer: number;
  bestCombo: number;
  challengeDodges: number;
  kills: number;
  levelEnd: number;
  player: PlayerState;
  enemies: EnemyState[];
  obstacles: ObstacleState[];
  pickups: PickupState[];
  hazards: HazardState[];
  segments: LevelSegment[];
  currentSegmentId: number;
  vehicle: VehicleMode;
  gates: GateState[];
  bullets: BulletState[];
  events: GameEvent[];
  nextBulletId: number;
}
