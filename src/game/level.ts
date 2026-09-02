import type {
  EnemyArchetype,
  EnemyState,
  GateState,
  GameState,
  LevelId,
  LevelSegment,
  LevelSummary,
  ObstacleState,
  PickupState,
} from './types';

type GateChoice = Omit<GateState, 'id' | 'pairId' | 'side' | 'x' | 'z' | 'used' | 'negative'> & {
  negative?: boolean;
};

interface LevelContent {
  segments: LevelSegment[];
  gates: GateState[];
  enemies: EnemyState[];
  obstacles: ObstacleState[];
  pickups: PickupState[];
  levelEnd: number;
}

export const LEVEL_SUMMARIES: readonly LevelSummary[] = [
  { id: 1, title: '荒原矿脉', subtitle: '地表集结 · 矿洞战车 · 熔岩出口', biomes: ['surface', 'mine', 'hell'], vehicle: 'car', accent: 0xf59e0b },
  { id: 2, title: '云端追猎', subtitle: '跑道起飞 · 穿云火线 · 雷暴空港', biomes: ['surface', 'cloud'], vehicle: 'plane', accent: 0x38bdf8 },
  { id: 3, title: '深海潜航', subtitle: '珊瑚峡谷 · 沉船墓场 · 海沟巨兽', biomes: ['ocean'], vehicle: 'submarine', accent: 0x22d3ee },
  { id: 4, title: '地狱终局', subtitle: '灰烬荒野 · 熔岩神殿 · 魔王王座', biomes: ['hell'], vehicle: 'onFoot', accent: 0xef4444 },
  { id: 5, title: '幽晶矿车', subtitle: '废弃矿井 · 晶矿深坑 · 地心宝库', biomes: ['mine'], vehicle: 'minecart', accent: 0xa78bfa },
];

const ARCHETYPE_STATS: Record<EnemyArchetype, {
  hp: number;
  speed: number;
  radius: number;
  damage: number;
  altitude: number;
}> = {
  grunt: { hp: 42, speed: 0.35, radius: 0.72, damage: 10, altitude: 0 },
  tank: { hp: 180, speed: 0.22, radius: 1.05, damage: 18, altitude: 0 },
  sprinter: { hp: 62, speed: 1.45, radius: 0.62, damage: 12, altitude: 0 },
  flyer: { hp: 78, speed: 0.75, radius: 0.7, damage: 12, altitude: 1.25 },
  boss: { hp: 3200, speed: 0.9, radius: 1.45, damage: 28, altitude: 0 },
};

const enemy = (
  id: number,
  x: number,
  z: number,
  archetype: EnemyArchetype = 'grunt',
  hp?: number,
): EnemyState => {
  const stats = ARCHETYPE_STATS[archetype];
  const maxHp = hp ?? stats.hp;
  return {
    id, x, z, hp: maxHp, maxHp,
    speed: stats.speed, radius: stats.radius, damage: stats.damage,
    boss: archetype === 'boss', archetype, altitude: stats.altitude,
    movementPhase: id * 0.73, alive: true, hitFlash: 0,
  };
};

const obstacle = (
  id: number,
  x: number,
  z: number,
  hp: number,
  label: string,
  collisionDamage = 30,
  fatal = false,
): ObstacleState => ({
  id, x, z, hp, maxHp: hp,
  radius: hp >= 240 ? 1.35 : 0.95,
  collisionDamage, fatal, alive: true, hitFlash: 0, label,
});

const pickup = (
  id: number,
  x: number,
  z: number,
  type: PickupState['type'],
  amount: number,
): PickupState => ({ id, x, z, type, amount, radius: 0.65, collected: false });

const gatePair = (
  pairId: number,
  z: number,
  left: GateChoice,
  right: GateChoice,
): GateState[] => [
  { negative: false, ...left, id: pairId * 2, pairId, side: -1, x: -1.75, z, used: false },
  { negative: false, ...right, id: pairId * 2 + 1, pairId, side: 1, x: 1.75, z, used: false },
];

const LENGTH_SCALE = 1.5;

const expandLevel = (content: LevelContent): LevelContent => ({
  ...content,
  levelEnd: content.levelEnd * LENGTH_SCALE,
  segments: content.segments.map((segment) => ({
    ...segment,
    startZ: segment.startZ * LENGTH_SCALE,
    endZ: segment.endZ * LENGTH_SCALE,
  })),
  gates: content.gates.map((gate) => ({ ...gate, z: gate.z * LENGTH_SCALE })),
  enemies: content.enemies.map((target) => ({ ...target, z: target.z * LENGTH_SCALE })),
  obstacles: content.obstacles.map((target) => ({ ...target, z: target.z * LENGTH_SCALE })),
  pickups: content.pickups.map((item) => ({ ...item, z: item.z * LENGTH_SCALE })),
});

const levelOne = (): LevelContent => expandLevel({
  levelEnd: 250,
  segments: [
    { id: 1, startZ: 0, endZ: 82, biome: 'surface', vehicle: 'onFoot', title: '荒原集结' },
    { id: 2, startZ: 82, endZ: 172, biome: 'mine', vehicle: 'car', title: '矿洞战车' },
    { id: 3, startZ: 172, endZ: 250, biome: 'hell', vehicle: 'onFoot', title: '熔岩出口' },
  ],
  gates: [
    ...gatePair(1, 22,
      { type: 'crew', amount: 2, label: '人数 +2', color: 0x38bdf8 },
      { type: 'damage', amount: 8, label: '伤害 +8', color: 0x22d3ee }),
    ...gatePair(2, 55,
      { type: 'weaponRifle', amount: 1, label: '升级步枪', color: 0x60a5fa },
      { type: 'damageDown', amount: 6, label: '伤害 -6', color: 0xff4d67, negative: true }),
    ...gatePair(3, 90,
      { type: 'multishot', amount: 1, label: '双联炮管', color: 0xc084fc },
      { type: 'crewDown', amount: 1, label: '成员掉队 -1', color: 0xff4d67, negative: true }),
    ...gatePair(4, 125,
      { type: 'fireRate', amount: 0.8, label: '车载稳速器', color: 0xa3e635 },
      { type: 'damage', amount: 15, label: '穿甲弹 +15', color: 0xfbbf24 }),
    ...gatePair(5, 158,
      { type: 'weaponGatling', amount: 1, label: '车载加特林', color: 0xf97316 },
      { type: 'fireRateDown', amount: 0.35, label: '引擎过热 -35%', color: 0xff4d67, negative: true }),
    ...gatePair(6, 198,
      { type: 'crew', amount: 3, label: '救援小队 +3', color: 0x38bdf8 },
      { type: 'heal', amount: 35, label: '急救包 +35', color: 0xfb7185 }),
    ...gatePair(7, 222,
      { type: 'damage', amount: 24, label: '熔岩增伤 +24', color: 0xfbbf24 },
      { type: 'multishot', amount: 1, label: '弹道 +1', color: 0xc084fc }),
    ...gatePair(8, 38,
      { type: 'fireRate', amount: 0.55, label: '荒原快枪 +0.55', color: 0xa3e635 },
      { type: 'heal', amount: 22, label: '拾荒药箱 +22', color: 0x4ade80 }),
    ...gatePair(9, 108,
      { type: 'damage', amount: 12, label: '晶矿弹头 +12', color: 0xfbbf24 },
      { type: 'crewDown', amount: 1, label: '矿道塌方 -1', color: 0xff4d67, negative: true }),
    ...gatePair(10, 180,
      { type: 'multishot', amount: 1, label: '熔火弹道 +1', color: 0xc084fc },
      { type: 'damageDown', amount: 9, label: '灼热枪膛 -9', color: 0xff4d67, negative: true }),
  ],
  enemies: [
    enemy(1, -1.35, 14, 'grunt', 24), enemy(2, 0.65, 48, 'tank', 82),
    enemy(3, -1.45, 70, 'flyer', 58), enemy(4, 1.35, 100, 'grunt', 82),
    enemy(5, -0.7, 126, 'tank', 190), enemy(6, 1.4, 154, 'flyer', 165),
    enemy(7, -1.35, 168, 'sprinter', 150), enemy(8, 1.35, 188, 'grunt', 220),
    enemy(9, -1.4, 207, 'sprinter', 250), enemy(10, -0.75, 225, 'tank', 430),
    enemy(11, 1.15, 34, 'sprinter', 52), enemy(12, -0.9, 82, 'grunt', 76),
    enemy(13, 1.25, 114, 'flyer', 118), enemy(14, -1.2, 179, 'tank', 270),
    enemy(15, 1.05, 216, 'flyer', 290),
    enemy(99, 0, 242, 'boss', 3200),
  ],
  obstacles: [
    obstacle(1, 0, 27, 80, '木质路障', 16),
    obstacle(2, -1.1, 74, 130, '钢铁拒马', 22),
    obstacle(3, 0.9, 105, 180, '矿洞栅栏', 30),
    obstacle(4, -0.9, 146, 250, '钻机残骸', 42),
    obstacle(5, 0, 198, 300, '熔岩石门', 66),
    obstacle(6, 0.75, 224, 370, '恶魔壁垒', 85, true),
    obstacle(7, 1.05, 62, 110, '荒原油桶阵', 20),
    obstacle(8, -1.05, 118, 215, '晶矿运输架', 36),
    obstacle(9, 1.1, 211, 345, '熔火巨岩', 74),
  ],
  pickups: [
    pickup(1, 1.4, 38, 'shield', 45), pickup(2, -1.2, 89, 'magnet', 9),
    pickup(3, 1.25, 135, 'bomb', 280), pickup(4, -1.35, 182, 'heal', 40),
    pickup(5, 1.3, 212, 'shield', 60),
    pickup(6, -1.25, 66, 'heal', 28), pickup(7, 1.25, 116, 'shield', 52),
    pickup(8, -1.2, 235, 'magnet', 11),
  ],
});

const levelTwo = (): LevelContent => expandLevel({
  levelEnd: 276,
  segments: [
    { id: 1, startZ: 0, endZ: 70, biome: 'surface', vehicle: 'plane', title: '跑道起飞' },
    { id: 2, startZ: 70, endZ: 178, biome: 'cloud', vehicle: 'plane', title: '穿云火线' },
    { id: 3, startZ: 178, endZ: 276, biome: 'cloud', vehicle: 'plane', title: '雷暴空港' },
  ],
  gates: [
    ...gatePair(101, 24,
      { type: 'fireRate', amount: 1.1, label: '涡轮射速 +1.1', color: 0x67e8f9 },
      { type: 'damage', amount: 10, label: '航空弹 +10', color: 0xfde047 }),
    ...gatePair(102, 60,
      { type: 'weaponRifle', amount: 1, label: '机翼步枪', color: 0x60a5fa },
      { type: 'fireRateDown', amount: 0.28, label: '乱流 -28%', color: 0xfb7185, negative: true }),
    ...gatePair(103, 104,
      { type: 'multishot', amount: 1, label: '双翼火力', color: 0xc084fc },
      { type: 'heal', amount: 30, label: '空投维修 +30', color: 0x34d399 }),
    ...gatePair(104, 145,
      { type: 'damage', amount: 18, label: '机炮增伤 +18', color: 0xfbbf24 },
      { type: 'damageDown', amount: 7, label: '机身结冰 -7', color: 0xff4d67, negative: true }),
    ...gatePair(105, 188,
      { type: 'weaponGatling', amount: 1, label: '航空加特林', color: 0xf97316 },
      { type: 'crew', amount: 2, label: '僚机 +2', color: 0x38bdf8 }),
    ...gatePair(106, 226,
      { type: 'multishot', amount: 1, label: '翼下导弹 +1', color: 0xa78bfa },
      { type: 'heal', amount: 45, label: '云端补给 +45', color: 0x4ade80 }),
    ...gatePair(107, 80,
      { type: 'damage', amount: 13, label: '晴空穿甲 +13', color: 0xfde047 },
      { type: 'crew', amount: 1, label: '侦察僚机 +1', color: 0x38bdf8 }),
    ...gatePair(108, 166,
      { type: 'fireRate', amount: 0.7, label: '雷达锁定 +0.7', color: 0x67e8f9 },
      { type: 'damageDown', amount: 8, label: '雷击干扰 -8', color: 0xff4d67, negative: true }),
    ...gatePair(109, 252,
      { type: 'multishot', amount: 1, label: '空港齐射 +1', color: 0xc084fc },
      { type: 'heal', amount: 38, label: '机库抢修 +38', color: 0x4ade80 }),
  ],
  enemies: [
    enemy(201, -1.4, 17, 'flyer', 52), enemy(202, 1.1, 43, 'grunt', 65),
    enemy(203, -0.55, 71, 'sprinter', 92), enemy(204, 1.45, 91, 'tank', 175),
    enemy(205, -1.35, 117, 'flyer', 135), enemy(206, 0.75, 143, 'sprinter', 150),
    enemy(207, -0.65, 170, 'grunt', 180), enemy(208, 1.35, 199, 'flyer', 210),
    enemy(209, -1.1, 226, 'tank', 360), enemy(210, 0.8, 249, 'sprinter', 275),
    enemy(211, 0.9, 30, 'grunt', 64), enemy(212, -1.2, 57, 'flyer', 82),
    enemy(213, 1.2, 130, 'tank', 225), enemy(214, -1.05, 185, 'sprinter', 205),
    enemy(215, 1.3, 240, 'flyer', 255),
    enemy(299, 0, 268, 'boss', 3900),
  ],
  obstacles: [
    obstacle(201, 0.85, 34, 90, '浮空雷阵', 18),
    obstacle(202, -0.85, 82, 150, '风暴气球', 25),
    obstacle(203, 0, 126, 210, '追踪导弹群', 34),
    obstacle(204, 1.1, 166, 260, '雷云核心', 46),
    obstacle(205, -0.8, 214, 330, '空港拦截网', 65),
    obstacle(206, 0, 252, 410, '天门护盾', 92, true),
    obstacle(207, -1.05, 54, 125, '高空气象塔', 22),
    obstacle(208, 0.95, 147, 245, '带电浮空岛', 42),
    obstacle(209, -1.1, 236, 365, '空港防空栅', 78),
  ],
  pickups: [
    pickup(201, -1.25, 31, 'shield', 50), pickup(202, 1.25, 96, 'magnet', 10),
    pickup(203, -1.35, 153, 'bomb', 320), pickup(204, 1.2, 202, 'heal', 45),
    pickup(205, -1.25, 241, 'shield', 70),
    pickup(206, 1.25, 58, 'heal', 30), pickup(207, -1.25, 178, 'magnet', 11),
    pickup(208, 1.2, 260, 'bomb', 380),
  ],
});

const levelThree = (): LevelContent => expandLevel({
  levelEnd: 282,
  segments: [
    { id: 1, startZ: 0, endZ: 96, biome: 'ocean', vehicle: 'submarine', title: '珊瑚峡谷' },
    { id: 2, startZ: 96, endZ: 190, biome: 'ocean', vehicle: 'submarine', title: '沉船墓场' },
    { id: 3, startZ: 190, endZ: 282, biome: 'ocean', vehicle: 'submarine', title: '无光海沟' },
  ],
  gates: [
    ...gatePair(201, 25,
      { type: 'damage', amount: 12, label: '高压鱼雷 +12', color: 0x22d3ee },
      { type: 'heal', amount: 25, label: '耐压修复 +25', color: 0x34d399 }),
    ...gatePair(202, 64,
      { type: 'weaponRifle', amount: 1, label: '速射鱼雷', color: 0x60a5fa },
      { type: 'damageDown', amount: 7, label: '船壳渗水 -7', color: 0xff4d67, negative: true }),
    ...gatePair(203, 108,
      { type: 'multishot', amount: 1, label: '双管鱼雷', color: 0xa78bfa },
      { type: 'fireRate', amount: 0.9, label: '声呐锁定 +0.9', color: 0xa3e635 }),
    ...gatePair(204, 151,
      { type: 'crew', amount: 2, label: '潜航员 +2', color: 0x38bdf8 },
      { type: 'crewDown', amount: 1, label: '深海恐惧 -1', color: 0xff4d67, negative: true }),
    ...gatePair(205, 197,
      { type: 'weaponGatling', amount: 1, label: '深潜加特林', color: 0xf97316 },
      { type: 'heal', amount: 45, label: '氧气补给 +45', color: 0x4ade80 }),
    ...gatePair(206, 239,
      { type: 'damage', amount: 24, label: '海沟破甲 +24', color: 0xfbbf24 },
      { type: 'multishot', amount: 1, label: '三叉鱼雷 +1', color: 0xc084fc }),
    ...gatePair(207, 82,
      { type: 'fireRate', amount: 0.65, label: '洋流增压 +0.65', color: 0x67e8f9 },
      { type: 'heal', amount: 28, label: '珊瑚修复 +28', color: 0x4ade80 }),
    ...gatePair(208, 174,
      { type: 'damage', amount: 16, label: '沉船钢芯弹 +16', color: 0xfbbf24 },
      { type: 'fireRateDown', amount: 0.3, label: '水压过载 -30%', color: 0xff4d67, negative: true }),
    ...gatePair(209, 260,
      { type: 'multishot', amount: 1, label: '海沟齐射 +1', color: 0xc084fc },
      { type: 'crew', amount: 2, label: '深潜救援队 +2', color: 0x38bdf8 }),
  ],
  enemies: [
    enemy(301, -1.25, 18, 'grunt', 58), enemy(302, 1.3, 46, 'flyer', 86),
    enemy(303, -0.7, 73, 'sprinter', 105), enemy(304, 1.1, 101, 'tank', 205),
    enemy(305, -1.35, 127, 'flyer', 150), enemy(306, 0.65, 154, 'grunt', 175),
    enemy(307, -0.8, 183, 'sprinter', 205), enemy(308, 1.35, 211, 'tank', 340),
    enemy(309, -1.25, 238, 'flyer', 260), enemy(310, 0.75, 259, 'sprinter', 315),
    enemy(311, 1.05, 31, 'flyer', 72), enemy(312, -1.1, 61, 'grunt', 92),
    enemy(313, 1.25, 142, 'sprinter', 165), enemy(314, -1.2, 197, 'tank', 310),
    enemy(315, 1.1, 249, 'grunt', 285),
    enemy(399, 0, 274, 'boss', 4400),
  ],
  obstacles: [
    obstacle(301, 0, 35, 100, '珊瑚礁门', 20),
    obstacle(302, -1, 84, 170, '漂流水雷', 28),
    obstacle(303, 0.9, 132, 230, '沉船船腹', 38),
    obstacle(304, -0.85, 176, 285, '巨型蚌壳', 50),
    obstacle(305, 0.9, 224, 360, '海沟热泉', 72),
    obstacle(306, 0, 258, 440, '远古石闸', 98, true),
    obstacle(307, 1.05, 58, 135, '珊瑚尖塔群', 24),
    obstacle(308, -1, 154, 255, '沉船桅杆阵', 44),
    obstacle(309, 1.05, 244, 395, '海沟玄武岩柱', 84),
  ],
  pickups: [
    pickup(301, 1.35, 30, 'shield', 55), pickup(302, -1.25, 91, 'magnet', 11),
    pickup(303, 1.25, 145, 'bomb', 350), pickup(304, -1.25, 203, 'heal', 50),
    pickup(305, 1.3, 246, 'shield', 75),
    pickup(306, -1.25, 66, 'heal', 32), pickup(307, 1.25, 178, 'magnet', 12),
    pickup(308, -1.2, 267, 'bomb', 430),
  ],
});

const levelFour = (): LevelContent => expandLevel({
  levelEnd: 292,
  segments: [
    { id: 1, startZ: 0, endZ: 98, biome: 'hell', vehicle: 'onFoot', title: '灰烬荒野' },
    { id: 2, startZ: 98, endZ: 198, biome: 'hell', vehicle: 'onFoot', title: '熔岩神殿' },
    { id: 3, startZ: 198, endZ: 292, biome: 'hell', vehicle: 'onFoot', title: '魔王王座' },
  ],
  gates: [
    ...gatePair(301, 25,
      { type: 'crew', amount: 2, label: '圣战士 +2', color: 0x38bdf8 },
      { type: 'damage', amount: 14, label: '圣银弹 +14', color: 0xfde047 }),
    ...gatePair(302, 67,
      { type: 'weaponRifle', amount: 1, label: '净化步枪', color: 0x60a5fa },
      { type: 'crewDown', amount: 1, label: '灵魂献祭 -1', color: 0xff4d67, negative: true }),
    ...gatePair(303, 111,
      { type: 'fireRate', amount: 1.2, label: '怒火射速 +1.2', color: 0xa3e635 },
      { type: 'damageDown', amount: 8, label: '恶魔诅咒 -8', color: 0xff4d67, negative: true }),
    ...gatePair(304, 157,
      { type: 'multishot', amount: 1, label: '灵魂弹道 +1', color: 0xc084fc },
      { type: 'heal', amount: 40, label: '圣泉 +40', color: 0x4ade80 }),
    ...gatePair(305, 204,
      { type: 'weaponGatling', amount: 1, label: '炼狱加特林', color: 0xf97316 },
      { type: 'fireRateDown', amount: 0.32, label: '岩浆凝固 -32%', color: 0xff4d67, negative: true }),
    ...gatePair(306, 249,
      { type: 'damage', amount: 28, label: '弑神弹 +28', color: 0xfbbf24 },
      { type: 'multishot', amount: 1, label: '六翼火力 +1', color: 0xa78bfa }),
    ...gatePair(307, 86,
      { type: 'damage', amount: 15, label: '灰烬破魔 +15', color: 0xfde047 },
      { type: 'heal', amount: 30, label: '余烬复苏 +30', color: 0x4ade80 }),
    ...gatePair(308, 181,
      { type: 'fireRate', amount: 0.8, label: '神殿怒火 +0.8', color: 0xa3e635 },
      { type: 'crewDown', amount: 1, label: '献祭陷阱 -1', color: 0xff4d67, negative: true }),
    ...gatePair(309, 269,
      { type: 'multishot', amount: 1, label: '王座审判 +1', color: 0xc084fc },
      { type: 'damageDown', amount: 10, label: '魔王威压 -10', color: 0xff4d67, negative: true }),
  ],
  enemies: [
    enemy(401, -1.3, 18, 'grunt', 70), enemy(402, 1.25, 47, 'sprinter', 115),
    enemy(403, -0.65, 75, 'flyer', 140), enemy(404, 1.25, 105, 'tank', 260),
    enemy(405, -1.35, 133, 'grunt', 220), enemy(406, 0.7, 161, 'sprinter', 245),
    enemy(407, -0.9, 190, 'flyer', 285), enemy(408, 1.3, 219, 'tank', 420),
    enemy(409, -1.25, 247, 'sprinter', 340), enemy(410, 0.8, 270, 'grunt', 390),
    enemy(411, 1.05, 32, 'grunt', 88), enemy(412, -1.15, 61, 'sprinter', 128),
    enemy(413, 1.25, 146, 'flyer', 230), enemy(414, -1.1, 204, 'tank', 380),
    enemy(415, 1.15, 260, 'flyer', 360),
    enemy(499, 0, 284, 'boss', 5200),
  ],
  obstacles: [
    obstacle(401, 0.8, 36, 120, '骸骨拒马', 22),
    obstacle(402, -0.8, 87, 190, '血肉之门', 32),
    obstacle(403, 0, 139, 260, '炼狱锁链', 44),
    obstacle(404, 1, 186, 330, '熔岩祭坛', 58),
    obstacle(405, -0.8, 232, 410, '恶魔图腾', 78),
    obstacle(406, 0, 268, 500, '王座封印', 110, true),
    obstacle(407, -1.05, 59, 150, '灰烬尖刺阵', 26),
    obstacle(408, 0.95, 162, 305, '神殿火焰门', 52),
    obstacle(409, -1.05, 252, 455, '王座灵魂墙', 96),
  ],
  pickups: [
    pickup(401, -1.3, 31, 'shield', 60), pickup(402, 1.25, 96, 'magnet', 12),
    pickup(403, -1.25, 151, 'bomb', 420), pickup(404, 1.25, 213, 'heal', 55),
    pickup(405, -1.25, 257, 'shield', 85),
    pickup(406, 1.25, 70, 'heal', 34), pickup(407, -1.25, 178, 'magnet', 13),
    pickup(408, 1.2, 277, 'bomb', 500),
  ],
});

const levelFive = (): LevelContent => expandLevel({
  levelEnd: 296,
  segments: [
    { id: 1, startZ: 0, endZ: 98, biome: 'mine', vehicle: 'minecart', title: '废弃矿井' },
    { id: 2, startZ: 98, endZ: 198, biome: 'mine', vehicle: 'minecart', title: '晶矿深坑' },
    { id: 3, startZ: 198, endZ: 296, biome: 'mine', vehicle: 'minecart', title: '地心宝库' },
  ],
  gates: [
    ...gatePair(401, 24,
      { type: 'damage', amount: 12, label: '矿镐弹 +12', color: 0xfbbf24 },
      { type: 'heal', amount: 25, label: '轨道维修 +25', color: 0x4ade80 }),
    ...gatePair(402, 66,
      { type: 'weaponRifle', amount: 1, label: '速射铆钉枪', color: 0x60a5fa },
      { type: 'fireRateDown', amount: 0.25, label: '粉尘堵膛 -25%', color: 0xff4d67, negative: true }),
    ...gatePair(403, 111,
      { type: 'multishot', amount: 1, label: '双轨火力 +1', color: 0xc084fc },
      { type: 'fireRate', amount: 0.9, label: '矿灯瞄准 +0.9', color: 0xa3e635 }),
    ...gatePair(404, 157,
      { type: 'crew', amount: 2, label: '矿工小队 +2', color: 0x38bdf8 },
      { type: 'crewDown', amount: 1, label: '塌方减员 -1', color: 0xff4d67, negative: true }),
    ...gatePair(405, 205,
      { type: 'weaponGatling', amount: 1, label: '旋钻加特林', color: 0xf97316 },
      { type: 'heal', amount: 45, label: '地下医务站 +45', color: 0x4ade80 }),
    ...gatePair(406, 252,
      { type: 'damage', amount: 28, label: '爆破弹 +28', color: 0xfbbf24 },
      { type: 'multishot', amount: 1, label: '三联矿炮 +1', color: 0xa78bfa }),
    ...gatePair(407, 84,
      { type: 'fireRate', amount: 0.7, label: '轨道加速 +0.7', color: 0xa3e635 },
      { type: 'heal', amount: 30, label: '矿站检修 +30', color: 0x4ade80 }),
    ...gatePair(408, 180,
      { type: 'damage', amount: 17, label: '幽晶弹头 +17', color: 0xa78bfa },
      { type: 'damageDown', amount: 8, label: '晶尘侵蚀 -8', color: 0xff4d67, negative: true }),
    ...gatePair(409, 272,
      { type: 'multishot', amount: 1, label: '宝库齐射 +1', color: 0xfbbf24 },
      { type: 'crew', amount: 2, label: '地心矿工 +2', color: 0x38bdf8 }),
  ],
  enemies: [
    enemy(501, -1.3, 17, 'grunt', 68), enemy(502, 1.25, 45, 'sprinter', 108),
    enemy(503, -0.65, 73, 'flyer', 132), enemy(504, 1.2, 104, 'tank', 245),
    enemy(505, -1.35, 132, 'grunt', 205), enemy(506, 0.75, 160, 'sprinter', 235),
    enemy(507, -0.85, 190, 'flyer', 270), enemy(508, 1.3, 220, 'tank', 405),
    enemy(509, -1.25, 249, 'sprinter', 330), enemy(510, 0.8, 274, 'grunt', 375),
    enemy(511, 1.05, 31, 'grunt', 84), enemy(512, -1.15, 60, 'sprinter', 122),
    enemy(513, 1.2, 145, 'flyer', 220), enemy(514, -1.15, 206, 'tank', 370),
    enemy(515, 1.1, 262, 'flyer', 345),
    enemy(599, 0, 288, 'boss', 5800),
  ],
  obstacles: [
    obstacle(501, 0.85, 35, 115, '矿车挡木', 20),
    obstacle(502, -0.9, 86, 185, '锈蚀矿门', 30),
    obstacle(503, 0, 138, 255, '塌方巨岩', 42),
    obstacle(504, 1, 186, 325, '废弃钻机', 56),
    obstacle(505, -0.85, 234, 400, '晶簇封路', 76),
    obstacle(506, 0, 272, 490, '地心金库门', 105, true),
    obstacle(507, -1.05, 58, 145, '断轨翻斗车', 25),
    obstacle(508, 0.95, 164, 295, '幽晶塌方柱', 50),
    obstacle(509, -1.05, 254, 445, '宝库齿轮闸', 94),
  ],
  pickups: [
    pickup(501, -1.3, 30, 'shield', 60), pickup(502, 1.25, 95, 'magnet', 12),
    pickup(503, -1.25, 151, 'bomb', 410), pickup(504, 1.25, 213, 'heal', 55),
    pickup(505, -1.25, 260, 'shield', 85),
    pickup(506, 1.25, 70, 'heal', 34), pickup(507, -1.25, 180, 'magnet', 13),
    pickup(508, 1.2, 280, 'bomb', 520),
  ],
});

const LEVEL_FACTORIES: Record<LevelId, () => LevelContent> = {
  1: levelOne,
  2: levelTwo,
  3: levelThree,
  4: levelFour,
  5: levelFive,
};

export function createInitialState(levelId: LevelId = 1): GameState {
  const content = LEVEL_FACTORIES[levelId]();
  const firstSegment = content.segments[0];
  return {
    levelId,
    status: 'ready',
    time: 0,
    score: 0,
    combo: 1,
    comboTimer: 0,
    bestCombo: 1,
    kills: 0,
    levelEnd: content.levelEnd,
    player: {
      x: 0, z: 2, hp: 100, maxHp: 100,
      damage: 10, shotsPerSecond: 1.8, projectileCount: 1, crewCount: 1,
      weapon: 'pistol', shotCooldown: 0,
      shield: 0, shieldMax: 100, magnetTimer: 0,
    },
    enemies: content.enemies,
    obstacles: content.obstacles,
    pickups: content.pickups,
    segments: content.segments,
    currentSegmentId: firstSegment.id,
    vehicle: firstSegment.vehicle,
    gates: content.gates,
    bullets: [],
    events: [],
    nextBulletId: 1,
  };
}
