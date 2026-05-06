/* ════════════════════════════════════════════════════════════════
   script.js — CSMA/CD Protocol Simulator
   Full simulation: carrier sense, collision detection, jam signal,
   binary exponential backoff, animated canvas rendering.
   ════════════════════════════════════════════════════════════════ */

'use strict';

/* ── Palette ── */
const COLORS = {
  peach:'#EF9C66', sand:'#FCDC94', sage:'#C8CFA0', teal:'#78ABA8',
  danger:'#F87171', bg:'#0F172A', card:'#1E293B', text:'#F8FAFC',
  muted:'#CBD5E1', busColor:'rgba(252,220,148,0.6)', idleColor:'rgba(120,171,168,0.5)',
  collColor:'rgba(248,113,113,0.8)'
};

/* ══════════════════════════════════════════
   GLOBAL STATE
══════════════════════════════════════════ */
const CONFIG = {
  nodes: 4,
  genRate: 3,       // frames per second (probability)
  speed: 5,         // relative transmission speed
  cable: 500,       // meters
  slot: 51.2,       // microseconds
  maxRetry: 16,
  maxRetry: 16
};

const STATS = {
  generated: 0,
  success: 0,
  collisions: 0,
  totalBackoff: 0,
  backoffCount: 0,
  efficiencyHistory: [],
  perNode: []       // per-node stats objects
};

/* Simulation runtime state */
let simRunning = false;
let simPaused  = false;
let simTime    = 0;          // seconds
let lastTs     = null;
let animFrame  = null;

/* Network entities */
let nodes = [];
let packets = [];
let channelBusy = false;
let collisionActive = false;
let collisionTimer = 0;

/* Frame queue (generated but not yet transmitting) */
let frameQueue = [];

/* ══════════════════════════════════════════
   NODE CLASS
══════════════════════════════════════════ */
class Node {
  constructor(id, x, y) {
    this.id = id;
    this.x  = x;
    this.y  = y;
    this.state = 'idle';       // idle | sensing | transmitting | backoff | waiting
    this.backoffSlot = 0;
    this.backoffTimer = 0;
    this.collisionCount = 0;
    this.retryCount = 0;
    this.framesPending = 0;
    this.framesSuccess = 0;
    this.framesGenerated = 0;
    this.totalCollisions = 0;
    this.totalBackoff = 0;
    this.glowAlpha = 0;
  }
}

/* ══════════════════════════════════════════
   PACKET CLASS
══════════════════════════════════════════ */
class Packet {
  constructor(nodeId, srcX, direction) {
    this.nodeId    = nodeId;
    this.x         = srcX;      // position along bus (0..1)
    this.direction = direction; // +1 | -1
    this.active    = true;
    this.collided  = false;
    this.alpha     = 1;
    this.hue       = Math.random() * 360;
    this.trail     = [];
  }
}

/* ══════════════════════════════════════════
   LEARNING MODE DATA
══════════════════════════════════════════ */
const LEARN_STEPS = [
  { title:'Node Senses Channel', explanation:'Before transmitting, a node listens to the channel. This is "Carrier Sense" — the CS in CSMA/CD. The node checks if any signal is present on the shared bus.' },
  { title:'Channel is Idle', explanation:'No signal is detected on the bus. The channel is free. The node may now attempt to transmit its waiting frame.' },
  { title:'Node Begins Transmission', explanation:'The node starts sending its frame onto the bus. Bits propagate in both directions along the cable at the speed of light.' },
  { title:'Second Node Transmits', explanation:'Another node also found the channel idle and began transmitting simultaneously. Two signals are now on the bus — this will cause a collision!' },
  { title:'Collision Detected', explanation:'Both nodes detect the collision while transmitting by comparing the transmitted signal with what they read from the bus. The signals interfere.' },
  { title:'Jam Signal Sent', explanation:'Each colliding node sends a 32-bit jam signal to ensure ALL nodes on the network detect the collision, not just the two involved.' },
  { title:'Binary Exponential Backoff', explanation:'Each node independently calculates a random backoff: Random(0, 2^k−1) × SlotTime, where k is the collision count. This randomizes retry timing to reduce future collisions.' },
  { title:'Retransmission', explanation:'After the backoff period, the node returns to carrier sensing and attempts to retransmit the frame. If successful, the frame reaches its destination.' }
];

let learnStep = 0;
let learnAutoTimer = null;

/* ══════════════════════════════════════════
   INITIALISE ON LOAD
══════════════════════════════════════════ */
window.addEventListener('DOMContentLoaded', () => {
  buildNodes();
  updateConfigPreview();
  renderDashTopology();
  renderLearnStep();

  buildBackoffNodeSelect();
  renderBackoffWindow();
  updateAllStats();
  updateBackoffTable();

  // Efficiency-over-time seeding
  STATS.efficiencyHistory = [];
  for (let i = 0; i < 20; i++) STATS.efficiencyHistory.push(0);

  updateRangeGradients();
});

/* Keep range inputs styled */
function updateRangeGradients() {
  document.querySelectorAll('.range-input').forEach(r => {
    const pct = ((r.value - r.min) / (r.max - r.min)) * 100;
    r.style.background = `linear-gradient(90deg,#78ABA8 ${pct}%, rgba(255,255,255,0.1) ${pct}%)`;
  });
}

/* ══════════════════════════════════════════
   NAV / TAB SWITCHING
══════════════════════════════════════════ */
document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    switchTab(link.dataset.tab);
  });
});

function switchTab(tabId) {
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  const link = document.querySelector(`.nav-link[data-tab="${tabId}"]`);
  const pane = document.getElementById(`tab-${tabId}`);
  if (link) link.classList.add('active');
  if (pane) pane.classList.add('active');

  // refresh charts when switching to their tabs
  if (tabId === 'backoff')     { buildBackoffNodeSelect(); renderBackoffWindow(); updateBackoffTable(); }
}

/* ══════════════════════════════════════════
   BUILD NODES
══════════════════════════════════════════ */
function buildNodes() {
  nodes = [];
  STATS.perNode = [];
  packets = [];
  frameQueue = [];
  for (let i = 0; i < CONFIG.nodes; i++) {
    // Distribute nodes: half above, half below bus
    const x = (i / (CONFIG.nodes - 1 || 1));
    const y = (i % 2 === 0) ? 0 : 1;
    const n = new Node(i, x, y);
    nodes.push(n);
    STATS.perNode.push({ generated:0, success:0, collisions:0, backoffTotal:0 });
  }
}

/* ══════════════════════════════════════════
   SETTINGS
══════════════════════════════════════════ */
function updateSetting(key, val) {
  const v = parseFloat(val);
  CONFIG[key] = v;
  const labels = {
    nodes: ['lblNodes', Math.round(v)],
    genRate: ['lblGenRate', Math.round(v)],
    speed: ['lblSpeed', Math.round(v)],
    cable: ['lblCable', Math.round(v)],
    slot: ['lblSlot', v.toFixed(1)],
    maxRetry: ['lblMaxRetry', Math.round(v)]
  };
  if (labels[key]) {
    const el = document.getElementById(labels[key][0]);
    if (el) el.textContent = labels[key][1];
  }
  if (key === 'nodes') {
    buildNodes();
    renderDashTopology();
    buildBackoffNodeSelect();
  }
  updateConfigPreview();
  updateRangeGradients();
}

function applyPreset(preset) {
  const presets = {
    light:  { nodes:3, genRate:2, speed:7, slot:51.2, maxRetry:16 },
    medium: { nodes:6, genRate:5, speed:5, slot:51.2, maxRetry:16 },
    heavy:  { nodes:12, genRate:9, speed:3, slot:51.2, maxRetry:16 }
  };
  const p = presets[preset];
  if (!p) return;
  Object.assign(CONFIG, p);
  // Sync sliders
  document.getElementById('setNodes').value    = CONFIG.nodes;
  document.getElementById('setGenRate').value  = CONFIG.genRate;
  document.getElementById('setSpeed').value    = CONFIG.speed;
  document.getElementById('setSlot').value     = CONFIG.slot;
  document.getElementById('setMaxRetry').value = CONFIG.maxRetry;
  ['nodes','genRate','speed','slot','maxRetry'].forEach(k => {
    const el = document.getElementById('lbl' + k.charAt(0).toUpperCase() + k.slice(1));
    if (el) el.textContent = CONFIG[k];
  });
  buildNodes();
  renderDashTopology();
  buildBackoffNodeSelect();
  updateConfigPreview();
  updateRangeGradients();
}

function updateConfigPreview() {
  const el = document.getElementById('configPreview');
  if (!el) return;
  el.textContent =
    `Nodes       : ${CONFIG.nodes}\n` +
    `Gen Rate    : ${CONFIG.genRate}/s\n` +
    `TX Speed    : ${CONFIG.speed}\n` +
    `Cable       : ${CONFIG.cable}m\n` +
    `Slot Time   : ${CONFIG.slot}μs\n` +
    `Max Retry   : ${CONFIG.maxRetry}`;
}

/* ══════════════════════════════════════════
   SIMULATION CORE
══════════════════════════════════════════ */
function startSimulation() {
  if (simRunning && !simPaused) return;
  if (!simRunning) {
    resetSimulation(false);
    buildNodes();
  }
  simRunning = true;
  simPaused  = false;
  document.getElementById('btnPause').disabled = false;
  document.getElementById('btnStart').disabled = true;
  lastTs = null;
  animFrame = requestAnimationFrame(simLoop);
  logEvent('▶ Simulation started', 'log-success');
  setGlobalStatus('busy');
}

function pauseSimulation() {
  simPaused = !simPaused;
  const btn = document.getElementById('btnPause');
  btn.textContent = simPaused ? '▷ Resume' : '⏸ Pause';
  if (!simPaused) { lastTs = null; animFrame = requestAnimationFrame(simLoop); }
  else cancelAnimationFrame(animFrame);
  logEvent(simPaused ? '⏸ Paused' : '▷ Resumed');
}

function resetSimulation(full = true) {
  cancelAnimationFrame(animFrame);
  simRunning = false; simPaused = false;
  simTime = 0; packets = []; frameQueue = [];
  collisionActive = false; collisionTimer = 0; channelBusy = false;
  if (full) {
    STATS.generated = 0; STATS.success = 0; STATS.collisions = 0;
    STATS.totalBackoff = 0; STATS.backoffCount = 0;
    STATS.efficiencyHistory = new Array(20).fill(0);
  }
  buildNodes();
  document.getElementById('btnPause').disabled  = true;
  document.getElementById('btnStart').disabled  = false;
  const btn = document.getElementById('btnPause');
  btn.textContent = '⏸ Pause';
  document.getElementById('collisionBanner').classList.add('hidden');
  clearSimCanvas();
  updateAllStats();
  logEvent('↺ Simulation reset');
  setGlobalStatus('idle');
}

function generateFrames() {
  const count = Math.ceil(CONFIG.nodes * 0.6);
  for (let i = 0; i < count; i++) {
    const nodeId = Math.floor(Math.random() * nodes.length);
    queueFrame(nodeId);
  }
  logEvent(`📦 Generated ${count} frames`);
}

function forceCollision() {
  if (nodes.length < 2) return;
  // Force two random different nodes to transmit simultaneously
  const idxA = 0;
  const idxB = nodes.length > 1 ? 1 : 0;
  forceNodeTransmit(nodes[idxA]);
  forceNodeTransmit(nodes[idxB]);
  logEvent('💥 Force collision triggered', 'log-collision');
}

function forceNodeTransmit(node) {
  node.state = 'transmitting';
  node.framesPending = Math.max(node.framesPending, 1);
  const p = new Packet(node.id, node.x, node.x < 0.5 ? 1 : -1);
  packets.push(p);
  STATS.generated++;
  STATS.perNode[node.id].generated++;
  node.framesGenerated++;
  channelBusy = true;
}

/* ── Frame Queue ── */
function queueFrame(nodeId) {
  frameQueue.push({ nodeId, time: simTime });
  STATS.generated++;
  STATS.perNode[nodeId].generated++;
  nodes[nodeId].framesGenerated++;
  nodes[nodeId].framesPending++;
  logEvent(`Node ${nodeId}: frame queued`);
}

/* ── Main Loop ── */
function simLoop(ts) {
  if (!simRunning || simPaused) return;
  if (!lastTs) lastTs = ts;
  const rawDt = (ts - lastTs) / 1000; // seconds
  lastTs = ts;
  const dt = Math.min(rawDt, 0.05);

  simTime += dt;
  updateSimulation(dt);
  drawSimCanvas();
  updateLiveStatus();

  animFrame = requestAnimationFrame(simLoop);
}

/* ══════════════════════════════════════════
   SIMULATION UPDATE
══════════════════════════════════════════ */
function updateSimulation(dt) {
  // 1. Random frame generation
  const genProb = CONFIG.genRate * dt;
  nodes.forEach((node, i) => {
    if (node.state === 'idle' && Math.random() < genProb / nodes.length) {
      queueFrame(i);
    }
  });

  // 2. Backoff countdown
  nodes.forEach(node => {
    if (node.state === 'backoff') {
      node.backoffTimer -= dt;
      if (node.backoffTimer <= 0) {
        node.state = 'sensing';
        node.backoffTimer = 0;
        logEvent(`Node ${node.id}: backoff done, sensing`, 'log-backoff');
      }
    }
  });

  // 3. Carrier sense → transmit
  nodes.forEach(node => {
    if ((node.state === 'idle' || node.state === 'sensing') && node.framesPending > 0) {
      if (!channelBusy) {
        node.state = 'transmitting';
        const dir = node.x < 0.5 ? 1 : -1;
        const p = new Packet(node.id, node.x, dir);
        packets.push(p);
        channelBusy = true;
        logEvent(`Node ${node.id}: channel idle → transmitting`);
      } else {
        node.state = 'sensing';
      }
    }
  });

  // 4. Move packets
  const speed = CONFIG.speed * 0.15 * dt;
  packets.forEach(p => {
    if (!p.active) return;
    p.trail.push(p.x);
    if (p.trail.length > 12) p.trail.shift();
    p.x += p.direction * speed;
    if (p.x < 0) { p.x = 0; p.direction = 1; }
    if (p.x > 1) { p.x = 1; p.direction = -1; }
  });

  // 5. Collision detection — if two active packets overlap
  const active = packets.filter(p => p.active && !p.collided);
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      if (Math.abs(active[i].x - active[j].x) < 0.06) {
        handleCollision(active[i], active[j]);
      }
    }
  }

  // 6. Packets that reach edge → success
  packets.forEach(p => {
    if (!p.active || p.collided) return;
    if (p.x <= 0.01 || p.x >= 0.99) {
      // Check if source node still transmitting
      const node = nodes[p.nodeId];
      if (node && node.state === 'transmitting') {
        completeTransmission(node, p);
      }
    }
  });

  // 7. Fade out dead packets
  packets = packets.filter(p => {
    if (!p.active) { p.alpha -= dt * 3; return p.alpha > 0; }
    return true;
  });

  // 8. Update channel busy
  const anyTransmitting = nodes.some(n => n.state === 'transmitting');
  channelBusy = anyTransmitting || packets.some(p => p.active && !p.collided);

  // 9. Collision banner timer
  if (collisionActive) {
    collisionTimer -= dt;
    if (collisionTimer <= 0) {
      collisionActive = false;
      document.getElementById('collisionBanner').classList.add('hidden');
    }
  }

  // 10. Node glow
  nodes.forEach(n => {
    if (n.state === 'transmitting') n.glowAlpha = Math.min(1, n.glowAlpha + dt * 4);
    else n.glowAlpha = Math.max(0, n.glowAlpha - dt * 3);
  });

  // 11. Track efficiency
  if (Math.floor(simTime * 2) > Math.floor((simTime - dt) * 2)) {
    const eff = STATS.generated > 0 ? (STATS.success / STATS.generated) * 100 : 0;
    STATS.efficiencyHistory.push(eff);
    if (STATS.efficiencyHistory.length > 60) STATS.efficiencyHistory.shift();
  }
}

/* ── Collision Handler ── */
function handleCollision(pA, pB) {
  pA.collided = true; pB.collided = true;
  pA.active   = false; pB.active = false;
  STATS.collisions++;
  if (STATS.perNode[pA.nodeId]) { STATS.perNode[pA.nodeId].collisions++; nodes[pA.nodeId].totalCollisions++; }
  if (STATS.perNode[pB.nodeId]) { STATS.perNode[pB.nodeId].collisions++; nodes[pB.nodeId].totalCollisions++; }

  [pA.nodeId, pB.nodeId].forEach(id => {
    const node = nodes[id];
    if (!node) return;
    node.collisionCount++;
    node.state = 'backoff';
    const k = Math.min(node.collisionCount, 10);
    const maxSlots = Math.pow(2, k) - 1;
    const slot = Math.floor(Math.random() * (maxSlots + 1));
    node.backoffSlot = slot;
    const backoffSecs = slot * (CONFIG.slot / 1e6);
    node.backoffTimer = backoffSecs + 0.4; // minimum visual delay
    STATS.totalBackoff += backoffSecs * 1000;
    STATS.backoffCount++;
    STATS.perNode[id].backoffTotal += backoffSecs * 1000;
    node.retryCount++;
    if (node.retryCount >= CONFIG.maxRetry) {
      node.state = 'idle';
      node.framesPending = Math.max(0, node.framesPending - 1);
      node.retryCount = 0;
      node.collisionCount = 0;
      logEvent(`Node ${id}: max retries — frame dropped`, 'log-collision');
    } else {
      logEvent(`Node ${id}: collision! backoff k=${k}, slot=${slot}`, 'log-collision');
    }
  });

  collisionActive = true;
  collisionTimer  = 1.5;
  document.getElementById('collisionBanner').classList.remove('hidden');
  setGlobalStatus('collision');
  setTimeout(() => setGlobalStatus('busy'), 1500);
  updateAllStats();
}

/* ── Successful Transmission ── */
function completeTransmission(node, pkt) {
  node.state = 'idle';
  node.framesPending = Math.max(0, node.framesPending - 1);
  node.framesSuccess++;
  node.retryCount    = 0;
  node.collisionCount = 0;
  pkt.active  = false;
  STATS.success++;
  STATS.perNode[node.id].success++;
  logEvent(`Node ${node.id}: frame delivered ✓`, 'log-success');
  updateAllStats();
}

/* ══════════════════════════════════════════
   DRAW SIMULATION CANVAS
══════════════════════════════════════════ */
function getSimCtx() {
  const c = document.getElementById('simCanvas');
  return c ? c.getContext('2d') : null;
}
function clearSimCanvas() {
  const ctx = getSimCtx();
  if (!ctx) return;
  const { width: W, height: H } = ctx.canvas;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0d1829';
  ctx.fillRect(0, 0, W, H);
}

function drawSimCanvas() {
  const ctx = getSimCtx();
  if (!ctx) return;
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const BUS_Y = H / 2;
  const BUS_X1 = 60, BUS_X2 = W - 60;
  const BUS_LEN = BUS_X2 - BUS_X1;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0d1829';
  ctx.fillRect(0, 0, W, H);

  // ── Grid lines ──
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  for (let y = 40; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
  for (let x = 40; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }

  // ── Bus cable ──
  const busColor = collisionActive ? COLORS.collColor : channelBusy ? COLORS.busColor : COLORS.idleColor;
  ctx.save();
  ctx.shadowBlur = collisionActive ? 20 : channelBusy ? 10 : 4;
  ctx.shadowColor = busColor;
  const grad = ctx.createLinearGradient(BUS_X1, 0, BUS_X2, 0);
  grad.addColorStop(0, 'rgba(120,171,168,0.3)');
  grad.addColorStop(0.5, busColor);
  grad.addColorStop(1, 'rgba(120,171,168,0.3)');
  ctx.strokeStyle = grad;
  ctx.lineWidth = collisionActive ? 5 : 3;
  ctx.beginPath(); ctx.moveTo(BUS_X1, BUS_Y); ctx.lineTo(BUS_X2, BUS_Y); ctx.stroke();
  ctx.restore();

  // ── Bus terminators ──
  [BUS_X1, BUS_X2].forEach(tx => {
    ctx.fillStyle = COLORS.teal;
    ctx.fillRect(tx - 4, BUS_Y - 10, 8, 20);
  });

  // ── Nodes ──
  nodes.forEach((node, i) => {
    const bx = BUS_X1 + node.x * BUS_LEN;
    const side = i % 2 === 0 ? -1 : 1;
    const by = BUS_Y + side * 90;
    const stalkY1 = BUS_Y + side * 10;
    const stalkY2 = BUS_Y + side * 72;

    // Stalk
    ctx.strokeStyle = 'rgba(120,171,168,0.5)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(bx, stalkY1); ctx.lineTo(bx, stalkY2); ctx.stroke();
    ctx.setLineDash([]);

    // Glow
    if (node.glowAlpha > 0) {
      ctx.save();
      ctx.globalAlpha = node.glowAlpha * 0.4;
      ctx.shadowBlur = 20; ctx.shadowColor = COLORS.peach;
      ctx.beginPath(); ctx.arc(bx, by, 26, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.peach; ctx.fill();
      ctx.restore();
    }

    // Node body
    const nodeColor = getNodeColor(node.state);
    ctx.save();
    ctx.shadowBlur = 8; ctx.shadowColor = nodeColor;
    ctx.fillStyle = nodeColor;
    ctx.beginPath(); ctx.arc(bx, by, 18, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#1E293B'; ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // Node label
    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 11px Segoe UI';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(`N${node.id}`, bx, by);

    // State badge
    if (node.state !== 'idle') {
      ctx.fillStyle = 'rgba(15,23,42,0.85)';
      ctx.beginPath();
      const bly = by + side * 26;
      roundRect(ctx, bx - 28, bly - 9, 56, 18, 5);
      ctx.fill();
      ctx.fillStyle = nodeColor;
      ctx.font = '8px Segoe UI';
      ctx.fillText(node.state.toUpperCase(), bx, bly);
    }

    // Pending frame indicator
    if (node.framesPending > 0) {
      ctx.fillStyle = COLORS.sand;
      ctx.font = 'bold 8px Segoe UI';
      ctx.fillText(`[${node.framesPending}]`, bx + 22, by - 14);
    }

    // Backoff countdown
    if (node.state === 'backoff' && node.backoffTimer > 0) {
      ctx.fillStyle = COLORS.sand;
      ctx.font = '8px Segoe UI';
      ctx.fillText(`⏱${node.backoffTimer.toFixed(1)}s`, bx, by + side * 40);
    }
  });

  // ── Packets ──
  packets.forEach(p => {
    const px = BUS_X1 + p.x * BUS_LEN;
    ctx.save();
    ctx.globalAlpha = p.alpha;

    // Trail
    if (p.trail.length > 1) {
      ctx.beginPath();
      p.trail.forEach((tx, idx) => {
        const tx2 = BUS_X1 + tx * BUS_LEN;
        if (idx === 0) ctx.moveTo(tx2, BUS_Y);
        else ctx.lineTo(tx2, BUS_Y);
      });
      ctx.strokeStyle = p.collided ? COLORS.danger : `hsla(${p.hue},80%,65%,0.35)`;
      ctx.lineWidth = 6;
      ctx.stroke();
    }

    if (p.active && !p.collided) {
      ctx.shadowBlur = 12;
      ctx.shadowColor = `hsl(${p.hue},80%,65%)`;
      ctx.fillStyle   = `hsl(${p.hue},80%,65%)`;
      ctx.beginPath(); ctx.arc(px, BUS_Y, 7, 0, Math.PI * 2); ctx.fill();
    } else if (p.collided) {
      // Collision spark
      ctx.shadowBlur = 20; ctx.shadowColor = COLORS.danger;
      for (let s = 0; s < 8; s++) {
        const ang = (s / 8) * Math.PI * 2 + simTime * 5;
        const r   = 10 + Math.sin(simTime * 15 + s) * 5;
        ctx.fillStyle = COLORS.danger;
        ctx.beginPath();
        ctx.arc(px + Math.cos(ang)*r, BUS_Y + Math.sin(ang)*r * 0.4, 3, 0, Math.PI*2);
        ctx.fill();
      }
    }
    ctx.restore();
  });

  // ── Legend ──
  const legendX = 10, legendY = H - 60;
  [
    { c: COLORS.sage,   l: 'Idle' },
    { c: COLORS.sand,   l: 'Sensing/Backoff' },
    { c: COLORS.peach,  l: 'Transmitting' },
    { c: COLORS.danger, l: 'Collision' }
  ].forEach(({ c, l }, i) => {
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.arc(legendX + 6, legendY + i * 14, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = COLORS.muted;
    ctx.font = '10px Segoe UI'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(l, legendX + 14, legendY + i * 14);
  });
}

function getNodeColor(state) {
  switch (state) {
    case 'transmitting': return COLORS.peach;
    case 'backoff':      return COLORS.sand;
    case 'sensing':      return COLORS.teal;
    case 'idle':         return COLORS.sage;
    default:             return COLORS.muted;
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x+w, y, x+w, y+h, r);
  ctx.arcTo(x+w, y+h, x, y+h, r);
  ctx.arcTo(x, y+h, x, y, r);
  ctx.arcTo(x, y, x+w, y, r);
  ctx.closePath();
}

/* ══════════════════════════════════════════
   LIVE STATUS UPDATE
══════════════════════════════════════════ */
function updateLiveStatus() {
  const chEl   = document.getElementById('infoChannel');
  const txEl   = document.getElementById('infoTransmitting');
  const colEl  = document.getElementById('infoCollisions');
  const bkEl   = document.getElementById('infoBackoff');
  const tmEl   = document.getElementById('infoTime');
  const stEl   = document.getElementById('infoSent');

  if (collisionActive) {
    chEl.innerHTML = '<span class="badge badge-collision">COLLISION</span>';
  } else if (channelBusy) {
    chEl.innerHTML = '<span class="badge badge-busy">BUSY</span>';
  } else {
    chEl.innerHTML = '<span class="badge badge-idle">IDLE</span>';
  }

  const txNode = nodes.find(n => n.state === 'transmitting');
  txEl.textContent = txNode ? `Node ${txNode.id}` : '—';
  colEl.textContent = STATS.collisions;
  const bkNode = nodes.find(n => n.state === 'backoff');
  bkEl.textContent = bkNode ? `${bkNode.backoffSlot} slots` : '—';
  tmEl.textContent = simTime.toFixed(2) + 's';
  stEl.textContent = STATS.success;
}

/* ══════════════════════════════════════════
   UPDATE ALL STATS (counters & panels)
══════════════════════════════════════════ */
function updateAllStats() {
  const eff = STATS.generated > 0 ? ((STATS.success / STATS.generated) * 100).toFixed(1) : '0.0';
  const avgBk = STATS.backoffCount > 0 ? (STATS.totalBackoff / STATS.backoffCount).toFixed(1) : '0';

  // Dashboard
  animCounter('dash-nodes', CONFIG.nodes);
  animCounter('dash-generated', STATS.generated);
  animCounter('dash-success', STATS.success);
  animCounter('dash-collisions', STATS.collisions);
  document.getElementById('dash-efficiency').textContent = eff + '%';
}

/* Simple animated counter */
function animCounter(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const current = parseInt(el.textContent) || 0;
  if (current === target) return;
  const step = Math.ceil(Math.abs(target - current) / 8) * Math.sign(target - current);
  const next = current + step;
  el.textContent = Math.abs(target - next) < Math.abs(step) ? target : next;
  if (next !== target) setTimeout(() => animCounter(id, target), 30);
}

/* ══════════════════════════════════════════
   EVENT LOG
══════════════════════════════════════════ */
function logEvent(msg, cls = '') {
  // Event log removed from UI
}

/* ══════════════════════════════════════════
   GLOBAL STATUS DOT
══════════════════════════════════════════ */
function setGlobalStatus(state) {
  const dot  = document.getElementById('globalStatus');
  const text = document.getElementById('globalStatusText');
  if (!dot) return;
  dot.className = 'status-dot ' + (state === 'collision' ? 'collision' : state === 'busy' ? 'busy' : '');
  text.textContent = state.charAt(0).toUpperCase() + state.slice(1);
}

/* ══════════════════════════════════════════
   DASHBOARD TOPOLOGY CANVAS
══════════════════════════════════════════ */
function renderDashTopology() {
  const c = document.getElementById('dashTopologyCanvas');
  if (!c) return;
  const ctx = c.getContext('2d');
  const W = c.width, H = c.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(13,24,41,0.8)';
  ctx.fillRect(0, 0, W, H);

  const busY = H / 2, x1 = 30, x2 = W - 30;
  // Bus
  ctx.shadowBlur = 8; ctx.shadowColor = COLORS.teal;
  ctx.strokeStyle = COLORS.teal; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(x1, busY); ctx.lineTo(x2, busY); ctx.stroke();
  ctx.shadowBlur = 0;

  const n = CONFIG.nodes;
  for (let i = 0; i < n; i++) {
    const nx = x1 + (i / (n - 1 || 1)) * (x2 - x1);
    const side = i % 2 === 0 ? -1 : 1;
    const ny = busY + side * 60;
    // Stalk
    ctx.setLineDash([3,3]);
    ctx.strokeStyle = 'rgba(120,171,168,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(nx, busY + side * 8); ctx.lineTo(nx, busY + side * 44); ctx.stroke();
    ctx.setLineDash([]);
    // Node
    ctx.shadowBlur = 6; ctx.shadowColor = COLORS.sage;
    ctx.fillStyle = COLORS.sage;
    ctx.beginPath(); ctx.arc(nx, ny, 14, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 9px Segoe UI'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(`N${i}`, nx, ny);
  }
  // Terminators
  ctx.fillStyle = COLORS.peach;
  [x1, x2].forEach(tx => { ctx.beginPath(); ctx.arc(tx, busY, 5, 0, Math.PI*2); ctx.fill(); });
}









function drawGridLines(ctx, W, H, padL, padT, padR, padB, lines) {
  const cW = W - padL - padR, cH = H - padT - padB;
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
  for (let i = 0; i <= lines; i++) {
    const y = padT + (i / lines) * cH;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + cW, y); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, padT+cH); ctx.lineTo(padL+cW, padT+cH); ctx.stroke();
}

/* ══════════════════════════════════════════
   BACKOFF VISUALIZER
══════════════════════════════════════════ */
function renderBackoffWindow() {
  const c = document.getElementById('backoffWindowCanvas');
  if (!c) return;
  const ctx = c.getContext('2d');
  const W = c.width, H = c.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(13,24,41,0.8)'; ctx.fillRect(0, 0, W, H);

  const maxK = 10;
  const padL = 50, padB = 35, padT = 30, padR = 15;
  const cW = W - padL - padR, cH = H - padT - padB;
  const maxWin = Math.pow(2, maxK) - 1;

  drawGridLines(ctx, W, H, padL, padT, padR, padB, 5);
  ctx.fillStyle = COLORS.muted; ctx.font = '10px Segoe UI';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('Backoff Window Growth (2^k − 1)', W/2, 8);

  const barW = cW / maxK;
  for (let k = 1; k <= maxK; k++) {
    const win = Math.pow(2, k) - 1;
    const bh = (win / maxWin) * cH;
    const bx = padL + (k-1) * barW + barW * 0.1;
    const by = padT + cH - bh;
    const bww = barW * 0.8;

    const g = ctx.createLinearGradient(bx, by, bx, by + bh);
    g.addColorStop(0, COLORS.sand);
    g.addColorStop(1, 'rgba(252,220,148,0.15)');
    ctx.fillStyle = g;
    ctx.beginPath(); roundRect(ctx, bx, by, bww, bh, 4); ctx.fill();

    ctx.fillStyle = COLORS.muted; ctx.font = '9px Segoe UI';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('k=' + k, bx + bww/2, H - padB + 4);
    ctx.fillStyle = COLORS.sand; ctx.font = 'bold 8px Segoe UI';
    ctx.textBaseline = 'bottom';
    ctx.fillText('0-' + win, bx + bww/2, by - 2);
  }
}

function buildBackoffNodeSelect() {
  const sel = document.getElementById('backoffNodeSelect');
  if (!sel) return;
  sel.innerHTML = nodes.map((_, i) => `<option value="${i}">Node ${i}</option>`).join('');
}

function simulateBackoffNode() {
  const sel = document.getElementById('backoffNodeSelect');
  const nodeId = parseInt(sel.value);
  const node = nodes[nodeId];
  if (!node) return;

  const c = document.getElementById('backoffNodeCanvas');
  if (!c) return;
  const ctx = c.getContext('2d');
  const W = c.width, H = c.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(13,24,41,0.8)'; ctx.fillRect(0, 0, W, H);

  const maxTrials = 8;
  const results = [];
  for (let k = 1; k <= maxTrials; k++) {
    const maxS = Math.pow(2, Math.min(k, 10)) - 1;
    const slot = Math.floor(Math.random() * (maxS + 1));
    results.push({ k, maxS, slot, time: slot * CONFIG.slot });
  }

  const padL = 45, padB = 35, padT = 25, padR = 15;
  const cW = W - padL - padR, cH = H - padT - padB;
  const barW = cW / maxTrials;
  const maxTime = Math.max(...results.map(r => r.time), 1);

  drawGridLines(ctx, W, H, padL, padT, padR, padB, 4);
  ctx.fillStyle = COLORS.muted; ctx.font = '10px Segoe UI';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText(`Node ${nodeId} — Backoff Simulation`, W/2, 6);

  results.forEach((r, i) => {
    const bh = (r.time / maxTime) * cH;
    const bx = padL + i * barW + barW * 0.1;
    const by = padT + cH - bh;
    const bww = barW * 0.8;
    const g = ctx.createLinearGradient(bx, by, bx, by + bh);
    g.addColorStop(0, COLORS.peach);
    g.addColorStop(1, 'rgba(239,156,102,0.1)');
    ctx.fillStyle = g;
    ctx.beginPath(); roundRect(ctx, bx, by, bww, bh, 3); ctx.fill();
    ctx.fillStyle = COLORS.muted; ctx.font = '8px Segoe UI';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('C' + r.k, bx + bww/2, H - padB + 4);
    ctx.fillStyle = COLORS.sand; ctx.font = '8px Segoe UI'; ctx.textBaseline = 'bottom';
    ctx.fillText(r.slot, bx + bww/2, by - 1);
  });

  const resEl = document.getElementById('backoffResult');
  if (resEl) {
    resEl.textContent = `Collision ${node.collisionCount}: window 0–${Math.pow(2,Math.min(node.collisionCount,10))-1}, chosen slot ${node.backoffSlot}`;
  }
}

function updateBackoffTable() {
  const wrap = document.getElementById('backoffTable');
  if (!wrap) return;
  const rows = nodes.map((n, i) => {
    const k = Math.min(n.collisionCount, 10);
    const win = Math.pow(2, k) - 1;
    return `<tr>
      <td>Node ${i}</td>
      <td>${n.collisionCount}</td>
      <td>0 – ${win}</td>
      <td>${n.backoffSlot}</td>
      <td>${(n.backoffTimer > 0 ? n.backoffTimer.toFixed(2) : '—')}</td>
      <td><span class="badge ${n.state === 'backoff' ? 'badge-busy' : 'badge-idle'}">${n.state.toUpperCase()}</span></td>
    </tr>`;
  }).join('');
  wrap.innerHTML = `<table class="node-table">
    <thead><tr><th>Node</th><th>Collisions (k)</th><th>Window</th><th>Chosen Slot</th><th>Timer</th><th>State</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

/* ══════════════════════════════════════════
   LEARNING MODE
══════════════════════════════════════════ */


function renderLearnStep() {
  const step = LEARN_STEPS[learnStep];
  document.getElementById('learnStepNum').textContent   = learnStep + 1;
  document.getElementById('learnStepTitle').textContent = step.title;
  document.getElementById('learnExplanation').textContent = step.explanation;
  const pct = ((learnStep + 1) / LEARN_STEPS.length) * 100;
  document.getElementById('learnProgress').style.width = pct + '%';



  document.getElementById('btnLearnPrev').disabled = learnStep === 0;
  document.getElementById('btnLearnNext').disabled = learnStep === LEARN_STEPS.length - 1;

  drawLearnCanvas(learnStep);
}

function learnNext() {
  if (learnStep < LEARN_STEPS.length - 1) { learnStep++; renderLearnStep(); }
}
function learnPrev() {
  if (learnStep > 0) { learnStep--; renderLearnStep(); }
}
function learnAuto() {
  if (learnAutoTimer) { clearInterval(learnAutoTimer); learnAutoTimer = null; document.getElementById('btnLearnAuto').textContent = '⏵ Auto Run'; return; }
  document.getElementById('btnLearnAuto').textContent = '⏹ Stop';
  learnAutoTimer = setInterval(() => {
    if (learnStep < LEARN_STEPS.length - 1) { learnStep++; renderLearnStep(); }
    else { clearInterval(learnAutoTimer); learnAutoTimer = null; document.getElementById('btnLearnAuto').textContent = '⏵ Auto Run'; }
  }, 2000);
}

/* ── Learning Canvas Illustrations ── */
function drawLearnCanvas(step) {
  const c = document.getElementById('learnCanvas');
  if (!c) return;
  const ctx = c.getContext('2d');
  const W = c.width, H = c.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0d1829'; ctx.fillRect(0, 0, W, H);

  const busY = H / 2, x1 = 60, x2 = W - 60;
  // Bus
  const busCol = step >= 4 ? COLORS.collColor : step >= 2 ? COLORS.busColor : COLORS.idleColor;
  ctx.save();
  ctx.shadowBlur = 10; ctx.shadowColor = busCol;
  ctx.strokeStyle = busCol; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(x1, busY); ctx.lineTo(x2, busY); ctx.stroke();
  ctx.restore();

  // Terminators
  ctx.fillStyle = COLORS.teal;
  [x1, x2].forEach(tx => { ctx.fillRect(tx-5, busY-12, 10, 24); });

  // Draw 3 nodes: N0 top-left, N1 top-right, N2 bottom-mid
  const nodePositions = [
    { id:0, bx: x1 + (x2-x1)*0.2, by: busY - 85, side:-1 },
    { id:1, bx: x1 + (x2-x1)*0.8, by: busY - 85, side:-1 },
    { id:2, bx: x1 + (x2-x1)*0.5, by: busY + 85, side:1  }
  ];

  nodePositions.forEach(({ id, bx, by, side }) => {
    // stalk
    ctx.setLineDash([4,4]);
    ctx.strokeStyle = 'rgba(120,171,168,0.4)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(bx, busY + side*10); ctx.lineTo(bx, by - side*16); ctx.stroke();
    ctx.setLineDash([]);

    // Active highlight for relevant nodes
    let color = COLORS.sage;
    if (step === 0 && id === 0) color = COLORS.teal;
    if (step === 1 && id === 0) color = COLORS.sage;
    if ((step === 2 || step === 3) && id === 0) color = COLORS.peach;
    if (step === 3 && id === 1) color = COLORS.peach;
    if ((step === 4 || step === 5) && (id === 0 || id === 1)) color = COLORS.danger;
    if (step === 6 && (id === 0 || id === 1)) color = COLORS.sand;
    if (step === 7 && id === 0) color = COLORS.sage;

    ctx.save();
    ctx.shadowBlur = 10; ctx.shadowColor = color;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(bx, by, 20, 0, Math.PI*2); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#0F172A'; ctx.font = 'bold 11px Segoe UI';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(`N${id}`, bx, by);
  });

  // Step-specific illustrations
  const [n0, n1] = [nodePositions[0], nodePositions[1]];
  const busXn0 = n0.bx, busXn1 = n1.bx;

  // Packet animations based on step
  if (step === 2 || step === 3) {
    // N0 packet moving right
    const px = busXn0 + (step === 2 ? 80 : 160);
    ctx.save(); ctx.shadowBlur = 10; ctx.shadowColor = COLORS.peach;
    ctx.fillStyle = COLORS.peach; ctx.beginPath(); ctx.arc(px, busY, 8, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  }
  if (step === 3) {
    // N1 packet moving left
    const px = busXn1 - 80;
    ctx.save(); ctx.shadowBlur = 10; ctx.shadowColor = COLORS.teal;
    ctx.fillStyle = COLORS.teal; ctx.beginPath(); ctx.arc(px, busY, 8, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  }
  if (step === 4 || step === 5) {
    // Collision sparks at center
    const cx = (busXn0 + busXn1) / 2;
    for (let s = 0; s < 8; s++) {
      const ang = (s / 8) * Math.PI * 2;
      const r = 18;
      ctx.save(); ctx.shadowBlur = 10; ctx.shadowColor = COLORS.danger;
      ctx.fillStyle = COLORS.danger;
      ctx.beginPath(); ctx.arc(cx + Math.cos(ang)*r, busY + Math.sin(ang)*r*0.5, 4, 0, Math.PI*2); ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = COLORS.danger; ctx.font = 'bold 13px Segoe UI';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('💥 COLLISION!', cx, busY - 30);
  }
  if (step === 5) {
    // Jam signal lines
    ctx.setLineDash([6,4]);
    ctx.strokeStyle = COLORS.danger; ctx.lineWidth = 2;
    const cx = (busXn0 + busXn1) / 2;
    ctx.beginPath(); ctx.moveTo(cx, busY); ctx.lineTo(busXn0, busY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, busY); ctx.lineTo(busXn1, busY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = COLORS.danger; ctx.font = '10px Segoe UI';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText('JAM', (cx + busXn0)/2, busY - 6);
    ctx.fillText('JAM', (cx + busXn1)/2, busY - 6);
  }
  if (step === 6) {
    // Backoff timers
    [n0, n1].forEach(n => {
      const k1 = 1, win = Math.pow(2, k1) - 1;
      const slot = Math.floor(Math.random() * (win + 1));
      ctx.fillStyle = 'rgba(15,23,42,0.85)';
      ctx.beginPath(); roundRect(ctx, n.bx - 30, n.by + 26, 60, 20, 6); ctx.fill();
      ctx.fillStyle = COLORS.sand; ctx.font = 'bold 9px Segoe UI';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`Slot: ${slot} / ${win}`, n.bx, n.by + 36);
    });
  }
  if (step === 7) {
    // Arrow showing retry
    const px = busXn0 + 120;
    ctx.save(); ctx.shadowBlur = 10; ctx.shadowColor = COLORS.sage;
    ctx.fillStyle = COLORS.sage; ctx.beginPath(); ctx.arc(px, busY, 8, 0, Math.PI*2); ctx.fill();
    ctx.restore();
    ctx.fillStyle = COLORS.sage; ctx.font = '10px Segoe UI';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText('Retransmitting →', px, busY - 14);
  }

  // Step label
  ctx.fillStyle = 'rgba(239,156,102,0.12)';
  ctx.beginPath(); roundRect(ctx, 10, 10, W - 20, 36, 8); ctx.fill();
  ctx.fillStyle = COLORS.peach; ctx.font = 'bold 13px Segoe UI';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(`Step ${learnStep+1}: ${LEARN_STEPS[learnStep].title}`, W/2, 28);
}

/* ══════════════════════════════════════════
   PERIODIC REFRESH for secondary canvases
══════════════════════════════════════════ */
setInterval(() => {
  if (simRunning && !simPaused) {
    updateBackoffTable();
    // Refresh charts if visible
    const active = document.querySelector('.tab-pane.active');
    if (active) {
      const id = active.id;
      if (id === 'tab-backoff')    { renderBackoffWindow(); updateBackoffTable(); }
    }
  }
}, 1000);

/* ══════════════════════════════════════════
   INITIAL DRAW
══════════════════════════════════════════ */
clearSimCanvas();
drawLearnCanvas(0);
