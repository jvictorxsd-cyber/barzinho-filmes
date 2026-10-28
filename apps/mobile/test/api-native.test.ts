import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createApiClient} from '@barzinho/shared';

test('native requests work without AbortSignal.timeout and use a bearer token', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout')!;
  Object.defineProperty(AbortSignal, 'timeout', {value: undefined, configurable: true});
  try {
    let calls = 0;
    const api = createApiClient({
      baseUrl: 'https://example.com/', credentials: 'omit', getToken: async () => 'test-session',
      fetcher: async (url, init) => {
        calls++;
        assert.equal(url, 'https://example.com/api/auth/me');
        assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-session');
        assert.equal(init?.credentials, 'omit');
        assert.ok(init?.signal instanceof AbortSignal);
        return Response.json({user: {id: 'owner'}});
      },
    });
    assert.deepEqual(await api('/api/auth/me'), {user: {id: 'owner'}});
    assert.equal(calls, 1);
  } finally {
    Object.defineProperty(AbortSignal, 'timeout', descriptor);
  }
});

test('caller cancellation remains distinguishable from a network failure', async () => {
  const controller = new AbortController();
  const error = new Error('cancelled');
  const api = createApiClient({baseUrl: 'https://example.com', fetcher: async (_url, init) => {
    assert.equal(init?.signal, controller.signal);
    controller.abort();
    throw error;
  }});
  await assert.rejects(api('/api/catalog/home', {signal: controller.signal}), caught => caught === error);
});
