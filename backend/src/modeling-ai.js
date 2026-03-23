import crypto from 'crypto';
import { parse as parseYaml } from 'yaml';

function createModelingAiError(status, code, message, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  return error;
}

function pickOutputText(responsePayload) {
  if (typeof responsePayload?.output_text === 'string' && responsePayload.output_text.trim() !== '') {
    return responsePayload.output_text.trim();
  }

  if (!Array.isArray(responsePayload?.output)) {
    return null;
  }

  for (const outputItem of responsePayload.output) {
    if (!Array.isArray(outputItem?.content)) continue;
    for (const contentItem of outputItem.content) {
      const textCandidate = contentItem?.text || contentItem?.output_text || null;
      if (typeof textCandidate === 'string' && textCandidate.trim() !== '') {
        return textCandidate.trim();
      }
    }
  }

  return null;
}

function parseJsonSafe(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function buildResponseSchema() {
  return {
    name: 'sefi_model_draft',
    strict: false,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        target_path: { type: 'string' },
        yaml: { type: 'string' },
        rationale: { type: 'string' },
        warnings: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      required: ['target_path', 'yaml', 'rationale', 'warnings'],
    },
  };
}

function compactSchema(schema) {
  const tables = Array.isArray(schema?.tables) ? schema.tables : [];
  return tables.map((table) => ({
    name: String(table.name || ''),
    columns: Array.isArray(table.columns)
      ? table.columns.map((column) => ({
          name: String(column.name || ''),
          type: String(column.type || ''),
          primary_key: column.primary_key === true,
        }))
      : [],
  }));
}

function summarizeCubeMeta(cubeMeta) {
  const cubes = Array.isArray(cubeMeta?.cubes) ? cubeMeta.cubes : [];
  return cubes.map((cube) => ({
    name: String(cube.name || ''),
    measures: Array.isArray(cube.measures)
      ? cube.measures.map((measure) => String(measure?.name || '')).filter(Boolean)
      : [],
    dimensions: Array.isArray(cube.dimensions)
      ? cube.dimensions.map((dimension) => String(dimension?.name || '')).filter(Boolean)
      : [],
  }));
}

export class ModelingAiService {
  constructor({ config, database, modelingService, fetchImpl = fetch }) {
    this.config = config;
    this.database = database;
    this.modelingService = modelingService;
    this.fetchImpl = fetchImpl;
  }

  buildSystemPrompt() {
    return [
      'You are a Cube semantic model generator for SeFi.',
      'Return strict JSON matching the provided schema.',
      'Generate valid Cube YAML under the cubes: root key.',
      'Prefer stable naming and explicit dimensions/measures.',
      'Do not include markdown code fences in yaml output.',
      'Use sql_table with main.<table_name> when mapping SQLite tables.',
    ].join('\n');
  }

  buildPromptPayload({ intent, constraints, targetPath, sqliteSchema, cubeMeta, modelFiles, targetFileContent }) {
    return {
      intent,
      constraints: constraints || '',
      preferred_target_path: targetPath || 'generated/cubes/ai_generated.yml',
      sqlite_schema: compactSchema(sqliteSchema),
      cube_meta: summarizeCubeMeta(cubeMeta),
      existing_model_files: modelFiles.map((entry) => ({
        path: entry.path,
        scope: entry.scope,
      })),
      target_file_content: targetFileContent || null,
      output_requirements: {
        yaml_root_key: 'cubes',
        include_data_source: 'default',
        max_yaml_chars: 30000,
      },
    };
  }

  async callOpenAiModelDraft({ intent, constraints, targetPath, sqliteSchema, cubeMeta, modelFiles, targetFileContent }) {
    if (!this.config.openaiApiKey) {
      throw createModelingAiError(503, 'OPENAI_NOT_CONFIGURED', 'OPENAI_API_KEY is not configured');
    }

    const responseSchema = buildResponseSchema();
    const payload = this.buildPromptPayload({
      intent,
      constraints,
      targetPath,
      sqliteSchema,
      cubeMeta,
      modelFiles,
      targetFileContent,
    });

    const response = await this.fetchImpl(`${this.config.openaiApiBaseUrl}/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: this.config.openaiModelStrong || this.config.openaiModelFast || 'gpt-5',
        input: [
          {
            role: 'system',
            content: [{ type: 'input_text', text: this.buildSystemPrompt() }],
          },
          {
            role: 'user',
            content: [{ type: 'input_text', text: JSON.stringify(payload) }],
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: responseSchema.name,
            strict: responseSchema.strict,
            schema: responseSchema.schema,
          },
        },
      }),
    });

    const responsePayload = await response.json();
    if (!response.ok) {
      throw createModelingAiError(
        502,
        'OPENAI_REQUEST_FAILED',
        responsePayload?.error?.message || `OpenAI request failed with HTTP ${response.status}`,
        responsePayload?.error || null
      );
    }

    const outputText = pickOutputText(responsePayload);
    if (!outputText) {
      throw createModelingAiError(502, 'OPENAI_EMPTY_OUTPUT', 'OpenAI response did not include draft output');
    }

    const parsed = parseJsonSafe(outputText);
    if (!parsed) {
      throw createModelingAiError(502, 'OPENAI_INVALID_JSON', 'OpenAI response is not valid JSON', { output: outputText });
    }

    return {
      model: this.config.openaiModelStrong || this.config.openaiModelFast || 'gpt-5',
      parsed,
    };
  }

  validateDraft({ targetPath, yamlText }) {
    const errors = [];
    const warnings = [];
    let resolvedPath = null;

    try {
      resolvedPath = this.modelingService.resolveModelPath(targetPath);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Invalid target path');
    }

    if (typeof yamlText !== 'string' || yamlText.trim() === '') {
      errors.push('Generated YAML is required');
      return {
        valid: false,
        errors,
        warnings,
        cube_count: 0,
        resolved_path: resolvedPath,
      };
    }

    if (yamlText.length > 2_000_000) {
      errors.push('Generated YAML is too large (max 2MB)');
    }

    let parsedYaml = null;
    try {
      parsedYaml = parseYaml(yamlText);
    } catch (error) {
      errors.push(`YAML parse failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    const cubes = Array.isArray(parsedYaml?.cubes) ? parsedYaml.cubes : [];
    if (parsedYaml && !Array.isArray(parsedYaml?.cubes)) {
      errors.push('YAML must include a top-level cubes array');
    }

    for (let index = 0; index < cubes.length; index += 1) {
      const cube = cubes[index];
      if (!cube || typeof cube !== 'object') {
        errors.push(`cubes[${index}] must be an object`);
        continue;
      }

      if (typeof cube.name !== 'string' || cube.name.trim() === '') {
        errors.push(`cubes[${index}].name is required`);
      }

      if (typeof cube.sql_table !== 'string' || cube.sql_table.trim() === '') {
        warnings.push(`cubes[${index}] does not define sql_table`);
      }

      if (cube.dimensions !== undefined && !Array.isArray(cube.dimensions)) {
        errors.push(`cubes[${index}].dimensions must be an array when provided`);
      }

      if (cube.measures !== undefined && !Array.isArray(cube.measures)) {
        errors.push(`cubes[${index}].measures must be an array when provided`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      cube_count: cubes.length,
      resolved_path: resolvedPath,
    };
  }

  resolveTargetFileContent(targetPath) {
    if (!targetPath) return null;
    try {
      const existing = this.modelingService.getModelFileContent(targetPath);
      return existing.content;
    } catch {
      return null;
    }
  }

  async generateDraft({ intent, constraints = '', targetPath = '' }, cubeMeta = null) {
    const normalizedIntent = String(intent || '').trim();
    if (!normalizedIntent) {
      throw createModelingAiError(400, 'INVALID_INTENT', 'intent is required');
    }
    if (normalizedIntent.length > 8000) {
      throw createModelingAiError(400, 'INVALID_INTENT', 'intent is too long (max 8000 chars)');
    }

    const preferredPath = String(targetPath || '').trim() || 'generated/cubes/ai_generated.yml';

    const sqliteSchema = this.modelingService.getSqliteSchema();
    const modelFiles = this.modelingService.listModelFiles('all').files;
    const targetFileContent = this.resolveTargetFileContent(preferredPath);

    const aiOutput = await this.callOpenAiModelDraft({
      intent: normalizedIntent,
      constraints: String(constraints || '').trim(),
      targetPath: preferredPath,
      sqliteSchema,
      cubeMeta,
      modelFiles,
      targetFileContent,
    });

    const generatedTargetPath = String(aiOutput.parsed?.target_path || preferredPath).trim() || preferredPath;
    const generatedYaml = String(aiOutput.parsed?.yaml || '').trim();
    const rationale = String(aiOutput.parsed?.rationale || '').trim();
    const llmWarnings = Array.isArray(aiOutput.parsed?.warnings)
      ? aiOutput.parsed.warnings.map((entry) => String(entry)).filter(Boolean)
      : [];

    const validation = this.validateDraft({
      targetPath: generatedTargetPath,
      yamlText: generatedYaml,
    });

    const contextHash = crypto
      .createHash('sha256')
      .update(
        JSON.stringify({
          intent: normalizedIntent,
          constraints: String(constraints || '').trim(),
          target_path: generatedTargetPath,
          sqlite_schema: compactSchema(sqliteSchema),
          cube_meta: summarizeCubeMeta(cubeMeta),
          model_files: modelFiles.map((file) => file.path),
        })
      )
      .digest('hex');

    const draftRecord = this.database.createAiModelDraft({
      intent_text: normalizedIntent,
      constraints_text: String(constraints || '').trim(),
      target_path: generatedTargetPath,
      generated_yaml: generatedYaml,
      rationale,
      warnings: llmWarnings,
      validation,
      context_hash: contextHash,
      llm_model: aiOutput.model,
    });

    return draftRecord;
  }

  getDraft(draftId) {
    const draft = this.database.getAiModelDraft(draftId);
    if (!draft) {
      throw createModelingAiError(404, 'NOT_FOUND', `Draft not found: ${draftId}`);
    }
    return draft;
  }

  approveDraft({ draftId, pathOverride = null }) {
    const draft = this.getDraft(draftId);
    if (draft.status === 'approved') {
      return {
        draft,
        save: null,
        already_approved: true,
      };
    }

    const finalPath = String(pathOverride || draft.target_path || '').trim();
    if (!finalPath) {
      throw createModelingAiError(400, 'INVALID_MODEL_PATH', 'A target model path is required for approval');
    }

    const validation = this.validateDraft({
      targetPath: finalPath,
      yamlText: draft.generated_yaml,
    });

    if (!validation.valid) {
      throw createModelingAiError(400, 'INVALID_DRAFT', 'Draft failed validation and cannot be approved', validation);
    }

    const saveResult = this.modelingService.upsertModelFile(finalPath, draft.generated_yaml);
    this.database.approveAiModelDraft(draftId, finalPath);

    return {
      draft: this.getDraft(draftId),
      save: saveResult,
      already_approved: false,
    };
  }
}
