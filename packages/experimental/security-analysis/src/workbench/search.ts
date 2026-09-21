/** Rebuildable local full-text index; the security journal remains authoritative. @module */
import { DatabaseSync } from 'node:sqlite'
import { renameSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { SecurityRecord } from './model.ts'

/** One host-local derived index, including Chinese word segmentation. */
export class SecuritySearchIndex {
  private readonly database: DatabaseSync
  private readonly segmenter = new Intl.Segmenter('zh', { granularity: 'word' })
  constructor(path: string) {
    const open = (): DatabaseSync => {
      const database = new DatabaseSync(path)
      try {
        database.exec('CREATE VIRTUAL TABLE IF NOT EXISTS records USING fts5(id UNINDEXED, engagement UNINDEXED, content)')
        return database
      } catch (error) {
        database.close()
        throw error
      }
    }
    try {
      this.database = open()
    } catch (error) {
      // Only this derived file is replaceable. Permission and I/O errors must
      // remain visible; SQLite primary codes 11 and 26 mean corrupt/not-a-database.
      if (!(error instanceof Error) || !('errcode' in error) || typeof error.errcode !== 'number'
        || ![11, 26].includes(error.errcode & 0xff)) throw error
      renameSync(path, path + '.corrupt-' + randomUUID())
      this.database = open()
    }
  }
  private words(text: string): string {
    return [...this.segmenter.segment(text)].map(word => word.segment).join(' ')
  }
  /**
   * Replace the derived index from committed records.
   * @param records - authoritative material, excluding unpublished cross-project access.
   */
  rebuild(records: SecurityRecord[]): void {
    this.database.exec('BEGIN')
    try {
      this.database.exec('DELETE FROM records')
      const insert = this.database.prepare('INSERT INTO records(id, engagement, content) VALUES (?, ?, ?)')
      for (const record of records) {
        if (record.kind === 'binding') continue
        const project = record.kind === 'engagement' ? record.value.id : record.value.engagementId
        insert.run(record.kind + ':' + record.value.id, project, this.words(JSON.stringify(record.value)))
      }
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }
  /**
   * Search exact tokens inside one project.
   * @param engagementId - allowed project.
   * @param query - human query, never raw FTS syntax.
   * @param limit - validated positive result limit.
   * @returns record keys ordered by relevance.
   */
  search(engagementId: string, query: string, limit: number): string[] {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Search limit must be positive')
    const words = [...this.segmenter.segment(query)]
      .filter(word => word.isWordLike)
      .map(word => '"' + word.segment.replaceAll('"', '""') + '"')
    if (!words.length) return []
    const rows = this.database
      .prepare('SELECT id FROM records WHERE records MATCH ? AND engagement = ? ORDER BY rank LIMIT ?')
      .all(words.join(' AND '), engagementId, limit)
    return rows.map(row => String(row.id))
  }
  /** Close SQLite before removing its owning directory. */
  close(): void {
    this.database.close()
  }
}
