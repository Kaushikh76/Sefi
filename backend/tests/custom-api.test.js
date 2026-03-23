import test from 'node:test';
import assert from 'node:assert/strict';
import {
  materializeQueryTemplate,
  resolveRuntimeParams,
  slugify,
  validateEndpointDefinition,
} from '../src/custom-api.js';

test('slugify normalizes endpoint slug', () => {
  assert.equal(slugify('  Total Transfers V1  '), 'total-transfers-v1');
});

test('validateEndpointDefinition validates and normalizes payload', () => {
  const input = {
    name: 'Top Contracts',
    slug: 'Top_Contracts',
    enabled: true,
    description: 'Top contracts endpoint',
    query_template: {
      measures: ['contract_logs.count'],
      limit: '{{limit}}',
    },
    params_schema: [
      {
        name: 'limit',
        type: 'number',
        required: false,
        default: 50,
      },
    ],
  };

  const validated = validateEndpointDefinition(input, { partial: false });
  assert.deepEqual(validated.errors, []);
  assert.equal(validated.value.slug, 'top-contracts');
  assert.equal(validated.value.params_schema[0].type, 'number');
});

test('resolveRuntimeParams applies defaults and blocks wrong types', () => {
  const schema = [
    { name: 'limit', type: 'number', required: false, default: 25 },
    { name: 'includeZero', type: 'boolean', required: true },
  ];

  const valid = resolveRuntimeParams(schema, {
    includeZero: 'true',
  });

  assert.deepEqual(valid.errors, []);
  assert.equal(valid.values.limit, 25);
  assert.equal(valid.values.includeZero, true);

  const invalid = resolveRuntimeParams(schema, {
    includeZero: 'invalid-bool',
  });

  assert.ok(invalid.errors.some((entry) => entry.includes('includeZero')));
});

test('materializeQueryTemplate substitutes placeholder tokens', () => {
  const template = {
    measures: ['stats.count'],
    filters: [
      {
        member: 'contracts.category',
        operator: 'equals',
        values: ['{{category}}'],
      },
    ],
    limit: '{{limit}}',
  };

  const query = materializeQueryTemplate(template, {
    category: 'pool',
    limit: 10,
  });

  assert.deepEqual(query.filters[0].values, ['pool']);
  assert.equal(query.limit, 10);
});
