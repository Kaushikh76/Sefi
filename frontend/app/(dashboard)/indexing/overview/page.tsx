'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Database, HardDrive, Loader2, Square, Play } from 'lucide-react';
import {
  getOverview,
  getActivity,
  getContractsProgress,
  getRecentRecords,
  triggerIndexerAction,
  type OverviewResponse,
  type ActivityRecord,
  type ContractProgress,
} from '@/lib/sefi-api';
import { useSharedStatus } from '@/lib/status-store';
import { cn } from '@/lib/utils';

/* ── Formatters ─────────────────────────────────────────────── */

function formatCompactNumber(value: number | null | undefined) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) return '0';
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(parsed);
}

function formatMillions(value: number | null | undefined): string {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) return '0';
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(parsed / 1_000_000);
}

function formatLargeNumber(value: number | null | undefined) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) return '0';
  return new Intl.NumberFormat().format(parsed);
}

function formatTimeHHMM(isoString: string) {
  try {
    return new Date(isoString).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  } catch {
    return isoString;
  }
}

function formatTimestamp(ts: string | null | undefined) {
  if (!ts) return '--';
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return ts;
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return ts;
  }
}

/* ── Page Component ─────────────────────────────────────────── */

export default function IndexOverviewPage() {
  const sharedStatus = useSharedStatus();
  const status = sharedStatus.status;
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [activity, setActivity] = useState<ActivityRecord[]>([]);
  const [contracts, setContracts] = useState<ContractProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [recentRecords, setRecentRecords] = useState<Array<Record<string, unknown>>>([]);

  const isRunning = status?.isRunning || false;
  const mode = status?.mode || 'idle';

  const refresh = useCallback(async () => {
    const [overviewResult, activityResult, recentResult] = await Promise.allSettled([
      getOverview(),
      getActivity(15),
      getRecentRecords('contract_logs', 50),
    ]);
    if (overviewResult.status === 'fulfilled') setOverview(overviewResult.value);
    if (activityResult.status === 'fulfilled') setActivity(activityResult.value);
    if (recentResult.status === 'fulfilled') setRecentRecords(recentResult.value?.records ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { const t = setInterval(refresh, 10000); return () => clearInterval(t); }, [refresh]);

  useEffect(() => {
    if (!isRunning) return;
    const fetchContracts = async () => {
      try { const r = await getContractsProgress(); setContracts(r.records); } catch { /* silent */ }
    };
    fetchContracts();
    const t = setInterval(fetchContracts, 5000);
    return () => clearInterval(t);
  }, [isRunning]);

  const handleStartSync = async () => {
    setSyncing(true); setSyncError(null);
    try { const r = await triggerIndexerAction('sync'); if (r.error) setSyncError(r.error); }
    catch (e) { setSyncError(e instanceof Error ? e.message : 'Failed to start sync'); }
    finally { setSyncing(false); }
  };

  const handleStop = async () => {
    setSyncing(true); setSyncError(null);
    try { await triggerIndexerAction('stop'); }
    catch (e) { setSyncError(e instanceof Error ? e.message : 'Failed to stop'); }
    finally { setSyncing(false); }
  };

  const hasData = Boolean(overview || status);
  const totalRecords = overview?.records_indexed || status?.records_indexed || 0;
  const totalLogs = overview?.database.total_contract_logs || status?.database?.total_contract_logs || 0;
  const totalHts = overview?.database.total_hts_transfers || status?.database?.total_hts_transfers || 0;
  const totalErc20 = overview?.database.total_erc20_transfers || status?.database?.total_erc20_transfers || 0;
  const totalTopics = overview?.database.total_topic_messages || status?.database?.total_topic_messages || 0;
  const totalContracts = overview?.database.total_contracts || status?.database?.total_contracts || 0;
  const dbSizeMb = overview?.database.size_mb || status?.database?.size_mb || 0;
  const dbUsagePercent = overview?.database.usage_percent || status?.database?.usage_percent || 0;
  const totalApiCalls = status?.totalApiCalls || 0;
  const manifestTotals = status?.manifests?.totals;
  const phaseProgress = status?.sync?.phase_progress;
  const syncPhase = status?.sync?.phase;

  const syncPercent = useMemo(() => {
    if (phaseProgress && phaseProgress.total > 0) return ((phaseProgress.current / phaseProgress.total) * 100).toFixed(1);
    return null;
  }, [phaseProgress]);

  const sortedContracts = useMemo(() =>
    [...contracts].sort((a, b) => {
      if (!a.updated_at && !b.updated_at) return 0;
      if (!a.updated_at) return 1;
      if (!b.updated_at) return -1;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    }),
  [contracts]);

  const activeEntityName = phaseProgress?.entity_name || null;
  const lastSyncTimestamp = phaseProgress?.last_timestamp || activity[0]?.timestamp || null;

  return (
    <div className="space-y-6">
      {/* ── Action Bar ─────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-[#1c1b1c] p-4 rounded-xl">
        <div className="flex items-center gap-4">
          <div className={cn(
            'px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider',
            mode === 'sync' && 'bg-[#b9f2d1]/20 text-[#b9f2d1]',
            mode === 'listen' && 'bg-[#b9f2d1]/20 text-[#b9f2d1]',
            mode === 'idle' && 'bg-white/10 text-gray-400',
          )}>
            {mode === 'sync' && syncPhase ? `Syncing: ${syncPhase}` : mode}
          </div>
          {syncPhase && phaseProgress && (
            <span className="text-xs text-gray-400">
              {phaseProgress.entity_name && <span className="text-white">{phaseProgress.entity_name}</span>}
              {phaseProgress.total > 0 && <span className="ml-2">{phaseProgress.current}/{phaseProgress.total}</span>}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {syncError && <span className="text-xs text-red-400">{syncError}</span>}
          {isRunning ? (
            <button onClick={handleStop} disabled={syncing}
              className="px-5 py-2 rounded-full bg-red-500/20 text-red-300 text-xs font-bold uppercase tracking-widest flex items-center gap-2 hover:bg-red-500/30 transition-all disabled:opacity-50">
              {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3 w-3" />} Stop
            </button>
          ) : (
            <button onClick={handleStartSync} disabled={syncing}
              className="px-5 py-2 rounded-full bg-[#b6efce] text-[#002113] text-xs font-bold uppercase tracking-widest flex items-center gap-2 hover:shadow-[0_0_15px_rgba(185,242,209,0.3)] transition-all disabled:opacity-50">
              {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Start Full Sync
            </button>
          )}
        </div>
      </div>

      {/* ── ROW 1: Total Indexed Records | DB Gauge | Service Status ── */}
      <div className="grid grid-cols-12 gap-6">
        {/* Total Indexed Records — 5 cols */}
        <div className="col-span-12 lg:col-span-5">
          <div className="bg-[#b6efce] text-[#002113] p-8 rounded-xl flex flex-col justify-between min-h-[200px] h-full">
            <div>
              <div className="flex justify-between items-start">
                <h3 className="text-[11px] uppercase tracking-widest font-bold opacity-80">Total Indexed Records</h3>
                {dbUsagePercent > 0 && (
                  <span className="bg-[#002113]/10 px-2 py-1 rounded text-[10px] font-bold">+{dbUsagePercent.toFixed(1)}% Vol</span>
                )}
              </div>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-6xl font-display font-extrabold tracking-tighter">{hasData ? formatMillions(totalRecords) : '--'}</span>
                {hasData && <span className="text-6xl font-display font-extrabold tracking-tighter opacity-70">M</span>}
              </div>
            </div>
            <div className="flex gap-8 mt-6 overflow-x-auto pb-2">
              {totalLogs > 0 && <div className="flex-shrink-0"><p className="text-[10px] uppercase font-bold opacity-60">Logs</p><p className="text-lg font-display font-bold tracking-tight">{formatCompactNumber(totalLogs)}</p></div>}
              {totalHts > 0 && <div className="flex-shrink-0"><p className="text-[10px] uppercase font-bold opacity-60">HTS</p><p className="text-lg font-display font-bold tracking-tight">{formatCompactNumber(totalHts)}</p></div>}
              {totalErc20 > 0 && <div className="flex-shrink-0"><p className="text-[10px] uppercase font-bold opacity-60">ERC20</p><p className="text-lg font-display font-bold tracking-tight">{formatCompactNumber(totalErc20)}</p></div>}
              {totalTopics > 0 && <div className="flex-shrink-0"><p className="text-[10px] uppercase font-bold opacity-60">Topics</p><p className="text-lg font-display font-bold tracking-tight">{formatCompactNumber(totalTopics)}</p></div>}
            </div>
          </div>
        </div>

        {/* DB Storage Gauge — 3 cols */}
        <div className="col-span-6 lg:col-span-3">
          <DbStorageGauge percent={dbUsagePercent} sizeMb={dbSizeMb} />
        </div>

        {/* Service Status — 4 cols */}
        <div className="col-span-6 lg:col-span-4">
          <ServiceStatusCard
            backend={sharedStatus.backend}
            db={status?.db_status || 'starting'}
            cube={sharedStatus.cube}
            latencyMs={status?.db_last_read_duration_ms}
            dbError={status?.db_last_read_error}
          />
        </div>
      </div>

      {/* ── ROWS 2+3: Hedera EVM + Info Strip | Activity Log (spanning) ── */}
      <div className="grid grid-cols-12 gap-6">
        {/* Left column: Hedera EVM (row2) + Info Strip (row3) */}
        <div className="col-span-12 lg:col-span-9 space-y-6">
          {/* Hedera EVM Event Logs + Sync */}
          <div className="bg-[#1c1b1c] p-8 rounded-xl border border-white/[0.04]">
            <div className="flex items-start justify-between gap-8">
              <div className="flex-1 min-w-0">
                <h3 className="text-[11px] uppercase tracking-widest text-gray-400">Hedera EVM Event Logs</h3>
                <p className="text-sm text-gray-500 mt-1">Total captured from consensus service</p>
                <div className="mt-5 flex items-center gap-3">
                  <span className="text-[clamp(2.5rem,6vw,4.5rem)] font-display font-extrabold text-white tracking-tighter leading-none">
                    {hasData ? formatLargeNumber(totalLogs) : '--'}
                  </span>
                  {isRunning && <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#b9f2d1] animate-pulse flex-shrink-0 mb-1" />}
                </div>
              </div>
              <div className="flex-shrink-0 w-[180px] pt-1">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">Sync Progress</span>
                  <span className="text-sm font-bold text-white">
                    {syncPercent ? `${syncPercent}%` : phaseProgress == null && !isRunning ? '—' : '0%'}
                  </span>
                </div>
                <div className="w-full h-1.5 bg-[#353436] rounded-full overflow-hidden">
                  <div className="h-full bg-[#b9f2d1] rounded-full transition-all duration-700"
                    style={{ width: `${syncPercent ? Math.min(100, parseFloat(syncPercent)) : 0}%` }} />
                </div>
                {phaseProgress && phaseProgress.total > 0 ? (
                  <p className="text-[10px] text-gray-500 mt-2">
                    Head: {formatLargeNumber(phaseProgress.total)} | Current: {formatLargeNumber(phaseProgress.current)}
                  </p>
                ) : (
                  <p className="text-[10px] text-gray-600 mt-2">
                    {isRunning ? `Phase: ${syncPhase || 'starting'}` : mode === 'listen' ? 'Live mode' : 'Not syncing'}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Info Strip — single card with dividers */}
          <div className="bg-[#1c1b1c] rounded-xl border border-white/[0.04] flex flex-wrap divide-x divide-white/[0.04]">
            {[
              { label: 'Last Synced', value: formatTimestamp(lastSyncTimestamp) },
              { label: 'API Calls', value: formatLargeNumber(totalApiCalls) },
              { label: 'Contracts', value: String(totalContracts) },
              ...(manifestTotals && manifestTotals.tokens > 0 ? [{ label: 'Tokens', value: String(manifestTotals.tokens) }] : []),
              ...(manifestTotals && manifestTotals.topics > 0 ? [{ label: 'Topics', value: String(manifestTotals.topics) }] : []),
              { label: 'DB Size', value: `${dbSizeMb} MB` },
              { label: 'Mode', value: mode.toUpperCase(), highlight: mode !== 'idle' },
            ].map((item) => (
              <div key={item.label} className="flex-1 min-w-[100px] px-5 py-3">
                <p className="text-[9px] uppercase tracking-widest text-gray-500 font-bold">{item.label}</p>
                <p className={cn('text-sm font-display font-bold mt-0.5', 'highlight' in item && item.highlight ? 'text-[#b9f2d1]' : 'text-white')}>{item.value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Activity Log — 3 cols, spans both rows */}
        <div className="col-span-12 lg:col-span-3">
          <div className="bg-[#1c1b1c] rounded-xl flex flex-col border border-white/[0.04] overflow-hidden h-full">
            <div className="p-4 border-b border-white/[0.04] flex justify-between items-center">
              <h3 className="text-[11px] uppercase tracking-widest text-gray-400">Activity Log</h3>
              {isRunning && <span className="text-[9px] text-[#b9f2d1] font-bold bg-[#b9f2d1]/10 px-2 py-0.5 rounded">LIVE</span>}
            </div>
            <div className="p-4 space-y-3 font-mono text-[11px] flex-1 overflow-y-auto min-h-[240px] max-h-[400px]">
              {activity.length > 0 ? activity.map((entry) => (
                <div key={entry.id} className="flex gap-3">
                  <span className="text-white/30 flex-shrink-0">{formatTimeHHMM(entry.timestamp)}</span>
                  <span className={cn(
                    'break-words',
                    entry.event_type.includes('error') || entry.event_type.includes('skip') ? 'text-red-400'
                      : entry.event_type.includes('start') || entry.event_type.includes('complete') ? 'text-[#b9f2d1]'
                      : 'text-gray-300'
                  )}>
                    {entry.message || `${entry.event_type}${entry.entity_name ? ` - ${entry.entity_name}` : ''}`}
                  </span>
                </div>
              )) : (
                <div className="flex items-center justify-center h-full text-gray-500 text-xs">
                  {loading ? 'Loading...' : 'No recent activity'}
                </div>
              )}
            </div>
            <Link href="/indexing/runs"
              className="w-full p-3 text-[10px] uppercase font-bold tracking-widest text-gray-400 hover:bg-[#2a2a2b] transition-colors text-center border-t border-white/[0.04] block">
              View Full History
            </Link>
          </div>
        </div>
      </div>

      {/* ── ROW 4: Recent Records — full-width detailed table ── */}
      <div className="bg-[#1c1b1c] rounded-xl border border-white/[0.04] overflow-hidden">
        <div className="p-4 border-b border-white/[0.04] flex justify-between items-center">
          <h3 className="text-[11px] uppercase tracking-widest text-gray-400 flex items-center gap-2">
            <Database className="h-4 w-4 text-[#b9f2d1]" />
            Recent Records
          </h3>
          <span className="text-[10px] text-gray-600">{recentRecords.length} records</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-gray-500 border-b border-white/[0.04]">
                <th className="text-left p-3 pl-4 font-bold">Timestamp</th>
                <th className="text-left p-3 font-bold">Contract</th>
                <th className="text-left p-3 font-bold">Event</th>
                <th className="text-left p-3 font-bold">Tx Hash</th>
                <th className="text-right p-3 font-bold">Block</th>
                <th className="text-right p-3 font-bold">Log Idx</th>
                <th className="text-right p-3 pr-4 font-bold">Indexed At</th>
              </tr>
            </thead>
            <tbody>
              {recentRecords.map((rec, i) => (
                <tr key={i} className="border-b border-white/[0.02] hover:bg-white/[0.02] transition-colors">
                  <td className="p-3 pl-4 text-gray-300 text-xs whitespace-nowrap">
                    {formatTimestamp(rec.timestamp as string)}
                  </td>
                  <td className="p-3">
                    {rec.contract_name ? <span className="text-white font-medium text-xs">{String(rec.contract_name)}</span> : null}
                    <p className="text-[10px] text-gray-500 font-mono mt-0.5">{String(rec.contract_id || '--')}</p>
                  </td>
                  <td className="p-3">
                    <span className={cn(
                      'text-xs px-2 py-0.5 rounded font-medium',
                      rec.event_name ? 'bg-[#b9f2d1]/10 text-[#b9f2d1]' : 'text-gray-500'
                    )}>
                      {String(rec.event_name || '--')}
                    </span>
                  </td>
                  <td className="p-3 text-gray-400 font-mono text-xs">
                    {rec.tx_hash ? `${String(rec.tx_hash).slice(0, 14)}…` : '--'}
                  </td>
                  <td className="p-3 text-right text-white font-mono text-xs">
                    {rec.block_number != null ? formatLargeNumber(rec.block_number as number) : '--'}
                  </td>
                  <td className="p-3 text-right text-gray-400 text-xs">
                    {rec.log_index != null ? String(rec.log_index) : '--'}
                  </td>
                  <td className="p-3 pr-4 text-right text-gray-500 text-xs whitespace-nowrap">
                    {formatTimestamp(rec.indexed_at as string)}
                  </td>
                </tr>
              ))}
              {recentRecords.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-gray-500 text-xs">
                    {loading ? 'Loading records...' : 'No recent records'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Contract Sync Progress (visible when syncing) ── */}
      {(isRunning || contracts.length > 0) && (
        <div className="bg-[#1c1b1c] rounded-xl border border-white/[0.04] overflow-hidden">
          <div className="p-4 border-b border-white/[0.04] flex justify-between items-center">
            <h3 className="text-[11px] uppercase tracking-widest text-gray-400 flex items-center gap-2">
              <Database className="h-4 w-4 text-[#b9f2d1]" />
              Contract Sync Progress
            </h3>
            {isRunning && (
              <span className="text-[9px] text-[#b9f2d1] font-bold bg-[#b9f2d1]/10 px-2 py-0.5 rounded flex items-center gap-1">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#b9f2d1] animate-pulse" /> SYNCING
              </span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-gray-500 border-b border-white/[0.04]">
                  <th className="text-left p-3 pl-4 font-bold">Contract</th>
                  <th className="text-left p-3 font-bold">Category</th>
                  <th className="text-right p-3 font-bold">Items Synced</th>
                  <th className="text-right p-3 pr-4 font-bold">Last Updated</th>
                </tr>
              </thead>
              <tbody>
                {sortedContracts.map((contract) => {
                  const isActive = activeEntityName != null && contract.name === activeEntityName;
                  return (
                    <tr key={contract.contract_id}
                      className={cn('border-b border-white/[0.02] transition-colors', isActive ? 'bg-[#b9f2d1]/10' : 'hover:bg-white/[0.02]')}>
                      <td className="p-3 pl-4">
                        <div className="flex items-center gap-2">
                          {isActive && <span className="inline-block h-2 w-2 rounded-full bg-[#b9f2d1] animate-pulse flex-shrink-0" />}
                          <span className={cn('font-medium', isActive ? 'text-[#b9f2d1]' : 'text-white')}>{contract.name}</span>
                        </div>
                        <p className="text-[10px] text-gray-500 mt-0.5 font-mono">{contract.contract_id}</p>
                      </td>
                      <td className="p-3 text-gray-400">{contract.category || '--'}</td>
                      <td className="p-3 text-right font-mono text-white">{formatLargeNumber(contract.items_synced)}</td>
                      <td className="p-3 pr-4 text-right text-gray-400 text-xs">{formatTimestamp(contract.updated_at)}</td>
                    </tr>
                  );
                })}
                {sortedContracts.length === 0 && (
                  <tr><td colSpan={4} className="p-6 text-center text-gray-500 text-xs">
                    {isRunning ? 'Waiting for contract data...' : 'No contracts synced yet'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Sub-components ─────────────────────────────────────────── */


function DbStorageGauge({ percent, sizeMb }: { percent: number; sizeMb: number }) {
  const clampedPercent = Math.min(100, Math.max(0, percent));
  const color = clampedPercent >= 90 ? '#f87171' : clampedPercent >= 70 ? '#facc15' : '#b9f2d1';
  // SVG semicircle arc
  const radius = 74;
  const stroke = 9;
  const circumference = Math.PI * radius; // half-circle
  const offset = circumference - (clampedPercent / 100) * circumference;
  const sizeGb = (sizeMb / 1024).toFixed(1);

  return (
    <div className="bg-[#1c1b1c] p-8 rounded-xl border border-white/[0.04] h-full flex flex-col items-center">
      <h3 className="text-[11px] uppercase tracking-widest text-gray-400 font-bold mb-4 self-start">Storage</h3>
      <svg width="180" height="100" viewBox="0 0 180 100" className="mb-2">
        {/* Background arc */}
        <path
          d="M 16 90 A 74 74 0 0 1 164 90"
          fill="none"
          stroke="#353436"
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        {/* Value arc */}
        <path
          d="M 16 90 A 74 74 0 0 1 164 90"
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-700"
        />
        {/* Center text */}
        <text x="90" y="78" textAnchor="middle" className="fill-white text-xl font-bold" style={{ fontSize: '26px', fontWeight: 800 }}>
          {clampedPercent.toFixed(1)}%
        </text>
      </svg>
      <p className="text-[10px] text-gray-400">{sizeGb} GB / 10 GB</p>
    </div>
  );
}

function ServiceStatusCard({
  backend, db, cube, latencyMs, dbError,
}: {
  backend: string; db: string; cube: string;
  latencyMs?: number | null; dbError?: string | null;
}) {
  const services = [
    { label: 'Backend', state: backend },
    { label: 'Database', state: db },
    { label: 'Cube', state: cube },
  ];

  return (
    <div className="bg-[#1c1b1c] p-8 rounded-xl border border-white/[0.04] h-full flex flex-col">
      <h3 className="text-[11px] uppercase tracking-widest text-gray-400 font-bold mb-4">Services</h3>
      <div className="flex-1 space-y-3">
        {services.map(({ label, state }) => (
          <div key={label} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={cn(
                'inline-block h-2 w-2 rounded-full',
                state === 'up' && 'bg-[#b9f2d1]',
                state === 'degraded' && 'bg-yellow-400',
                state === 'down' && 'bg-red-400',
                state !== 'up' && state !== 'degraded' && state !== 'down' && 'bg-gray-500',
              )} />
              <span className="text-sm text-white">{label}</span>
            </div>
            <span className={cn(
              'text-xs font-medium',
              state === 'up' ? 'text-[#b9f2d1]' : state === 'degraded' ? 'text-yellow-400' : state === 'down' ? 'text-red-400' : 'text-gray-500'
            )}>
              {state === 'up' ? 'UP' : state === 'degraded' ? 'DEGRADED' : state === 'down' ? 'DOWN' : 'STARTING'}
            </span>
          </div>
        ))}
      </div>
      <div className="border-t border-white/[0.04] pt-3 mt-3 space-y-1.5">
        <div className="flex justify-between text-xs">
          <span className="text-gray-500">DB Latency</span>
          <span className={cn('font-mono', latencyMs != null && latencyMs > 500 ? 'text-yellow-400' : 'text-white')}>
            {latencyMs != null ? `${latencyMs}ms` : '--'}
          </span>
        </div>
        {dbError && (
          <div className="text-[10px] text-red-400 bg-red-500/10 p-2 rounded truncate">{dbError}</div>
        )}
      </div>
    </div>
  );
}
