'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BadgeCheck, RefreshCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  formatNumber,
  formatTime,
  getContractsProgress,
  getRecentRecords,
  type ContractProgress,
  type RecordType,
} from '@/lib/sefi-api';
import { useSharedStatus } from '@/lib/status-store';

const RECORD_TYPES: RecordType[] = ['contract_logs', 'hts_transfers', 'topic_messages', 'erc20_transfers'];

export default function ContractsPage() {
  const sharedStatus = useSharedStatus();
  const status = sharedStatus.status;
  const [contracts, setContracts] = useState<ContractProgress[]>([]);
  const [recentType, setRecentType] = useState<RecordType>('contract_logs');
  const [recentRecords, setRecentRecords] = useState<Array<Record<string, unknown>>>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [contractsError, setContractsError] = useState<string | null>(null);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [contractsStale, setContractsStale] = useState(false);
  const [recentStale, setRecentStale] = useState(false);
  const [contractsUpdatedAt, setContractsUpdatedAt] = useState<string | null>(null);
  const [recentUpdatedAt, setRecentUpdatedAt] = useState<string | null>(null);

  const contractsRef = useRef<ContractProgress[]>([]);
  const recentRef = useRef<Array<Record<string, unknown>>>([]);

  useEffect(() => {
    contractsRef.current = contracts;
  }, [contracts]);

  useEffect(() => {
    recentRef.current = recentRecords;
  }, [recentRecords]);

  const refreshAll = useCallback(async () => {
    const now = new Date().toISOString();
    try {
      setError(null);
      const [nextContracts, nextRecent] = await Promise.allSettled([
        getContractsProgress(),
        getRecentRecords(recentType, 20),
      ]);

      const nextErrors: string[] = [];

      if (nextContracts.status === 'fulfilled') {
        setContracts(nextContracts.value.records);
        setContractsError(null);
        setContractsStale(false);
        setContractsUpdatedAt(now);
      } else {
        const message = nextContracts.reason instanceof Error ? nextContracts.reason.message : 'Failed to load contracts';
        setContractsError(message);
        setContractsStale(contractsRef.current.length > 0);
        nextErrors.push(`Contracts: ${message}`);
      }

      if (nextRecent.status === 'fulfilled') {
        setRecentRecords(nextRecent.value.records);
        setRecentError(null);
        setRecentStale(false);
        setRecentUpdatedAt(now);
      } else {
        const message = nextRecent.reason instanceof Error ? nextRecent.reason.message : 'Failed to load recent records';
        setRecentError(message);
        setRecentStale(recentRef.current.length > 0);
        nextErrors.push(`Recent: ${message}`);
      }

      setError(nextErrors.length > 0 ? nextErrors.join(' | ') : null);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Failed to load contracts');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [recentType]);

  const manualRefresh = useCallback(async () => {
    setRefreshing(true);
    setNotice(null);
    await refreshAll();
    setNotice('Contract tables refreshed.');
  }, [refreshAll]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    const timer = setInterval(() => {
      refreshAll().catch(() => {
        // handled by state
      });
    }, 10000);
    return () => clearInterval(timer);
  }, [refreshAll]);

  const filteredContracts = useMemo(() => {
    if (!search.trim()) return contracts;
    const query = search.trim().toLowerCase();
    return contracts.filter((contract) => {
      return (
        contract.contract_id.toLowerCase().includes(query) ||
        contract.name.toLowerCase().includes(query) ||
        String(contract.canonical_name || '').toLowerCase().includes(query) ||
        contract.category.toLowerCase().includes(query)
      );
    });
  }, [contracts, search]);

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-white/10 bg-black/30 p-5 backdrop-blur">
        <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Indexing / Contracts</p>
        <h1 className="mt-2 text-2xl font-semibold text-zinc-100">Contract Index Coverage</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Audit contract-level sync progress, inspect record streams by type, and verify manifest source coverage.
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          Status: {formatTime(sharedStatus.lastUpdatedAt)} | Contracts: {formatTime(contractsUpdatedAt)} | Recent: {formatTime(recentUpdatedAt)}
        </p>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Contracts Progress</CardTitle>
            <CardDescription>Per-contract cursor, indexed count, and source file metadata.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search contract id, name, or category"
                className="h-10 w-full rounded-md border border-white/10 bg-black/25 px-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-white/20 focus:outline-none md:w-96"
              />
              <Button variant="ghost" onClick={() => manualRefresh()} disabled={loading || refreshing}>
                <RefreshCcw className="h-4 w-4" /> Refresh
              </Button>
              {loading || refreshing ? <Badge variant="secondary">Loading...</Badge> : null}
              {notice ? <Badge variant="success">{notice}</Badge> : null}
              {error ? <Badge variant="warning">{error}</Badge> : null}
              {sharedStatus.stale || contractsStale || recentStale ? <Badge variant="outline">Using stale data</Badge> : null}
            </div>
            {sharedStatus.lastError ? <p className="text-xs text-amber-300">Status: {sharedStatus.lastError}</p> : null}
            {contractsError ? <p className="text-xs text-amber-300">Contracts: {contractsError}</p> : null}
            {recentError ? <p className="text-xs text-amber-300">Recent: {recentError}</p> : null}

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contract</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Indexed</TableHead>
                  <TableHead>Last Timestamp</TableHead>
                  <TableHead>Manifest</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredContracts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-zinc-500">
                      No contracts matched your filter.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredContracts.map((contract) => (
                    <TableRow key={contract.contract_id}>
                      <TableCell>
                        <p className="font-semibold text-zinc-100">{contract.name || contract.contract_id}</p>
                        {contract.canonical_name && contract.canonical_name !== contract.name ? (
                          <p className="text-xs text-zinc-400">{contract.canonical_name}</p>
                        ) : null}
                        <p className="font-mono text-xs text-zinc-500">{contract.contract_id}</p>
                        {contract.evm_address ? <p className="font-mono text-xs text-zinc-500">{contract.evm_address}</p> : null}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{contract.category}</Badge>
                      </TableCell>
                      <TableCell className="font-semibold text-zinc-100">{formatNumber(contract.items_synced)}</TableCell>
                      <TableCell className="font-mono text-xs text-zinc-500">{formatTime(contract.last_timestamp)}</TableCell>
                      <TableCell className="text-xs text-zinc-400">{contract.source_file || '-'}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Manifest Sources</CardTitle>
            <CardDescription>Active manifest files currently loaded in memory.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {status?.manifests.loaded?.length ? (
              status.manifests.loaded.map((manifest) => (
                <div key={manifest.fileName} className="rounded-lg border border-white/10 bg-black/20 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-zinc-100">{manifest.fileName}</p>
                    <BadgeCheck className="h-4 w-4 text-emerald-300" />
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">{manifest.protocol || 'Protocol manifest'}</p>
                </div>
              ))
            ) : (
              <p className="text-sm text-zinc-500">No manifest metadata available yet.</p>
            )}
          </CardContent>
        </Card>
      </section>

      <section>
        <Card>
          <CardHeader>
            <CardTitle>Recent Records</CardTitle>
            <CardDescription>Inspect the latest indexed rows by dataset type.</CardDescription>
            <div className="flex flex-wrap gap-2 pt-2">
              {RECORD_TYPES.map((type) => (
                <Button key={type} variant={recentType === type ? 'default' : 'outline'} size="sm" onClick={() => setRecentType(type)}>
                  {type}
                </Button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Primary</TableHead>
                  <TableHead>Secondary</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Timestamp</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentRecords.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-zinc-500">
                      No records yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  recentRecords.map((record, index) => (
                    <TableRow key={`${recentType}-${index}`}>
                      <TableCell className="font-mono text-xs text-zinc-300">
                        {String(record.contract_id || record.token_id || record.topic_id || record.account_id || record.tx_hash || record.tx_id || '-')}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-zinc-500">
                        {String(record.account_id || record.from_account || record.from_address || record.contract_name || record.to_account || '-')}
                      </TableCell>
                      <TableCell>{String(record.amount_signed || record.amount || record.event_name || record.message_utf8 || '-')}</TableCell>
                      <TableCell className="font-mono text-xs text-zinc-500">
                        {formatTime(String(record.consensus_timestamp || record.timestamp || '-'))}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
