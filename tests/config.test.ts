import { describe, it, expect } from 'bun:test';
import { ADMIN_PATH } from '../src/client/config';

describe('Admin Path Configuration Tests', () => {
  it('should ensure ADMIN_PATH starts with slash and is not empty', () => {
    expect(ADMIN_PATH).toBeDefined();
    expect(ADMIN_PATH.startsWith('/')).toBe(true);
    expect(ADMIN_PATH.length).toBeGreaterThan(1);
    expect(ADMIN_PATH.endsWith('/')).toBe(false);
  });
});
