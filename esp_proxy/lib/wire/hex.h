#pragma once
#include <stddef.h>
#include <stdint.h>

// Encodes binary data into a NUL-terminated string of upper-case hexadecimal digits.
size_t encodeHex(const uint8_t* data, size_t len, char* out);

// Decodes a NUL-terminated hexadecimal string into a binary buffer.
int decodeHex(const char* text, uint8_t* out, size_t outCap);

