"""Synthetic radio captures decoded by the installed TShark, with no live interfaces."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "resources/analysis-scripts/tshark/wireless.py"


def pcap(link_type, frames):
    return struct.pack("<IHHIIII", 0xa1b2c3d4, 2, 4, 0, 0, 65535, link_type) + b"".join(
        struct.pack("<IIII", 1700000000 + index, 0, len(frame), len(frame)) + frame
        for index, frame in enumerate(frames))


def beacon():
    return (b"\x80\x00\x00\x00" + b"\xff" * 6 + b"\x02\x00\x00\x00\x00\x01" * 2 + b"\x00\x00" +
            b"\x00" * 8 + b"\x64\x00\x11\x00" + b"\x00\x07Fixture\x03\x01\x06")


class WirelessTests(unittest.TestCase):
    def setUp(self):
        self.tshark = os.environ.get("DSH_SECURITY_TSHARK") or shutil.which("tshark")
        if not self.tshark:
            self.skipTest("TShark unavailable; real decoding not verified")
        self.temp = tempfile.TemporaryDirectory(prefix="dsh-wireless-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.input = self.root / "capture.pcap"

    def decode(self, protocol, mode="summary", extra=(), success=True):
        destination = self.root / ("result-%s.json" % len(list(self.root.glob("*.json"))))
        command = [sys.executable, str(SCRIPT), "--input", str(self.input), "--output", str(destination),
                   "--tshark", self.tshark, "--timeout", "10", "--max-packets", "100",
                   "--max-decode-bytes", "1000000", "--max-output-bytes", "10000",
                   "--protocol", protocol, "--mode", mode, *extra]
        result = subprocess.run(command, capture_output=True, timeout=30)
        self.assertEqual(result.returncode == 0, success, result.stderr)
        if not success:
            self.assertFalse(destination.exists())
            return
        data = json.loads(result.stdout)
        self.assertEqual(destination.read_bytes(), result.stdout)
        self.assertEqual(data["inputSha256"], hashlib.sha256(self.input.read_bytes()).hexdigest())
        return data

    def test_wifi_fields_and_pcapng(self):
        self.input.write_bytes(pcap(105, [beacon()]))
        data = self.decode("wifi")
        self.assertEqual(data["records"][0]["captureKinds"], {"wifi-air": 1})
        self.assertEqual(data["records"][1]["fields"]["ssid.utf8"], ["Fixture"])
        self.assertEqual(data["records"][1]["fields"]["wlan.ds.current_channel"], ["6"])
        self.assertNotIn("radiotap.dbm_antsignal", data["records"][1]["fields"])
        converted = self.root / "capture.pcapng"
        result = subprocess.run([self.tshark, "-n", "-r", str(self.input), "-F", "pcapng", "-w", str(converted)], capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.input = converted
        self.assertEqual(self.decode("wifi", "packets")["records"][1]["frame"], "1")

    def test_ble_air_and_hci_are_distinct(self):
        advertisement = b"\xd6\xbe\x89\x8e\x02\x13" + b"\x01\x00\x00\x00\x00\x02" + b"\x02\x01\x06\x05\x09Test\x03\x03\x0f\x18" + b"\x00" * 3
        self.input.write_bytes(pcap(251, [advertisement]))
        data = self.decode("ble", "packets")
        self.assertEqual(data["records"][0]["captureKinds"], {"ble-air": 1})
        self.assertEqual(data["records"][1]["fields"]["btcommon.eir_ad.entry.device_name"], ["Test"])
        self.assertIn("btcommon.eir_ad.entry.uuid_16", data["records"][1]["fields"])
        self.input.write_bytes(pcap(201, [b"\x00\x00\x00\x01\x04\x0e\x04\x01\x03\x0c\x00"]))
        self.assertEqual(self.decode("ble")["records"][0]["captureKinds"], {"bluetooth-hci": 1})

    def test_signal_protected_payload_and_recorded_att(self):
        radiotap = struct.pack("<BBHIHHb", 0, 0, 13, 0x28, 2437, 0x00a0, -42)
        self.input.write_bytes(pcap(127, [radiotap + beacon()]))
        observed = self.decode("wifi")["records"][1]["fields"]
        self.assertEqual(observed["radiotap.dbm_antsignal"], ["-42"])
        self.assertIn("wlan.fixed.capabilities.privacy", observed)
        protected = b"\x08\x40" + beacon()[2:24] + b"\x01\x00\x00\x20" + b"\x00" * 4 + b"\xfe" * 16
        self.input.write_bytes(pcap(105, [protected]))
        observed = self.decode("wifi", "packets")["records"][1]["fields"]
        self.assertEqual(observed["wlan.fc.protected"], ["True"])
        self.assertNotIn("ssid.utf8", observed)
        # HCI ACL carries an actual ATT write request on the fixed ATT channel.
        acl = bytes.fromhex("000000010201200900050004001225000102")
        self.input.write_bytes(pcap(201, [acl]))
        observed = self.decode("ble", "packets")["records"][1]
        self.assertEqual(observed["kind"], "bluetooth-hci")
        self.assertIn("btatt.opcode", observed["fields"])
        self.assertIn("btatt.handle", observed["fields"])

    def test_limits_unmatched_and_invalid_inputs(self):
        self.input.write_bytes(pcap(105, [beacon(), beacon()]))
        self.assertTrue(self.decode("wifi", extra=("--max-packets", "1"))["incomplete"])
        self.assertEqual(self.decode("ble")["records"][0]["matchedFrames"], 0)
        self.decode("wifi", extra=("--max-output-bytes", "10"), success=False)
        self.decode("wifi", extra=("--max-decode-bytes", "10"), success=False)
        self.decode("wifi", extra=("--filter", "(broken"), success=False)
        self.input.write_bytes(pcap(105, [beacon()] * 10))
        bounded = self.decode("wifi", "packets", extra=("--max-output-bytes", "2000"))
        self.assertTrue(bounded["incomplete"])
        self.assertLess(len(bounded["records"]), 11)
        self.input.write_bytes(pcap(101, [bytes.fromhex("4500001c00000000401100000a0000010a00000204d2162e00080000")]))
        self.assertEqual(self.decode("wifi")["records"][0]["captureKinds"], {"ip": 1})
        self.input.write_bytes(b"invalid capture")
        self.decode("wifi", success=False)


if __name__ == "__main__":
    unittest.main()
