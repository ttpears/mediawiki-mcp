import { describe, it, expect } from 'vitest';
import { MediaWikiApiError } from '../src/types.js';

describe('MediaWikiApiError', () => {
  it('formats message with wiki and operation', () => {
    const err = new MediaWikiApiError('not found', 'Sales', 'get-page', 404);
    expect(err.message).toBe('[Sales] get-page: not found');
    expect(err.wiki).toBe('Sales');
    expect(err.operation).toBe('get-page');
    expect(err.statusCode).toBe(404);
  });

  it('is retryable on 429', () => {
    const err = new MediaWikiApiError('rate limited', 'Dev', 'search', 429);
    expect(err.isRetryable).toBe(true);
  });

  it('is retryable on 5xx', () => {
    const err = new MediaWikiApiError('server error', 'Dev', 'search', 502);
    expect(err.isRetryable).toBe(true);
  });

  it('is not retryable on 4xx', () => {
    const err = new MediaWikiApiError('bad request', 'Dev', 'search', 400);
    expect(err.isRetryable).toBe(false);
  });
});
