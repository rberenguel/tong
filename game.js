window.addEventListener("load", async () => {
  // --- Global Variables ---
  let app,
    player1,
    player2,
    ball,
    net,
    floor,
    trail,
    contactLine,
    serveTrajectoryLine;
  let state = {};
  let trailPoints = [];
  let particles = [];
  let touchState = {};
  let AI_DIFFICULTY = "medium";
  let gameStarted = false;

  // --- Base Constants (Reference values for scaling) ---
  const BASE_CONSTANTS = {
    PADDLE_WIDTH: 6,
    PADDLE_HEIGHT: 40,
    BALL_RADIUS: 5,
    NET_WIDTH: 4,
    NET_HEIGHT: 50,
    GRAVITY: 0.5,
    MAX_SHOT_POWER: 30,
    SHOT_CHARGE_RATE: 0.4,
    SWING_DISTANCE: 70,
    SWING_DURATION: 6,
    HIT_POWER: 10,
    SERVE_VX: 8,
    SERVE_VY: 3,
    AI_BEGINNER_SHOT_SPEED: 15,
    AI_MEDIUM_SHOT_SPEED: 18,
    AI_EXPERT_SHOT_SPEED: 23,
    NET_BOUNCE_Y_ADD: 10,
    NET_BOUNCE_VY_ADD: 3,
    POWER_SHOT_THRESHOLD: 20,
    PARTICLE_VX: 4,
    PARTICLE_VY: 4,
    PARTICLE_SIZE_MIN: 2,
    PARTICLE_SIZE_MAX: 3,
    PARTICLE_LIFE: 20,
    PADDLE_MARGIN: 50,
    PADDLE_CONTROL_Y_DIV: 150,
    AI_CENTER_MARGIN: 50,
    PADDLE_Y_MARGIN: 10,
    AI_PADDLE_MIN_X_MARGIN: 50,
    AI_NET_CLEARANCE_VY: 0.75,
  };

  // --- Dynamic Scaled Constants (Recalculated on resize) ---
  let SCALED_CONSTANTS = {};

  // --- Static Constants ---
  const GAME_SPEED_MODIFIER = 1.0;
  const TOPSPIN_GRAVITY_MULT = 1.8;
  const SLICE_GRAVITY_MULT = 0.55;
  const COURT_Y_FACTOR = 0.75;
  const MAX_PADDLE_ANGLE = Math.PI / 6;
  const PADDLE_SPEED = 0.35; // Interpolation factor for Y movement
  const AI_PADDLE_SPEED_X = 0.08; // Interpolation factor for AI X movement (rally)
  const AI_SERVE_PADDLE_SPEED_X = 0.35; // Faster interpolation for AI serve positioning

  const PLAYER_COLOR_HEX = "#00FFFF";
  const AI_COLOR_HEX = "#FFA500";

  // --- DOM Elements ---
  const scoreElement = document.getElementById("score");
  const setsElement = document.getElementById("sets");
  const messageElement = document.getElementById("message");
  const shotIndicator = document.getElementById("shot-indicator");
  const introScreen = document.getElementById("intro-screen");
  const gameOverScreen = document.getElementById("game-over-screen");
  const difficultyBtns = document.querySelectorAll(
    ".difficulty-btn[data-difficulty]",
  );
  const startGameBtn = document.getElementById("start-game-btn");

  // --- Initialization ---

  function initializeGameState() {
    state = {
      ballInPlay: false,
      shotCharging: false,
      shotPower: 0,
      bounces: 0,
      lastPaddleHitSide: null,
      lastBounceSide: null,
      servingPlayer: "player1",
      scores: { player1: { points: 0 }, player2: { points: 0 } },
      gameOver: false,
      ballSpin: 0,
      lastShotType: undefined,
      mustBounceBeforeHit: false,
      hasBouncedOnCurrentSide: false,
      aiWillMissThisShot: undefined,
      aiCanHit: true,
      aiTargetX: null, // Renamed from aiServeTargetX for clarity
    };
    touchState = {
      isCharging: false,
      isMovingPaddle: false,
      startX: 0,
      startY: 0,
      startPaddleX: 0,
    };
    particles = [];
    trailPoints = [];
    gameStarted = false;
  }

  async function initializePixiApp() {
    app = new PIXI.Application();
    await app.init({
      background: 0x000000,
      resizeTo: window,
      antialias: true,
    });
    document.body.appendChild(app.canvas);
  }

  function setupScene() {
    floor = new PIXI.Graphics();
    net = new PIXI.Graphics();
    trail = new PIXI.Graphics();
    contactLine = new PIXI.Graphics();
    serveTrajectoryLine = new PIXI.Graphics();
    ball = new PIXI.Graphics();
    ball.vx = 0;
    ball.vy = 0;
    ball.prevX = 0;
    ball.prevY = 0;

    // Paddles created in resizeAndPosition after constants are set
    player1 = null;
    player2 = null;

    app.stage.addChild(
      floor,
      net,
      trail,
      contactLine,
      ball,
      serveTrajectoryLine,
    );
  }

  function setupUIListeners() {
    difficultyBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        difficultyBtns.forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
        AI_DIFFICULTY = btn.dataset.difficulty;
      });
    });

    startGameBtn.addEventListener("click", () => {
      introScreen.style.display = "none";
      gameStarted = true;
      resetRound();
    });
  }

  // --- Scaling and Positioning ---

  function calculateScaleFactor(screenW, screenH) {
    const baseHeight = 600;
    const heightFactor = screenH / baseHeight;
    const aspectRatio = screenW / screenH;
    let scaleFactor = heightFactor;

    if (aspectRatio > 1.7) {
      // Landscape phone/tablet
      scaleFactor = Math.min(1.0, Math.max(0.15, heightFactor * 0.8));
    } else if (aspectRatio < 1) {
      // Portrait mode
      scaleFactor = Math.min(1.0, heightFactor * 1.2);
    } else {
      // Standard desktop
      scaleFactor = Math.min(1.2, heightFactor);
    }
    return Math.max(0.2, scaleFactor); // Ensure minimum size
  }

  function updateScaledConstants() {
    const scaleFactor = calculateScaleFactor(
      app.screen.width,
      app.screen.height,
    );
    for (const key in BASE_CONSTANTS) {
      // Don't scale time-based values
      if (key !== "SWING_DURATION") {
        SCALED_CONSTANTS[key] = BASE_CONSTANTS[key] * scaleFactor;
      } else {
        SCALED_CONSTANTS[key] = BASE_CONSTANTS[key];
      }
    }
    // Alias frequently used scaled constants for readability
    window.C = SCALED_CONSTANTS;
  }

  function resizeAndPosition() {
    updateScaledConstants(); // Recalculate scaled values

    const screenW = app.screen.width,
      screenH = app.screen.height;
    const courtY = screenH * COURT_Y_FACTOR;

    floor
      .clear()
      .rect(
        0,
        courtY,
        screenW,
        3 * (C.BALL_RADIUS / BASE_CONSTANTS.BALL_RADIUS),
      )
      .fill(0x888888);
    net
      .clear()
      .rect(
        screenW / 2 - C.NET_WIDTH / 2,
        courtY - C.NET_HEIGHT,
        C.NET_WIDTH,
        C.NET_HEIGHT,
      )
      .fill(0xff00ff);

    if (!player1) {
      player1 = createPaddle(PLAYER_COLOR_HEX);
      app.stage.addChild(player1);
    }
    if (!player2) {
      player2 = createPaddle(AI_COLOR_HEX);
      app.stage.addChild(player2);
    }

    redrawPaddle(player1);
    redrawPaddle(player2);
    ball.clear().circle(0, 0, C.BALL_RADIUS).fill(0xffff00);

    player1.baseX = screenW * 0.2;
    player2.baseX = screenW * 0.8;
    const paddleY = courtY - C.NET_HEIGHT / 2;
    player1.targetY = paddleY;
    player2.targetY = paddleY;
    player1.y = player1.targetY;
    player2.y = player2.targetY;
    player1.x = player1.baseX;
    player2.x = player2.baseX;
  }

  // --- Paddle Creation and Drawing ---

  function createPaddle(color) {
    const p = new PIXI.Graphics();
    redrawPaddle(p, color); // Initial draw
    p.swing = { active: false, progress: 0 };
    p.targetY = 0;
    p.paddleColor = color;
    p.baseX = 0;
    return p;
  }

  function redrawPaddle(p, color = p.paddleColor) {
    p.clear()
      .rect(
        -C.PADDLE_WIDTH / 2,
        -C.PADDLE_HEIGHT / 2,
        C.PADDLE_WIDTH,
        C.PADDLE_HEIGHT,
      )
      .fill(color);
    p.paddleColor = color; // Ensure color is stored
  }

  // --- Controls and Event Handling ---

  function addControls() {
    app.stage.eventMode = "static";
    app.stage.hitArea = app.screen;
    app.canvas.style.touchAction = "none";

    app.stage.on("pointerdown", handlePointerDown);
    app.stage.on("pointerup", handlePointerUp);
    app.stage.on("pointerupoutside", handlePointerUp);
    app.stage.on("pointermove", handlePointerMove);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
  }

  function handlePointerDown(e) {
    if (state.gameOver || !gameStarted) return;
    const screenW = app.screen.width;
    const x = e.global.x;

    if (e.pointerType === "mouse") {
      if (state.ballInPlay && !player1.swing.active && !state.shotCharging) {
        startShotCharge();
      }
    } else {
      // Touch
      if (x < screenW / 2) {
        // Left side: Move paddle
        if (!state.shotCharging && !player1.swing.active) {
          touchState.isMovingPaddle = true;
          touchState.startX = x;
          touchState.startY = e.global.y;
          touchState.startPaddleX = player1.baseX;
        }
      } else {
        // Right side: Charge shot
        if (
          state.ballInPlay &&
          !player1.swing.active &&
          !touchState.isCharging
        ) {
          touchState.isCharging = true;
          startShotCharge();
        }
      }
    }
  }

  function handlePointerUp() {
    if (state.shotCharging) releaseShot();
    touchState.isCharging = false;
    touchState.isMovingPaddle = false;
  }

  function handlePointerMove(e) {
    if (touchState.isMovingPaddle) {
      // Touch paddle movement
      const deltaX = e.global.x - touchState.startX;
      const deltaY = e.global.y - touchState.startY;
      updatePaddleControl(deltaX, deltaY, "relative");
    } else if (e.pointerType === "mouse") {
      // Mouse movement
      updatePaddleControl(e.global.x, e.global.y, "absolute");
    }
  }

  function handleKeyDown(e) {
    if (
      e.code === "Space" &&
      !state.shotCharging &&
      state.ballInPlay &&
      !state.gameOver
    ) {
      e.preventDefault();
      startShotCharge();
    }
  }

  function handleKeyUp(e) {
    if (e.code === "Space" && state.shotCharging) {
      e.preventDefault();
      releaseShot();
    }
  }

  function updatePaddleControl(x, y, mode = "absolute") {
    const screenW = app.screen.width,
      screenH = app.screen.height;
    const courtY = screenH * COURT_Y_FACTOR;

    if (mode === "relative") {
      const newBaseX = touchState.startPaddleX + x;
      player1.baseX = Math.max(
        C.PADDLE_WIDTH * 2,
        Math.min(screenW / 2 - C.PADDLE_MARGIN, newBaseX),
      );
      const normalizedY = Math.max(-1, Math.min(1, y / C.PADDLE_CONTROL_Y_DIV));
      player1.rotation = normalizedY * MAX_PADDLE_ANGLE;
    } else {
      // Absolute (Mouse)
      player1.baseX = Math.max(
        C.PADDLE_WIDTH * 2,
        Math.min(screenW / 2 - C.PADDLE_MARGIN, x),
      );
      const minY = courtY - C.PADDLE_HEIGHT * 3;
      const maxY = courtY - C.PADDLE_HEIGHT * 0.5;
      const clampedY = Math.max(minY, Math.min(maxY, y));
      const centerY = (minY + maxY) / 2;
      const normalizedY = (clampedY - centerY) / ((maxY - minY) / 2);
      player1.rotation = normalizedY * MAX_PADDLE_ANGLE;
    }
    updateShotIndicator();
  }

  function updateShotIndicator() {
    const angleDeg = (player1.rotation * 180) / Math.PI;
    let shotType = "FLAT";
    if (angleDeg < -10) shotType = "SLICE ↓";
    else if (angleDeg > 10) shotType = "TOPSPIN ↑";
    shotIndicator.innerHTML = `${shotType} (${angleDeg.toFixed(0)}°)`;
    shotIndicator.style.color =
      angleDeg < -15 ? "#ff00ff" : angleDeg > 15 ? "#ff6600" : PLAYER_COLOR_HEX;
  }

  function startShotCharge() {
    if (!player1.swing.active) {
      state.shotCharging = true;
      state.shotPower = 0;
    }
  }

  function releaseShot() {
    if (state.shotCharging) {
      state.shotCharging = false;
      player1.swing.active = true;
      player1.swing.progress = 0;
      player1.scale.set(1, 1);
      redrawPaddle(player1);
    }
  }

  // --- Game Update Logic ---

  function gameLoop(ticker) {
    if (state.gameOver || !gameStarted) return;
    const delta = ticker.deltaTime || 1;
    const gameDelta = delta * GAME_SPEED_MODIFIER;
    const timeScale = state.shotCharging ? 0.4 : 1.0;
    const ballDelta = gameDelta * timeScale;

    if (state.shotCharging) {
      state.shotPower = Math.min(
        C.MAX_SHOT_POWER,
        state.shotPower + C.SHOT_CHARGE_RATE * delta,
      );
    }

    updatePlayerPaddle(gameDelta); // Handles player Y movement + swing charge visuals
    updatePlayerSwing(delta); // Handles player swing animation and hit detection
    updateAI(ballDelta); // Handles AI movement and hitting
    updateBall(ballDelta); // Handles ball physics and collision
    updateTrail();
    updateParticles(ballDelta);
  }

  function updatePlayerPaddle(delta) {
    const courtY = app.screen.height * COURT_Y_FACTOR;
    const minY = C.PADDLE_HEIGHT / 2 + C.PADDLE_Y_MARGIN;
    const maxY = courtY - C.PADDLE_HEIGHT / 2 - C.PADDLE_Y_MARGIN;

    // Target Y based on ball position (or default)
    if (
      state.ballInPlay &&
      ball.x < app.screen.width / 2 &&
      ball.y > minY &&
      ball.y < maxY
    ) {
      player1.targetY = ball.y;
    } else {
      player1.targetY = courtY - C.NET_HEIGHT / 2; // Default position
    }

    // Smooth Y movement
    const interp = 1 - Math.pow(1 - PADDLE_SPEED, delta);
    player1.y += (player1.targetY - player1.y) * interp;

    // Visuals during charge (moved from updatePlayerSwing)
    contactLine.clear();
    if (state.shotCharging) {
      const chargeRatio = Math.min(1, state.shotPower / C.MAX_SHOT_POWER);
      player1.x = player1.baseX - chargeRatio * C.SWING_DISTANCE; // Move back
      player1.scale.set(1 - chargeRatio * 0.4, 1 + chargeRatio * 0.2); // Squash/stretch
      redrawPaddle(player1); // Redraw with scaling

      // Charge effects
      if (chargeRatio > 0.3) {
        const glowSize = 3 + chargeRatio * 8;
        player1
          .rect(
            -C.PADDLE_WIDTH / 2 - glowSize,
            -C.PADDLE_HEIGHT / 2 - glowSize,
            C.PADDLE_WIDTH + glowSize * 2,
            C.PADDLE_HEIGHT + glowSize * 2,
          )
          .stroke({ width: 3, color: 0xffffff, alpha: chargeRatio });
      }
      if (chargeRatio > 0.9) {
        const pulse = Math.sin(Date.now() / 50) * 0.5 + 0.5;
        player1
          .circle(0, 0, C.PADDLE_HEIGHT / 2 + 10)
          .stroke({ width: 2, color: 0xff0000, alpha: pulse * 0.8 });
      }

      // Contact line visualization
      const lineLength = C.PADDLE_HEIGHT * 1.25;
      contactLine
        .rect(-1, -lineLength / 2, 2, lineLength)
        .fill({ color: PLAYER_COLOR_HEX, alpha: chargeRatio * 0.8 });
      contactLine.x = player1.baseX + (C.SWING_DISTANCE * 1.5) / 2; // Position ahead
      contactLine.y = player1.y;
      contactLine.rotation = player1.rotation;
    } else if (!player1.swing.active) {
      // Ensure paddle is at base position if not charging or swinging
      player1.x = player1.baseX;
      if (player1.scale.x !== 1 || player1.scale.y !== 1) {
        player1.scale.set(1, 1);
        redrawPaddle(player1);
      }
    }
  }

  function updatePlayerSwing(delta) {
    if (!player1.swing.active) return;

    player1.swing.progress += delta;
    const swingRatio = Math.min(1, player1.swing.progress / C.SWING_DURATION);
    const swingArc = Math.sin(swingRatio * Math.PI); // Creates the forward motion arc
    player1.x = player1.baseX + swingArc * C.SWING_DISTANCE * 1.5; // Apply forward swing motion

    // Hit detection
    const hitboxWidth = C.PADDLE_WIDTH * 3;
    const hitboxHeight = C.PADDLE_HEIGHT * 1.5;
    const canHit =
      getBallSide() === "player1" &&
      (!state.mustBounceBeforeHit || state.hasBouncedOnCurrentSide);

    if (
      canHit &&
      circleRectCollision(
        ball.x,
        ball.y,
        C.BALL_RADIUS,
        player1.x,
        player1.y,
        hitboxWidth,
        hitboxHeight,
        player1.rotation,
      )
    ) {
      hitBall(swingRatio); // Pass timing factor
      player1.swing.active = false;
      player1.x = player1.baseX; // Reset position immediately after hit
      return; // Exit early if hit occurs
    }

    // End swing if duration exceeded
    if (player1.swing.progress >= C.SWING_DURATION) {
      player1.swing.active = false;
      player1.x = player1.baseX; // Reset position
      state.shotPower = 0; // Reset power if swing missed
    }
  }

  function hitBall(timingFactor) {
    const basePower = C.HIT_POWER + state.shotPower * 0.8;
    const timingBonus = 1 - Math.abs(0.5 - timingFactor) * 2; // 1 = perfect, 0 = edge
    const isPerfectTiming = timingBonus > 0.8;
    let power = basePower * (1 + timingBonus * 0.5); // Apply timing bonus

    // Determine shot type and spin based on paddle angle
    const angleDeg = (player1.rotation * 180) / Math.PI;
    let shotType = "flat";
    let spinValue = 0;
    if (angleDeg < -10) {
      shotType = "slice";
      spinValue = -1;
    } else if (angleDeg > 10) {
      shotType = "topspin";
      spinValue = 1;
    }

    if (shotType === "slice") power *= 0.75; // Slices are less powerful

    state.ballSpin = spinValue;
    state.lastShotType = shotType;

    // Calculate ball velocity based on power and angle
    ball.vx = Math.cos(player1.rotation) * power * GAME_SPEED_MODIFIER;
    if (shotType === "slice") {
      ball.vy = -Math.sin(Math.abs(player1.rotation)) * power * 0.3; // Lower angle for slice
    } else {
      ball.vy = -Math.sin(player1.rotation) * power * 0.55; // Normal/topspin angle
    }

    // Power shot effect
    if (isPerfectTiming && state.shotPower > C.POWER_SHOT_THRESHOLD) {
      createFireEffect(ball.x, ball.y);
      ball.vx *= 1.3;
      ball.vy *= 1.1; // Add slight vertical boost too
      showMessage("POWER SHOT! 🔥", false);
    }

    // Update game state after hit
    state.bounces = 0;
    state.lastPaddleHitSide = "player1";
    state.lastBounceSide = null;
    state.mustBounceBeforeHit = true;
    state.hasBouncedOnCurrentSide = false;
    state.shotPower = 0; // Reset player shot power
    state.aiCanHit = true; // Allow AI to hit next
    state.aiWillMissThisShot = undefined; // Reset AI miss chance
  }
  function updateAI(delta) {
    const p2 = player2;
    const screenW = app.screen.width,
      screenH = app.screen.height;
    const courtY = screenH * COURT_Y_FACTOR;
    const ballSide = getBallSide();
    const isAiTurn = state.ballInPlay && ballSide === "player2";
    const isAiExecutingServe =
      !state.lastPaddleHitSide && ballSide === "player2"; // True only during AI serve toss & hit sequence
    const isAiReturningServe =
      state.lastPaddleHitSide === "player1" &&
      !state.hasBouncedOnCurrentSide &&
      ballSide === "player2"; // True when player serves to AI

    // --- Define Serve Position ---
    const serveContactHeight = courtY - C.NET_HEIGHT * 1.3;
    // *** Explicitly define the X position AI should be at during serve ***
    const serveWaitX = screenW / 2 + C.PADDLE_WIDTH * 3.0; // Fixed X target for serve hit

    // --- AI Paddle Movement ---
    // --- Normal Movement Logic for Rally/Return ---
    let targetX_AI = screenW * 0.8; // Default X
    let targetY_AI = courtY - C.NET_HEIGHT / 2; // Default Y
    const minY_AI = C.PADDLE_HEIGHT / 2 + C.PADDLE_Y_MARGIN;
    const maxY_AI = courtY - C.PADDLE_HEIGHT / 2 - C.PADDLE_Y_MARGIN;
    let current_ai_x_speed = AI_PADDLE_SPEED_X; // Default rally speed

    // --- CHANGE 1: Define a flat intercept height ---
    const interceptY_AI = courtY - C.NET_HEIGHT * 1.1; // AI waits here, doesn't follow ball to floor

    if (isAiReturningServe && state.aiTargetX !== null) {
      targetX_AI = state.aiTargetX;
      targetY_AI = serveContactHeight;
      current_ai_x_speed = AI_SERVE_PADDLE_SPEED_X;
    } else if (isAiTurn) {
      // Rally movement (and now, Serve movement)
      const minX_AI = screenW / 2 + C.AI_PADDLE_MIN_X_MARGIN;
      const maxX_AI = screenW - C.PADDLE_WIDTH * 2;
      targetX_AI = Math.max(minX_AI, Math.min(maxX_AI, ball.x));

      // --- CHANGE 1 (Continued): Use the intercept height ---
      if (ball.y > minY_AI && ball.y < maxY_AI) {
        // Don't follow the ball lower than the intercept height
        targetY_AI = Math.min(ball.y, interceptY_AI);
      } else {
        targetY_AI = courtY - C.NET_HEIGHT / 2; // Default
      }
      current_ai_x_speed = AI_PADDLE_SPEED_X;
    }
    // else: Ball on player side, target remains default

    // Interpolate towards target for rally/return
    const ai_x_interp = 1 - Math.pow(1 - current_ai_x_speed, delta);
    const ai_y_interp = 1 - Math.pow(1 - PADDLE_SPEED, delta);
    p2.baseX += (targetX_AI - p2.baseX) * ai_x_interp;
    p2.targetY = targetY_AI;
    p2.y += (p2.targetY - p2.y) * ai_y_interp;
    p2.x = p2.baseX; // Visual X follows base X
    // --- End AI Paddle Movement ---

    // --- AI Hitting Logic ---
    if (!isAiTurn) {
      p2.rotation *= 0.85; // Reset angle slowly if not AI's turn
      return;
    }

    let missChance = 0,
      baseShotSpeed = 0,
      velocityError = 0,
      targetAccuracy = 0,
      targetSpread = 0;
    // Difficulty settings (same as before)
    switch (AI_DIFFICULTY /* ... */) {
      case "beginner":
        missChance = 0.25;
        baseShotSpeed = C.AI_BEGINNER_SHOT_SPEED;
        velocityError = 0.3;
        targetAccuracy = 0.4;
        targetSpread = 0.2;
        break;
      case "medium":
        missChance = 0.1;
        baseShotSpeed = C.AI_MEDIUM_SHOT_SPEED;
        velocityError = 0.15;
        targetAccuracy = 0.6;
        targetSpread = 0.3;
        break;
      case "expert":
        missChance = 0.03;
        baseShotSpeed = C.AI_EXPERT_SHOT_SPEED;
        velocityError = 0.08;
        targetAccuracy = 0.85;
        targetSpread = 0.4;
        break;
    }
    if (isAiExecutingServe) {
      missChance = 0;
      velocityError = 0.01;
    }

    // Miss chance (same as before)
    if (
      state.aiWillMissThisShot === undefined &&
      !isAiExecutingServe &&
      state.mustBounceBeforeHit &&
      !state.hasBouncedOnCurrentSide
    ) {
      /* ... */
      const powerFactor = state.shotPower / C.MAX_SHOT_POWER;
      const isPlayerPowerShot = powerFactor > 0.7;
      const effectiveMissChance = missChance * (isPlayerPowerShot ? 1.5 : 1.0);
      state.aiWillMissThisShot = Math.random() < effectiveMissChance;
    }
    if (state.aiWillMissThisShot === true) return;

    // Hit conditions
    const hitboxWidth = C.PADDLE_WIDTH * 4; // *** WIDER hitbox for serve debugging ***
    const hitboxHeight = C.PADDLE_HEIGHT * 1.8; // *** TALLER hitbox for serve debugging ***
    const canHit =
      state.aiCanHit &&
      (isAiExecutingServe ||
        !state.mustBounceBeforeHit ||
        state.hasBouncedOnCurrentSide);

    // *** EXTREMELY SIMPLE SERVE HIT CONDITION ***
    // Just check if it's the serve phase and the collision happens
    const isInServeWindow = isAiExecutingServe;

    // (This is the line from the previous fix - it's correct)
    const isInRallyWindow =
      !isAiExecutingServe && state.hasBouncedOnCurrentSide;

    // Use basic collision check as primary trigger if window conditions are met
    const isInHittingZone = circleRectCollision(
      ball.x,
      ball.y,
      C.BALL_RADIUS,
      p2.x,
      p2.y,
      hitboxWidth,
      hitboxHeight,
      p2.rotation,
    );
    const isPaddleInPositionForServeReturn =
      !isAiReturningServe ||
      state.aiTargetX === null ||
      Math.abs(p2.x - state.aiTargetX) < C.PADDLE_WIDTH * 1.5;

    if (
      canHit &&
      isInHittingZone && // Basic collision MUST occur
      isPaddleInPositionForServeReturn && // Still relevant for returns
      (isInServeWindow || isInRallyWindow) // Check phase
    ) {
      let vx, vy, targetX;

      if (isAiExecutingServe) {
        // AI Serve Execution (same logic as before)
        state.ballSpin = -1;
        targetX = screenW * (0.2 + Math.random() * 0.1);
        const targetY = courtY - C.BALL_RADIUS;
        const serveSpeed =
          baseShotSpeed * 0.95 * (1 + (Math.random() - 0.5) * velocityError);
        const { calcVx, calcVy } = calculateShotVelocity(
          ball.x,
          ball.y,
          targetX,
          targetY,
          serveSpeed,
          SLICE_GRAVITY_MULT,
          C.AI_NET_CLEARANCE_VY * 1.8,
        );
        vx = calcVx;
        vy = calcVy;
      } else {
        // AI Rally Shot OR Serve Return
        const playerCourtWidth = screenW / 2;
        const targetableMinX = C.PADDLE_WIDTH * 4;
        const targetableMaxX = playerCourtWidth - C.AI_CENTER_MARGIN;
        const targetableWidth = targetableMaxX - targetableMinX;
        const randomTargetPoint =
          targetableMinX +
          targetableWidth *
            (0.5 - targetAccuracy / 2 + Math.random() * targetAccuracy);
        targetX =
          randomTargetPoint +
          (Math.random() - 0.5) * targetableWidth * targetSpread;
        const targetY = courtY - C.BALL_RADIUS * (1.7 + Math.random() * 0.6);
        if (isAiReturningServe) {
          state.ballSpin = -1;
        } else {
          const incomingSpin =
            state.lastShotType === "topspin"
              ? 1
              : state.lastShotType === "slice"
                ? -1
                : 0;
          const isHighBall = courtY - ball.y > C.NET_HEIGHT * 0.8;
          const isMidHeightBall = courtY - ball.y > C.NET_HEIGHT * 0.3;

          // --- CHANGE 2: Smartly counter topspin with a slice ---
          if (incomingSpin > 0 && Math.random() < 0.75) {
            // High chance (75%) to counter topspin with slice
            state.ballSpin = -1;
          } else {
            // Fallback to original varied logic
            let randomFactor = Math.random();
            if (!isMidHeightBall && randomFactor < 0.3) {
              state.ballSpin = 0;
            } else if (randomFactor < 0.6) {
              state.ballSpin = incomingSpin > 0 ? -1 : 1;
            } else {
              state.ballSpin = incomingSpin !== 0 ? incomingSpin : -1;
            }
            if (isHighBall && Math.random() < 0.8) {
              state.ballSpin = 1;
            }
          }
        }
        const gravityMult =
          state.ballSpin > 0
            ? TOPSPIN_GRAVITY_MULT
            : state.ballSpin < 0
              ? SLICE_GRAVITY_MULT
              : 1.0;
        const shotSpeed =
          baseShotSpeed *
          (isAiReturningServe ? 0.9 : 1.05) *
          (1 + (Math.random() - 0.5) * velocityError);
        const netClearance =
          C.AI_NET_CLEARANCE_VY * (isAiReturningServe ? 1.1 : 0.8);
        const { calcVx, calcVy } = calculateShotVelocity(
          ball.x,
          ball.y,
          targetX,
          targetY,
          shotSpeed,
          gravityMult,
          netClearance,
        );
        vx = calcVx;
        vy = calcVy;
      }

      // Apply calculated velocity and update state (Common logic - same as before)
      ball.vx = vx;
      ball.vy = vy;
      p2.rotation = Math.max(
        -MAX_PADDLE_ANGLE,
        Math.min(MAX_PADDLE_ANGLE, Math.atan2(-vy, -vx)),
      );
      state.bounces = 0;
      state.lastPaddleHitSide = "player2";
      state.lastBounceSide = null;
      state.mustBounceBeforeHit = true;
      state.hasBouncedOnCurrentSide = false;
      state.aiCanHit = false;
      state.aiWillMissThisShot = undefined;
      if (isAiReturningServe) {
        state.aiTargetX = null;
      }
    } else {
      // If not hitting (same as before)
      // *** Keep angle neutral during serve setup ***
      if (!isAiExecutingServe) p2.rotation *= 0.85;
      else p2.rotation = 0; // Force neutral angle while waiting to serve
    }
  }

  function calculateShotVelocity(
    startX,
    startY,
    targetX,
    targetY,
    speed,
    gravityMult,
    netClearanceVY = 0,
  ) {
    const dx = targetX - startX;
    const dy = targetY - startY;
    const effectiveGravity = C.GRAVITY * gravityMult;

    // Estimate flight time based on horizontal distance and desired speed
    // This is an approximation as vertical motion affects total speed
    let flightTime = Math.abs(dx / speed);
    if (flightTime === 0) flightTime = 0.1; // Avoid division by zero

    // Calculate initial velocities based on estimated time
    let calcVx = dx / flightTime;
    let calcVy = dy / flightTime - 0.5 * effectiveGravity * flightTime;

    // Adjust vy for net clearance (ensure it goes over)
    // Simulate midpoint Y to check net clearance roughly
    const midTime = flightTime / 2;
    const midY =
      startY + calcVy * midTime + 0.5 * effectiveGravity * midTime * midTime;
    const netTopY = app.screen.height * COURT_Y_FACTOR - C.NET_HEIGHT;

    if (midY > netTopY - C.BALL_RADIUS) {
      // Likely to hit net or be very close
      calcVy -= netClearanceVY; // Add upward velocity adjustment
      // Recalculate flight time and vx based on new vy (optional, can be complex)
      // For simplicity, we might just use the adjusted vy with the original vx
    }

    // Clamp/adjust final velocity if needed (e.g., ensure minimum speed)
    const finalSpeed = Math.sqrt(calcVx * calcVx + calcVy * calcVy);
    if (finalSpeed < speed * 0.5) {
      // If calculated speed is too low, scale it up
      const scale = (speed * 0.5) / finalSpeed;
      calcVx *= scale;
      calcVy *= scale;
    }

    return { calcVx, calcVy };
  }

  function updateBall(delta) {
    if (!state.ballInPlay) return;

    const gravityMult =
      state.ballSpin > 0
        ? TOPSPIN_GRAVITY_MULT
        : state.ballSpin < 0
          ? SLICE_GRAVITY_MULT
          : 1;
    ball.vy += C.GRAVITY * gravityMult * delta;

    ball.prevX = ball.x;
    ball.prevY = ball.y;
    ball.x += ball.vx * delta;
    ball.y += ball.vy * delta;

    const screenW = app.screen.width,
      screenH = app.screen.height;
    const courtY = screenH * COURT_Y_FACTOR;

    // Floor collision
    if (ball.y + C.BALL_RADIUS >= courtY) {
      ball.y = courtY - C.BALL_RADIUS;
      const bounceSide = getBallSide();

      // Spin-dependent bounce physics
      if (state.ballSpin < 0) {
        // Slice
        ball.vy *= -0.55;
        ball.vx *= 0.88;
      } else if (state.ballSpin > 0) {
        // Topspin
        ball.vy *= -0.8;
        ball.vx *= 0.96;
      } else {
        // Flat
        ball.vy *= -0.75;
        ball.vx *= 0.92;
      }

      // Bounce logic for scoring
      if (state.lastPaddleHitSide === bounceSide) {
        // Hit own side after hitting
        pointOver(bounceSide === "player1" ? "player2" : "player1");
        return;
      }
      state.hasBouncedOnCurrentSide = true;
      if (state.lastBounceSide !== bounceSide) {
        state.bounces = 1;
        state.lastBounceSide = bounceSide;
      } else {
        state.bounces++;
      }
      if (state.bounces >= 2) {
        pointOver(bounceSide === "player1" ? "player2" : "player1");
        return;
      }
    }

    // Ceiling collision
    if (ball.y - C.BALL_RADIUS <= 0) {
      ball.y = C.BALL_RADIUS;
      ball.vy *= -0.8;
    }

    // Out of bounds (sides)
    if (ball.x + C.BALL_RADIUS < 0 || ball.x - C.BALL_RADIUS > screenW) {
      const pointWinner = determineOutOfBoundsWinner();
      if (pointWinner) pointOver(pointWinner);
      return;
    }

    // Net collision
    handleNetCollision();
  }

  function determineOutOfBoundsWinner() {
    if (!state.lastPaddleHitSide) {
      // If serve goes out without bouncing
      return ball.x < app.screen.width / 2 ? "player2" : "player1";
    }
    const lastHitter = state.lastPaddleHitSide;
    const opponent = lastHitter === "player1" ? "player2" : "player1";
    // If ball bounces on opponent's side then goes out, last hitter scores
    // If ball goes out without bouncing on opponent's side, opponent scores
    return state.lastBounceSide === opponent ? lastHitter : opponent;
  }

  function handleNetCollision() {
    const screenW = app.screen.width,
      screenH = app.screen.height;
    const courtY = screenH * COURT_Y_FACTOR;
    const netX = screenW / 2;
    const netTopY = courtY - C.NET_HEIGHT;

    const crossedNet =
      (ball.prevX < netX && ball.x >= netX) ||
      (ball.prevX > netX && ball.x <= netX);

    if (crossedNet) {
      const t = (netX - ball.prevX) / (ball.x - ball.prevX); // Interpolation factor
      const crossY = ball.prevY + t * (ball.y - ball.prevY); // Y position at net crossing

      if (crossY > netTopY - C.BALL_RADIUS) {
        // Hit the net
        ball.x =
          ball.prevX < netX ? netX - C.BALL_RADIUS : netX + C.BALL_RADIUS; // Place ball just before/after net
        ball.y = crossY;
        ball.vx *= -0.5; // Reverse horizontal direction slightly
        ball.vy *= 0.6; // Reduce vertical speed

        // Add upward pop if hit near the top
        if (crossY < netTopY + C.NET_BOUNCE_Y_ADD) {
          ball.vy =
            -Math.abs(ball.vy) * 0.4 - Math.random() * C.NET_BOUNCE_VY_ADD;
        }
        state.ballSpin = 0; // Net removes spin
      }
    }
  }

  function updateTrail() {
    if (!state.ballInPlay) return;
    trailPoints.push({ x: ball.x, y: ball.y, alpha: 1 });
    if (trailPoints.length > 15) trailPoints.shift();

    trail.clear();
    for (let i = 0; i < trailPoints.length; i++) {
      const point = trailPoints[i];
      const alpha = (i / trailPoints.length) * 0.6;
      const size = (i / trailPoints.length) * C.BALL_RADIUS;
      trail.circle(point.x, point.y, size).fill({ color: 0xffff00, alpha });
    }
  }

  function updateParticles(delta) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * delta;
      p.y += p.vy * delta;
      p.life--;
      p.alpha = Math.max(0, p.life / p.initialLife);
      if (p.life <= 0) {
        app.stage.removeChild(p);
        particles.splice(i, 1);
      }
    }
  }

  function createFireEffect(x, y) {
    for (let i = 0; i < 8; i++) {
      const particle = new PIXI.Graphics();
      particle
        .circle(0, 0, Math.random() * C.PARTICLE_SIZE_MAX + C.PARTICLE_SIZE_MIN)
        .fill(Math.random() > 0.5 ? 0xff6600 : 0xff0000);
      particle.x = x;
      particle.y = y;
      particle.alpha = 1;
      particle.vx = (Math.random() - 0.5) * C.PARTICLE_VX;
      particle.vy = (Math.random() - 0.5) * C.PARTICLE_VY;
      particle.initialLife = C.PARTICLE_LIFE;
      particle.life = C.PARTICLE_LIFE;
      app.stage.addChild(particle);
      particles.push(particle);
    }
  }

  // --- Game State Management ---

  function startServe(toLeft) {
    serveTrajectoryLine.clear();
    hideMessage();
    state.bounces = 0;
    state.lastPaddleHitSide = null;
    state.lastBounceSide = null;
    state.lastShotType = undefined;
    state.ballSpin = 0;
    state.mustBounceBeforeHit = false;
    state.hasBouncedOnCurrentSide = false;
    state.aiWillMissThisShot = undefined;
    state.aiCanHit = true;
    trailPoints = [];
    trail.clear();

    const screenW = app.screen.width,
      screenH = app.screen.height;
    const courtY = screenH * COURT_Y_FACTOR;

    ball.x = screenW / 2;
    ball.y = courtY - C.NET_HEIGHT * 3.6; // Position ball for serve
    ball.vx = toLeft ? -C.SERVE_VX : C.SERVE_VX;
    ball.vy = C.SERVE_VY;

    state.ballInPlay = true;
  }

  function calculateServeIntercept() {
    // Predict where AI needs to be for the serve
    const screenW = app.screen.width;
    const screenH = app.screen.height;
    const courtY = screenH * COURT_Y_FACTOR;
    const serveContactHeight = courtY - C.NET_HEIGHT * 1.3; // AI hit height

    // Simulate ball path (only need to do this for AI receiving serve)
    let simX = screenW / 2;
    let simY = courtY - C.NET_HEIGHT * 3.6; // Serve start Y
    let simVY = C.SERVE_VY;
    const simVX = C.SERVE_VX; // Serve always goes right towards AI
    const dt = 0.1; // Small time step for accuracy
    let safetyCounter = 0;
    let hasReachedApex = false;
    let predictedX = null;

    while (simY < courtY && safetyCounter < 5000) {
      simVY += C.GRAVITY * dt; // Basic gravity, spin isn't applied yet
      simX += simVX * dt;
      simY += simVY * dt;
      safetyCounter++;

      if (!hasReachedApex && simVY > 0) hasReachedApex = true;

      // Check if ball has fallen into the hitting zone AFTER apex
      if (hasReachedApex && simY >= serveContactHeight) {
        predictedX = simX; // Store the accurate X prediction
        break;
      }
    }
    return predictedX;
  }

  function pointOver(winner) {
    if (!state.ballInPlay) return; // Prevent multiple calls
    const loser = winner === "player1" ? "player2" : "player1";
    state.scores[winner].points++;
    state.ballInPlay = false; // Stop ball updates immediately
    ball.vx = 0;
    ball.vy = 0; // Stop ball movement visually
    trailPoints = [];
    trail.clear(); // Clear trail
    state.aiTargetX = null; // Clear AI target

    updateScore(winner, loser); // Check for game over
    if (!state.gameOver) {
      resetRound();
    }
  }

  function resetRound() {
    state.ballInPlay = false;
    ball.x = -2000;
    ball.y = -2000;
    ball.vx = 0;
    ball.vy = 0; // Hide ball
    trailPoints = [];
    trail.clear();
    contactLine.clear();
    player1.swing.active = false;
    player1.x = player1.baseX;
    player1.scale.set(1, 1);
    redrawPaddle(player1);
    player2.swing.active = false;
    player2.x = player2.baseX; // Reset AI paddle too
    state.shotCharging = false;
    state.shotPower = 0;
    state.aiTargetX = null; // Clear previous target

    if (!state.gameOver) {
      const toLeft = state.servingPlayer === "player1";

      // Calculate AI intercept point ONLY if AI is receiving serve
      if (!toLeft) {
        state.aiTargetX = calculateServeIntercept();
      }

      drawServeTrajectory(toLeft);
      setTimeout(() => startServe(toLeft), 1200); // Delay before serving
    }
  }

  function updateScore(winner, loser) {
    const p1s = state.scores.player1.points,
      p2s = state.scores.player2.points;
    const winnerPoints = state.scores[winner].points,
      loserPoints = state.scores[loser].points;
    const totalPoints = p1s + p2s;

    // Check game over condition first
    if (winnerPoints >= 11 && winnerPoints - loserPoints >= 2) {
      state.gameOver = true;
      showGameOver(winner);
      return; // Stop further score processing
    }

    // Determine next server (if not game over)
    if (p1s >= 10 && p2s >= 10) {
      // Deuce scoring - alternate serve each point
      state.servingPlayer =
        state.servingPlayer === "player1" ? "player2" : "player1";
    } else if (totalPoints > 0 && totalPoints % 2 === 0) {
      // Standard scoring - alternate every 2 points
      state.servingPlayer =
        state.servingPlayer === "player1" ? "player2" : "player1";
    }
    // else: First point or odd total point, server doesn't change yet

    updateScoreUI();
  }

  function getBallSide() {
    return ball.x < app.screen.width / 2 ? "player1" : "player2";
  }

  // --- UI Functions ---

  function updateScoreUI() {
    const p1s = state.scores.player1.points,
      p2s = state.scores.player2.points;
    let scoreHTML;
    const serveBall1 = state.servingPlayer === "player1" ? " 🎾" : "";
    const serveBall2 = state.servingPlayer === "player2" ? " 🎾" : "";

    if (p1s >= 10 && p2s >= 10) {
      // Deuce logic
      if (p1s === p2s)
        scoreHTML = `<span style="color: ${PLAYER_COLOR_HEX};">DEUCE${serveBall1 || serveBall2}</span>`;
      else if (p1s > p2s)
        scoreHTML = `<span style="color: ${PLAYER_COLOR_HEX};">Adv. Player${serveBall1}</span>`;
      else
        scoreHTML = `<span style="color: ${AI_COLOR_HEX};">Adv. AI${serveBall2}</span>`;
    } else {
      // Standard score
      scoreHTML = `<span style="color: ${PLAYER_COLOR_HEX};">${p1s}${serveBall1}</span> - <span style="color: ${AI_COLOR_HEX};">${p2s}${serveBall2}</span>`;
    }
    scoreElement.innerHTML = scoreHTML;
  }

  function showMessage(text, isPersistent = false) {
    messageElement.innerText = text;
    messageElement.style.display = "block";
    if (!isPersistent) setTimeout(hideMessage, 1000);
  }

  function hideMessage() {
    messageElement.style.display = "none";
  }

  function showGameOver(winner) {
    const p1s = state.scores.player1.points,
      p2s = state.scores.player2.points;
    const title = gameOverScreen.querySelector(".game-over-title");
    const score = gameOverScreen.querySelector(".final-score");
    const options = gameOverScreen.querySelector(".rematch-options");

    title.textContent = winner === "player1" ? "PLAYER WINS!" : "AI WINS!";
    title.style.color = winner === "player1" ? PLAYER_COLOR_HEX : AI_COLOR_HEX;
    score.innerHTML = `Final Score: <span style="color: ${PLAYER_COLOR_HEX};">${p1s}</span> - <span style="color: ${AI_COLOR_HEX};">${p2s}</span>`;

    options.innerHTML = ""; // Clear old buttons
    const difficulties = ["beginner", "medium", "expert"];
    const currentIdx = difficulties.indexOf(AI_DIFFICULTY);

    // Rematch same difficulty button
    const sameBtn = document.createElement("button");
    sameBtn.className = "rematch-btn";
    sameBtn.textContent = `REMATCH (${AI_DIFFICULTY.toUpperCase()})`;
    sameBtn.onclick = () => startRematch(AI_DIFFICULTY);
    options.appendChild(sameBtn);

    // Easier/Harder buttons based on outcome
    if (winner === "player1" && currentIdx < difficulties.length - 1) {
      // Player won, offer harder
      const harderBtn = document.createElement("button");
      harderBtn.className = "rematch-btn";
      const nextDiff = difficulties[currentIdx + 1];
      harderBtn.textContent = `HARDER (${nextDiff.toUpperCase()})`;
      harderBtn.onclick = () => startRematch(nextDiff);
      options.appendChild(harderBtn);
    } else if (winner === "player2" && currentIdx > 0) {
      // AI won, offer easier
      const easierBtn = document.createElement("button");
      easierBtn.className = "rematch-btn";
      const prevDiff = difficulties[currentIdx - 1];
      easierBtn.textContent = `EASIER (${prevDiff.toUpperCase()})`;
      easierBtn.onclick = () => startRematch(prevDiff);
      options.appendChild(easierBtn);
    }

    gameOverScreen.style.display = "flex";
  }

  function startRematch(difficulty) {
    AI_DIFFICULTY = difficulty;
    // Update selected button visually on intro screen (optional, but good UX)
    difficultyBtns.forEach((btn) => {
      btn.classList.toggle("selected", btn.dataset.difficulty === difficulty);
    });
    gameOverScreen.style.display = "none";
    initializeGameState();
    gameStarted = true; // <-- ADD THIS LINE
    updateScoreUI();
    resetRound(); // Start the first serve
  }

  // --- Utility Functions ---

  function circleRectCollision(cx, cy, radius, rx, ry, rw, rh, angle = 0) {
    // If rect is rotated, transform circle center to rect's local space
    let tcx = cx,
      tcy = cy;
    if (angle !== 0) {
      const cosA = Math.cos(-angle);
      const sinA = Math.sin(-angle);
      const dx = cx - rx;
      const dy = cy - ry;
      tcx = rx + (dx * cosA - dy * sinA);
      tcy = ry + (dx * sinA + dy * cosA);
    }

    // Standard AABB collision check in rect's local space
    const closestX = Math.max(rx - rw / 2, Math.min(tcx, rx + rw / 2));
    const closestY = Math.max(ry - rh / 2, Math.min(tcy, ry + rh / 2));
    const distX = tcx - closestX;
    const distY = tcy - closestY;
    return distX * distX + distY * distY < radius * radius;
  }

  function drawServeTrajectory(toLeft) {
    serveTrajectoryLine.clear();
    const screenW = app.screen.width,
      screenH = app.screen.height;
    const courtY = screenH * COURT_Y_FACTOR;
    let simX = screenW / 2,
      simY = courtY - C.NET_HEIGHT * 3.6;
    let simVY = C.SERVE_VY;
    const simVX = toLeft ? -C.SERVE_VX : C.SERVE_VX;
    const pathPoints = [];

    while (simY < courtY) {
      // Simulate until floor hit
      simVY += C.GRAVITY;
      simX += simVX;
      simY += simVY;
      pathPoints.push({ x: simX, y: simY });
      if (pathPoints.length > 200) break; // Safety break
    }

    // Draw dots along path
    for (let i = 0; i < pathPoints.length; i += 3) {
      const p = pathPoints[i];
      serveTrajectoryLine
        .circle(p.x, p.y, 2 * (i / pathPoints.length) + 1)
        .fill({ color: 0xffffff, alpha: 0.3 });
    }
  }

  // --- Main Execution ---
  await initializePixiApp();
  initializeGameState();
  setupScene();
  setupUIListeners(); // Setup intro/game over screen listeners
  addControls(); // Add interactive game controls
  app.renderer.on("resize", resizeAndPosition);
  resizeAndPosition(); // Initial positioning and constant scaling
  updateScoreUI(); // Initial score display
  app.ticker.add(gameLoop); // Start the game loop
}); // End window load listener
