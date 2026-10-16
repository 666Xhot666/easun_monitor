#include "hex.h"

size_t encodeHex(const uint8_t* data, size_t len, char* out) {
    static const char hexDigits[] = "0123456789ABCDEF";
    size_t pos = 0;
    for (size_t i = 0; i < len; i++) {
        out[pos++] = hexDigits[(data[i] >> 4) & 0x0F];
        out[pos++] = hexDigits[data[i] & 0x0F];
    }
    out[pos] = '\0';
    return pos;
}

int decodeHex(const char* text, uint8_t* out, size_t outCap) {
    if (text == NULL || *text == '\0') return -1;
    
    size_t len = 0;
    while (text[len] != '\0') len++;
    
    if (len % 2 != 0) return -1;
    
    size_t bytesNeeded = len / 2;
    if (bytesNeeded > outCap) return -1;
    
    for (size_t i = 0; i < bytesNeeded; i++) {
        char c1 = text[2 * i];
        char c2 = text[2 * i + 1];
        
        uint8_t hi = 0;
        if (c1 >= '0' && c1 <= '9') hi = c1 - '0';
        else if (c1 >= 'a' && c1 <= 'f') hi = c1 - 'a' + 10;
        else if (c1 >= 'A' && c1 <= 'F') hi = c1 - 'A' + 10;
        else return -1;
        
        uint8_t lo = 0;
        if (c2 >= '0' && c2 <= '9') lo = c2 - '0';
        else if (c2 >= 'a' && c2 <= 'f') lo = c2 - 'a' + 10;
        else if (c2 >= 'A' && c2 <= 'F') lo = c2 - 'A' + 10;
        else return -1;
        
        out[i] = (hi << 4) | lo;
    }
    
    return (int)bytesNeeded;
}
