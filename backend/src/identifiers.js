const HEDERA_ID_PATTERN = /^(\d{1,10}\.){0,2}\d{1,10}$/;
const EVM_ADDRESS_PATTERN = /^(0x)?[A-Fa-f0-9]{40}$/;

export function isHederaId(value) {
  const normalized = String(value || '').trim();
  return HEDERA_ID_PATTERN.test(normalized);
}

export function isEvmAddress(value) {
  const normalized = String(value || '').trim();
  return EVM_ADDRESS_PATTERN.test(normalized);
}

export function normalizeHederaId(value) {
  return String(value || '').trim();
}

export function normalizeEvmAddress(value, options = {}) {
  const { stripPrefix = false } = options;
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  if (!EVM_ADDRESS_PATTERN.test(normalized)) return normalized;

  const hex = normalized.toLowerCase().replace(/^0x/, '');
  if (stripPrefix) return hex;
  return `0x${hex}`;
}

export function normalizeContractId(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  if (isEvmAddress(normalized)) {
    return normalizeEvmAddress(normalized);
  }
  return normalizeHederaId(normalized);
}

export function canonicalEntityKey(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  if (isEvmAddress(normalized)) {
    return normalizeEvmAddress(normalized, { stripPrefix: true });
  }
  return normalized.toLowerCase();
}

export function hasValidEntityId(value) {
  const normalized = String(value || '').trim();
  return isHederaId(normalized) || isEvmAddress(normalized);
}
