#pragma once
#include <stddef.h>
#include <stdint.h>

// Pins and speeds of the proxy board (ESP32-WROOM-32 dev board).
constexpr int LED_PIN = 2;
// SP3232 to the inverter's RS232 port.
constexpr int INVERTER_RX_PIN = 26;
constexpr int INVERTER_TX_PIN = 27;
// SP3232 to the Wi-Fi plug.
constexpr int PLUG_RX_PIN = 16;
constexpr int PLUG_TX_PIN = 17;

constexpr unsigned long RS232_BAUD = 9600;
// Fast enough that reporting never holds up the forwarding.
constexpr unsigned long USB_BAUD = 460800;
constexpr size_t USB_TX_BUFFER = 8192;
constexpr size_t RS232_RX_BUFFER = 1024;
// Longest request line accepted from USB (hex digits).
constexpr size_t USB_LINE_MAX = 600;
