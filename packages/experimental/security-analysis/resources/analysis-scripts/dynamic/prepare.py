"""Prepare immutable Frida script bytes; never attach to or launch a process."""
import argparse
import hashlib
import json
from pathlib import Path
import sys


def positive(value):
    number = int(value)
    if number <= 0:
        raise argparse.ArgumentTypeError("Expected a positive integer")
    return number


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("template", choices=("module-watch", "function-trace"))
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--max-events", required=True, type=positive)
    parser.add_argument("--module")
    parser.add_argument("--symbol", action="append")
    parser.add_argument("--stack-depth", type=positive)
    args = parser.parse_args()
    if not args.output.is_absolute():
        parser.error("--output must be an absolute path in the task scripts directory")
    if args.template == "function-trace":
        if not args.module or not args.symbol or any(not symbol for symbol in args.symbol) or not args.stack_depth:
            parser.error("function-trace requires --module, --symbol and --stack-depth")
        if args.stack_depth > 16:
            parser.error("Frida supports at most 16 backtrace frames")
    elif args.module is not None or args.symbol is not None or args.stack_depth is not None:
        parser.error("module-watch accepts only --max-events and --output")
    source = Path(__file__).with_name(args.template.replace("-", "_") + ".js").read_bytes()
    options = {"maxEvents": args.max_events}
    if args.template == "function-trace":
        options.update(module=args.module, symbols=list(dict.fromkeys(args.symbol)), stackDepth=args.stack_depth)
    code = ("globalThis.securityScriptOptions = " + json.dumps(options, ensure_ascii=True) + ";\n").encode("utf-8") + source
    with args.output.open("xb") as output:
        output.write(code)
    print(json.dumps({"scriptId": "dynamic." + args.template, "templateSha256": hashlib.sha256(source).hexdigest(),
                      "scriptSha256": hashlib.sha256(code).hexdigest(), "output": str(args.output), "parameters": options}))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError) as error:
        print(type(error).__name__ + ": " + str(error), file=sys.stderr)
        sys.exit(1)
