import { createInitialState } from './level';
import { SQUAD_OFFSETS } from './squad';
import type { EnemyState, GameState, GateState, HazardState, LevelId, ObstacleState, UpgradeType, VehicleMode, WeaponType } from './types';

const TRACK_HALF_WIDTH = 2;
const BULLET_SPEED = 24;
const GATE_CENTER_DEAD_ZONE = 0.32;
const BOMB_RADIUS = 13;
const GATE_POSITIVE_COLOR = 0x4ade80;
const GATE_NEUTRAL_COLOR = 0xfacc15;
const NEGATIVE_GATE_CONVERSION: Partial<Record<UpgradeType, UpgradeType>> = {
  damageDown: 'damage',
  fireRateDown: 'fireRate',
  crewDown: 'crew',
};
export const WEAPON_RANGE: Record<WeaponType, number> = {
  pistol: 14,
  rifle: 18,
  gatling: 16,
};
const VEHICLE_SPEED: Record<VehicleMode, number> = {
  onFoot: 6.4,
  car: 9,
  minecart: 8.4,
  plane: 11,
  submarine: 7.2,
};

type CombatTarget =
  | { kind: 'enemy'; entity: EnemyState }
  | { kind: 'obstacle'; entity: ObstacleState }
  | { kind: 'gate'; entity: GateState };

export function selectGateSide(pair: readonly GateState[], playerX: number): -1 | 1 {
  if (Math.abs(playerX) > GATE_CENTER_DEAD_ZONE) return playerX < 0 ? -1 : 1;
  const safeChoices = pair.filter((candidate) => !candidate.negative);
  if (safeChoices.length === 1) return safeChoices[0].side;
  return playerX < 0 ? -1 : 1;
}

export class GameSimulation {
  state: GameState;
  private desiredX = 0;

  constructor(levelId: LevelId = 1) {
    this.state = createInitialState(levelId);
  }

  start(): void {
    if (this.state.status === 'ready') this.state.status = 'running';
  }

  startLevel(levelId: LevelId): void {
    this.state = createInitialState(levelId);
    this.desiredX = 0;
    this.state.status = 'running';
  }

  restart(levelId: LevelId = this.state.levelId): void {
    this.startLevel(levelId);
  }

  setMove(normalizedX: number): void {
    this.desiredX = Math.max(-1, Math.min(1, normalizedX)) * TRACK_HALF_WIDTH;
  }

  update(dt: number): void {
    if (this.state.status !== 'running') return;
    const safeDt = Math.min(dt, 0.05);
    const { player } = this.state;
    this.state.events.length = 0;
    this.state.time += safeDt;
    this.state.comboTimer = Math.max(0, this.state.comboTimer - safeDt);
    if (this.state.comboTimer === 0) this.state.combo = 1;
    player.magnetTimer = Math.max(0, player.magnetTimer - safeDt);

    const boss = this.state.enemies.find((item) => item.boss && item.alive);
    const bossDistance = boss ? boss.z - player.z : Infinity;
    const runSpeed = bossDistance < 8 ? 1.15 : VEHICLE_SPEED[this.state.vehicle];
    player.z += runSpeed * safeDt;
    player.x += (this.desiredX - player.x) * Math.min(1, safeDt * 11);
    player.shotCooldown -= safeDt;

    this.resolveSegment();
    this.resolveGates();
    this.updatePickups(safeDt);
    this.resolveHazards();
    this.resolveObstacleCollisions();
    this.updateEnemies(safeDt);
    this.autoFire();
    this.updateBullets(safeDt);

    for (const enemy of this.state.enemies) enemy.hitFlash = Math.max(0, enemy.hitFlash - safeDt);
    for (const obstacle of this.state.obstacles) obstacle.hitFlash = Math.max(0, obstacle.hitFlash - safeDt);
    for (const gate of this.state.gates) gate.hitFlash = Math.max(0, gate.hitFlash - safeDt);
    this.state.bullets = this.state.bullets.filter((bullet) =>
      bullet.alive && Math.abs(bullet.z - player.z) < 24,
    );

    if (player.hp <= 0) {
      player.hp = 0;
      this.state.status = 'lost';
    } else if (boss && !boss.alive) {
      this.state.status = 'won';
      this.state.score += 1000;
    }
  }

  private resolveSegment(): void {
    const segment = this.state.segments.find((candidate, index) =>
      this.state.player.z >= candidate.startZ &&
      (this.state.player.z < candidate.endZ || index === this.state.segments.length - 1),
    );
    if (!segment || segment.id === this.state.currentSegmentId) return;
    this.state.currentSegmentId = segment.id;
    this.state.vehicle = segment.vehicle;
    this.state.events.push({
      type: 'segmentChanged',
      segmentId: segment.id,
      biome: segment.biome,
      vehicle: segment.vehicle,
      title: segment.title,
    });
  }

  private resolveGates(): void {
    const { player, gates } = this.state;
    for (const gate of gates) {
      if (gate.used || player.z < gate.z) continue;
      const pair = gates.filter((candidate) => candidate.pairId === gate.pairId);
      const chosenSide = selectGateSide(pair, player.x);
      const chosen = pair.find((candidate) => candidate.side === chosenSide);
      pair.forEach((candidate) => { candidate.used = true; });
      if (!chosen) continue;

      if (chosen.type === 'damage') player.damage += chosen.amount;
      if (chosen.type === 'fireRate') player.shotsPerSecond += chosen.amount;
      if (chosen.type === 'heal') player.hp = Math.min(player.maxHp, player.hp + chosen.amount);
      if (chosen.type === 'multishot') player.projectileCount = Math.min(4, player.projectileCount + chosen.amount);
      if (chosen.type === 'crew') player.crewCount = Math.min(SQUAD_OFFSETS.length, player.crewCount + chosen.amount);
      if (chosen.type === 'weaponRifle') {
        player.weapon = 'rifle';
        player.damage += 7;
        player.shotsPerSecond = Math.max(player.shotsPerSecond, 3.4);
      }
      if (chosen.type === 'weaponGatling') {
        player.weapon = 'gatling';
        player.damage += 8;
        player.shotsPerSecond = Math.max(player.shotsPerSecond, 6.4);
      }
      if (chosen.type === 'damageDown') player.damage = Math.max(4, player.damage - chosen.amount);
      if (chosen.type === 'fireRateDown') player.shotsPerSecond = Math.max(1, player.shotsPerSecond * (1 - chosen.amount));
      if (chosen.type === 'crewDown') player.crewCount = Math.max(1, player.crewCount - chosen.amount);
      this.state.score += chosen.negative ? -50 : 100;
      this.state.events.push({ type: 'gate', label: chosen.label, color: chosen.color, negative: chosen.negative });
      break;
    }
  }

  private updatePickups(dt: number): void {
    const { player } = this.state;
    for (const item of this.state.pickups) {
      if (item.collected) continue;
      const dz = item.z - player.z;
      if (player.magnetTimer > 0 && Math.abs(dz) < 6) {
        const pull = Math.min(1, dt * 8);
        item.x += (player.x - item.x) * pull;
        item.z += (player.z - item.z) * pull;
      }
      if (
        Math.abs(item.z - player.z) > item.radius + 0.75 ||
        Math.abs(item.x - player.x) > item.radius + 0.55
      ) continue;
      item.collected = true;
      this.applyPickup(item);
      this.state.score += 125;
      this.state.events.push({ type: 'pickup', pickupId: item.id, pickupType: item.type, amount: item.amount });
    }
  }

  private applyPickup(item: GameState['pickups'][number]): void {
    const { player } = this.state;
    if (item.type === 'shield') player.shield = Math.min(player.shieldMax, player.shield + item.amount);
    if (item.type === 'heal') player.hp = Math.min(player.maxHp, player.hp + item.amount);
    if (item.type === 'magnet') player.magnetTimer = Math.max(player.magnetTimer, item.amount);
    if (item.type !== 'bomb') return;

    let enemiesHit = 0;
    let enemiesDefeated = 0;
    let obstaclesHit = 0;
    let obstaclesDestroyed = 0;
    for (const obstacle of this.state.obstacles) {
      if (!obstacle.alive || Math.abs(obstacle.z - player.z) > BOMB_RADIUS) continue;
      obstaclesHit += 1;
      obstacle.hp -= item.amount;
      obstacle.hitFlash = 0.16;
      if (obstacle.hp <= 0) {
        obstaclesDestroyed += 1;
        this.destroyObstacle(obstacle);
      }
    }
    for (const enemy of this.state.enemies) {
      if (!enemy.alive || Math.abs(enemy.z - player.z) > BOMB_RADIUS) continue;
      enemiesHit += 1;
      enemy.hp -= item.amount;
      enemy.hitFlash = 0.16;
      if (enemy.hp <= 0) {
        enemiesDefeated += 1;
        this.defeatEnemy(enemy);
      }
    }
    this.state.events.push({
      type: 'bombDetonated',
      x: player.x,
      z: player.z,
      damage: item.amount,
      radius: BOMB_RADIUS,
      targetsHit: enemiesHit + obstaclesHit,
      targetsDestroyed: enemiesDefeated + obstaclesDestroyed,
      enemiesHit,
      enemiesDefeated,
      obstaclesHit,
      obstaclesDestroyed,
    });
  }

  private resolveObstacleCollisions(): void {
    const { player } = this.state;
    for (const obstacle of this.state.obstacles) {
      if (!obstacle.alive) continue;
      if (
        Math.abs(obstacle.z - player.z) >= obstacle.radius + 0.58 ||
        Math.abs(obstacle.x - player.x) >= obstacle.radius + 0.48
      ) continue;
      obstacle.alive = false;
      const damage = obstacle.fatal ? player.hp + player.shield : obstacle.collisionDamage;
      this.state.events.push({
        type: 'obstacleCollision',
        obstacleId: obstacle.id,
        amount: damage,
        fatal: obstacle.fatal,
      });
      if (obstacle.fatal) {
        player.shield = 0;
        player.hp = 0;
      } else {
        this.damagePlayer(damage);
      }
    }
  }

  private updateEnemies(dt: number): void {
    const { player } = this.state;
    for (const enemy of this.state.enemies) {
      if (!enemy.alive) continue;
      const dz = enemy.z - player.z;
      if (enemy.speed > 0 && dz > 0.2 && dz < 11) enemy.z -= enemy.speed * dt;
      if (enemy.archetype === 'flyer') {
        enemy.x += Math.sin(this.state.time * 3.2 + enemy.movementPhase) * dt * 0.68;
        enemy.x = Math.max(-2, Math.min(2, enemy.x));
      }

      const dx = enemy.x - player.x;
      if (Math.abs(enemy.z - player.z) < enemy.radius + 0.55 && Math.abs(dx) < enemy.radius + 0.5) {
        this.damagePlayer(enemy.damage);
        if (enemy.boss) {
          enemy.z += 1.8;
        } else {
          enemy.alive = false;
        }
      }
    }
  }

  private damagePlayer(amount: number): void {
    const { player } = this.state;
    const absorbed = Math.min(player.shield, amount);
    if (absorbed > 0) {
      player.shield -= absorbed;
      this.state.events.push({ type: 'shieldHit', absorbed, remaining: player.shield });
    }
    const healthDamage = amount - absorbed;
    if (healthDamage <= 0) return;
    player.hp -= healthDamage;
    this.state.events.push({ type: 'playerHit', amount: healthDamage });
  }

  private autoFire(): void {
    const { player } = this.state;
    if (player.shotCooldown > 0) return;
    const target = this.findTarget(WEAPON_RANGE[player.weapon]) ?? this.findTarget(Infinity);

    const spread = 0.085;
    for (let memberIndex = 0; memberIndex < player.crewCount; memberIndex += 1) {
      const member = SQUAD_OFFSETS[memberIndex];
      const originX = player.x + member.x;
      const originZ = player.z + 0.65 + member.z;
      const aimAngle = target
        ? Math.atan2(target.entity.x - originX, target.entity.z - originZ)
        : 0;
      for (let index = 0; index < player.projectileCount; index += 1) {
        const angle = aimAngle + (index - (player.projectileCount - 1) / 2) * spread;
        this.state.bullets.push({
          id: this.state.nextBulletId++,
          x: originX,
          z: originZ,
          vx: Math.sin(angle) * BULLET_SPEED,
          vz: Math.cos(angle) * BULLET_SPEED,
          damage: player.damage,
          remainingRange: WEAPON_RANGE[player.weapon],
          alive: true,
        });
      }
    }
    player.shotCooldown = 1 / player.shotsPerSecond;
    this.state.events.push({ type: 'shot', x: player.x, z: player.z });
  }

  private findTarget(range: number): CombatTarget | undefined {
    const { player } = this.state;
    const inAttackArc = (z: number): boolean => {
      const dz = z - player.z;
      return dz >= -0.5 && dz <= range;
    };
    const chargeableGate = this.findChargeableGate(range);
    const targets: CombatTarget[] = [
      ...(chargeableGate ? [{ kind: 'gate' as const, entity: chargeableGate }] : []),
      ...this.state.obstacles
        .filter((item) => item.alive && inAttackArc(item.z))
        .map((entity): CombatTarget => ({ kind: 'obstacle', entity })),
      ...this.state.enemies
        .filter((item) => item.alive && inAttackArc(item.z))
        .map((entity): CombatTarget => ({ kind: 'enemy', entity })),
    ];
    return targets.sort((a, b) =>
      Math.abs(a.entity.z - player.z) - Math.abs(b.entity.z - player.z),
    )[0];
  }

  private resolveHazards(): void {
    const { hazards, player } = this.state;
    const waves = new Map<number, HazardState[]>();
    for (const hazard of hazards) {
      if (hazard.resolved) continue;
      const wave = waves.get(hazard.waveId) ?? [];
      wave.push(hazard);
      waves.set(hazard.waveId, wave);
    }

    for (const [waveId, wave] of waves) {
      const lead = wave[0];
      const distance = lead.z - player.z;
      if (!lead.warned && distance <= 20) {
        wave.forEach((hazard) => { hazard.warned = true; });
        this.state.events.push({
          type: 'hazardWarning',
          waveId,
          label: lead.label,
          color: lead.color,
        });
      }
      if (player.z < lead.z) continue;

      wave.forEach((hazard) => { hazard.resolved = true; });
      const collision = wave.find((hazard) =>
        Math.abs(hazard.x - player.x) < hazard.radius + 0.32,
      );
      if (collision) {
        this.damagePlayer(collision.damage);
        this.state.events.push({
          type: 'hazardHit',
          waveId,
          x: collision.x,
          z: collision.z,
          amount: collision.damage,
          label: collision.label,
          color: collision.color,
        });
      } else {
        const score = 200;
        this.state.score += score;
        this.state.challengeDodges += 1;
        this.state.events.push({
          type: 'hazardAvoided',
          waveId,
          x: player.x,
          z: lead.z,
          score,
          color: 0xb9f34a,
        });
      }
    }
  }

  private findChargeableGate(range: number): GateState | undefined {
    const { gates, player } = this.state;
    const nextGate = gates
      .filter((gate) => !gate.used && gate.z >= player.z - 0.5)
      .sort((a, b) => a.z - b.z)[0];
    if (!nextGate || nextGate.z - player.z > range) return undefined;
    const pair = gates.filter((gate) => gate.pairId === nextGate.pairId);
    const selectedSide = selectGateSide(pair, player.x);
    return pair.find((gate) =>
      gate.side === selectedSide && gate.shootable && gate.shotCharge < gate.shotChargeMax,
    );
  }

  private updateBullets(dt: number): void {
    for (const bullet of this.state.bullets) {
      if (!bullet.alive) continue;
      bullet.x += bullet.vx * dt;
      bullet.z += bullet.vz * dt;
      bullet.remainingRange -= Math.hypot(bullet.vx, bullet.vz) * dt;
      if (bullet.remainingRange <= 0) {
        bullet.alive = false;
        continue;
      }

      const obstacle = this.state.obstacles.find((candidate) =>
        candidate.alive &&
        Math.hypot(candidate.x - bullet.x, candidate.z - bullet.z) < candidate.radius + 0.28,
      );
      if (obstacle) {
        bullet.alive = false;
        obstacle.hp -= bullet.damage;
        obstacle.hitFlash = 0.1;
        this.state.events.push({
          type: 'obstacleHit',
          obstacleId: obstacle.id,
          x: obstacle.x,
          z: obstacle.z,
          damage: bullet.damage,
        });
        if (obstacle.hp <= 0) this.destroyObstacle(obstacle);
        continue;
      }

      const selectedGate = this.findChargeableGate(Infinity);
      if (
        selectedGate &&
        Math.abs(selectedGate.z - bullet.z) < 0.5 &&
        Math.abs(selectedGate.x - bullet.x) < 1.08
      ) {
        bullet.alive = false;
        this.chargeGate(selectedGate);
        continue;
      }

      const enemy = this.state.enemies.find((candidate) =>
        candidate.alive &&
        Math.hypot(candidate.x - bullet.x, candidate.z - bullet.z) < candidate.radius + 0.28,
      );
      if (!enemy) continue;

      bullet.alive = false;
      enemy.hp -= bullet.damage;
      enemy.hitFlash = 0.1;
      this.state.events.push({
        type: 'enemyHit',
        enemyId: enemy.id,
        x: enemy.x,
        z: enemy.z,
        damage: bullet.damage,
      });
      if (enemy.hp <= 0) this.defeatEnemy(enemy);
    }
  }

  private destroyObstacle(obstacle: ObstacleState): void {
    if (!obstacle.alive) return;
    obstacle.hp = 0;
    obstacle.alive = false;
    this.state.score += 120;
    this.state.events.push({
      type: 'obstacleDestroyed',
      obstacleId: obstacle.id,
      x: obstacle.x,
      z: obstacle.z,
    });
    this.applyObstacleReward(obstacle);
  }

  private applyObstacleReward(obstacle: ObstacleState): void {
    const { player } = this.state;
    const colors = {
      damage: 0xffd24a,
      fireRate: 0x67e8f9,
      crew: 0x93f65b,
      shield: 0x52a9ff,
    } as const;
    if (obstacle.rewardType === 'damage') player.damage += obstacle.rewardAmount;
    if (obstacle.rewardType === 'fireRate') player.shotsPerSecond += obstacle.rewardAmount;
    if (obstacle.rewardType === 'crew') {
      player.crewCount = Math.min(SQUAD_OFFSETS.length, player.crewCount + obstacle.rewardAmount);
    }
    if (obstacle.rewardType === 'shield') {
      player.shield = Math.min(player.shieldMax, player.shield + obstacle.rewardAmount);
    }
    this.state.score += 80;
    this.state.events.push({
      type: 'obstacleReward',
      obstacleId: obstacle.id,
      label: obstacle.rewardLabel,
      color: colors[obstacle.rewardType],
    });
  }

  private chargeGate(gate: GateState): void {
    if (!gate.shootable || gate.used || gate.shotCharge >= gate.shotChargeMax) return;
    const wasNegative = gate.negative;
    gate.shotCharge = Math.min(gate.shotChargeMax, gate.shotCharge + 1);
    gate.hitFlash = 0.14;
    const progress = gate.shotCharge / gate.shotChargeMax;
    const convertedType = NEGATIVE_GATE_CONVERSION[gate.baseType];

    if (convertedType) {
      const signedAmount = gate.baseAmount * (progress * 2 - 1);
      if (signedAmount < -0.001) {
        gate.type = gate.baseType;
        gate.amount = this.roundGateAmount(gate.baseType, Math.abs(signedAmount));
        gate.negative = true;
        gate.color = progress >= 0.34 ? 0xffa94d : gate.baseColor;
      } else if (signedAmount > 0.001) {
        gate.type = convertedType;
        gate.amount = this.roundGateAmount(convertedType, signedAmount);
        gate.negative = false;
        gate.color = GATE_POSITIVE_COLOR;
      } else {
        gate.type = convertedType;
        gate.amount = 0;
        gate.negative = false;
        gate.color = GATE_NEUTRAL_COLOR;
      }
    } else {
      gate.amount = this.roundGateAmount(gate.baseType, gate.baseAmount * (1 + progress * 0.5));
      gate.negative = false;
      gate.color = gate.baseColor;
    }

    gate.label = this.formatGateLabel(gate);
    this.state.events.push({
      type: 'gateCharged',
      gateId: gate.id,
      label: gate.label,
      color: gate.color,
      converted: wasNegative && !gate.negative,
      progress,
    });
  }

  private roundGateAmount(type: UpgradeType, amount: number): number {
    if (type === 'crew' || type === 'crewDown') return amount <= 0 ? 0 : Math.max(1, Math.round(amount));
    if (type === 'fireRate' || type === 'fireRateDown') return Math.round(amount * 100) / 100;
    return Math.round(amount);
  }

  private formatGateLabel(gate: GateState): string {
    if (gate.amount <= 0) return `${gate.baseLabel} 已净化`;
    if (gate.type === 'fireRateDown') return `${gate.baseLabel} -${Math.round(gate.amount * 100)}%`;
    if (gate.type === 'fireRate') return `${gate.baseLabel} +${gate.amount.toFixed(2).replace(/0$/, '')}`;
    return `${gate.baseLabel} ${gate.negative ? '-' : '+'}${gate.amount}`;
  }

  private defeatEnemy(enemy: EnemyState): void {
    if (!enemy.alive) return;
    enemy.hp = 0;
    enemy.alive = false;
    if (!enemy.boss) {
      this.state.combo = this.state.comboTimer > 0 ? Math.min(8, this.state.combo + 1) : 1;
      this.state.comboTimer = 2.4;
      this.state.bestCombo = Math.max(this.state.bestCombo, this.state.combo);
      this.state.kills += 1;
    }
    this.state.score += Math.round((enemy.boss ? 500 : 75) * this.state.combo);
    this.state.events.push({
      type: 'enemyDefeated',
      enemyId: enemy.id,
      x: enemy.x,
      z: enemy.z,
      boss: enemy.boss,
      combo: this.state.combo,
    });
  }
}
