"""Bench driver: plays the Dell's side of the proxy over USB.

Sends a read through the proxy every PERIOD seconds, checks each reply
against what the rig's fake inverter answers (every register holds its own
address), and counts the plug's traffic passing by.

    python bench/drive.py /dev/cu.usbserial-XX [seconds]
"""
import sys
import time

import serial

BAUD = 460800
PERIOD = 0.3
COUNT = 5


def crc16(data: bytes) -> int:
    crc = 0xFFFF
    for b in data:
        crc ^= b
        for _ in range(8):
            crc = (crc >> 1) ^ 0xA001 if crc & 1 else crc >> 1
    return crc


def with_crc(body: bytes) -> bytes:
    crc = crc16(body)
    return body + bytes([crc & 0xFF, crc >> 8])


def read_request(start: int) -> bytes:
    return with_crc(bytes([1, 3, start >> 8, start & 0xFF, 0, COUNT]))


def fake_reply(start: int) -> bytes:
    values = b"".join((start + i).to_bytes(2, "big") for i in range(COUNT))
    return with_crc(bytes([1, 3, 2 * COUNT]) + values)


def main() -> None:
    port, seconds = sys.argv[1], float(sys.argv[2]) if len(sys.argv) > 2 else 30
    link = serial.Serial(port, BAUD, timeout=0.05)
    counts = dict(sent=0, ok=0, bad=0, timeout=0, busy=0, plug_requests=0, plug_replies=0)
    waiting: list[int] = []  # starts of our reads not answered yet
    start, next_send, pending = 0x2000, time.monotonic(), b""
    end = time.monotonic() + seconds

    while time.monotonic() < end:
        if time.monotonic() >= next_send:
            link.write(read_request(start).hex().upper().encode() + b"\n")
            waiting.append(start)
            counts["sent"] += 1
            start = 0x2000 + (start - 0x2000 + COUNT) % 0x1000
            next_send += PERIOD
        pending += link.read(4096)
        *lines, pending = pending.split(b"\n")
        for raw in lines:
            line = raw.decode(errors="replace").strip()
            tag = line.split(" ")[0]
            if tag == "P>I":
                counts["plug_requests"] += 1
            elif tag == "I>P":
                counts["plug_replies"] += 1
            elif tag == "I>D" and waiting:
                got = bytes.fromhex(line.split(" ")[2])
                counts["ok" if got == fake_reply(waiting.pop(0)) else "bad"] += 1
            elif line == "# timeout" and waiting:
                waiting.pop(0)
                counts["timeout"] += 1
            elif line == "# busy" and waiting:
                waiting.pop()
                counts["busy"] += 1
            elif line.startswith("#"):
                print(line)

    print(" ".join(f"{k}={v}" for k, v in counts.items()))


if __name__ == "__main__":
    main()
