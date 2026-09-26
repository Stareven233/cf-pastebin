/**
 * 短链生成与字符集测试
 */

import { describe, it, expect } from 'bun:test';
import { generateRandomSlug } from '../src/worker/slug';
import { BASE62_CHARSET } from '../src/shared/constants';

describe('Slug Generation Unit Tests', () => {
  it('should generate 4-character slug by default', () => {
    const slug = generateRandomSlug(4);
    expect(slug).toHaveLength(4);
    for (const char of slug) {
      expect(BASE62_CHARSET).toContain(char);
    }
  });

  it('should generate 8-character and 16-character slugs', () => {
    const slug8 = generateRandomSlug(8);
    expect(slug8).toHaveLength(8);

    const slug16 = generateRandomSlug(16);
    expect(slug16).toHaveLength(16);
  });

  it('should generate distinct random values', () => {
    const set = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      set.add(generateRandomSlug(4));
    }
    // 1000 次 4 位生成不应有大量碰撞 (容量为 1477 万)
    expect(set.size).toBeGreaterThan(990);
  });
});
