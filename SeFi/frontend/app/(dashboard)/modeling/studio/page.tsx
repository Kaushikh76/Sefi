'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Database, FileCode2, FilePenLine, Loader2, Plus, RefreshCcw, Save, Sparkles, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  applySchemaPreview,
  approveAiModelDraft,
  createSchemaPreview,
  deleteModelFile,
  generateAiModelDraft,
  getCubeMeta,
  getModelFileContent,
  getModelFiles,
  getModelStorageStatus,
  getSqliteSchema,
  saveModelFile,
  type ModelFileScope,
  type ModelingAiDraftRecord,
  type ModelingApplyResponse,
  type ModelingPreviewResponse,
  type ModelFilesResponse,
  type ModelStorageStatusResponse,
  type SqliteSchemaResponse,
} from '@/lib/sefi-api';

const DEFAULT_NEW_MODEL_PATH = 'generated/cubes/custom_model.yml';
const DEFAULT_MODEL_TEMPLATE = `cubes:\n  - name: gen_custom\n    sql_table: main.contract_logs\n    data_source: default\n\n    joins: []\n\n    dimensions:\n      - name: contract_id\n        sql: contract_id\n        type: string\n\n    measures:\n      - name: count\n        type: count\n`;

export default function ModelStudioPage() {
  const [schema, setSchema] = useState<SqliteSchemaResponse | null>(null);
  const [preview, setPreview] = useState<ModelingPreviewResponse | null>(null);
  const [applyResult, setApplyResult] = useState<ModelingApplyResponse | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const [modelScope, setModelScope] = useState<ModelFileScope>('all');
  const [modelFiles, setModelFiles] = useState<ModelFilesResponse | null>(null);
  const [modelStorage, setModelStorage] = useState<ModelStorageStatusResponse | null>(null);
  const [selectedModelPath, setSelectedModelPath] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState('');
  const [editorOriginal, setEditorOriginal] = useState('');
  const [newModelPath, setNewModelPath] = useState(DEFAULT_NEW_MODEL_PATH);
  const [aiIntent, setAiIntent] = useState('Create a model for contract logs with core dimensions and counts.');
  const [aiConstraints, setAiConstraints] = useState('Prefer concise dimensions and include canonical contract fields.');
  const [aiTargetPath, setAiTargetPath] = useState('generated/cubes/ai_model.yml');
  const [aiDraft, setAiDraft] = useState<ModelingAiDraftRecord | null>(null);
  const [aiCurrentTargetContent, setAiCurrentTargetContent] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [applyLoading, setApplyLoading] = useState(false);
  const [modelFilesLoading, setModelFilesLoading] = useState(true);
  const [modelFileLoading, setModelFileLoading] = useState(false);
  const [modelSaveLoading, setModelSaveLoading] = useState(false);
  const [modelDeleteLoading, setModelDeleteLoading] = useState(false);
  const [aiGenerateLoading, setAiGenerateLoading] = useState(false);
  const [aiApproveLoading, setAiApproveLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cubeRefreshStatus, setCubeRefreshStatus] = useState<string>('');

  const refreshSchema = useCallback(async () => {
    try {
      setError(null);
      const data = await getSqliteSchema();
      setSchema(data);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Failed to load SQLite schema');
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshModelFiles = useCallback(async (scope: ModelFileScope) => {
    try {
      setError(null);
      setModelFilesLoading(true);
      const data = await getModelFiles(scope);
      setModelFiles(data);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Failed to load model files');
    } finally {
      setModelFilesLoading(false);
    }
  }, []);

  const refreshModelStorage = useCallback(async () => {
    try {
      const data = await getModelStorageStatus();
      setModelStorage(data);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Failed to inspect model storage');
    }
  }, []);

  useEffect(() => {
    refreshSchema();
    refreshModelStorage();
  }, [refreshSchema, refreshModelStorage]);

  useEffect(() => {
    refreshModelFiles(modelScope);
  }, [modelScope, refreshModelFiles]);

  useEffect(() => {
    if (!modelFiles) return;

    const hasSelection = selectedModelPath && modelFiles.files.some((file) => file.path === selectedModelPath);
    if (hasSelection) return;

    setSelectedModelPath(modelFiles.files[0]?.path || null);
  }, [modelFiles, selectedModelPath]);

  useEffect(() => {
    if (!selectedModelPath) {
      setEditorContent('');
      setEditorOriginal('');
      return;
    }

    let active = true;

    const loadModelFile = async () => {
      try {
        setError(null);
        setModelFileLoading(true);
        const payload = await getModelFileContent(selectedModelPath);
        if (!active) return;
        setEditorContent(payload.content);
        setEditorOriginal(payload.content);
      } catch (loadError) {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : 'Failed to load selected model file');
      } finally {
        if (active) {
          setModelFileLoading(false);
        }
      }
    };

    loadModelFile();

    return () => {
      active = false;
    };
  }, [selectedModelPath]);

  const hasUnsavedChanges = useMemo(() => {
    return Boolean(selectedModelPath) && editorContent !== editorOriginal;
  }, [editorContent, editorOriginal, selectedModelPath]);

  const selectedPreviewFile = useMemo(() => {
    if (!preview || !selectedFile) return null;
    return preview.files.find((file) => file.file_name === selectedFile) || null;
  }, [preview, selectedFile]);

  const selectedModelMeta = useMemo(() => {
    if (!modelFiles || !selectedModelPath) return null;
    return modelFiles.files.find((file) => file.path === selectedModelPath) || null;
  }, [modelFiles, selectedModelPath]);

  const handlePreview = useCallback(async () => {
    try {
      setPreviewLoading(true);
      setError(null);
      setNotice(null);
      setApplyResult(null);
      const nextPreview = await createSchemaPreview();
      setPreview(nextPreview);
      setSelectedFile(nextPreview.files[0]?.file_name || null);
      setNotice(
        `Preview generated: ${nextPreview.summary.files_new} new, ${nextPreview.summary.files_changed} changed, ${nextPreview.summary.files_removed} removed.`
      );
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : 'Failed to generate schema preview');
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const handleApply = useCallback(async () => {
    if (!preview?.preview_id) return;

    try {
      setApplyLoading(true);
      setError(null);
      setNotice(null);
      const result = await applySchemaPreview(preview.preview_id);
      setApplyResult(result);
      setCubeRefreshStatus('Checking Cube metadata refresh...');

      await Promise.all([refreshModelFiles(modelScope), refreshModelStorage()]);

      try {
        const meta = await getCubeMeta();
        const cubeCount = Array.isArray(meta.cubes) ? meta.cubes.length : 0;
        setCubeRefreshStatus(`Cube metadata available (${cubeCount} cubes detected).`);
        setNotice('Schema applied and Cube metadata refreshed.');
      } catch {
        setCubeRefreshStatus('Schema applied. Cube metadata may need a short delay or a Cube restart.');
        setNotice('Schema applied. Cube metadata refresh may be delayed.');
      }
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : 'Failed to apply schema preview');
    } finally {
      setApplyLoading(false);
    }
  }, [modelScope, preview?.preview_id, refreshModelFiles, refreshModelStorage]);

  const handleSelectModelFile = useCallback(
    (path: string) => {
      if (path === selectedModelPath) return;
      if (hasUnsavedChanges && !window.confirm('You have unsaved edits. Discard changes and switch files?')) return;
      setSelectedModelPath(path);
    },
    [hasUnsavedChanges, selectedModelPath]
  );

  const handleChangeScope = useCallback(
    (scope: ModelFileScope) => {
      if (scope === modelScope) return;
      if (hasUnsavedChanges && !window.confirm('You have unsaved edits. Discard changes and change file scope?')) return;
      setModelScope(scope);
    },
    [hasUnsavedChanges, modelScope]
  );

  const handleSaveModel = useCallback(async () => {
    if (!selectedModelPath) return;

    try {
      setModelSaveLoading(true);
      setError(null);
      setNotice(null);
      await saveModelFile(selectedModelPath, editorContent);
      setEditorOriginal(editorContent);
      await Promise.all([refreshModelFiles(modelScope), refreshModelStorage()]);
      setNotice(`Saved ${selectedModelPath}`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save model file');
    } finally {
      setModelSaveLoading(false);
    }
  }, [editorContent, modelScope, refreshModelFiles, refreshModelStorage, selectedModelPath]);

  const handleCreateModel = useCallback(async () => {
    const targetPath = newModelPath.trim();
    if (!targetPath) {
      setError('Model path is required');
      return;
    }

    const payload = editorContent.trim() ? editorContent : DEFAULT_MODEL_TEMPLATE;

    try {
      setModelSaveLoading(true);
      setError(null);
      setNotice(null);
      await saveModelFile(targetPath, payload);
      await Promise.all([refreshModelFiles(modelScope), refreshModelStorage()]);
      setSelectedModelPath(targetPath);
      setNewModelPath(targetPath);
      setNotice(`Created ${targetPath}`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Failed to create model file');
    } finally {
      setModelSaveLoading(false);
    }
  }, [editorContent, modelScope, newModelPath, refreshModelFiles, refreshModelStorage]);

  const handleDeleteModel = useCallback(async () => {
    if (!selectedModelPath) return;

    const confirmed = window.confirm(`Delete model file \"${selectedModelPath}\"? This cannot be undone.`);
    if (!confirmed) return;

    try {
      setModelDeleteLoading(true);
      setError(null);
      setNotice(null);
      await deleteModelFile(selectedModelPath);
      setEditorContent('');
      setEditorOriginal('');
      await Promise.all([refreshModelFiles(modelScope), refreshModelStorage()]);
      setNotice(`Deleted ${selectedModelPath}`);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete model file');
    } finally {
      setModelDeleteLoading(false);
    }
  }, [modelScope, refreshModelFiles, refreshModelStorage, selectedModelPath]);

  const refreshAiTargetContent = useCallback(async (targetPath: string) => {
    const normalizedPath = targetPath.trim();
    if (!normalizedPath) {
      setAiCurrentTargetContent(null);
      return;
    }

    try {
      const payload = await getModelFileContent(normalizedPath);
      setAiCurrentTargetContent(payload.content);
    } catch {
      setAiCurrentTargetContent(null);
    }
  }, []);

  useEffect(() => {
    const target = aiDraft?.target_path || aiTargetPath;
    refreshAiTargetContent(target).catch(() => {
      // best-effort preview loading
    });
  }, [aiDraft?.target_path, aiTargetPath, refreshAiTargetContent]);

  const handleGenerateAiDraft = useCallback(async () => {
    if (!aiIntent.trim()) {
      setError('AI intent is required');
      return;
    }

    try {
      setAiGenerateLoading(true);
      setError(null);
      setNotice(null);
      const response = await generateAiModelDraft({
        intent: aiIntent,
        constraints: aiConstraints,
        target_path: aiTargetPath,
      });
      setAiDraft(response.draft);
      setAiTargetPath(response.draft.target_path);
      await refreshAiTargetContent(response.draft.target_path);
      setNotice(`AI draft generated (${response.draft.draft_id}). Review and approve to save.`);
    } catch (draftError) {
      setError(draftError instanceof Error ? draftError.message : 'Failed to generate AI model draft');
    } finally {
      setAiGenerateLoading(false);
    }
  }, [aiConstraints, aiIntent, aiTargetPath, refreshAiTargetContent]);

  const handleApproveAiDraft = useCallback(async () => {
    if (!aiDraft) return;

    try {
      setAiApproveLoading(true);
      setError(null);
      setNotice(null);
      const approval = await approveAiModelDraft({
        draft_id: aiDraft.draft_id,
        path: aiTargetPath.trim() || undefined,
      });

      setAiDraft(approval.draft);
      await Promise.all([refreshModelFiles(modelScope), refreshModelStorage()]);

      const approvedPath = approval.save?.path || approval.draft.approved_path || aiTargetPath;
      if (approvedPath) {
        setSelectedModelPath(approvedPath);
        try {
          const updated = await getModelFileContent(approvedPath);
          setEditorContent(updated.content);
          setEditorOriginal(updated.content);
        } catch {
          // editor refresh is best-effort
        }
      }

      if (approval.cube_refresh?.status === 'ok') {
        setCubeRefreshStatus(`Cube metadata available (${approval.cube_refresh.cube_count || 0} cubes detected).`);
      } else if (approval.cube_refresh?.error) {
        setCubeRefreshStatus(`Draft approved. Cube metadata refresh warning: ${approval.cube_refresh.error}`);
      } else {
        setCubeRefreshStatus('Draft approved. Cube metadata may need a short delay.');
      }

      setNotice(approval.already_approved ? 'Draft was already approved.' : 'AI draft approved and saved.');
      await refreshAiTargetContent(approvedPath || '');
    } catch (approvalError) {
      setError(approvalError instanceof Error ? approvalError.message : 'Failed to approve AI model draft');
    } finally {
      setAiApproveLoading(false);
    }
  }, [aiDraft, aiTargetPath, modelScope, refreshAiTargetContent, refreshModelFiles, refreshModelStorage]);

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-white/10 bg-black/30 p-5 backdrop-blur">
        <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Modeling / Studio</p>
        <h1 className="mt-2 text-2xl font-semibold text-zinc-100">SQLite to Cube Model Studio</h1>
        <p className="mt-2 max-w-3xl text-sm text-zinc-400">
          Generate models from SQLite, then edit, save, and delete YAML model files directly with persistent storage visibility.
        </p>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>SQLite Schema Explorer</CardTitle>
            <CardDescription>Tables and columns discovered from SeFi data storage.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => refreshSchema()}>
                <RefreshCcw className="h-4 w-4" /> Refresh Schema
              </Button>
              <Button onClick={() => handlePreview()} disabled={previewLoading || loading}>
                {previewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Generate Preview
              </Button>
              <Button variant="secondary" onClick={() => handleApply()} disabled={!preview || applyLoading}>
                {applyLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCode2 className="h-4 w-4" />} Apply Preview
              </Button>
              {loading ? <Badge variant="secondary">Loading...</Badge> : null}
              {notice ? <Badge variant="success">{notice}</Badge> : null}
              {error ? <Badge variant="warning">{error}</Badge> : null}
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Table</TableHead>
                  <TableHead>Columns</TableHead>
                  <TableHead>Primary Keys</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {schema?.tables?.length ? (
                  schema.tables.map((table) => (
                    <TableRow key={table.name}>
                      <TableCell className="font-mono text-xs text-zinc-200">{table.name}</TableCell>
                      <TableCell className="text-zinc-400">{table.columns.length}</TableCell>
                      <TableCell className="text-zinc-400">
                        {table.columns.filter((column) => column.primary_key).map((column) => column.name).join(', ') || '-'}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={3} className="text-zinc-500">
                      {loading ? 'Loading tables...' : 'No tables found.'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Generation Summary</CardTitle>
            <CardDescription>Latest preview/apply status.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="text-xs uppercase tracking-wide text-zinc-500">Database path</p>
              <p className="mt-1 break-all font-mono text-xs text-zinc-300">{schema?.database_path || '-'}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="text-xs uppercase tracking-wide text-zinc-500">Preview ID</p>
              <p className="mt-1 break-all font-mono text-xs text-zinc-300">{preview?.preview_id || '-'}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="text-xs uppercase tracking-wide text-zinc-500">Apply Result</p>
              <p className="mt-1 text-sm text-zinc-300">
                {applyResult
                  ? `${applyResult.writes_applied} writes, ${applyResult.removals_applied} removals, ${applyResult.unchanged_files} unchanged`
                  : 'No apply yet.'}
              </p>
            </div>
            {cubeRefreshStatus ? (
              <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                <p className="text-xs uppercase tracking-wide text-zinc-500">Cube Metadata</p>
                <p className="mt-1 text-sm text-zinc-300">{cubeRefreshStatus}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>AI Model Generator</CardTitle>
            <CardDescription>Draft-first generation from SeFi schema and Cube metadata context.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2 rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="text-xs uppercase tracking-wide text-zinc-500">Intent</p>
              <textarea
                value={aiIntent}
                onChange={(event) => setAiIntent(event.target.value)}
                rows={4}
                className="w-full rounded-md border border-white/15 bg-black/35 p-2 text-sm text-zinc-200 outline-none focus:border-white/30"
              />
            </div>

            <div className="space-y-2 rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="text-xs uppercase tracking-wide text-zinc-500">Constraints</p>
              <textarea
                value={aiConstraints}
                onChange={(event) => setAiConstraints(event.target.value)}
                rows={3}
                className="w-full rounded-md border border-white/15 bg-black/35 p-2 text-sm text-zinc-200 outline-none focus:border-white/30"
              />
            </div>

            <div className="space-y-2 rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="text-xs uppercase tracking-wide text-zinc-500">Target File</p>
              <input
                value={aiTargetPath}
                onChange={(event) => setAiTargetPath(event.target.value)}
                className="h-10 w-full rounded-md border border-white/15 bg-black/40 px-3 font-mono text-xs text-zinc-200 outline-none focus:border-white/30"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => handleGenerateAiDraft()} disabled={aiGenerateLoading}>
                {aiGenerateLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Generate Draft
              </Button>
              <Button variant="secondary" onClick={() => handleApproveAiDraft()} disabled={!aiDraft || aiApproveLoading}>
                {aiApproveLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Approve & Save
              </Button>
            </div>

            {aiDraft ? (
              <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">Draft: {aiDraft.draft_id}</Badge>
                  <Badge variant={aiDraft.validation.valid ? 'success' : 'warning'}>
                    {aiDraft.validation.valid ? 'Validation passed' : 'Validation failed'}
                  </Badge>
                  <Badge variant="outline">Status: {aiDraft.status}</Badge>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>AI Draft Review</CardTitle>
            <CardDescription>Preview diff and validation before approval.</CardDescription>
          </CardHeader>
          <CardContent>
            {aiDraft ? (
              <div className="space-y-3">
                {aiDraft.validation.errors.length > 0 ? (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-100">
                    {aiDraft.validation.errors.map((entry) => (
                      <p key={entry}>{entry}</p>
                    ))}
                  </div>
                ) : null}

                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                    <p className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Current Target Content</p>
                    <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap font-mono text-xs text-zinc-400">
                      {aiCurrentTargetContent || '// target file does not exist yet'}
                    </pre>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                    <p className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Generated Draft YAML</p>
                    <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap font-mono text-xs text-zinc-200">
                      {aiDraft.generated_yaml}
                    </pre>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex h-44 items-center justify-center rounded-xl border border-dashed border-white/15 bg-black/20">
                <p className="text-sm text-zinc-500">Generate an AI draft to review diff and validation.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Preview Files</CardTitle>
            <CardDescription>New/changed files to be generated under Cube model.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {preview ? (
              <>
                <div className="flex flex-wrap gap-2 pb-1">
                  <Badge variant="success">New: {preview.summary.files_new}</Badge>
                  <Badge variant="warning">Changed: {preview.summary.files_changed}</Badge>
                  <Badge variant="secondary">Unchanged: {preview.summary.files_unchanged}</Badge>
                  <Badge variant="outline">Removed: {preview.summary.files_removed}</Badge>
                </div>
                <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
                  {preview.files.map((file) => (
                    <button
                      key={file.file_name}
                      type="button"
                      onClick={() => setSelectedFile(file.file_name)}
                      className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                        selectedFile === file.file_name
                          ? 'border-white/25 bg-white/10'
                          : 'border-white/10 bg-black/20 hover:border-white/20 hover:bg-black/30'
                      }`}
                    >
                      <p className="font-mono text-xs text-zinc-100">{file.file_name}</p>
                      <p className="mt-1 text-xs text-zinc-500">{file.cube_name}</p>
                      <div className="mt-2">
                        <Badge variant={file.status === 'new' ? 'success' : file.status === 'changed' ? 'warning' : 'outline'}>
                          {file.status}
                        </Badge>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-zinc-500">Generate a preview to inspect file changes.</p>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Preview Diff</CardTitle>
            <CardDescription>Inspect current and generated file contents before applying.</CardDescription>
          </CardHeader>
          <CardContent>
            {selectedPreviewFile ? (
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                  <p className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Current</p>
                  <pre className="max-h-[430px] overflow-auto whitespace-pre-wrap font-mono text-xs text-zinc-400">
                    {selectedPreviewFile.previous_content || '// file does not exist yet'}
                  </pre>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                  <p className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Generated</p>
                  <pre className="max-h-[430px] overflow-auto whitespace-pre-wrap font-mono text-xs text-zinc-200">
                    {selectedPreviewFile.content}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-white/15 bg-black/20">
                <p className="text-sm text-zinc-500">
                  <Database className="mr-2 inline h-4 w-4" />
                  Select a generated file to view diff.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Model Files</CardTitle>
            <CardDescription>Edit and manage Cube model YAML files.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button variant={modelScope === 'all' ? 'secondary' : 'ghost'} size="sm" onClick={() => handleChangeScope('all')}>
                All
              </Button>
              <Button variant={modelScope === 'generated' ? 'secondary' : 'ghost'} size="sm" onClick={() => handleChangeScope('generated')}>
                Generated
              </Button>
              <Button variant={modelScope === 'curated' ? 'secondary' : 'ghost'} size="sm" onClick={() => handleChangeScope('curated')}>
                Curated
              </Button>
              <Button variant="ghost" size="sm" onClick={() => refreshModelFiles(modelScope)}>
                <RefreshCcw className="h-4 w-4" /> Refresh
              </Button>
            </div>

            <div className="space-y-2 rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="text-xs uppercase tracking-wide text-zinc-500">Create Model File</p>
              <input
                value={newModelPath}
                onChange={(event) => setNewModelPath(event.target.value)}
                placeholder="generated/cubes/custom_model.yml"
                className="h-10 w-full rounded-md border border-white/15 bg-black/40 px-3 font-mono text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-white/30"
              />
              <Button size="sm" onClick={() => handleCreateModel()} disabled={modelSaveLoading}>
                {modelSaveLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create / Save As
              </Button>
            </div>

            <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {modelFilesLoading ? (
                <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-zinc-400">Loading model files...</div>
              ) : modelFiles?.files?.length ? (
                modelFiles.files.map((file) => (
                  <button
                    key={file.path}
                    type="button"
                    onClick={() => handleSelectModelFile(file.path)}
                    className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                      selectedModelPath === file.path
                        ? 'border-white/25 bg-white/10'
                        : 'border-white/10 bg-black/20 hover:border-white/20 hover:bg-black/30'
                    }`}
                  >
                    <p className="break-all font-mono text-xs text-zinc-100">{file.path}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <Badge variant={file.scope === 'generated' ? 'success' : 'outline'}>{file.scope}</Badge>
                      <p className="text-xs text-zinc-500">{file.size_bytes} bytes</p>
                    </div>
                  </button>
                ))
              ) : (
                <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-zinc-500">No model files in this scope.</div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Model Text Editor</CardTitle>
            <CardDescription>Directly modify generated or curated YAML models.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{selectedModelPath || 'No file selected'}</Badge>
              {selectedModelMeta ? <Badge variant={selectedModelMeta.scope === 'generated' ? 'success' : 'outline'}>{selectedModelMeta.scope}</Badge> : null}
              {hasUnsavedChanges ? <Badge variant="warning">Unsaved changes</Badge> : <Badge variant="outline">Saved</Badge>}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => handleSaveModel()} disabled={!selectedModelPath || !hasUnsavedChanges || modelSaveLoading || modelFileLoading}>
                {modelSaveLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save File
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => handleDeleteModel()}
                disabled={!selectedModelPath || modelDeleteLoading || modelFileLoading}
              >
                {modelDeleteLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Delete File
              </Button>
            </div>

            {modelFileLoading ? (
              <div className="flex h-[440px] items-center justify-center rounded-lg border border-white/10 bg-black/20 text-zinc-400">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading file...
              </div>
            ) : selectedModelPath ? (
              <textarea
                value={editorContent}
                onChange={(event) => setEditorContent(event.target.value)}
                spellCheck={false}
                className="h-[440px] w-full resize-none rounded-lg border border-white/15 bg-black/35 p-3 font-mono text-xs leading-5 text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-white/30"
              />
            ) : (
              <div className="flex h-[440px] items-center justify-center rounded-lg border border-dashed border-white/15 bg-black/20 text-zinc-500">
                <FilePenLine className="mr-2 h-4 w-4" /> Select a model file to edit.
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Persistence Status</CardTitle>
            <CardDescription>Current model storage health and persistence hints.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button variant="ghost" size="sm" onClick={() => refreshModelStorage()}>
              <RefreshCcw className="h-4 w-4" /> Refresh Persistence Check
            </Button>
            <div className="flex flex-wrap gap-2">
              <Badge variant={modelStorage?.model_root_exists ? 'success' : 'warning'}>
                model root: {modelStorage?.model_root_exists ? 'exists' : 'missing'}
              </Badge>
              <Badge variant={modelStorage?.model_root_writable ? 'success' : 'warning'}>
                writable: {modelStorage?.model_root_writable ? 'yes' : 'no'}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant={modelStorage?.generated_root_exists ? 'success' : 'warning'}>
                generated root: {modelStorage?.generated_root_exists ? 'exists' : 'missing'}
              </Badge>
              <Badge variant={modelStorage?.generated_root_writable ? 'success' : 'warning'}>
                generated writable: {modelStorage?.generated_root_writable ? 'yes' : 'no'}
              </Badge>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="text-xs uppercase tracking-wide text-zinc-500">Model root</p>
              <p className="mt-1 break-all font-mono text-xs text-zinc-300">{modelStorage?.model_root || '-'}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="text-xs uppercase tracking-wide text-zinc-500">Generated root</p>
              <p className="mt-1 break-all font-mono text-xs text-zinc-300">{modelStorage?.generated_root || '-'}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="text-xs uppercase tracking-wide text-zinc-500">Counts</p>
              <p className="mt-1 text-sm text-zinc-300">
                {modelStorage
                  ? `${modelStorage.file_count} total (${modelStorage.generated_file_count} generated / ${modelStorage.curated_file_count} curated)`
                  : '-'}
              </p>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="text-xs uppercase tracking-wide text-zinc-500">Persistence hint</p>
              <p className="mt-1 text-sm text-zinc-300">{modelStorage?.persistence?.hint || '-'}</p>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
