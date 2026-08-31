import { createHash } from 'node:crypto';
import path from 'node:path';
import type { EditProposal } from './types';
export const hashText = (text: string) => createHash('sha256').update(text).digest('hex');
export function safeRelative(file: string): string {
  if (!file || file.includes('\0') || file.includes('\\') || path.posix.isAbsolute(file) || /^[A-Za-z]:/.test(file) || file.split('/').includes('..')) throw new Error('Path must remain within the project');
  return path.posix.normalize(file);
}
export function prepareEdit(proposal: EditProposal, current: string) {
  safeRelative(proposal.path);
  if (!proposal.path.endsWith('.tex')) throw new Error('Only existing LaTeX manuscript files can be edited');
  if (!proposal.original || proposal.replacement.length > 12000) throw new Error('An edit needs a bounded, exact original span');
  const at = current.indexOf(proposal.original);
  if (at < 0) throw new Error('The original text changed; regenerate this proposal');
  if (current.indexOf(proposal.original, at + 1) >= 0) throw new Error('Ambiguous original text; ask for a larger unique span');
  return { start: at, end: at + proposal.original.length, hash: hashText(current), updated: current.slice(0, at) + proposal.replacement + current.slice(at + proposal.original.length) };
}
