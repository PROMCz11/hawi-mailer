export interface ChunkOptions {
  /** Soft target size; a chunk is emitted once adding the next block exceeds it. */
  targetChars: number;
  /** Hard cap; a single block longer than this is sub-split before packing. */
  maxChars: number;
  /** Characters of the previous chunk repeated at the start of the next one. */
  overlapChars: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  targetChars: 1800,
  maxChars: 2800,
  overlapChars: 250,
};

/**
 * Deterministic, structure-aware chunker for lecture text. Implements the
 * "split on headings → paragraphs → size limit" spec the LLM prompt described,
 * but reliably and for free: it preserves the content verbatim and always
 * covers the WHOLE lecture (unlike a single LLM completion, which truncates /
 * gives up on long documents).
 */
export function chunkLectureText(
  content: string,
  opts: ChunkOptions = DEFAULT_CHUNK_OPTIONS,
): string[] {
  const text = content.replace(/\r\n?/g, '\n').trim();
  if (!text) return [];

  // 1) Paragraph blocks (blank-line separated). Headings stay attached to the
  //    paragraph that follows them when there's no blank line between.
  const paragraphs = text
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  // 2) Sub-split any block that exceeds the hard cap.
  const blocks: string[] = [];
  for (const p of paragraphs) {
    if (p.length <= opts.maxChars) blocks.push(p);
    else blocks.push(...splitLongBlock(p, opts.maxChars));
  }

  // 3) Greedily pack blocks up to the soft target, carrying an overlap tail.
  const chunks: string[] = [];
  let current = '';
  for (const block of blocks) {
    if (current && current.length + 2 + block.length > opts.targetChars) {
      chunks.push(current.trim());
      const overlap = overlapTail(current, opts.overlapChars);
      current = overlap ? `${overlap}\n\n${block}` : block;
    } else {
      current = current ? `${current}\n\n${block}` : block;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  return chunks;
}

/** Split an oversized paragraph on sentence boundaries, then hard-wrap as a last resort. */
function splitLongBlock(block: string, maxChars: number): string[] {
  // Keep sentence-ending punctuation (Arabic + Latin) with the sentence.
  const sentences = block
    .split(/(?<=[.!?؟۔])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const pieces: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    const part =
      sentence.length > maxChars ? hardWrap(sentence, maxChars) : [sentence];
    for (const s of part) {
      if (current && current.length + 1 + s.length > maxChars) {
        pieces.push(current.trim());
        current = s;
      } else {
        current = current ? `${current} ${s}` : s;
      }
    }
  }
  if (current.trim()) pieces.push(current.trim());
  return pieces;
}

/** Last-resort fixed-width split for a single sentence with no usable boundaries. */
function hardWrap(text: string, maxChars: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += maxChars) {
    out.push(text.slice(i, i + maxChars));
  }
  return out;
}

/** Last `n` chars of a chunk, trimmed to start at a word boundary, for overlap. */
function overlapTail(text: string, n: number): string {
  if (n <= 0 || text.length <= n) return '';
  let slice = text.slice(text.length - n);
  const space = slice.indexOf(' ');
  if (space > 0) slice = slice.slice(space + 1);
  return slice.trim();
}
