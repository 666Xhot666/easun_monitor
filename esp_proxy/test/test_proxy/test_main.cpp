#include <unity.h>

#include <string>
#include <vector>

#include "proxy.h"
#include "proxy_constants.h"

using namespace proxy;

struct FakeIo : ProxyIo {
  std::vector<uint8_t> inverter, plug;
  std::vector<std::string> lines;
  void toInverter(const uint8_t* data, size_t len) override { inverter.insert(inverter.end(), data, data + len); }
  void toPlug(const uint8_t* data, size_t len) override { plug.insert(plug.end(), data, data + len); }
  void usbLine(const char* text) override { lines.emplace_back(text); }
};

static FakeIo* io;
static Proxy* px;

void setUp() {
  io = new FakeIo();
  px = new Proxy(*io);
}
void tearDown() {
  delete px;
  delete io;
}

static const std::vector<uint8_t> REQUEST = {0x01, 0x03, 0x00, 0x00, 0x00, 0x0A, 0xC5, 0xCD};
static const std::vector<uint8_t> REPLY = {0x01, 0x03, 0x02, 0x12, 0x34, 0xB5, 0x33};

static void fromPlug(const std::vector<uint8_t>& bytes, uint32_t at) {
  for (uint8_t b : bytes) px->plugByte(b, at);
}
static void fromInverter(const std::vector<uint8_t>& bytes, uint32_t at) {
  for (uint8_t b : bytes) px->inverterByte(b, at);
}
static void ticks(uint32_t from, uint32_t to) {
  for (uint32_t t = from; t <= to; t++) px->tick(t);
}
static void assertLines(const std::vector<std::string>& expected) {
  TEST_ASSERT_EQUAL_MESSAGE(expected.size(), io->lines.size(), "line count");
  for (size_t i = 0; i < expected.size(); i++) TEST_ASSERT_EQUAL_STRING(expected[i].c_str(), io->lines[i].c_str());
}

static void passes_the_plugs_exchange_through_and_taps_it() {
  fromPlug(REQUEST, 100);
  TEST_ASSERT_TRUE(io->inverter == REQUEST);  // at once, not after the frame
  ticks(100, 140);
  fromInverter(REPLY, 140);
  TEST_ASSERT_TRUE(io->plug == REPLY);
  ticks(140, 200);

  assertLines({"P>I 100 01030000000AC5CD", "I>P 140 0103021234B533"});
}

static void sends_our_request_when_the_line_is_quiet_and_keeps_the_reply() {
  px->usbLine("01030000000AC5CD", 0);
  ticks(0, INJECT_GUARD_MS - 1);
  TEST_ASSERT_TRUE(io->inverter.empty());
  px->tick(INJECT_GUARD_MS);
  TEST_ASSERT_TRUE(io->inverter == REQUEST);

  fromInverter(REPLY, 80);
  ticks(80, 120);
  TEST_ASSERT_TRUE(io->plug.empty());
  assertLines({"D>I 50 01030000000AC5CD", "I>D 80 0103021234B533"});
}

static void waits_for_the_plugs_exchange_to_finish() {
  fromPlug(REQUEST, 100);
  px->usbLine("01030000000AC5CD", 101);
  ticks(100, 300);  // the inverter has not answered the plug yet
  TEST_ASSERT_EQUAL(REQUEST.size(), io->inverter.size());

  fromInverter(REPLY, 300);
  const uint32_t quietFrom = 300 + FRAME_GAP_MS;
  ticks(300, quietFrom + INJECT_GUARD_MS - 1);
  TEST_ASSERT_EQUAL(REQUEST.size(), io->inverter.size());
  px->tick(quietFrom + INJECT_GUARD_MS);
  TEST_ASSERT_EQUAL(2 * REQUEST.size(), io->inverter.size());
}

static void holds_the_plug_while_our_request_is_out() {
  px->usbLine("01030000000AC5CD", 0);
  ticks(0, 50);  // ours goes out at 50
  fromPlug(REQUEST, 60);
  TEST_ASSERT_EQUAL(REQUEST.size(), io->inverter.size());  // the plug's is held

  ticks(60, 89);
  fromInverter(REPLY, 90);
  ticks(90, 90 + FRAME_GAP_MS);
  TEST_ASSERT_EQUAL(2 * REQUEST.size(), io->inverter.size());
  TEST_ASSERT_TRUE(io->plug.empty());  // our reply never reaches the plug

  fromInverter(REPLY, 130);
  TEST_ASSERT_TRUE(io->plug == REPLY);  // the plug's reply does
  ticks(130, 200);
  assertLines({
      "D>I 50 01030000000AC5CD",
      "I>D 90 0103021234B533",
      "P>I 100 01030000000AC5CD",
      "I>P 130 0103021234B533",
  });
}

static void says_when_the_inverter_does_not_answer_us() {
  px->usbLine("01030000000AC5CD", 0);
  ticks(0, 50 + RESPONSE_TIMEOUT_MS - 1);
  TEST_ASSERT_EQUAL(1, io->lines.size());
  px->tick(50 + RESPONSE_TIMEOUT_MS);
  assertLines({"D>I 50 01030000000AC5CD", "# timeout"});

  // and the line is free again
  px->usbLine("01030000000AC5CD", 1100);
  ticks(1100, 1100 + INJECT_GUARD_MS);
  TEST_ASSERT_EQUAL(2 * REQUEST.size(), io->inverter.size());
}

static void frees_the_line_when_the_inverter_ignores_the_plug() {
  fromPlug(REQUEST, 0);
  px->usbLine("01030000000AC5CD", 1);
  ticks(0, RESPONSE_TIMEOUT_MS + INJECT_GUARD_MS - 1);
  TEST_ASSERT_EQUAL(REQUEST.size(), io->inverter.size());
  px->tick(RESPONSE_TIMEOUT_MS + INJECT_GUARD_MS);
  TEST_ASSERT_EQUAL(2 * REQUEST.size(), io->inverter.size());
}

static void refuses_bad_lines_and_a_full_queue() {
  px->usbLine("01 03", 0);
  px->usbLine("", 0);
  for (size_t i = 0; i < QUEUE_DEPTH; i++) px->usbLine("0103", 0);
  px->usbLine("0103", 0);
  assertLines({"# bad", "# bad", "# busy"});
}

static void a_long_burst_splits_into_lines() {
  std::vector<uint8_t> big(MAX_FRAME + 3, 0xAA);
  fromInverter(big, 10);
  ticks(10, 40);
  TEST_ASSERT_EQUAL(2, io->lines.size());
  TEST_ASSERT_EQUAL_STRING("I>P 10 AAAAAA", io->lines[1].c_str());
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(passes_the_plugs_exchange_through_and_taps_it);
  RUN_TEST(sends_our_request_when_the_line_is_quiet_and_keeps_the_reply);
  RUN_TEST(waits_for_the_plugs_exchange_to_finish);
  RUN_TEST(holds_the_plug_while_our_request_is_out);
  RUN_TEST(says_when_the_inverter_does_not_answer_us);
  RUN_TEST(frees_the_line_when_the_inverter_ignores_the_plug);
  RUN_TEST(refuses_bad_lines_and_a_full_queue);
  RUN_TEST(a_long_burst_splits_into_lines);
  return UNITY_END();
}
