#include <Arduino.h>

constexpr int LED_PIN = 2;
constexpr unsigned long BLINK_MS = 500;
constexpr unsigned long BAUD = 115200;

void setup() {
    pinMode(LED_PIN, OUTPUT);
    Serial.begin(BAUD);
    Serial.println("esp_proxy bench test ready");
}

void loop() {
    static unsigned long lastToggle = 0;
    static bool ledState = false;

    // Toggle LED based on elapsed time
    if (millis() - lastToggle >= BLINK_MS) {
        ledState = !ledState;
        digitalWrite(LED_PIN, ledState);
        lastToggle = millis();
    }

    // Echo serial input and report uptime on newline
    while (Serial.available()) {
        char c = Serial.read();
        Serial.write(c);
        if (c == '\n') {
            Serial.print("uptime_ms=");
            Serial.println(millis());
        }
    }
}
