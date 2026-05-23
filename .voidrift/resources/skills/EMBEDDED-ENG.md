---
name: EMBEDDED-ENG
description: Embedded systems constraints, real-time requirements, hardware interface patterns, and resource management principles.
---

# Domain: Embedded Engineering (EMBEDDED-ENG)

## Core Philosophy
- **Resource Constraints:** Optimize for limited CPU, RAM, and power consumption.
- **Deterministic Behavior:** Ensure predictable execution for real-time tasks.
- **Direct Hardware Access:** Use registers and HALs to interface with hardware peripherals.

## Implementation Rules
- **Languages:** Use C, C++, or Rust for high-performance control.
- **RTOS Management:** Utilize real-time operating systems (FreeRTOS, Zephyr) for scheduling and resource management.
- **Peripherals:** Implement drivers for I2C, SPI, UART, ADC, and GPIO.
- **Memory:** Prefer static allocation; avoid heap fragmentation.
- **Interrupts:** Keep Interrupt Service Routines (ISRs) short and deterministic.

## Safety & Reliability
- **Watchdog Timers:** Use watchdogs to recover from system hangs.
- **Power Management:** Implement sleep modes and optimize for low-power consumption.
- **Bootloaders:** Support secure and reliable firmware updates (OTA).
