function parseBoolean(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function toSafeString(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  return String(value);
}

function parseNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function coerceValueByType(rawValue, type) {
  if (type === 'string') {
    if (rawValue === undefined || rawValue === null) return null;
    return String(rawValue);
  }

  if (type === 'number') {
    return parseNumber(rawValue);
  }

  if (type === 'boolean') {
    return parseBoolean(rawValue, null);
  }

  return null;
}

export function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function normalizeParamSchema(schema) {
  const source = Array.isArray(schema) ? schema : [];
  const normalized = [];
  const errors = [];

  for (let index = 0; index < source.length; index += 1) {
    const item = source[index];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push(`params_schema[${index}] must be an object`);
      continue;
    }

    const name = String(item.name || '').trim();
    if (!name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      errors.push(`params_schema[${index}].name must be a valid identifier`);
      continue;
    }

    const type = String(item.type || 'string').trim().toLowerCase();
    if (!['string', 'number', 'boolean'].includes(type)) {
      errors.push(`params_schema[${index}].type must be string|number|boolean`);
      continue;
    }

    const required = parseBoolean(item.required, false) === true;
    const description = toSafeString(item.description, '').trim();

    let defaultValue = item.default;
    if (defaultValue !== undefined) {
      defaultValue = coerceValueByType(defaultValue, type);
      if (defaultValue === null && item.default !== null && item.default !== undefined) {
        errors.push(`params_schema[${index}].default does not match type ${type}`);
        continue;
      }
    }

    normalized.push({
      name,
      type,
      required,
      description,
      default: defaultValue,
    });
  }

  const dedupe = new Set();
  for (const entry of normalized) {
    const key = entry.name.toLowerCase();
    if (dedupe.has(key)) {
      errors.push(`Duplicate parameter name: ${entry.name}`);
    }
    dedupe.add(key);
  }

  return {
    schema: normalized,
    errors,
  };
}

export function validateEndpointDefinition(input, { partial = false } = {}) {
  const errors = [];
  const payload = input && typeof input === 'object' && !Array.isArray(input) ? input : {};

  const next = {
    name: undefined,
    slug: undefined,
    description: undefined,
    enabled: undefined,
    query_template: undefined,
    params_schema: undefined,
  };

  if (!partial || Object.prototype.hasOwnProperty.call(payload, 'name')) {
    const name = String(payload.name || '').trim();
    if (!name) {
      errors.push('name is required');
    }
    next.name = name;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, 'slug')) {
    const slug = slugify(payload.slug || payload.name);
    if (!slug) {
      errors.push('slug is required');
    }
    next.slug = slug;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, 'description')) {
    next.description = toSafeString(payload.description, '').trim();
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, 'enabled')) {
    const enabled = parseBoolean(payload.enabled, null);
    if (enabled === null && payload.enabled !== undefined) {
      errors.push('enabled must be boolean');
    }
    next.enabled = enabled ?? true;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, 'query_template')) {
    const template = payload.query_template;
    if (!template || typeof template !== 'object' || Array.isArray(template)) {
      errors.push('query_template must be an object');
    }
    next.query_template = template;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, 'params_schema')) {
    const normalized = normalizeParamSchema(payload.params_schema);
    errors.push(...normalized.errors);
    next.params_schema = normalized.schema;
  }

  return {
    value: next,
    errors,
  };
}

export function resolveRuntimeParams(paramSchema, rawParams = {}) {
  const schema = Array.isArray(paramSchema) ? paramSchema : [];
  const payload = rawParams && typeof rawParams === 'object' && !Array.isArray(rawParams) ? rawParams : {};

  const values = {};
  const errors = [];
  const warnings = [];
  const knownKeys = new Set(schema.map((entry) => entry.name));

  for (const [key] of Object.entries(payload)) {
    if (!knownKeys.has(key)) {
      warnings.push(`Ignoring unknown parameter: ${key}`);
    }
  }

  for (const entry of schema) {
    const raw = Object.prototype.hasOwnProperty.call(payload, entry.name) ? payload[entry.name] : undefined;
    let value = raw;

    if (value === undefined || value === null || value === '') {
      if (entry.default !== undefined) {
        value = entry.default;
      }
    }

    if ((value === undefined || value === null || value === '') && entry.required) {
      errors.push(`Missing required parameter: ${entry.name}`);
      continue;
    }

    if (value === undefined || value === null || value === '') {
      continue;
    }

    const coerced = coerceValueByType(value, entry.type);
    if (coerced === null && value !== null) {
      errors.push(`Parameter ${entry.name} must be ${entry.type}`);
      continue;
    }

    values[entry.name] = coerced;
  }

  return {
    values,
    errors,
    warnings,
  };
}

function renderTemplateString(value, params) {
  const text = String(value || '');
  const exactMatch = text.match(/^\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/);
  if (exactMatch) {
    const key = exactMatch[1];
    if (Object.prototype.hasOwnProperty.call(params, key)) {
      return params[key];
    }
    return value;
  }

  return text.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (full, key) => {
    if (!Object.prototype.hasOwnProperty.call(params, key)) {
      return full;
    }
    const replacement = params[key];
    if (replacement === undefined || replacement === null) return '';
    return String(replacement);
  });
}

export function materializeQueryTemplate(queryTemplate, params) {
  const apply = (node) => {
    if (typeof node === 'string') {
      return renderTemplateString(node, params);
    }

    if (Array.isArray(node)) {
      return node.map((entry) => apply(entry));
    }

    if (node && typeof node === 'object') {
      const output = {};
      for (const [key, value] of Object.entries(node)) {
        output[key] = apply(value);
      }
      return output;
    }

    return node;
  };

  return apply(queryTemplate);
}
