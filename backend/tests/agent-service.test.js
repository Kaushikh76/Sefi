import test from 'node:test';
import assert from 'node:assert/strict';
import { SeFiAgentService } from '../src/agent-service.js';

function createMockConfig() {
  return {
    cubeApiUrl: 'http://cube.local/cubejs-api/v1',
    cubeApiToken: 'cube-token',
    openaiApiKey: 'sk-test',
    openaiApiBaseUrl: 'https://api.openai.com/v1',
    openaiModelFast: 'gpt-5-mini',
    openaiModelStrong: 'gpt-5',
    agentAutoExecuteDefault: true,
    agentSqlFallbackDefault: false,
    agentMaxQuestionChars: 2000,
  };
}

function createMockDatabase() {
  return {
    getSqliteSchema() {
      return [
        {
          name: 'stats',
          columns: [
            { name: 'key' },
            { name: 'value' },
          ],
        },
        {
          name: 'contract_logs',
          columns: [
            { name: 'contract_id' },
            { name: 'timestamp' },
          ],
        },
      ];
    },
    executeReadOnlyQuery(sql, options = {}) {
      return {
        columns: ['value'],
        rows: [{ value: 42 }],
        sql,
        max_rows: options.maxRows ?? 200,
      };
    },
  };
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  };
}

function createFetchMock({ cubeMeta, openaiOutput, cubeLoad }) {
  return async (url, init = {}) => {
    if (String(url).endsWith('/meta')) {
      return jsonResponse({ cubes: cubeMeta });
    }

    if (String(url).includes('/responses')) {
      return jsonResponse({
        output_text: JSON.stringify(openaiOutput),
      });
    }

    if (String(url).endsWith('/load')) {
      if (typeof cubeLoad === 'function') {
        return jsonResponse(cubeLoad({ url, init }));
      }
      return jsonResponse(cubeLoad ?? { data: [{ 'stats.count': 1 }] });
    }

    throw new Error(`Unexpected fetch URL in test: ${url}`);
  };
}

const cubeMetaFixture = [
  {
    name: 'stats',
    title: 'Stats',
    measures: [{ name: 'stats.count', title: 'Count', type: 'number' }],
    dimensions: [{ name: 'stats.key', title: 'Key', type: 'string' }],
  },
];

test('generatePlan flags hallucinated semantic members', async () => {
  const service = new SeFiAgentService({
    config: createMockConfig(),
    database: createMockDatabase(),
    fetchImpl: createFetchMock({
      cubeMeta: cubeMetaFixture,
      openaiOutput: {
        mode: 'cube_query',
        explanation: 'Try a metric',
        confidence: 0.61,
        cube_query: { measures: ['unknown.count'] },
        sql_fallback: null,
        clarification_question: null,
      },
    }),
  });

  const result = await service.generatePlan('How many records?');
  assert.equal(result.validation.valid, false);
  assert.equal(result.plan.mode, 'cube_query');
  assert.ok(result.validation.errors.some((item) => item.includes('Unknown semantic member')));
});

test('ask auto-executes validated semantic query', async () => {
  const service = new SeFiAgentService({
    config: createMockConfig(),
    database: createMockDatabase(),
    fetchImpl: createFetchMock({
      cubeMeta: cubeMetaFixture,
      openaiOutput: {
        mode: 'cube_query',
        explanation: 'Use stats count',
        confidence: 0.9,
        cube_query: { measures: ['stats.count'] },
        sql_fallback: null,
        clarification_question: null,
      },
      cubeLoad: { data: [{ 'stats.count': 12 }] },
    }),
  });

  const result = await service.ask('Count records', { auto_execute: true });
  assert.equal(result.executed, true);
  assert.equal(result.execution?.mode, 'cube_query');
  assert.equal(result.execution?.result?.data?.[0]?.['stats.count'], 12);
});

test('ask normalizes wrapped cube_query payloads before load execution', async () => {
  let capturedBody = null;

  const service = new SeFiAgentService({
    config: createMockConfig(),
    database: createMockDatabase(),
    fetchImpl: createFetchMock({
      cubeMeta: cubeMetaFixture,
      openaiOutput: {
        mode: 'cube_query',
        explanation: 'Use wrapped multi-query shape',
        confidence: 0.87,
        cube_query: {
          queries: [
            { measures: ['stats.count'] },
          ],
        },
        sql_fallback: null,
        clarification_question: null,
      },
      cubeLoad: ({ init }) => {
        capturedBody = JSON.parse(String(init?.body || '{}'));
        return { data: [{ 'stats.count': 9 }] };
      },
    }),
  });

  const result = await service.ask('Count records with wrapper shape', { auto_execute: true });
  assert.equal(result.executed, true);
  assert.equal(result.execution?.mode, 'cube_query');
  assert.deepEqual(capturedBody, { query: { measures: ['stats.count'] } });
  assert.equal(result.execution?.result?.data?.[0]?.['stats.count'], 9);
});

test('generatePlan accepts cube order arrays with measure/dimension references', async () => {
  const service = new SeFiAgentService({
    config: createMockConfig(),
    database: createMockDatabase(),
    fetchImpl: createFetchMock({
      cubeMeta: cubeMetaFixture,
      openaiOutput: {
        mode: 'cube_query',
        explanation: 'Use array-based order payload',
        confidence: 0.77,
        cube_query: {
          measures: ['stats.count'],
          dimensions: ['stats.key'],
          order: [
            { measure: 'stats.count', dir: 'desc' },
            { dimension: 'stats.key', dir: 'asc' },
          ],
        },
        sql_fallback: null,
        clarification_question: null,
      },
    }),
  });

  const result = await service.generatePlan('Order stats by count');
  assert.equal(result.validation.valid, true);
  assert.equal(result.validation.errors.length, 0);
});

test('sql fallback is blocked when policy disables it', async () => {
  const service = new SeFiAgentService({
    config: createMockConfig(),
    database: createMockDatabase(),
    fetchImpl: createFetchMock({
      cubeMeta: cubeMetaFixture,
      openaiOutput: {
        mode: 'sql_fallback',
        explanation: 'Use SQL',
        confidence: 0.5,
        cube_query: null,
        sql_fallback: 'SELECT key, value FROM stats LIMIT 10',
        clarification_question: null,
      },
    }),
  });

  const result = await service.generatePlan('Need fallback SQL', { allow_sql_fallback: false });
  assert.equal(result.validation.valid, false);
  assert.ok(result.validation.errors.some((item) => item.includes('disabled by policy')));
});

test('executePlan rejects fallback SQL with unknown tables', async () => {
  const service = new SeFiAgentService({
    config: createMockConfig(),
    database: createMockDatabase(),
    fetchImpl: createFetchMock({
      cubeMeta: cubeMetaFixture,
      openaiOutput: {
        mode: 'clarification',
        explanation: 'n/a',
        confidence: 0.1,
        cube_query: null,
        sql_fallback: null,
        clarification_question: 'n/a',
      },
    }),
  });

  await assert.rejects(
    () =>
      service.executePlan(
        {
          mode: 'sql_fallback',
          explanation: 'bad table',
          confidence: 0.2,
          cube_query: null,
          sql_fallback: 'SELECT * FROM imaginary_table LIMIT 10',
          clarification_question: null,
        },
        { allow_sql_fallback: true }
      ),
    (error) => {
      assert.equal(error.code, 'PLAN_VALIDATION_FAILED');
      assert.equal(error.status, 400);
      return true;
    }
  );
});
