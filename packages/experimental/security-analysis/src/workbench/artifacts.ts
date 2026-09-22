/** Immutable host-owned evidence files and measured sample imports. @module */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, realpath, stat, link, unlink, rm } from 'node:fs/promises'
import { isAbsolute, join, relative, sep, dirname, resolve } from 'node:path'
import type { Artifact, FileAsset } from './model.ts'

/** Host-owned evidence storage; filenames are SHA-256 digests, never model paths. */
export class ArtifactStore {
  constructor(
    private readonly root: string,
    private readonly maxBytes: number,
  ) {}
  /**
   * Save complete bytes before publishing their evidence reference.
   * @param bytes - original bytes.
   * @param mediaType - content type.
   * @returns immutable content metadata.
   */
  async put(bytes: Uint8Array, mediaType: string): Promise<Artifact> {
    if (bytes.byteLength > this.maxBytes) throw new Error('Artifact exceeds the configured byte limit')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const directory = join(this.root, 'artifacts')
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const path = join(directory, sha256)
    const temporary = join(directory, '.' + randomUUID())
    const handle = await open(temporary, 'wx', 0o600)
    try {
      try {
        await handle.writeFile(bytes)
        await handle.sync()
      } finally {
        await handle.close()
      }
      try {
        await link(temporary, path)
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
        const existing = await readFile(path)
        if (createHash('sha256').update(existing).digest('hex') !== sha256)
          throw new Error('Stored artifact is corrupt')
      }
    } finally {
      await unlink(temporary)
    }
    return { sha256, size: bytes.byteLength, mediaType }
  }
  /**
   * Read verified content without interpreting it as instructions.
   * @param artifact - committed metadata.
   * @returns bytes matching the recorded digest and size.
   */
  async read(artifact: Artifact): Promise<Buffer> {
    if (!/^[a-f0-9]{64}$/u.test(artifact.sha256)) throw new Error('Invalid artifact digest')
    const bytes = await readFile(join(this.root, 'artifacts', artifact.sha256))
    if (bytes.byteLength !== artifact.size || createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) {
      throw new Error('Artifact identity mismatch')
    }
    return bytes
  }
  /**
   * Import a regular file inside an operator-approved root.
   * @param path - absolute selected sample path.
   * @param roots - deployment-owned import roots.
   * @returns measured bytes and detected format.
   */
  async import(path: string, roots: readonly string[]): Promise<{ artifact: Artifact; format: FileAsset['format'] }> {
    if (!isAbsolute(path)) throw new Error('Select an absolute sample path')
    const resolved = await realpath(path)
    const approved = await Promise.all(roots.map(root => realpath(root)))
    if (
      !approved.some((root) => {
        const tail = relative(root, resolved)
        return tail !== '..' && !tail.startsWith('..' + sep) && !isAbsolute(tail)
      })
    )
      throw new Error('Sample is outside the configured import roots')
    const handle = await open(resolved, 'r')
    try {
      const before = await handle.stat()
      if (!before.isFile() || before.size > this.maxBytes)
        throw new Error('Sample must be a regular file within the byte limit')
      const bytes = Buffer.alloc(before.size)
      let offset = 0
      while (offset < bytes.length) {
        const read = await handle.read(bytes, offset, bytes.length - offset, offset)
        if (read.bytesRead === 0) throw new Error('Sample changed during import')
        offset += read.bytesRead
      }
      const after = await handle.stat()
      const current = await stat(resolved)
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== current.ino) {
        throw new Error('Sample changed during import')
      }
      const format: FileAsset['format'] = bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
        ? 'elf'
        : bytes.subarray(0, 2).toString() === 'MZ'
          ? 'pe'
          : bytes.subarray(0, 4).toString() === 'dex\n'
            ? 'dex'
            : bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) && path.toLowerCase().endsWith('.apk')
              ? 'apk'
              : 'other'
      return { artifact: await this.put(bytes, 'application/octet-stream'), format }
    } finally {
      await handle.close()
    }
  }
  /**
   * Materialize a verified artifact for a provider into a private run directory.
   * @param artifact - content to materialize.
   * @returns path whose parent directory belongs to this provider invocation.
   */
  async materialize(artifact: Artifact): Promise<string> {
    const directory = join(this.root, 'runs', randomUUID())
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const path = join(directory, 'input')
    const handle = await open(path, 'wx', 0o600)
    try {
      await handle.writeFile(await this.read(artifact))
    } finally {
      await handle.close()
    }
    return path
  }
  /**
   * Remove one owned provider directory after checking its resolved location.
   * @param path - input path returned by materialize.
   * @returns completion after its private run directory is removed.
   */
  async release(path: string): Promise<void> {
    const runs = await realpath(join(this.root, 'runs'))
    const directory = await realpath(dirname(path))
    const tail = relative(runs, directory)
    if (
      isAbsolute(tail) ||
      tail.includes(sep) ||
      !/^[a-f0-9-]{36}$/u.test(tail) ||
      resolve(directory) === resolve(runs)
    ) {
      throw new Error('Refusing cleanup outside an owned run directory')
    }
    await rm(directory, { recursive: true, force: true })
  }
}
