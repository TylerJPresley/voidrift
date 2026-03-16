# Skill: Embedded Systems

## Core Philosophy
- **Resource Constraints:** Optimize for limited CPU, RAM, Flash, and power consumption.
- **Deterministic Behavior:** Ensure predictable execution times for real-time tasks.
- **Direct Hardware Access:** Interface directly with hardware peripherals via registers and HALs.

## Implementation Rules
- **Languages:** Use C, C++, or Rust for high-performance, low-level control.
- **RTOS:** Utilize Real-Time Operating Systems (FreeRTOS, Zephyr) for task scheduling and resource management.
- **Peripherals:** Implement drivers for I2C, SPI, UART, ADC, PWM, and GPIO.
- **Memory Management:** Prefer static allocation over dynamic; avoid heap fragmentation.
- **Interrupts:** Keep Interrupt Service Routines (ISRs) short and efficient.

## Safety & Reliability
- **Watchdog Timers:** Use watchdogs to recover from system hangs.
- **Power Management:** Implement sleep modes and optimize for low power consumption.
- **Bootloaders:** Support secure and reliable firmware updates (OTA).
