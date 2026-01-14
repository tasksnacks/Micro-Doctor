const config = {
  type: Phaser.AUTO,
  parent: "game-container",
  width: 450,
  height: 800,
  backgroundColor: "#000000",
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  physics: {
    default: "arcade",
    arcade: { debug: false }
  },
  scene: { preload, create, update }
};

const game = new Phaser.Game(config);

// ===== Core objects =====
let player, bullets, blocks, medicines, bg, introOverlay;
let docSmith, docReed, storyText, uiText, cursors;

// ===== Gameplay state =====
let inventory = [];
let stability = 20;

let lastFired = 0;
let fireRate = 250;

let isGameActive = false;
let dialogueIndex = 0;

let phase = 0;
let transitioning = false;
let waveTimer = null;

// ===== Boss =====
let bossMode = false;
let boss = null;
let bossHpText = null;
let bossChargeTimer = null;
let bossBulletOverlap = null;
let bossPlayerOverlap = null;
let bossSpawnedAt = 0; // when boss fight starts
let bossHP = 0; // dedicated boss HP (do not rely on boss.health)

// Boss controls
let bossInvulnUntil = 0;        // ignore hits until this time
let bossHitCooldownUntil = 0;   // throttle hits (time-based)
let bossMedTimer = null;
const BOSS_HIT_COOLDOWN_MS = 120;
let bossTouchCooldownUntil = 0;

// ===== Boss med effects =====
let bossSpeedMul = 1;
let bossSpeedTimer = null;

let bulletDamage = 1;
let bulletDamageTimer = null;

let fireRateTimer = null;

// base boss tuning (so slow effect scales nicely)
const BOSS_BASE_CHASE = 85;
const BOSS_BASE_DASH = 520;

// durations
const BOSS_SLOW_MS = 4500;
const BOSS_DMG_BUFF_MS = 5000;
const BOSS_FIRE_BUFF_MS = 5000;

// Boss-fight UI line (so the top text doesn't become a mess)
let playerHpText = null;

// ===== Shield =====
let playerShielded = false;

// ===== Cell speed (insulin) =====
let cellSpeedMul = 1;
let insulinTimer = null;

// ===== Tuning =====
const STAB_GAIN_ON_CURE = 2;
const STAB_LOSS_ON_MISS = 3;
const FINAL_STAND_TRIGGER = 7;

const PHASES = [
  { name: "THE VEINS",        bgKey: "bg1", spawnDelay: 1900, enemySpeed: 140, enemyHealth: 10, medChance: 0.25 },
  { name: "THE VITAL ORGANS", bgKey: "bg2", spawnDelay: 1600, enemySpeed: 175, enemyHealth: 13, medChance: 0.32 },
  { name: "THE NEURAL CORE",  bgKey: "bg3", spawnDelay: 1150, enemySpeed: 220, enemyHealth: 16, medChance: 0.35 }
];

const dialogues = [
  { speaker: "smith", text: "DR. SMITH: The patient's vitals are crashing. Pathogens are clotting the main artery.\n\n[ PRESS SPACE ]" },
  { speaker: "reed",  text: "DR. REED: I'm in the bloodstream. I'll transform them into healthy cells, but I'll need medical support.\n\n[ PRESS SPACE ]" },
  { speaker: "smith", text: "DR. SMITH: Collect meds, store up to 2, and CHOOSE when to use them.\nINSULIN slows CELLS. ADRENALINE boosts fire. ANTIBIOTICS wipe the zone.\n\n[ PRESS SPACE ]" },
  { speaker: "instructions", text:
    "MISSION BRIEFING:\n\n" +
    "- ARROW KEYS: Move\n" +
    "- Auto-Fire: Always on\n" +
    "- 1 & 2: Use Arsenal Meds\n" +
    "- Manual cures: +2 Stability\n" +
    "- Missed red cell: -3 Stability\n" +
    "- At 7%: FINAL STAND (Virus Core)\n" +
    "- Final level: Press C to combine 2 meds\n\n" +
    "[ PRESS SPACE TO DEPLOY ]"
  }
];

// ===== Touch controls (ADDED) =====
let touchState = {
  left: false, right: false, up: false, down: false,
  med1Just: false, med2Just: false, combineJust: false,
  nextJust: false
};
let touchUI = null; // container for buttons so we can hide/show if needed

function preload() {
  this.load.image("player", "assets/player.png");
  this.load.image("bullet", "assets/laser.png");

  this.load.image("cell_red", "assets/cell_red.png");
  this.load.image("cell_blue", "assets/cell_blue.png");

  this.load.image("insulin", "assets/Insulin.png");
  this.load.image("adrenaline", "assets/Adrenaline.png");
  this.load.image("antibiotic", "assets/Antibiotics.png");

  this.load.image("dr_smith", "assets/Dr_Smith.png");
  this.load.image("dr_reed", "assets/Dr_Reed.png");

  this.load.image("boss", "assets/virus_head.png");

  this.load.image("bg1", "assets/bg_bloodstream.png");
  this.load.image("bg2", "assets/bg_organ.png");
  this.load.image("bg3", "assets/bg_nervous_system.png");
}

function create() {
  // fallback
  const g = this.make.graphics({ x: 0, y: 0, add: false });
  g.fillStyle(0xffffff, 1);
  g.fillRect(0, 0, 32, 32);
  g.generateTexture("fallback", 32, 32);

  // nanoserum
  const m = this.make.graphics({ x: 0, y: 0, add: false });
  m.fillStyle(0x7a2cff, 1);
  m.fillCircle(16, 16, 16);
  m.fillStyle(0xffffff, 1);
  m.fillCircle(16, 16, 5);
  m.generateTexture("nanoserum", 32, 32);

  resetRunState.call(this, true);

  const bgKey = this.textures.exists(PHASES[0].bgKey) ? PHASES[0].bgKey : null;
  bg = bgKey
    ? this.add.tileSprite(225, 400, 450, 800, bgKey).setAlpha(0)
    : this.add.rectangle(225, 400, 450, 800, 0x050a10).setAlpha(0);

  const playerKey = this.textures.exists("player") ? "player" : "fallback";
  player = this.physics.add.sprite(225, 700, playerKey).setScale(0.5).setAlpha(0);
  player.setCollideWorldBounds(true);

  bullets = this.physics.add.group({ defaultKey: "bullet", maxSize: 250 });
  blocks = this.physics.add.group();
  medicines = this.physics.add.group();

  uiText = this.add.text(20, 20, "", {
    fontSize: "16px",
    fill: "#00ffcc",
    fontStyle: "bold"
  }).setDepth(100).setScrollFactor(0);

  introOverlay = this.add.rectangle(225, 400, 450, 800, 0x000000).setDepth(10);

  const smithKey = this.textures.exists("dr_smith") ? "dr_smith" : "fallback";
  const reedKey  = this.textures.exists("dr_reed") ? "dr_reed" : "fallback";
  docSmith = this.add.image(100, 400, smithKey).setScale(0.7).setDepth(11).setAlpha(0);
  docReed  = this.add.image(350, 400, reedKey).setScale(0.7).setDepth(11).setAlpha(0);

  storyText = this.add.text(225, 650, "SYSTEMS LOADING...", {
    fontSize: "18px",
    fill: "#fff",
    backgroundColor: "#111",
    padding: { x: 20, y: 20 },
    wordWrap: { width: 350 },
    align: "center"
  }).setOrigin(0.5).setDepth(12);

  cursors = this.input.keyboard.createCursorKeys();
  this.keys = this.input.keyboard.addKeys({
    one: Phaser.Input.Keyboard.KeyCodes.ONE,
    two: Phaser.Input.Keyboard.KeyCodes.TWO,
    c: Phaser.Input.Keyboard.KeyCodes.C,
    space: Phaser.Input.Keyboard.KeyCodes.SPACE
  });

  // ===== Touch UI setup (ADDED) =====
  setupTouchControls.call(this);

  this.physics.add.overlap(bullets, blocks, (bul, bl) => hitBlock.call(this, bul, bl, false), null, this);
  this.physics.add.overlap(player, medicines, collectMed, null, this);

  updateDialogue.call(this);
  updateUI();
}

// ===== Touch UI helpers (ADDED) =====
function setupTouchControls() {
  const hasTouch = (this.sys.game.device.input && this.sys.game.device.input.touch) || this.input.manager && this.input.manager.pointersTotal > 1;
  const isMobile = (this.sys.game.device.os && (this.sys.game.device.os.android || this.sys.game.device.os.iOS)) || hasTouch;

  // Add a couple extra pointers for multitouch (movement + button)
  this.input.addPointer(2);

  // If not mobile/touch capable, don't create UI.
  if (!isMobile) return;

  // Container for all UI elements (fixed to camera)
  touchUI = this.add.container(0, 0).setDepth(5000).setScrollFactor(0);

  const makeBtn = (x, y, w, h, label, onDown, onUp) => {
    const r = this.add.rectangle(x, y, w, h, 0x0a0a0a, 0.70)
      .setStrokeStyle(2, 0x00ffcc, 0.9)
      .setScrollFactor(0)
      .setDepth(5001);

    const t = this.add.text(x, y, label, {
      fontSize: "14px",
      fill: "#00ffcc",
      fontStyle: "bold",
      align: "center"
    }).setOrigin(0.5).setScrollFactor(0).setDepth(5002);

    // Important: interactive on the rectangle only
    r.setInteractive({ useHandCursor: false });

    r.on("pointerdown", (p) => {
      // Prevent UI press from becoming any future world input you add
      if (p && p.event) p.event.stopPropagation?.();
      r.setFillStyle(0x003333, 0.85);
      onDown && onDown();
    });

    const upFn = () => {
      r.setFillStyle(0x0a0a0a, 0.70);
      onUp && onUp();
    };

    r.on("pointerup", upFn);
    r.on("pointerout", upFn);
    r.on("pointerupoutside", upFn);

    touchUI.add([r, t]);
    return r;
  };

  // Layout constants (bottom HUD)
  const w = this.scale.gameSize.width;
  const h = this.scale.gameSize.height;
  const baseY = h - 70;     // vertically centered for bottom strip
  const btn = 54;           // small buttons
  const gap = 8;

  // --- D-Pad (left side) ---
  // Up
  makeBtn(60, baseY - (btn + gap), btn, btn, "▲",
    () => { touchState.up = true; },
    () => { touchState.up = false; }
  );
  // Left
  makeBtn(60 - (btn + gap), baseY, btn, btn, "◀",
    () => { touchState.left = true; },
    () => { touchState.left = false; }
  );
  // Right
  makeBtn(60 + (btn + gap), baseY, btn, btn, "▶",
    () => { touchState.right = true; },
    () => { touchState.right = false; }
  );
  // Down
  makeBtn(60, baseY + (btn + gap), btn, btn, "▼",
    () => { touchState.down = true; },
    () => { touchState.down = false; }
  );

  // --- Action buttons (right side) ---
  makeBtn(w - 60 - (btn + gap), baseY - 30, btn, btn, "MED 1",
    () => { touchState.med1Just = true; },
    null
  );
  makeBtn(w - 60, baseY - 30, btn, btn, "MED 2",
    () => { touchState.med2Just = true; },
    null
  );
  makeBtn(w - 60, baseY + 35, (btn * 2) + gap, btn, "COMBINE",
    () => { touchState.combineJust = true; },
    null
  );

  // --- Dialogue / Start (center bottom) ---
  makeBtn(w * 0.5, h - 25, 140, 38, "NEXT",
    () => { touchState.nextJust = true; },
    null
  );

  // Optional: slight transparency so it stays “retro HUD”
  touchUI.setAlpha(0.9);
}

function updateDialogue() {
  const current = dialogues[dialogueIndex];
  storyText.setText(current.text);

  if (current.speaker === "smith") {
    docSmith.setAlpha(1);
    docReed.setAlpha(0.2);
    storyText.setY(650).setBackgroundColor("#111");
  } else if (current.speaker === "reed") {
    docSmith.setAlpha(0.2);
    docReed.setAlpha(1);
    storyText.setY(650).setBackgroundColor("#111");
  } else {
    docSmith.setAlpha(0);
    docReed.setAlpha(0);
    storyText.setY(400).setBackgroundColor("#000055");
  }
}

function startGame() {
  this.tweens.add({
    targets: [introOverlay, storyText, docSmith, docReed],
    alpha: 0,
    duration: 900,
    onComplete: () => {
      isGameActive = true;
      this.tweens.add({ targets: [bg, player], alpha: 1, duration: 900 });
      startWaveTimer.call(this);
      updateUI();
    }
  });
}

function startWaveTimer() {
  if (waveTimer) waveTimer.remove(false);
  waveTimer = this.time.addEvent({
    delay: PHASES[phase].spawnDelay,
    callback: spawnWave,
    callbackScope: this,
    loop: true
  });
}

function update(time) {
  // ===== Dialogue advance (keyboard OR touch NEXT) =====
  const nextPressed = Phaser.Input.Keyboard.JustDown(this.keys.space) || touchState.nextJust;
  if (nextPressed) {
    touchState.nextJust = false; // consume edge
    if (!isGameActive && !bossMode) {
      dialogueIndex++;
      if (dialogueIndex < dialogues.length) updateDialogue.call(this);
      else startGame.call(this);
    }
  }

  if (!isGameActive || transitioning) {
    // consume one-shot action presses even when paused/in dialogue
    touchState.med1Just = false;
    touchState.med2Just = false;
    touchState.combineJust = false;
    return;
  }

  // Only restart if boss is STILL missing long after spawn time (not during hits)
  if (bossMode && (!boss || !boss.body)) {
    if (bossSpawnedAt && (this.time.now - bossSpawnedAt) > 1500) {
      restartRun.call(this, "BOSS LOST\nRestarting run...");
      return;
    }
  }

  if (bg.tilePositionY !== undefined) bg.tilePositionY -= 2;

  // ===== Movement: keyboard + touch dpad (ADDED) =====
  player.setVelocity(0);

  const leftDown  = (cursors.left && cursors.left.isDown) || touchState.left;
  const rightDown = (cursors.right && cursors.right.isDown) || touchState.right;
  const upDown    = (cursors.up && cursors.up.isDown) || touchState.up;
  const downDown  = (cursors.down && cursors.down.isDown) || touchState.down;

  if (leftDown) player.setVelocityX(-350);
  else if (rightDown) player.setVelocityX(350);

  if (upDown) player.setVelocityY(-350);
  else if (downDown) player.setVelocityY(350);

  // ===== Actions: keyboard + touch buttons (ADDED) =====
  if (Phaser.Input.Keyboard.JustDown(this.keys.one) || touchState.med1Just) {
    touchState.med1Just = false;
    useMedicine.call(this, 0);
  }
  if (Phaser.Input.Keyboard.JustDown(this.keys.two) || touchState.med2Just) {
    touchState.med2Just = false;
    useMedicine.call(this, 1);
  }
  if (Phaser.Input.Keyboard.JustDown(this.keys.c) || touchState.combineJust) {
    touchState.combineJust = false;
    combineMeds.call(this);
  }

  if (time > lastFired) {
    fireBullet.call(this);
    lastFired = time + fireRate;
  }

  bullets.children.each(b => {
    if (!b || !b.active) return;
    if (b.y < -80) b.disableBody(true, true);
  });

  if (bossMode && boss && boss.body) {
    bossAttackUpdate.call(this);
    if (bossHpText) bossHpText.setText(`VIRUS CORE: ${bossHP}`);
  }

  let shouldStartBoss = false;

  blocks.children.each(b => {
    if (!b) return;
    if (b.text) b.text.setPosition(b.x, b.y);

    if (b.y > 850 && b.active) {
      stability = Math.max(0, stability - STAB_LOSS_ON_MISS);
      updateUI();

      if (b.text) b.text.destroy();
      b.destroy();

      if (!bossMode && stability <= FINAL_STAND_TRIGGER) shouldStartBoss = true;
      if (stability <= 0) endGame.call(this);
    }
  });

  if (shouldStartBoss && !bossMode) startFinalBossBattle.call(this);
}

function resetRunState(isFreshBoot) {
  if (isFreshBoot) dialogueIndex = 0;

  isGameActive = false;
  transitioning = false;

  bossMode = false;
  destroyBossStuff.call(this);

  inventory = [];
  stability = 20;
  phase = 0;

  cellSpeedMul = 1;
  playerShielded = false;
  fireRate = 250;

  lastFired = 0;

  if (waveTimer) { waveTimer.remove(false); waveTimer = null; }
  if (insulinTimer) { insulinTimer.remove(false); insulinTimer = null; }
}

function destroyBossStuff() {
  if (bossChargeTimer) { bossChargeTimer.remove(false); bossChargeTimer = null; }
  if (bossMedTimer) { bossMedTimer.remove(false); bossMedTimer = null; }
  if (bossBulletOverlap) { bossBulletOverlap.destroy(); bossBulletOverlap = null; }
  if (bossPlayerOverlap) { bossPlayerOverlap.destroy(); bossPlayerOverlap = null; }

  if (boss) { boss.destroy(); boss = null; }
  if (bossHpText) { bossHpText.destroy(); bossHpText = null; }
  if (playerHpText) { playerHpText.destroy(); playerHpText = null; }

  bossInvulnUntil = 0;
  bossHitCooldownUntil = 0;
  bossTouchCooldownUntil = 0;
  bossSpawnedAt = 0;
  bossHP = 0;
}

function applyCellSpeedMul() {
  blocks.children.each(b => {
    if (b && b.active) {
      const base = b.baseSpeed || PHASES[phase].enemySpeed;
      b.setVelocityY(base * cellSpeedMul);
    }
  });

  medicines.children.each(med => {
    if (med && med.active) {
      const base = med.baseSpeed || (PHASES[phase].enemySpeed + 20);
      med.setVelocityY(base * cellSpeedMul);
    }
  });
}

function setCellSpeedMul(mul, durationMs) {
  cellSpeedMul = mul;
  applyCellSpeedMul();

  if (insulinTimer) { insulinTimer.remove(false); insulinTimer = null; }

  if (durationMs && durationMs > 0) {
    insulinTimer = this.time.addEvent({
      delay: durationMs,
      callback: () => {
        cellSpeedMul = 1;
        applyCellSpeedMul();
        insulinTimer = null;
      }
    });
  }
}

function checkPhaseProgress() {
  if (bossMode || transitioning) return;
  if (stability >= 80 && phase < 2) transitionToPhase.call(this, 2);
  else if (stability >= 40 && phase < 1) transitionToPhase.call(this, 1);
}

function transitionToPhase(nextPhase) {
  transitioning = true;
  isGameActive = false;

  if (waveTimer) waveTimer.paused = true;

  blocks.children.each(b => b && b.setVelocityY(0));
  medicines.children.each(med => med && med.setVelocityY(0));

  const lines =
    nextPhase === 1
      ? "⚠️ VIRAL SPREAD DETECTED\n\nThe infection has reached the VITAL ORGANS.\nBlood flow accelerates... targets harden."
      : "⚠️ CRITICAL BREACH\n\nThe virus has reached the NEURAL CORE.\nNeural signals spike... defenses escalate.";

  const overlay = this.add.rectangle(225, 400, 450, 800, 0x000000, 0.85).setDepth(300);
  overlay.setAlpha(0);

  const txt = this.add.text(225, 400, lines + "\n\n[ STABILIZE NOW ]", {
    fontSize: "20px",
    fill: "#ffffff",
    align: "center",
    wordWrap: { width: 380 }
  }).setOrigin(0.5).setDepth(301).setAlpha(0);

  this.tweens.add({
    targets: [overlay, txt],
    alpha: 1,
    duration: 650,
    onComplete: () => {
      phase = nextPhase;
      if (bg.setTexture && this.textures.exists(PHASES[phase].bgKey)) {
        bg.setTexture(PHASES[phase].bgKey);
      }

      this.time.delayedCall(1400, () => {
        this.tweens.add({
          targets: [overlay, txt],
          alpha: 0,
          duration: 500,
          onComplete: () => {
            overlay.destroy();
            txt.destroy();

            startWaveTimer.call(this);

            blocks.children.each(b => { if (b) b.baseSpeed = PHASES[phase].enemySpeed; });
            medicines.children.each(med => { if (med) med.baseSpeed = PHASES[phase].enemySpeed + 20; });
            applyCellSpeedMul();

            if (waveTimer) waveTimer.paused = false;
            isGameActive = true;
            transitioning = false;
            updateUI();
          }
        });
      });
    }
  });
}

function hitBlock(bullet, block, isWipe) {
  if (!block || !block.active) return;
  if (bullet) bullet.disableBody(true, true);

  block.health--;
  if (block.text) block.text.setText(block.health);

  if (block.health <= 0) {
    block.setActive(false);
    if (this.textures.exists("cell_blue")) block.setTexture("cell_blue");
    block.setVelocityY(-400);

    if (!isWipe && stability < 100) {
      stability = Math.min(100, stability + STAB_GAIN_ON_CURE);
      updateUI();
      checkPhaseProgress.call(this);
    }

    this.time.delayedCall(900, () => {
      if (block.text) block.text.destroy();
      block.destroy();
    });
  }
}

function clearEnemiesAndTexts() {
  // Destroys the text labels attached to cells
  blocks.children.each(b => { 
      if (b && b.text) {
          b.text.destroy(); 
          b.text = null;
      }
  });
  // Clears the cell sprites
  blocks.clear(true, true);
}

function spawnWave() {
  if (!isGameActive || transitioning) return;

  // During boss fight we do NOT spawn red cells here (boss drops meds via bossMedTimer)
  if (bossMode) return;

  const p = PHASES[phase];
  const x = Phaser.Math.Between(50, 400);
  const block = blocks.create(x, -50, "cell_red").setScale(0.8);
  block.health = p.enemyHealth;
  block.text = this.add.text(x, -50, block.health, { fontSize: "20px", fill: "#fff" }).setOrigin(0.5);
  block.baseSpeed = p.enemySpeed;
  block.setVelocityY(p.enemySpeed * cellSpeedMul);

  if (Math.random() < p.medChance) {
    const type = Phaser.Utils.Array.GetRandom(["insulin", "adrenaline", "antibiotic"]);
    medicines.create(Phaser.Math.Between(50, 400), -50, type).setScale(0.7).setVelocityY(220);
  }
}

function useMedicine(slot) {
  if (!inventory[slot]) return;
  const type = inventory[slot];

  // ===== BOSS MODE BEHAVIOR =====
  if (bossMode) {
    if (type === "antibiotic") {
      setBulletDamage.call(this, 3, BOSS_DMG_BUFF_MS);
      flashMessage.call(this, "ANTIBIOTICS ACTIVE\nDamage Boost!", 700);

    } else if (type === "insulin") {
      setBossSpeedMul.call(this, 0.45, BOSS_SLOW_MS);
      flashMessage.call(this, "INSULIN DEPLOYED\nBoss Slowed!", 700);

    } else if (type === "adrenaline") {
      setTempFireRate.call(this, 110, BOSS_FIRE_BUFF_MS);
      flashMessage.call(this, "ADRENALINE\nFire Rate Up!", 700);

    } else if (type === "nanoserum") {
      setBossSpeedMul.call(this, 0.6, 6500);
      setBulletDamage.call(this, 2, 6500);
      setTempFireRate.call(this, 85, 6500);
      setShield.call(this, true);

      this.time.delayedCall(6500, () => {
        setShield.call(this, false);
      });

      flashMessage.call(this, "NANO-SERUM\nBOOST + SLOW + SHIELD!", 900);
    }

    inventory.splice(slot, 1);
    updateUI();
    return;
  }

  // ===== NORMAL MODE =====
  if (type === "antibiotic") {
    blocks.children.each(b => {
      if (b && b.active) {
        b.health = 1;
        hitBlock.call(this, null, b, true);
      }
    });

  } else if (type === "insulin") {
    setCellSpeedMul.call(this, 0.35, 4000);

  } else if (type === "adrenaline") {
    setTempFireRate.call(this, 100, 6000);

  } else if (type === "nanoserum") {
    setCellSpeedMul.call(this, 0.5, 6500);
    setTempFireRate.call(this, 85, 6500);
    setShield.call(this, true);
    this.time.delayedCall(6500, () => setShield.call(this, false));
  }

  inventory.splice(slot, 1);
  updateUI();
}

function combineMeds() {
  // ===== BOSS COMBOS =====
  if (bossMode) {
    if (inventory.length < 2) return;

    const a = inventory[0];
    const b = inventory[1];
    inventory.splice(0, 2);

    const pair = [a, b].sort().join("+");

    if (pair === ["adrenaline","antibiotic"].sort().join("+")) {
      setTempFireRate.call(this, 75, 6000);
      setBulletDamage.call(this, 4, 6000);
      flashMessage.call(this, "COMBO: RAGE BURST\nFast Fire + Huge Damage!", 900);

    } else if (pair === ["insulin","antibiotic"].sort().join("+")) {
      setBossSpeedMul.call(this, 0.35, 6000);
      setBulletDamage.call(this, 3, 6000);
      flashMessage.call(this, "COMBO: SUPPRESSION\nBoss Slow + Damage Up!", 900);

    } else if (pair === ["insulin","adrenaline"].sort().join("+")) {
      setBossSpeedMul.call(this, 0.4, 6000);
      setTempFireRate.call(this, 80, 6000);
      flashMessage.call(this, "COMBO: OVERCLOCK\nBoss Slow + Rapid Fire!", 900);

    } else {
      setBossSpeedMul.call(this, 0.6, 5500);
      setBulletDamage.call(this, 2, 5500);
      setTempFireRate.call(this, 95, 5500);
      flashMessage.call(this, "COMBO: SYNTHESIS\nBalanced Boost!", 800);
    }

    updateUI();
    return;
  }

  // ===== NORMAL GAME COMBINE =====
  if (phase < 2) return;
  if (inventory.length < 2) return;

  inventory.splice(0, 2);
  inventory.push("nanoserum");
  flashMessage.call(this, "COMBINE SUCCESS: NANO-SERUM READY (Purple)\nPress 1/2 to deploy", 1200);
  updateUI();
}

function collectMed(playerObj, med) {
  if (inventory.length < 2) {
    inventory.push(med.texture.key);
    med.destroy();
    updateUI();
  }
}

function updateUI() {
  const shieldTxt = playerShielded ? "ON" : "OFF";
  uiText.setText(
    `PHASE: ${PHASES[phase].name}\n` +
    `STABILITY: ${stability}%\n` +
    `SHIELD: ${shieldTxt}\n` +
    `ARSENAL: [${inventory.join(" | ").toUpperCase() || "EMPTY"}]\n` +
    (phase >= 2 ? "COMBINE: Press C (needs 2 meds)" : "")
  );
}

// Fire bullets (unchanged)
function fireBullet() {
  if (!isGameActive) return;

  const b = bullets.get(player.x, player.y - 40);
  if (!b) return;

  b.enableBody(true, player.x, player.y - 40, true, true);
  b.setActive(true).setVisible(true);

  if (this.textures.exists("bullet")) b.setTexture("bullet");
  else b.setTexture("fallback");

  b.body.velocity.y = -800;
}

/* ===========================
   =========================== */

function startFinalBossBattle() {
  bossMode = true;
  transitioning = false;
  isGameActive = true;

  if (waveTimer) { waveTimer.remove(false); waveTimer = null; }

  clearEnemiesAndTexts();
  medicines.clear(true, true);
  bullets.children.each(b => { if (b) b.destroy(); });

  destroyBossStuff.call(this);

  flashMessage.call(this, "⚠️ FINAL STAND\nVIRUS CORE DETECTED", 650);

  const bossKey = this.textures.exists("boss") ? "boss" : "fallback";
  boss = this.physics.add.sprite(225, 200, bossKey).setScale(0.7);
  boss.setCollideWorldBounds(true);
  boss.body.allowGravity = false;
  boss.body.setBounce(0.6, 0.6);

  if (boss.body) {
    boss.body.setSize(boss.displayWidth * 0.5, boss.displayHeight * 0.5, true);
  }

  bossHP = 50;
  this.playerHP = 50;
  bossSpawnedAt = this.time.now;

  if (playerHpText) playerHpText.destroy();
  playerHpText = this.add.text(20, 70, `BOT INTEGRITY: ${this.playerHP}`, {
    fontSize: "16px", fill: "#00ffcc", fontStyle: "bold"
  }).setDepth(2000).setScrollFactor(0);

  if (bossHpText) bossHpText.destroy();
  bossHpText = this.add.text(225, 60, `VIRUS CORE: ${bossHP}`, {
    fontSize: "20px", fill: "#ff66ff", fontStyle: "bold"
  }).setOrigin(0.5).setDepth(2000).setScrollFactor(0);

  this.physics.add.overlap(bullets, boss, (b, bul) => {
    if (!bul || !bul.active || bul.isDying) return;

    bul.isDying = true;
    bul.destroy();

    const now = this.time.now;
    if (now < bossHitCooldownUntil) return;
    bossHitCooldownUntil = now + BOSS_HIT_COOLDOWN_MS;

    bossHP = Math.max(0, bossHP - bulletDamage);
    if (bossHpText) bossHpText.setText(`VIRUS CORE: ${bossHP}`);

    b.setTint(0xffffff);
    this.time.delayedCall(60, () => { if (b && b.active) b.clearTint(); });

    if (bossHP <= 0) {
      restartRun.call(this, "VIRUS CORE DESTROYED\nPatient Saved!");
    }
  }, null, this);

  bossPlayerOverlap = this.physics.add.overlap(player, boss, () => {
    const now = this.time.now;
    if (now < bossTouchCooldownUntil || playerShielded) return;

    bossTouchCooldownUntil = now + 1200;
    this.playerHP = Math.max(0, this.playerHP - 10);

    if (playerHpText) playerHpText.setText(`BOT INTEGRITY: ${this.playerHP}`);
    this.cameras.main.shake(200, 0.02);

    if (this.playerHP <= 0) {
      restartRun.call(this, "NANO-BOT DESTROYED\nRun restarting...");
    }
  }, null, this);

  bossMedTimer = this.time.addEvent({
    delay: 2000, loop: true, callback: () => {
      const type = Phaser.Utils.Array.GetRandom(["insulin", "adrenaline", "antibiotic"]);
      medicines.create(Phaser.Math.Between(50, 400), -50, type).setScale(0.7).setVelocityY(200);
    }
  });

  startBossChargeAI.call(this);
}

function startBossChargeAI() {
  if (!boss || !boss.body) return;
  if (bossChargeTimer) bossChargeTimer.remove(false);

  const dashSpeed = BOSS_BASE_DASH;
  const cooldown = 1200;

  bossChargeTimer = this.time.addEvent({
    delay: cooldown,
    loop: true,
    callback: () => {
      if (!boss || !boss.body) return;

      boss.setTint(0xff66ff);

      this.time.delayedCall(140, () => {
        if (!boss || !boss.body) return;

        boss.clearTint();

        const dx = player.x - boss.x;
        const dy = player.y - boss.y;
        const len = Math.max(1, Math.hypot(dx, dy));

        boss.body.velocity.x = (dx / len) * dashSpeed * bossSpeedMul;
        boss.body.velocity.y = (dy / len) * dashSpeed * bossSpeedMul;
      });
    }
  });
}

function bossAttackUpdate() {
  if (!boss || !boss.body) return;

  const dx = player.x - boss.x;
  const dy = player.y - boss.y;
  const len = Math.max(1, Math.hypot(dx, dy));

  const chaseSpeed = BOSS_BASE_CHASE * bossSpeedMul;
  boss.body.velocity.x += (dx / len) * chaseSpeed * 0.016;
  boss.body.velocity.y += (dy / len) * chaseSpeed * 0.016;
}

function setBossSpeedMul(mul, durationMs) {
  bossSpeedMul = mul;

  if (bossSpeedTimer) {
    bossSpeedTimer.remove(false);
    bossSpeedTimer = null;
  }

  if (durationMs && durationMs > 0) {
    bossSpeedTimer = this.time.addEvent({
      delay: durationMs,
      callback: () => {
        bossSpeedMul = 1;
        bossSpeedTimer = null;
      },
      callbackScope: this
    });
  }
}

function setBulletDamage(dmg, durationMs) {
  bulletDamage = dmg;

  if (bulletDamageTimer) {
    bulletDamageTimer.remove(false);
    bulletDamageTimer = null;
  }

  if (durationMs && durationMs > 0) {
    bulletDamageTimer = this.time.addEvent({
      delay: durationMs,
      callback: () => {
        bulletDamage = 1;
        bulletDamageTimer = null;
      },
      callbackScope: this
    });
  }
}

function setTempFireRate(rate, durationMs) {
  fireRate = rate;

  if (fireRateTimer) {
    fireRateTimer.remove(false);
    fireRateTimer = null;
  }

  if (durationMs && durationMs > 0) {
    fireRateTimer = this.time.addEvent({
      delay: durationMs,
      callback: () => {
        fireRate = 250;
        fireRateTimer = null;
      },
      callbackScope: this
    });
  }
}

function restartRun(message) {
  bossMode = false;
  destroyBossStuff.call(this);

  transitioning = false;
  isGameActive = true;

  stability = 20;
  phase = 0;
  inventory = [];
  fireRate = 250;
  cellSpeedMul = 1;

  if (insulinTimer) { insulinTimer.remove(false); insulinTimer = null; }
  setShield.call(this, false);

  player.setPosition(225, 700);
  player.setVelocity(0);

  if (bg && bg.setTexture && this.textures.exists(PHASES[0].bgKey)) {
    bg.setTexture(PHASES[0].bgKey);
  }

  clearEnemiesAndTexts();
  medicines.clear(true, true);

  bullets.children.each(b => { if (b) b.destroy(); });

  startWaveTimer.call(this);

  flashMessage.call(this, message || "RUN RESET\nStability: 20%", 900);
  updateUI();
}

function setShield(on) {
  playerShielded = on;
  if (on) player.setTint(0x7a2cff);
  else player.clearTint();
  updateUI();
}

function flashMessage(text, ms) {
  const overlay = this.add.rectangle(225, 400, 450, 800, 0x000000, 0.65).setDepth(500).setAlpha(0);
  const txt = this.add.text(225, 400, text, {
    fontSize: "22px",
    fill: "#ffffff",
    align: "center",
    wordWrap: { width: 380 }
  }).setOrigin(0.5).setDepth(501).setAlpha(0);

  this.tweens.add({
    targets: [overlay, txt],
    alpha: 1,
    duration: 200,
    onComplete: () => {
      this.time.delayedCall(ms, () => {
        this.tweens.add({
          targets: [overlay, txt],
          alpha: 0,
          duration: 250,
          onComplete: () => {
            overlay.destroy();
            txt.destroy();
          }
        });
      });
    }
  });
}

// You lose the whole game only if stability hits 0 before boss
function endGame() {
  isGameActive = false;
  destroyBossStuff.call(this);

  if (waveTimer) { waveTimer.remove(false); waveTimer = null; }
  if (insulinTimer) { insulinTimer.remove(false); insulinTimer = null; }

  this.physics.pause();

  this.add.rectangle(225, 400, 450, 800, 0x000000, 0.8).setDepth(200);
  this.add.text(225, 400, "SYSTEM FAILURE\nPatient Lost", {
    fontSize: "32px",
    fill: "#f00",
    align: "center"
  }).setOrigin(0.5).setDepth(201);
}
