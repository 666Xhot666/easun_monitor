#include <Arduino.h>

constexpr int LED_PIN = 2;
constexpr int RS232_RX_PIN = 16;
constexpr int RS232_TX_PIN = 17;
constexpr unsigned long USB_BAUD = 115200;
constexpr unsigned long RS232_BAUD = 9600;
constexpr unsigned long ROUND_MS = 1000;
constexpr unsigned long REPLY_WAIT_MS = 200;

uint32_t roundNo = 1;
unsigned long lastRoundMs = 0;
unsigned long okCount = 0;
unsigned long noReplyCount = 0;
unsigned long mismatchCount = 0;

void setup() {
  pinMode(LED_PIN, OUTPUT);
  Serial.begin(USB_BAUD);
  Serial2.begin(RS232_BAUD, SERIAL_8N1, RS232_RX_PIN, RS232_TX_PIN);
  Serial.println("esp_proxy loopback test ready");
}

void loop() {
  unsigned long now = millis();
  if (now - lastRoundMs < ROUND_MS) return;
  lastRoundMs = now;

  // Discard stale bytes from previous round
  while (Serial2.available()) Serial2.read();

  // Build 8-byte test frame
  uint8_t frame[8] = {0xA5, 0x5A, 0x00, 0xFF, 0x01, 0x80, static_cast<uint8_t>(roundNo & 0xFF), 0x0D};
  Serial2.write(frame, 8);

  // Collect reply for up to REPLY_WAIT_MS
  uint8_t rx[8] = {0};
  int rxCount = 0;
  unsigned long waitStart = millis();
  while (millis() - waitStart < REPLY_WAIT_MS) {
    while (Serial2.available() && rxCount < 8) {
      rx[rxCount++] = Serial2.read();
    }
    if (rxCount == 8) break;
  }

  bool ok = false;
  if (rxCount == 8) {
    ok = true;
    for (int i = 0; i < 8; i++) {
      if (rx[i] != frame[i]) { ok = false; break; }
    }
  }

  if (ok) {
    Serial.print("round ");
    Serial.print(roundNo);
    Serial.println(" ok");
    okCount++;
    digitalWrite(LED_PIN, HIGH);
  } else if (rxCount == 0) {
    Serial.print("round ");
    Serial.print(roundNo);
    Serial.println(" no reply");
    noReplyCount++;
    digitalWrite(LED_PIN, LOW);
  } else {
    Serial.print("round ");
    Serial.print(roundNo);
    Serial.print(" mismatch got=");
    for (int i = 0; i < rxCount; i++) {
      if (i > 0) Serial.print(' ');
      char buf[3];
      snprintf(buf, sizeof(buf), "%02X", rx[i]);
      Serial.print(buf);
    }
    Serial.println();
    mismatchCount++;
    digitalWrite(LED_PIN, LOW);
  }

  if (roundNo % 10 == 0) {
    Serial.print("tally ok=");
    Serial.print(okCount);
    Serial.print(" no_reply=");
    Serial.print(noReplyCount);
    Serial.print(" mismatch=");
    Serial.println(mismatchCount);
  }

  roundNo++;
}
