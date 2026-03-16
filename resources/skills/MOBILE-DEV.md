# Skill: Mobile Development

## Core Philosophy
- **Mobile-First Design:** Prioritize the mobile experience; optimize for touch targets, varied screen sizes, and intermittent connectivity.
- **Platform Idioms:** Respect platform-specific design languages (Human Interface Guidelines for iOS, Material Design for Android).
- **Offline-First:** Design for offline functionality using local persistence (SQLite, Realm) and robust sync strategies.

## Implementation Rules
- **Lifecycle Management:** Correctly handle app lifecycle events (foreground, background, suspend, resume).
- **State Management:** Use platform-recommended patterns (SwiftUI/Combine, Jetpack Compose/State, Provider/Riverpod).
- **Native Interop:** Implement platform channels or bridges for accessing native APIs (Camera, GPS, Bluetooth).
- **Asset Optimization:** Use vector graphics (PDF/SVG) or multi-resolution raster assets (@2x, @3x, xhdpi).

## Performance & Battery
- **Network Efficiency:** Minimize background data usage; use push notifications for real-time updates.
- **Resource Management:** Optimize image loading (lazy loading, caching) and memory usage to prevent system termination.
- **Battery Impact:** Avoid excessive polling or high-frequency location updates unless strictly necessary.
