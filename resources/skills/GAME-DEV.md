# Skill: Game Development

## Core Philosophy
- **Interactive Experience:** Prioritize player engagement, responsiveness, and "game feel."
- **Performance First:** Optimize for consistent frame rates (60+ FPS) and low latency.
- **Modular Systems:** Design decoupled systems for physics, rendering, input, and AI.

## Implementation Rules
- **Game Loops:** Implement efficient update/render loops with delta-time scaling.
- **Rendering:** Utilize platform-appropriate APIs (WebGL, Vulkan, Metal, DirectX) and shader languages (GLSL, HLSL).
- **Physics:** Implement or integrate 2D/3D physics engines with robust collision detection and resolution.
- **Asset Pipelines:** Efficiently manage and load textures, meshes, animations, and audio.
- **AI & Pathfinding:** Implement behaviors using Finite State Machines (FSM), Behavior Trees, and pathfinding (A*).

## Optimization
- **Object Pooling:** Reuse game objects to minimize garbage collection and allocation overhead.
- **Level of Detail (LOD):** Use LOD and culling techniques to optimize rendering performance.
