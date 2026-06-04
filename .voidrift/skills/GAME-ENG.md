---
name: GAME-ENG
description: Game loop architecture, performance constraints, state management, and rendering patterns for game development.
triggers:
  extensions: []
  files: []
  keywords: ["game loop","renderer","physics","sprite","game engine"]
agents: []
active: true
---

# Domain: Game Engineering (GAME-ENG)

## Core Philosophy
- **Interactive Experience:** Prioritize responsiveness, high frame rates (60+ FPS), and "game feel."
- **Performance First:** Optimize every frame; manage resource allocation and garbage collection strictly.
- **Modular Systems:** Decouple rendering, physics, input, and AI for maintainability.

## Implementation Rules
- **Game Loops:** Implement efficient loops with delta-time scaling; utilize platform-native APIs (WebGL, Vulkan).
- **Physics:** Integrate or implement robust physics engines with high-fidelity collision detection.
- **Asset Pipelines:** Streamline loading and management of textures, meshes, animations, and audio.
- **AI & Pathfinding:** Implement behaviors via State Machines, Behavior Trees, and pathfinding (A*).

## Optimization
- **Object Pooling:** Reuse game objects to minimize allocations.
- **LOD & Culling:** Use level-of-detail and visibility culling to maximize rendering performance.
