"""Offline MQTT publish and subscription metadata without message payloads."""
from collections import Counter
from pathlib import Path
import sys
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import context, fields, first, main


def analyze(packets, args):
    """Summarize topic observations and preserve each MQTT PDU's publish/subscribe timeline."""
    timeline, counts = [], Counter()
    for packet in packets:
        for index, protocol in enumerate(packet.findall("proto[@name='mqtt']")):
            values = fields(protocol)
            kind = first(values, "mqtt.msgtype")
            if kind not in ("3", "8", "9", "10", "11"):
                continue
            topics = values.get("mqtt.topic", [])
            counts.update((kind, topic) for topic in topics)
            timeline.append({**context(packet), "pduIndex": index, "messageType": kind, "topics": topics,
                             "fields": {key: values[key] for key in ("mqtt.qos", "mqtt.retain", "mqtt.dupflag",
                                         "mqtt.msgid", "mqtt.sub.qos", "mqtt.subscription_options_qos", "mqtt.suback.qos",
                                         "mqtt.suback.reason_code", "mqtt.unsuback.reason_code", "mqtt.property.topic_alias") if key in values}})
    return [{"kind": "topic-summary", "messageType": kind, "topic": topic, "count": count}
            for (kind, topic), count in sorted(counts.items())] + timeline


if __name__ == "__main__":
    sys.exit(main("mqtt.topics", __file__, analyze, mqtt=True))
