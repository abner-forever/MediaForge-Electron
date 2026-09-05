import { afterEach, describe, expect, it, vi } from 'vitest';
import { sseGet } from '../sse';

describe('sseGet', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('解析 event-stream 事件', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode('data: {"type":"done","ok":true}\n\n'));
        controller.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    ));

    const events: Array<{ type: string; ok: boolean }> = [];
    await sseGet<{ type: string; ok: boolean }>('/api/settings/weibo-login-stream', (event) => events.push(event));

    expect(events).toEqual([{ type: 'done', ok: true }]);
  });

  it('非 event-stream 响应抛出可读错误', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
    ));

    await expect(sseGet('/api/settings/weibo-login-stream', () => {})).rejects.toThrow(
      '服务未返回事件流，请确认后端路由已启用',
    );
  });
});
