const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const scoreEl = document.getElementById("score");
const bestScoreEl = document.getElementById("best-score");
const effectEl = document.getElementById("core-status");
const statusPanel = document.getElementById("status-panel");
const resetBtn = document.getElementById("reset-btn");
const pauseBtn = document.getElementById("pause-btn");
const touchButtons = document.querySelectorAll(".touch-btn");

const GRID_SIZE = 24;
const CELL = canvas.width / GRID_SIZE;
const INITIAL_TICK = 160;
const MIN_TICK = 70;
const SPEED_STEP = 4;
const PICKUP_SPAWN_CHANCE = 0.55;

const PICKUP_DEFS = [
  {
    key: "time-warp",
    label: "Time Warp",
    type: "buff",
    duration: 6000,
    speedDelta: 80,
    colors: { stroke: "#f8e45c", fill: "rgba(248,228,92,0.25)" },
  },
  {
    key: "flux-drive",
    label: "Flux Drive",
    type: "buff",
    duration: 5000,
    speedDelta: -40,
    colors: { stroke: "#3cfad5", fill: "rgba(60,250,213,0.25)" },
  },
  {
    key: "phase-shift",
    label: "Phase Shift",
    type: "buff",
    duration: 7000,
    phase: true,
    colors: { stroke: "#7b61ff", fill: "rgba(123,97,255,0.25)" },
  },
  {
    key: "mirror-curse",
    label: "Mirror Curse",
    type: "debuff",
    duration: 5500,
    invert: true,
    colors: { stroke: "#ff5f8f", fill: "rgba(255,95,143,0.25)" },
  },
  {
    key: "gravity-lock",
    label: "Gravity Lock",
    type: "debuff",
    duration: 6500,
    speedDelta: 120,
    colors: { stroke: "#ffb347", fill: "rgba(255,179,71,0.25)" },
  },
];

const canUseStorage = (() => {
  try {
    const key = "__snake_test__";
    localStorage.setItem(key, "1");
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
})();

const storageKey = "neon-snake-best";
const storedBest = canUseStorage ? Number(localStorage.getItem(storageKey)) || 0 : 0;
bestScoreEl.textContent = storedBest;

const state = {
  snake: [],
  direction: { x: 1, y: 0 },
  queueDir: [],
  food: { x: 10, y: 10 },
  running: false,
  paused: false,
  score: 0,
  best: storedBest,
  tick: INITIAL_TICK,
  pickup: null,
  effect: null,
  effectEnd: 0,
  speedShift: 0,
  canPhase: false,
  controlsInverted: false,
};

const directionVectors = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const keyDirectionMap = {
  ArrowUp: "up",
  KeyW: "up",
  ArrowDown: "down",
  KeyS: "down",
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
};

const AudioCtor = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;

const ensureAudio = () => {
  if (!AudioCtor) return null;
  if (!audioCtx) {
    audioCtx = new AudioCtor();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
};

const playBlip = () => {
  const ctx = ensureAudio();
  if (!ctx) return;
  const duration = 0.09;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(260, ctx.currentTime);
  gain.gain.setValueAtTime(0.2, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + duration);
};

let lastTime = 0;
let restartTimer = null;
let pickupRespawnHandle = null;
let swipePointerId = null;
let swipeStart = null;

const setStatus = (title, message) => {
  statusPanel.querySelector("h2").textContent = title;
  statusPanel.querySelector("p").textContent = message;
};

const showStatusPanel = (title, message) => {
  if (title || message) {
    setStatus(title ?? statusPanel.querySelector("h2").textContent, message ?? statusPanel.querySelector("p").textContent);
  }
  statusPanel.style.display = "";
  statusPanel.hidden = false;
  statusPanel.classList.remove("hidden");
  statusPanel.removeAttribute("aria-hidden");
};

const hideStatusPanel = () => {
  statusPanel.style.display = "none";
  statusPanel.hidden = true;
  statusPanel.classList.add("hidden");
  statusPanel.setAttribute("aria-hidden", "true");
};

const updateEffectStatus = (label, tag = "idle") => {
  effectEl.textContent = label;
  effectEl.dataset.state = tag;
};

const resetEffectFlags = () => {
  state.speedShift = 0;
  state.canPhase = false;
  state.controlsInverted = false;
};

const clearActiveEffect = () => {
  resetEffectFlags();
  state.effect = null;
  state.effectEnd = 0;
  if (state.pickup) {
    updateEffectStatus("Pickup Ready", "pending");
  } else {
    updateEffectStatus("None", "idle");
  }
};

const applyPickupEffect = (pickup) => {
  resetEffectFlags();
  state.effect = pickup;
  state.effectEnd = performance.now() + pickup.duration;
  state.speedShift = pickup.speedDelta || 0;
  state.canPhase = Boolean(pickup.phase);
  state.controlsInverted = Boolean(pickup.invert);
  updateEffectStatus(pickup.label, pickup.type);
};

const schedulePickup = (delay = 3600) => {
  if (pickupRespawnHandle) return;
  pickupRespawnHandle = setTimeout(() => {
    spawnPickup(true);
    pickupRespawnHandle = null;
  }, delay);
};

function initSnake() {
  state.snake = [
    { x: 8, y: 12 },
    { x: 7, y: 12 },
    { x: 6, y: 12 },
  ];
  state.direction = { x: 1, y: 0 };
  state.queueDir = [];
}

function spawnFood() {
  let pos;
  do {
    pos = {
      x: Math.floor(Math.random() * GRID_SIZE),
      y: Math.floor(Math.random() * GRID_SIZE),
    };
  } while (state.snake.some((segment) => segment.x === pos.x && segment.y === pos.y));
  state.food = pos;
}

function spawnPickup(force = false) {
  if (!force && (state.pickup || Math.random() > PICKUP_SPAWN_CHANCE)) return;
  let spot;
  do {
    spot = {
      x: Math.floor(Math.random() * GRID_SIZE),
      y: Math.floor(Math.random() * GRID_SIZE),
    };
  } while (
    (state.food && spot.x === state.food.x && spot.y === state.food.y) ||
    state.snake.some((segment) => segment.x === spot.x && segment.y === spot.y)
  );
  const def = PICKUP_DEFS[Math.floor(Math.random() * PICKUP_DEFS.length)];
  state.pickup = { ...def, x: spot.x, y: spot.y };
  if (!state.effect) {
    updateEffectStatus("Pickup Ready", "pending");
  }
}

function updateScore(value) {
  state.score = value;
  scoreEl.textContent = value;
  if (value > state.best) {
    state.best = value;
    bestScoreEl.textContent = value;
    if (canUseStorage) {
      localStorage.setItem(storageKey, String(value));
    }
  }
  const speedBoosts = Math.floor(value / SPEED_STEP);
  state.tick = Math.max(MIN_TICK, INITIAL_TICK - speedBoosts * 10);
}

function resetGame() {
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  if (pickupRespawnHandle) {
    clearTimeout(pickupRespawnHandle);
    pickupRespawnHandle = null;
  }
  initSnake();
  spawnFood();
  state.pickup = null;
  clearActiveEffect();
  spawnPickup(true);
  updateScore(0);
  state.running = false;
  state.paused = false;
  state.tick = INITIAL_TICK;
  showStatusPanel("Ready", "Press any direction or tap the board to launch");
  updatePauseLabel();
  drawScene();
}

function startGame() {
  if (state.paused) {
    state.paused = false;
    updatePauseLabel();
  }
  if (state.running) return;
  ensureAudio();
  state.running = true;
  hideStatusPanel();
}

function queueDirection({ x, y }) {
  const lastDir = state.queueDir[state.queueDir.length - 1] || state.direction;
  if (lastDir.x === -x && lastDir.y === -y) return;
  state.queueDir.push({ x, y });
}

function submitDirection(vector) {
  if (!vector) return;
  let dir = vector;
  if (state.controlsInverted) {
    dir = { x: -vector.x, y: -vector.y };
  }
  queueDirection(dir);
  startGame();
}

function handleKeydown(event) {
  if (event.code === "KeyP") {
    event.preventDefault();
    togglePause();
    return;
  }

  const directionName = keyDirectionMap[event.code];
  if (!directionName) return;
  event.preventDefault();
  submitDirection(directionVectors[directionName]);
}

const handleTouchButton = (event) => {
  event.preventDefault();
  const dir = event.currentTarget?.dataset?.dir;
  if (!dir) return;
  submitDirection(directionVectors[dir]);
};

const handlePointerDown = (event) => {
  if (event.pointerType === "touch") {
    swipePointerId = event.pointerId;
    swipeStart = { x: event.clientX, y: event.clientY };
  }
  startGame();
};

const handlePointerUp = (event) => {
  if (event.pointerId !== swipePointerId || !swipeStart) return;
  const dx = event.clientX - swipeStart.x;
  const dy = event.clientY - swipeStart.y;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  const threshold = 24;
  if (absX > threshold || absY > threshold) {
    if (absX > absY) {
      submitDirection(directionVectors[dx > 0 ? "right" : "left"]);
    } else {
      submitDirection(directionVectors[dy > 0 ? "down" : "up"]);
    }
  }
  swipePointerId = null;
  swipeStart = null;
};

const cancelSwipe = () => {
  swipePointerId = null;
  swipeStart = null;
};

function applyPickupCollision(next) {
  if (!state.pickup) return;
  if (next.x === state.pickup.x && next.y === state.pickup.y) {
    applyPickupEffect(state.pickup);
    state.pickup = null;
    schedulePickup();
  }
}

function updateSnake() {
  if (state.paused) return;
  if (state.queueDir.length) {
    state.direction = state.queueDir.shift();
  }
  const head = state.snake[0];
  let next = { x: head.x + state.direction.x, y: head.y + state.direction.y };

  if (state.canPhase) {
    if (next.x < 0) next.x = GRID_SIZE - 1;
    if (next.y < 0) next.y = GRID_SIZE - 1;
    if (next.x >= GRID_SIZE) next.x = 0;
    if (next.y >= GRID_SIZE) next.y = 0;
  }

  const hitsWall = next.x < 0 || next.y < 0 || next.x >= GRID_SIZE || next.y >= GRID_SIZE;
  const hitsSelf = state.snake.some((segment) => segment.x === next.x && segment.y === next.y);
  if ((hitsWall && !state.canPhase) || hitsSelf) {
    gameOver(hitsWall ? "Wall Impact" : "Self Collision");
    return;
  }

  state.snake.unshift(next);

  if (next.x === state.food.x && next.y === state.food.y) {
    playBlip();
    updateScore(state.score + 1);
    spawnFood();
    spawnPickup();
  } else {
    state.snake.pop();
  }

  applyPickupCollision(next);
}

function drawScene() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();
  drawFood();
  drawPickup();
  drawSnake();
}

function drawGrid() {
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= GRID_SIZE; i++) {
    ctx.beginPath();
    ctx.moveTo(i * CELL, 0);
    ctx.lineTo(i * CELL, canvas.height);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, i * CELL);
    ctx.lineTo(canvas.width, i * CELL);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(8,247,254,0.5)";
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
}

function drawFood() {
  const pulse = (Math.sin(Date.now() / 150) + 1) * 0.5;
  const gradient = ctx.createRadialGradient(
    state.food.x * CELL + CELL / 2,
    state.food.y * CELL + CELL / 2,
    2,
    state.food.x * CELL + CELL / 2,
    state.food.y * CELL + CELL / 2,
    CELL
  );
  gradient.addColorStop(0, `rgba(247,6,207,${0.8 + pulse * 0.2})`);
  gradient.addColorStop(1, "rgba(8,247,254,0.2)");
  ctx.fillStyle = gradient;
  ctx.fillRect(state.food.x * CELL, state.food.y * CELL, CELL, CELL);
}

function drawPickup() {
  if (!state.pickup) return;
  const { x, y, colors } = state.pickup;
  const pulse = (Math.sin(Date.now() / 200) + 1) * 0.5;
  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = colors.stroke;
  ctx.shadowColor = colors.stroke;
  ctx.shadowBlur = 18;
  ctx.globalAlpha = 0.7 + pulse * 0.2;
  ctx.strokeRect(x * CELL + 4, y * CELL + 4, CELL - 8, CELL - 8);
  ctx.fillStyle = colors.fill;
  ctx.fillRect(x * CELL + 6, y * CELL + 6, CELL - 12, CELL - 12);
  ctx.restore();
}

function drawSnake() {
  ctx.save();
  state.snake.forEach((segment, index) => {
    const progress = index / state.snake.length;
    const color = `hsl(${180 + progress * 60}, 90%, ${60 - progress * 20}%)`;
    ctx.fillStyle = color;
    ctx.fillRect(segment.x * CELL + 2, segment.y * CELL + 2, CELL - 4, CELL - 4);
  });

  const head = state.snake[0];
  ctx.shadowColor = "rgba(8,247,254,0.7)";
  ctx.shadowBlur = 20;
  ctx.strokeStyle = "rgba(8,247,254,0.9)";
  ctx.strokeRect(head.x * CELL + 1, head.y * CELL + 1, CELL - 2, CELL - 2);
  ctx.restore();
}

const getTickDuration = (timestamp) => {
  if (state.effect && timestamp >= state.effectEnd) {
    clearActiveEffect();
  }
  return Math.max(50, state.tick + (state.speedShift || 0));
};

const updatePauseLabel = () => {
  pauseBtn.textContent = state.paused ? "Resume" : "Pause";
};

const togglePause = () => {
  if (!state.running && !state.paused) {
    return;
  }
  if (!state.paused) {
    state.paused = true;
    state.running = false;
    showStatusPanel("Paused", "Tap resume to continue");
  } else {
    state.paused = false;
    state.running = true;
    hideStatusPanel();
  }
  updatePauseLabel();
};

function gameOver(reason = "Systems Overload") {
  state.running = false;
  state.paused = false;
  showStatusPanel(reason, `Score ${state.score} - rebooting...`);
  restartTimer = setTimeout(() => {
    resetGame();
    startGame();
  }, 1000);
}

function loop(timestamp) {
  requestAnimationFrame(loop);
  if (!state.running) return;
  if (timestamp - lastTime >= getTickDuration(timestamp)) {
    updateSnake();
    drawScene();
    lastTime = timestamp;
  }
}

canvas.addEventListener("pointerdown", handlePointerDown);
canvas.addEventListener("pointerup", handlePointerUp);
canvas.addEventListener("pointercancel", cancelSwipe);
canvas.addEventListener("pointerleave", (event) => {
  if (event.pointerId === swipePointerId) {
    cancelSwipe();
  }
});
touchButtons.forEach((btn) => {
  btn.addEventListener("pointerdown", handleTouchButton);
});
resetBtn.addEventListener("click", () => {
  resetGame();
});
pauseBtn.addEventListener("click", togglePause);
window.addEventListener("keydown", handleKeydown, { passive: false });

if (typeof window !== "undefined") {
  window.__neonSnake = {
    getState: () => ({
      ...state,
      snake: state.snake.map((segment) => ({ ...segment })),
      food: { ...state.food },
    }),
    forceReset: () => resetGame(),
    forceStart: () => startGame(),
    isOverlayHidden: () => statusPanel.classList.contains("hidden") || statusPanel.hidden === true,
  };
  window.__neonSnakeReady = true;
}

resetGame();
drawScene();
updatePauseLabel();
requestAnimationFrame(loop);
