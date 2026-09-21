import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { legacy: 'lib/types/legacy.js', commands: 'lib/types/operator-commands.js', index: 'lib/types/index.js', workbench: 'lib/types/workbench/index.js',
    environment: 'lib/types/environment-local.js', ghidra: 'lib/types/ghidra-provider.js',
    frida: 'lib/types/frida-provider.js', android: 'lib/types/android-provider.js' },
  outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
  fixedExtension: false, dts: false, clean: false,
})
