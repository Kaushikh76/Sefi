import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

function toSafeIdentifier(value, fallback = 'field') {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!normalized) {
    return fallback;
  }

  if (/^[0-9]/.test(normalized)) {
    return `${fallback}_${normalized}`;
  }

  return normalized;
}

function escapeSqlIdentifier(identifier) {
  const value = String(identifier || '').trim();
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    return value;
  }
  return `"${value.replaceAll('"', '""')}"`;
}

function detectTypeAffinity(typeText) {
  const upper = String(typeText || '').toUpperCase();
  if (upper.includes('INT')) return 'numeric';
  if (upper.includes('REAL') || upper.includes('FLOA') || upper.includes('DOUB')) return 'numeric';
  if (upper.includes('NUMERIC') || upper.includes('DECIMAL')) return 'numeric';
  if (upper.includes('DATE') || upper.includes('TIME')) return 'time';
  return 'text';
}

function inferDimensionType(column) {
  const name = String(column.name || '').toLowerCase();
  const affinity = detectTypeAffinity(column.type);

  if (name.includes('timestamp') || name.endsWith('_at') || name.includes('date') || name.includes('time')) {
    return 'time';
  }

  if (affinity === 'time') {
    return 'time';
  }

  if (affinity === 'numeric') {
    return 'number';
  }

  return 'string';
}

function ensureInsideRoot(rootDir, targetPath) {
  const root = path.resolve(rootDir);
  const target = path.resolve(targetPath);
  return target === root || target.startsWith(`${root}${path.sep}`);
}

function toPosixPath(filePath) {
  return String(filePath).split(path.sep).join('/');
}

function isYamlFile(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  return ext === '.yml' || ext === '.yaml';
}

function canWriteDirectory(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    fs.accessSync(dirPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

const UNSUPPORTED_GENERATED_TABLES = new Set(['balances', 'hbar_transfers']);

function renderCubeYaml(table) {
  const tableName = String(table.name);
  const cubeName = `gen_${toSafeIdentifier(tableName, 'table')}`;
  const tableSql = `main.${escapeSqlIdentifier(tableName)}`;

  const usedDimensionNames = new Set();
  const usedMeasureNames = new Set(['count']);
  const numericColumns = [];

  const dimensionBlocks = table.columns.map((column) => {
    const baseName = toSafeIdentifier(column.name, 'column');
    let name = baseName;
    let suffix = 2;
    while (usedDimensionNames.has(name)) {
      name = `${baseName}_${suffix}`;
      suffix += 1;
    }
    usedDimensionNames.add(name);

    const sql = escapeSqlIdentifier(column.name);
    const type = inferDimensionType(column);

    if (type === 'number') {
      numericColumns.push({ name, sql });
    }

    const lines = [
      '      - name: ' + name,
      '        sql: ' + sql,
      '        type: ' + type,
    ];

    if (column.primary_key) {
      lines.push('        primary_key: true');
    }

    return lines.join('\n');
  });

  const measureBlocks = ['      - name: count\n        type: count'];

  for (const numericColumn of numericColumns) {
    const baseMeasureName = `sum_${numericColumn.name}`;
    let measureName = baseMeasureName;
    let suffix = 2;
    while (usedMeasureNames.has(measureName)) {
      measureName = `${baseMeasureName}_${suffix}`;
      suffix += 1;
    }
    usedMeasureNames.add(measureName);

    measureBlocks.push(
      [
        `      - name: ${measureName}`,
        `        sql: ${numericColumn.sql}`,
        '        type: sum',
      ].join('\n')
    );
  }

  return [
    'cubes:',
    `  - name: ${cubeName}`,
    `    sql_table: ${tableSql}`,
    '    data_source: default',
    '',
    '    joins: []',
    '',
    '    dimensions:',
    dimensionBlocks.length > 0 ? dimensionBlocks.join('\n\n') : '      - name: placeholder\n        sql: 1\n        type: number',
    '',
    '    measures:',
    measureBlocks.join('\n\n'),
    '',
  ].join('\n');
}

export class ModelingService {
  constructor({ config, database }) {
    this.config = config;
    this.database = database;
  }

  getModelRoot() {
    return path.resolve(this.config.cubeModelDir);
  }

  getGeneratedModelRoot() {
    return path.resolve(this.getModelRoot(), 'generated', 'cubes');
  }

  resolveModelPath(modelPath) {
    if (typeof modelPath !== 'string' || modelPath.trim() === '') {
      const error = new Error('path is required');
      error.code = 'INVALID_PATH';
      throw error;
    }

    const normalizedInput = modelPath.trim().replaceAll('\\', '/');
    const modelRoot = this.getModelRoot();
    const absolutePath = path.resolve(modelRoot, normalizedInput);

    if (!ensureInsideRoot(modelRoot, absolutePath)) {
      const error = new Error('path must be inside cube model directory');
      error.code = 'INVALID_PATH';
      throw error;
    }

    if (!isYamlFile(absolutePath)) {
      const error = new Error('model file must use .yml or .yaml extension');
      error.code = 'INVALID_PATH';
      throw error;
    }

    const relativePath = toPosixPath(path.relative(modelRoot, absolutePath));
    if (!relativePath || relativePath.startsWith('..')) {
      const error = new Error('invalid model path');
      error.code = 'INVALID_PATH';
      throw error;
    }

    return {
      model_root: modelRoot,
      path: relativePath,
      file_path: absolutePath,
    };
  }

  listModelFiles(scope = 'all') {
    const safeScope = scope === 'generated' ? 'generated' : scope === 'curated' ? 'curated' : 'all';
    const modelRoot = this.getModelRoot();
    const files = [];

    if (!fs.existsSync(modelRoot)) {
      return {
        model_root: modelRoot,
        generated_root: this.getGeneratedModelRoot(),
        scope: safeScope,
        count: 0,
        files: [],
      };
    }

    const walk = (dirPath) => {
      for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        const absolutePath = path.resolve(dirPath, entry.name);
        if (!ensureInsideRoot(modelRoot, absolutePath)) continue;

        if (entry.isDirectory()) {
          walk(absolutePath);
          continue;
        }

        if (!entry.isFile() || !isYamlFile(entry.name)) continue;

        const relativePath = toPosixPath(path.relative(modelRoot, absolutePath));
        const fileScope = relativePath.startsWith('generated/') ? 'generated' : 'curated';
        if (safeScope !== 'all' && safeScope !== fileScope) continue;

        const stats = fs.statSync(absolutePath);
        files.push({
          path: relativePath,
          file_path: absolutePath,
          scope: fileScope,
          size_bytes: stats.size,
          updated_at: new Date(stats.mtimeMs).toISOString(),
        });
      }
    };

    walk(modelRoot);
    files.sort((a, b) => a.path.localeCompare(b.path));

    return {
      model_root: modelRoot,
      generated_root: this.getGeneratedModelRoot(),
      scope: safeScope,
      count: files.length,
      files,
    };
  }

  getModelFileContent(modelPath) {
    const resolved = this.resolveModelPath(modelPath);

    if (!fs.existsSync(resolved.file_path)) {
      const error = new Error(`Model file not found: ${resolved.path}`);
      error.code = 'NOT_FOUND';
      throw error;
    }

    const stats = fs.statSync(resolved.file_path);
    return {
      ...resolved,
      content: fs.readFileSync(resolved.file_path, 'utf8'),
      size_bytes: stats.size,
      updated_at: new Date(stats.mtimeMs).toISOString(),
    };
  }

  upsertModelFile(modelPath, content) {
    if (typeof content !== 'string') {
      const error = new Error('content must be a string');
      error.code = 'INVALID_CONTENT';
      throw error;
    }

    const resolved = this.resolveModelPath(modelPath);
    const existedBefore = fs.existsSync(resolved.file_path);

    fs.mkdirSync(path.dirname(resolved.file_path), { recursive: true });
    fs.writeFileSync(resolved.file_path, content, 'utf8');

    const stats = fs.statSync(resolved.file_path);
    return {
      ...resolved,
      created: !existedBefore,
      updated_at: new Date(stats.mtimeMs).toISOString(),
      size_bytes: stats.size,
    };
  }

  deleteModelFile(modelPath) {
    const resolved = this.resolveModelPath(modelPath);

    if (!fs.existsSync(resolved.file_path)) {
      const error = new Error(`Model file not found: ${resolved.path}`);
      error.code = 'NOT_FOUND';
      throw error;
    }

    fs.unlinkSync(resolved.file_path);
    return {
      ...resolved,
      deleted: true,
      deleted_at: new Date().toISOString(),
    };
  }

  getModelStorageStatus() {
    const modelRoot = this.getModelRoot();
    const generatedRoot = this.getGeneratedModelRoot();
    const modelFiles = this.listModelFiles('all').files;

    return {
      model_root: modelRoot,
      generated_root: generatedRoot,
      model_root_exists: fs.existsSync(modelRoot),
      generated_root_exists: fs.existsSync(generatedRoot),
      model_root_writable: canWriteDirectory(modelRoot),
      generated_root_writable: canWriteDirectory(generatedRoot),
      file_count: modelFiles.length,
      generated_file_count: modelFiles.filter((file) => file.scope === 'generated').length,
      curated_file_count: modelFiles.filter((file) => file.scope === 'curated').length,
      persistence: {
        mode: 'filesystem',
        hint: 'Models are saved under cube/model on disk. The host backend writes the live SQLite DB locally and refreshes a separate Cube snapshot DB, so generated model edits persist across backend and Cube restarts.',
        backend_model_dir: this.config.cubeModelDir,
      },
    };
  }

  getSqliteSchema() {
    const tables = this.database.getSqliteSchema();
    return {
      database_path: this.config.dbPath,
      table_count: tables.length,
      tables,
    };
  }

  buildPreview() {
    const schema = this.getSqliteSchema();
    const generatedRoot = this.getGeneratedModelRoot();
    const existingFiles = new Map();

    if (fs.existsSync(generatedRoot)) {
      for (const entry of fs.readdirSync(generatedRoot, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.yml')) continue;
        const absolutePath = path.resolve(generatedRoot, entry.name);
        if (!ensureInsideRoot(generatedRoot, absolutePath)) continue;
        existingFiles.set(absolutePath, fs.readFileSync(absolutePath, 'utf8'));
      }
    }

    const files = [];
    const plannedPaths = new Set();

    for (const table of schema.tables) {
      if (UNSUPPORTED_GENERATED_TABLES.has(String(table.name))) {
        continue;
      }

      const fileName = `${toSafeIdentifier(table.name, 'table')}.yml`;
      const absolutePath = path.resolve(generatedRoot, fileName);
      const cubeYaml = renderCubeYaml(table);
      const previous = existingFiles.get(absolutePath);

      let status = 'new';
      if (typeof previous === 'string' && previous === cubeYaml) {
        status = 'unchanged';
      } else if (typeof previous === 'string') {
        status = 'changed';
      }

      plannedPaths.add(absolutePath);

      files.push({
        table_name: table.name,
        cube_name: `gen_${toSafeIdentifier(table.name, 'table')}`,
        file_name: fileName,
        file_path: absolutePath,
        status,
        previous_content: previous || null,
        content: cubeYaml,
      });
    }

    const removedFiles = [...existingFiles.keys()]
      .filter((existingPath) => !plannedPaths.has(existingPath))
      .map((absolutePath) => ({
        file_name: path.basename(absolutePath),
        file_path: absolutePath,
      }))
      .sort((a, b) => a.file_name.localeCompare(b.file_name));

    files.sort((a, b) => a.file_name.localeCompare(b.file_name));

    const summary = {
      tables_discovered: schema.table_count,
      files_new: files.filter((file) => file.status === 'new').length,
      files_changed: files.filter((file) => file.status === 'changed').length,
      files_unchanged: files.filter((file) => file.status === 'unchanged').length,
      files_removed: removedFiles.length,
    };

    const hashPayload = {
      tables: schema.tables.map((table) => ({
        name: table.name,
        columns: table.columns.map((column) => ({
          name: column.name,
          type: column.type,
          primary_key: column.primary_key,
          notnull: column.notnull,
        })),
      })),
      files: files.map((file) => ({ file_name: file.file_name, content: file.content })),
      removed: removedFiles.map((file) => file.file_name),
    };

    const previewId = crypto.createHash('sha1').update(JSON.stringify(hashPayload)).digest('hex');

    return {
      preview_id: previewId,
      generated_at: new Date().toISOString(),
      generated_root: generatedRoot,
      summary,
      schema,
      files,
      removed_files: removedFiles,
    };
  }

  applyPreview(previewId = null) {
    const preview = this.buildPreview();

    if (previewId && preview.preview_id !== previewId) {
      const error = new Error('Preview is stale. Generate a new preview and apply again.');
      error.code = 'STALE_PREVIEW';
      error.currentPreviewId = preview.preview_id;
      throw error;
    }

    fs.mkdirSync(preview.generated_root, { recursive: true });

    let written = 0;
    let removed = 0;

    for (const file of preview.files) {
      if (!ensureInsideRoot(preview.generated_root, file.file_path)) {
        throw new Error(`Refusing to write outside generated model directory: ${file.file_path}`);
      }

      if (file.status === 'new' || file.status === 'changed') {
        fs.writeFileSync(file.file_path, file.content, 'utf8');
        written += 1;
      }
    }

    for (const file of preview.removed_files) {
      if (!ensureInsideRoot(preview.generated_root, file.file_path)) {
        throw new Error(`Refusing to remove outside generated model directory: ${file.file_path}`);
      }

      if (fs.existsSync(file.file_path)) {
        fs.unlinkSync(file.file_path);
        removed += 1;
      }
    }

    return {
      preview_id: preview.preview_id,
      applied_at: new Date().toISOString(),
      summary: preview.summary,
      writes_applied: written,
      removals_applied: removed,
      unchanged_files: preview.summary.files_unchanged,
      generated_root: preview.generated_root,
      refresh_hint: 'If Cube metadata is stale, wait a moment or restart the Cube container.',
    };
  }
}
