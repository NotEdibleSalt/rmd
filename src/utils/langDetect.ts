/** Heuristically detect the programming language of a code snippet. */
export function detectCodeLanguage(code: string): string | null {
  const trimmed = code.trim();

  // Check for known shebangs
  if (trimmed.startsWith('#!/bin/bash') || trimmed.startsWith('#!/bin/sh')) return 'bash';
  if (trimmed.startsWith('#!/usr/bin/env python')) return 'python';
  if (trimmed.startsWith('#!/usr/bin/env node')) return 'javascript';
  if (trimmed.startsWith('#!/usr/bin/env ruby')) return 'ruby';

  // Count occurrences of language-specific patterns
  const scores: Record<string, number> = {};

  if (/^(import|export)\s+(default\s+)?(type|interface|class|function|const|let|var)\s/.test(trimmed)) scores['typescript'] = (scores['typescript'] || 0) + 3;
  if (/^\s*@(override|extends|implements|injectable|component|service)/m.test(trimmed)) scores['java'] = (scores['java'] || 0) + 2;
  if (/^\s*(use\s+|\bfn\s+|\blet\s+|\bmut\s+|\bimpl\s+|\bstruct\s+|\benum\s+)/m.test(trimmed)) scores['rust'] = (scores['rust'] || 0) + 3;
  if (/^\s*(package\s+main|import\s+\()/m.test(trimmed)) scores['go'] = (scores['go'] || 0) + 3;
  if (/^\s*(func\s+|type\s+\w+\s+struct)/m.test(trimmed)) scores['go'] = (scores['go'] || 0) + 2;
  if (/^\s*from\s+['"]\w+['"]\s+import/m.test(trimmed)) scores['python'] = (scores['python'] || 0) + 2;
  if (/^\s*<\?php/m.test(trimmed)) scores['php'] = (scores['php'] || 0) + 5;
  if (/^\s*#include\s*[<"]/m.test(trimmed)) scores['c'] = (scores['c'] || 0) + 2;
  if (/^\s*#include\s*<iostream>/m.test(trimmed)) scores['cpp'] = (scores['cpp'] || 0) + 3;
  if (/^\s*using\s+(System|Microsoft|AspNetCore)/m.test(trimmed)) scores['csharp'] = (scores['csharp'] || 0) + 2;
  if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) scores['html'] = (scores['html'] || 0) + 3;
  if (/^\s*SELECT\s+.+\s+FROM\s+/im.test(trimmed)) scores['sql'] = (scores['sql'] || 0) + 3;
  if (/^\s*(CREATE|ALTER|DROP)\s+(TABLE|VIEW|INDEX|PROCEDURE)/im.test(trimmed)) scores['sql'] = (scores['sql'] || 0) + 2;
  if (/^\s*def\s+\w+\s*\(/m.test(trimmed)) scores['python'] = (scores['python'] || 0) + 3;
  if (/^\s*class\s+\w+[:\s\{]/m.test(trimmed) && /def\s+\w+\s*\(self/m.test(trimmed)) scores['python'] = (scores['python'] || 0) + 2;
  if (/\.[a-z]+\(\)\s*\./m.test(trimmed) && /await\s/m.test(trimmed)) scores['javascript'] = (scores['javascript'] || 0) + 1;
  if (/:\s?(string|number|boolean|any)\b/m.test(trimmed)) scores['typescript'] = (scores['typescript'] || 0) + 3;
  if (/^\s*(const|let|var)\s+\w+\s*=/m.test(trimmed)) scores['javascript'] = (scores['javascript'] || 0) + 2;

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  return sorted.length > 0 && sorted[0][1] >= 1 ? sorted[0][0] : null;
}

/** Extract code block language from a triple-backtick-wrapped paste, or detect. */
export function extractPastedCode(text: string): { code: string; language: string } | null {
  // Normalize CRLF to LF for fenced block matching
  const normalized = text.replace(/\r\n/g, '\n');
  // Matches ```lang?\ncode\n``` (with optional language)
  const match = normalized.match(/^```(\w*)\n([\s\S]*?)\n```$/);
  if (match) {
    const lang = match[1] || detectCodeLanguage(match[2]) || '';
    return { code: match[2], language: lang };
  }
  // Unwrapped code — try to detect and return whole text
  const detected = detectCodeLanguage(text);
  if (detected) {
    return { code: text, language: detected };
  }
  return null;
}
