const root = document.documentElement;
const smoothWrapper = document.getElementById("smooth-wrapper");
const smoothContent = document.getElementById("smooth-content");
const scrollSpacer = document.getElementById("scroll-spacer");
const starCanvas = document.getElementById("starfield");
const dustCanvas = document.getElementById("dustfield");
const mouseGlow = document.querySelector(".mouse-glow");
const parallaxLayers = [...document.querySelectorAll(".parallax-layer")];
const parallaxNodes = [...document.querySelectorAll("[data-depth]")];
const tiltNodes = [...document.querySelectorAll("[data-tilt]")];
const sections = [...document.querySelectorAll(".panel")];
const shootingStarContainer = document.getElementById("shooting-stars");
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const starContext = starCanvas.getContext("2d", { alpha: true });
const dustContext = dustCanvas.getContext("2d", { alpha: true });

const QUALITY_ORDER = ["ultra", "balanced", "lite"];
const QUALITY_PROFILES = {
  ultra: {
    maxDpr: 2,
    starDensity: 3000,
    minStars: 240,
    maxStars: 760,
    dustDensity: 46000,
    minDust: 12,
    maxDust: 24,
    starFrameInterval: 16,
    dustFrameInterval: 32,
    pointerScale: 1,
    tiltScale: 1,
    scrollLerp: 0.09,
    velocityLerp: 0.1,
    holeDrag: 178,
    enableDust: true,
    shootingStarDelay: [900, 1800],
  },
  balanced: {
    maxDpr: 1.65,
    starDensity: 4300,
    minStars: 190,
    maxStars: 520,
    dustDensity: 76000,
    minDust: 8,
    maxDust: 18,
    starFrameInterval: 24,
    dustFrameInterval: 48,
    pointerScale: 0.82,
    tiltScale: 0.82,
    scrollLerp: 0.1,
    velocityLerp: 0.11,
    holeDrag: 158,
    enableDust: true,
    shootingStarDelay: [1200, 2200],
  },
  lite: {
    maxDpr: 1.3,
    starDensity: 6200,
    minStars: 140,
    maxStars: 340,
    dustDensity: 120000,
    minDust: 0,
    maxDust: 10,
    starFrameInterval: 32,
    dustFrameInterval: 70,
    pointerScale: 0.58,
    tiltScale: 0.58,
    scrollLerp: 0.115,
    velocityLerp: 0.12,
    holeDrag: 132,
    enableDust: false,
    shootingStarDelay: [1700, 2800],
  },
};

const STAR_PALETTES = [
  {
    fill: "rgba(241, 249, 255, 1)",
    trail: "rgba(209, 232, 255, 0.72)",
    spriteKey: "neutral",
  },
  {
    fill: "rgba(162, 235, 255, 1)",
    trail: "rgba(114, 235, 255, 0.76)",
    spriteKey: "cyan",
  },
  {
    fill: "rgba(255, 213, 160, 1)",
    trail: "rgba(255, 191, 114, 0.72)",
    spriteKey: "amber",
  },
];

const state = {
  width: window.innerWidth,
  height: window.innerHeight,
  dpr: 1,
  quality: "balanced",
  profile: QUALITY_PROFILES.balanced,
  contentHeight: 0,
  targetScroll: 0,
  currentScroll: 0,
  visualScroll: 0,
  scrollVelocity: 0,
  pointerTargetX: 0,
  pointerTargetY: 0,
  pointerX: 0,
  pointerY: 0,
  lastTime: 0,
  lastStarSpawn: 0,
  starSpawnDelay: 1600,
  warpFactor: 0,
  holePull: 0,
  prevWarpFactor: -1,
  prevHolePull: -1,
  starFrameTime: 0,
  dustFrameTime: 0,
  perfTotal: 0,
  perfFrames: 0,
  lastPerfCheck: 0,
  qualityLockUntil: 0,
  activeSectionId: "hero",
  scrollEnergy: 0,
  prevScrollEnergy: -1,
  scrollPhase: 0,
  prevScrollPhase: -1,
};

const renderAssets = {
  built: false,
  starSprites: new Map(),
  dustSprites: new Map(),
};

let stars = [];
let dustParticles = [];
let sectionMetrics = [];
let resizeObserver = null;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

function detectInitialQuality() {
  const memory = navigator.deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 8;
  const compactViewport = window.matchMedia("(max-width: 860px)").matches;
  const touchCoarse = window.matchMedia("(pointer: coarse)").matches;

  if (compactViewport || touchCoarse || memory <= 4 || cores <= 4) {
    return "lite";
  }

  if (memory <= 8 || cores <= 8) {
    return "balanced";
  }

  return "ultra";
}

function shiftQuality(direction) {
  const currentIndex = QUALITY_ORDER.indexOf(state.quality);
  const nextIndex = clamp(currentIndex + direction, 0, QUALITY_ORDER.length - 1);
  return QUALITY_ORDER[nextIndex];
}

function randomShootingStarDelay() {
  const [minDelay, maxDelay] = state.profile.shootingStarDelay;
  return minDelay + Math.random() * (maxDelay - minDelay);
}

function createGlowSprite(size, stops) {
  const sprite = document.createElement("canvas");
  sprite.width = size;
  sprite.height = size;

  const context = sprite.getContext("2d");
  const radius = size * 0.5;
  const gradient = context.createRadialGradient(radius, radius, 0, radius, radius, radius);

  stops.forEach(([offset, color]) => gradient.addColorStop(offset, color));

  context.fillStyle = gradient;
  context.beginPath();
  context.arc(radius, radius, radius, 0, Math.PI * 2);
  context.fill();

  return sprite;
}

function buildRenderAssets() {
  if (renderAssets.built) {
    return;
  }

  renderAssets.starSprites.set(
    "neutral",
    createGlowSprite(48, [
      [0, "rgba(255, 255, 255, 0.95)"],
      [0.24, "rgba(228, 242, 255, 0.85)"],
      [0.6, "rgba(163, 207, 255, 0.22)"],
      [1, "rgba(163, 207, 255, 0)"],
    ])
  );
  renderAssets.starSprites.set(
    "cyan",
    createGlowSprite(48, [
      [0, "rgba(225, 255, 255, 0.95)"],
      [0.24, "rgba(143, 238, 255, 0.88)"],
      [0.62, "rgba(114, 235, 255, 0.24)"],
      [1, "rgba(114, 235, 255, 0)"],
    ])
  );
  renderAssets.starSprites.set(
    "amber",
    createGlowSprite(48, [
      [0, "rgba(255, 246, 224, 0.96)"],
      [0.24, "rgba(255, 216, 152, 0.84)"],
      [0.62, "rgba(255, 191, 114, 0.22)"],
      [1, "rgba(255, 191, 114, 0)"],
    ])
  );

  renderAssets.dustSprites.set(
    "cyan",
    createGlowSprite(128, [
      [0, "rgba(162, 240, 255, 0.18)"],
      [0.42, "rgba(114, 235, 255, 0.12)"],
      [1, "rgba(114, 235, 255, 0)"],
    ])
  );
  renderAssets.dustSprites.set(
    "amber",
    createGlowSprite(128, [
      [0, "rgba(255, 218, 178, 0.16)"],
      [0.42, "rgba(255, 191, 114, 0.12)"],
      [1, "rgba(255, 191, 114, 0)"],
    ])
  );

  renderAssets.built = true;
}

function applyQuality(level, options = {}) {
  const { rebuild = true } = options;

  if (!QUALITY_PROFILES[level]) {
    return;
  }

  state.quality = level;
  state.profile = QUALITY_PROFILES[level];
  root.dataset.quality = level;
  state.starSpawnDelay = randomShootingStarDelay();

  if (rebuild) {
    updateLayout();
  }
}

function setCanvasSize(canvas, context) {
  canvas.width = Math.round(state.width * state.dpr);
  canvas.height = Math.round(state.height * state.dpr);
  canvas.style.width = `${state.width}px`;
  canvas.style.height = `${state.height}px`;
  context.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
}

function measureContent() {
  const previousMetrics = new Map(sectionMetrics.map((metric) => [metric.element.id, metric]));

  state.contentHeight = Math.max(
    smoothContent.scrollHeight,
    smoothContent.getBoundingClientRect().height
  );
  scrollSpacer.style.height = `${state.contentHeight}px`;

  sectionMetrics = sections.map((section) => {
    const previous = previousMetrics.get(section.id);

    return {
      element: section,
      top: section.offsetTop,
      height: section.offsetHeight,
      progress: previous?.progress ?? -1,
      focus: previous?.focus ?? -1,
      active: previous?.active ?? section.classList.contains("is-active"),
    };
  });
}

function createStar(resetFromCenter = false) {
  const spreadX = state.width * (resetFromCenter ? 0.18 : 1.24);
  const spreadY = state.height * (resetFromCenter ? 0.18 : 1.24);
  const palette = STAR_PALETTES[(Math.random() * STAR_PALETTES.length) | 0];

  return {
    x: (Math.random() - 0.5) * spreadX,
    y: (Math.random() - 0.5) * spreadY,
    z: Math.random() * 0.95 + 0.16,
    size: Math.random() * 1.5 + 0.22,
    brightness: Math.random() * 0.68 + 0.32,
    fill: palette.fill,
    trail: palette.trail,
    spriteKey: palette.spriteKey,
  };
}

function createDustParticle() {
  return {
    x: Math.random() * state.width,
    y: Math.random() * state.height,
    radius: Math.random() * 44 + 16,
    speed: Math.random() * 0.16 + 0.03,
    alpha: Math.random() * 0.085 + 0.025,
    drift: Math.random() * 0.25 + 0.04,
    spriteKey: Math.random() > 0.42 ? "cyan" : "amber",
  };
}

function buildParticles() {
  const viewportArea = state.width * state.height;
  const starCount = clamp(
    Math.floor(viewportArea / state.profile.starDensity),
    state.profile.minStars,
    state.profile.maxStars
  );
  const dustCount = state.profile.enableDust
    ? clamp(
        Math.floor(viewportArea / state.profile.dustDensity),
        state.profile.minDust,
        state.profile.maxDust
      )
    : 0;

  stars = Array.from({ length: starCount }, () => createStar());
  dustParticles = Array.from({ length: dustCount }, () => createDustParticle());
}

function updateLayout() {
  state.width = window.innerWidth;
  state.height = window.innerHeight;
  state.dpr = Math.min(window.devicePixelRatio || 1, state.profile.maxDpr);

  setCanvasSize(starCanvas, starContext);
  setCanvasSize(dustCanvas, dustContext);
  measureContent();
  buildParticles();
}

function updatePointer(event) {
  const normalizedX = event.clientX / state.width - 0.5;
  const normalizedY = event.clientY / state.height - 0.5;

  state.pointerTargetX = normalizedX;
  state.pointerTargetY = normalizedY;
}

function resetPointer() {
  state.pointerTargetX = 0;
  state.pointerTargetY = 0;
}

function updateGlobalForces(scrollPosition) {
  const singularity = sectionMetrics.find(
    (metric) => metric.element.id === "singularity"
  );
  const warp = sectionMetrics.find((metric) => metric.element.id === "warp");

  if (singularity) {
    const singularityCenter =
      singularity.top + singularity.height * 0.5 - state.height * 0.5;
    const distance = Math.abs(scrollPosition - singularityCenter);
    const influenceRadius = singularity.height * 0.86;
    state.holePull = clamp(1 - distance / influenceRadius, 0, 1);
  } else {
    state.holePull = 0;
  }

  if (warp) {
    const warpStart = warp.top - state.height * 0.6;
    const warpDistance = state.height * 1.25;
    state.warpFactor = clamp((scrollPosition - warpStart) / warpDistance, 0, 1);
  } else {
    state.warpFactor = 0;
  }

  if (Math.abs(state.holePull - state.prevHolePull) > 0.003) {
    root.style.setProperty("--hole-pull", state.holePull.toFixed(3));
    state.prevHolePull = state.holePull;
  }

  if (Math.abs(state.warpFactor - state.prevWarpFactor) > 0.003) {
    root.style.setProperty("--warp-factor", state.warpFactor.toFixed(3));
    state.prevWarpFactor = state.warpFactor;
  }
}

function updateSections(scrollPosition) {
  const viewportCenter = scrollPosition + state.height * 0.5;
  let mostFocusedMetric = sectionMetrics[0] ?? null;
  let strongestFocus = -1;

  sectionMetrics.forEach((metric) => {
    const progress = clamp(
      (viewportCenter - (metric.top - state.height * 0.2)) /
        (metric.height + state.height * 0.4),
      0,
      1
    );
    const focus = clamp(
      1 -
        Math.abs(viewportCenter - (metric.top + metric.height * 0.5)) /
          (metric.height * 0.7 + state.height * 0.2),
      0,
      1
    );
    const isActive = focus > 0.22;

    if (Math.abs(progress - metric.progress) > 0.003) {
      metric.element.style.setProperty("--section-progress", progress.toFixed(3));
      metric.progress = progress;
    }

    if (Math.abs(focus - metric.focus) > 0.003) {
      metric.element.style.setProperty("--section-focus", focus.toFixed(3));
      metric.focus = focus;
    }

    if (isActive !== metric.active) {
      metric.active = isActive;
      metric.element.classList.toggle("is-active", isActive);
    }

    if (focus > strongestFocus) {
      strongestFocus = focus;
      mostFocusedMetric = metric;
    }
  });

  if (mostFocusedMetric && mostFocusedMetric.element.id !== state.activeSectionId) {
    state.activeSectionId = mostFocusedMetric.element.id;
    root.dataset.section = state.activeSectionId;
  }
}

function updateMotionVariables(deltaMs) {
  const targetEnergy = clamp(
    Math.abs(state.scrollVelocity) / 28 + state.warpFactor * 0.45 + state.holePull * 0.12,
    0,
    1
  );

  state.scrollEnergy = lerp(state.scrollEnergy, targetEnergy, 0.08);
  state.scrollPhase =
    (state.scrollPhase +
      deltaMs * (0.00005 + state.scrollEnergy * 0.00018 + state.warpFactor * 0.00032)) %
    1;

  if (Math.abs(state.scrollEnergy - state.prevScrollEnergy) > 0.004) {
    root.style.setProperty("--scroll-energy", state.scrollEnergy.toFixed(3));
    state.prevScrollEnergy = state.scrollEnergy;
  }

  if (
    state.prevScrollPhase < 0 ||
    Math.abs(state.scrollPhase - state.prevScrollPhase) > 0.003
  ) {
    root.style.setProperty("--scroll-phase", state.scrollPhase.toFixed(3));
    state.prevScrollPhase = state.scrollPhase;
  }
}

function updateLayers(scrollPosition) {
  const pointerStrength = state.profile.pointerScale;

  parallaxLayers.forEach((layer) => {
    const depth = parseFloat(layer.dataset.layerDepth || "0");
    const z = parseFloat(layer.dataset.layerZ || "0");
    const xOffset = state.pointerX * depth * 160 * pointerStrength;
    const yOffset =
      state.pointerY * depth * 120 * pointerStrength - scrollPosition * depth * 0.18;
    const scale = 1 + depth * 0.36 + state.warpFactor * 0.025;
    const nextTransform = `translate3d(${xOffset.toFixed(2)}px, ${yOffset.toFixed(2)}px, ${z}px) scale(${scale.toFixed(3)})`;

    if (layer._transform !== nextTransform) {
      layer.style.transform = nextTransform;
      layer._transform = nextTransform;
    }
  });
}

function updateParallaxNodes(scrollPosition) {
  const pointerStrength = state.profile.pointerScale;
  const tiltStrength = state.profile.tiltScale;

  parallaxNodes.forEach((node) => {
    const depth = parseFloat(node.dataset.depth || "0");
    const x = state.pointerX * depth * 110 * pointerStrength;
    const y = state.pointerY * depth * 70 * pointerStrength - scrollPosition * depth * 0.022;

    if (Math.abs((node._offsetX ?? Number.POSITIVE_INFINITY) - x) > 0.12) {
      node.style.setProperty("--offset-x", `${x.toFixed(2)}px`);
      node._offsetX = x;
    }

    if (Math.abs((node._offsetY ?? Number.POSITIVE_INFINITY) - y) > 0.12) {
      node.style.setProperty("--offset-y", `${y.toFixed(2)}px`);
      node._offsetY = y;
    }
  });

  tiltNodes.forEach((node) => {
    const rotateX = state.pointerY * -5.5 * tiltStrength;
    const rotateY = state.pointerX * 8 * tiltStrength;

    if (Math.abs((node._tiltX ?? Number.POSITIVE_INFINITY) - rotateX) > 0.08) {
      node.style.setProperty("--tilt-x", `${rotateX.toFixed(2)}deg`);
      node._tiltX = rotateX;
    }

    if (Math.abs((node._tiltY ?? Number.POSITIVE_INFINITY) - rotateY) > 0.08) {
      node.style.setProperty("--tilt-y", `${rotateY.toFixed(2)}deg`);
      node._tiltY = rotateY;
    }
  });
}

function drawStars(deltaRatio) {
  starContext.clearRect(0, 0, state.width, state.height);
  starContext.globalCompositeOperation = "screen";
  starContext.lineCap = "round";

  const centerX = state.width * 0.5;
  const centerY = state.height * 0.5;
  const velocityEnergy = clamp(Math.abs(state.scrollVelocity) * 0.018, 0, 0.024);
  const baseSpeed = 0.0025 + velocityEnergy + state.warpFactor * 0.014;

  for (const star of stars) {
    const previousX = centerX + (star.x / star.z) * 0.4 + state.pointerX * 36;
    const previousY = centerY + (star.y / star.z) * 0.4 + state.pointerY * 26;

    star.z -= baseSpeed * (0.7 + star.brightness) * deltaRatio;

    if (star.z <= 0.045) {
      Object.assign(star, createStar(true));
    }

    const projectionX = centerX + (star.x / star.z) * 0.4 + state.pointerX * 36;
    const projectionY = centerY + (star.y / star.z) * 0.4 + state.pointerY * 26;
    const radius = clamp((1 - star.z) * star.size * 1.45, 0.2, 3.2);
    const alpha = clamp((1.16 - star.z) * star.brightness, 0.12, 1);
    const trailWeight = state.warpFactor * 8 + velocityEnergy * 32 + radius * 0.65;

    if (trailWeight > 0.85) {
      starContext.globalAlpha = alpha * 0.74;
      starContext.strokeStyle = star.trail;
      starContext.lineWidth = clamp(radius * 0.85, 0.6, 2.4);
      starContext.beginPath();
      starContext.moveTo(previousX, previousY);
      starContext.lineTo(
        projectionX + (projectionX - previousX) * (1 + state.warpFactor * 7),
        projectionY + (projectionY - previousY) * (1 + state.warpFactor * 7)
      );
      starContext.stroke();
    }

    starContext.globalAlpha = alpha;

    if (radius < 0.82) {
      starContext.fillStyle = star.fill;
      starContext.fillRect(projectionX, projectionY, 1.4, 1.4);
    } else {
      const sprite = renderAssets.starSprites.get(star.spriteKey);
      const size = radius * 7.2;
      starContext.drawImage(sprite, projectionX - size * 0.5, projectionY - size * 0.5, size, size);
    }

    if (
      projectionX < -200 ||
      projectionX > state.width + 200 ||
      projectionY < -200 ||
      projectionY > state.height + 200
    ) {
      Object.assign(star, createStar(true));
    }
  }

  starContext.globalAlpha = 1;
}

function drawDust(deltaRatio) {
  dustContext.clearRect(0, 0, state.width, state.height);

  if (!state.profile.enableDust || dustParticles.length === 0) {
    return;
  }

  dustContext.globalCompositeOperation = "screen";

  for (const particle of dustParticles) {
    particle.y += particle.speed * deltaRatio + Math.abs(state.scrollVelocity) * 0.014;
    particle.x += state.pointerX * particle.drift * 18;

    if (particle.y - particle.radius > state.height) {
      particle.y = -particle.radius;
      particle.x = Math.random() * state.width;
    }

    if (particle.x < -particle.radius) {
      particle.x = state.width + particle.radius;
    }

    if (particle.x > state.width + particle.radius) {
      particle.x = -particle.radius;
    }

    const sprite = renderAssets.dustSprites.get(particle.spriteKey);
    const size = particle.radius * (2.3 + state.warpFactor * 0.4);

    dustContext.globalAlpha = particle.alpha * (0.8 + state.holePull * 0.85);
    dustContext.drawImage(sprite, particle.x - size * 0.5, particle.y - size * 0.5, size, size);
  }

  dustContext.globalAlpha = 1;
}

function animateNebula(time) {
  if ((state._lastNebulaTick ?? 0) + 48 > time) {
    return;
  }

  state._lastNebulaTick = time;

  const hueA = Math.sin(time * 0.00013) * 34;
  const hueB = Math.cos(time * 0.00016) * 42;

  root.style.setProperty("--nebula-hue-a", `${hueA.toFixed(2)}deg`);
  root.style.setProperty("--nebula-hue-b", `${hueB.toFixed(2)}deg`);
}

function spawnShootingStar(time) {
  const travelMetric = sectionMetrics.find((metric) => metric.element.id === "travel");

  if (!travelMetric || !shootingStarContainer) {
    return;
  }

  const isActive =
    state.visualScroll + state.height > travelMetric.top &&
    state.visualScroll < travelMetric.top + travelMetric.height;

  if (!isActive || time - state.lastStarSpawn < state.starSpawnDelay) {
    return;
  }

  state.lastStarSpawn = time;
  state.starSpawnDelay = randomShootingStarDelay();

  const star = document.createElement("span");
  star.className = "shooting-star";
  star.style.left = `${Math.random() * 70 + 5}%`;
  star.style.top = `${Math.random() * 40 + 8}%`;
  star.style.setProperty("--duration", `${900 + Math.random() * 1200}ms`);

  shootingStarContainer.appendChild(star);
  star.addEventListener("animationend", () => star.remove(), { once: true });
}

function evaluatePerformance(deltaMs, time) {
  state.perfTotal += deltaMs;
  state.perfFrames += 1;

  if (time - state.lastPerfCheck < 1800) {
    return;
  }

  const averageFrameMs = state.perfTotal / Math.max(state.perfFrames, 1);

  state.perfTotal = 0;
  state.perfFrames = 0;
  state.lastPerfCheck = time;

  if (time < state.qualityLockUntil) {
    return;
  }

  if (averageFrameMs > 21 && state.quality !== "lite") {
    applyQuality(shiftQuality(1));
    state.qualityLockUntil = time + 3200;
    return;
  }

  if (averageFrameMs < 14 && state.quality !== "ultra") {
    applyQuality(shiftQuality(-1));
    state.qualityLockUntil = time + 4200;
  }
}

function animate(time) {
  if (prefersReducedMotion.matches) {
    return;
  }

  if (document.hidden) {
    state.lastTime = time;
    requestAnimationFrame(animate);
    return;
  }

  if (!state.lastTime) {
    state.lastTime = time;
  }

  const deltaMs = Math.min(time - state.lastTime, 48);
  const deltaRatio = deltaMs / 16.6667;
  state.lastTime = time;

  state.targetScroll = window.scrollY;
  state.currentScroll = lerp(
    state.currentScroll,
    state.targetScroll,
    state.profile.scrollLerp
  );
  state.pointerX = lerp(state.pointerX, state.pointerTargetX, 0.08);
  state.pointerY = lerp(state.pointerY, state.pointerTargetY, 0.08);
  state.scrollVelocity = lerp(
    state.scrollVelocity,
    state.targetScroll - state.currentScroll,
    state.profile.velocityLerp
  );

  updateGlobalForces(state.currentScroll);

  state.visualScroll = state.currentScroll - state.holePull * state.profile.holeDrag;

  const contentTransform = `translate3d(0, ${-state.visualScroll.toFixed(2)}px, 0)`;
  if (smoothContent._transform !== contentTransform) {
    smoothContent.style.transform = contentTransform;
    smoothContent._transform = contentTransform;
  }

  const glowX = state.width * 0.5 + state.pointerX * state.width * 0.58;
  const glowY = state.height * 0.5 + state.pointerY * state.height * 0.58;
  const glowTransform = `translate3d(${glowX.toFixed(2)}px, ${glowY.toFixed(2)}px, 0)`;
  if (mouseGlow && mouseGlow._transform !== glowTransform) {
    mouseGlow.style.transform = glowTransform;
    mouseGlow._transform = glowTransform;
  }

  updateSections(state.visualScroll);
  updateMotionVariables(deltaMs);
  updateLayers(state.visualScroll);
  updateParallaxNodes(state.visualScroll);
  animateNebula(time);

  state.starFrameTime += deltaMs;
  state.dustFrameTime += deltaMs;

  if (
    state.starFrameTime >= state.profile.starFrameInterval ||
    Math.abs(state.scrollVelocity) > 1.2 ||
    state.warpFactor > 0.08
  ) {
    drawStars(state.starFrameTime / 16.6667);
    state.starFrameTime = 0;
  }

  if (
    state.profile.enableDust &&
    (state.dustFrameTime >= state.profile.dustFrameInterval || state.holePull > 0.2)
  ) {
    drawDust(state.dustFrameTime / 16.6667);
    state.dustFrameTime = 0;
  } else if (!state.profile.enableDust) {
    dustContext.clearRect(0, 0, state.width, state.height);
  }

  spawnShootingStar(time);
  evaluatePerformance(deltaMs, time);

  requestAnimationFrame(animate);
}

function enableReducedMotionFallback() {
  smoothWrapper.style.position = "relative";
  smoothContent.style.position = "relative";
  smoothContent.style.transform = "none";
  scrollSpacer.style.display = "none";
}

function initializeObservers() {
  if (!("ResizeObserver" in window)) {
    return;
  }

  resizeObserver = new ResizeObserver(() => {
    measureContent();
  });
  resizeObserver.observe(smoothContent);
}

function initialize() {
  buildRenderAssets();
  applyQuality(detectInitialQuality(), { rebuild: false });
  root.dataset.section = state.activeSectionId;
  updateLayout();
  updateGlobalForces(0);
  updateSections(0);
  updateMotionVariables(16.6667);

  if (prefersReducedMotion.matches) {
    enableReducedMotionFallback();
    return;
  }

  initializeObservers();
  requestAnimationFrame(animate);
}

window.addEventListener("resize", updateLayout, { passive: true });
window.addEventListener("orientationchange", updateLayout, { passive: true });
window.addEventListener("pointermove", updatePointer, { passive: true });
window.addEventListener("pointerleave", resetPointer, { passive: true });
window.addEventListener("blur", resetPointer, { passive: true });
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    state.lastTime = 0;
  }
});

const handleMotionPreferenceChange = () => {
  window.location.reload();
};

if (prefersReducedMotion.addEventListener) {
  prefersReducedMotion.addEventListener("change", handleMotionPreferenceChange);
} else if (prefersReducedMotion.addListener) {
  prefersReducedMotion.addListener(handleMotionPreferenceChange);
}

document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
  anchor.addEventListener("click", (event) => {
    const targetId = anchor.getAttribute("href");
    const target = targetId ? document.querySelector(targetId) : null;

    if (!target) {
      return;
    }

    event.preventDefault();

    window.scrollTo({
      top: target.offsetTop,
      behavior: "smooth",
    });
  });
});

initialize();

if (document.fonts?.ready) {
  document.fonts.ready.then(updateLayout);
}
