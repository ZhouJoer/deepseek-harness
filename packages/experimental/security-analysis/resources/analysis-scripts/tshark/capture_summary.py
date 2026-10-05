"""Capture inventory without executing or contacting a target."""
from collections import Counter
from pathlib import Path
import sys
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import context, fields, first, main


def analyze(packets, args):
    """Summarize protocols, endpoints and TCP conversations in the selected frames."""
    protocols, endpoints, streams = Counter(), Counter(), {}
    times = []
    for packet in packets:
        meta, values = context(packet), fields(packet)
        if meta["time"] is not None:
            times.append(float(meta["time"]))
        protocols.update((first(values, "frame.protocols") or "unknown").split(":"))
        endpoints.update(value for value in (meta["source"], meta["destination"]) if value)
        if meta["stream"] is not None:
            stream = streams.setdefault(meta["stream"], {"kind": "tcp-session", **meta, "frames": 0})
            stream["frames"] += 1
    return [{"kind": "capture", "frames": len(packets), "start": min(times) if times else None,
             "end": max(times) if times else None}] + [
        {"kind": "protocol", "name": key, "frames": count} for key, count in protocols.most_common()] + [
        {"kind": "endpoint", "address": key, "frames": count} for key, count in endpoints.most_common()] + list(streams.values())


if __name__ == "__main__":
    sys.exit(main("tshark.capture-summary", __file__, analyze))
