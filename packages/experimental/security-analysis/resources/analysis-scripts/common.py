"""Bounded offline TShark collection shared by the bundled analysis scripts."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import xml.etree.ElementTree as ET


def positive(value):
    number = int(value)
    if number <= 0:
        raise argparse.ArgumentTypeError("Expected a positive integer")
    return number


def parser(description, mqtt=False):
    result = argparse.ArgumentParser(description=description)
    result.add_argument("--input", required=True, type=Path)
    result.add_argument("--output", required=True, type=Path)
    result.add_argument("--tshark", required=True, type=Path)
    result.add_argument("--timeout", required=True, type=positive, help="Seconds per TShark invocation")
    result.add_argument("--max-packets", required=True, type=positive, help="Maximum input frames inspected, before filtering")
    result.add_argument("--max-output-bytes", required=True, type=positive)
    result.add_argument("--max-decode-bytes", required=True, type=positive, help="Maximum decoded XML plus diagnostics")
    result.add_argument("--filter", default="", help="TShark display filter")
    result.add_argument("--stream", type=int, help="TCP stream number")
    if mqtt:
        result.add_argument("--mqtt-port", type=positive, action="append", default=[], help="TCP port to decode as MQTT (repeatable)")
    return result


def digest(path):
    hasher = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(65536), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def run(argv, timeout, limit):
    """Drain both pipes while bounding memory; always reap the owned process."""
    env = {key: value for key, value in os.environ.items()
           if not any(word in key.upper() for word in ("KEY", "SECRET", "TOKEN", "PASSWORD"))}
    child = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, env=env)
    buffers = [bytearray(), bytearray()]
    overflow = threading.Event()
    lock = threading.Lock()

    def drain(pipe, index):
        with pipe:
            for chunk in iter(lambda: pipe.read(4096), b""):
                with lock:
                    remaining = max(0, limit - sum(map(len, buffers)))
                    buffers[index].extend(chunk[:remaining])
                    if len(chunk) > remaining:
                        overflow.set()
                        child.kill()

    readers = [threading.Thread(target=drain, args=(pipe, index))
               for index, pipe in enumerate((child.stdout, child.stderr))]
    for reader in readers:
        reader.start()
    try:
        child.wait(timeout=timeout)
    finally:
        if child.poll() is None:
            child.kill()
        child.wait()
        for reader in readers:
            reader.join()
    if overflow.is_set():
        raise ValueError("Decoded output exceeded --max-decode-bytes; narrow the capture or raise the limit")
    error = buffers[1].decode("utf-8", errors="replace").strip()
    if child.returncode:
        raise ValueError("TShark exited %s: %s" % (child.returncode, error))
    return bytes(buffers[0]), error


def fields(element):
    result = {}
    for field in element.iter("field"):
        name = field.get("name")
        if name:
            result.setdefault(name, []).append(field.get("show", field.get("value", "")))
    return result


def first(values, name):
    return values.get(name, [None])[0]


def context(packet):
    values = fields(packet)
    return {"frame": first(values, "frame.number"), "time": first(values, "frame.time_epoch"),
            "stream": first(values, "tcp.stream"),
            "source": first(values, "ip.src") or first(values, "ipv6.src"),
            "destination": first(values, "ip.dst") or first(values, "ipv6.dst")}


def collect(args):
    for name in ("input", "output", "tshark"):
        if not getattr(args, name).is_absolute():
            raise ValueError("--%s must be an absolute path" % name)
    if not args.input.is_file() or not args.tshark.is_file():
        raise ValueError("Input capture and explicitly selected TShark executable must exist")
    if args.output.exists():
        raise ValueError("Output already exists; choose a new run output path")
    if args.stream is not None and args.stream < 0:
        raise ValueError("TCP stream must be nonnegative")
    version, _ = run([str(args.tshark), "--version"], args.timeout, args.max_decode_bytes)
    filters = [args.filter] if args.filter else []
    if args.stream is not None:
        filters.append("tcp.stream == %d" % args.stream)
    argv = [str(args.tshark), "-n", "-2", "-r", str(args.input), "-c", str(args.max_packets + 1), "-T", "pdml"]
    for port in getattr(args, "mqtt_port", []):
        if port > 65535:
            raise ValueError("MQTT port must be between 1 and 65535")
        argv.extend(["-d", "tcp.port==%d,mqtt" % port])
    # Keep one sentinel frame even when a display filter excludes it.
    if filters:
        argv.extend(["-Y", "(" + ") && (".join(filters) + ") || frame.number == %d" % (args.max_packets + 1)])
    raw, diagnostic = run(argv, args.timeout, args.max_decode_bytes)
    packets = ET.fromstring(raw).findall("packet")
    bounded = [packet for packet in packets if int(context(packet)["frame"]) <= args.max_packets]
    warnings = [diagnostic] if diagnostic else []
    if len(bounded) != len(packets):
        warnings.append("Input frame limit reached; later frames and reassembly are not included")
    for packet in bounded:
        names = fields(packet)
        if "_ws.malformed" in names or any(p.get("name") == "_ws.malformed" for p in packet.iter("proto")):
            warnings.append("Malformed protocol data was reported by TShark")
        if "tcp.analysis.lost_segment" in names:
            warnings.append("TCP capture has missing segments; decoded messages may be incomplete")
        if "mqtt.unknown_version" in names or "mqtt.unknown_topic_alias" in names:
            warnings.append("MQTT version or topic alias could not be resolved from this capture")
        if first(names, "frame.cap_len") != first(names, "frame.len"):
            warnings.append("Some frame bytes were not captured")
    if hasattr(args, "mqtt_port") and not any(packet.findall("proto[@name='mqtt']") for packet in bounded):
        warnings.append("No MQTT messages decoded; check capture scope, plaintext TCP port and encryption")
    return bounded, version.decode("utf-8", errors="replace").splitlines()[0], list(dict.fromkeys(warnings))


def main(script_id, entry, analyze, mqtt=False, configure=None):
    cli = parser(analyze.__doc__, mqtt)
    if configure:
        configure(cli)
    args = cli.parse_args()

    def interrupted(signum, frame):
        raise InterruptedError("Analysis interrupted")

    signal.signal(signal.SIGTERM, interrupted)
    try:
        input_hash = digest(args.input)
        packets, version, warnings = collect(args)
        records = analyze(packets, args)
        if digest(args.input) != input_hash:
            raise ValueError("Input capture changed during analysis")
        result = {"scriptId": script_id, "scriptSha256": digest(Path(entry)),
                  "supportSha256": digest(Path(__file__)), "inputSha256": input_hash,
                  "toolVersion": version, "parameters": {k: str(v) if isinstance(v, Path) else v for k, v in vars(args).items()},
                  "incomplete": bool(warnings), "warnings": warnings, "records": records}
        def encode():
            return (json.dumps(result, ensure_ascii=True, separators=(",", ":")) + "\n").encode("utf-8")
        encoded = encode()
        if len(encoded) > args.max_output_bytes:
            result["incomplete"] = True
            warnings.append("Result byte limit reached; records omitted")
            low, high = 0, len(records)
            while low < high:
                middle = (low + high + 1) // 2
                result["records"] = records[:middle]
                if len(encode()) <= args.max_output_bytes:
                    low = middle
                else:
                    high = middle - 1
            result["records"] = records[:low]
            encoded = encode()
            if len(encoded) > args.max_output_bytes:
                raise ValueError("--max-output-bytes cannot hold result metadata")
        with args.output.open("xb") as output:
            output.write(encoded)
        sys.stdout.buffer.write(encoded)
    except (OSError, ValueError, ET.ParseError, subprocess.TimeoutExpired, KeyboardInterrupt) as error:
        print(type(error).__name__ + ": " + str(error), file=sys.stderr)
        return 1
    return 0
