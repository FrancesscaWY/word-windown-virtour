import test from 'node:test';
import assert from 'node:assert/strict';
import { readPublicOrigins, isAllowedOrigin } from '../server/origin.ts';

test('Origin protection is strict by default and keeps local exact authority access', () => {
  const origins = readPublicOrigins({});
  assert.equal(isAllowedOrigin(undefined, 'localhost:5174', origins), true);
  assert.equal(isAllowedOrigin('http://localhost:5174', 'localhost:5174', origins), true);
  assert.equal(isAllowedOrigin('https://tour.example.com:55555', 'tour.example.com', origins), false);
  assert.equal(isAllowedOrigin('https://evil.example', 'localhost:5174', origins), false);
  assert.equal(isAllowedOrigin('null', 'localhost:5174', origins), false);
});

test('public origins are complete explicit URLs, not wildcards, paths or credentials', () => {
  const origins = readPublicOrigins({ PUBLIC_ORIGINS: ' https://tour.example.com:55555/, https://other.example.com ' });
  assert.equal(isAllowedOrigin('https://tour.example.com:55555', 'localhost:5174', origins), true);
  assert.equal(isAllowedOrigin('https://tour.example.com:55556', 'localhost:5174', origins), false);
  for (const value of ['*', 'https://*.example.com', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com?key=value', 'file:///private', 'null']) {
    assert.throws(() => readPublicOrigins({ PUBLIC_ORIGINS: value }), /PUBLIC_ORIGINS/);
  }
});
