import './style.css';
import { GameAudio } from './game/audio';
import { InputController } from './game/input';
import { LEVEL_SUMMARIES } from './game/level';
import { GameSimulation, WEAPON_RANGE } from './game/simulation';
import type { GameStatus, LevelId } from './game/types';
import { GameWorld } from './game/world';

function requiredElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

const canvas = requiredElement<HTMLCanvasElement>('#game-canvas');
const startScreen = requiredElement<HTMLElement>('#start-screen');
const endScreen = requiredElement<HTMLElement>('#end-screen');
const startButton = requiredElement<HTMLButtonElement>('#start-button');
const restartButton = requiredElement<HTMLButtonElement>('#restart-button');
const levelOptions = requiredElement<HTMLElement>('#level-options');
const levelNumber = requiredElement<HTMLElement>('#level-number');
const levelName = requiredElement<HTMLElement>('#level-name');
const healthFill = requiredElement<HTMLElement>('#health-fill');
const healthText = requiredElement<HTMLElement>('#health-text');
const progressFill = requiredElement<HTMLElement>('#progress-fill');
const progressRunner = requiredElement<HTMLElement>('#progress-runner');
const damageStat = requiredElement<HTMLElement>('#damage-stat');
const rateStat = requiredElement<HTMLElement>('#rate-stat');
const shotStat = requiredElement<HTMLElement>('#shot-stat');
const crewStat = requiredElement<HTMLElement>('#crew-stat');
const weaponStat = requiredElement<HTMLElement>('#weapon-stat');
const shieldChip = requiredElement<HTMLElement>('#shield-chip');
const shieldText = requiredElement<HTMLElement>('#shield-text');
const segmentStat = requiredElement<HTMLElement>('#segment-stat');
const vehicleStat = requiredElement<HTMLElement>('#vehicle-stat');
const directionStat = requiredElement<HTMLElement>('#direction-stat');
const combo = requiredElement<HTMLElement>('#combo');
const comboText = requiredElement<HTMLElement>('#combo-text');
const bossHud = requiredElement<HTMLElement>('#boss-hud');
const bossHealthText = requiredElement<HTMLElement>('#boss-health-text');
const bossHealthFill = requiredElement<HTMLElement>('#boss-health-fill');
const hint = requiredElement<HTMLElement>('#hint');
const announcement = requiredElement<HTMLElement>('#announcement');
const a11yState = requiredElement<HTMLElement>('#a11y-state');
const resultIcon = requiredElement<HTMLElement>('#result-icon');
const resultKicker = requiredElement<HTMLElement>('#result-kicker');
const resultTitle = requiredElement<HTMLElement>('#result-title');
const scoreText = requiredElement<HTMLElement>('#score-text');
const killsText = requiredElement<HTMLElement>('#kills-text');
const bestComboText = requiredElement<HTMLElement>('#best-combo-text');
const resultTimeText = requiredElement<HTMLElement>('#result-time-text');
const resultWeaponIcon = requiredElement<HTMLElement>('#result-weapon-icon');
const resultWeaponName = requiredElement<HTMLElement>('#result-weapon-name');
const resultBuildSummary = requiredElement<HTMLElement>('#result-build-summary');
const resultStars = [...document.querySelectorAll<HTMLElement>('.result-star')];
const resultMetricRows = [...document.querySelectorAll<HTMLElement>('.result-metric')];
const resultMetricStars = [...document.querySelectorAll<HTMLElement>('.result-metric__star')];
const resultStarsGroup = requiredElement<HTMLElement>('#result-stars');
const resultStarCount = requiredElement<HTMLElement>('#result-star-count');
const soundButton = requiredElement<HTMLButtonElement>('#sound-button');

const simulation = new GameSimulation();
let world = new GameWorld(canvas, simulation.state);
const input = new InputController(canvas);
const audio = new GameAudio();
const LEVEL_STORAGE_KEY = 'fire-runner:selected-level';
const levelIds = LEVEL_SUMMARIES.map((level) => level.id);
let storedLevel = Number.NaN;
try {
  storedLevel = Number.parseInt(localStorage.getItem(LEVEL_STORAGE_KEY) ?? '', 10);
} catch {
  // Storage can be unavailable in strict privacy modes; level selection still works for this session.
}
let selectedLevelId: LevelId = levelIds.includes(storedLevel as LevelId) ? storedLevel as LevelId : levelIds[0];
let previousStatus: GameStatus = simulation.state.status;
let previousTime = performance.now();
let hintTimer = 3.5;
let announcementTimer = 0;
let pageActive = document.visibilityState === 'visible';
let bossIntroduced = false;
let bossPhased = false;
let scoreAnimationFrame = 0;
const resultTimers: number[] = [];

const biomeLabels = {
  surface: '地表',
  cloud: '云层',
  mine: '矿洞',
  ocean: '深海',
  hell: '地狱',
} as const;

const vehicleLabels = {
  onFoot: '徒步',
  car: '战车',
  minecart: '矿车',
  plane: '战机',
  submarine: '潜艇',
} as const;

function accentCss(accent: number | string): string {
  return typeof accent === 'number' ? `#${accent.toString(16).padStart(6, '0')}` : accent;
}

function updateLevelSelection(): void {
  for (const button of levelOptions.querySelectorAll<HTMLButtonElement>('.level-option')) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.levelId) === selectedLevelId));
  }
  const selected = LEVEL_SUMMARIES.find((level) => level.id === selectedLevelId);
  if (selected) startButton.textContent = `进入 · ${selected.title}`;
}

function selectLevel(levelId: LevelId): void {
  selectedLevelId = levelId;
  try {
    localStorage.setItem(LEVEL_STORAGE_KEY, String(levelId));
  } catch {
    // Keep the in-memory selection when persistent storage is unavailable.
  }
  updateLevelSelection();
}

function renderLevelOptions(): void {
  const fragment = document.createDocumentFragment();
  for (const level of LEVEL_SUMMARIES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'level-option';
    button.dataset.levelId = String(level.id);
    button.setAttribute('aria-pressed', String(level.id === selectedLevelId));
    button.setAttribute('aria-label', `第 ${level.id} 关 ${level.title}，${level.subtitle}`);
    button.style.setProperty('--level-accent', accentCss(level.accent));
    const biome = level.biomes.map((item) => biomeLabels[item]).join('·');
    button.innerHTML = `
      <span class="level-option__index">${String(level.id).padStart(2, '0')}</span>
      <span class="level-option__copy">
        <strong>${level.title}</strong>
        <small>${level.subtitle}</small>
        <span class="level-option__tags"><span>${biome}</span><span>${vehicleLabels[level.vehicle]}</span></span>
      </span>`;
    button.addEventListener('click', () => {
      audio.start();
      audio.select();
      selectLevel(level.id);
    });
    fragment.append(button);
  }
  levelOptions.replaceChildren(fragment);
  updateLevelSelection();
}

function rebuildWorld(): void {
  const disposableWorld = world as GameWorld & { dispose?: () => void };
  disposableWorld.dispose?.();
  world = new GameWorld(canvas, simulation.state);
  world.resize();
}

function begin(levelId: LevelId): void {
  resultTimers.splice(0).forEach((timer) => window.clearTimeout(timer));
  window.cancelAnimationFrame(scoreAnimationFrame);
  audio.start();
  audio.select();
  selectLevel(levelId);
  simulation.startLevel(levelId);
  rebuildWorld();
  startScreen.classList.remove('screen--visible');
  startScreen.setAttribute('aria-hidden', 'true');
  endScreen.classList.remove('screen--visible');
  endScreen.classList.remove('screen--won', 'screen--lost', 'result--revealing');
  endScreen.setAttribute('aria-hidden', 'true');
  previousStatus = 'running';
  hintTimer = 3.5;
  bossIntroduced = false;
  bossPhased = false;
}

startButton.addEventListener('click', () => begin(selectedLevelId));
restartButton.addEventListener('click', () => begin(selectedLevelId));

function updateSoundButton(): void {
  soundButton.textContent = audio.isMuted ? '🔇' : '🔊';
  soundButton.setAttribute('aria-pressed', String(audio.isMuted));
  soundButton.setAttribute('aria-label', audio.isMuted ? '开启音效' : '关闭音效');
}

soundButton.addEventListener('click', () => {
  audio.start();
  audio.toggleMuted();
  updateSoundButton();
  if (!audio.isMuted) audio.select();
});

function announce(text: string, color?: number): void {
  announcement.textContent = text;
  announcement.style.setProperty('--announcement-color', color ? `#${color.toString(16).padStart(6, '0')}` : '#ffffff');
  announcement.classList.remove('announcement--visible');
  void announcement.offsetWidth;
  announcement.classList.add('announcement--visible');
  announcementTimer = 1.3;
}

function updateHud(): void {
  const { state } = simulation;
  const levelSummary = LEVEL_SUMMARIES.find((level) => level.id === state.levelId);
  levelNumber.textContent = state.levelId.toString();
  levelName.textContent = levelSummary?.title ?? '';
  const hpRatio = Math.max(0, state.player.hp / state.player.maxHp);
  const boss = state.enemies.find((enemy) => enemy.boss);
  const progress = Math.max(0, Math.min(1, state.player.z / (boss?.z ?? state.levelEnd)));
  healthFill.style.transform = `scaleX(${hpRatio})`;
  healthText.textContent = Math.ceil(state.player.hp).toString();
  shieldText.textContent = Math.ceil(state.player.shield).toString();
  shieldChip.classList.toggle('shield-chip--visible', state.player.shield > 0);
  progressFill.style.transform = `scaleX(${progress})`;
  progressRunner.style.insetInlineStart = `calc(${progress * 100}% - .45rem)`;
  damageStat.textContent = Math.round(state.player.damage).toString();
  rateStat.textContent = state.player.shotsPerSecond.toFixed(1);
  shotStat.textContent = state.player.projectileCount.toString();
  crewStat.textContent = state.player.crewCount.toString();
  weaponStat.textContent = ({ pistol: '手枪', rifle: '步枪', gatling: '加特林' })[state.player.weapon];
  const segment = state.segments.find((item) => item.id === state.currentSegmentId) ?? state.segments[0];
  if (segment) segmentStat.textContent = segment.title;
  vehicleStat.textContent = ({ onFoot: '徒步', car: '战车', minecart: '矿车', plane: '战机', submarine: '潜艇' })[state.vehicle];
  directionStat.textContent = `持续射击 · 射程 ${WEAPON_RANGE[state.player.weapon]}m`;
  const comboVisible = state.combo > 1 && state.comboTimer > 0;
  combo.classList.toggle('combo--visible', comboVisible);
  combo.setAttribute('aria-hidden', String(!comboVisible));
  comboText.textContent = `×${state.combo}`;

  const bossVisible = Boolean(boss?.alive && boss.z - state.player.z < 27);
  bossHud.classList.toggle('boss-hud--visible', bossVisible);
  bossHud.setAttribute('aria-hidden', String(!bossVisible));
  if (boss) {
    const bossRatio = Math.max(0, boss.hp / boss.maxHp);
    bossHealthFill.style.transform = `scaleX(${bossRatio})`;
    bossHealthText.textContent = Math.ceil(boss.hp).toString();
    if (bossVisible && !bossIntroduced) {
      bossIntroduced = true;
      audio.bossRoar();
      announce('⚠ 首领拦截', 0xfbbf24);
    }
    if (bossVisible && boss.hp <= boss.maxHp * 0.5 && !bossPhased) {
      bossPhased = true;
      audio.bossPhase();
      announce('首领狂暴 · 火力全开', 0xff5470);
    }
  }

  audio.run(state.status === 'running');

  for (const event of state.events) {
    if (event.type === 'shot') audio.shot(state.player.weapon, state.player.crewCount);
    if (event.type === 'enemyHit') audio.hit();
    if (event.type === 'playerHit') audio.hurt();
    if (event.type === 'enemyDefeated') audio.defeat(event.boss);
    if (event.type === 'gate') {
      audio.gate(event.negative);
      announce(event.negative ? `⚠ ${event.label}` : event.label, event.color);
      a11yState.textContent = event.negative ? `受到负面效果：${event.label}` : `已获得强化：${event.label}`;
    }
    if (event.type === 'gateCharged' && (event.converted || event.progress >= 1)) {
      audio.gate(false);
      const message = event.converted ? `净化成功 · ${event.label}` : `充能完成 · ${event.label}`;
      announce(message, event.color);
      a11yState.textContent = message;
    }
    if (event.type === 'obstacleDestroyed') {
      announce('障碍击破', 0xffd955);
      a11yState.textContent = '前方障碍已击破';
    }
    if (event.type === 'obstacleReward') {
      audio.gate(false);
      announce(`击破奖励 · ${event.label}`, event.color);
      a11yState.textContent = `获得击破奖励：${event.label}`;
    }
    if (event.type === 'hazardWarning') {
      audio.hazardWarning();
      announce(`⚠ ${event.label} · 立刻换道`, event.color);
      a11yState.textContent = `${event.label}即将命中，立刻切换到没有红色标记的路线`;
    }
    if (event.type === 'hazardHit') {
      announce(`${event.label}命中 -${event.amount}`, 0xff5b68);
      a11yState.textContent = `${event.label}命中，受到${event.amount}点伤害`;
    }
    if (event.type === 'hazardAvoided') {
      audio.upgrade();
      announce(`完美闪避 +${event.score}`, event.color);
      a11yState.textContent = `成功避开危险区域，获得${event.score}分`;
    }
    if (event.type === 'obstacleCollision') {
      audio.hurt();
      announce(event.fatal ? '致命碰撞' : `撞击 -${event.amount}`, 0xff5470);
    }
    if (event.type === 'bombDetonated') {
      audio.bomb();
      const result = event.targetsHit > 0
        ? `命中 ${event.targetsHit} · 摧毁 ${event.targetsDestroyed}`
        : '冲击波已释放';
      announce(`💥 全屏炸弹引爆！${result}`, 0xffa62b);
      a11yState.textContent = `全屏炸弹引爆，造成 ${Math.round(event.damage)} 点伤害，命中 ${event.targetsHit} 个目标，摧毁 ${event.targetsDestroyed} 个目标`;
    }
    if (event.type === 'pickup') {
      const pickupLabel = ({ shield: '能量护盾', bomb: '全屏炸弹', magnet: '磁力核心', heal: '医疗包' })[event.pickupType];
      if (event.pickupType === 'bomb') continue;
      audio.gate(false);
      announce(`获得 ${pickupLabel}`, 0x67e8f9);
      a11yState.textContent = `拾取道具：${pickupLabel}`;
    }
    if (event.type === 'shieldHit') a11yState.textContent = `护盾吸收 ${Math.round(event.absorbed)} 点伤害`;
    if (event.type === 'segmentChanged') {
      announce(`${event.title} · ${event.vehicle === 'onFoot' ? '徒步' : vehicleStat.textContent}`, 0x67e8f9);
      a11yState.textContent = `进入${event.title}，攻击前方目标`;
    }
    if (event.type === 'enemyDefeated' && event.combo > 1) {
      a11yState.textContent = `${event.combo} 连击`;
    }
  }
}

function formatRunTime(seconds: number): string {
  const totalSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

function animateResultScore(target: number): void {
  window.cancelAnimationFrame(scoreAnimationFrame);
  const startedAt = performance.now();
  const duration = 850;
  const update = (now: number): void => {
    const progress = Math.min(1, (now - startedAt) / duration);
    const eased = 1 - (1 - progress) ** 3;
    scoreText.textContent = Math.round(target * eased).toLocaleString('zh-CN');
    if (progress < 1) scoreAnimationFrame = window.requestAnimationFrame(update);
  };
  scoreAnimationFrame = window.requestAnimationFrame(update);
}

function showEnd(status: 'won' | 'lost'): void {
  const won = status === 'won';
  resultTimers.splice(0).forEach((timer) => window.clearTimeout(timer));
  const currentLevel = LEVEL_SUMMARIES.find((level) => level.id === simulation.state.levelId);
  const currentIndex = LEVEL_SUMMARIES.findIndex((level) => level.id === simulation.state.levelId);
  const nextLevel = LEVEL_SUMMARIES[(currentIndex + 1) % LEVEL_SUMMARIES.length];
  resultIcon.textContent = won ? '🏆' : '💥';
  resultKicker.textContent = won ? `${currentLevel?.title ?? '关卡'} · BOSS 击破` : `${currentLevel?.title ?? '关卡'} · 冲刺中断`;
  resultTitle.textContent = won ? '任务完成' : '任务中断';
  scoreText.textContent = '0';
  killsText.textContent = simulation.state.kills.toString();
  bestComboText.textContent = `×${simulation.state.bestCombo}`;
  resultTimeText.textContent = formatRunTime(simulation.state.time);

  const weaponCopy = {
    pistol: { icon: '🔫', name: '战术手枪' },
    rifle: { icon: '▰', name: '突击步枪' },
    gatling: { icon: '✹', name: '重型加特林' },
  }[simulation.state.player.weapon];
  resultWeaponIcon.textContent = weaponCopy.icon;
  resultWeaponName.textContent = weaponCopy.name;
  resultBuildSummary.textContent = `${simulation.state.player.crewCount} 人 · ${simulation.state.player.projectileCount} 弹道 · ${Math.round(simulation.state.player.damage)} 伤害`;

  const timeLimit = Math.ceil(simulation.state.levelEnd / 3.8);
  const ratings = won
    ? [simulation.state.time <= timeLimit, simulation.state.kills >= 6, simulation.state.bestCombo >= 2]
    : [false, false, false];
  const earnedStars = ratings.filter(Boolean).length;
  resultStars.forEach((star, index) => star.classList.toggle('is-earned', ratings[index]));
  resultMetricStars.forEach((star, index) => star.classList.toggle('is-earned', ratings[index]));
  resultMetricRows.forEach((row, index) => row.classList.toggle('is-earned', ratings[index]));
  resultMetricRows[0].setAttribute('aria-label', `冲刺用时 ${formatRunTime(simulation.state.time)}，三星目标 ${formatRunTime(timeLimit)}`);
  resultMetricRows[1].setAttribute('aria-label', `击破数量 ${simulation.state.kills}，三星目标 6`);
  resultMetricRows[2].setAttribute('aria-label', `最高连击 ${simulation.state.bestCombo}，三星目标 2`);
  resultStarsGroup.setAttribute('aria-label', `本关评价：${earnedStars} 星`);
  resultStarCount.textContent = `${earnedStars} / 3 ★`;

  if (won && nextLevel) selectLevel(nextLevel.id);
  else selectLevel(simulation.state.levelId);
  restartButton.textContent = won && nextLevel
    ? `下一关 · ${nextLevel.title}`
    : `重试 · ${currentLevel?.title ?? '当前关'}`;
  endScreen.classList.remove('screen--won', 'screen--lost', 'result--revealing');
  endScreen.classList.add(won ? 'screen--won' : 'screen--lost');
  endScreen.classList.add('screen--visible');
  endScreen.setAttribute('aria-hidden', 'false');
  void endScreen.offsetWidth;
  endScreen.classList.add('result--revealing');
  const scoreTimer = window.setTimeout(() => animateResultScore(simulation.state.score), won ? 1500 : 350);
  resultTimers.push(scoreTimer);
  if (won) {
    ratings.forEach((earned, index) => {
      if (!earned) return;
      resultTimers.push(window.setTimeout(() => audio.resultStar(index), 520 + index * 430));
    });
  }
  a11yState.textContent = won
    ? `胜利，本关获得 ${earnedStars} 星，本局得分 ${simulation.state.score}`
    : `游戏结束，本局得分 ${simulation.state.score}`;
  if (won) audio.victory();
  else audio.lose();
  window.setTimeout(() => restartButton.focus(), 250);
}

function frame(now: number): void {
  const dt = Math.min((now - previousTime) / 1000, 0.05);
  previousTime = now;
  if (pageActive) {
    simulation.setMove(input.update(dt));
    simulation.update(dt);
    world.update(simulation.state, dt);
    updateHud();
  }

  if (hintTimer > 0 && simulation.state.status === 'running') {
    hintTimer -= dt;
    if (hintTimer <= 0) hint.classList.add('hint--hidden');
  }
  if (announcementTimer > 0) {
    announcementTimer -= dt;
    if (announcementTimer <= 0) announcement.classList.remove('announcement--visible');
  }

  if (simulation.state.status !== previousStatus) {
    previousStatus = simulation.state.status;
    if (previousStatus === 'won' || previousStatus === 'lost') showEnd(previousStatus);
  }
  requestAnimationFrame(frame);
}

const resizeObserver = new ResizeObserver(() => world.resize());
resizeObserver.observe(requiredElement<HTMLElement>('#app'));
document.addEventListener('visibilitychange', () => {
  pageActive = document.visibilityState === 'visible';
  previousTime = performance.now();
});
canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  a11yState.textContent = '图形设备暂时不可用，请刷新页面重试。';
});

updateHud();
updateSoundButton();
renderLevelOptions();
requestAnimationFrame(frame);
