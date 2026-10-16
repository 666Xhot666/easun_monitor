#include "proxy.h"

#include <stdio.h>
#include <string.h>

#include "hex.h"

namespace proxy {

static const char* tagText(int tag) {
  static const char* const texts[] = {"", "P>I", "I>P", "D>I", "I>D"};
  return texts[tag];
}

void Proxy::plugByte(uint8_t b, uint32_t now) {
  stats_.plug++;
  if (state_ == State::Ours) {
    if (heldLen_ == 0) stats_.held++;
    if (heldLen_ < HELD_MAX) {
      held_[heldLen_++] = b;
    } else {
      stats_.overflow++;
    }
    return;
  }
  io_.toInverter(&b, 1);
  tap(Tag::PlugToInverter, b, now);
  startPlug(now);
}

void Proxy::inverterByte(uint8_t b, uint32_t now) {
  stats_.inverter++;
  lastInverterByte_ = now;
  if (state_ == State::Ours) {
    answered_ = true;
    tap(Tag::OurReply, b, now);
    return;
  }
  if (state_ == State::Plug) answered_ = true;
  io_.toPlug(&b, 1);
  tap(Tag::InverterToPlug, b, now);
}

void Proxy::usbLine(const char* text, uint32_t now) {
  (void)now;
  uint8_t data[MAX_FRAME];
  const int len = decodeHex(text, data, sizeof data);
  if (len <= 0) {
    io_.usbLine("# bad");
    return;
  }
  if (queueLen_ == QUEUE_DEPTH) {
    io_.usbLine("# busy");
    return;
  }
  Frame& slot = queue_[(queueHead_ + queueLen_) % QUEUE_DEPTH];
  memcpy(slot.data, data, len);
  slot.len = len;
  queueLen_++;
}

void Proxy::tick(uint32_t now) {
  if (burstTag_ != Tag::None && now - burstLast_ >= FRAME_GAP_MS) flushBurst();

  switch (state_) {
    case State::Plug: {
      const bool replied = answered_ && now - lastInverterByte_ >= FRAME_GAP_MS;
      const bool ignored = !answered_ && now - lastPlugByte_ >= RESPONSE_TIMEOUT_MS;
      if (replied || ignored) toIdle(now);
      break;
    }
    case State::Ours: {
      const bool replied = answered_ && now - lastInverterByte_ >= FRAME_GAP_MS;
      const bool ignored = !answered_ && now - sentAt_ >= RESPONSE_TIMEOUT_MS;
      if (!replied && !ignored) break;
      flushBurst();
      if (ignored) {
        io_.usbLine("# timeout");
        stats_.timeouts++;
      }
      toIdle(now);
      if (heldLen_ > 0) {
        io_.toInverter(held_, heldLen_);
        report(Tag::PlugToInverter, now, held_, heldLen_);
        heldLen_ = 0;
        startPlug(now);
      }
      break;
    }
    case State::Idle:
      break;
  }

  if (state_ == State::Idle && queueLen_ > 0 && now - idleSince_ >= INJECT_GUARD_MS) {
    Frame& frame = queue_[queueHead_];
    queueHead_ = (queueHead_ + 1) % QUEUE_DEPTH;
    queueLen_--;
    flushBurst();
    io_.toInverter(frame.data, frame.len);
    report(Tag::Ours, now, frame.data, frame.len);
    state_ = State::Ours;
    sentAt_ = now;
    answered_ = false;
    stats_.ours++;
  }

  if (now - statsSince_ >= STATS_MS) {
    reportStats();
    statsSince_ = now;
  }
}

void Proxy::reportStats() {
  snprintf(line_, sizeof line_, "# stats plug=%lu inverter=%lu ours=%lu timeouts=%lu held=%lu overflow=%lu",
           static_cast<unsigned long>(stats_.plug), static_cast<unsigned long>(stats_.inverter),
           static_cast<unsigned long>(stats_.ours), static_cast<unsigned long>(stats_.timeouts),
           static_cast<unsigned long>(stats_.held), static_cast<unsigned long>(stats_.overflow));
  io_.usbLine(line_);
  stats_ = {};
}

void Proxy::tap(Tag tag, uint8_t b, uint32_t now) {
  if (burstTag_ != tag || burstLen_ == MAX_FRAME) flushBurst();
  if (burstTag_ == Tag::None) {
    burstTag_ = tag;
    burstStart_ = now;
  }
  burst_[burstLen_++] = b;
  burstLast_ = now;
}

void Proxy::flushBurst() {
  if (burstTag_ == Tag::None) return;
  report(burstTag_, burstStart_, burst_, burstLen_);
  burstTag_ = Tag::None;
  burstLen_ = 0;
}

void Proxy::report(Tag tag, uint32_t at, const uint8_t* data, size_t len) {
  const int head = snprintf(line_, sizeof line_, "%s %lu ", tagText(static_cast<int>(tag)),
                            static_cast<unsigned long>(at));
  encodeHex(data, len, line_ + head);
  io_.usbLine(line_);
}

void Proxy::toIdle(uint32_t now) {
  state_ = State::Idle;
  idleSince_ = now;
}

void Proxy::startPlug(uint32_t now) {
  state_ = State::Plug;
  lastPlugByte_ = now;
  answered_ = false;
}

}  // namespace proxy
