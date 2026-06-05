import { describe, it, expect } from 'vitest';
import { detectCodeLanguage, extractPastedCode } from '../langDetect';

describe('detectCodeLanguage', () => {
  it('detects TypeScript from type annotations', () => {
    expect(detectCodeLanguage('const x: string = "hello";')).toBe('typescript');
  });
  it('detects Rust from fn keyword', () => {
    expect(detectCodeLanguage('fn main() { println!("hello"); }')).toBe('rust');
  });
  it('detects Python from def keyword', () => {
    expect(detectCodeLanguage('def hello():\n    print("world")')).toBe('python');
  });
  it('detects Go from package main', () => {
    expect(detectCodeLanguage('package main\n\nimport "fmt"\n\nfunc main() {}')).toBe('go');
  });
  it('detects HTML from doctype', () => {
    expect(detectCodeLanguage('<!DOCTYPE html><html></html>')).toBe('html');
  });
  it('detects SQL from SELECT statement', () => {
    expect(detectCodeLanguage('SELECT * FROM users WHERE id = 1')).toBe('sql');
  });
  it('returns null for ambiguous text', () => {
    expect(detectCodeLanguage('Hello, how are you?')).toBeNull();
  });
  it('returns null for empty string', () => {
    expect(detectCodeLanguage('')).toBeNull();
  });
});

describe('extractPastedCode', () => {
  it('extracts language from fenced code block', () => {
    const result = extractPastedCode('```rust\nfn main() {}\n```');
    expect(result).toEqual({ code: 'fn main() {}', language: 'rust' });
  });
  it('detects language from unfenced fenced block', () => {
    const result = extractPastedCode('```\nconst x = 1;\n```');
    expect(result?.language).toBe('javascript');
    expect(result?.code).toBe('const x = 1;');
  });
  it('returns null for non-code plain text', () => {
    expect(extractPastedCode('Just some normal text')).toBeNull();
  });
});
