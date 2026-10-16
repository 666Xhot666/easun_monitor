#include <unity.h>

#include <string.h>

#include "crc16.h"
#include "fake_modbus.h"

void setUp() {}
void tearDown() {}

static void builds_a_read_request() {
  uint8_t req[8];
  TEST_ASSERT_EQUAL(8, readRequest(0x01, 0x0000, 0x000A, req));
  const uint8_t expected[] = {0x01, 0x03, 0x00, 0x00, 0x00, 0x0A, 0xC5, 0xCD};
  TEST_ASSERT_EQUAL_HEX8_ARRAY(expected, req, 8);
}

static void answers_a_read_with_each_registers_address() {
  uint8_t req[8];
  readRequest(0x01, 0x0100, 2, req);
  uint8_t reply[64];
  const size_t len = fakeReadReply(req, sizeof req, reply, sizeof reply);
  TEST_ASSERT_EQUAL(9, len);
  const uint8_t head[] = {0x01, 0x03, 0x04, 0x01, 0x00, 0x01, 0x01};
  TEST_ASSERT_EQUAL_HEX8_ARRAY(head, reply, 7);
  const uint16_t crc = crc16Modbus(reply, 7);
  TEST_ASSERT_EQUAL_HEX8(crc & 0xFF, reply[7]);
  TEST_ASSERT_EQUAL_HEX8(crc >> 8, reply[8]);
}

static void ignores_what_is_not_a_good_read() {
  uint8_t req[8], reply[300];
  readRequest(0x01, 0x0000, 1, req);
  req[7] ^= 0xFF;  // broken CRC
  TEST_ASSERT_EQUAL(0, fakeReadReply(req, 8, reply, sizeof reply));
  readRequest(0x01, 0x0000, 1, req);
  TEST_ASSERT_EQUAL(0, fakeReadReply(req, 7, reply, sizeof reply));  // short
  readRequest(0x01, 0x0000, 126, req);
  TEST_ASSERT_EQUAL(0, fakeReadReply(req, 8, reply, sizeof reply));  // too many
  readRequest(0x01, 0x0000, 4, req);
  TEST_ASSERT_EQUAL(0, fakeReadReply(req, 8, reply, 10));  // no room
}

static void recognises_the_reply_to_a_request() {
  uint8_t req[8], reply[64];
  readRequest(0x01, 0x0020, 3, req);
  const size_t len = fakeReadReply(req, 8, reply, sizeof reply);
  TEST_ASSERT_TRUE(isReadReplyFor(req, reply, len));
  TEST_ASSERT_FALSE(isReadReplyFor(req, reply, len - 1));
  reply[4] ^= 0x01;
  TEST_ASSERT_FALSE(isReadReplyFor(req, reply, len));
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(builds_a_read_request);
  RUN_TEST(answers_a_read_with_each_registers_address);
  RUN_TEST(ignores_what_is_not_a_good_read);
  RUN_TEST(recognises_the_reply_to_a_request);
  return UNITY_END();
}
