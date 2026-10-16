#pragma once
#include <stddef.h>
#include <stdint.h>

#include "proxy_constants.h"

namespace proxy {

/** Where the proxy's output goes: the two RS232 sides and the USB link. */
class ProxyIo {
 public:
  virtual ~ProxyIo() = default;
  virtual void toInverter(const uint8_t* data, size_t len) = 0;
  virtual void toPlug(const uint8_t* data, size_t len) = 0;
  virtual void usbLine(const char* text) = 0;
};

/**
 * Sits between the inverter and its Wi-Fi plug. The plug's bytes pass
 * through at once both ways; requests from USB go to the inverter only
 * between the plug's exchanges, and their replies go back to USB alone. The
 * plug's bytes that arrive meanwhile are held and sent right after. Every
 * burst on the line is reported over USB as "<tag> <ms> <hex>", the tag
 * telling who sent it to whom: P>I, I>P, D>I (ours), I>D (our reply).
 * Notes start with "# ".
 */
class Proxy {
 public:
  explicit Proxy(ProxyIo& io) : io_(io) {}

  void plugByte(uint8_t b, uint32_t now);
  void inverterByte(uint8_t b, uint32_t now);
  /** A request to send, as hex; refused with "# bad" or "# busy". */
  void usbLine(const char* text, uint32_t now);
  /** Call often: ends bursts and exchanges, and sends what waits. */
  void tick(uint32_t now);

 private:
  enum class State { Idle, Plug, Ours };
  enum class Tag { None, PlugToInverter, InverterToPlug, Ours, OurReply };

  struct Frame {
    uint8_t data[MAX_FRAME];
    size_t len;
  };

  void tap(Tag tag, uint8_t b, uint32_t now);
  void flushBurst();
  void report(Tag tag, uint32_t at, const uint8_t* data, size_t len);
  void toIdle(uint32_t now);
  void startPlug(uint32_t now);

  ProxyIo& io_;
  State state_ = State::Idle;
  uint32_t idleSince_ = 0;
  uint32_t lastPlugByte_ = 0;
  uint32_t lastInverterByte_ = 0;
  uint32_t sentAt_ = 0;
  bool answered_ = false;

  Tag burstTag_ = Tag::None;
  uint32_t burstStart_ = 0;
  uint32_t burstLast_ = 0;
  uint8_t burst_[MAX_FRAME];
  size_t burstLen_ = 0;

  uint8_t held_[HELD_MAX];
  size_t heldLen_ = 0;

  Frame queue_[QUEUE_DEPTH];
  size_t queueHead_ = 0;
  size_t queueLen_ = 0;

  char line_[16 + 2 * MAX_FRAME];
};

}  // namespace proxy
