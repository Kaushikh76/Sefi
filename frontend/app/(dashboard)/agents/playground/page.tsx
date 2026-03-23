'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Brain, CheckCircle2, Loader2, Play, ShieldAlert, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  askAgentPlayground,
  executeAgentPlan,
  getAgentPlaygroundContext,
  type AgentAskResponse,
  type AgentExecuteResponse,
  type AgentPlaygroundContextResponse,
} from '@/lib/sefi-api';

function pretty(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function renderExecutionRows(execution: AgentExecuteResponse | null) {
  if (!execution?.result || typeof execution.result !== 'object') {
    return {
      columns: [] as string[],
      rows: [] as Array<Record<string, unknown>>,
    };
  }

  const payload = execution.result as Record<string, unknown>;

  if (Array.isArray(payload.data)) {
    const rows = payload.data as Array<Record<string, unknown>>;
    return {
      columns: rows.length > 0 ? Object.keys(rows[0]) : [],
      rows,
    };
  }

  if (Array.isArray(payload.rows) && Array.isArray(payload.columns)) {
    return {
      columns: payload.columns as string[],
      rows: payload.rows as Array<Record<string, unknown>>,
    };
  }

  return {
    columns: [],
    rows: [],
  };
}

export default function AgentsPage() {
  const [question, setQuestion] = useState('Show total indexed contract logs by contract category for the last 7 days.');
  const [context, setContext] = useState<AgentPlaygroundContextResponse | null>(null);
  const [loadingContext, setLoadingContext] = useState(true);

  const [autoExecute, setAutoExecute] = useState(true);
  const [manualApprove, setManualApprove] = useState(false);
  const [strongModel, setStrongModel] = useState(false);
  const [allowSqlFallback, setAllowSqlFallback] = useState(false);
  const [maxRows, setMaxRows] = useState(200);

  const [asking, setAsking] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [askResult, setAskResult] = useState<AgentAskResponse | null>(null);
  const [execution, setExecution] = useState<AgentExecuteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshContext = useCallback(async () => {
    try {
      setError(null);
      setLoadingContext(true);
      const payload = await getAgentPlaygroundContext();
      setContext(payload);
      setAutoExecute(payload.defaults.auto_execute);
      setAllowSqlFallback(payload.defaults.allow_sql_fallback);
    } catch (contextError) {
      setError(contextError instanceof Error ? contextError.message : 'Failed to load semantic context');
    } finally {
      setLoadingContext(false);
    }
  }, []);

  useEffect(() => {
    refreshContext();
  }, [refreshContext]);

  useEffect(() => {
    if (manualApprove) {
      setAutoExecute(false);
    }
  }, [manualApprove]);

  const normalizedMaxRows = useMemo(() => {
    if (!Number.isFinite(maxRows)) return 200;
    return Math.max(1, Math.min(2000, Math.trunc(maxRows)));
  }, [maxRows]);

  const askAgent = useCallback(async () => {
    try {
      setAsking(true);
      setError(null);
      setNotice(null);
      setExecution(null);

      const result = await askAgentPlayground(question, {
        auto_execute: autoExecute,
        strong_model: strongModel,
        allow_sql_fallback: allowSqlFallback,
        max_rows: normalizedMaxRows,
      });

      setAskResult(result);

      if (result.executed && result.execution) {
        setExecution(result.execution);
        setNotice('Agent plan generated and executed.');
      } else {
        setNotice('Agent plan generated. Review and execute manually if needed.');
      }
    } catch (askError) {
      setError(askError instanceof Error ? askError.message : 'Agent request failed');
    } finally {
      setAsking(false);
    }
  }, [allowSqlFallback, autoExecute, normalizedMaxRows, question, strongModel]);

  const runPlan = useCallback(async () => {
    if (!askResult?.plan) return;

    try {
      setExecuting(true);
      setError(null);
      const result = await executeAgentPlan(askResult.plan, {
        strong_model: strongModel,
        allow_sql_fallback: allowSqlFallback,
        max_rows: normalizedMaxRows,
      });
      setExecution(result);
      setNotice('Execution completed.');
    } catch (executeError) {
      setError(executeError instanceof Error ? executeError.message : 'Execution failed');
    } finally {
      setExecuting(false);
    }
  }, [allowSqlFallback, askResult?.plan, normalizedMaxRows, strongModel]);

  const canExecutePlan = useMemo(() => {
    if (!askResult?.plan) return false;
    if (!askResult.validation.valid) return false;
    return askResult.plan.mode === 'cube_query' || askResult.plan.mode === 'sql_fallback';
  }, [askResult]);

  const renderedRows = useMemo(() => renderExecutionRows(execution), [execution]);

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-white/10 bg-black/30 p-5 backdrop-blur">
        <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">AI Agents / Playground</p>
        <h1 className="mt-2 text-2xl font-semibold text-zinc-100">Semantic Agent Playground</h1>
        <p className="mt-2 max-w-3xl text-sm text-zinc-400">
          Convert natural language into validated semantic queries, inspect plan safety checks, and execute against Cube or read-only SQL fallback.
        </p>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Ask The Agent</CardTitle>
            <CardDescription>Metadata-only context is used to build a strict JSON execution plan.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              rows={4}
              className="w-full rounded-lg border border-white/10 bg-black/25 p-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-white/20 focus:outline-none"
              placeholder="Ask a question about indexed blockchain activity..."
            />

            <div className="grid gap-3 rounded-xl border border-white/10 bg-black/20 p-3 md:grid-cols-2">
              <label className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/30 p-2 text-sm">
                <span className="text-zinc-300">Auto-run valid plans</span>
                <input
                  type="checkbox"
                  checked={autoExecute}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setAutoExecute(checked);
                    if (checked) setManualApprove(false);
                  }}
                />
              </label>

              <label className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/30 p-2 text-sm">
                <span className="text-zinc-300">Manual approval mode</span>
                <input
                  type="checkbox"
                  checked={manualApprove}
                  onChange={(event) => setManualApprove(event.target.checked)}
                />
              </label>

              <label className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/30 p-2 text-sm">
                <span className="text-zinc-300">Strong model</span>
                <input type="checkbox" checked={strongModel} onChange={(event) => setStrongModel(event.target.checked)} />
              </label>

              <label className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/30 p-2 text-sm">
                <span className="text-zinc-300">SQL fallback</span>
                <input
                  type="checkbox"
                  checked={allowSqlFallback}
                  onChange={(event) => setAllowSqlFallback(event.target.checked)}
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs uppercase tracking-wide text-zinc-500" htmlFor="maxRows">
                Max Rows
              </label>
              <input
                id="maxRows"
                type="number"
                value={maxRows}
                min={1}
                max={2000}
                onChange={(event) => setMaxRows(Number(event.target.value || 200))}
                className="h-9 w-28 rounded-md border border-white/10 bg-black/25 px-2 text-sm text-zinc-100"
              />
              <Button onClick={() => askAgent()} disabled={asking || loadingContext || !question.trim()}>
                {asking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Generate Plan
              </Button>
              <Button variant="ghost" onClick={() => refreshContext()} disabled={loadingContext}>
                {loadingContext ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />} Refresh Context
              </Button>
              {error ? <Badge variant="warning">{error}</Badge> : null}
              {notice ? <Badge variant="success">{notice}</Badge> : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Semantic Context</CardTitle>
            <CardDescription>Planner context source and semantic member availability.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="text-xs uppercase tracking-wide text-zinc-500">Source</p>
              <p className="mt-1 text-xl font-semibold text-zinc-100">{context?.metadata_source || 'cube'}</p>
              {context?.metadata_warning ? (
                <p className="mt-2 text-xs text-amber-200">{context.metadata_warning}</p>
              ) : null}
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="text-xs uppercase tracking-wide text-zinc-500">Cubes</p>
              <p className="mt-1 text-xl font-semibold text-zinc-100">{context?.cube_count ?? '-'}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="text-xs uppercase tracking-wide text-zinc-500">Measures</p>
              <p className="mt-1 text-xl font-semibold text-zinc-100">{context?.measure_count ?? '-'}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="text-xs uppercase tracking-wide text-zinc-500">Dimensions</p>
              <p className="mt-1 text-xl font-semibold text-zinc-100">{context?.dimension_count ?? '-'}</p>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Generated Plan</CardTitle>
            <CardDescription>Exact planner output before execution.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!askResult ? (
              <p className="text-sm text-zinc-500">Generate a plan to inspect mode, confidence, and semantic query payload.</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={askResult.validation.valid ? 'success' : 'warning'}>
                    {askResult.validation.valid ? 'Validated' : 'Blocked'}
                  </Badge>
                  <Badge variant="outline">Mode: {askResult.plan.mode}</Badge>
                  <Badge variant="outline">Confidence: {Math.round((askResult.plan.confidence || 0) * 100)}%</Badge>
                  <Badge variant="outline">Model: {askResult.llm.model}</Badge>
                </div>

                <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                  <p className="text-xs uppercase tracking-wide text-zinc-500">Explanation</p>
                  <p className="mt-1 text-sm text-zinc-200">{askResult.plan.explanation || '-'}</p>
                </div>

                {askResult.plan.clarification_question ? (
                  <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                    <p className="text-xs uppercase tracking-wide text-zinc-500">Clarification Question</p>
                    <p className="mt-1 text-sm text-zinc-200">{askResult.plan.clarification_question}</p>
                  </div>
                ) : null}

                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                    <p className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Cube Query JSON</p>
                    <pre className="max-h-72 overflow-auto whitespace-pre-wrap font-mono text-xs text-zinc-300">
                      {askResult.plan.cube_query ? pretty(askResult.plan.cube_query) : '// no cube query generated'}
                    </pre>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                    <p className="mb-2 text-xs uppercase tracking-wide text-zinc-500">SQL Fallback</p>
                    <pre className="max-h-72 overflow-auto whitespace-pre-wrap font-mono text-xs text-zinc-300">
                      {askResult.plan.sql_fallback || '-- no sql fallback generated'}
                    </pre>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Validation</CardTitle>
            <CardDescription>Allowlist and policy checks before execution.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!askResult ? (
              <p className="text-sm text-zinc-500">Validation results appear after plan generation.</p>
            ) : (
              <>
                <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs uppercase tracking-wide text-zinc-500">Status</p>
                    {askResult.validation.valid ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                    ) : (
                      <ShieldAlert className="h-4 w-4 text-amber-300" />
                    )}
                  </div>
                  <p className="mt-1 text-sm text-zinc-200">
                    {askResult.validation.valid ? 'Plan passed semantic guardrails.' : 'Plan blocked by guardrail checks.'}
                  </p>
                </div>

                <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                  <p className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Errors</p>
                  {askResult.validation.errors.length === 0 ? (
                    <p className="text-sm text-zinc-500">No validation errors.</p>
                  ) : (
                    <ul className="space-y-2 text-sm text-amber-200">
                      {askResult.validation.errors.map((item) => (
                        <li key={item}>• {item}</li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                  <p className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Warnings</p>
                  {askResult.validation.warnings.length === 0 ? (
                    <p className="text-sm text-zinc-500">No warnings.</p>
                  ) : (
                    <ul className="space-y-2 text-sm text-zinc-300">
                      {askResult.validation.warnings.map((item) => (
                        <li key={item}>• {item}</li>
                      ))}
                    </ul>
                  )}
                </div>

                <Button
                  onClick={() => runPlan()}
                  disabled={!canExecutePlan || executing || askResult.executed}
                  className="w-full"
                >
                  {executing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Execute Approved Plan
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </section>

      <section>
        <Card>
          <CardHeader>
            <CardTitle>Execution Results</CardTitle>
            <CardDescription>Rendered output from validated Cube or SQL execution.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!execution ? (
              <p className="text-sm text-zinc-500">No execution yet.</p>
            ) : execution.mode === 'clarification' ? (
              <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                <div className="flex items-center gap-2 text-zinc-200">
                  <Bot className="h-4 w-4" />
                  <p className="text-sm">Clarification requested:</p>
                </div>
                <p className="mt-2 text-sm text-zinc-300">{execution.clarification_question || 'Need more detail.'}</p>
              </div>
            ) : (
              <>
                <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                  <p className="text-xs uppercase tracking-wide text-zinc-500">Mode</p>
                  <p className="mt-1 text-sm text-zinc-200">{execution.mode}</p>
                </div>

                <Table>
                  <TableHeader>
                    <TableRow>
                      {renderedRows.columns.length > 0 ? (
                        renderedRows.columns.map((column) => <TableHead key={column}>{column}</TableHead>)
                      ) : (
                        <TableHead>Result</TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {renderedRows.rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={Math.max(renderedRows.columns.length, 1)} className="text-zinc-500">
                          No tabular rows returned.
                        </TableCell>
                      </TableRow>
                    ) : (
                      renderedRows.rows.map((row, rowIndex) => (
                        <TableRow key={`execution-row-${rowIndex}`}>
                          {renderedRows.columns.map((column) => (
                            <TableCell key={`${rowIndex}-${column}`} className="font-mono text-xs text-zinc-300">
                              {String(row[column] ?? '-')}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>

                <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                  <p className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Raw Execution Payload</p>
                  <pre className="max-h-56 overflow-auto whitespace-pre-wrap font-mono text-xs text-zinc-300">
                    {pretty(execution)}
                  </pre>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
