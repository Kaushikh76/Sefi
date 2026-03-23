import crypto from 'crypto';

function parseChannels(rawChannels) {
  if (!rawChannels) return new Set(['index', 'api', 'activity']);
  const parsed = String(rawChannels)
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  const channels = new Set();
  for (const channel of parsed) {
    if (['index', 'api', 'activity'].includes(channel)) {
      channels.add(channel);
    }
  }

  if (channels.size === 0) {
    channels.add('index');
    channels.add('api');
    channels.add('activity');
  }

  return channels;
}

function setSseHeaders(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }
}

function writeSseData(res, payload) {
  const eventId = payload && payload.id ? String(payload.id) : crypto.randomUUID();
  res.write(`id: ${eventId}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export class RealtimeHub {
  constructor({ heartbeatMs = 15000 } = {}) {
    this.clients = new Map();
    this.heartbeatMs = Math.max(1000, Number(heartbeatMs) || 15000);
    this.heartbeatTimer = setInterval(() => {
      for (const client of this.clients.values()) {
        try {
          client.res.write(`: heartbeat ${Date.now()}\n\n`);
        } catch {
          this.removeClient(client.id);
        }
      }
    }, this.heartbeatMs);
    if (typeof this.heartbeatTimer.unref === 'function') {
      this.heartbeatTimer.unref();
    }
  }

  close() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    for (const client of this.clients.values()) {
      try {
        client.res.end();
      } catch {
        // best effort close
      }
    }
    this.clients.clear();
  }

  removeClient(clientId) {
    const client = this.clients.get(clientId);
    if (!client) return;
    this.clients.delete(clientId);
    try {
      client.res.end();
    } catch {
      // ignore close errors
    }
  }

  subscribe(req, res, rawChannels) {
    const channels = parseChannels(rawChannels);
    setSseHeaders(res);
    res.write('retry: 3000\n\n');

    const clientId = crypto.randomUUID();
    const client = {
      id: clientId,
      res,
      channels,
      createdAt: new Date().toISOString(),
    };

    this.clients.set(clientId, client);

    writeSseData(res, {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      channel: 'api',
      type: 'stream_connected',
      payload: {
        client_id: clientId,
        channels: [...channels],
      },
    });

    req.on('close', () => {
      this.removeClient(clientId);
    });

    return {
      client_id: clientId,
      channels: [...channels],
    };
  }

  publish(channel, type, payload = {}) {
    const safeChannel = String(channel || '').trim().toLowerCase();
    if (!['index', 'api', 'activity'].includes(safeChannel)) {
      return null;
    }

    const event = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      channel: safeChannel,
      type: String(type || 'event'),
      payload,
    };

    for (const client of this.clients.values()) {
      if (!client.channels.has(safeChannel)) {
        continue;
      }

      try {
        writeSseData(client.res, event);
      } catch {
        this.removeClient(client.id);
      }
    }

    return event;
  }
}
