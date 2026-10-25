export interface UserNote { id: string; text: string }
export function notePage(notes: UserNote[], cursor = '0:0', budget = 24_000): { notes: UserNote[]; nextCursor?: string } {
  if (!Number.isInteger(budget) || budget < 1 || budget > 64_000) throw new Error('Invalid user-note output budget');
  if (!/^\d+:\d+$/.test(cursor)) throw new Error('Invalid user-note cursor');
  let [index, offset] = cursor.split(':').map(Number) as [number, number];
  if (index > notes.length || (index < notes.length && offset > notes[index]!.text.length)) throw new Error('User-note cursor is out of range');
  const output: UserNote[] = [];
  while (index < notes.length && budget > 0 && output.length < 10) {
    const note = notes[index]!;
    const text = note.text.slice(offset, offset + budget);
    output.push({ id: note.id, text }); budget -= Math.max(1, text.length);
    offset += text.length;
    if (offset < note.text.length) return { notes: output, nextCursor: `${index}:${offset}` };
    index++; offset = 0;
  }
  return { notes: output, nextCursor: index < notes.length ? `${index}:0` : undefined };
}
