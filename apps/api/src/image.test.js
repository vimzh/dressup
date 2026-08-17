import assert from 'node:assert/strict';
import test from 'node:test';

import { validateRemoteUrl } from './image.js';

test('remote image URL validation blocks private targets', async () => {
  await assert.rejects(validateRemoteUrl('http://example.com/image.jpg'), /HTTPS/);
  await assert.rejects(validateRemoteUrl('https://127.0.0.1/image.jpg'), /Private network/);
  await assert.rejects(validateRemoteUrl('https://[::1]/image.jpg'), /Private network/);
  assert.equal((await validateRemoteUrl('https://example.com/image.jpg')).hostname, 'example.com');
});
