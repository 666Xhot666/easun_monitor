#include <Arduino.h>
#include <esp_task_wdt.h>

#include "board.h"
#include "proxy.h"

namespace {

class BoardIo : public proxy::ProxyIo {
 public:
  void toInverter(const uint8_t* data, size_t len) override { Serial1.write(data, len); }
  void toPlug(const uint8_t* data, size_t len) override { Serial2.write(data, len); }
  void usbLine(const char* text) override { Serial.println(text); }
};

BoardIo io;
proxy::Proxy px(io);

char usbLine[USB_LINE_MAX + 1];
size_t usbLen = 0;
bool usbOverflow = false;

void beginRs232(HardwareSerial& port, int rx, int tx) {
  port.setRxBufferSize(RS232_RX_BUFFER);
  port.begin(RS232_BAUD, SERIAL_8N1, rx, tx);
  port.setRxFIFOFull(1);  // every byte at once, so forwarding adds no delay
}

void readUsb(uint32_t now) {
  while (Serial.available()) {
    const char c = Serial.read();
    if (c == '\r') continue;
    if (c != '\n') {
      if (usbLen < USB_LINE_MAX) {
        usbLine[usbLen++] = c;
      } else {
        usbOverflow = true;
      }
      continue;
    }
    usbLine[usbLen] = '\0';
    if (usbOverflow) {
      Serial.println("# bad");
    } else if (usbLen > 0) {
      px.usbLine(usbLine, now);
    }
    usbLen = 0;
    usbOverflow = false;
  }
}

}  // namespace

void setup() {
  pinMode(LED_PIN, OUTPUT);
  Serial.setTxBufferSize(USB_TX_BUFFER);
  Serial.begin(USB_BAUD);
  beginRs232(Serial1, INVERTER_RX_PIN, INVERTER_TX_PIN);
  beginRs232(Serial2, PLUG_RX_PIN, PLUG_TX_PIN);
  esp_task_wdt_init(WATCHDOG_S, true);
  esp_task_wdt_add(nullptr);
  digitalWrite(LED_PIN, HIGH);
  Serial.println("# ready esp_proxy");
}

void loop() {
  const uint32_t now = millis();
  while (Serial2.available()) px.plugByte(Serial2.read(), now);
  while (Serial1.available()) px.inverterByte(Serial1.read(), now);
  readUsb(now);
  px.tick(now);
  esp_task_wdt_reset();
}
