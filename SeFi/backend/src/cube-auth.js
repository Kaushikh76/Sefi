import crypto from 'crypto';

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signHs256(secret, value) {
  return crypto
    .createHmac('sha256', secret)
    .update(value)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function isLikelyJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return false;
  return parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part));
}

function buildServiceJwt(secret) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    iat: now,
    exp: now + 3600,
  };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const unsigned = `${encodedHeader}.${encodedPayload}`;
  const signature = signHs256(secret, unsigned);
  return `${unsigned}.${signature}`;
}

export function resolveCubeAuthToken(rawToken) {
  const candidate = String(rawToken || '').trim();
  if (!candidate) {
    return {
      token: '',
      source: 'none',
    };
  }

  const normalized = candidate.replace(/^Bearer\s+/i, '').trim();
  if (!normalized) {
    return {
      token: '',
      source: 'none',
    };
  }

  if (isLikelyJwt(normalized)) {
    return {
      token: normalized,
      source: 'jwt',
    };
  }

  return {
    token: buildServiceJwt(normalized),
    source: 'secret',
  };
}

