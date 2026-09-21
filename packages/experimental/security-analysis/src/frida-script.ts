/** Fixed Frida probes executed by an isolated Python interpreter. */

/** Python helper accepts one JSON request on stdin and returns one bounded JSON result. */
export const FRIDA_PYTHON_SCRIPT = String.raw`
import json
import signal
import sys

import frida

PROBE = r'''
rpc.exports = {
  run(request) {
    if (Process.id !== request.pid) throw new Error('Attached process ID changed');
    if (request.operation === 'modules') {
      const all = Process.enumerateModules();
      return {
        items: all.slice(0, request.maxItems).map(m => ({name: m.name, base: m.base.toString(), size: m.size, path: m.path})),
        truncated: all.length > request.maxItems
      };
    }
    const module = Process.getModuleByName(request.module);
    if (request.operation === 'exports') {
      const all = module.enumerateExports();
      return {
        items: all.slice(0, request.maxItems).map(e => ({name: e.name, type: e.type, address: e.address.toString()})),
        truncated: all.length > request.maxItems
      };
    }
    if (request.operation !== 'trace-export') throw new Error('Unsupported probe');
    const entry = module.enumerateExports().find(e => e.name === request.symbol && e.type === 'function');
    if (entry === undefined) throw new Error('Exported function not found');
    return new Promise((resolve, reject) => {
      let hits = 0;
      const listener = Interceptor.attach(module.getExportByName(request.symbol), {
        onEnter() { hits += 1; }
      });
      setTimeout(() => {
        try {
          listener.detach();
          Interceptor.flush();
          resolve({items: [{module: request.module, symbol: request.symbol, hits, durationMs: request.durationMs}], truncated: false});
        } catch (error) { reject(error); }
      }, request.durationMs);
    });
  }
};
'''

def interrupted(signum, frame):
    raise RuntimeError('Frida probe interrupted')

def verify_process(device, request):
    matches = [p for p in device.enumerate_processes() if p.pid == request['pid']]
    if len(matches) != 1 or matches[0].name != request['processName']:
        raise RuntimeError('Configured process ID and name do not match a running process')

def main():
    request = json.load(sys.stdin)
    if not isinstance(request, dict):
        raise ValueError('Expected a probe request object')
    if set(request) - {'deviceId', 'pid', 'processName', 'operation', 'module', 'symbol', 'durationMs', 'maxItems', 'maxOutputBytes'}:
        raise ValueError('Unknown probe request field')
    for key in ('deviceId', 'processName'):
        if not isinstance(request.get(key), str) or not request[key]:
            raise ValueError('Expected nonempty ' + key)
    for key in ('pid', 'durationMs', 'maxItems', 'maxOutputBytes'):
        if type(request.get(key)) is not int or request[key] <= 0:
            raise ValueError('Expected positive integer ' + key)
    if request.get('operation') not in ('modules', 'exports', 'trace-export'):
        raise ValueError('Unsupported probe operation')
    if request['operation'] != 'modules' and (not isinstance(request.get('module'), str) or not request['module']):
        raise ValueError('Expected a module name')
    if request['operation'] == 'trace-export' and (not isinstance(request.get('symbol'), str) or not request['symbol']):
        raise ValueError('Expected an exported function name')

    device = frida.get_local_device() if request['deviceId'] == 'local' else frida.get_device(request['deviceId'], timeout=0)
    if device.type not in ('local', 'usb'):
        raise ValueError('Only configured local or USB devices are supported')
    verify_process(device, request)
    session = device.attach(request['pid'])
    script = None
    try:
        verify_process(device, request)
        script = session.create_script(PROBE)
        script.load()
        result = script.exports_sync.run(request)
        if session.is_detached:
            raise RuntimeError('Target exited or detached during the probe')
        verify_process(device, request)
    finally:
        try:
            if script is not None and not session.is_detached:
                script.unload()
        finally:
            if not session.is_detached:
                session.detach()

    output = {'operation': request['operation'], 'deviceId': request['deviceId'], 'pid': request['pid'], 'processName': request['processName'], **result}
    while True:
        encoded = json.dumps(output, ensure_ascii=False, separators=(',', ':'))
        if len(encoded.encode('utf-8')) <= request['maxOutputBytes']:
            sys.stdout.buffer.write(encoded.encode('utf-8'))
            sys.stdout.buffer.flush()
            return
        if not output['items']:
            raise RuntimeError('Output budget cannot hold probe metadata')
        output['items'].pop()
        output['truncated'] = True

signal.signal(signal.SIGTERM, interrupted)
signal.signal(signal.SIGINT, interrupted)
try:
    main()
except Exception as error:
    print(type(error).__name__ + ': ' + str(error), file=sys.stderr)
    sys.exit(1)
`
