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
      'guide': 'For native ELF/.so, PE/.dll/.exe and Mach-O, prefer available radare2/r2 for metadata, functions, cross-references and disassembly. Invoke the measured command and prefixArgs through the native shell, not as a security_static provider. Start with bounded metadata or a relevant function. Use scripts for orchestration or a demonstrated tool gap.',
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
      'guide': 'Decompiler plugin in the selected radare2 process. Check the plugin through the same radare2 installation; use bounded decompilation of selected functions.',
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
      'guide': 'Python bindings for radare2. Run scripts using the measured interpreter and prefixArgs, and select the measured radare2 executable. Bound analysis time and output.',
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
      'guide': 'CPU emulation through the measured Python interpreter and prefixArgs. Set explicit memory, registers, instruction limits and timeouts. Unicorn does not supply Android or operating-system services.',
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
      'guide': 'Python bindings for Frida; module availability does not prove target access. Load the dedicated provider input guide for approved instrumentation and preserve role and execution permissions.',
      'skills': [
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
      'guide': 'Decompile Android DEX/APK bytecode. JADX does not disassemble native .so instructions; discover native binary tools for that task.',
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
      'guide': 'Tool inventory availability confirms only the reported probe. Diagnose installed executable, backend/driver, interface visibility and resource-open permission separately. Report the exact failing command, exit status and OS error. An empty interface list or a non-administrator identity alone does not prove a missing driver or denied device access. Keep unmeasured stages unknown; recheck when the execution context changes.\n\nFor Windows USB capture, run tshark -D and tshark -G folders in the same execution context as the capture. Look for USBPcapCMD.exe in the reported extcap directories, including the Wireshark installation, and query it with --extcap-interfaces. Check the USBPcap driver with Get-Service USBPcap or Win32_SystemDriver; Win32_Service and PnP listings are not conclusive driver checks. Use the exact enumerated interface. Windows error 123 indicates an invalid name; check the invocation and capture backend. Error 5 indicates access denied for that operation. Interface discovery does not establish capture permission. Only an authorized, bounded device-open or capture attempt establishes access. On permission denial, request operator assistance for the capture process; do not recommend reinstalling an existing driver or bypass permissions.',
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
      'guide': 'Invoke the measured native command and prefixArgs for bounded output relevant to the current question.',
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
      'guide': 'Invoke the measured native command and prefixArgs for bounded output relevant to the current question.',
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
      'guide': 'Invoke the measured native command and prefixArgs for bounded output relevant to the current question.',
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
      'guide': 'Invoke the measured native command and prefixArgs for bounded output relevant to the current question.',
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
