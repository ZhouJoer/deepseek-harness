"""Execute one approved Frida request and settle script/session cleanup."""
import hashlib
import os
import json
import signal
import sys
import threading

import frida

stop = threading.Event()


def phase(value):
    print(json.dumps({"phase": value}), file=sys.stderr, flush=True)


def interrupt(signum, frame):
    stop.set()


def process_identity(device, pid):
    matches = [p for p in device.enumerate_processes(scope="full") if p.pid == pid]
    if len(matches) != 1:
        raise RuntimeError("Target process no longer exists")
    process = matches[0]
    started = process.parameters.get("started")
    if started is None:
        raise RuntimeError("Provider cannot establish process start identity on this target")
    return {"pid": process.pid, "name": process.name, "started": str(started)}


def executable_path(pid):
    if sys.platform == "win32":
        import ctypes
        from ctypes import wintypes
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        handle = kernel.OpenProcess(0x1000, False, pid)
        if not handle:
            raise OSError("Cannot inspect the selected process executable")
        try:
            buffer = ctypes.create_unicode_buffer(32768)
            size = wintypes.DWORD(len(buffer))
            if not kernel.QueryFullProcessImageNameW(handle, 0, buffer, ctypes.byref(size)):
                raise OSError("Cannot resolve the selected process executable")
            return buffer.value
        finally:
            kernel.CloseHandle(handle)
    if sys.platform.startswith("linux"):
        return os.path.realpath("/proc/%d/exe" % pid)
    raise RuntimeError("Executable identity is not supported on this operating system")


def verify_sample(device, pid, request):
    if device.type == "local":
        path = executable_path(pid)
        with open(path, "rb") as source:
            actual = hashlib.file_digest(source, "sha256").hexdigest()
        if actual != request["sampleHash"]:
            raise RuntimeError("Process executable does not match the approved sample")
        return {"path": path, "sha256": actual}
    package = request.get("packageName")
    matches = [app for app in device.enumerate_applications(scope="full") if app.identifier == package and app.pid == pid]
    if len(matches) != 1:
        raise RuntimeError("Process does not belong to the approved Android package")
    return {"package": package, "sha256": request["sampleHash"]}


def main():
    request = json.load(sys.stdin)
    if not isinstance(request, dict) or not isinstance(request.get("durationMs"), int) or request["durationMs"] <= 0:
        raise ValueError("Invalid observation duration")
    if not isinstance(request.get("maxOutputBytes"), int) or request["maxOutputBytes"] < 4096:
        raise ValueError("Invalid output limit")
    if request.get("operation") not in ("processes", "modules", "exports", "trace", "script"):
        raise ValueError("Unsupported operation")
    cancel_path = request.get("cancelPath")
    if not isinstance(cancel_path, str):
        raise ValueError("A cancellation channel is required")
    def watch_cancel():
        while not stop.wait(0.05):
            if os.path.exists(cancel_path):
                stop.set()
    threading.Thread(target=watch_cancel, daemon=True).start()
    device_id = request["deviceId"]
    device = frida.get_local_device() if device_id == "local" else frida.get_device(device_id, timeout=0)
    if device.type not in ("local", "usb"):
        raise RuntimeError("Only local and explicitly selected USB devices are supported")
    if request["operation"] == "processes":
        processes = [{"pid": p.pid, "name": p.name, "parameters": p.parameters}
                     for p in device.enumerate_processes(scope="full")]
        result = {"identity": None, "messages": processes, "incomplete": False, "cleanup": "none", "version": frida.__version__}
        while len(json.dumps(result, default=str).encode()) > request["maxOutputBytes"]:
            if not result["messages"]:
                raise RuntimeError("Output limit cannot hold result metadata")
            result["messages"].pop()
            result["incomplete"] = True
        print(json.dumps(result, default=str))
        return

    target = request["target"]
    spawned = target["mode"] == "spawn"
    pid = None
    session = None
    script = None
    messages = []
    total = 0
    incomplete = False
    cleanup_errors = []
    mutex = threading.Lock()

    def message(payload, data):
        nonlocal total, incomplete
        record = {"message": payload, "binary": data.hex() if data is not None else None}
        encoded = json.dumps(record, default=str).encode()
        with mutex:
            if total + len(encoded) > request["maxOutputBytes"] // 2:
                incomplete = True
                stop.set()
                return
            total += len(encoded)
            messages.append(record)
            if payload.get("type") == "error":
                incomplete = True
                stop.set()

    def detached(reason, crash):
        nonlocal incomplete
        incomplete = True
        stop.set()

    try:
        if stop.is_set():
            raise RuntimeError("Cancelled before target acquisition")
        phase("acquiring")
        pid = device.spawn(target["argv"]) if spawned else target["pid"]
        identity = process_identity(device, pid)
        if not spawned and (identity["name"] != target["name"] or identity["started"] != target["started"]):
            raise RuntimeError("Process identity changed; prepare another plan")
        sample = verify_sample(device, pid, request)
        phase("attaching")
        session = device.attach(pid)
        session.on("detached", detached)
        if process_identity(device, pid) != identity:
            raise RuntimeError("Process changed while attaching")
        if verify_sample(device, pid, request) != sample:
            raise RuntimeError("Executable identity changed while attaching")
        script = session.create_script(request["script"])
        script.on("message", message)
        phase("loading")
        script.load()
        phase("loaded")
        if spawned:
            device.resume(pid)
            phase("resumed")
        if stop.wait(request["durationMs"] / 1000.0):
            incomplete = True
        phase("observed")
        if not session.is_detached and process_identity(device, pid) != identity:
            raise RuntimeError("Process identity changed during observation")
    finally:
        if session is not None:
            session.off("detached", detached)
            try:
                if script is not None and not session.is_detached:
                    phase("unloading")
                    script.unload()
                    phase("unloaded")
            except Exception as error:
                cleanup_errors.append("unload: " + str(error))
            try:
                if not session.is_detached:
                    phase("detaching")
                    session.detach()
                    phase("detached")
            except Exception as error:
                cleanup_errors.append("detach: " + str(error))
        if spawned and pid is not None:
            try:
                phase("stopping-owned-process")
                device.kill(pid)
                phase("owned-process-stopped")
            except frida.ProcessNotFoundError:
                pass
            except Exception as error:
                cleanup_errors.append("owned process: " + str(error))
    stop.set()
    if cleanup_errors:
        incomplete = True
    print(json.dumps({"identity": identity, "messages": messages, "incomplete": incomplete,
                      "cleanup": "; ".join(cleanup_errors) if cleanup_errors else "unloaded-detached" + ("-owned-process-stopped" if spawned else ""),
                      "version": frida.__version__}, default=str))


signal.signal(signal.SIGTERM, interrupt)
signal.signal(signal.SIGINT, interrupt)
try:
    main()
except Exception as error:
    print(json.dumps({"error": type(error).__name__, "message": str(error)}), file=sys.stderr)
    sys.exit(1)
finally:
    stop.set()
