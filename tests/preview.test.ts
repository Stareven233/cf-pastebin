/**
 * 代码文件在线高亮识别与格式化单元测试 (Defect 5)
 */

import { describe, it, expect } from 'bun:test';
import { isCodeOrTextFile, getFileLanguageLabel, MAX_CODE_PREVIEW_SIZE } from '../src/client/utils/format';

describe('Code & Text File Preview Detection (Defect 5)', () => {
  it('should correctly identify code and text files by extension', () => {
    // 常见编程语言与代码文件
    expect(isCodeOrTextFile('app.js')).toBe(true);
    expect(isCodeOrTextFile('server.mjs')).toBe(true);
    expect(isCodeOrTextFile('index.ts')).toBe(true);
    expect(isCodeOrTextFile('Component.tsx')).toBe(true);
    expect(isCodeOrTextFile('script.py')).toBe(true);
    expect(isCodeOrTextFile('main.rs')).toBe(true);
    expect(isCodeOrTextFile('main.go')).toBe(true);
    expect(isCodeOrTextFile('style.css')).toBe(true);
    expect(isCodeOrTextFile('package.json')).toBe(true);
    expect(isCodeOrTextFile('README.md')).toBe(true);
    expect(isCodeOrTextFile('query.sql')).toBe(true);
    expect(isCodeOrTextFile('deploy.sh')).toBe(true);
    expect(isCodeOrTextFile('config.yaml')).toBe(true);
    expect(isCodeOrTextFile('data.xml')).toBe(true);
    expect(isCodeOrTextFile('notes.txt')).toBe(true);
  });

  it('should correctly identify special files without normal extensions', () => {
    expect(isCodeOrTextFile('Dockerfile')).toBe(true);
    expect(isCodeOrTextFile('Makefile')).toBe(true);
    expect(isCodeOrTextFile('LICENSE')).toBe(true);
    expect(isCodeOrTextFile('.gitignore')).toBe(true);
    expect(isCodeOrTextFile('.env')).toBe(true);
  });

  it('should reject binary media and archive files', () => {
    expect(isCodeOrTextFile('photo.png')).toBe(false);
    expect(isCodeOrTextFile('video.mp4')).toBe(false);
    expect(isCodeOrTextFile('audio.mp3')).toBe(false);
    expect(isCodeOrTextFile('archive.zip')).toBe(false);
    expect(isCodeOrTextFile('program.exe')).toBe(false);
    expect(isCodeOrTextFile('document.pdf')).toBe(false);
  });

  it('should reject files exceeding MAX_CODE_PREVIEW_SIZE (2MB)', () => {
    expect(isCodeOrTextFile('huge.js', 'text/javascript', MAX_CODE_PREVIEW_SIZE + 1)).toBe(false);
    expect(isCodeOrTextFile('normal.js', 'text/javascript', 50 * 1024)).toBe(true);
  });

  it('should return human-friendly language labels', () => {
    expect(getFileLanguageLabel('test.js')).toBe('JavaScript');
    expect(getFileLanguageLabel('test.ts')).toBe('TypeScript');
    expect(getFileLanguageLabel('test.tsx')).toBe('TypeScript JSX');
    expect(getFileLanguageLabel('app.py')).toBe('Python');
    expect(getFileLanguageLabel('Cargo.toml')).toBe('TOML');
    expect(getFileLanguageLabel('Dockerfile')).toBe('Dockerfile');
    expect(getFileLanguageLabel('README.md')).toBe('Markdown');
    expect(getFileLanguageLabel('data.json')).toBe('JSON');
  });
});
