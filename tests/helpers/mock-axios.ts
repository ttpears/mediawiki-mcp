import { vi } from 'vitest';

export function createMockAxiosInstance() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    defaults: { headers: { common: {} } }
  };
}

export function mockAxiosCreate(mockInstance: ReturnType<typeof createMockAxiosInstance>) {
  return vi.fn().mockReturnValue(mockInstance);
}
