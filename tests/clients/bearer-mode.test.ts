import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { ActionClient } from '../../src/clients/action-client.js';
import { RestClient } from '../../src/clients/rest-client.js';

vi.mock('axios');

type Interceptor = (config: any) => any | Promise<any>;

function makeInstance() {
  const requestInterceptors: Interceptor[] = [];
  return {
    requestInterceptors,
    request: vi.fn().mockResolvedValue({ data: {}, headers: {} }),
    interceptors: {
      request: { use: vi.fn((fn: Interceptor) => { requestInterceptors.push(fn); }) },
      response: { use: vi.fn() },
    },
  };
}

/** Run every registered request interceptor over a starting config. */
async function applyInterceptors(instance: ReturnType<typeof makeInstance>, config: any) {
  let cfg = config;
  for (const fn of instance.requestInterceptors) {
    cfg = await fn(cfg);
  }
  return cfg;
}

describe('client OAuth bearer mode', () => {
  let instance: ReturnType<typeof makeInstance>;

  beforeEach(() => {
    vi.clearAllMocks();
    instance = makeInstance();
    vi.mocked(axios.create).mockReturnValue(instance as never);
  });

  it('ActionClient adds an Authorization header from the provider', async () => {
    const client = new ActionClient('w', 'https://w.example.com');
    client.setBearerTokenProvider(async () => 'tok-123');
    const cfg = await applyInterceptors(instance, { headers: {} });
    expect(cfg.headers['Authorization']).toBe('Bearer tok-123');
  });

  it('ActionClient.login is a no-op in bearer mode even with credentials', async () => {
    const client = new ActionClient('w', 'https://w.example.com', 'BotUser', 'botpass');
    client.setBearerTokenProvider(async () => 'tok-123');
    await client.login();
    expect(instance.request).not.toHaveBeenCalled();
  });

  it('RestClient adds an Authorization header from the provider', async () => {
    const client = new RestClient('w', 'https://w.example.com');
    client.setBearerTokenProvider(async () => 'tok-456');
    const cfg = await applyInterceptors(instance, { headers: {} });
    expect(cfg.headers['Authorization']).toBe('Bearer tok-456');
  });

  it('does not add Authorization when no provider is set', async () => {
    new ActionClient('w', 'https://w.example.com');
    const cfg = await applyInterceptors(instance, { headers: {} });
    expect(cfg.headers['Authorization']).toBeUndefined();
  });
});
