#include <unity.h>

#include "crc16.h"
#include "hex.h"

void setUp() {}
void tearDown() {}

static void crc_of_a_read_request() {
  const uint8_t frame[] = {0x01, 0x03, 0x00, 0x00, 0x00, 0x0A};
  // Sent low byte first: 01 03 00 00 00 0A C5 CD
  TEST_ASSERT_EQUAL_HEX16(0xCDC5, crc16Modbus(frame, sizeof frame));
}

static void crc_of_nothing() {
  TEST_ASSERT_EQUAL_HEX16(0xFFFF, crc16Modbus(nullptr, 0));
}

static void encodes_upper_case_without_spaces() {
  const uint8_t data[] = {0x01, 0xAB, 0x00, 0xFF};
  char out[16];
  TEST_ASSERT_EQUAL(8, encodeHex(data, sizeof data, out));
  TEST_ASSERT_EQUAL_STRING("01AB00FF", out);
}

static void decodes_either_case() {
  uint8_t out[4];
  TEST_ASSERT_EQUAL(3, decodeHex("01abFF", out, sizeof out));
  TEST_ASSERT_EQUAL_HEX8(0x01, out[0]);
  TEST_ASSERT_EQUAL_HEX8(0xAB, out[1]);
  TEST_ASSERT_EQUAL_HEX8(0xFF, out[2]);
}

static void refuses_what_is_not_whole_bytes() {
  uint8_t out[4];
  TEST_ASSERT_EQUAL(-1, decodeHex("01A", out, sizeof out));
  TEST_ASSERT_EQUAL(-1, decodeHex("0G", out, sizeof out));
  TEST_ASSERT_EQUAL(-1, decodeHex("01 02", out, sizeof out));
  TEST_ASSERT_EQUAL(-1, decodeHex("0102030405", out, sizeof out));
  TEST_ASSERT_EQUAL(-1, decodeHex("", out, sizeof out));
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(crc_of_a_read_request);
  RUN_TEST(crc_of_nothing);
  RUN_TEST(encodes_upper_case_without_spaces);
  RUN_TEST(decodes_either_case);
  RUN_TEST(refuses_what_is_not_whole_bytes);
  return UNITY_END();
}
