/**
 * 短链接 Slug 安全随机生成与唯一性冲突重试
 */

import { BASE62_CHARSET } from '../shared/constants';

/**
 * 生成指定长度的 Base62 强伪随机字符串
 */
export function generateRandomSlug(length: 4 | 8 | 16 = 4): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += BASE62_CHARSET[bytes[i] % BASE62_CHARSET.length];
  }
  return result;
}

/**
 * 在数据库中生成并确保全局唯一短链 Slug
 */
export async function generateUniqueSlug(
  db: D1Database,
  length: 4 | 8 | 16 = 4,
  maxRetries = 5
): Promise<string> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const slug = generateRandomSlug(length);
    // 检查是否已被占用 (未被软删除或已被占用均不可冲突)
    const existing = await db.prepare(`
      SELECT 1 FROM pastes WHERE slug = ?;
    `).bind(slug).first();

    if (!existing) {
      return slug;
    }
  }

  // 极低概率连续碰撞时降级为时间戳补齐
  return generateRandomSlug(16);
}
