#include "fake_modbus.h"
#include <string.h>

#include "crc16.h"

size_t readRequest(uint8_t unit, uint16_t start, uint16_t count, uint8_t* out) {
    if (!out) return 0;
    uint8_t buf[6];
    buf[0] = unit;
    buf[1] = 0x03;
    buf[2] = (uint8_t)(start >> 8);
    buf[3] = (uint8_t)(start & 0xFF);
    buf[4] = (uint8_t)(count >> 8);
    buf[5] = (uint8_t)(count & 0xFF);
    uint16_t crc = crc16Modbus(buf, 6);
    out[0] = buf[0];
    out[1] = buf[1];
    out[2] = buf[2];
    out[3] = buf[3];
    out[4] = buf[4];
    out[5] = buf[5];
    out[6] = (uint8_t)(crc & 0xFF);
    out[7] = (uint8_t)(crc >> 8);
    return 8;
}

size_t fakeReadReply(const uint8_t* req, size_t len, uint8_t* out, size_t outCap) {
    if (!req || !out || len != 8) return 0;
    uint16_t crc = crc16Modbus(req, 6);
    if (req[6] != (uint8_t)(crc & 0xFF) || req[7] != (uint8_t)(crc >> 8)) return 0;
    if (req[1] != 0x03) return 0;
    uint16_t start = (uint16_t)((req[2] << 8) | req[3]);
    uint16_t count = (uint16_t)((req[4] << 8) | req[5]);
    if (count < 1 || count > 125) return 0;
    size_t replyLen = 5 + (size_t)count * 2;
    if (replyLen > outCap) return 0;
    out[0] = req[0];
    out[1] = 0x03;
    out[2] = (uint8_t)(count * 2);
    for (uint16_t i = 0; i < count; i++) {
        uint16_t val = start + i;
        out[3 + i * 2] = (uint8_t)(val >> 8);
        out[4 + i * 2] = (uint8_t)(val & 0xFF);
    }
    uint16_t rcrc = crc16Modbus(out, 3 + (size_t)count * 2);
    out[replyLen - 2] = (uint8_t)(rcrc & 0xFF);
    out[replyLen - 1] = (uint8_t)(rcrc >> 8);
    return replyLen;
}

bool isReadReplyFor(const uint8_t* req, const uint8_t* reply, size_t len) {
    if (!req || !reply) return false;
    uint8_t buf[260];
    size_t expected = fakeReadReply(req, 8, buf, sizeof(buf));
    if (expected == 0) return false;
    if (len != expected) return false;
    return memcmp(reply, buf, expected) == 0;
}
