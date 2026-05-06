# ⬡ NetSim — CSMA/CD Protocol Simulator

An interactive, browser-based simulator for the **CSMA/CD (Carrier Sense Multiple Access with Collision Detection)** protocol, featuring real-time canvas animation, binary exponential backoff visualization, and a step-by-step learning mode.

---

## 📌 Overview

NetSim brings the CSMA/CD protocol to life on an animated Ethernet bus topology. You can configure network parameters, watch frames collide in real time, study how backoff windows grow, and walk through every stage of the protocol step by step — all in a single HTML file with no dependencies.

---

## 🗂 Project Structure

```
DC_assi/
├── index.html      ← Multi-page SPA (5 tabs, single file)
├── style.css       ← Dark glass-card UI (DM fonts, teal/orange palette)
├── script.js       ← Full CSMA/CD simulation engine + canvas renderer
└── Report_DC.docx  ← Project report
```

---

## 🖥 Pages & Features

| Tab | Description |
|-----|-------------|
| **Dashboard** | Live stats (nodes, frames, collisions, efficiency) + Ethernet bus topology overview |
| **Network Simulator** | Real-time CSMA/CD animation with start / pause / reset / force-collision controls |
| **Backoff Visualizer** | Binary exponential backoff window growth chart + per-node backoff simulation |
| **Learning Mode** | 8-step guided walkthrough of the full CSMA/CD protocol with animated canvas |
| **Settings** | Configure all network parameters + apply Light / Medium / Heavy load presets |

---

## ⚡ Quick Start

No build tools, no dependencies — just open the file:

```bash
# Option 1: Open directly in browser
open index.html

# Option 2: Serve locally (avoids any CORS issues)
python3 -m http.server 8080
# Then visit: http://localhost:8080
```

---

## 🔬 Simulation Engine (script.js)

The entire CSMA/CD protocol is implemented in pure JavaScript:

### Core Classes
- **`Node`** — represents a network node with states: `idle → sensing → transmitting → backoff → waiting`
- **`Packet`** — represents a frame travelling along the bus with position, direction, collision state, and animated trail

### Protocol Steps Simulated
1. **Carrier Sense** — node listens to the shared bus before transmitting
2. **Transmit** — if channel is idle, the node begins sending a frame
3. **Collision Detection** — simultaneous transmissions are detected mid-flight
4. **Jam Signal** — collision is broadcast to all nodes
5. **Binary Exponential Backoff** — each node waits a random slot in window `[0, 2^k − 1]` where `k` = collision count
6. **Retransmission** — node retries after backoff (up to `maxRetry` times)

### Key Functions
| Function | Description |
|----------|-------------|
| `startSimulation()` | Initialises nodes and starts the `requestAnimationFrame` loop |
| `updateSimulation(dt)` | Advances simulation by `dt` seconds — handles frame generation, backoff countdown, carrier sense, packet movement, collision detection |
| `forceCollision()` | Forces two nodes to transmit simultaneously for demonstration |
| `generateFrames()` | Injects frames into ~60% of nodes at once |
| `simulateBackoffNode()` | Runs isolated backoff simulation for a selected node |
| `learnNext()` / `learnPrev()` | Steps through the 8-phase learning mode |
| `applyPreset()` | Applies Light / Medium / Heavy network load presets |

---

## ⚙ Configurable Parameters

| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| Number of Nodes | 4 | 2 – 20 | Active nodes on the bus |
| Frame Generation Rate | 3 /s | 1 – 10 | Probability of new frames per second |
| Transmission Speed | 5 | 1 – 10 | Relative signal propagation speed |
| Cable Length | 500 m | 100 – 2000 m | Physical bus length |
| Slot Time | 51.2 μs | 10 – 200 μs | Base unit for backoff calculation |
| Max Retransmissions | 16 | 1 – 32 | Drop frame after this many failed attempts |

### Presets

| Preset | Description |
|--------|-------------|
| **Light Load** | Few nodes, low generation rate — rare collisions |
| **Medium Load** | Balanced — moderate collision frequency |
| **Heavy Load** | Many nodes, high rate — frequent collisions, high backoff |

---

## 📐 Backoff Formula

```
Backoff Time = Random(0, 2^k − 1) × SlotTime
```
where **k** = number of collisions experienced by the node for the current frame.

The backoff window doubles with each collision, reducing the probability of repeated collisions on a heavily loaded network.

---

## 📊 Live Statistics Tracked

- Total frames generated
- Frames sent successfully
- Total collisions
- Network efficiency (%)
- Per-node: frames generated, frames sent, total collisions, total backoff

---

## 🧠 Concepts Covered

- CSMA/CD protocol mechanics
- Ethernet bus topology
- Collision detection and jam signals
- Binary exponential backoff algorithm
- Network efficiency under varying loads
- Frame queuing and retransmission limits

---
## 📄 License

This project is submitted for academic purposes only.
