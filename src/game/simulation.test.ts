import { describe, expect, it } from 'vitest';
import { createInitialState, LEVEL_SUMMARIES } from './level';
import { GameSimulation, WEAPON_RANGE } from './simulation';
import { TrackPath } from './track';
import type { LevelId } from './types';

describe('GameSimulation', () => {
  it('does not advance before the game starts', () => {
    const game = new GameSimulation();
    const initialZ = game.state.player.z;
    game.update(1);
    expect(game.state.player.z).toBe(initialZ);
  });

  it('adds visible squad members from a crew gate', () => {
    const game = new GameSimulation();
    game.start();
    game.state.player.z = 32.9;
    game.setMove(-1);
    for (let index = 0; index < 12; index += 1) game.update(0.05);
    expect(game.state.gates.filter((gate) => gate.pairId === 1).every((gate) => gate.used)).toBe(true);
    expect(game.state.player.crewCount).toBe(3);
    expect(game.state.player.damage).toBe(10);
    expect(game.state.player.shotsPerSecond).toBe(1.8);
  });

  it('applies red negative gates without dropping below safe minimums', () => {
    const game = new GameSimulation();
    game.start();
    game.state.gates.filter((gate) => gate.z < 82.5).forEach((gate) => { gate.used = true; });
    game.state.player.z = 82.4;
    const negativeGate = game.state.gates.find((gate) => gate.pairId === 2 && gate.negative)!;
    game.setMove(negativeGate.side);
    let sawNegativeEvent = false;
    for (let index = 0; index < 12; index += 1) {
      game.update(0.05);
      sawNegativeEvent ||= game.state.events.some((event) => event.type === 'gate' && event.negative);
    }
    expect(game.state.player.damage).toBe(4);
    expect(sawNegativeEvent).toBe(true);
  });

  it('changes weapon stats when taking the rifle gate', () => {
    const game = new GameSimulation();
    game.start();
    game.state.gates.filter((gate) => gate.z < 82.5).forEach((gate) => { gate.used = true; });
    game.state.player.z = 82.4;
    const rifleGate = game.state.gates.find((gate) => gate.pairId === 2 && gate.type === 'weaponRifle')!;
    game.setMove(rifleGate.side);
    for (let index = 0; index < 12; index += 1) game.update(0.05);
    expect(game.state.player.weapon).toBe('rifle');
    expect(game.state.player.damage).toBe(17);
    expect(game.state.player.shotsPerSecond).toBe(3.4);
  });

  it('automatically fires at enemies in range', () => {
    const game = new GameSimulation();
    game.start();
    game.state.player.z = 6.5;
    game.update(0.016);
    expect(game.state.bullets.length).toBeGreaterThan(0);
    expect(game.state.events.some((event) => event.type === 'shot')).toBe(true);
  });

  it('keeps firing forward when no target is in range', () => {
    const game = new GameSimulation();
    game.start();
    game.state.enemies.forEach((enemy) => { enemy.alive = false; });
    game.state.obstacles.forEach((obstacle) => { obstacle.alive = false; });
    game.update(0.016);
    expect(game.state.bullets).toHaveLength(1);
    expect(game.state.bullets[0].vx).toBe(0);
    expect(game.state.bullets[0].vz).toBeGreaterThan(0);
    expect(game.state.events.some((event) => event.type === 'shot')).toBe(true);
  });

  it('expires bullets at the current weapon range', () => {
    const game = new GameSimulation();
    game.start();
    game.state.enemies.forEach((enemy) => { enemy.alive = false; });
    game.state.obstacles.forEach((obstacle) => { obstacle.alive = false; });
    game.update(0.016);
    const bulletId = game.state.bullets[0].id;
    expect(game.state.bullets[0].remainingRange).toBeLessThan(WEAPON_RANGE.pistol);
    game.state.player.shotCooldown = 999;
    for (let index = 0; index < 14; index += 1) game.update(0.05);
    expect(game.state.bullets.some((bullet) => bullet.id === bulletId)).toBe(false);
  });

  it('gives each weapon a distinct effective range', () => {
    expect(WEAPON_RANGE.rifle).toBeGreaterThan(WEAPON_RANGE.gatling);
    expect(WEAPON_RANGE.gatling).toBeGreaterThan(WEAPON_RANGE.pistol);
  });

  it('chooses the non-negative gate while the player is in the center safety zone', () => {
    const game = new GameSimulation();
    game.start();
    game.state.gates.filter((gate) => gate.z < 82.5).forEach((gate) => { gate.used = true; });
    game.state.player.z = 82.4;
    game.update(0.05);
    expect(game.state.player.weapon).toBe('rifle');
    expect(game.state.events.some((event) => event.type === 'gate' && event.negative)).toBe(false);
  });

  it('fires one projectile per unlocked trajectory', () => {
    const game = new GameSimulation();
    game.start();
    game.state.player.z = 6.5;
    game.state.player.projectileCount = 3;
    game.update(0.016);
    expect(game.state.bullets).toHaveLength(3);
  });

  it('lets every squad member participate in a volley', () => {
    const game = new GameSimulation();
    game.start();
    game.state.player.z = 6.5;
    game.state.player.crewCount = 3;
    game.state.player.projectileCount = 2;
    game.update(0.016);
    expect(game.state.bullets).toHaveLength(6);
  });

  it('restart restores the initial progression values', () => {
    const game = new GameSimulation();
    game.state.player.damage = 99;
    game.state.score = 999;
    game.restart();
    expect(game.state.player.damage).toBe(10);
    expect(game.state.player.projectileCount).toBe(1);
    expect(game.state.player.crewCount).toBe(1);
    expect(game.state.player.weapon).toBe('pistol');
    expect(game.state.score).toBe(0);
    expect(game.state.combo).toBe(1);
    expect(game.state.status).toBe('running');
  });

  it('ships five enemy archetypes with distinct combat profiles', () => {
    const game = new GameSimulation();
    const archetypes = new Set(game.state.enemies.map((enemy) => enemy.archetype));
    expect(archetypes).toEqual(new Set(['grunt', 'tank', 'sprinter', 'flyer', 'boss']));
    const tank = game.state.enemies.find((enemy) => enemy.archetype === 'tank');
    const sprinter = game.state.enemies.find((enemy) => enemy.archetype === 'sprinter');
    const flyer = game.state.enemies.find((enemy) => enemy.archetype === 'flyer');
    expect(tank!.radius).toBeGreaterThan(sprinter!.radius);
    expect(sprinter!.speed).toBeGreaterThan(tank!.speed);
    expect(flyer!.altitude).toBeGreaterThan(0);
  });

  it('automatically targets and shoots destructible obstacles', () => {
    const game = new GameSimulation();
    game.start();
    game.state.enemies.forEach((enemy) => { enemy.alive = false; });
    game.state.obstacles.slice(1).forEach((obstacle) => { obstacle.alive = false; });
    const obstacle = game.state.obstacles[0];
    obstacle.x = 0;
    obstacle.z = 10;
    obstacle.hp = 10;
    obstacle.maxHp = 10;
    game.state.player.z = 5;
    game.state.player.damage = 20;
    const initialFireRate = game.state.player.shotsPerSecond;
    let destroyed = false;
    let rewarded = false;
    for (let index = 0; index < 8; index += 1) {
      game.update(0.05);
      destroyed ||= game.state.events.some((event) => event.type === 'obstacleDestroyed');
      rewarded ||= game.state.events.some((event) => event.type === 'obstacleReward');
    }
    expect(obstacle.alive).toBe(false);
    expect(destroyed).toBe(true);
    expect(rewarded).toBe(true);
    expect(game.state.player.shotsPerSecond).toBe(initialFireRate + obstacle.rewardAmount);
  });

  it('turns a selected negative gate into a positive upgrade by shooting it', () => {
    const game = new GameSimulation();
    game.start();
    game.state.enemies.forEach((enemy) => { enemy.alive = false; });
    game.state.obstacles.forEach((obstacle) => { obstacle.alive = false; });
    const pair = game.state.gates.filter((gate) => gate.pairId === 2);
    const negativeGate = pair.find((gate) => gate.negative)!;
    game.state.gates.filter((gate) => gate.z < negativeGate.z).forEach((gate) => { gate.used = true; });
    game.state.player.weapon = 'rifle';
    game.state.player.shotsPerSecond = 12;
    game.state.player.z = negativeGate.z - 12;
    game.setMove(negativeGate.side);
    let converted = false;
    for (let index = 0; index < 32 && negativeGate.shotCharge < negativeGate.shotChargeMax; index += 1) {
      game.update(0.05);
      converted ||= game.state.events.some((event) => event.type === 'gateCharged' && event.converted);
    }
    expect(negativeGate.shotCharge).toBe(negativeGate.shotChargeMax);
    expect(negativeGate.negative).toBe(false);
    expect(negativeGate.type).toBe('damage');
    expect(negativeGate.amount).toBeGreaterThan(0);
    expect(negativeGate.label).toContain('+');
    expect(converted).toBe(true);
  });

  it('charges only the currently selected gate when both choices can be shot', () => {
    const game = new GameSimulation(2);
    game.start();
    game.state.enemies.forEach((enemy) => { enemy.alive = false; });
    game.state.obstacles.forEach((obstacle) => { obstacle.alive = false; });
    const pair = game.state.gates.filter((gate) => gate.pairId === 104);
    const selected = pair.find((gate) => gate.negative)!;
    const other = pair.find((gate) => gate.id !== selected.id)!;
    other.shootable = true;
    other.shotChargeMax = 5;
    game.state.gates.filter((gate) => gate.z < selected.z).forEach((gate) => { gate.used = true; });
    game.state.player.weapon = 'rifle';
    game.state.player.shotsPerSecond = 12;
    game.state.player.z = selected.z - 12;
    game.setMove(selected.side);
    for (let index = 0; index < 22; index += 1) game.update(0.05);
    expect(selected.shotCharge).toBeGreaterThan(0);
    expect(other.shotCharge).toBe(0);
  });

  it('amplifies authored positive gates when their charge bar is filled', () => {
    const game = new GameSimulation();
    game.start();
    game.state.enemies.forEach((enemy) => { enemy.alive = false; });
    game.state.obstacles.forEach((obstacle) => { obstacle.alive = false; });
    const gate = game.state.gates.find((candidate) => candidate.pairId === 4 && candidate.shootable)!;
    const baseAmount = gate.baseAmount;
    game.state.gates.filter((candidate) => candidate.z < gate.z).forEach((candidate) => { candidate.used = true; });
    game.state.player.weapon = 'rifle';
    game.state.player.shotsPerSecond = 12;
    game.state.player.z = gate.z - 12;
    game.setMove(gate.side);
    for (let index = 0; index < 32 && gate.shotCharge < gate.shotChargeMax; index += 1) game.update(0.05);
    expect(gate.shotCharge).toBe(gate.shotChargeMax);
    expect(gate.amount).toBeGreaterThan(baseAmount);
    expect(gate.label).toContain('+');
  });

  it('applies obstacle collision damage and consumes the obstacle', () => {
    const game = new GameSimulation();
    game.start();
    game.state.obstacles.slice(1).forEach((obstacle) => { obstacle.alive = false; });
    const obstacle = game.state.obstacles[0];
    obstacle.x = 0;
    obstacle.z = 2.32;
    obstacle.collisionDamage = 30;
    game.update(0.05);
    expect(game.state.player.hp).toBe(70);
    expect(obstacle.alive).toBe(false);
    expect(game.state.events.some((event) => event.type === 'obstacleCollision')).toBe(true);
  });

  it('lets shields absorb collision damage before health', () => {
    const game = new GameSimulation();
    game.start();
    game.state.player.shield = 20;
    game.state.obstacles.slice(1).forEach((obstacle) => { obstacle.alive = false; });
    const obstacle = game.state.obstacles[0];
    obstacle.x = 0;
    obstacle.z = 2.32;
    obstacle.collisionDamage = 30;
    game.update(0.05);
    expect(game.state.player.shield).toBe(0);
    expect(game.state.player.hp).toBe(90);
    expect(game.state.events.some((event) => event.type === 'shieldHit')).toBe(true);
  });

  it('supports fatal barriers that must be destroyed or dodged', () => {
    const game = new GameSimulation();
    game.start();
    game.state.obstacles.slice(1).forEach((obstacle) => { obstacle.alive = false; });
    const obstacle = game.state.obstacles[0];
    obstacle.x = 0;
    obstacle.z = 2.32;
    obstacle.fatal = true;
    game.update(0.05);
    expect(game.state.player.hp).toBe(0);
    expect(game.state.status).toBe('lost');
  });

  it('warns before a hazard wave and does not repeat the warning', () => {
    const game = new GameSimulation();
    game.start();
    const firstWave = game.state.hazards.filter((hazard) => hazard.waveId === game.state.hazards[0].waveId);
    game.state.player.z = firstWave[0].z - 20.2;
    game.update(0.05);
    expect(firstWave.every((hazard) => hazard.warned)).toBe(true);
    expect(game.state.events.filter((event) => event.type === 'hazardWarning')).toHaveLength(1);
    game.update(0.05);
    expect(game.state.events.some((event) => event.type === 'hazardWarning')).toBe(false);
  });

  it('damages the player once when entering a marked hazard lane', () => {
    const game = new GameSimulation();
    game.start();
    const target = game.state.hazards[0];
    const wave = game.state.hazards.filter((hazard) => hazard.waveId === target.waveId);
    game.state.player.x = target.x;
    game.setMove(target.x / 2);
    game.state.player.z = target.z - 0.1;
    game.update(0.05);
    expect(game.state.player.hp).toBe(100 - target.damage);
    expect(wave.every((hazard) => hazard.resolved)).toBe(true);
    expect(game.state.events.some((event) => event.type === 'hazardHit')).toBe(true);
    game.update(0.05);
    expect(game.state.player.hp).toBe(100 - target.damage);
  });

  it('awards a perfect dodge for taking the open lane', () => {
    const game = new GameSimulation();
    game.start();
    const waveId = game.state.hazards[0].waveId;
    const wave = game.state.hazards.filter((hazard) => hazard.waveId === waveId);
    const safeLane = [-1.35, 0, 1.35].find((lane) => wave.every((hazard) => hazard.x !== lane))!;
    game.state.gates.forEach((gate) => { gate.used = true; });
    game.state.player.x = safeLane;
    game.setMove(safeLane / 2);
    game.state.player.z = wave[0].z - 0.1;
    game.update(0.05);
    expect(game.state.player.hp).toBe(100);
    expect(game.state.challengeDodges).toBe(1);
    expect(game.state.score).toBe(200);
    expect(game.state.events).toContainEqual(expect.objectContaining({ type: 'hazardAvoided', score: 200 }));
  });

  it('collects shield, magnet and healing pickups', () => {
    const game = new GameSimulation();
    game.start();
    game.state.pickups.forEach((item, index) => {
      item.collected = index > 0;
    });
    const item = game.state.pickups[0];
    item.x = 0;
    item.z = 2.32;
    item.type = 'shield';
    item.amount = 45;
    game.update(0.05);
    expect(game.state.player.shield).toBe(45);
    expect(game.state.events.some((event) => event.type === 'pickup' && event.pickupType === 'shield')).toBe(true);

    item.collected = false;
    item.z = game.state.player.z + 0.32;
    item.type = 'magnet';
    item.amount = 8;
    game.update(0.05);
    expect(game.state.player.magnetTimer).toBeGreaterThan(7.9);

    game.state.player.hp = 50;
    item.collected = false;
    item.z = game.state.player.z + 0.32;
    item.type = 'heal';
    item.amount = 25;
    game.update(0.05);
    expect(game.state.player.hp).toBe(75);
  });

  it('bomb pickups clear nearby enemies and barriers', () => {
    const game = new GameSimulation();
    game.start();
    game.state.enemies.forEach((enemy) => { enemy.alive = false; });
    game.state.obstacles.forEach((obstacle) => { obstacle.alive = false; });
    game.state.pickups.forEach((item) => { item.collected = true; });
    const enemy = game.state.enemies[0];
    enemy.alive = true;
    enemy.hp = 20;
    enemy.z = 6;
    const obstacle = game.state.obstacles[0];
    obstacle.alive = true;
    obstacle.hp = 20;
    obstacle.z = 7;
    const bomb = game.state.pickups[0];
    bomb.collected = false;
    bomb.x = 0;
    bomb.z = 2.32;
    bomb.type = 'bomb';
    bomb.amount = 50;
    game.update(0.05);
    expect(enemy.alive).toBe(false);
    expect(obstacle.alive).toBe(false);
    expect(game.state.events).toContainEqual(expect.objectContaining({
      type: 'bombDetonated',
      targetsHit: 2,
      targetsDestroyed: 2,
      enemiesDefeated: 1,
      obstaclesDestroyed: 1,
    }));
  });

  it('pulls nearby uncollected items while the magnet is active', () => {
    const game = new GameSimulation();
    game.start();
    game.state.pickups.forEach((item, index) => { item.collected = index !== 0; });
    const item = game.state.pickups[0];
    item.x = 1.5;
    item.z = 6;
    game.state.player.magnetTimer = 5;
    const oldDistance = Math.hypot(item.x - game.state.player.x, item.z - game.state.player.z);
    game.update(0.05);
    const newDistance = Math.hypot(item.x - game.state.player.x, item.z - game.state.player.z);
    expect(newDistance).toBeLessThan(oldDistance);
  });

  it('switches biome and vehicle at segment boundaries', () => {
    const game = new GameSimulation();
    game.start();
    game.state.player.z = 122.95;
    game.update(0.05);
    expect(game.state.currentSegmentId).toBe(2);
    expect(game.state.vehicle).toBe('car');
    expect(game.state.events.some((event) =>
      event.type === 'segmentChanged' && event.biome === 'mine' && event.vehicle === 'car',
    )).toBe(true);

    game.state.player.z = 257.95;
    game.state.currentSegmentId = 2;
    game.state.vehicle = 'car';
    game.update(0.05);
    expect(game.state.vehicle).toBe('onFoot');
    expect(game.state.segments.map((segment) => segment.biome)).toEqual(
      ['surface', 'mine', 'hell'],
    );
  });

  it('only targets enemies in front of the player', () => {
    const game = new GameSimulation();
    game.start();
    game.state.player.z = 55;
    game.state.enemies.forEach((enemy) => { enemy.alive = false; });
    game.state.obstacles.forEach((obstacle) => { obstacle.alive = false; });
    const behind = game.state.enemies[0];
    behind.alive = true;
    behind.x = 0;
    behind.z = 50;
    const ahead = game.state.enemies[1];
    ahead.alive = true;
    ahead.x = 0;
    ahead.z = 61;
    game.update(0.016);
    expect(game.state.bullets).toHaveLength(1);
    expect(game.state.bullets[0].vz).toBeGreaterThan(0);
  });

  it('removes attack-direction configuration from every segment', () => {
    for (const levelId of [1, 2, 3, 4, 5] as LevelId[]) {
      for (const segment of createInitialState(levelId).segments) {
        expect('attackDirection' in segment).toBe(false);
      }
    }
  });

  it('exposes five distinct selectable level summaries', () => {
    expect(LEVEL_SUMMARIES.map((level) => level.id)).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(LEVEL_SUMMARIES.map((level) => level.title)).size).toBe(5);
    expect(LEVEL_SUMMARIES.every((level) => level.subtitle.length > 0 && level.biomes.length > 0)).toBe(true);
  });

  it('creates independent level states with unique themed content', () => {
    const levels = ([1, 2, 3, 4, 5] as LevelId[]).map(createInitialState);
    expect(levels.map((level) => level.levelId)).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(levels.map((level) => level.enemies.find((enemy) => enemy.boss)!.maxHp)).size).toBe(5);
    expect(new Set(levels.flatMap((level) => level.obstacles.map((item) => item.label))).size).toBe(45);
  });

  it('alternates negative gates across both sides of the track', () => {
    const negativeSides = ([1, 2, 3, 4, 5] as LevelId[])
      .flatMap((levelId) => createInitialState(levelId).gates)
      .filter((gate) => gate.negative)
      .map((gate) => gate.side);
    expect(negativeSides).toContain(-1);
    expect(negativeSides).toContain(1);
  });

  it('ships fifteen regular enemies, a boss and all five archetypes in every level', () => {
    for (const levelId of [1, 2, 3, 4, 5] as LevelId[]) {
      const state = createInitialState(levelId);
      expect(state.enemies.filter((enemy) => !enemy.boss)).toHaveLength(15);
      expect(state.enemies.filter((enemy) => enemy.boss)).toHaveLength(1);
      expect(new Set(state.enemies.map((enemy) => enemy.archetype))).toEqual(
        new Set(['grunt', 'tank', 'sprinter', 'flyer', 'boss']),
      );
    }
  });

  it('includes dedicated long cloud, ocean and minecart campaigns', () => {
    const cloud = createInitialState(2);
    const ocean = createInitialState(3);
    const minecart = createInitialState(5);
    expect(cloud.segments.every((segment) => segment.vehicle === 'plane')).toBe(true);
    expect(cloud.segments.map((segment) => segment.biome)).toEqual(['surface', 'cloud', 'cloud']);
    expect(ocean.segments.every((segment) => segment.biome === 'ocean' && segment.vehicle === 'submarine')).toBe(true);
    expect(minecart.segments.every((segment) => segment.biome === 'mine' && segment.vehicle === 'minecart')).toBe(true);
    expect(ocean.levelEnd).toBeGreaterThan(405);
    expect(minecart.levelEnd).toBeGreaterThan(435);
  });

  it('limits vehicle changes to at most two per level', () => {
    for (const levelId of [1, 2, 3, 4, 5] as LevelId[]) {
      const vehicles = createInitialState(levelId).segments.map((segment) => segment.vehicle);
      const changes = vehicles.slice(1).filter((vehicle, index) => vehicle !== vehicles[index]).length;
      expect(changes).toBeLessThanOrEqual(2);
    }
  });

  it('starts a selected level and restarts the currently selected level by default', () => {
    const game = new GameSimulation();
    game.startLevel(2);
    expect(game.state.levelId).toBe(2);
    expect(game.state.status).toBe('running');
    expect(game.state.vehicle).toBe('plane');
    game.state.score = 900;
    game.restart();
    expect(game.state.levelId).toBe(2);
    expect(game.state.score).toBe(0);
    expect(game.state.status).toBe('running');
    game.restart(3);
    expect(game.state.levelId).toBe(3);
    expect(game.state.vehicle).toBe('submarine');
    game.restart(5);
    expect(game.state.levelId).toBe(5);
    expect(game.state.vehicle).toBe('minecart');
  });

  it('gives every attackable enemy, boss and obstacle a consistent health pool', () => {
    for (const levelId of [1, 2, 3, 4, 5] as LevelId[]) {
      const state = createInitialState(levelId);
      for (const target of [...state.enemies, ...state.obstacles]) {
        expect(target.hp).toBeGreaterThan(0);
        expect(target.maxHp).toBe(target.hp);
      }
    }
  });

  it('assigns a visible combat reward to every destructible obstacle', () => {
    const rewards = new Set<string>();
    for (const levelId of [1, 2, 3, 4, 5] as LevelId[]) {
      for (const obstacle of createInitialState(levelId).obstacles) {
        expect(obstacle.rewardAmount).toBeGreaterThan(0);
        expect(obstacle.rewardLabel).toContain('+');
        rewards.add(obstacle.rewardType);
      }
    }
    expect(rewards).toEqual(new Set(['damage', 'fireRate', 'crew', 'shield']));
  });

  it('adds four fair two-lane hazard waves to every campaign', () => {
    const hazardTypes = new Set<string>();
    for (const levelId of [1, 2, 3, 4, 5] as LevelId[]) {
      const state = createInitialState(levelId);
      const waveIds = [...new Set(state.hazards.map((hazard) => hazard.waveId))];
      expect(waveIds).toHaveLength(4);
      expect(state.hazards).toHaveLength(8);
      for (const waveId of waveIds) {
        const wave = state.hazards.filter((hazard) => hazard.waveId === waveId);
        expect(wave).toHaveLength(2);
        expect(new Set(wave.map((hazard) => hazard.x)).size).toBe(2);
        expect([-1.35, 0, 1.35].filter((lane) => wave.every((hazard) => hazard.x !== lane))).toHaveLength(1);
        expect([...state.gates, ...state.obstacles].every((item) => Math.abs(item.z - wave[0].z) > 5.5)).toBe(true);
      }
      state.hazards.forEach((hazard) => hazardTypes.add(hazard.type));
    }
    expect(hazardTypes).toEqual(new Set(['rockfall', 'lightning', 'caveBlast', 'depthCharge', 'lavaBurst']));
  });

  it('makes every negative numeric gate shootable and convertible', () => {
    for (const levelId of [1, 2, 3, 4, 5] as LevelId[]) {
      const negativeGates = createInitialState(levelId).gates.filter((gate) => gate.negative);
      expect(negativeGates.length).toBeGreaterThan(0);
      expect(negativeGates.every((gate) => gate.shootable && gate.shotChargeMax > 0)).toBe(true);
    }
  });

  it('keeps the minecart expedition on one vehicle for all three long segments', () => {
    const state = createInitialState(5);
    expect(state.segments).toHaveLength(3);
    expect(state.segments.every((segment) => segment.vehicle === 'minecart')).toBe(true);
    expect(state.enemies.filter((enemy) => !enemy.boss)).toHaveLength(15);
    expect(state.obstacles).toHaveLength(9);
  });

  it('extends every campaign by at least forty-five percent with proportional content', () => {
    const previousLengths: Record<LevelId, number> = { 1: 250, 2: 276, 3: 282, 4: 292, 5: 296 };
    const expectedGatePairs: Record<LevelId, number> = { 1: 10, 2: 9, 3: 9, 4: 9, 5: 9 };
    for (const levelId of [1, 2, 3, 4, 5] as LevelId[]) {
      const state = createInitialState(levelId);
      expect(state.levelEnd).toBeGreaterThanOrEqual(previousLengths[levelId] * 1.45);
      expect(state.enemies.filter((target) => !target.boss)).toHaveLength(15);
      expect(state.obstacles).toHaveLength(9);
      expect(state.pickups).toHaveLength(8);
      expect(new Set(state.gates.map((gate) => gate.pairId)).size).toBe(expectedGatePairs[levelId]);
    }
  });

  it('keeps the single boss before the finish and scales existing progression coordinates', () => {
    for (const levelId of [1, 2, 3, 4, 5] as LevelId[]) {
      const state = createInitialState(levelId);
      const bosses = state.enemies.filter((target) => target.boss);
      expect(bosses).toHaveLength(1);
      expect(bosses[0].z).toBeLessThan(state.levelEnd);
      expect(state.segments.at(-1)!.endZ).toBe(state.levelEnd);
      expect([...state.gates, ...state.enemies, ...state.obstacles, ...state.pickups]
        .every((target) => target.z < state.levelEnd)).toBe(true);
    }
    const first = createInitialState(1);
    expect(first.segments[0].endZ).toBe(82 * 1.5);
    expect(first.gates.find((gate) => gate.pairId === 1)!.z).toBe(22 * 1.5);
    expect(first.enemies.find((target) => target.id === 1)!.z).toBe(14 * 1.5);
  });

  it('gives every campaign visible horizontal turns and vertical elevation changes', () => {
    for (const levelId of [1, 2, 3, 4, 5] as LevelId[]) {
      const state = createInitialState(levelId);
      const track = new TrackPath(levelId, state.levelEnd);
      const points = Array.from({ length: 13 }, (_, index) => track.point(state.levelEnd * index / 12));
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(5);
      expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.8);
    }
  });
});
