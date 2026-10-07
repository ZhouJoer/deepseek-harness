"""Wi-Fi and BLE observations from recorded frames, without contacting devices."""
from collections import Counter
from pathlib import Path
import sys
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import context, fields, first, main


WIFI = ("wlan.fc.type_subtype", "wlan.bssid", "wlan.sa", "wlan.da", "wlan.ssid",
        "wlan.ds.current_channel", "radiotap.channel.freq", "radiotap.dbm_antsignal",
        "wlan.fixed.capabilities.privacy", "wlan.rsn.version", "wlan.rsn.akms.type",
        "wlan.rsn.pcs.type", "wlan.fc.protected")
BLE = ("btle.advertising_header.pdu_type", "btle.advertising_address", "btle.access_address",
       "btcommon.eir_ad.entry.device_name", "btcommon.eir_ad.entry.uuid_16",
       "btcommon.eir_ad.entry.uuid_128", "btatt.opcode", "btatt.handle", "btatt.uuid16",
       "btatt.uuid128", "bthci_acl.handle", "bthci_evt.bd_addr")


def configure(cli):
    cli.add_argument("--protocol", choices=("wifi", "ble"), required=True)
    cli.add_argument("--mode", choices=("summary", "packets"), required=True)


def analyze(packets, args):
    """Report decoded wireless fields and distinguish air, HCI and IP observations."""
    records, kinds, peers = [], Counter(), {}
    selected = WIFI if args.protocol == "wifi" else BLE
    for packet in packets:
        values = fields(packet)
        protocols = (first(values, "frame.protocols") or "").split(":")
        if "wlan" in protocols:
            kind = "wifi-air"
        elif any(name.startswith("bthci_") for name in protocols):
            kind = "bluetooth-hci"
        elif "btle" in protocols:
            kind = "ble-air"
        elif "ip" in protocols or "ipv6" in protocols:
            kind = "ip"
        else:
            kind = "other"
        kinds[kind] += 1
        if not (args.protocol == "wifi" and kind == "wifi-air" or
                args.protocol == "ble" and kind in ("ble-air", "bluetooth-hci")):
            continue
        metadata = context(packet)
        observed = {key: values[key] for key in selected if key in values}
        for field in packet.iter("field"):
            if field.get("name") == "wlan.ssid" and field.get("value"):
                try:
                    observed.setdefault("ssid.utf8", []).append(bytes.fromhex(field.get("value")).decode("utf-8"))
                except (ValueError, UnicodeError) as error:
                    pass  # Non-UTF-8 SSIDs retain their original byte representation.
        record = {"kind": kind, "frame": metadata["frame"], "time": metadata["time"], "fields": observed}
        if args.mode == "packets":
            records.append(record)
        else:
            peer = (first(values, "wlan.bssid") or first(values, "btle.advertising_address") or
                    first(values, "bthci_evt.bd_addr") or first(values, "btle.access_address") or
                    first(values, "bthci_acl.handle") or "unattributed")
            key = (kind, peer)
            item = peers.setdefault(key, {"kind": kind, "peer": peer, "frames": 0,
                                          "firstFrame": metadata["frame"], "firstTime": metadata["time"], "fields": {}})
            item.update(lastFrame=metadata["frame"], lastTime=metadata["time"])
            item["frames"] += 1
            for field, entries in observed.items():
                bucket = item["fields"].setdefault(field, [])
                for value in entries:
                    if value not in bucket:
                        bucket.append(value)
    matched = len(records) if args.mode == "packets" else sum(item["frames"] for item in peers.values())
    return [{"kind": "capture", "protocol": args.protocol, "mode": args.mode, "frames": len(packets),
             "matchedFrames": matched, "captureKinds": dict(kinds),
             "interpretation": "Recorded decoded fields only; absent fields, encrypted payloads and unobserved frames remain unknown."}] + (
        records if args.mode == "packets" else list(peers.values()))


if __name__ == "__main__":
    sys.exit(main("tshark.wireless", __file__, analyze, configure=configure))
