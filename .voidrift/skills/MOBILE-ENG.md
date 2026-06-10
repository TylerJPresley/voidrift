---
name: MOBILE-ENG
description: Mobile application architecture, platform constraints, offline patterns, and UX principles for mobile development.
triggers:
  extensions: [".swift",".kt",".dart"]
  files: []
  keywords: ["mobile","ios","android","flutter","react native"]
agents: []
active: true
---

# Domain: Mobile Engineering (MOBILE-ENG)

## Core Philosophy
- **Platform Idioms:** Respect platform-specific design languages (Apple HIG, Google Material Design).
- **Offline-First:** Design for functionality without connectivity using local persistence (SQLite) and robust sync strategies.
- **Battery & Resource Efficiency:** Minimize background data and CPU cycles to preserve system resources.

## Implementation Rules
- **Lifecycle Management:** Correctly handle app foreground, background, and suspension states.
- **State Management:** Use platform-recommended reactive patterns (SwiftUI/Combine, Jetpack Compose, Flutter Provider).
- **Native Interop:** Use bridges/channels to access native APIs (GPS, Camera, Bluetooth) while maintaining abstraction.
- **Asset Management:** Use vector graphics (SVG/PDF) and multi-resolution raster assets (@2x, @3x).

## Performance
- **Network Efficiency:** Minimize background polling; utilize push notifications for real-time updates.
- **Optimization:** Lazy-load non-critical views and optimize image caching to prevent system termination.
