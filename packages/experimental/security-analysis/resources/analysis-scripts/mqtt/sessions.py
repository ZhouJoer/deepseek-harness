"""Offline MQTT connection observations; no broker connections."""
from pathlib import Path
import sys
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import context, fields, first, main


def analyze(packets, args):
    """List CONNECT, CONNACK and DISCONNECT observations per TCP stream, including repeated client IDs."""
    result, clients = [], {}
    for packet in packets:
        for index, protocol in enumerate(packet.findall("proto[@name='mqtt']")):
            values = fields(protocol)
            kind = first(values, "mqtt.msgtype")
            if kind not in ("1", "2", "14"):
                continue
            client = first(values, "mqtt.clientid")
            meta = context(packet)
            previous = clients.get(client) if client is not None and kind == "1" else None
            if client is not None and kind == "1":
                clients[client] = meta["stream"]
            result.append({**meta, "pduIndex": index, "messageType": kind, "clientId": client,
                           "previousStream": previous, "fields": {key: values[key] for key in (
                               "mqtt.ver", "mqtt.conack.val", "mqtt.connack.reason_code", "mqtt.disconnect.reason_code", "mqtt.conflag.cleansess",
                               "mqtt.conflag.username", "mqtt.conflag.passwd", "mqtt.kalive") if key in values}})
    return result


if __name__ == "__main__":
    sys.exit(main("mqtt.sessions", __file__, analyze, mqtt=True))
