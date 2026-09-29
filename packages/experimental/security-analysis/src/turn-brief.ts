/** Extract visible closing lines without treating model claims as execution facts. @module */

/** Read the conclusion and next action from a concise coordinator response.
 * @param text - committed visible assistant text; reasoning and tool calls are excluded.
 * @returns bounded analyst notes, with no tool counts or security verdict promotion.
 */
export function closingBrief(text: string): { text: string; next: string } {
  const lines = text.split('\n').map(line => line.trim().replaceAll('**', '')).filter(Boolean)
  const conclusion = lines.find(line => /^(?:结论|当前结论|conclusion|current conclusion)\s*[:：]/iu.test(line))
  const next = lines.find(line => /^(?:下一步(?:[／/或]阻碍)?|next(?: action)?(?:\s*\/\s*blocker)?)\s*[:：]/iu.test(line))
  return {
    text: (conclusion?.replace(/^[^:：]*[:：]\s*/u, '') ?? lines[0] ?? '').slice(0, 300),
    next: (next?.replace(/^[^:：]*[:：]\s*/u, '') ?? '').slice(0, 300),
  }
}
