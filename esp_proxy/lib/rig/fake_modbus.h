#pragma once
#include <stddef.h>
#include <stdint.h>

// A Modbus read (function 03) request; writes 8 bytes and returns 8.
size_t readRequest(uint8_t unit, uint16_t start, uint16_t count, uint8_t* out);

// The fake inverter's reply to a good read of 1..125 registers: each
// register holds its own address. Returns the reply's length, or 0 when
// the request is not a good read or the reply does not fit.
size_t fakeReadReply(const uint8_t* req, size_t len, uint8_t* out, size_t outCap);

// Whether reply is exactly the fake inverter's answer to the 8-byte req.
bool isReadReplyFor(const uint8_t* req, const uint8_t* reply, size_t len);
