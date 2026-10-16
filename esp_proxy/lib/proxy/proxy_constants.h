#pragma once
#include <stddef.h>
#include <stdint.h>

namespace proxy {

// Quiet time that ends a burst of bytes from one side.
constexpr uint32_t FRAME_GAP_MS = 10;
// How long a request waits for the inverter before the line is free again.
constexpr uint32_t RESPONSE_TIMEOUT_MS = 1000;
// Quiet line needed after an exchange before our own request goes out.
constexpr uint32_t INJECT_GUARD_MS = 50;
// Longest Modbus RTU frame; longer bursts are reported over several lines.
constexpr size_t MAX_FRAME = 256;
// Our requests waiting for the line.
constexpr size_t QUEUE_DEPTH = 4;
// Plug bytes held while our request is out.
constexpr size_t HELD_MAX = 256;

}  // namespace proxy
