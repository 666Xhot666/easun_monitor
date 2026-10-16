// Bench rig: a fake inverter on Serial1 and a fake Wi-Fi plug on Serial2,
// wired to the proxy's two RS232 sides.
#include <Arduino.h>

#include "fake_modbus.h"

constexpr uint8_t LED_PIN = 2;
constexpr uint8_t INVERTER_RX_PIN = 26;
constexpr uint8_t INVERTER_TX_PIN = 27;
constexpr uint8_t PLUG_RX_PIN = 16;
constexpr uint8_t PLUG_TX_PIN = 17;
constexpr uint32_t RS232_BAUD = 9600;
constexpr uint32_t USB_BAUD = 115200;
constexpr uint32_t FRAME_GAP_MS = 5;
constexpr uint32_t REPLY_DELAY_MS = 30;
constexpr uint32_t PLUG_PERIOD_MS = 700;
constexpr uint32_t PLUG_TIMEOUT_MS = 1500;
constexpr uint16_t PLUG_COUNT = 10;
constexpr uint16_t REPORT_EVERY = 10;

// Inverter state
uint8_t invBuf[300];
size_t invLen = 0;
uint32_t invLastByteTime = 0;
uint8_t invReply[300];
size_t invReplyLen = 0;
uint32_t invReplyTime = 0;
bool invReplyPending = false;
uint32_t answered = 0;
uint32_t ignored = 0;

// Plug state
uint8_t plugReq[8];
uint8_t plugBuf[300];
size_t plugLen = 0;
bool plugOutstanding = false;
uint32_t plugSendTime = 0;
uint32_t plugRound = 0;
uint32_t ok = 0;
uint32_t bad = 0;
uint32_t timeouts = 0;
uint32_t stray = 0;
uint32_t finished = 0;
bool lastPlugOk = false;

void report() {
    Serial.printf("# rig plug ok=%u bad=%u timeout=%u stray=%u inverter answered=%u ignored=%u\n",
                  (unsigned)ok, (unsigned)bad, (unsigned)timeouts, (unsigned)stray,
                  (unsigned)answered, (unsigned)ignored);
}

void setup() {
    pinMode(LED_PIN, OUTPUT);
    Serial.begin(USB_BAUD);
    Serial1.begin(RS232_BAUD, SERIAL_8N1, INVERTER_RX_PIN, INVERTER_TX_PIN);
    Serial2.begin(RS232_BAUD, SERIAL_8N1, PLUG_RX_PIN, PLUG_TX_PIN);
    Serial1.setRxFIFOFull(1);
    Serial2.setRxFIFOFull(1);
    Serial.println("# rig ready");
}

void loop() {
    uint32_t now = millis();

    // --- Fake Inverter ---
    if (Serial1.available()) {
        while (Serial1.available()) {
            uint8_t b = Serial1.read();
            if (invLen < sizeof(invBuf)) {
                invBuf[invLen++] = b;
            }
            invLastByteTime = now;
        }
    }

    if (invLen > 0 && (now - invLastByteTime >= FRAME_GAP_MS)) {
        size_t rlen = fakeReadReply(invBuf, invLen, invReply, sizeof(invReply));
        if (rlen > 0) {
            invReplyLen = rlen;
            invReplyTime = now + REPLY_DELAY_MS;
            invReplyPending = true;
            answered++;
        } else {
            ignored++;
            Serial.printf("# rig inverter ignored %u bytes\n", (unsigned)invLen);
        }
        invLen = 0;
    }

    if (invReplyPending && now >= invReplyTime) {
        Serial1.write(invReply, invReplyLen);
        invReplyPending = false;
    }

    // --- Fake Plug ---
    if (!plugOutstanding) {
        if (Serial2.available()) {
            while (Serial2.available()) {
                Serial2.read();
                stray++;
            }
        }

        if (plugRound == 0 || now - plugSendTime >= PLUG_PERIOD_MS) {
            uint16_t start = 0x0100 + (plugRound % 50) * PLUG_COUNT;
            readRequest(1, start, PLUG_COUNT, plugReq);
            Serial2.write(plugReq, 8);
            plugOutstanding = true;
            plugSendTime = now;
            plugLen = 0;
            plugRound++;
        }
    } else {
        if (Serial2.available()) {
            while (Serial2.available()) {
                uint8_t b = Serial2.read();
                if (plugLen < sizeof(plugBuf)) {
                    plugBuf[plugLen++] = b;
                }
            }
        }

        size_t expectedLen = 5 + PLUG_COUNT * 2;
        if (plugLen >= expectedLen) {
            if (isReadReplyFor(plugReq, plugBuf, plugLen)) {
                ok++;
                lastPlugOk = true;
            } else {
                bad++;
                lastPlugOk = false;
                Serial.println("# rig plug bad reply");
            }
            plugOutstanding = false;
            finished++;
            if (finished % REPORT_EVERY == 0) report();
        } else if (now - plugSendTime >= PLUG_TIMEOUT_MS) {
            timeouts++;
            lastPlugOk = false;
            Serial.println("# rig plug timeout");
            plugOutstanding = false;
            finished++;
            if (finished % REPORT_EVERY == 0) report();
        }
    }

    digitalWrite(LED_PIN, lastPlugOk ? HIGH : LOW);
}
