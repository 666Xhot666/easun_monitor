#pragma once
#include <stddef.h>
#include <stdint.h>

// Computes the Modbus RTU CRC-16 checksum of a data buffer.
uint16_t crc16Modbus(const uint8_t* data, size_t len);

