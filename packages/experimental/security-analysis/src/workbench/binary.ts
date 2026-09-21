/** Bounded inspection of immutable samples without external executables. @module */
import { z } from 'zod'
import type { AnalysisContext, AnalysisProvider, AnalysisResult } from './providers.ts'
import type { AnalysisOperation } from './model.ts'

/** Built-in identity, byte-view and string observations; never loads sample code. */
export class BinaryProvider implements AnalysisProvider {
  readonly id = 'binary'
  readonly inputGuide = 'identity requires {}. hex and strings accept byte offset and length; length defaults to maxOutputBytes/8 and cannot exceed it. strings also accepts minLength (default 4), encoding ascii or utf16le (default ascii); only printable ASCII characters are extracted. Overlap pages to check strings crossing a page edge. Input is the immutable imported artifact; no executable is needed.'
  readonly operations = ['identity', 'hex', 'strings']
  resolve(request: AnalysisOperation, context: AnalysisContext): AnalysisOperation {
    if (!this.operations.includes(request.operation) || request.script || request.impact !== 'observe')
      throw new Error('Binary inspection accepts read-only built-in operations')
    const schema = request.operation === 'identity' ? z.object({}).strict() : z.object({
      offset: z.number().int().nonnegative().default(0),
      length: z.number().int().positive().max(Math.floor(context.maxOutputBytes / 8))
        .default(Math.floor(context.maxOutputBytes / 8)),
      ...(request.operation === 'strings' ? {
        minLength: z.number().int().min(1).max(context.maxOutputBytes).default(4),
        encoding: z.enum(['ascii', 'utf16le']).default('ascii'),
      } : {}),
    }).strict()
    return { ...request, parameters: schema.parse(request.parameters) }
  }
  async run(request: AnalysisOperation, context: AnalysisContext): Promise<AnalysisResult> {
    context.signal.throwIfAborted()
    const bytes = await context.artifacts.read(context.asset.artifact)
    context.signal.throwIfAborted()
    let value: object
    let incomplete = false
    if (request.operation === 'identity') {
      const header: Record<string, string | number> = { prefixHex: bytes.subarray(0, 16).toString('hex') }
      if (bytes.subarray(0, 2).toString('ascii') === 'MZ') {
        if (bytes.length < 64) throw new Error('Truncated DOS header')
        const pe = bytes.readUInt32LE(60)
        if (pe > bytes.length - 24 || bytes.subarray(pe, pe + 4).toString('hex') !== '50450000')
          throw new Error('Invalid or truncated PE header')
        header.machine = bytes.readUInt16LE(pe + 4)
        header.sections = bytes.readUInt16LE(pe + 6)
        header.characteristics = bytes.readUInt16LE(pe + 22)
      } else if (bytes.subarray(0, 4).toString('hex') === '7f454c46') {
        if (bytes.length < 6) throw new Error('Truncated ELF identification')
        if (![1, 2].includes(bytes.readUInt8(4)) || ![1, 2].includes(bytes.readUInt8(5))) throw new Error('Invalid ELF identification')
        if (bytes.length < (bytes[4] === 1 ? 52 : 64)) throw new Error('Truncated ELF header')
        header.bits = bytes[4] === 1 ? 32 : 64
        header.endian = bytes[5] === 1 ? 'little' : 'big'
        header.machine = bytes[5] === 1 ? bytes.readUInt16LE(18) : bytes.readUInt16BE(18)
      }
      value = { sha256: context.asset.artifact.sha256, size: bytes.length, format: context.asset.format,
        header, coverage: 'Identity and selected header fields only; format validity and reachability are not established.' }
    } else {
      const offset = request.parameters.offset as number
      const length = request.parameters.length as number
      if (offset > bytes.length) throw new Error('Offset exceeds sample size')
      const end = Math.min(bytes.length, offset + length)
      incomplete = offset !== 0 || end !== bytes.length
      const page = { offset, nextOffset: end, size: bytes.length, hasMore: end < bytes.length }
      if (request.operation === 'hex') value = { ...page, hex: bytes.subarray(offset, end).toString('hex') }
      else {
        const width = request.parameters.encoding === 'utf16le' ? 2 : 1
        const minLength = request.parameters.minLength as number
        const strings: { offset: number; text: string }[] = []
        let start = offset
        const flush = (until: number) => {
          if ((until - start) / width >= minLength)
            strings.push({ offset: start, text: bytes.subarray(start, until).toString(width === 1 ? 'ascii' : 'utf16le') })
        }
        for (let index = offset; index < end; index += width) {
          const printable = bytes.readUInt8(index) >= 32 && bytes.readUInt8(index) <= 126 &&
            (width === 1 || (index + 1 < end && bytes[index + 1] === 0))
          if (!printable) { flush(index); start = index + width }
        }
        flush(end - ((end - offset) % width))
        value = { ...page, strings, encoding: request.parameters.encoding,
          coverage: 'Printable ASCII characters only; strings crossing page boundaries may be partial. Overlap pages when continuing.' }
      }
    }
    const output = Buffer.from(JSON.stringify(value))
    if (output.length > context.maxOutputBytes) throw new Error('Binary result exceeds output budget; reduce length')
    return { bytes: output, mediaType: 'application/json', summary: `${request.operation}: ${output.length} bytes of observations`,
      incomplete, toolVersion: 'dsh-binary/1' }
  }
}
