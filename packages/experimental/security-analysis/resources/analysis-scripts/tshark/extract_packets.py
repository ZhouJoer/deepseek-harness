"""Selected packet metadata, with explicit optional decoded fields."""
from pathlib import Path
import sys
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import context, fields, first, main


def configure(cli):
    cli.add_argument("--field", action="append", default=[], help="Additional TShark field (repeatable)")


def analyze(packets, args):
    """Extract packet identities and selected fields using a display filter or TCP stream."""
    result = []
    for packet in packets:
        values = fields(packet)
        result.append({**context(packet), "protocols": first(values, "frame.protocols"),
                       "length": first(values, "frame.len"),
                       "fields": {key: values.get(key, []) for key in args.field}})
    return result


if __name__ == "__main__":
    sys.exit(main("tshark.extract-packets", __file__, analyze, configure=configure))
