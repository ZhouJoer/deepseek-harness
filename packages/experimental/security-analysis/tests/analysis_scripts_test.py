"""Real bundled-script checks using private offline captures and temporary outputs."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
from contextlib import redirect_stdout, redirect_stderr
import io
import runpy

ROOT = Path(__file__).resolve().parents[1] / "resources" / "analysis-scripts"
spec = importlib.util.spec_from_file_location("analysis_common", ROOT / "common.py")
common = importlib.util.module_from_spec(spec)
spec.loader.exec_module(common)


def capture(subscriptions=False):
    packets = []
    client_seq, server_seq = 100, 200

    def frame(payload=b"", reverse=False, flags=0x18):
        nonlocal client_seq, server_seq
        seq = server_seq if reverse else client_seq
        src, dst = (b"\x0a\x00\x00\x02", b"\x0a\x00\x00\x01") if reverse else (b"\x0a\x00\x00\x01", b"\x0a\x00\x00\x02")
        tcp = struct.pack("!HHIIBBHHH", 2883 if reverse else 40000, 40000 if reverse else 2883,
                          seq, client_seq if reverse else server_seq, 0x50, flags, 65535, 0, 0) + payload
        ip = struct.pack("!BBHHHBBH4s4s", 0x45, 0, 20 + len(tcp), len(packets), 0, 64, 6, 0, src, dst)
        packets.append(b"\x00" * 12 + b"\x08\x00" + ip + tcp)
        advance = len(payload) + (1 if flags & 2 else 0)
        if reverse:
            server_seq += advance
        else:
            client_seq += advance

    frame(flags=2)
    frame(reverse=True, flags=0x12)
    frame(flags=0x10)
    frame(b"\x10\x10\x00\x04MQTT\x04\x02\x00\x3c\x00\x04test")
    frame(b"\x20\x02\x00\x00", reverse=True)
    frame(b"\x30\x06\x00\x03a/bx\x31\x06\x00\x03c/dy")
    frame(b"\x30\x06\x00\x03")
    frame(b"e/fz")
    if subscriptions:
        frame(b"\x82\x08\x00\x01\x00\x03a/b\x01")
        frame(b"\x32\x08\x00\x03a/b\x00\x02z")
        frame(b"\xa2\x07\x00\x03\x00\x03a/b")
    frame(b"\xe0\x00")
    header = struct.pack("<IHHIIII", 0xa1b2c3d4, 2, 4, 0, 0, 65535, 1)
    return header + b"".join(struct.pack("<IIII", 1700000000 + index, 0, len(packet), len(packet)) + packet
                             for index, packet in enumerate(packets))


class PreparationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="dsh-analysis-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_dynamic_preparation_and_no_overwrite(self):
        output = self.root / "prepared.js"
        args = [sys.executable, str(ROOT / "dynamic/prepare.py"), "function-trace", "--output", str(output),
                "--max-events", "4", "--module", 'quoted"module', "--symbol", "func", "--stack-depth", "8"]
        result = subprocess.run(args, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["scriptSha256"], common.digest(output))
        self.assertIn(b'quoted\\"module', output.read_bytes())
        self.assertNotEqual(subprocess.run(args, capture_output=True, timeout=10).returncode, 0)

    def test_module_template_and_invalid_parameters(self):
        output = self.root / "modules.js"
        args = [sys.executable, str(ROOT / "dynamic/prepare.py"), "module-watch", "--output", str(output), "--max-events", "3"]
        self.assertEqual(subprocess.run(args, capture_output=True, timeout=10).returncode, 0)
        self.assertNotEqual(subprocess.run(args + ["--module", "invalid"], capture_output=True, timeout=10).returncode, 0)

    def test_script_loading_leaves_library_unchanged(self):
        library = self.root / "library"
        shutil.copytree(ROOT, library, ignore=shutil.ignore_patterns("__pycache__"))
        before = sorted(str(path.relative_to(library)) for path in library.rglob("*"))
        for entry in ("tshark/capture_summary.py", "tshark/extract_packets.py", "mqtt/sessions.py", "mqtt/topics.py"):
            result = subprocess.run([sys.executable, str(library / entry), "--help"], capture_output=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(sorted(str(path.relative_to(library)) for path in library.rglob("*")), before)

    def test_subprocess_bounds(self):
        with self.assertRaises(ValueError):
            common.run([sys.executable, "-c", "print('x' * 100000)"], 10, 100)
        with self.assertRaises(subprocess.TimeoutExpired):
            common.run([sys.executable, "-c", "import time; time.sleep(60)"], 0.1, 1000)

    def test_runner_marks_script_limit_incomplete_and_cleans_up(self):
        cleaned = []
        class Script:
            def on(self, name, callback):
                self.callback = callback
            def load(self):
                self.callback({"type": "send", "payload": {"event": "limit", "incomplete": True}}, None)
            def unload(self):
                cleaned.append("unload")
        class Session:
            is_detached = False
            def on(self, *args):
                pass
            def off(self, *args):
                pass
            def create_script(self, source):
                return Script()
            def detach(self):
                cleaned.append("detach")
        # The provider's process identity and immutable-script checks are exercised in its owning tests.
        device = types.SimpleNamespace(type="usb", attach=lambda pid: Session(),
            enumerate_processes=lambda **kwargs: [types.SimpleNamespace(pid=10, name="owned", parameters={"started": "1"})],
            enumerate_applications=lambda **kwargs: [types.SimpleNamespace(pid=10, identifier="owned.fixture")])
        frida = types.SimpleNamespace(get_local_device=lambda: device, __version__="fixture")
        request = {"operation": "script", "durationMs": 1000, "maxOutputBytes": 65536, "cancelPath": str(self.root / "cancel"),
                   "deviceId": "local", "target": {"mode": "attach", "pid": 10, "name": "owned", "started": "1"},
                   "sampleHash": "fixture", "packageName": "owned.fixture", "script": "fixture"}
        output = io.StringIO()
        handlers = {sig: common.signal.getsignal(sig) for sig in (common.signal.SIGTERM, common.signal.SIGINT)}
        try:
            with patch.dict(sys.modules, {"frida": frida}), patch("sys.stdin", io.StringIO(json.dumps(request))), redirect_stdout(output), redirect_stderr(io.StringIO()):
                runpy.run_path(str(ROOT.parent / "frida_runner.py"))
        finally:
            for sig, handler in handlers.items():
                common.signal.signal(sig, handler)
        self.assertTrue(json.loads(output.getvalue())["incomplete"])
        self.assertEqual(cleaned, ["unload", "detach"])


@unittest.skipUnless(os.environ.get("TSHARK_EXE") or shutil.which("tshark"), "Real TShark is not installed")
class CaptureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="dsh capture ")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "\u62a5\u6587"
        self.root.mkdir()
        self.input = self.root / "input capture.pcap"
        self.input.write_bytes(capture())
        self.tshark = str(Path(os.environ.get("TSHARK_EXE") or shutil.which("tshark")).resolve())
        self.counter = 0

    def run_script(self, script, extra=(), success=True):
        self.counter += 1
        output = self.root / (str(self.counter) + ".json")
        args = [sys.executable, str(ROOT / script), "--input", str(self.input), "--output", str(output),
                "--tshark", self.tshark, "--timeout", "10", "--max-packets", "100", "--max-output-bytes", "65536",
                "--max-decode-bytes", "16777216", *extra]
        result = subprocess.run(args, cwd=self.root, capture_output=True, timeout=30)
        if not success:
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(output.exists())
            return result
        self.assertEqual(result.returncode, 0, result.stderr.decode(errors="replace"))
        self.assertEqual(result.stdout, output.read_bytes())
        return json.loads(result.stdout)

    def test_inventory_and_filtered_packets(self):
        summary = self.run_script("tshark/capture_summary.py")
        self.assertEqual(summary["records"][0]["frames"], 9)
        self.assertEqual(summary["inputSha256"], common.digest(self.input))
        selected = self.run_script("tshark/extract_packets.py", ["--stream", "0", "--filter", "frame.number == 4", "--field", "tcp.dstport"])
        self.assertEqual(len(selected["records"]), 1)
        self.assertEqual(selected["records"][0]["fields"]["tcp.dstport"], ["2883"])

    def test_mqtt_multiple_pdus_and_reassembly(self):
        sessions = self.run_script("mqtt/sessions.py", ["--mqtt-port", "2883"])
        self.assertEqual([item["messageType"] for item in sessions["records"]], ["1", "2", "14"])
        self.assertEqual(sessions["records"][0]["clientId"], "test")
        topics = self.run_script("mqtt/topics.py", ["--mqtt-port", "2883"])
        summaries = [item for item in topics["records"] if item.get("kind") == "topic-summary"]
        self.assertEqual([item["topic"] for item in summaries], ["a/b", "c/d", "e/f"])
        events = [item for item in topics["records"] if "pduIndex" in item]
        self.assertEqual([item["pduIndex"] for item in events[:2]], [0, 1])
        self.assertEqual(events[2]["frame"], "8")

    def test_pcapng_subscriptions_and_qos(self):
        self.input.write_bytes(capture(subscriptions=True))
        converted = self.root / "capture.pcapng"
        conversion = subprocess.run([self.tshark, "-n", "-r", str(self.input), "-F", "pcapng", "-w", str(converted)],
                                    capture_output=True, timeout=10)
        self.assertEqual(conversion.returncode, 0, conversion.stderr)
        self.input = converted
        topics = self.run_script("mqtt/topics.py", ["--mqtt-port", "2883"])
        events = [item for item in topics["records"] if "pduIndex" in item]
        self.assertEqual([item["messageType"] for item in events], ["3", "3", "3", "8", "3", "10"])
        self.assertEqual(events[4]["fields"]["mqtt.qos"], ["1"])
        self.assertEqual(events[3]["topics"], ["a/b"])

    def test_limits_empty_capture_and_failures(self):
        limited = self.run_script("tshark/capture_summary.py", ["--max-packets", "3", "--filter", "tcp.port == 1"])
        self.assertTrue(limited["incomplete"])
        truncated = self.run_script("tshark/extract_packets.py", ["--max-output-bytes", "1700"])
        self.assertTrue(truncated["incomplete"])
        self.run_script("tshark/extract_packets.py", ["--max-output-bytes", "10"], success=False)
        self.run_script("tshark/extract_packets.py", ["--filter", "(broken"], success=False)
        self.run_script("mqtt/topics.py", ["--mqtt-port", "65536"], success=False)
        self.run_script("tshark/extract_packets.py", ["--tshark", str(self.root / "missing.exe")], success=False)
        self.input.write_bytes(capture()[:24])
        self.assertEqual(self.run_script("tshark/capture_summary.py")["records"][0]["frames"], 0)
        self.input.write_bytes(b"invalid capture")
        self.run_script("tshark/capture_summary.py", success=False)


if __name__ == "__main__":
    unittest.main()
