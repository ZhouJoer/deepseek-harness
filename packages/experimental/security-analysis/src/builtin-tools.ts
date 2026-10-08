/** Built-in tool pack; operator imports use the same validated data format. @module */
import { parseToolPack } from './tool-definitions.ts'
/** Default definitions without installation paths or measured status. */
export const builtinToolPack = parseToolPack({
  'version': 1,
  'id': 'builtin',
  'label': 'Built-in tools',
  'tools': [
    {
      'id': 'python',
      'label': 'python',
      'description': 'Python interpreter and virtual environment / Python 环境',
      'category': 'runtime',
      'tags': [
        'runtime',
      ],
      'commands': [
        'python',
        'python3',
      ],
      'args': [
        '-c',
        'import json,sys,importlib.util; print(json.dumps({"version":sys.version.split()[0],"location":sys.executable,"prefix":sys.prefix,"basePrefix":sys.base_prefix,"virtualEnvironment":sys.prefix!=sys.base_prefix,"pipAvailable":importlib.util.find_spec("pip") is not None}))',
      ],
      'url': 'https://www.python.org/downloads/',
      'probe': {
        'kind': 'identity',
      },
    },
    {
      'id': 'bash',
      'label': 'bash',
      'description': 'bash',
      'category': 'runtime',
      'tags': [
        'runtime',
      ],
      'commands': [
        'bash',
      ],
      'args': [
        '--version',
      ],
      'url': 'https://www.gnu.org/software/bash/',
    },
    {
      'id': 'pwsh',
      'label': 'pwsh',
      'description': 'pwsh',
      'category': 'runtime',
      'tags': [
        'runtime',
      ],
      'commands': [
        'pwsh',
        'powershell',
      ],
      'args': [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '$PSVersionTable.PSVersion.ToString()',
      ],
      'url': 'https://github.com/PowerShell/PowerShell',
    },
    {
      'id': 'radare2',
      'label': 'radare2',
      'description': 'Native binary disassembly, functions and cross references: ELF SO DLL PE Mach-O / 逆向 二进制 固件 反汇编',
      'category': 'reverse',
      'tags': [
        'reverse',
        'binary',
        'firmware',
        'elf',
        'so',
        'dll',
      ],
      'commands': [
        'radare2',
        'r2',
      ],
      'args': [
        '-v',
      ],
      'url': 'https://github.com/radareorg/radare2',
      'guide': 'For native ELF/.so, PE/.dll/.exe and Mach-O, prefer available radare2/r2 for metadata, functions, cross-references and disassembly. Invoke the measured command and prefixArgs through the native shell, not as a security_static provider. Start with bounded metadata or a relevant function. Prefer native JSON commands supported by the installed version; keep sample identity, architecture, function addresses and cross-reference addresses. Distinguish file offsets from virtual addresses and preserve the queried range. Use scripts for orchestration or a demonstrated tool gap.',
      'skills': [
        'security-firmware',
      ],
    },
    {
      'id': 'r2ghidra',
      'label': 'r2ghidra',
      'description': 'Native binary decompilation / 反编译',
      'category': 'reverse',
      'tags': [
        'reverse',
        'binary',
        'firmware',
      ],
      'args': [
        '-q',
        '-c',
        'Lcj',
        '--',
      ],
      'url': 'https://github.com/radareorg/r2ghidra',
      'dependency': 'radare2',
      'invocation': 'plugin',
      'probe': {
        'kind': 'json-plugin',
        'name': 'r2ghidra',
      },
      'guide': 'Decompiler plugin in the selected radare2 process. Check the plugin through the same radare2 installation; use bounded decompilation of selected functions. Prefer pdgj when supported by the installed plugin. Keep decompiled code as text with the function address and relevant references from radare2; do not parse pseudocode into asserted semantics. Preserve diagnostics and unsupported-command failures instead of treating them as empty functions.',
      'skills': [
        'security-firmware',
      ],
    },
    {
      'id': 'r2pipe',
      'label': 'r2pipe',
      'description': 'r2pipe',
      'category': 'reverse',
      'tags': [
        'reverse',
      ],
      'url': 'https://github.com/radareorg/radare2-r2pipe',
      'dependency': 'python',
      'invocation': 'python',
      'probe': {
        'kind': 'python-module',
        'module': 'r2pipe',
        'distribution': 'r2pipe',
      },
      'guide': 'Python bindings for radare2. Run scripts using the measured interpreter and prefixArgs, and select the measured radare2 executable. Read native JSON results before extracting task-specific fields; retain addresses and query parameters. Bound analysis time and output.',
      'skills': [
        'security-firmware',
      ],
    },
    {
      'id': 'unicorn',
      'label': 'unicorn',
      'description': 'CPU emulation for binary and firmware analysis / 仿真 模拟执行',
      'category': 'reverse',
      'tags': [
        'reverse',
        'binary',
        'firmware',
        'emulation',
      ],
      'url': 'https://www.unicorn-engine.org/docs/',
      'dependency': 'python',
      'invocation': 'python',
      'probe': {
        'kind': 'python-module',
        'module': 'unicorn',
        'distribution': 'unicorn',
      },
      'guide': 'CPU emulation through the measured Python interpreter and prefixArgs. Set explicit memory, registers, instruction limits and timeouts. Unicorn does not supply Android or operating-system services. Task scripts should emit parseable observations for the current question, including relevant instruction addresses, inputs, register or memory changes and the stop reason. Record modeled assumptions separately, including stubs and missing services. A limit, unmapped-memory fault or unsupported instruction leaves the affected behavior unresolved.',
      'skills': [
        'security-firmware',
      ],
    },
    {
      'id': 'frida',
      'label': 'frida',
      'description': 'frida',
      'category': 'reverse',
      'tags': [
        'reverse',
      ],
      'url': 'https://frida.re/docs/installation/',
      'dependency': 'python',
      'invocation': 'python',
      'provider': 'frida',
      'probe': {
        'kind': 'python-module',
        'module': 'frida',
        'distribution': 'frida',
      },
      'guide': 'Python bindings for Frida; module availability does not prove target access. Load the dedicated provider input guide for approved instrumentation and preserve role and execution permissions. Reuse provider identity, messages, incomplete and cleanup fields and existing event payloads. Preserve module/function addresses, event order and observation window; empty or limited events do not establish that a function is never called.',
      'skills': [
        'security-dynamic',
        'security-firmware',
      ],
    },
    {
      'id': 'ghidra',
      'label': 'ghidra',
      'description': 'ghidra',
      'category': 'reverse',
      'tags': [
        'reverse',
      ],
      'url': 'https://ghidra-sre.org/',
      'invocation': 'provider',
      'provider': 'ghidra',
      'guide': 'Use the configured Ghidra provider and load its input guide. The server, loaded program and provider readiness are checked separately.',
      'skills': [
        'security-firmware',
      ],
    },
    {
      'id': 'jadx',
      'label': 'jadx',
      'description': 'Android DEX APK Java decompilation / 安卓 反编译',
      'category': 'reverse',
      'tags': [
        'reverse',
        'android',
        'apk',
        'dex',
      ],
      'commands': [
        'jadx',
      ],
      'args': [
        '--version',
      ],
      'url': 'https://github.com/skylot/jadx',
      'searchPaths': [
        {
          'environment': 'JADX_HOME',
          'path': [
            'bin',
          ],
        },
        {
          'environment': 'USERPROFILE',
          'path': [
            'scoop',
            'apps',
            'jadx',
            'current',
            'bin',
          ],
        },
      ],
      'provider': 'android',
      'guide': 'Decompile Android DEX/APK bytecode. Reuse the android provider files, diagnostics and incomplete fields. Keep source paths and line locations when selecting code; preserve decompiler diagnostics and distinguish generated source from verified behavior. JADX does not disassemble native .so instructions; discover native binary tools for that task.',
      'skills': [
        'security-firmware',
      ],
    },
    {
      'id': 'adb',
      'label': 'adb',
      'description': 'adb',
      'category': 'device',
      'tags': [
        'device',
      ],
      'commands': [
        'adb',
      ],
      'args': [
        'version',
      ],
      'url': 'https://developer.android.com/tools/releases/platform-tools',
      'provider': 'android',
      'guide': 'Use the selected device and existing android provider operations. Retain command diagnostics, device and package identity with observations. Extract only stable fields needed by the current question from adb text; preserve complex dumpsys and unfamiliar version-specific output as original text. A JSON process envelope containing stdout does not make its contents structured device facts.',
    },
    {
      'id': 'fastboot',
      'label': 'fastboot',
      'description': 'fastboot',
      'category': 'device',
      'tags': [
        'device',
      ],
      'commands': [
        'fastboot',
      ],
      'args': [
        '--version',
      ],
      'url': 'https://developer.android.com/tools/releases/platform-tools',
    },
    {
      'id': 'docker',
      'label': 'docker',
      'description': 'docker',
      'category': 'utility',
      'tags': [
        'utility',
      ],
      'commands': [
        'docker',
      ],
      'args': [
        '--version',
      ],
      'url': 'https://docs.docker.com/get-docker/',
    },
    {
      'id': 'curl',
      'label': 'curl',
      'description': 'HTTP requests / Web HTTP',
      'category': 'web',
      'tags': [
        'web',
      ],
      'commands': [
        'curl',
      ],
      'args': [
        '--version',
      ],
      'url': 'https://curl.se/download.html',
      'provider': 'web',
      'guide': 'Keep HTTP status, response headers, body and execution diagnostics separate. Read existing structured provider data, including JSON inside stdout when present. For native curl, check installed support for --write-out %{json}, save the body with --output and headers with --dump-header in separate task outputs files, and retain stderr and exit status. Parse a body only according to its actual format; preserve its original bytes and file reference. A transport failure, partial body, redirect or application error must not become a successful security check merely because a status or body was returned.',
      'skills': [
        'security-web',
      ],
    },
    {
      'id': 'nmap',
      'label': 'nmap',
      'description': 'Network service discovery / 网络 端口 服务',
      'category': 'web',
      'tags': [
        'web',
      ],
      'commands': [
        'nmap',
      ],
      'args': [
        '--version',
      ],
      'url': 'https://nmap.org/download.html',
      'guide': 'Prefer native XML output with -oX, as recommended by Nmap, over human-readable or deprecated grepable output. Read only relevant hosts, ports, services and script results, retaining their target and port/protocol locations. Save the original XML with execution status and diagnostics; inspect run completion and scan coverage before interpreting records. Script output may remain text. Empty, filtered, partial or failed scans do not establish absence of risk. Select targets and probes within existing task authority.',
      'searchPaths': [
        {
          'environment': 'ProgramFiles',
          'path': [
            'Nmap',
          ],
        },
        {
          'environment': 'ProgramFiles(x86)',
          'path': [
            'Nmap',
          ],
        },
      ],
      'skills': [
        'security-web',
      ],
    },
    {
      'id': 'tshark',
      'skills': ['security-packet-analysis', 'security-mqtt'],
      'label': 'tshark',
      'description': 'Packet analysis and capture, USBPcap extcap / 抓包 USB 网络',
      'category': 'utility',
      'tags': [
        'utility',
        'capture',
        'usb',
        'network',
      ],
      'commands': [
        'tshark',
      ],
      'args': [
        '--version',
      ],
      'url': 'https://www.wireshark.org/download.html',
      'searchPaths': [
        {
          'environment': 'ProgramFiles',
          'path': [
            'Wireshark',
          ],
        },
        {
          'environment': 'ProgramFiles(x86)',
          'path': [
            'Wireshark',
          ],
        },
      ],
      'guide': 'For offline packet, MQTT and wireless analysis, load the existing analysis skills and reuse their scripts before writing a parser. Read records together with warnings, incomplete, parameters and input identity. Keep frame numbers, timestamps, stream identifiers and MQTT pduIndex when filtering or correlating results. Select fields and capture ranges for the question; missing, encrypted or undecoded traffic remains unknown.\n\nTool inventory availability confirms only the reported probe. Diagnose installed executable, backend/driver, interface visibility and resource-open permission separately. Report the exact failing command, exit status and OS error. An empty interface list or a non-administrator identity alone does not prove a missing driver or denied device access. Keep unmeasured stages unknown; recheck when the execution context changes.\n\nFor Windows USB capture, run tshark -D and tshark -G folders in the same execution context as the capture. Look for USBPcapCMD.exe in the reported extcap directories, including the Wireshark installation, and query it with --extcap-interfaces. Check the USBPcap driver with Get-Service USBPcap or Win32_SystemDriver; Win32_Service and PnP listings are not conclusive driver checks. Use the exact enumerated interface. Windows error 123 indicates an invalid name; check the invocation and capture backend. Error 5 indicates access denied for that operation. Interface discovery does not establish capture permission. Only an authorized, bounded device-open or capture attempt establishes access. On permission denial, request operator assistance for the capture process; do not recommend reinstalling an existing driver or bypass permissions.',
    },
    {
      'id': 'john',
      'label': 'john',
      'description': 'john',
      'category': 'utility',
      'tags': [
        'utility',
      ],
      'commands': [
        'john',
      ],
      'args': [
        '--list=build-info',
      ],
      'url': 'https://www.openwall.com/john/',
    },
    {
      'id': 'nuclei',
      'label': 'nuclei',
      'description': 'Web template scanning / 网站 Web',
      'category': 'web',
      'tags': [
        'web',
      ],
      'commands': [
        'nuclei',
      ],
      'args': [
        '-version',
      ],
      'url': 'https://github.com/projectdiscovery/nuclei',
      'guide': 'Prefer native JSONL output using the installed version support for -jsonl and -o. Read complete records with template ID, matched target/location and matcher or extracted observations; preserve the original JSONL. Keep execution status, template selection, coverage and diagnostics alongside matches. Malformed or truncated lines leave results incomplete. No matches, template errors or an interrupted run do not establish that a target is safe; a match still needs contextual verification under security-web.',
      'skills': [
        'security-web',
      ],
    },
    {
      'id': 'metasploit',
      'label': 'metasploit',
      'description': 'Security validation modules / 安全 验证',
      'category': 'web',
      'tags': [
        'web',
      ],
      'commands': [
        'msfconsole',
      ],
      'args': [
        '--version',
      ],
      'url': 'https://docs.metasploit.com/',
      'skills': [
        'security-web',
      ],
    },
    {
      'id': 'file',
      'label': 'file',
      'description': 'file',
      'category': 'utility',
      'tags': [
        'utility',
      ],
      'commands': [
        'file',
      ],
      'args': [
        '--version',
      ],
      'url': 'https://www.darwinsys.com/file/',
      'guide': 'Keep the input path and original identification text. Treat format and architecture labels as tool observations to verify when needed; do not build a generic parser for descriptive output.',
    },
    {
      'id': 'strings',
      'label': 'strings',
      'description': 'Binary text extraction / 字符串',
      'category': 'reverse',
      'tags': [
        'reverse',
        'binary',
        'firmware',
      ],
      'commands': [
        'strings',
      ],
      'args': [
        '--version',
      ],
      'url': 'https://www.gnu.org/software/binutils/',
      'guide': 'Invoke the measured native command and prefixArgs for bounded output relevant to the current question. Preserve strings as text with input path, byte offsets and encoding assumptions; use the installed offset option. A string alone does not establish reachability or a vulnerability. Extract task-specific fields only when needed and retain the original text.',
      'skills': [
        'security-firmware',
      ],
    },
    {
      'id': 'readelf',
      'label': 'readelf',
      'description': 'ELF metadata / SO 固件',
      'category': 'reverse',
      'tags': [
        'reverse',
        'binary',
        'firmware',
      ],
      'commands': [
        'readelf',
      ],
      'args': [
        '--version',
      ],
      'url': 'https://www.gnu.org/software/binutils/',
      'guide': 'Invoke the measured native command and prefixArgs for bounded output relevant to the current question. Select relevant ELF headers, sections, symbols or relocations. Preserve original text with input path, section/symbol names, offsets and addresses; distinguish file offsets from virtual addresses. Extract only fields needed for the question rather than implementing a general text parser.',
      'skills': [
        'security-firmware',
      ],
    },
    {
      'id': 'objdump',
      'label': 'objdump',
      'description': 'Binary disassembly / 反汇编',
      'category': 'reverse',
      'tags': [
        'reverse',
        'binary',
        'firmware',
      ],
      'commands': [
        'objdump',
      ],
      'args': [
        '--version',
      ],
      'url': 'https://www.gnu.org/software/binutils/',
      'guide': 'Invoke the measured native command and prefixArgs for bounded output relevant to the current question. Select relevant sections, functions or address ranges. Preserve original disassembly text with input path, architecture, section and instruction addresses; retain source lines when available. Use a small extraction script only for fields the current question needs.',
      'skills': [
        'security-firmware',
      ],
    },
    {
      'id': 'nm',
      'label': 'nm',
      'description': 'nm',
      'category': 'reverse',
      'tags': [
        'reverse',
      ],
      'commands': [
        'nm',
      ],
      'args': [
        '--version',
      ],
      'url': 'https://www.gnu.org/software/binutils/',
      'guide': 'Invoke the measured native command and prefixArgs for bounded output relevant to the current question. Keep symbol names, types and addresses with their input file and original text. Missing or stripped symbols are an analysis limitation, not proof that behavior is absent. Extract task-specific fields only when needed.',
      'skills': [
        'security-firmware',
      ],
    },
  ],
  'collections': [
    {
      'id': 'firmware',
      'label': 'Firmware and native binaries',
      'toolIds': [
        'radare2',
        'r2ghidra',
        'readelf',
        'objdump',
        'strings',
        'unicorn',
      ],
    },
    {
      'id': 'web',
      'label': 'Web analysis',
      'toolIds': [
        'curl',
        'nmap',
        'nuclei',
        'metasploit',
      ],
    },
    {
      'id': 'android',
      'label': 'Android',
      'toolIds': [
        'jadx',
        'adb',
        'frida',
        'radare2',
      ],
    },
    {
      'id': 'capture',
      'label': 'Packet capture',
      'toolIds': [
        'tshark',
      ],
    },
  ],
})
