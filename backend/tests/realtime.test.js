import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { RealtimeHub } from '../src/realtime.js';

class MockResponse {
  constructor() {
    this.headers = {};
    this.writes = [];
    this.ended = false;
    this.flushed = false;
  }

  setHeader(key, value) {
    this.headers[key] = value;
  }

  flushHeaders() {
    this.flushed = true;
  }

  write(chunk) {
    this.writes.push(String(chunk));
    return true;
  }

  end() {
    this.ended = true;
  }
}

test('RealtimeHub subscribes with retry hint and filters by channel', () => {
  const hub = new RealtimeHub({ heartbeatMs: 60000 });
  const req = new EventEmitter();
  const res = new MockResponse();

  hub.subscribe(req, res, 'index');

  assert.equal(res.headers['Content-Type'], 'text/event-stream');
  assert.ok(res.writes.some((line) => line.includes('retry: 3000')));

  const writesBeforeApiPublish = res.writes.length;
  hub.publish('api', 'endpoint_executed', { ok: true });
  assert.equal(res.writes.length, writesBeforeApiPublish, 'api channel should be filtered out');

  hub.publish('index', 'sync_progress', { step: 1 });
  const lastWrite = res.writes[res.writes.length - 1] || '';
  assert.ok(lastWrite.includes('"channel":"index"'));
  assert.ok(lastWrite.includes('"type":"sync_progress"'));

  req.emit('close');
  assert.equal(res.ended, true);

  hub.close();
});
