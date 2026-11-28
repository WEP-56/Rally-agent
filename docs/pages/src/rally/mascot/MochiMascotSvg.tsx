import React, { useEffect, useRef, useState, useCallback, useId } from 'react';
import type { AgentStateId, PhysicsConfig } from './types';
import { useDevicePerformance } from './useDevicePerformance';

interface MochiMascotSvgProps {
  state: AgentStateId;
  physics: PhysicsConfig;
  size?: number | string;
  showSquircleBg?: boolean;
  interactive?: boolean;
  onPoke?: () => void;
  className?: string;
  compactMode?: boolean;
  /**
   * Performance strategy:
   * - 'auto' (default): detect mobile / low battery / reduced-motion / weak hardware and degrade automatically
   * - 'high': always 60fps with full filters & ambience (best on desktop Electron)
   * - 'low': 30fps render throttle, no SVG filters, no ambience FX, no particles, no cursor follow
   */
  perfMode?: 'auto' | 'high' | 'low';
  /** Manual render FPS cap (default: 60 on high, 30 on low) */
  maxFps?: number;
  /** External pause switch (e.g. row scrolled out of view in a list) */
  paused?: boolean;
  reducedMotion?: boolean;
}

interface SpringChannel {
  val: number;
  vel: number;
  target: number;
}

interface InteractiveParticle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  type: 'star' | 'heart' | 'bubble' | 'code';
  life: number;
  maxLife: number;
}

function createSpring(initial: number): SpringChannel {
  return { val: initial, vel: 0, target: initial };
}

function stepSpring(
  s: SpringChannel,
  dt: number,
  stiffness: number,
  damping: number
) {
  const force = -stiffness * (s.val - s.target) - damping * s.vel;
  s.vel += force * dt;
  s.val += s.vel * dt;
}

/**
 * Generates an Archimedean spiral path (dizzy swirl eyes for the error state)
 */
function buildSpiralPath(
  cx: number,
  cy: number,
  rMax: number,
  turns: number,
  phase: number
): string {
  const steps = 26;
  const segments: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const theta = phase + f * turns * Math.PI * 2;
    const r = rMax * (0.16 + 0.84 * f);
    const px = cx + Math.cos(theta) * r;
    const py = cy + Math.sin(theta) * r;
    segments.push(`${i === 0 ? 'M' : 'L'} ${px.toFixed(2)} ${py.toFixed(2)}`);
  }
  return segments.join(' ');
}

/**
 * Generates a rounded 4-pointed concave sparkle star path like the icon's golden stars
 */
function buildSparklePath(cx: number, cy: number, outerR: number, innerR: number, rotDeg = 0): string {
  const rad = (rotDeg * Math.PI) / 180;
  const pts: [number, number][] = [];
  for (let i = 0; i < 4; i++) {
    const angle = rad + (i * Math.PI) / 2;
    pts.push([cx + Math.cos(angle - Math.PI / 2) * outerR, cy + Math.sin(angle - Math.PI / 2) * outerR]);
    const midAngle = angle + Math.PI / 4;
    pts.push([
      cx + Math.cos(midAngle - Math.PI / 2) * innerR,
      cy + Math.sin(midAngle - Math.PI / 2) * innerR,
    ]);
  }
  // Construct smooth quadratic curves through tips and inner control points
  return `
    M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}
    Q ${pts[1][0].toFixed(2)} ${pts[1][1].toFixed(2)} ${pts[2][0].toFixed(2)} ${pts[2][1].toFixed(2)}
    Q ${pts[3][0].toFixed(2)} ${pts[3][1].toFixed(2)} ${pts[4][0].toFixed(2)} ${pts[4][1].toFixed(2)}
    Q ${pts[5][0].toFixed(2)} ${pts[5][1].toFixed(2)} ${pts[6][0].toFixed(2)} ${pts[6][1].toFixed(2)}
    Q ${pts[7][0].toFixed(2)} ${pts[7][1].toFixed(2)} ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}
    Z
  `;
}

export const MochiMascotSvg: React.FC<MochiMascotSvgProps> = ({
  state,
  physics,
  size = '100%',
  showSquircleBg = true,
  interactive = true,
  onPoke,
  className = '',
  compactMode = false,
  perfMode = 'auto',
  maxFps,
  paused = false,
  reducedMotion = false,
}) => {
  // ---- Performance adaptive layer (Electron / Android WebView friendly) ----
  const devicePerf = useDevicePerformance();
  const staticPose = reducedMotion || devicePerf.reducedMotion;
  const id = useId();
  const lowPerf =
    perfMode === 'low' || (perfMode !== 'high' && devicePerf.profile === 'low');
  const effectiveMaxFps = Math.max(15, Math.min(120, maxFps ?? (lowPerf ? 30 : 60)));
  const lowPerfRef = useRef(false);
  lowPerfRef.current = lowPerf || staticPose;

  const svgRef = useRef<SVGSVGElement | null>(null);
  const prevStateRef = useRef<AgentStateId>(state);

  // Pointer & Drag interaction refs
  const pointerRef = useRef({
    normX: 0,
    normY: 0,
    isHovering: false,
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
    dragOffsetX: 0,
    dragOffsetY: 0,
    pokeFlash: 0,
  });

  const particlesRef = useRef<InteractiveParticle[]>([]);
  const nextParticleId = useRef(1);

  // All continuous physics spring channels
  const springsRef = useRef({
    // Whole mascot root position & jelly scale
    rootX: createSpring(0),
    rootY: createSpring(0),
    scaleX: createSpring(1),
    scaleY: createSpring(1),

    // Mochi head/body motion
    headX: createSpring(0),
    headY: createSpring(0),
    headTilt: createSpring(-14.5), // Icon default cute tilt!
    cowlickWhip: createSpring(0),   // Secondary spring for top tuft

    // Coral hood/aura behind head
    hoodX: createSpring(0),
    hoodY: createSpring(0),
    hoodRot: createSpring(0),
    hoodScale: createSpring(1),

    // Facial features
    lookX: createSpring(0),
    lookY: createSpring(0),
    eyeScaleY: createSpring(1),
    eyeHappyMix: createSpring(0),   // 0 = oval capsule, 1 = happy ^ ^ crescent
    eyeFocusMix: createSpring(0),   // Focused squint for coding/searching
    blushScale: createSpring(1),
    blushOpacity: createSpring(0.88),
    mouthOpen: createSpring(0),     // 0 = hidden/closed, >0 = cute speaking/cheering mouth
    mouthWidth: createSpring(12),

    // Paws (Left paw is visible in icon; Right paw peeks out for active actions)
    leftPawX: createSpring(143),
    leftPawY: createSpring(227),
    leftPawRot: createSpring(-22),
    leftPawScale: createSpring(1),

    rightPawX: createSpring(248),
    rightPawY: createSpring(235),
    rightPawRot: createSpring(20),
    rightPawOpacity: createSpring(0), // Tucked in idle, emerges in active states

    // 5 Purple Mobius Petals / Ribbons
    ribbonBreath: createSpring(0),
    ribbonSpread: createSpring(0),
    ribbonWaveX: createSpring(0),
    ribbonWaveY: createSpring(0),
    ribbonTilt: createSpring(0),

    // Sparkle Stars
    star1X: createSpring(101),
    star1Y: createSpring(105),
    star1Scale: createSpring(1),
    star1Rot: createSpring(0),

    star2X: createSpring(329),
    star2Y: createSpring(117),
    star2Scale: createSpring(1),
    star2Rot: createSpring(0),

    // Continuous State Prop Blend Weights (0..1) for zero-cut transitions
    mixThinking: createSpring(state === 'thinking' ? 1 : 0),
    mixSearching: createSpring(state === 'searching' ? 1 : 0),
    mixOrchestrating: createSpring(state === 'orchestrating' ? 1 : 0),
    mixCoding: createSpring(state === 'coding' ? 1 : 0),
    mixReplying: createSpring(state === 'replying' ? 1 : 0),
    mixCompleted: createSpring(state === 'completed' ? 1 : 0),
    mixError: createSpring(state === 'error' ? 1 : 0),
  });

  // React render frame state (updated at 60fps)
  const [, setFrameTick] = useState(0);
  const timeRef = useRef(0);
  const blinkTimerRef = useRef({ nextBlinkAt: 2.4, isBlinking: false, blinkEnd: 2.55 });

  // Spawn interactive particles on poke or state transition
  const spawnParticles = useCallback(
    (count: number, type: InteractiveParticle['type'] = 'star', originX = 200, originY = 175) => {
      if (lowPerfRef.current) return; // skip particle FX on weak devices
      const palette = ['#FDCB58', '#FA9E8E', '#8871E3', '#B4A4F6', '#DACAFD'];
      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
        const speed = 45 + Math.random() * 85;
        particlesRef.current.push({
          id: nextParticleId.current++,
          x: originX + (Math.random() - 0.5) * 30,
          y: originY + (Math.random() - 0.5) * 24,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 40,
          size: 7 + Math.random() * 8,
          color: palette[i % palette.length],
          type,
          life: 0,
          maxLife: 0.75 + Math.random() * 0.45,
        });
      }
    },
    []
  );

  // Inject transition squash-and-stretch impulse when `state` changes
  useEffect(() => {
    if (prevStateRef.current !== state && !staticPose) {
      const s = springsRef.current;
      const bounce = physics.bounciness;
      // Smooth elastic anticipation & pop when transitioning between any two states
      s.scaleX.vel += 2.6 * bounce;
      s.scaleY.vel -= 2.4 * bounce;
      s.rootY.vel -= 115 * bounce;
      s.cowlickWhip.vel += 180 * bounce;
      s.ribbonSpread.vel += 1.8 * bounce;

      if (state === 'completed') {
        spawnParticles(10, 'star', 200, 160);
      } else if (state === 'coding') {
        spawnParticles(5, 'code', 205, 220);
      } else if (state === 'error') {
        spawnParticles(6, 'star', 200, 155);
      }
      prevStateRef.current = state;
    }
  }, [state, physics.bounciness, spawnParticles, staticPose]);

  // Main Physics Loop: physics integrates on EVERY rAF tick (keeps motion perfectly
  // continuous), while the React re-render is throttled to `effectiveMaxFps`.
  // The loop auto-pauses when the tab is hidden, the SVG is scrolled offscreen,
  // or the external `paused` prop is set — this is what prevents battery drain /
  // heat in Electron background windows and Android WebView lists.
  useEffect(() => {
    let rafId = 0;
    let lastTime = performance.now();
    let lastRender = 0;
    let alive = false;

    let inView = true;
    const evaluateAlive = () => {
      const next = Boolean(svgRef.current?.isConnected) && !document.hidden && !paused && inView && !staticPose;
      if (next === alive) return;
      alive = next;
      if (alive) {
        lastTime = performance.now();
        lastRender = 0;
        rafId = requestAnimationFrame(animate);
      } else {
        cancelAnimationFrame(rafId);
      }
    };

    const animate = (now: number) => {
      if (!alive && !staticPose) return;
      if (alive) rafId = requestAnimationFrame(animate);
      const rawDt = Math.min((now - lastTime) / 1000, 0.04); // Cap dt to avoid tab-switch spikes
      lastTime = now;

      const speed = physics.speedMultiplier;
      // Bound the integration step even after a missed frame.
      const dt = Math.min(rawDt, 1 / 60);
      timeRef.current = staticPose ? 0 : timeRef.current + rawDt * speed;
      const t = timeRef.current;

      const s = springsRef.current;
      const p = pointerRef.current;
      const k = physics.stiffness;
      const c = physics.damping;
      const bounce = physics.bounciness;

      // Decay poke flash
      if (p.pokeFlash > 0) {
        p.pokeFlash = Math.max(0, p.pokeFlash - rawDt * 2.2);
      }

      // Natural blinking logic
      const blink = blinkTimerRef.current;
      if (t > blink.nextBlinkAt && !blink.isBlinking) {
        blink.isBlinking = true;
        blink.blinkEnd = t + 0.14;
      } else if (blink.isBlinking && t > blink.blinkEnd) {
        blink.isBlinking = false;
        blink.nextBlinkAt = t + 2.2 + Math.random() * 2.8;
      }

      // Cursor tracking offset (disabled entirely in low-power mode)
      const cursorX = physics.followCursor && !lowPerfRef.current && p.isHovering ? p.normX : 0;
      const cursorY = physics.followCursor && !lowPerfRef.current && p.isHovering ? p.normY : 0;

      // Set Prop Blend Targets
      s.mixThinking.target = state === 'thinking' ? 1 : 0;
      s.mixSearching.target = state === 'searching' ? 1 : 0;
      s.mixOrchestrating.target = state === 'orchestrating' ? 1 : 0;
      s.mixCoding.target = state === 'coding' ? 1 : 0;
      s.mixReplying.target = state === 'replying' ? 1 : 0;
      s.mixCompleted.target = state === 'completed' ? 1 : 0;
      s.mixError.target = state === 'error' ? 1 : 0;

      // Default baseline pose (matches uploaded Icon!)
      let targetRootX = p.isDragging ? p.dragOffsetX : cursorX * 6;
      let targetRootY = p.isDragging ? p.dragOffsetY : cursorY * 5;
      let targetScaleX = 1;
      let targetScaleY = 1;

      let targetHeadX = cursorX * 8;
      let targetHeadY = cursorY * 6;
      let targetHeadTilt = -14.5 + cursorX * 7;

      let targetHoodX = -cursorX * 5;
      let targetHoodY = -cursorY * 4;
      let targetHoodRot = 0;
      let targetHoodScale = 1;

      let targetLookX = cursorX * 11;
      let targetLookY = cursorY * 9;
      let targetEyeScaleY = blink.isBlinking ? 0.08 : 1;
      let targetEyeHappy = p.pokeFlash > 0.2 ? 0.95 : 0;
      let targetEyeFocus = 0;
      let targetBlushScale = 1 + p.pokeFlash * 0.45;
      let targetBlushOpacity = 0.88;
      let targetMouthOpen = p.pokeFlash > 0.2 ? 0.7 : 0;
      let targetMouthWidth = 12;

      let targetLeftPawX = 143;
      let targetLeftPawY = 227;
      let targetLeftPawRot = -22;
      let targetLeftPawScale = 1;

      let targetRightPawX = 248;
      let targetRightPawY = 235;
      let targetRightPawRot = 20;
      let targetRightPawOpacity = 0;

      let targetRibbonBreath = Math.sin(t * 2.4) * 4;
      let targetRibbonSpread = 0;
      let targetRibbonWaveX = Math.cos(t * 2.0) * 3;
      let targetRibbonWaveY = Math.sin(t * 2.4) * 3.5;
      let targetRibbonTilt = cursorX * 3;

      let targetStar1X = 101 + Math.sin(t * 1.9) * 4;
      let targetStar1Y = 105 + Math.cos(t * 2.3) * 5;
      let targetStar1Scale = 1 + Math.sin(t * 3.2) * 0.12;
      let targetStar1Rot = Math.sin(t * 1.5) * 8;

      let targetStar2X = 329 + Math.cos(t * 2.1) * 4;
      let targetStar2Y = 117 + Math.sin(t * 2.6) * 5;
      let targetStar2Scale = 1 + Math.cos(t * 3.6) * 0.15;
      let targetStar2Rot = Math.cos(t * 1.8) * 10;

      // ====================================================================
      // STATE-SPECIFIC CONTINUOUS TARGET TRAJECTORIES
      // ====================================================================
      if (state === 'idle') {
        // Gentle Q-elastic breathing & peeking over ribbon
        const breath = Math.sin(t * 2.6);
        const subWave = Math.cos(t * 1.3);
        targetRootY += breath * 9;
        targetScaleX = 1 - breath * 0.04 * bounce;
        targetScaleY = 1 + breath * 0.045 * bounce;
        targetHeadTilt = -14.5 + Math.sin(t * 1.4) * 3.2 + cursorX * 8;
        targetHeadY += Math.sin(t * 2.6 - 0.4) * 5.5;
        targetHoodY += Math.sin(t * 2.6 - 0.9) * 7;
        targetHoodRot = Math.sin(t * 1.4 - 0.5) * 2.8;
        targetLeftPawY = 227 + Math.sin(t * 2.6) * 2.2;
        targetLookX += subWave * 2.5;
      } else if (state === 'thinking') {
        // Deep Thinking: Tilts head thoughtfully, right paw taps chin, eyes look up at orbiting stars
        const thinkPulse = Math.sin(t * 3.2);
        const chinTap = Math.sin(t * 6.4);
        targetRootY += Math.sin(t * 2.2) * 6 - 4;
        targetScaleX = 1 + Math.sin(t * 4.4) * 0.03 * bounce;
        targetScaleY = 1 - Math.sin(t * 4.4) * 0.03 * bounce;

        targetHeadTilt = -22 + Math.sin(t * 1.8) * 5;
        targetHeadX += -5 + Math.cos(t * 1.8) * 4;
        targetHeadY += -6 + thinkPulse * 3;

        // Eyes gaze upward & slightly left/right following thought bubbles
        targetLookX = Math.sin(t * 2.2) * 8 + cursorX * 5;
        targetLookY = -9 + Math.cos(t * 4.4) * 2.5;

        // Cute small "o" contemplative mouth
        targetMouthOpen = 0.35 + Math.sin(t * 3.2) * 0.15;
        targetMouthWidth = 7;

        // Coral hood expands and pulses warmly like a thinking brainwave aura
        targetHoodScale = 1.07 + Math.sin(t * 4.5) * 0.04;
        targetHoodRot = -6 + Math.sin(t * 2.2) * 5;
        targetHoodY = -8 + Math.cos(t * 3.2) * 5;

        // Right paw comes up to gently tap chin!
        targetRightPawOpacity = 1;
        targetRightPawX = 216 + Math.cos(t * 3.2) * 2;
        targetRightPawY = 204 + chinTap * 3.5;
        targetRightPawRot = -28 + chinTap * 8;

        // Left paw rests higher on ribbon
        targetLeftPawX = 140;
        targetLeftPawY = 226 + Math.sin(t * 2.2) * 2;

        // Stars orbit in a 3D halo ellipse around the top of the head
        const orbitAngle = t * 2.6;
        targetStar1X = 205 + Math.cos(orbitAngle) * 118;
        targetStar1Y = 92 + Math.sin(orbitAngle) * 26;
        targetStar1Scale = 0.9 + (Math.sin(orbitAngle) + 1) * 0.22;
        targetStar1Rot = t * 55;

        targetStar2X = 205 + Math.cos(orbitAngle + Math.PI) * 118;
        targetStar2Y = 92 + Math.sin(orbitAngle + Math.PI) * 26;
        targetStar2Scale = 0.85 + (Math.sin(orbitAngle + Math.PI) + 1) * 0.25;
        targetStar2Rot = -t * 65;
      } else if (state === 'searching') {
        // Searching: Smooth figure-8 Lissajous scanning motion, alert eyes, right paw holds magnifying glass
        const scanX = Math.sin(t * 3.0);
        const scanY = Math.sin(t * 6.0);
        targetRootX += scanX * 14;
        targetRootY += scanY * 5 - 6;
        targetScaleX = 1.04 - Math.abs(scanX) * 0.06 * bounce;
        targetScaleY = 0.96 + Math.abs(scanX) * 0.07 * bounce;

        targetHeadX += scanX * 12;
        targetHeadY += -10 + scanY * 4;
        targetHeadTilt = -8 + scanX * 14;

        // Eyes keenly track the scanning direction
        targetLookX = scanX * 12;
        targetLookY = scanY * 5 - 2;
        targetEyeFocus = 0.35;

        // Left paw grips the ribbon edge while leaning forward
        targetLeftPawX = 132 + scanX * 8;
        targetLeftPawY = 222 + scanY * 2;
        targetLeftPawRot = -15 + scanX * 10;

        // Right paw holds up the MD3 magnifying lens scanning across!
        targetRightPawOpacity = 1;
        targetRightPawX = 252 + scanX * 18;
        targetRightPawY = 192 + scanY * 8;
        targetRightPawRot = 12 + scanX * 18;

        // Ribbons ripple rapidly like waves
        targetRibbonWaveX = Math.cos(t * 5.2) * 9;
        targetRibbonWaveY = Math.sin(t * 5.2) * 6;
        targetRibbonSpread = 0.25 + Math.sin(t * 3.0) * 0.1;
        targetRibbonTilt = scanX * 6;

        // Hood trails behind the horizontal scan with phase lag
        targetHoodX = -scanX * 10;
        targetHoodRot = -scanX * 10;

        // Stars dart like search beacons
        targetStar1X = 88 + Math.sin(t * 4.5) * 14;
        targetStar1Y = 112 + Math.cos(t * 4.5) * 10;
        targetStar2X = 336 + Math.cos(t * 4.5) * 14;
        targetStar2Y = 104 + Math.sin(t * 4.5) * 10;
      } else if (state === 'orchestrating') {
        // Orchestrating: Mascot rises up, purple petals bloom wide, both paws conduct floating DAG nodes
        const beat = Math.sin(t * 4.2);
        const counterBeat = Math.cos(t * 4.2);

        targetRootY += -12 + Math.sin(t * 2.1) * 7;
        targetScaleX = 1 - beat * 0.045 * bounce;
        targetScaleY = 1 + beat * 0.048 * bounce;

        targetHeadY += -10 + Math.abs(beat) * 5;
        targetHeadTilt = -10 + Math.sin(t * 2.1) * 9;

        targetLookX = Math.sin(t * 2.1) * 9;
        targetLookY = -7 + Math.cos(t * 4.2) * 4;
        targetMouthOpen = 0.4;
        targetMouthWidth = 11;

        // Both paws conduct in alternating graceful arcs!
        targetLeftPawX = 118 + Math.sin(t * 4.2) * 16;
        targetLeftPawY = 186 + Math.cos(t * 4.2) * 14;
        targetLeftPawRot = -42 + Math.sin(t * 4.2) * 24;
        targetLeftPawScale = 1.08;

        targetRightPawOpacity = 1;
        targetRightPawX = 278 - Math.sin(t * 4.2) * 16;
        targetRightPawY = 178 - Math.cos(t * 4.2) * 14;
        targetRightPawRot = 38 - Math.sin(t * 4.2) * 24;

        // Purple Mobius petals open up like a blooming lotus
        targetRibbonSpread = 0.85 + Math.sin(t * 4.2) * 0.18;
        targetRibbonBreath = 8 + counterBeat * 5;
        targetRibbonWaveX = Math.sin(t * 3.0) * 7;
        targetRibbonWaveY = Math.cos(t * 3.0) * 6;

        targetHoodScale = 1.1 + Math.abs(beat) * 0.05;
        targetHoodY = -12;

        // Stars hover high on either side of the DAG graph
        targetStar1X = 78 + Math.sin(t * 3.0) * 8;
        targetStar1Y = 86 + Math.cos(t * 3.0) * 8;
        targetStar1Scale = 1.18;
        targetStar1Rot = t * 40;

        targetStar2X = 338 + Math.cos(t * 3.0) * 8;
        targetStar2Y = 92 + Math.sin(t * 3.0) * 8;
        targetStar2Scale = 1.22;
        targetStar2Rot = -t * 40;
      } else if (state === 'coding') {
        // Tool Calling / Coding: High-frequency focused bongo-tapping on the ribbon with both paws!
        const tapLeft = Math.sin(t * 18);
        const tapRight = Math.sin(t * 18 + Math.PI);
        const bodyVib = Math.sin(t * 9);

        targetRootY += 4 + bodyVib * 3.2;
        targetScaleX = 1.05 + bodyVib * 0.035 * bounce;
        targetScaleY = 0.95 - bodyVib * 0.035 * bounce;

        targetHeadY += 6 + bodyVib * 2.5;
        targetHeadTilt = -12 + Math.sin(t * 4.5) * 3.5;

        // Eyes focused slightly downward at the holographic terminal keyboard
        targetLookX = Math.sin(t * 6.0) * 6;
        targetLookY = 6;
        targetEyeFocus = 0.65;
        targetBlushScale = 1.15;

        // Both paws rapidly tap on the front ribbon!
        targetLeftPawX = 152 + Math.sin(t * 4.5) * 6;
        targetLeftPawY = 223 + (tapLeft > 0 ? tapLeft * 9 : tapLeft * 3);
        targetLeftPawRot = -12 + tapLeft * 18;

        targetRightPawOpacity = 1;
        targetRightPawX = 232 + Math.cos(t * 4.5) * 6;
        targetRightPawY = 221 + (tapRight > 0 ? tapRight * 9 : tapRight * 3);
        targetRightPawRot = 14 + tapRight * 18;

        // Ribbon vibrates with the typing rhythm
        targetRibbonBreath = bodyVib * 3.5;
        targetRibbonSpread = -0.15;
        targetRibbonWaveY = bodyVib * 4;

        targetStar1Scale = 1 + Math.abs(tapLeft) * 0.25;
        targetStar2Scale = 1 + Math.abs(tapRight) * 0.25;
        targetStar1Rot = t * 90;
        targetStar2Rot = -t * 90;
      } else if (state === 'replying') {
        // Streaming Response: Warm, bouncy syllabic speech rhythm, waving paw, glowing blush
        const syllable = Math.abs(Math.sin(t * 7.5)) * (0.6 + 0.4 * Math.sin(t * 2.3));
        const sway = Math.sin(t * 3.2);

        targetRootX += sway * 6;
        targetRootY += -Math.abs( Math.sin(t * 3.2) ) * 9;
        targetScaleX = 1 - syllable * 0.055 * bounce;
        targetScaleY = 1 + syllable * 0.065 * bounce;

        targetHeadTilt = -13 + sway * 8;
        targetHeadY += -syllable * 6;

        // Warm eye contact & happy intermittent squint
        targetLookX = cursorX * 8 + sway * 3;
        targetLookY = cursorY * 6 - 1;
        targetEyeHappy = Math.sin(t * 1.8) > 0.55 ? 0.85 : 0;

        // Expressive speaking mouth synced to syllable envelope
        targetMouthOpen = 0.25 + syllable * 0.85;
        targetMouthWidth = 11 + syllable * 5;

        // Glowing warm cheeks
        targetBlushScale = 1.25 + syllable * 0.2;
        targetBlushOpacity = 0.96;

        // Left paw waves warmly to the user!
        targetLeftPawX = 126 + Math.sin(t * 6.4) * 10;
        targetLeftPawY = 198 + Math.cos(t * 6.4) * 6;
        targetLeftPawRot = -38 + Math.sin(t * 6.4) * 26;
        targetLeftPawScale = 1.06;

        // Right paw rests on the ribbon
        targetRightPawOpacity = 0.95;
        targetRightPawX = 248;
        targetRightPawY = 230 + sway * 3;
        targetRightPawRot = 18;

        targetRibbonSpread = 0.35 + syllable * 0.15;
        targetRibbonWaveX = sway * 6;
        targetHoodScale = 1.05 + syllable * 0.04;
      } else if (state === 'completed') {
        // Completed Celebration: Joyful elastic jumps, happy ^ ^ crescent eyes, both paws raised cheering!
        const jumpPhase = (t * 3.8) % (Math.PI * 2);
        const jumpSin = Math.sin(jumpPhase);
        const isAirborne = jumpSin > 0;

        targetRootY += isAirborne ? -jumpSin * 22 : -jumpSin * 6;
        targetScaleX = isAirborne
          ? 1 - jumpSin * 0.09 * bounce
          : 1 + Math.abs(jumpSin) * 0.14 * bounce;
        targetScaleY = isAirborne
          ? 1 + jumpSin * 0.11 * bounce
          : 1 - Math.abs(jumpSin) * 0.12 * bounce;

        targetHeadTilt = -10 + Math.sin(t * 3.8) * 10;
        targetHeadY += isAirborne ? -jumpSin * 8 : 3;

        // Happy crescent eyes ^ ^
        targetEyeHappy = 1;
        targetBlushScale = 1.35;
        targetBlushOpacity = 1;
        targetMouthOpen = 0.85;
        targetMouthWidth = 15;

        // Both paws raised high cheering!
        targetLeftPawX = 122 - (isAirborne ? jumpSin * 8 : 0);
        targetLeftPawY = 174 - (isAirborne ? jumpSin * 16 : 0);
        targetLeftPawRot = -52 - jumpSin * 18;
        targetLeftPawScale = 1.1;

        targetRightPawOpacity = 1;
        targetRightPawX = 274 + (isAirborne ? jumpSin * 8 : 0);
        targetRightPawY = 166 - (isAirborne ? jumpSin * 16 : 0);
        targetRightPawRot = 48 + jumpSin * 18;

        targetRibbonSpread = 0.75 + jumpSin * 0.25;
        targetHoodScale = 1.12;
        targetStar1Scale = 1.3 + Math.sin(t * 7.6) * 0.25;
        targetStar2Scale = 1.3 + Math.cos(t * 7.6) * 0.25;
        targetStar1Rot = t * 110;
        targetStar2Rot = -t * 110;
      } else if (state === 'error') {
        // Error / Self-Heal: anxious shiver, drooping cowlick, dizzy swirl eyes, no blink
        const shiver = Math.sin(t * 21) * 1.5 + Math.sin(t * 33.7 + 1.3) * 0.85;
        const flinch = Math.pow(Math.max(0, Math.sin(t * 2.35 + 0.6)), 9); // occasional bigger flinch
        const headShake = Math.sin(t * 5.4);

        targetRootX += shiver + flinch * Math.sin(t * 46) * 5;
        targetRootY += Math.abs(Math.sin(t * 10.5)) * 2.4 - 2.5 - flinch * 4;
        targetScaleX = 1.03 + Math.sin(t * 10.5) * 0.022 * bounce + flinch * 0.05 * bounce;
        targetScaleY = 0.97 - Math.sin(t * 10.5) * 0.026 * bounce - flinch * 0.06 * bounce;

        // 蔫掉的呆毛 + 左右摇晃的“不行…不行…”式头部
        targetHeadTilt = -14 + headShake * 8.5;
        targetHeadX += -3 + headShake * 5.5 + shiver * 0.7;
        targetHeadY += 4.5 + Math.abs(Math.sin(t * 10.5)) * 3.5;

        // 双眼涣散上翻（关注警示三角方向）
        targetLookX = Math.sin(t * 2.7) * 4.5;
        targetLookY = -7.5 + Math.sin(t * 4.8) * 2;
        targetEyeFocus = 0;

        // 焦虑波浪口 "∿"，腮红消退
        targetMouthOpen = 0.72;
        targetBlushScale = 0.82;
        targetBlushOpacity = 0.38;

        // 左爪抱头式慌张，右爪无力下垂半抬起
        targetLeftPawX = 138 + shiver * 1.6;
        targetLeftPawY = 210 + Math.sin(t * 21) * 2.6;
        targetLeftPawRot = -34 + Math.sin(t * 21) * 7;
        targetLeftPawScale = 0.94;

        targetRightPawOpacity = 0.9;
        targetRightPawX = 250 + Math.cos(t * 19) * 2.2;
        targetRightPawY = 236 + Math.cos(t * 10.5) * 2;
        targetRightPawRot = 34 + Math.sin(t * 5.4) * 4;

        // 丝带蜷缩颤抖
        targetRibbonSpread = -0.32 + Math.sin(t * 21) * 0.045;
        targetRibbonBreath = Math.sin(t * 10.5) * 3;
        targetRibbonWaveX = Math.sin(t * 21) * 2.4;
        targetRibbonWaveY = Math.cos(t * 16) * 2.2;

        // 珊瑚兜帽微微抽搐收缩（警报感）
        targetHoodScale = 0.96 + Math.sin(t * 6.4) * 0.018;
        targetHoodRot = headShake * 4;
        targetHoodY = 2.5 + Math.abs(Math.sin(t * 10.5)) * 2.5;

        // 星芒黯淡、旋转迟疑
        targetStar1Scale = 0.62 + Math.sin(t * 2.1) * 0.08;
        targetStar2Scale = 0.6 + Math.cos(t * 2.3) * 0.08;
        targetStar1Rot = Math.sin(t * 3.2) * 14;
        targetStar2Rot = Math.cos(t * 3.4) * 14;
      }

      // If user is actively dragging the mascot, apply elastic jelly stretch along the pull vector!
      if (p.isDragging) {
        const pullMag = Math.min(Math.hypot(p.dragOffsetX, p.dragOffsetY), 90);
        const stretchFactor = (pullMag / 90) * 0.28 * bounce;
        if ( Math.abs(p.dragOffsetY) > Math.abs(p.dragOffsetX) ) {
          targetScaleY += stretchFactor;
          targetScaleX -= stretchFactor * 0.65;
        } else {
          targetScaleX += stretchFactor;
          targetScaleY -= stretchFactor * 0.65;
        }
        targetEyeHappy = 0.85;
        targetMouthOpen = 0.75;
      }

      // Feed all targets into the spring bank
      s.rootX.target = targetRootX;
      s.rootY.target = targetRootY;
      s.scaleX.target = targetScaleX;
      s.scaleY.target = targetScaleY;

      s.headX.target = targetHeadX;
      s.headY.target = targetHeadY;
      s.headTilt.target = targetHeadTilt;

      s.hoodX.target = targetHoodX;
      s.hoodY.target = targetHoodY;
      s.hoodRot.target = targetHoodRot;
      s.hoodScale.target = targetHoodScale;

      s.lookX.target = targetLookX;
      s.lookY.target = targetLookY;
      s.eyeScaleY.target = targetEyeScaleY;
      s.eyeHappyMix.target = targetEyeHappy;
      s.eyeFocusMix.target = targetEyeFocus;
      s.blushScale.target = targetBlushScale;
      s.blushOpacity.target = targetBlushOpacity;
      s.mouthOpen.target = targetMouthOpen;
      s.mouthWidth.target = targetMouthWidth;

      s.leftPawX.target = targetLeftPawX;
      s.leftPawY.target = targetLeftPawY;
      s.leftPawRot.target = targetLeftPawRot;
      s.leftPawScale.target = targetLeftPawScale;

      s.rightPawX.target = targetRightPawX;
      s.rightPawY.target = targetRightPawY;
      s.rightPawRot.target = targetRightPawRot;
      s.rightPawOpacity.target = targetRightPawOpacity;

      s.ribbonBreath.target = targetRibbonBreath;
      s.ribbonSpread.target = targetRibbonSpread;
      s.ribbonWaveX.target = targetRibbonWaveX;
      s.ribbonWaveY.target = targetRibbonWaveY;
      s.ribbonTilt.target = targetRibbonTilt;

      s.star1X.target = targetStar1X;
      s.star1Y.target = targetStar1Y;
      s.star1Scale.target = targetStar1Scale;
      s.star1Rot.target = targetStar1Rot;

      s.star2X.target = targetStar2X;
      s.star2Y.target = targetStar2Y;
      s.star2Scale.target = targetStar2Scale;
      s.star2Rot.target = targetStar2Rot;

      // Secondary whip spring for the cute cowlick tuft on top of the head:
      // Driven by head velocity and root vertical velocity so it lags & whips!
      s.cowlickWhip.target =
        -s.headTilt.vel * 0.25 - s.rootY.vel * 0.14 + Math.sin(t * 3.4) * 4.5;
      if (state === 'error') {
        // 蔫耷拉的呆毛：整体下垂 + 随头部摇晃轻微拖曳
        s.cowlickWhip.target += 26 + Math.sin(t * 5.4) * 5;
      }

      if (staticPose) {
        // Render a representative pose for the current state without a running loop.
        for (const channel of Object.values(s)) {
          channel.val = channel.target;
          channel.vel = 0;
        }
        particlesRef.current = [];
        setFrameTick((frame) => frame + 1);
        return;
      }

      // Integrate all spring channels
      stepSpring(s.rootX, dt, k, c);
      stepSpring(s.rootY, dt, k, c);
      stepSpring(s.scaleX, dt, k * 1.15, c * 0.82); // Extra Q-elasticity on squash & stretch!
      stepSpring(s.scaleY, dt, k * 1.15, c * 0.82);

      stepSpring(s.headX, dt, k * 0.95, c * 0.9);
      stepSpring(s.headY, dt, k * 0.95, c * 0.9);
      stepSpring(s.headTilt, dt, k * 0.85, c * 0.85);
      stepSpring(s.cowlickWhip, dt, k * 0.65, c * 0.55); // Soft whippy tuft

      stepSpring(s.hoodX, dt, k * 0.6, c * 0.75); // Delayed follow-through on coral hood
      stepSpring(s.hoodY, dt, k * 0.6, c * 0.75);
      stepSpring(s.hoodRot, dt, k * 0.6, c * 0.75);
      stepSpring(s.hoodScale, dt, k * 0.7, c * 0.8);

      stepSpring(s.lookX, dt, k * 1.4, c * 1.1);
      stepSpring(s.lookY, dt, k * 1.4, c * 1.1);
      stepSpring(s.eyeScaleY, dt, k * 2.2, c * 1.3);
      stepSpring(s.eyeHappyMix, dt, k * 1.2, c);
      stepSpring(s.eyeFocusMix, dt, k * 1.2, c);
      stepSpring(s.blushScale, dt, k, c);
      stepSpring(s.blushOpacity, dt, k, c);
      stepSpring(s.mouthOpen, dt, k * 1.5, c * 1.05);
      stepSpring(s.mouthWidth, dt, k * 1.3, c);

      stepSpring(s.leftPawX, dt, k * 1.05, c * 0.88);
      stepSpring(s.leftPawY, dt, k * 1.05, c * 0.88);
      stepSpring(s.leftPawRot, dt, k * 0.95, c * 0.88);
      stepSpring(s.leftPawScale, dt, k, c);

      stepSpring(s.rightPawX, dt, k * 1.05, c * 0.88);
      stepSpring(s.rightPawY, dt, k * 1.05, c * 0.88);
      stepSpring(s.rightPawRot, dt, k * 0.95, c * 0.88);
      stepSpring(s.rightPawOpacity, dt, k * 1.1, c);

      stepSpring(s.ribbonBreath, dt, k * 0.75, c * 0.8);
      stepSpring(s.ribbonSpread, dt, k * 0.75, c * 0.8);
      stepSpring(s.ribbonWaveX, dt, k * 0.7, c * 0.75);
      stepSpring(s.ribbonWaveY, dt, k * 0.7, c * 0.75);
      stepSpring(s.ribbonTilt, dt, k * 0.75, c * 0.85);

      stepSpring(s.star1X, dt, k * 0.85, c * 0.9);
      stepSpring(s.star1Y, dt, k * 0.85, c * 0.9);
      stepSpring(s.star1Scale, dt, k, c);
      stepSpring(s.star1Rot, dt, k * 0.8, c * 0.9);

      stepSpring(s.star2X, dt, k * 0.85, c * 0.9);
      stepSpring(s.star2Y, dt, k * 0.85, c * 0.9);
      stepSpring(s.star2Scale, dt, k, c);
      stepSpring(s.star2Rot, dt, k * 0.8, c * 0.9);

      // Smoothly blend prop layers
      const propK = k * 0.85;
      const propC = c * 0.95;
      stepSpring(s.mixThinking, dt, propK, propC);
      stepSpring(s.mixSearching, dt, propK, propC);
      stepSpring(s.mixOrchestrating, dt, propK, propC);
      stepSpring(s.mixCoding, dt, propK, propC);
      stepSpring(s.mixReplying, dt, propK, propC);
      stepSpring(s.mixCompleted, dt, propK, propC);
      stepSpring(s.mixError, dt, propK, propC);

      // Update interactive particles
      if (particlesRef.current.length > 0) {
        particlesRef.current.forEach((pt) => {
          pt.x += pt.vx * rawDt;
          pt.y += pt.vy * rawDt;
          pt.vy -= 28 * rawDt; // Slight buoyant float upward
          pt.life += rawDt;
        });
        particlesRef.current = particlesRef.current.filter((pt) => pt.life < pt.maxLife);
      }

      // Render throttle: only trigger a React re-render when the frame budget allows.
      // Physics above already integrated with real dt, so motion stays buttery even at 30fps render.
      const frameInterval = 1000 / effectiveMaxFps;
      if (now - lastRender >= frameInterval - 0.5) {
        lastRender = now;
        setFrameTick((prev) => (prev + 1) % 1000000);
      }
    };

    const io = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver((entries) => {
      inView = entries.some((entry) => entry.isIntersecting);
      evaluateAlive();
    }, { threshold: 0.05 });
    if (svgRef.current) io?.observe(svgRef.current);
    document.addEventListener('visibilitychange', evaluateAlive);
    if (staticPose) animate(performance.now());
    else evaluateAlive();
    return () => {
      alive = false;
      cancelAnimationFrame(rafId);
      io?.disconnect();
      document.removeEventListener('visibilitychange', evaluateAlive);
    };
  }, [state, physics, paused, effectiveMaxFps, staticPose]);

  // Pointer interaction handlers
  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!interactive || staticPose || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const normX = Math.max(-1, Math.min(1, (e.clientX - cx) / (rect.width / 2)));
    const normY = Math.max(-1, Math.min(1, (e.clientY - cy) / (rect.height / 2)));

    const p = pointerRef.current;
    p.normX = normX;
    p.normY = normY;
    p.isHovering = true;

    if (p.isDragging) {
      const scaleRatio = 400 / Math.max(rect.width, 1);
      p.dragOffsetX = Math.max(-55, Math.min(55, (e.clientX - p.dragStartX) * scaleRatio * 0.55));
      p.dragOffsetY = Math.max(-55, Math.min(55, (e.clientY - p.dragStartY) * scaleRatio * 0.55));
    }
  };

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!interactive || staticPose) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = pointerRef.current;
    p.isDragging = true;
    p.dragStartX = e.clientX;
    p.dragStartY = e.clientY;
    p.dragOffsetX = 0;
    p.dragOffsetY = 0;

    // Immediate jelly compression on press
    const s = springsRef.current;
    const bounce = physics.bounciness;
    s.scaleX.vel += 3.2 * bounce;
    s.scaleY.vel -= 3.0 * bounce;
    s.rootY.vel += 90 * bounce;
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!interactive || staticPose) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    const p = pointerRef.current;
    const dragDist = Math.hypot(p.dragOffsetX, p.dragOffsetY);
    p.isDragging = false;
    p.dragOffsetX = 0;
    p.dragOffsetY = 0;

    // Elastic snap-back impulse + poke celebration!
    const s = springsRef.current;
    const bounce = physics.bounciness;
    p.pokeFlash = 1.0;
    s.scaleX.vel -= 3.6 * bounce;
    s.scaleY.vel += 3.8 * bounce;
    s.rootY.vel -= (140 + dragDist * 2.5) * bounce;
    s.cowlickWhip.vel += 260 * bounce;
    s.ribbonSpread.vel += 2.4 * bounce;

    spawnParticles(7, dragDist > 18 ? 'star' : 'heart', 200, 165);
    if (onPoke) onPoke();
  };

  const handlePointerLeave = () => {
    const p = pointerRef.current;
    p.isHovering = false;
    if (p.isDragging) {
      p.isDragging = false;
      p.dragOffsetX = 0;
      p.dragOffsetY = 0;
    }
  };

  // Read current spring values for SVG path construction
  const s = springsRef.current;
  const t = timeRef.current;
  // SVG filters (feDropShadow) are expensive under software rendering (GeckoView / weak GPUs).
  // In low-power mode we skip them entirely — the shapes still read fine without shadows.
  const softShadow = lowPerf ? undefined : `url(#${id}-mochiSoftShadow)`;

  // Dynamic Bezier offsets for the 5 Purple Mobius Petals
  const sp = s.ribbonSpread.val * 14;
  const br = s.ribbonBreath.val;
  const wx = s.ribbonWaveX.val;
  const wy = s.ribbonWaveY.val;

  // Dynamic Mochi Head Path with Whipping Cowlick Tuft (呆毛)
  const whip = s.cowlickWhip.val;
  const mochiHeadPath = `
    M 138 225
    C 134 190, 140 156, ${156 + whip * 0.35} ${134 - whip * 0.2}
    C ${164 + whip * 0.55} ${122 - whip * 0.35}, ${175 + whip * 0.8} ${115 - whip * 0.45}, ${184 + whip * 0.95} ${114 - whip * 0.4}
    C ${182 + whip * 0.45} ${125 - whip * 0.2}, ${179 + whip * 0.25} 135, 188 136
    C 214 132, 248 136, 270 158
    C 288 176, 294 205, 282 238
    C 265 262, 152 260, 138 225
    Z
  `;

  // Dynamic Coral Hood / Aura Petal Path (#FA9E8E)
  const coralHoodPath = `
    M 129 196
    C 122 128, 174 60, ${238 + wx * 0.5} ${60 + wy * 0.4}
    C 284 60, 304 96, ${293 - wx * 0.3} 148
    C 288 172, 278 192, 266 204
    C 225 212, 155 210, 129 196
    Z
  `;

  // 1. Left Wing Petal (#B4A4F6)
  const leftPetalPath = `
    M 152 195
    C ${122 - sp * 0.7} ${166 - sp * 0.6 + wy}, ${68 - sp} ${152 - sp * 0.5 - wy}, ${48 - sp * 0.9} ${184 + wy}
    C ${32 - sp * 0.7} ${212 + br}, ${48 - sp * 0.5} ${252 + br}, 90 274
    C 122 288, 155 256, 152 195
    Z
  `;

  // 2. Far Right Wing Petal (#836AE0)
  const farRightPetalPath = `
    M 272 180
    C ${306 + sp * 0.7} ${156 - sp * 0.5 - wy}, ${360 + sp} ${146 - sp * 0.4 + wy}, ${374 + sp * 0.9} ${176 - wy}
    C ${385 + sp * 0.6} ${204 + br}, ${360 + sp * 0.4} ${238 + br}, 324 254
    C 295 266, 270 232, 272 180
    Z
  `;

  // 3. Inner Right Lilac Petal (#DACAFD)
  const innerRightPetalPath = `
    M 222 232
    C 242 196, ${292 + sp * 0.5} ${170 - sp * 0.3 + wy * 0.6}, ${328 + sp * 0.5} ${184 + wy * 0.5}
    C ${352 + sp * 0.4} ${196 + br * 0.6}, ${344 + sp * 0.3} ${252 + br}, 304 292
    C 276 312, 218 272, 222 232
    Z
  `;

  // 4. Left Dark Violet Under-Fold (#634FB8)
  const leftUnderFoldPath = `
    M ${82 - sp * 0.4} ${245 + wy * 0.5}
    C ${54 - sp * 0.5} ${256 + wy}, ${35 - sp * 0.5} ${276 + br * 0.5}, ${40 - sp * 0.4} ${296 + br * 0.5}
    C ${46 - sp * 0.3} 308, 78 302, 102 282
    Z
  `;

  // 5. Lower Belly Lilac Under-Fold (#D9C8FC)
  const lowerBellyFoldPath = `
    M 148 ${288 + br * 0.5}
    C 178 ${320 + br * 1.1 + sp * 0.4}, 222 ${344 + br * 1.2 + sp * 0.5}, 264 ${334 + br * 0.9}
    C 292 ${327 + br * 0.6}, 308 ${312 + wy * 0.5}, 307 ${296 + wy * 0.5}
    C 278 270, 195 268, 148 ${288 + br * 0.5}
    Z
  `;

  // 6. Front Sweeping Violet Ribbon (#8871E3)
  const frontSweepingRibbonPath = `
    M ${40 - sp * 0.4} ${295 + br * 0.5}
    C ${68 - sp * 0.2} ${254 + wy * 0.6}, 126 ${222 - br * 0.5}, 182 ${223 - br * 0.5 + wx * 0.4}
    C 242 ${224 + wy * 0.5}, 296 ${252 + br * 0.5}, 308 ${296 + wy * 0.5}
    C 309 306, 302 310, 294 302
    C 266 ${276 + br * 0.4}, 216 ${272 - br * 0.3}, 162 ${288 + br * 0.4}
    C 112 ${303 + br * 0.6}, ${56 - sp * 0.3} ${312 + br * 0.5}, ${40 - sp * 0.4} ${295 + br * 0.5}
    Z
  `;

  // Cute Little White Paw Path (Centered around 0,0 so we can translate/rotate easily)
  // Matches the plump 3-lobed paw gripping the ribbon in the icon!
  const pawLocalPath = `
    M -20 4
    C -22 -8, -10 -16, 4 -15
    C 16 -14, 23 -6, 21 3
    C 20 8, 15 11, 10 9
    C 8 13, 1 14, -3 10
    C -8 14, -18 12, -20 4
    Z
  `;

  // Determine 3D Z-ordering for Star 1 & Star 2 (when orbiting in 'thinking' state, stars pass behind head when sin < 0)
  const star1InBack = state === 'thinking' && Math.sin(t * 2.6) < 0;
  const star2InBack = state === 'thinking' && Math.sin(t * 2.6 + Math.PI) < 0;

  const renderSparkle = (
    cx: number,
    cy: number,
    baseOuter: number,
    baseInner: number,
    scale: number,
    rot: number,
    key: string
  ) => {
    const outer = baseOuter * Math.max(0.2, scale);
    const inner = baseInner * Math.max(0.2, scale);
    return (
      <g key={key}>
        {/* Soft warm glow behind star */}
        <circle
          cx={cx}
          cy={cy}
          r={outer * 0.85}
          fill="#FDCB58"
          opacity={0.22 * Math.min(1, scale)}
        />
        <path
          d={buildSparklePath(cx, cy, outer, inner, rot)}
          fill={`url(#${id}-mochiStarGrad)`}
        />
      </g>
    );
  };

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 400 400"
      width={size}
      height={size}
      onPointerMove={handlePointerMove}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      onPointerCancel={handlePointerLeave}
      onLostPointerCapture={handlePointerLeave}
      className={`select-none ${
        interactive && !staticPose ? 'cursor-grab active:cursor-grabbing' : ''
      } ${className}`}
      style={{ overflow: 'visible', touchAction: 'pan-y' }}
      role="img"
      aria-label={`AI Agent 吉祥物 - 当前状态: ${state}`}
    >
      <defs>
        {/* Squircle Icon Background Gradient */}
        <linearGradient id={`${id}-mochiBgGrad`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFFDF9" />
          <stop offset="55%" stopColor="#FDF8F3" />
          <stop offset="100%" stopColor="#F6EFE8" />
        </linearGradient>

        {/* Coral Hood Gradient (#FA9E8E) */}
        <linearGradient id={`${id}-mochiCoralGrad`} x1="15%" y1="5%" x2="85%" y2="95%">
          <stop offset="0%" stopColor="#FCAE9F" />
          <stop offset="60%" stopColor="#FA9E8E" />
          <stop offset="100%" stopColor="#F38D7B" />
        </linearGradient>

        {/* Warm Mochi White Body Gradient (#FCF9F4) */}
        <radialGradient id={`${id}-mochiBodyGrad`} cx="42%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="68%" stopColor="#FCF9F4" />
          <stop offset="100%" stopColor="#F3EDE4" />
        </radialGradient>

        {/* Left Wing Petal Gradient (#B4A4F6) */}
        <linearGradient id={`${id}-mochiLeftPetalGrad`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#BEB0FA" />
          <stop offset="100%" stopColor="#A997F0" />
        </linearGradient>

        {/* Far Right Wing Petal Gradient (#836AE0) */}
        <linearGradient id={`${id}-mochiFarRightPetalGrad`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#8E75E8" />
          <stop offset="100%" stopColor="#7A60D8" />
        </linearGradient>

        {/* Inner Right Lilac Petal Gradient (#DACAFD) */}
        <linearGradient id={`${id}-mochiInnerRightPetalGrad`} x1="10%" y1="0%" x2="90%" y2="100%">
          <stop offset="0%" stopColor="#E3D6FF" />
          <stop offset="100%" stopColor="#D3C1FA" />
        </linearGradient>

        {/* Front Sweeping Ribbon Gradient (#8871E3) */}
        <linearGradient id={`${id}-mochiFrontRibbonGrad`} x1="0%" y1="30%" x2="100%" y2="70%">
          <stop offset="0%" stopColor="#7D65DC" />
          <stop offset="48%" stopColor="#8D77E7" />
          <stop offset="100%" stopColor="#8069DE" />
        </linearGradient>

        {/* Sparkle Star Gradient (#FDCB58) */}
        <linearGradient id={`${id}-mochiStarGrad`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFE082" />
          <stop offset="60%" stopColor="#FDCB58" />
          <stop offset="100%" stopColor="#F7B93E" />
        </linearGradient>

        {/* Soft Drop Shadow for Paws & Floating Props */}
        <filter id={`${id}-mochiSoftShadow`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="4" stdDeviation="4" floodColor="#3A2878" floodOpacity="0.14" />
        </filter>

        <filter id={`${id}-mochiStageGlow`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="18" result="blur" />
        </filter>
      </defs>

      {/* Optional Rounded App-Icon Squircle Frame (matches reference image border) */}
      {showSquircleBg && (
        <rect
          x="12"
          y="12"
          width="376"
          height="376"
          rx="96"
          ry="96"
          fill={`url(#${id}-mochiBgGrad)`}
          stroke="#EFE8E0"
          strokeWidth="2"
        />
      )}

      {/* Ambient Ground Shadow / Aura that breathes with mascot height */}
      <ellipse
        cx={205 + s.rootX.val * 0.4}
        cy={352}
        rx={Math.max(45, 92 - s.rootY.val * 0.55 + s.ribbonSpread.val * 12)}
        ry={Math.max(8, 15 - s.rootY.val * 0.12)}
        fill="#6E56CF"
        opacity={0.11}
      />

      {/* ================================================================= */}
      {/* BACKGROUND STATE AMBIENCE (Radar Rings / Brainwave Halo / Rays)   */}
      {/* ================================================================= */}

      {/* Searching Radar Ripples */}
      {!lowPerf && !compactMode && s.mixSearching.val > 0.02 && (
        <g opacity={s.mixSearching.val}>
          {[0, 1, 2].map((idx) => {
            const phase = ((t * 0.75 + idx * 0.33) % 1);
            const r = 70 + phase * 125;
            return (
              <circle
                key={`radar-${idx}`}
                cx={205 + s.rootX.val * 0.5}
                cy={195 + s.rootY.val * 0.5}
                r={r}
                fill="none"
                stroke="#8871E3"
                strokeWidth={2.5 * (1 - phase)}
                strokeDasharray="10 8"
                opacity={(1 - phase) * 0.45}
              />
            );
          })}
        </g>
      )}

      {/* Replying Harmonic Soundwave Rings */}
      {!lowPerf && !compactMode && s.mixReplying.val > 0.02 && (
        <g opacity={s.mixReplying.val}>
          {[0, 1].map((idx) => {
            const phase = ((t * 0.9 + idx * 0.5) % 1);
            return (
              <circle
                key={`wave-${idx}`}
                cx={205 + s.rootX.val}
                cy={185 + s.rootY.val}
                r={85 + phase * 105}
                fill="none"
                stroke="#FA9E8E"
                strokeWidth={3 * (1 - phase)}
                opacity={(1 - phase) * 0.45}
              />
            );
          })}
        </g>
      )}

      {/* Error Alarm Halo (MD3 error palette) */}
      {!lowPerf && !compactMode && s.mixError.val > 0.02 && (
        <g opacity={s.mixError.val}>
          {/* Soft pulsing error glow behind the mascot */}
          <circle
            cx={205 + s.rootX.val * 0.6}
            cy={188 + s.rootY.val * 0.6}
            r={96 + Math.sin(t * 6.4) * 5}
            fill="#F9DEDC"
            opacity={0.34 + Math.sin(t * 6.4) * 0.1}
          />
          {/* Rotating dashed alarm ring */}
          <circle
            cx={205 + s.rootX.val * 0.6}
            cy={188 + s.rootY.val * 0.6}
            r={118 + Math.sin(t * 3.2) * 4}
            fill="none"
            stroke="#BA1A1A"
            strokeWidth={3.4}
            strokeDasharray="16 12"
            strokeLinecap="round"
            opacity={0.55}
            transform={`rotate(${t * 55} ${205 + s.rootX.val * 0.6} ${188 + s.rootY.val * 0.6})`}
          />
        </g>
      )}

      {/* Completed Celebration Sunburst Halo */}
      {!lowPerf && !compactMode && s.mixCompleted.val > 0.02 && (
        <g
          opacity={s.mixCompleted.val * 0.65}
          transform={`translate(${205 + s.rootX.val}, ${185 + s.rootY.val}) rotate(${t * 25})`}
        >
          {Array.from({ length: 12 }).map((_, idx) => {
            const deg = idx * 30;
            return (
              <line
                key={`ray-${idx}`}
                x1="0"
                y1="-118"
                x2="0"
                y2={-136 - Math.sin(t * 6 + idx) * 8}
                stroke={idx % 2 === 0 ? '#FDCB58' : '#FA9E8E'}
                strokeWidth="4.5"
                strokeLinecap="round"
                transform={`rotate(${deg})`}
              />
            );
          })}
        </g>
      )}

      {/* ================================================================= */}
      {/* MAIN RIGGED MASCOT GROUP (With Root Squash, Stretch & Translation)*/}
      {/* ================================================================= */}
      <g
        transform={`
          translate(${205 + s.rootX.val}, ${235 + s.rootY.val})
          scale(${s.scaleX.val}, ${s.scaleY.val})
          rotate(${s.ribbonTilt.val})
          translate(-205, -235)
        `}
      >
        {/* Orbiting Stars when passing BEHIND the mascot's head */}
        {star1InBack &&
          renderSparkle(s.star1X.val, s.star1Y.val, 33, 10, s.star1Scale.val, s.star1Rot.val, 'star1-back')}
        {star2InBack &&
          renderSparkle(s.star2X.val, s.star2Y.val, 18.5, 5.8, s.star2Scale.val, s.star2Rot.val, 'star2-back')}

        {/* LAYER 1: Back Coral Hood / Aura Petal (#FA9E8E) */}
        <g
          transform={`
            translate(${212 + s.hoodX.val}, ${145 + s.hoodY.val})
            rotate(${s.hoodRot.val})
            scale(${s.hoodScale.val})
            translate(-212, -145)
          `}
        >
          <path d={coralHoodPath} fill={`url(#${id}-mochiCoralGrad)`} />
          {/* Subtle inner highlight arc on coral hood */}
          <path
            d="M 152 136 C 176 86, 218 70, 256 76"
            fill="none"
            stroke="#FFFDF9"
            strokeWidth="3.5"
            strokeLinecap="round"
            opacity="0.32"
          />
        </g>

        {/* LAYER 2: Left Wing Petal (#B4A4F6) & Far Right Wing Petal (#836AE0) */}
        <path d={leftPetalPath} fill={`url(#${id}-mochiLeftPetalGrad)`} />
        <path d={farRightPetalPath} fill={`url(#${id}-mochiFarRightPetalGrad)`} />

        {/* LAYER 3: White Mochi Sprite Head, Cowlick Tuft & Face (#FCF9F4) */}
        <g
          transform={`
            translate(${210 + s.headX.val}, ${195 + s.headY.val})
            rotate(${s.headTilt.val + 14.5})
            translate(-210, -195)
          `}
        >
          {/* Main Mochi Body & Curved Tuft */}
          <path d={mochiHeadPath} fill={`url(#${id}-mochiBodyGrad)`} />

          {/* Facial Expression Group (Aligned to the icon's -15 deg natural tilt) */}
          <g
            transform={`
              translate(${206 + s.lookX.val}, ${184 + s.lookY.val})
              rotate(-15)
            `}
          >
            {/* Left Blush Pill (#F5ACA0) */}
            <rect
              x={-48 - (s.blushScale.val - 1) * 4}
              y={5}
              width={18.5 * s.blushScale.val}
              height={8.2 * s.blushScale.val}
              rx={4.1 * s.blushScale.val}
              fill="#F5ACA0"
              opacity={s.blushOpacity.val}
            />

            {/* Right Blush Pill (#F5ACA0) */}
            <rect
              x={31 - (s.blushScale.val - 1) * 4}
              y={5}
              width={18.5 * s.blushScale.val}
              height={8.2 * s.blushScale.val}
              rx={4.1 * s.blushScale.val}
              fill="#F5ACA0"
              opacity={s.blushOpacity.val}
            />

            {/* Left & Right Eyes (#2B2742) */}
            {s.mixError.val > 0.5 ? (
              /* Dizzy swirl eyes — rendered for error / self-heal state */
              <g
                stroke="#2B2742"
                strokeWidth={2.8}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d={buildSpiralPath(-21, -2, 7.3, 2.15, t * 2.3)} />
                <path d={buildSpiralPath(21, -2, 7.3, 2.15, -t * 2.3 + 0.7)} />
              </g>
            ) : s.eyeHappyMix.val > 0.55 ? (
              /* Happy Curved Crescent Eyes (^ ^) for Completed / Poked / Joyful states */
              <g>
                <path
                  d="M -29 -1 Q -21 -14 -13 -1"
                  fill="none"
                  stroke="#2B2742"
                  strokeWidth="5.2"
                  strokeLinecap="round"
                />
                <path
                  d="M 13 -1 Q 21 -14 29 -1"
                  fill="none"
                  stroke="#2B2742"
                  strokeWidth="5.2"
                  strokeLinecap="round"
                />
              </g>
            ) : (
              /* Iconic Vertical Oval Capsule Eyes with Blink & Focus Squint */
              <g>
                {/* Left Eye */}
                <g transform={`translate(-21, -2) scale(1, ${s.eyeScaleY.val * (1 - s.eyeFocusMix.val * 0.22)})`}>
                  <rect
                    x="-7.6"
                    y="-13.8"
                    width="15.2"
                    height="27.6"
                    rx="7.6"
                    fill="#2B2742"
                  />
                  {/* Subtle lively eye catchlight */}
                  {s.eyeFocusMix.val > 0.2 && (
                    <circle cx="-2.2" cy="-5.5" r="2.6" fill="#FFFDF9" opacity={0.85} />
                  )}
                </g>

                {/* Right Eye */}
                <g transform={`translate(21, -2) scale(1, ${s.eyeScaleY.val * (1 - s.eyeFocusMix.val * 0.22)})`}>
                  <rect
                    x="-7.6"
                    y="-13.8"
                    width="15.2"
                    height="27.6"
                    rx="7.6"
                    fill="#2B2742"
                  />
                  {s.eyeFocusMix.val > 0.2 && (
                    <circle cx="-2.2" cy="-5.5" r="2.6" fill="#FFFDF9" opacity={0.85} />
                  )}
                </g>
              </g>
            )}

            {/* Expressive Cute Mouth (Hidden in pure Idle icon pose, appears smoothly when speaking/thinking/cheering) */}
            {s.mouthOpen.val > 0.08 && (
              <g transform="translate(0, 12)" opacity={Math.min(1, s.mouthOpen.val * 1.6)}>
                {state === 'error' ? (
                  /* Worried wavy squiggle mouth */
                  <path
                    d="M -11 3 Q -5.5 -2.8 0 3 Q 5.5 8.8 11 3"
                    fill="none"
                    stroke="#2B2742"
                    strokeWidth={2.7}
                    strokeLinecap="round"
                  />
                ) : state === 'thinking' ? (
                  /* Cute tiny contemplative 'o' mouth */
                  <ellipse
                    cx="2"
                    cy="2"
                    rx={3.5}
                    ry={3.8 * s.mouthOpen.val}
                    fill="#2B2742"
                  />
                ) : (
                  /* Happy speaking / cheering D-shaped mouth with coral tongue */
                  <g>
                    <path
                      d={`
                        M ${-s.mouthWidth.val * 0.5} -1
                        Q 0 ${13 * s.mouthOpen.val} ${s.mouthWidth.val * 0.5} -1
                        Z
                      `}
                      fill="#2B2742"
                    />
                    <path
                      d={`
                        M ${-s.mouthWidth.val * 0.32} ${2.5 * s.mouthOpen.val}
                        Q 0 ${11 * s.mouthOpen.val} ${s.mouthWidth.val * 0.32} ${2.5 * s.mouthOpen.val}
                        Z
                      `}
                      fill="#FA9E8E"
                    />
                  </g>
                )}
              </g>
            )}
          </g>
        </g>

        {/* LAYER 4: Inner Right Lilac Petal (#DACAFD) overlapping lower-right of head */}
        <path d={innerRightPetalPath} fill={`url(#${id}-mochiInnerRightPetalGrad)`} />

        {/* LAYER 5: Left Under-Fold (#634FB8) & Lower Belly Lilac Fold (#D9C8FC) */}
        <path d={leftUnderFoldPath} fill="#634FB8" />
        <path d={lowerBellyFoldPath} fill="#D9C8FC" />

        {/* LAYER 6: Front Sweeping Violet Ribbon (#8871E3) */}
        <path d={frontSweepingRibbonPath} fill={`url(#${id}-mochiFrontRibbonGrad)`} />
        {/* Subtle silk highlight along the crest of the front sweeping ribbon */}
        <path
          d={`M 95 ${252 + wy * 0.4} C 145 ${226 - br * 0.4}, 212 ${226 + wy * 0.4}, 268 ${258 + br * 0.4}`}
          fill="none"
          stroke="#B4A4F6"
          strokeWidth="2.5"
          strokeLinecap="round"
          opacity="0.45"
        />

        {/* =============================================================== */}
        {/* LAYER 7: HOLOGRAPHIC MD3 PROPS (Smoothly blended per state)     */}
        {/* =============================================================== */}

        {/* Coding / Tool Calling: Holographic Terminal Bar on top of front ribbon */}
        {s.mixCoding.val > 0.02 && (
          <g
            opacity={s.mixCoding.val}
            transform={`translate(195, ${234 + Math.sin(t * 9) * 2}) scale(${0.8 + s.mixCoding.val * 0.2})`}
          >
            <rect
              x="-66"
              y="-12"
              width="132"
              height="24"
              rx="12"
              fill="#21005D"
              fillOpacity="0.82"
              stroke="#FDCB58"
              strokeWidth="2"
            />
            {/* Glowing key caps lighting up with bongo taps */}
            {[-42, -21, 0, 21, 42].map((kx, idx) => {
              const active = Math.sin(t * 18 + idx * 1.4) > 0.2;
              return (
                <rect
                  key={`key-${idx}`}
                  x={kx - 7}
                  y="-5"
                  width="14"
                  height="10"
                  rx="3.5"
                  fill={active ? '#FDCB58' : '#B4A4F6'}
                  opacity={active ? 0.95 : 0.45}
                />
              );
            })}
            {/* Floating code glyph sparks rising above the ribbon (large sizes only) */}
            {!compactMode && [-38, 0, 38].map((sx, idx) => {
              const rise = ((t * 1.8 + idx * 0.35) % 1);
              return (
                <text
                  key={`code-glyph-${idx}`}
                  x={sx + Math.sin(t * 5 + idx) * 6}
                  y={-18 - rise * 42}
                  textAnchor="middle"
                  fill={idx === 1 ? '#FDCB58' : '#6E56CF'}
                  fontSize="12"
                  fontWeight="700"
                  fontFamily="JetBrains Mono, monospace"
                  opacity={(1 - rise) * 0.9}
                >
                  {idx === 0 ? '{ }' : idx === 1 ? '⚡' : '</>'}
                </text>
              );
            })}
          </g>
        )}

        {/* LAYER 8: Cute White Paws (Left Paw & Dynamic Right Paw) */}
        {/* Left Paw (Always visible, matches icon in Idle!) */}
        <g
          filter={softShadow}
          transform={`
            translate(${s.leftPawX.val}, ${s.leftPawY.val})
            rotate(${s.leftPawRot.val})
            scale(${s.leftPawScale.val})
          `}
        >
          <path d={pawLocalPath} fill="#FCF9F4" />
        </g>

        {/* Right Paw (Smoothly emerges during Thinking, Searching, Orchestrating, Coding, Replying, Completed) */}
        {s.rightPawOpacity.val > 0.02 && (
          <g
            filter={softShadow}
            opacity={Math.min(1, s.rightPawOpacity.val)}
            transform={`
              translate(${s.rightPawX.val}, ${s.rightPawY.val})
              rotate(${s.rightPawRot.val})
              scale(${-0.95 * Math.min(1, 0.5 + s.rightPawOpacity.val * 0.5)}, ${
              0.95 * Math.min(1, 0.5 + s.rightPawOpacity.val * 0.5)
            })
            `}
          >
            <path d={pawLocalPath} fill="#FCF9F4" />
          </g>
        )}

        {/* Searching Prop: MD3 Translucent Magnifying Glass held by Right Paw */}
        {s.mixSearching.val > 0.02 && (
          <g
            opacity={s.mixSearching.val}
            transform={`
              translate(${s.rightPawX.val + 14}, ${s.rightPawY.val - 22})
              rotate(${s.rightPawRot.val * 0.7})
              scale(${0.65 + s.mixSearching.val * 0.35})
            `}
          >
            {/* Handle */}
            <line
              x1="-12"
              y1="16"
              x2="-2"
              y2="4"
              stroke="#6E56CF"
              strokeWidth="7"
              strokeLinecap="round"
            />
            {/* Lens Glass */}
            <circle
              cx="14"
              cy="-12"
              r="24"
              fill="#E8DEF8"
              fillOpacity="0.52"
              stroke="#6E56CF"
              strokeWidth="5.5"
            />
            {/* Specular Glass Glint */}
            <path
              d="M 2 -24 A 16 16 0 0 1 24 -22"
              fill="none"
              stroke="#FFFDF9"
              strokeWidth="3.5"
              strokeLinecap="round"
            />
          </g>
        )}

        {/* Thinking Prop: Floating MD3 Thought Bubbles rising from head */}
        {s.mixThinking.val > 0.02 && !compactMode && (
          <g opacity={s.mixThinking.val}>
            <circle
              cx={145 + Math.sin(t * 3) * 3}
              cy={132 + Math.cos(t * 3) * 3}
              r="5.5"
              fill="#FFFDF9"
              stroke="#FA9E8E"
              strokeWidth="2.5"
            />
            <circle
              cx={128 + Math.cos(t * 3) * 4}
              cy={112 + Math.sin(t * 3) * 4}
              r="8.5"
              fill="#FFFDF9"
              stroke="#FA9E8E"
              strokeWidth="2.5"
            />
            <g transform={`translate(${102 + Math.sin(t * 2.2) * 5}, ${82 + Math.cos(t * 2.2) * 5})`}>
              <rect
                x="-28"
                y="-16"
                width="56"
                height="32"
                rx="16"
                fill="#FFFDF9"
                stroke="#FA9E8E"
                strokeWidth="2.5"
                filter={softShadow}
              />
              {/* Animated thinking dots inside cloud */}
              {[-11, 0, 11].map((dx, i) => (
                <circle
                  key={`tdot-${i}`}
                  cx={dx}
                  cy={Math.sin(t * 6 - i * 1.1) * 3.5}
                  r="3.2"
                  fill={i === 1 ? '#FA9E8E' : '#6E56CF'}
                />
              ))}
            </g>
          </g>
        )}

        {/* Orchestrating Prop: Floating MD3 DAG Workflow Nodes conducted by both paws */}
        {s.mixOrchestrating.val > 0.02 && !compactMode && (
          <g
            opacity={s.mixOrchestrating.val}
            transform={`translate(205, 84) scale(${0.75 + s.mixOrchestrating.val * 0.25})`}
          >
            {/* Animated Bezier Edges connecting the 3 DAG nodes */}
            <path
              d={`M -68 ${14 + Math.sin(t * 4.2) * 8} Q 0 -18 0 ${-6 + Math.cos(t * 4.2) * 7} Q 0 -18 68 ${
                14 - Math.sin(t * 4.2) * 8
              }`}
              fill="none"
              stroke="#8871E3"
              strokeWidth="3"
              strokeDasharray="6 5"
              strokeDashoffset={-t * 28}
            />
            {/* Left Node (Coral Circle) */}
            <g transform={`translate(-68, ${14 + Math.sin(t * 4.2) * 8})`}>
              <rect
                x="-15"
                y="-15"
                width="30"
                height="30"
                rx="10"
                fill="#FFDAD4"
                stroke="#FA9E8E"
                strokeWidth="3"
              />
              <circle cx="0" cy="0" r="5" fill="#E07A68" />
            </g>
            {/* Center Root Node (Violet Squircle) */}
            <g transform={`translate(0, ${-6 + Math.cos(t * 4.2) * 7})`}>
              <rect
                x="-18"
                y="-18"
                width="36"
                height="36"
                rx="12"
                fill="#E8DEF8"
                stroke="#6E56CF"
                strokeWidth="3"
              />
              <path d="M -6 0 L 0 -6 L 6 0 L 0 6 Z" fill="#6E56CF" />
            </g>
            {/* Right Node (Amber Pill) */}
            <g transform={`translate(68, ${14 - Math.sin(t * 4.2) * 8})`}>
              <rect
                x="-15"
                y="-15"
                width="30"
                height="30"
                rx="10"
                fill="#FFF0C7"
                stroke="#FDCB58"
                strokeWidth="3"
              />
              <circle cx="0" cy="0" r="5" fill="#D99B26" />
            </g>
          </g>
        )}

        {/* Replying Prop: Floating Streaming Chat Bubble Pill */}
        {s.mixReplying.val > 0.02 && !compactMode && (
          <g
            opacity={s.mixReplying.val}
            transform={`translate(${295 + Math.sin(t * 3.2) * 5}, ${95 + Math.cos(t * 3.2) * 5}) scale(${
              0.75 + s.mixReplying.val * 0.25
            })`}
          >
            <rect
              x="-36"
              y="-20"
              width="72"
              height="40"
              rx="18"
              fill="#FFFDF9"
              stroke="#8871E3"
              strokeWidth="2.5"
              filter={softShadow}
            />
            {/* Streaming text lines inside bubble */}
            <rect
              x="-22"
              y="-8"
              width={24 + Math.abs(Math.sin(t * 4)) * 20}
              height="5"
              rx="2.5"
              fill="#6E56CF"
            />
            <rect
              x="-22"
              y="3"
              width={16 + Math.abs(Math.cos(t * 5)) * 26}
              height="5"
              rx="2.5"
              fill="#FA9E8E"
            />
          </g>
        )}

        {/* Error Props: anime sweat drops + floating MD3 warning triangle */}
        {s.mixError.val > 0.02 && !compactMode && (
          <g opacity={s.mixError.val}>
            {/* Left temple sweat bead */}
            <g transform={`translate(${150 + Math.sin(t * 3.1) * 3}, ${138 + Math.cos(t * 4.2) * 2.5})`}>
              <path
                d="M 0 -10.5 C 4.6 -4.2 6.9 0.6 6.9 4.4 A 6.9 6.9 0 1 1 -6.9 4.4 C -6.9 0.6 -4.6 -4.2 0 -10.5 Z"
                fill="#8FC3F4"
                stroke="#5B9BD9"
                strokeWidth={1.6}
                strokeLinejoin="round"
              />
              <circle cx="-2" cy="3.2" r="1.5" fill="#FFFDF9" opacity="0.85" />
            </g>
            {/* Right temple sweat bead (smaller) */}
            <g transform={`translate(${263 + Math.cos(t * 3.4) * 3}, ${146 + Math.sin(t * 4.6) * 2.5}) scale(0.78)`}>
              <path
                d="M 0 -10.5 C 4.6 -4.2 6.9 0.6 6.9 4.4 A 6.9 6.9 0 1 1 -6.9 4.4 C -6.9 0.6 -4.6 -4.2 0 -10.5 Z"
                fill="#8FC3F4"
                stroke="#5B9BD9"
                strokeWidth={1.7}
                strokeLinejoin="round"
              />
              <circle cx="-2" cy="3.2" r="1.5" fill="#FFFDF9" opacity="0.85" />
            </g>

            {/* Floating warning triangle — bobs & pulses above the cowlick */}
            <g
              transform={`
                translate(${314 + Math.sin(t * 2.6) * 5}, ${66 + Math.sin(t * 5.2) * 5.5})
                rotate(${Math.sin(t * 2.6) * 7})
                scale(${1 + Math.sin(t * 6.4) * 0.09})
              `}
            >
              <path
                d="M 0 -17 L 16.5 12.5 A 4.5 4.5 0 0 1 12.6 19.5 L -12.6 19.5 A 4.5 4.5 0 0 1 -16.5 12.5 Z"
                fill="#F9DEDC"
                stroke="#BA1A1A"
                strokeWidth={3.4}
                strokeLinejoin="round"
              />
              {/* Exclamation mark */}
              <line
                x1="0"
                y1="-6.5"
                x2="0"
                y2="5.5"
                stroke="#BA1A1A"
                strokeWidth={3.6}
                strokeLinecap="round"
              />
              <circle cx="0" cy="11" r="2.1" fill="#BA1A1A" />
            </g>
          </g>
        )}

        {/* LAYER 9: Foreground Four-Pointed Sparkle Stars (#FDCB58) */}
        {!star1InBack &&
          renderSparkle(s.star1X.val, s.star1Y.val, 33, 10, s.star1Scale.val, s.star1Rot.val, 'star1-front')}
        {!star2InBack &&
          renderSparkle(s.star2X.val, s.star2Y.val, 18.5, 5.8, s.star2Scale.val, s.star2Rot.val, 'star2-front')}
      </g>

      {/* ================================================================= */}
      {/* INTERACTIVE POKE / TRANSITION PARTICLES                           */}
      {/* ================================================================= */}
      {particlesRef.current.map((pt) => {
        const progress = pt.life / pt.maxLife;
        const opacity = Math.sin(progress * Math.PI);
        const scale = 0.5 + Math.sin(progress * Math.PI) * 0.8;
        return (
          <g
            key={pt.id}
            transform={`translate(${pt.x}, ${pt.y}) scale(${scale})`}
            opacity={opacity}
          >
            {pt.type === 'heart' ? (
              <path
                d="M 0 4 C -5 -2, -10 2, 0 11 C 10 2, 5 -2, 0 4 Z"
                fill="#FA9E8E"
              />
            ) : pt.type === 'code' ? (
              <circle cx="0" cy="0" r={pt.size * 0.45} fill={pt.color} />
            ) : (
              <path
                d={buildSparklePath(0, 0, pt.size, pt.size * 0.32, progress * 90)}
                fill={pt.color}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
};
