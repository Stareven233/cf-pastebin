/**
 * 管理员 HMAC 会话签名与防篡改测试
 */

import { describe, it, expect } from 'bun:test';
import {
  createAdminSessionCookie,
  verifyAdminSession,
  createClearSessionCookie,
} from '../src/worker/auth';
import { ADMIN_COOKIE_NAME } from '../src/shared/constants';
import type { Env } from '../src/worker/db';

describe('Admin Authentication & Session Tests', () => {
  const mockEnv: Env = {
    DB: {} as any,
    R2: {} as any,
    SESSION_SECRET: 'test-super-secret-key-1234567890',
    ADMIN_PASSWORD: 'mypassword',
  };

  it('should sign and verify valid session cookie', async () => {
    const { cookie } = await createAdminSessionCookie(mockEnv);
    expect(cookie).toContain(ADMIN_COOKIE_NAME);

    // 提取 cookie 字符串作为 Request Header
    const req = new Request('http://localhost/api/admin/me', {
      headers: {
        Cookie: cookie.split(';')[0],
      },
    });

    const isValid = await verifyAdminSession(req, mockEnv);
    expect(isValid).toBe(true);
  });

  it('should reject tampered session token', async () => {
    const { cookie } = await createAdminSessionCookie(mockEnv);
    const rawCookie = cookie.split(';')[0];
    const tampered = rawCookie + 'extraBadBytes';

    const req = new Request('http://localhost/api/admin/me', {
      headers: {
        Cookie: tampered,
      },
    });

    const isValid = await verifyAdminSession(req, mockEnv);
    expect(isValid).toBe(false);
  });

  it('should generate valid clear session cookie', () => {
    const clearCookie = createClearSessionCookie();
    expect(clearCookie).toContain('Max-Age=0');
    expect(clearCookie).toContain(ADMIN_COOKIE_NAME);
  });
});
