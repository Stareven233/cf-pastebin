/**
 * 完整 Worker API 路由与业务流集成测试
 * 利用 Bun 原生内置 SQLite 真实运行 D1 SQL 语句与数据库操作
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import worker from '../src/worker/index';
import { ensureDatabaseTables, type Env } from '../src/worker/db';
import { ADMIN_COOKIE_NAME } from '../src/shared/constants';

/**
 * 将 Bun SQLite 包装为 Cloudflare D1Database 兼容接口
 */
function createSqliteD1(sqlite: Database): D1Database {
  return {
    prepare(sql: string) {
      let boundParams: any[] = [];
      return {
        bind(...params: any[]) {
          boundParams = params;
          return this;
        },
        async first<T = any>(colName?: string): Promise<T | null> {
          const stmt = sqlite.query(sql);
          const row = stmt.get(...boundParams) as any;
          if (!row) return null;
          if (colName) return row[colName];
          return row;
        },
        async all<T = any>(): Promise<D1Result<T>> {
          const stmt = sqlite.query(sql);
          const results = stmt.all(...boundParams) as T[];
          return {
            results,
            success: true,
            meta: { duration: 0, rows_read: results.length, rows_written: 0, last_row_id: 0, changes: 0 } as any,
          };
        },
        async run(): Promise<D1Response> {
          const stmt = sqlite.query(sql);
          stmt.run(...boundParams);
          return {
            success: true,
            meta: { duration: 0, changes: 1, last_row_id: 0, rows_read: 0, rows_written: 1 } as any,
          };
        },
      } as any;
    },
    async batch(statements: D1PreparedStatement[]): Promise<D1Response[]> {
      const results: D1Response[] = [];
      for (const stmt of statements) {
        results.push(await stmt.run());
      }
      return results;
    },
    async exec(query: string): Promise<D1ExecResult> {
      sqlite.run(query);
      return { count: 1, duration: 0 };
    },
    dump: (() => {}) as any,
  };
}

describe('Worker Full API Integration Tests', () => {
  let sqlite: Database;
  let env: Env;
  let mockR2Storage: Map<string, Uint8Array>;
  const executionContext: ExecutionContext = {
    waitUntil(promise: Promise<any>) {},
    passThroughOnException() {},
  };

  beforeEach(async () => {
    sqlite = new Database(':memory:');
    mockR2Storage = new Map();

    const mockR2: R2Bucket = {
      async put(key: string, value: any, options?: any) {
        let bytes: Uint8Array;
        if (value instanceof ReadableStream) {
          const reader = value.getReader();
          const chunks: Uint8Array[] = [];
          while (true) {
            const { done, value: chunk } = await reader.read();
            if (done) break;
            chunks.push(chunk);
          }
          const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
          bytes = new Uint8Array(totalLen);
          let offset = 0;
          for (const c of chunks) {
            bytes.set(c, offset);
            offset += c.length;
          }
        } else if (value instanceof Uint8Array) {
          bytes = value;
        } else {
          bytes = new TextEncoder().encode(String(value));
        }
        mockR2Storage.set(key, bytes);
        return {} as any;
      },
      async get(key: string) {
        const data = mockR2Storage.get(key);
        if (!data) return null;
        return {
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(data);
              controller.close();
            }
          }),
          httpMetadata: { contentType: 'audio/mpeg' },
          httpEtag: '"mock-etag"',
          writeHttpMetadata(headers: Headers) {
            headers.set('content-type', 'audio/mpeg');
          }
        } as any;
      },
      async delete(keys: string | string[]) {
        const list = Array.isArray(keys) ? keys : [keys];
        for (const k of list) {
          mockR2Storage.delete(k);
        }
      },
    } as any;

    env = {
      DB: createSqliteD1(sqlite),
      R2: mockR2,
      ADMIN_PASSWORD: 'testadminpassword',
      SESSION_SECRET: 'test-session-secret-key-32chars-ok',
      ENVIRONMENT: 'test',
    };

    // 初始化表结构
    await ensureDatabaseTables(env.DB);
  });

  it('should reject invalid token info requests', async () => {
    // 缺少 token
    const req1 = new Request('http://localhost/api/upload/token-info');
    const res1 = await worker.fetch(req1, env, executionContext);
    expect(res1.status).toBe(400);

    // 不存在的 token
    const req2 = new Request('http://localhost/api/upload/token-info?token=non-existent-uuid');
    const res2 = await worker.fetch(req2, env, executionContext);
    expect(res2.status).toBe(404);
  });

  it('should authenticate admin and allow creating & using tokens', async () => {
    // 1. 尝试错误密码
    const badLoginReq = new Request('http://localhost/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrongpassword' }),
    });
    const badRes = await worker.fetch(badLoginReq, env, executionContext);
    expect(badRes.status).toBe(401);

    // 2. 正确密码登录
    const goodLoginReq = new Request('http://localhost/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'testadminpassword' }),
    });
    const goodRes = await worker.fetch(goodLoginReq, env, executionContext);
    expect(goodRes.status).toBe(200);

    const setCookie = goodRes.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    const sessionCookie = setCookie!.split(';')[0];

    // 3. 管理员创建新 Token (50MB, 24小时)
    const createTokenReq = new Request('http://localhost/api/admin/tokens', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
      },
      body: JSON.stringify({ maxSizeBytes: 50 * 1024 * 1024, durationHours: 24, allowPermanent: false }),
    });
    const createTokenRes = await worker.fetch(createTokenReq, env, executionContext);
    expect(createTokenRes.status).toBe(200);
    const tokenData = await createTokenRes.json();
    expect(tokenData.success).toBe(true);
    const tokenId = tokenData.data.tokenId;
    expect(tokenId).toBeTruthy();

    // 4. 访客根据生成的 Token 查询状态
    const checkTokenReq = new Request(`http://localhost/api/upload/token-info?token=${tokenId}`);
    const checkTokenRes = await worker.fetch(checkTokenReq, env, executionContext);
    expect(checkTokenRes.status).toBe(200);
    const checkData = await checkTokenRes.json();
    expect(checkData.data.tokenId).toBe(tokenId);
    expect(checkData.data.maxSizeBytes).toBe(50 * 1024 * 1024);

    // 5. 访客直传音频文件到 R2
    const audioData = new Uint8Array([0x49, 0x44, 0x33, 0x03, 0x00]); // MP3 Header
    const uploadFileReq = new Request(`http://localhost/api/upload/direct?filename=song.mp3&size=5&token=${tokenId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/mpeg' },
      body: audioData,
    });
    const uploadFileRes = await worker.fetch(uploadFileReq, env, executionContext);
    expect(uploadFileRes.status).toBe(200);
    const fileUploadJson = await uploadFileRes.json();
    expect(fileUploadJson.success).toBe(true);
    const r2Key = fileUploadJson.data.r2Key;

    // 6. 访客完成上传并生成短链 (使用该 Token)
    const completeReq = new Request('http://localhost/api/upload/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: tokenId,
        title: '我的测试音频',
        files: [{ r2Key, filename: 'song.mp3', mimeType: 'audio/mpeg', sizeBytes: 5 }],
        slugLength: 4,
        durationSeconds: 86400,
        burnAfterRead: false,
      }),
    });
    const completeRes = await worker.fetch(completeReq, env, executionContext);
    expect(completeRes.status).toBe(200);
    const completeData = await completeRes.json();
    expect(completeData.success).toBe(true);
    const slug = completeData.data.slug;
    expect(slug).toHaveLength(4);

    // 7. 再次使用此 Token 查询或上传，必须已被作废 (410 已使用)
    const reuseTokenReq = new Request(`http://localhost/api/upload/token-info?token=${tokenId}`);
    const reuseTokenRes = await worker.fetch(reuseTokenReq, env, executionContext);
    expect(reuseTokenRes.status).toBe(410);

    // 8. 访客打开落地页获取分享详情
    const getPasteReq = new Request(`http://localhost/api/paste/${slug}`);
    const getPasteRes = await worker.fetch(getPasteReq, env, executionContext);
    expect(getPasteRes.status).toBe(200);
    const pasteView = await getPasteRes.json();
    expect(pasteView.data.slug).toBe(slug);
    expect(pasteView.data.files).toHaveLength(1);
    expect(pasteView.data.files[0].isAudio).toBe(true);

    // 9. 访客通过直链下载该音频
    const downloadReq = new Request(`http://localhost/d/${slug}`);
    const downloadRes = await worker.fetch(downloadReq, env, executionContext);
    expect(downloadRes.status).toBe(200);
    expect(downloadRes.headers.get('content-type')).toBe('audio/mpeg');
  });

  it('should support burn after read destruction on download', async () => {
    // 管理员创建一个阅后即焚纯文本分享
    const completeReq = new Request('http://localhost/api/upload/complete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // 管理员未带 cookie 时作为免凭证自测或带 token
      },
      body: JSON.stringify({
        title: '秘密暗号',
        textContent: '这是阅后即焚内容：123456',
        slugLength: 4,
        burnAfterRead: true,
      }),
    });

    // 先登录获取会话
    const loginReq = new Request('http://localhost/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'testadminpassword' }),
    });
    const loginRes = await worker.fetch(loginReq, env, executionContext);
    const sessionCookie = loginRes.headers.get('set-cookie')!.split(';')[0];

    const adminUploadReq = new Request('http://localhost/api/upload/complete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
      },
      body: JSON.stringify({
        title: '秘密暗号',
        textContent: '这是阅后即焚内容：123456',
        slugLength: 4,
        burnAfterRead: true,
      }),
    });

    const createRes = await worker.fetch(adminUploadReq, env, executionContext);
    const createData = await createRes.json();
    const slug = createData.data.slug;

    // 第一次读取 (非管理员下载)
    const read1Req = new Request(`http://localhost/d/${slug}`);
    const read1Res = await worker.fetch(read1Req, env, executionContext);
    expect(read1Res.status).toBe(200);
    const text1 = await read1Res.text();
    expect(text1).toBe('这是阅后即焚内容：123456');

    // 第二次读取，必须返回 404 (已被物理销毁)
    const read2Req = new Request(`http://localhost/d/${slug}`);
    const read2Res = await worker.fetch(read2Req, env, executionContext);
    expect(read2Res.status).toBe(404);
  });

  it('should invalidate token and record used_size_bytes even with admin cookie (Defect 2 & 4)', async () => {
    // 1. 管理员登录并获取 Session Cookie
    const loginReq = new Request('http://localhost/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'testadminpassword' }),
    });
    const loginRes = await worker.fetch(loginReq, env, executionContext);
    const sessionCookie = loginRes.headers.get('set-cookie')!.split(';')[0];

    // 2. 生成一个 10MB 的 Token
    const createTokenReq = new Request('http://localhost/api/admin/tokens', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
      },
      body: JSON.stringify({ maxSizeBytes: 10 * 1024 * 1024, durationHours: 2 }),
    });
    const createTokenRes = await worker.fetch(createTokenReq, env, executionContext);
    const { data: { tokenId } } = await createTokenRes.json();

    // 3. 上传 10 字节的文件
    const fileBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const uploadReq = new Request(`http://localhost/api/upload/direct?filename=test.bin&size=10&token=${tokenId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        // 关键点：即使请求头中携带了管理员 Session Cookie，也应严格走 Token 校验
        Cookie: sessionCookie,
      },
      body: fileBytes,
    });
    const uploadRes = await worker.fetch(uploadReq, env, executionContext);
    expect(uploadRes.status).toBe(200);
    const { data: { r2Key } } = await uploadRes.json();

    // 4. 提交完成上传：携带 Token + 10 字节文件 + 纯文本 "Hello" (5 字节)
    const textStr = 'Hello'; // 5 字节
    const completeReq = new Request('http://localhost/api/upload/complete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie, // 模拟在管理员已登录的浏览器中代为测试访客 Token
      },
      body: JSON.stringify({
        token: tokenId,
        title: '混合内容上传',
        textContent: textStr,
        files: [{ r2Key, filename: 'test.bin', mimeType: 'application/octet-stream', sizeBytes: 10 }],
      }),
    });
    const completeRes = await worker.fetch(completeReq, env, executionContext);
    expect(completeRes.status).toBe(200);

    // 5. 校验该 Token 必须被作废且准确记录消耗字节数为 10 + 5 = 15 字节
    const tokensListReq = new Request('http://localhost/api/admin/tokens', {
      headers: { Cookie: sessionCookie },
    });
    const tokensListRes = await worker.fetch(tokensListReq, env, executionContext);
    const tokensList = await tokensListRes.json();
    const tokenRecord = tokensList.data.find((t: any) => t.id === tokenId);

    expect(tokenRecord).toBeTruthy();
    expect(tokenRecord.status).toBe('used');
    expect(tokenRecord.used_size_bytes).toBe(15);

    // 6. 校验再次使用该 Token 会被拒绝 (410)
    const reuseReq = new Request(`http://localhost/api/upload/token-info?token=${tokenId}`);
    const reuseRes = await worker.fetch(reuseReq, env, executionContext);
    expect(reuseRes.status).toBe(410);
  });

  it('should accurately count UTF-8 bytes for text-only token uploads and reject quota overflow', async () => {
    // 1. 管理员登录
    const loginReq = new Request('http://localhost/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'testadminpassword' }),
    });
    const loginRes = await worker.fetch(loginReq, env, executionContext);
    const sessionCookie = loginRes.headers.get('set-cookie')!.split(';')[0];

    // 2. 创建一个小配额 Token (50 字节)
    // 允许我们在测试中通过直接在 SQLite 中插入一个 50 字节的限制
    const smallTokenId = 'small-token-uuid-50b';
    sqlite.run(`
      INSERT INTO upload_tokens (id, max_size_bytes, used_size_bytes, allow_permanent, status, expires_at, created_at)
      VALUES ('${smallTokenId}', 50, 0, 0, 'active', datetime('now', '+1 hour'), datetime('now'));
    `);

    // 3. 测试纯文本超额上传：中文 "你好世界，这是一段超过五十个字节的测试文本喵！" UTF-8 编码为 66 字节
    const longText = '你好世界，这是一段超过五十个字节的测试文本喵！';
    const longTextBytes = new TextEncoder().encode(longText).length;
    expect(longTextBytes).toBeGreaterThan(50);

    const overflowReq = new Request('http://localhost/api/upload/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: smallTokenId,
        textContent: longText,
      }),
    });
    const overflowRes = await worker.fetch(overflowReq, env, executionContext);
    expect(overflowRes.status).toBe(400);
    const overflowData = await overflowRes.json();
    expect(overflowData.error).toContain('超出了该凭证允许的最大配额');

    // 4. 测试合法纯文本上传：短文本 "主人好喵！" (15 字节 UTF-8)
    const validText = '主人好喵！';
    const validTextBytes = new TextEncoder().encode(validText).length;
    expect(validTextBytes).toBeLessThanOrEqual(50);

    const validReq = new Request('http://localhost/api/upload/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: smallTokenId,
        textContent: validText,
      }),
    });
    const validRes = await worker.fetch(validReq, env, executionContext);
    expect(validRes.status).toBe(200);

    // 5. 校验数据库中该 Token 的 used_size_bytes 严格等于 15
    const row = sqlite.query(`SELECT status, used_size_bytes FROM upload_tokens WHERE id = ?`).get(smallTokenId) as any;
    expect(row.status).toBe('used');
    expect(row.used_size_bytes).toBe(validTextBytes);
  });

  it('should support burn-after-read for pure text: view once then burn on refresh (Defect 3)', async () => {
    // 1. 创建纯文本阅后即焚分享
    const createReq = new Request('http://localhost/api/upload/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: '纯文本绝密',
        textContent: '绝密文本阅后即焚内容：ABC-999',
        burnAfterRead: true,
      }),
    });
    // 模拟无 cookie 匿名或管理员生成
    sqlite.run(`
      INSERT INTO upload_tokens (id, max_size_bytes, used_size_bytes, allow_permanent, status, expires_at, created_at)
      VALUES ('text-burn-token', 1024 * 1024, 0, 0, 'active', datetime('now', '+1 hour'), datetime('now'));
    `);
    const createTokenReq = new Request('http://localhost/api/upload/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: 'text-burn-token',
        title: '纯文本绝密',
        textContent: '绝密文本阅后即焚内容：ABC-999',
        burnAfterRead: true,
      }),
    });
    const createRes = await worker.fetch(createTokenReq, env, executionContext);
    const { data: { slug } } = await createRes.json();

    // 2. 首次通过公共落地页接口读取文本：必须成功返回文本
    const view1Req = new Request(`http://localhost/api/paste/${slug}`);
    const view1Res = await worker.fetch(view1Req, env, executionContext);
    expect(view1Res.status).toBe(200);
    const view1Data = await view1Res.json();
    expect(view1Data.success).toBe(true);
    expect(view1Data.data.textContent).toBe('绝密文本阅后即焚内容：ABC-999');
    expect(view1Data.data.burnAfterRead).toBe(true);
    // 响应头应强制不缓存
    expect(view1Res.headers.get('cache-control')).toContain('no-store');

    // 3. 用户在浏览器按 F5 刷新或他人二次打开：必须已被焚毁 (404)
    const view2Req = new Request(`http://localhost/api/paste/${slug}`);
    const view2Res = await worker.fetch(view2Req, env, executionContext);
    expect(view2Res.status).toBe(404);
  });

  it('should support burn-after-read for files: open page allows download via readToken, then burned on refresh/second access', async () => {
    // 1. 上传一个阅后即焚文件
    const mockFileBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG Header
    mockR2Storage.set('files/burn-file-uuid/secret.png', mockFileBytes);

    sqlite.run(`
      INSERT INTO upload_tokens (id, max_size_bytes, used_size_bytes, allow_permanent, status, expires_at, created_at)
      VALUES ('file-burn-token', 1024 * 1024, 0, 0, 'active', datetime('now', '+1 hour'), datetime('now'));
    `);

    const completeReq = new Request('http://localhost/api/upload/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: 'file-burn-token',
        title: '绝密图片',
        files: [{
          r2Key: 'files/burn-file-uuid/secret.png',
          filename: 'secret.png',
          mimeType: 'image/png',
          sizeBytes: 4,
        }],
        burnAfterRead: true,
      }),
    });
    const completeRes = await worker.fetch(completeReq, env, executionContext);
    const { data: { slug } } = await completeRes.json();

    // 2. 访客首次打开 /s/:slug 获取落地页数据
    const landingReq = new Request(`http://localhost/api/paste/${slug}`);
    const landingRes = await worker.fetch(landingReq, env, executionContext);
    expect(landingRes.status).toBe(200);
    const landingData = await landingRes.json();
    expect(landingData.data.files).toHaveLength(1);

    const downloadUrl = landingData.data.files[0].downloadUrl;
    expect(downloadUrl).toContain('read_token=');

    // 3. 用户在同一个打开的页面上点击下载该文件：凭携带的 read_token 必须成功下载！
    const downloadReq = new Request(`http://localhost${downloadUrl}`);
    const downloadRes = await worker.fetch(downloadReq, env, executionContext);
    expect(downloadRes.status).toBe(200);
    expect(downloadRes.headers.get('content-type')).toBe('image/png');

    // 4. 再次刷新落地页：已焚毁 (404)
    const refreshReq = new Request(`http://localhost/api/paste/${slug}`);
    const refreshRes = await worker.fetch(refreshReq, env, executionContext);
    expect(refreshRes.status).toBe(404);

    // 5. 再次下载该文件：已被彻底物理销毁 (404)
    const downloadAgainReq = new Request(`http://localhost${downloadUrl}`);
    const downloadAgainRes = await worker.fetch(downloadAgainReq, env, executionContext);
    expect(downloadAgainRes.status).toBe(404);
  });

  it('should support Scheme B: admin preview does not count or burn, but public access counts & burns', async () => {
    // 1. 管理员登录
    const loginReq = new Request('http://localhost/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'testadminpassword' }),
    });
    const loginRes = await worker.fetch(loginReq, env, executionContext);
    const sessionCookie = loginRes.headers.get('set-cookie')!.split(';')[0];

    // 2. 管理员创建一个阅后即焚纯文本分享
    const createReq = new Request('http://localhost/api/upload/complete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
      },
      body: JSON.stringify({
        title: '管理特权测试',
        textContent: '管理员可见绝密',
        burnAfterRead: true,
      }),
    });
    const createRes = await worker.fetch(createReq, env, executionContext);
    const { data: { slug } } = await createRes.json();

    // 3. 管理员从后台点击“查阅”带 ?admin_preview=1 和 Cookie：不计入计数，不触发销毁
    const adminPreviewReq = new Request(`http://localhost/api/paste/${slug}?admin_preview=1`, {
      headers: { Cookie: sessionCookie },
    });
    const adminPreviewRes = await worker.fetch(adminPreviewReq, env, executionContext);
    expect(adminPreviewRes.status).toBe(200);
    const previewData = await adminPreviewRes.json();
    expect(previewData.data.isAdminPreview).toBe(true);
    expect(previewData.data.viewCount).toBe(0); // 浏览量未被增加

    // 检查数据库：paste 未被软删除
    const rowBefore = sqlite.query(`SELECT is_deleted, view_count, download_count FROM pastes WHERE slug = ?`).get(slug) as any;
    expect(rowBefore.is_deleted).toBe(0);
    expect(rowBefore.view_count).toBe(0);

    // 4. 管理员或访客从公共短链访问 (无 admin_preview)：正常计入 view_count 并触发销毁
    const publicReq = new Request(`http://localhost/api/paste/${slug}`, {
      headers: { Cookie: sessionCookie }, // 即使携带管理员 Cookie，只要走公共链接也按普通访客真实自测
    });
    const publicRes = await worker.fetch(publicReq, env, executionContext);
    expect(publicRes.status).toBe(200);
    const publicData = await publicRes.json();
    expect(publicData.data.isAdminPreview).toBe(false);

    // 检查数据库：paste 已被标记软删除且 view_count 为 1
    const rowAfter = sqlite.query(`SELECT is_deleted, view_count FROM pastes WHERE slug = ?`).get(slug) as any;
    expect(rowAfter.is_deleted).toBe(1);
    expect(rowAfter.view_count).toBe(1);

    // 5. 二次访问公共短链：直接返回 404
    const publicReq2 = new Request(`http://localhost/api/paste/${slug}`);
    const publicRes2 = await worker.fetch(publicReq2, env, executionContext);
    expect(publicRes2.status).toBe(404);
  });

  it('should accurately count public downloads on normal files even with admin session cookie', async () => {
    // 1. 管理员登录
    const loginReq = new Request('http://localhost/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'testadminpassword' }),
    });
    const loginRes = await worker.fetch(loginReq, env, executionContext);
    const sessionCookie = loginRes.headers.get('set-cookie')!.split(';')[0];

    // 2. 创建一个普通持久分享
    mockR2Storage.set('files/normal-file-uuid/doc.txt', new TextEncoder().encode('Hello World Doc'));
    const createReq = new Request('http://localhost/api/upload/complete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
      },
      body: JSON.stringify({
        title: '普通文件测试',
        files: [{
          r2Key: 'files/normal-file-uuid/doc.txt',
          filename: 'doc.txt',
          mimeType: 'text/plain',
          sizeBytes: 15,
        }],
        burnAfterRead: false,
      }),
    });
    const createRes = await worker.fetch(createReq, env, executionContext);
    const { data: { slug } } = await createRes.json();

    // 3. 第一次公共下载 (即使浏览器携带 Admin Cookie，也正常累加)
    const dl1 = await worker.fetch(new Request(`http://localhost/d/${slug}`, {
      headers: { Cookie: sessionCookie },
    }), env, executionContext);
    expect(dl1.status).toBe(200);

    const check1 = sqlite.query(`SELECT download_count FROM pastes WHERE slug = ?`).get(slug) as any;
    expect(check1.download_count).toBe(1);

    // 4. 第二次公共下载
    const dl2 = await worker.fetch(new Request(`http://localhost/d/${slug}`), env, executionContext);
    expect(dl2.status).toBe(200);

    const check2 = sqlite.query(`SELECT download_count FROM pastes WHERE slug = ?`).get(slug) as any;
    expect(check2.download_count).toBe(2);
  });

  it('should allow admin direct upload up to 100MB and reject exceeding 100MB, while guest stays capped at 25MB (Defect 1)', async () => {
    // 1. 管理员登录
    const loginReq = new Request('http://localhost/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'testadminpassword' }),
    });
    const loginRes = await worker.fetch(loginReq, env, executionContext);
    const sessionCookie = loginRes.headers.get('set-cookie')!.split(';')[0];

    // 2. 管理员上传 35MB 文件 (超过 25MB 但在 100MB 内) -> 应当成功
    const adminFileSize = 35 * 1024 * 1024;
    const adminUploadReq = new Request(`http://localhost/api/upload/direct?filename=big_package.zip&size=${adminFileSize}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/zip',
        Cookie: sessionCookie,
      },
      body: new Uint8Array([0x50, 0x4B, 0x03, 0x04]),
    });
    const adminUploadRes = await worker.fetch(adminUploadReq, env, executionContext);
    expect(adminUploadRes.status).toBe(200);
    const adminUploadJson = await adminUploadRes.json();
    expect(adminUploadJson.success).toBe(true);
    expect(adminUploadJson.data.sizeBytes).toBe(adminFileSize);

    // 3. 管理员上传超过 100MB 的文件 (例如 105MB) -> 应当返回 400 并明确提示
    const adminExceedSize = 105 * 1024 * 1024;
    const exceedReq = new Request(`http://localhost/api/upload/direct?filename=too_big.zip&size=${adminExceedSize}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/zip',
        Cookie: sessionCookie,
      },
      body: new Uint8Array([0x50, 0x4B, 0x03, 0x04]),
    });
    const exceedRes = await worker.fetch(exceedReq, env, executionContext);
    expect(exceedRes.status).toBe(400);
    const exceedJson = await exceedRes.json();
    expect(exceedJson.error).toContain('100MB');

    // 4. 普通访客生成 50MB 配额的 Token，尝试单文件直传 30MB (> 25MB) -> 应当被单文件 25MB 限制拦截
    const createTokenReq = new Request('http://localhost/api/admin/tokens', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
      },
      body: JSON.stringify({
        maxSizeBytes: 50 * 1024 * 1024,
      }),
    });
    const createTokenRes = await worker.fetch(createTokenReq, env, executionContext);
    const { data: { tokenId } } = await createTokenRes.json();

    const guestFileSize = 30 * 1024 * 1024;
    const guestUploadReq = new Request(`http://localhost/api/upload/direct?filename=song.flac&size=${guestFileSize}&token=${tokenId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/flac' },
      body: new Uint8Array([0x66, 0x4C, 0x61, 0x43]),
    });
    const guestUploadRes = await worker.fetch(guestUploadReq, env, executionContext);
    expect(guestUploadRes.status).toBe(400);
    const guestUploadJson = await guestUploadRes.json();
    expect(guestUploadJson.error).toContain('25MB');
  });

  it('should support inline code file streaming with correct UTF-8 headers (Defect 5)', async () => {
    // 1. 管理员登录
    const loginReq = new Request('http://localhost/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'testadminpassword' }),
    });
    const loginRes = await worker.fetch(loginReq, env, executionContext);
    const sessionCookie = loginRes.headers.get('set-cookie')!.split(';')[0];

    // 2. 直传一个 JavaScript 代码文件
    const codeSnippet = '// 喵~ 计算求和函数\nexport function add(a, b) {\n  return a + b;\n}';
    const codeBytes = new TextEncoder().encode(codeSnippet);
    const uploadReq = new Request(`http://localhost/api/upload/direct?filename=calc.js&size=${codeBytes.length}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/javascript',
        Cookie: sessionCookie,
      },
      body: codeBytes,
    });
    const uploadRes = await worker.fetch(uploadReq, env, executionContext);
    expect(uploadRes.status).toBe(200);
    const uploadData = await uploadRes.json();
    const r2Key = uploadData.data.r2Key;

    // 3. 完成上传
    const completeReq = new Request('http://localhost/api/upload/complete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
      },
      body: JSON.stringify({
        title: '代码预览测试',
        files: [{
          r2Key,
          filename: 'calc.js',
          mimeType: 'application/javascript',
          sizeBytes: codeBytes.length,
        }],
      }),
    });
    const completeRes = await worker.fetch(completeReq, env, executionContext);
    expect(completeRes.status).toBe(200);
    const { data: { slug } } = await completeRes.json();

    // 4. 获取落地页详情，得到包含的 fileId
    const getPasteRes = await worker.fetch(new Request(`http://localhost/api/paste/${slug}`), env, executionContext);
    expect(getPasteRes.status).toBe(200);
    const pasteJson = await getPasteRes.json();
    const fileId = pasteJson.data.files[0].id;

    // 5. 请求 inline 预览流：/d/:slug/:fileId?inline=1
    const inlineReq = new Request(`http://localhost/d/${slug}/${fileId}?inline=1`);
    const inlineRes = await worker.fetch(inlineReq, env, executionContext);
    expect(inlineRes.status).toBe(200);

    // 验证响应头
    expect(inlineRes.headers.get('content-disposition')).toContain('inline');
    expect(inlineRes.headers.get('content-type')).toContain('charset=utf-8');

    // 验证内容读取正常
    const responseText = await inlineRes.text();
    expect(responseText).toBe(codeSnippet);
  });
});


