import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardHeader, CardBody } from '../components/common/Card';
import { CopyButton } from '../components/common/CopyButton';
import { truncateHash, formatRelativeTime } from '../lib/utils';
import { api, BackendError } from '../services/api';
import {
  ArtifactMonitor,
  RelayCheck,
  RelayStats,
  VerifiedReleaseItem,
  CreateMonitorInput,
} from '../types/relay';
import {
  Radio,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Clock,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Plus,
  Trash2,
  Play,
  History,
  ExternalLink,
  Search,
  Filter,
  Info,
  Check,
  Power,
  Layers,
  ArrowRight,
  Database,
  Lock,
  Activity,
  AlertOctagon,
} from 'lucide-react';

export const QuorumRelayPage: React.FC = () => {
  // Data state
  const [monitors, setMonitors] = useState<ArtifactMonitor[]>([]);
  const [stats, setStats] = useState<RelayStats | null>(null);
  const [verifiedReleases, setVerifiedReleases] = useState<VerifiedReleaseItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'MATCH' | 'MISMATCH' | 'ERROR' | 'PENDING'>('ALL');

  // Active check in progress
  const [checkingMonitorId, setCheckingMonitorId] = useState<string | null>(null);

  // Modal states
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const [historyMonitor, setHistoryMonitor] = useState<ArtifactMonitor | null>(null);
  const [historyChecks, setHistoryChecks] = useState<RelayCheck[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // Register Form State
  const [registerMode, setRegisterMode] = useState<'verified' | 'manual'>('verified');
  const [formName, setFormName] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formReleaseId, setFormReleaseId] = useState('');
  const [formExpectedHash, setFormExpectedHash] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formInterval, setFormInterval] = useState(3600);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Load all data
  const fetchData = async () => {
    try {
      setIsLoading(true);
      setErrorMessage(null);
      const [fetchedStats, fetchedMonitors, fetchedReleases] = await Promise.all([
        api.getRelayStats(),
        api.getRelayMonitors(),
        api.getEligibleVerifiedReleases(),
      ]);
      setStats(fetchedStats);
      setMonitors(fetchedMonitors);
      setVerifiedReleases(fetchedReleases);

      // Default select first verified release if available
      if (fetchedReleases.length > 0 && !formReleaseId) {
        setFormReleaseId(fetchedReleases[0].release_id);
      }
    } catch (err: any) {
      console.error('Failed to load Quorum Relay data:', err);
      setErrorMessage(err.message || 'Failed to connect to Quorum Relay service.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Filtered monitors
  const filteredMonitors = useMemo(() => {
    return monitors.filter((m) => {
      const matchesSearch =
        m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.artifact_url.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.expected_sha256.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (m.release_name && m.release_name.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesStatus =
        statusFilter === 'ALL' || m.last_result === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [monitors, searchQuery, statusFilter]);

  // Any critical mismatch across all monitors?
  const hasMismatches = useMemo(() => {
    return monitors.some((m) => m.last_result === 'MISMATCH');
  }, [monitors]);

  // Handle immediate check trigger
  const handleCheckNow = async (monitorId: string) => {
    try {
      setCheckingMonitorId(monitorId);
      const checkResult = await api.triggerRelayCheck(monitorId);

      // Update monitor list in place
      setMonitors((prev) =>
        prev.map((m) =>
          m.id === monitorId
            ? {
                ...m,
                last_result: checkResult.result,
                last_observed_sha256: checkResult.observed_sha256,
                last_checked_at: checkResult.checked_at,
                last_error_summary: checkResult.error_summary,
                total_checks_count: m.total_checks_count + 1,
              }
            : m
        )
      );

      // Refresh stats in background
      api.getRelayStats().then(setStats).catch(() => {});
    } catch (err: any) {
      alert(`Check failed: ${err.message || 'Network error'}`);
    } finally {
      setCheckingMonitorId(null);
    }
  };

  // Toggle monitor enabled status
  const handleToggleEnabled = async (monitor: ArtifactMonitor) => {
    try {
      const updated = await api.updateRelayMonitor(monitor.id, {
        enabled: !monitor.enabled,
      });
      setMonitors((prev) =>
        prev.map((m) => (m.id === monitor.id ? { ...m, enabled: updated.enabled } : m))
      );
      api.getRelayStats().then(setStats).catch(() => {});
    } catch (err: any) {
      alert(`Failed to update monitor status: ${err.message}`);
    }
  };

  // Delete monitor
  const handleDeleteMonitor = async (monitorId: string, name: string) => {
    if (!window.confirm(`Are you sure you want to delete monitor "${name}"? Check history will also be removed.`)) {
      return;
    }
    try {
      await api.deleteRelayMonitor(monitorId);
      setMonitors((prev) => prev.filter((m) => m.id !== monitorId));
      api.getRelayStats().then(setStats).catch(() => {});
    } catch (err: any) {
      alert(`Failed to delete monitor: ${err.message}`);
    }
  };

  // Open history view
  const handleOpenHistory = async (monitor: ArtifactMonitor) => {
    setHistoryMonitor(monitor);
    setIsLoadingHistory(true);
    try {
      const checks = await api.getRelayMonitorHistory(monitor.id, 50);
      setHistoryChecks(checks);
    } catch (err: any) {
      console.error('Failed to load check history:', err);
      setHistoryChecks([]);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  // Register form submission
  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!formName.trim()) {
      setFormError('Please provide a monitor name.');
      return;
    }
    if (!formUrl.trim() || !formUrl.startsWith('https://')) {
      setFormError('Artifact URL must be a valid public HTTPS URL (e.g. https://...).');
      return;
    }

    if (registerMode === 'manual') {
      const cleanHash = formExpectedHash.trim().toLowerCase();
      if (!cleanHash || !/^[0-9a-f]{64}$/.test(cleanHash)) {
        setFormError('Manual expected hash must be a 64-character hexadecimal SHA-256 string.');
        return;
      }
    }

    try {
      setIsSubmitting(true);
      const payload: CreateMonitorInput = {
        name: formName.trim(),
        artifact_url: formUrl.trim(),
        description: formDescription.trim() || undefined,
        check_interval_seconds: formInterval,
      };

      if (registerMode === 'verified') {
        payload.release_id = formReleaseId;
      } else {
        payload.expected_sha256 = formExpectedHash.trim().toLowerCase();
      }

      const created = await api.createRelayMonitor(payload);
      setMonitors((prev) => [created, ...prev]);
      setIsRegisterOpen(false);

      // Reset form
      setFormName('');
      setFormUrl('');
      setFormExpectedHash('');
      setFormDescription('');

      // Refresh stats
      api.getRelayStats().then(setStats).catch(() => {});
    } catch (err: any) {
      setFormError(err.message || 'Failed to create artifact monitor.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Demo presets
  const handleLoadDemoPreset = (
    type: 'divergence' | 'matching' | 'fzf-match' | 'fzf-mismatch' | 'fzf-error'
  ) => {
    const selectedRelease = verifiedReleases.length > 0 ? verifiedReleases[0] : null;
    if (type === 'fzf-match') {
      setRegisterMode('manual');
      setFormName('fzf v0.74.4 Linux AMD64 Official Binary Release');
      setFormUrl('https://github.com/junegunn/fzf/releases/download/v0.74.4/fzf-0.74.4-linux_amd64.tar.gz');
      setFormExpectedHash('05e6813a337cc722c3ed07e54a764b75cc5d671e2e60459db0ba696ee5fa7504');
      setFormDescription(
        'Real 2.28 MB compiled release binary for fzf v0.74.4. Expected hash verified against official author-published checksums.txt on GitHub Releases.'
      );
    } else if (type === 'fzf-mismatch') {
      setRegisterMode('manual');
      setFormName('fzf v0.74.4 Binary (Controlled Mismatch Simulation)');
      setFormUrl('https://github.com/junegunn/fzf/releases/download/v0.74.4/fzf-0.74.4-linux_amd64.tar.gz');
      setFormExpectedHash('05e6813a337cc722c3ed07e54a764b75cc5d671e2e60459db0ba696ee5fa7500');
      setFormDescription(
        'Synthetic diverged reference hash (1-byte modification): Demonstrates Quorum Relay alerting on a tampered reference or CDN byte substitution.'
      );
    } else if (type === 'fzf-error') {
      setRegisterMode('manual');
      setFormName('fzf v0.74.4 (Unreachable Artifact URL Test)');
      setFormUrl('https://github.com/junegunn/fzf/releases/download/v0.74.4/fzf-nonexistent-archive-404.tar.gz');
      setFormExpectedHash('05e6813a337cc722c3ed07e54a764b75cc5d671e2e60459db0ba696ee5fa7504');
      setFormDescription(
        'Unreachable mirror test: Demonstrates clean HTTP 404 / network failure reporting as ERROR instead of MISMATCH.'
      );
    } else if (type === 'divergence') {
      setRegisterMode('verified');
      setFormName('Hey v0.1.4 (Divergence Demo: README vs Binary)');
      setFormUrl('https://raw.githubusercontent.com/rakyll/hey/master/README.md');
      setFormDescription(
        'Intentional divergence demo: monitors a documentation file against the compiled binary consensus hash to demonstrate Quorum Relay catching non-matching artifacts.'
      );
      if (selectedRelease) {
        setFormReleaseId(selectedRelease.release_id);
      }
    } else {
      setRegisterMode('manual');
      setFormName('Synthetic Fixture Witness (Matching Reference Demo)');
      setFormUrl('https://raw.githubusercontent.com/rakyll/hey/master/README.md');
      // Real hash of this public raw file for deterministic MATCH testing
      setFormExpectedHash('45224023b4b88d26638a1c4875aab997f5fdae265e985426c8023f3b6b667d18');
      setFormDescription(
        'Synthetic/demo fixture only: demonstrates an identical byte stream matching an unverified manual reference hash.'
      );
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Hero / Principle Header */}
      <div className="relative overflow-hidden rounded-2xl border border-brand-border/70 bg-brand-panel/75 backdrop-blur-md p-6 sm:p-8 shadow-xl">
        <div className="absolute top-0 right-0 -mt-10 -mr-10 h-64 w-64 rounded-full bg-quorum-blue-primary/10 blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2 max-w-3xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-bg-deep/80 border border-brand-border/80 text-xs font-mono text-quorum-blue-light">
              <Radio className="w-3.5 h-3.5 animate-pulse text-quorum-blue-primary" />
              <span>USP 2 · POST-VERIFICATION WITNESS</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
              Quorum Relay
            </h1>
            <p className="text-sm sm:text-base text-brand-muted leading-relaxed">
              <span className="text-white font-medium">“Don't trust the download URL. Trust independent witness verification.”</span>
              <br />
              Quorum Relay independently downloads published software artifacts from public HTTPS endpoints, computes their SHA-256 byte digest, and compares them against trusted builder consensus. It detects post-verification supply chain attacks, CDN cache poisoning, and mirror substitutions before users execute compromised binaries.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => setIsRegisterOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-quorum-blue-primary hover:bg-quorum-blue-primary/90 text-white font-medium text-sm transition-all shadow-lg shadow-quorum-blue-primary/20 hover:scale-[1.02] active:scale-[0.98]"
            >
              <Plus className="w-4 h-4" />
              <span>Register Monitor</span>
            </button>
            <button
              onClick={fetchData}
              disabled={isLoading}
              className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-brand-panel-elevated/75 hover:bg-brand-panel-elevated text-brand-muted hover:text-white border border-brand-border/80 text-sm font-medium transition-all"
              title="Refresh telemetry and monitors"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-quorum-blue-primary' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. Integrity Alert Banner (Shows when any monitor has a MISMATCH) */}
      {hasMismatches && (
        <div className="rounded-xl border border-red-500/80 bg-red-950/60 backdrop-blur-md p-4 sm:p-5 shadow-lg shadow-red-950/30 flex items-start gap-4 animate-pulse">
          <AlertOctagon className="w-6 h-6 text-red-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h3 className="text-sm sm:text-base font-bold text-red-200">
              Integrity Alert: Artifact Diverged From Consensus
            </h3>
            <p className="text-xs sm:text-sm text-red-300/90 leading-relaxed">
              The published artifact at this URL does not match the expected consensus hash. Possible causes include URL misconfiguration, downloading documentation instead of the compiled binary, incomplete mirror deployment, or post-release artifact substitution. Investigate before distributing or executing the artifact.
            </p>
          </div>
        </div>
      )}

      {/* 3. Telemetry Metrics Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
        <Card className="p-4 bg-brand-panel/75 backdrop-blur-md border-brand-border/70">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-brand-muted uppercase tracking-wider">Monitors</span>
            <Layers className="w-4 h-4 text-brand-muted" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-white">{stats ? stats.total_monitors : '—'}</span>
            <span className="text-xs text-brand-muted">({stats ? stats.active_monitors : 0} active)</span>
          </div>
        </Card>

        <Card className="p-4 bg-brand-panel/75 backdrop-blur-md border-brand-border/70">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-emerald-400 uppercase tracking-wider">Matches</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-emerald-400">{stats ? stats.matches_count : '—'}</span>
            <span className="text-xs text-brand-muted">intact</span>
          </div>
        </Card>

        <Card className={`p-4 backdrop-blur-md transition-all ${
          stats && stats.mismatches_count > 0
            ? 'bg-red-950/40 border-red-800/80 shadow-red-950/30'
            : 'bg-brand-panel/75 border-brand-border/70'
        }`}>
          <div className="flex items-center justify-between">
            <span className={`text-xs font-medium uppercase tracking-wider ${stats && stats.mismatches_count > 0 ? 'text-red-400 font-bold' : 'text-brand-muted'}`}>
              Mismatches
            </span>
            <AlertTriangle className={`w-4 h-4 ${stats && stats.mismatches_count > 0 ? 'text-red-400 animate-bounce' : 'text-brand-muted'}`} />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className={`text-2xl font-black ${stats && stats.mismatches_count > 0 ? 'text-red-400' : 'text-white'}`}>
              {stats ? stats.mismatches_count : '—'}
            </span>
            <span className="text-xs text-brand-muted">diverged</span>
          </div>
        </Card>

        <Card className="p-4 bg-brand-panel/75 backdrop-blur-md border-brand-border/70">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-amber-400 uppercase tracking-wider">Fetch Errors</span>
            <XCircle className="w-4 h-4 text-amber-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-amber-400">{stats ? stats.errors_count : '—'}</span>
            <span className="text-xs text-brand-muted">offline</span>
          </div>
        </Card>

        <Card className="p-4 bg-brand-panel/75 backdrop-blur-md border-brand-border/70 col-span-2 sm:col-span-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-brand-muted uppercase tracking-wider">Total Checks</span>
            <Activity className="w-4 h-4 text-quorum-blue-primary" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-white">{stats ? stats.total_checks : '—'}</span>
            <span className="text-xs text-brand-muted">witnessed</span>
          </div>
        </Card>
      </div>

      {/* 4. Controls: Search, Filters & Presets */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-brand-panel/60 backdrop-blur-md p-3 rounded-xl border border-brand-border/70">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-brand-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            placeholder="Search by monitor name, artifact URL, or SHA-256..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-brand-bg-deep/70 border border-brand-border/80 rounded-lg text-sm text-white placeholder-brand-muted focus:outline-none focus:border-quorum-blue-primary/80 transition-colors"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          {(['ALL', 'MATCH', 'MISMATCH', 'ERROR', 'PENDING'] as const).map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all shrink-0 ${
                statusFilter === status
                  ? 'bg-quorum-blue-primary text-white font-semibold shadow-sm'
                  : 'bg-brand-panel-elevated/60 text-brand-muted hover:text-white hover:bg-brand-panel-elevated/90'
              }`}
            >
              {status === 'ALL' && 'All'}
              {status === 'MATCH' && 'Matches'}
              {status === 'MISMATCH' && 'Mismatches'}
              {status === 'ERROR' && 'Errors'}
              {status === 'PENDING' && 'Pending'}
            </button>
          ))}
        </div>
      </div>

      {/* 5. Monitors Grid / List */}
      {isLoading ? (
        <div className="py-16 text-center space-y-3">
          <RefreshCw className="w-8 h-8 text-quorum-blue-primary animate-spin mx-auto" />
          <p className="text-sm text-brand-muted">Loading artifact monitors and witness checks...</p>
        </div>
      ) : filteredMonitors.length === 0 ? (
        <Card className="p-12 text-center bg-brand-panel/75 backdrop-blur-md border-brand-border/70">
          <Radio className="w-12 h-12 text-brand-muted/40 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-white">No Artifact Monitors Found</h3>
          <p className="text-xs sm:text-sm text-brand-muted max-w-md mx-auto mt-1 mb-4">
            {searchQuery || statusFilter !== 'ALL'
              ? 'No monitors matched your current search and filter criteria.'
              : 'Register an independent witness monitor to periodically verify published software artifacts.'}
          </p>
          <button
            onClick={() => setIsRegisterOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-quorum-blue-primary text-white text-sm font-medium hover:bg-quorum-blue-primary/90 transition-all shadow-md"
          >
            <Plus className="w-4 h-4" />
            <span>Register First Monitor</span>
          </button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filteredMonitors.map((monitor) => {
            const isChecking = checkingMonitorId === monitor.id;
            const isMatch = monitor.last_result === 'MATCH';
            const isMismatch = monitor.last_result === 'MISMATCH';
            const isError = monitor.last_result === 'ERROR';
            const isPending = monitor.last_result === 'PENDING';

            return (
              <div
                key={monitor.id}
                className={`relative rounded-xl border p-5 transition-all backdrop-blur-md ${
                  isMismatch
                    ? 'bg-red-950/30 border-red-700/80 shadow-md shadow-red-950/20'
                    : isMatch
                    ? 'bg-brand-panel/75 border-brand-border/70 hover:border-brand-border'
                    : isError
                    ? 'bg-amber-950/20 border-amber-800/60'
                    : 'bg-brand-panel/70 border-brand-border/60'
                }`}
              >
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                  {/* Left: Info & Provenance */}
                  <div className="space-y-2 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <h3 className="text-base sm:text-lg font-bold text-white tracking-tight truncate">
                        {monitor.name}
                      </h3>

                      {/* Status Badge */}
                      {isMatch && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-950/60 border border-emerald-700/80 text-emerald-400">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>MATCH · CONSENSUS INTACT</span>
                        </span>
                      )}
                      {isMismatch && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-red-950/80 border border-red-600 text-red-300 animate-pulse">
                          <ShieldAlert className="w-3.5 h-3.5" />
                          <span>MISMATCH · HASH DIVERGED</span>
                        </span>
                      )}
                      {isError && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-950/60 border border-amber-700/80 text-amber-400">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          <span>FETCH ERROR</span>
                        </span>
                      )}
                      {isPending && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-brand-bg-deep/70 border border-brand-border text-brand-muted">
                          <Clock className="w-3.5 h-3.5" />
                          <span>PENDING INITIAL CHECK</span>
                        </span>
                      )}

                      {/* Provenance Badge */}
                      {monitor.provenance === 'VERIFIED_RELEASE_CONSENSUS' ? (
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono bg-quorum-blue-primary/10 border border-quorum-blue-primary/40 text-quorum-blue-light"
                          title="Expected hash was cryptographically derived from verified builder consensus."
                        >
                          <ShieldCheck className="w-3 h-3 text-quorum-blue-primary" />
                          <span>VERIFIED RELEASE CONSENSUS</span>
                        </span>
                      ) : (
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono bg-amber-950/40 border border-amber-800/50 text-amber-300"
                          title="Manual unverified hash. Does not have builder quorum evidence."
                        >
                          <Info className="w-3 h-3" />
                          <span>MANUAL UNVERIFIED</span>
                        </span>
                      )}

                      {/* Enabled / Disabled badge */}
                      <span className={`text-[11px] font-mono px-2 py-0.5 rounded ${
                        monitor.enabled
                          ? 'bg-emerald-950/30 text-emerald-400/80'
                          : 'bg-zinc-800 text-zinc-400'
                      }`}>
                        {monitor.enabled ? 'ACTIVE' : 'PAUSED'}
                      </span>
                    </div>

                    {monitor.description && (
                      <p className="text-xs sm:text-sm text-brand-muted leading-relaxed">
                        {monitor.description}
                      </p>
                    )}

                    {/* Monitored URL */}
                    <div className="flex items-center gap-2 pt-1">
                      <span className="text-xs font-mono text-brand-muted/80 shrink-0">URL:</span>
                      <a
                        href={monitor.artifact_url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-xs font-mono text-quorum-blue-light hover:underline truncate max-w-xl flex items-center gap-1"
                      >
                        <span className="truncate">{monitor.artifact_url}</span>
                        <ExternalLink className="w-3 h-3 shrink-0" />
                      </a>
                      <CopyButton text={monitor.artifact_url} />
                    </div>

                    {/* Hash Comparison Box */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-2">
                      <div className="p-2.5 rounded-lg bg-brand-bg-deep/80 border border-brand-border/60">
                        <div className="flex items-center justify-between text-[11px] font-mono text-brand-muted mb-1">
                          <span>EXPECTED SHA-256 (CONSENSUS)</span>
                          {monitor.release_name && (
                            <span className="text-brand-muted/70 truncate max-w-[150px]">
                              [{monitor.release_name}]
                            </span>
                          )}
                        </div>
                        <div className="flex items-center justify-between">
                          <code className="text-xs font-mono text-white tracking-wider">
                            {truncateHash(monitor.expected_sha256, 14, 14)}
                          </code>
                          <CopyButton text={monitor.expected_sha256} />
                        </div>
                      </div>

                      <div className={`p-2.5 rounded-lg border ${
                        isMismatch
                          ? 'bg-red-950/40 border-red-700/80 text-red-300'
                          : isMatch
                          ? 'bg-emerald-950/20 border-emerald-800/50 text-emerald-300'
                          : 'bg-brand-bg-deep/80 border-brand-border/60 text-brand-muted'
                      }`}>
                        <div className="flex items-center justify-between text-[11px] font-mono mb-1">
                          <span className={isMismatch ? 'text-red-400 font-bold' : 'text-brand-muted'}>
                            OBSERVED SHA-256 (DOWNLOADED)
                          </span>
                          {monitor.last_checked_at && (
                            <span className="text-[10px] text-brand-muted">
                              {formatRelativeTime(monitor.last_checked_at)}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center justify-between">
                          <code className="text-xs font-mono tracking-wider font-semibold">
                            {monitor.last_observed_sha256
                              ? truncateHash(monitor.last_observed_sha256, 14, 14)
                              : 'Not downloaded yet'}
                          </code>
                          {monitor.last_observed_sha256 && (
                            <CopyButton text={monitor.last_observed_sha256} />
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Error Summary Callout if any */}
                    {isError && monitor.last_error_summary && (
                      <div className="p-2.5 rounded-lg bg-amber-950/30 border border-amber-800/70 text-amber-200 text-xs font-mono flex items-start gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                        <span>{monitor.last_error_summary}</span>
                      </div>
                    )}
                  </div>

                  {/* Right: Actions & Schedule */}
                  <div className="flex flex-row lg:flex-col items-center lg:items-end justify-between lg:justify-start gap-3 border-t lg:border-t-0 pt-3 lg:pt-0 border-brand-border/50 shrink-0">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleCheckNow(monitor.id)}
                        disabled={isChecking}
                        className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                          isChecking
                            ? 'bg-brand-panel-elevated text-brand-muted cursor-not-allowed'
                            : 'bg-quorum-blue-primary hover:bg-quorum-blue-primary/90 text-white shadow-sm hover:scale-[1.02] active:scale-[0.98]'
                        }`}
                        title="Download artifact right now and calculate SHA-256"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin' : ''}`} />
                        <span>{isChecking ? 'Checking...' : 'Check Now'}</span>
                      </button>

                      <button
                        onClick={() => handleOpenHistory(monitor)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-panel-elevated/80 hover:bg-brand-panel-elevated text-brand-muted hover:text-white border border-brand-border/80 transition-all"
                        title="View check history audit trail"
                      >
                        <History className="w-3.5 h-3.5" />
                        <span>History</span>
                      </button>

                      <button
                        onClick={() => handleToggleEnabled(monitor)}
                        className={`p-1.5 rounded-lg text-xs border transition-colors ${
                          monitor.enabled
                            ? 'text-emerald-400 hover:text-emerald-300 border-emerald-800/60 hover:bg-emerald-950/30'
                            : 'text-zinc-400 hover:text-white border-zinc-700 hover:bg-zinc-800'
                        }`}
                        title={monitor.enabled ? 'Pause automatic checking' : 'Resume automatic checking'}
                      >
                        <Power className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={() => handleDeleteMonitor(monitor.id, monitor.name)}
                        className="p-1.5 rounded-lg text-xs text-brand-muted hover:text-red-400 hover:bg-red-950/40 border border-brand-border/60 hover:border-red-800/60 transition-colors"
                        title="Delete monitor"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="text-[11px] font-mono text-brand-muted text-right space-y-0.5">
                      <div>Checks: {monitor.total_checks_count}</div>
                      <div>Interval: {Math.round(monitor.check_interval_seconds / 60)} min</div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 6. Register Monitor Modal */}
      {isRegisterOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md">
          <div className="relative w-full max-w-xl rounded-2xl border border-brand-border/80 bg-brand-panel p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-brand-border/60">
              <div className="flex items-center gap-2.5">
                <Radio className="w-5 h-5 text-quorum-blue-primary" />
                <h2 className="text-lg font-bold text-white">Register Artifact Witness Monitor</h2>
              </div>
              <button
                onClick={() => setIsRegisterOpen(false)}
                className="text-brand-muted hover:text-white p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            {/* Presets / Quick Load */}
            <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-xl bg-brand-bg-deep/70 border border-brand-border/60">
              <span className="text-xs font-mono text-brand-muted shrink-0">Demo Presets:</span>
              <button
                type="button"
                onClick={() => handleLoadDemoPreset('fzf-match')}
                className="px-2.5 py-1 rounded bg-emerald-950/40 hover:bg-emerald-950/80 text-xs font-medium text-emerald-300 hover:text-white border border-emerald-800/60 transition-colors"
                title="Real 2.28 MB compiled release binary for fzf v0.74.4 validated against official author-published checksums.txt"
              >
                fzf v0.74.4 Binary (Real MATCH)
              </button>
              <button
                type="button"
                onClick={() => handleLoadDemoPreset('fzf-mismatch')}
                className="px-2.5 py-1 rounded bg-amber-950/40 hover:bg-amber-950/80 text-xs font-medium text-amber-300 hover:text-white border border-amber-800/60 transition-colors"
                title="Simulates an unauthorized binary substitution or mirror divergence by testing real fzf bytes against a modified expected hash"
              >
                Simulated Divergence (Controlled MISMATCH)
              </button>
              <button
                type="button"
                onClick={() => handleLoadDemoPreset('fzf-error')}
                className="px-2.5 py-1 rounded bg-red-950/40 hover:bg-red-950/80 text-xs font-medium text-red-300 hover:text-white border border-red-800/60 transition-colors"
                title="Demonstrates clean HTTP 404 / network failure reporting as ERROR instead of MISMATCH"
              >
                Unreachable Mirror (ERROR)
              </button>
              <button
                type="button"
                onClick={() => handleLoadDemoPreset('divergence')}
                className="px-2.5 py-1 rounded bg-brand-panel-elevated/80 hover:bg-brand-panel-elevated text-xs font-medium text-brand-muted hover:text-white border border-brand-border/80 transition-colors"
                title="Monitors README.md against the compiled binary consensus hash to demonstrate divergence detection"
              >
                Hey v0.1.4 (README vs Binary)
              </button>
            </div>

            {/* Realistic Monitoring Instructions */}
            <div className="p-3 rounded-xl bg-brand-bg-deep/60 border border-brand-border/60 text-xs text-brand-muted leading-relaxed space-y-1">
              <div className="text-white font-medium flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 text-quorum-blue-primary" />
                <span>Production Monitoring Instructions:</span>
              </div>
              <p>
                To monitor a genuine release binary: select <strong>Verified Release Consensus</strong>, choose an attested release from builder quorum (e.g. <code>hey-linux-amd64</code>), paste the official binary download URL from your mirror or CDN, and click Register. Quorum Relay will independently verify that the downloaded binary bytes match the cryptographic quorum consensus hash.
              </p>
            </div>

            {formError && (
              <div className="p-3 rounded-xl bg-red-950/50 border border-red-800 text-xs text-red-300 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleRegisterSubmit} className="space-y-4">
              {/* Provenance Mode Selector */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-brand-muted uppercase tracking-wider">
                  Provenance Source
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setRegisterMode('verified')}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      registerMode === 'verified'
                        ? 'bg-quorum-blue-primary/10 border-quorum-blue-primary text-white'
                        : 'bg-brand-bg-deep/60 border-brand-border/60 text-brand-muted hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-semibold text-xs text-quorum-blue-light mb-1">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>Verified Release Consensus</span>
                    </div>
                    <p className="text-[11px] text-brand-muted leading-tight">
                      Bound to verified builder quorum hash.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setRegisterMode('manual')}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      registerMode === 'manual'
                        ? 'bg-amber-950/20 border-amber-700/80 text-white'
                        : 'bg-brand-bg-deep/60 border-brand-border/60 text-brand-muted hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-semibold text-xs text-amber-400 mb-1">
                      <Info className="w-3.5 h-3.5" />
                      <span>Manual Reference Hash</span>
                    </div>
                    <p className="text-[11px] text-brand-muted leading-tight">
                      Custom external SHA-256 target.
                    </p>
                  </button>
                </div>
              </div>

              {/* Mode 1: Select Verified Release */}
              {registerMode === 'verified' ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-brand-muted">
                    Target Verified Release
                  </label>
                  {verifiedReleases.length === 0 ? (
                    <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-800/60 text-xs text-amber-300">
                      No releases have achieved builder quorum yet. Verify a release on the <strong>Verify a Release</strong> page first, or switch to <strong>Manual Reference Hash</strong> mode.
                    </div>
                  ) : (
                    <select
                      value={formReleaseId}
                      onChange={(e) => setFormReleaseId(e.target.value)}
                      className="w-full px-3 py-2 bg-brand-bg-deep/90 border border-brand-border rounded-xl text-sm text-white focus:outline-none focus:border-quorum-blue-primary"
                    >
                      {verifiedReleases.map((r) => (
                        <option key={r.release_id} value={r.release_id}>
                          {r.artifact_name} (Consensus: {truncateHash(r.consensus_sha256, 8, 8)})
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              ) : (
                /* Mode 2: Manual SHA-256 Input with Warning */
                <div className="space-y-2">
                  <div className="p-2.5 rounded-lg bg-amber-950/40 border border-amber-800/70 text-amber-200 text-xs flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <span>
                      <strong>Warning:</strong> Manual reference hashes are marked as <code>MANUAL_UNVERIFIED</code> because they were not produced by an attested multi-builder quorum.
                    </span>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-brand-muted">
                      Expected SHA-256 Hash
                    </label>
                    <input
                      type="text"
                      placeholder="64-character hexadecimal SHA-256 hash"
                      value={formExpectedHash}
                      onChange={(e) => setFormExpectedHash(e.target.value)}
                      className="w-full px-3 py-2 bg-brand-bg-deep/90 border border-brand-border rounded-xl text-sm text-white font-mono placeholder-brand-muted focus:outline-none focus:border-quorum-blue-primary"
                    />
                  </div>
                </div>
              )}

              {/* Monitor Name */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-brand-muted">
                  Monitor Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Official Release Binary (CDN Witness)"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full px-3 py-2 bg-brand-bg-deep/90 border border-brand-border rounded-xl text-sm text-white placeholder-brand-muted focus:outline-none focus:border-quorum-blue-primary"
                />
              </div>

              {/* Artifact Download URL (HTTPS only) */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-brand-muted">
                    Artifact Download URL (HTTPS Only)
                  </label>
                  <span className="text-[11px] font-mono text-quorum-blue-light">SSRF Protected</span>
                </div>
                <input
                  type="url"
                  placeholder="https://example.org/downloads/v1.0/binary.tar.gz"
                  value={formUrl}
                  onChange={(e) => setFormUrl(e.target.value)}
                  className="w-full px-3 py-2 bg-brand-bg-deep/90 border border-brand-border rounded-xl text-sm text-white font-mono placeholder-brand-muted focus:outline-none focus:border-quorum-blue-primary"
                />
                <p className="text-[11px] text-brand-muted">
                  Downloads are strictly limited to 50 MB and private/internal IP ranges are blocked.
                </p>
              </div>

              {/* Interval & Description */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-brand-muted">
                    Check Interval
                  </label>
                  <select
                    value={formInterval}
                    onChange={(e) => setFormInterval(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-brand-bg-deep/90 border border-brand-border rounded-xl text-sm text-white focus:outline-none focus:border-quorum-blue-primary"
                  >
                    <option value={300}>Every 5 minutes</option>
                    <option value={900}>Every 15 minutes</option>
                    <option value={3600}>Every 1 hour (Default)</option>
                    <option value={21600}>Every 6 hours</option>
                    <option value={86400}>Every 24 hours</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-brand-muted">
                    Description (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Primary production mirror"
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    className="w-full px-3 py-2 bg-brand-bg-deep/90 border border-brand-border rounded-xl text-sm text-white placeholder-brand-muted focus:outline-none focus:border-quorum-blue-primary"
                  />
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-brand-border/60">
                <button
                  type="button"
                  onClick={() => setIsRegisterOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-brand-muted hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2.5 rounded-xl bg-quorum-blue-primary hover:bg-quorum-blue-primary/90 text-white text-xs font-bold transition-all shadow-md flex items-center gap-2"
                >
                  {isSubmitting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>{isSubmitting ? 'Registering...' : 'Register Monitor'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 7. History Audit Drawer / Modal */}
      {historyMonitor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="relative w-full max-w-3xl rounded-2xl border border-brand-border/80 bg-brand-panel p-6 shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-start justify-between pb-3 border-b border-brand-border/60">
              <div>
                <div className="flex items-center gap-2">
                  <History className="w-5 h-5 text-quorum-blue-primary" />
                  <h2 className="text-lg font-bold text-white">Witness Check History</h2>
                </div>
                <p className="text-xs text-brand-muted mt-0.5 font-mono truncate max-w-md">
                  {historyMonitor.name} · {historyMonitor.artifact_url}
                </p>
              </div>
              <button
                onClick={() => setHistoryMonitor(null)}
                className="text-brand-muted hover:text-white p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            {/* Content List */}
            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
              {isLoadingHistory ? (
                <div className="py-12 text-center text-brand-muted space-y-2">
                  <RefreshCw className="w-6 h-6 animate-spin text-quorum-blue-primary mx-auto" />
                  <p className="text-xs">Loading check history...</p>
                </div>
              ) : historyChecks.length === 0 ? (
                <div className="py-12 text-center text-brand-muted text-xs">
                  No checks have been executed for this monitor yet.
                </div>
              ) : (
                historyChecks.map((check) => {
                  const isMatch = check.result === 'MATCH';
                  const isMismatch = check.result === 'MISMATCH';

                  return (
                    <div
                      key={check.id}
                      className={`p-3.5 rounded-xl border text-xs font-mono space-y-2 transition-all ${
                        isMismatch
                          ? 'bg-red-950/40 border-red-700/80 text-red-200'
                          : isMatch
                          ? 'bg-brand-bg-deep/70 border-brand-border/70 text-brand-muted'
                          : 'bg-amber-950/30 border-amber-800/60 text-amber-200'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {isMatch && (
                            <span className="inline-flex items-center gap-1 font-bold text-emerald-400">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>MATCH</span>
                            </span>
                          )}
                          {isMismatch && (
                            <span className="inline-flex items-center gap-1 font-bold text-red-400 animate-pulse">
                              <ShieldAlert className="w-3.5 h-3.5" />
                              <span>MISMATCH · HASH DIVERGED</span>
                            </span>
                          )}
                          {check.result === 'ERROR' && (
                            <span className="inline-flex items-center gap-1 font-bold text-amber-400">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              <span>ERROR</span>
                            </span>
                          )}
                          <span className="text-brand-muted/70">·</span>
                          <span className="text-white">
                            {check.checked_at.replace('T', ' ')}
                          </span>
                        </div>

                        <div className="flex items-center gap-3 text-brand-muted">
                          {check.bytes_downloaded !== null && (
                            <span>{Math.round(check.bytes_downloaded / 1024)} KB</span>
                          )}
                          {check.response_time_ms && (
                            <span>{check.response_time_ms} ms</span>
                          )}
                          {check.http_status && (
                            <span>HTTP {check.http_status}</span>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                        <div>
                          <div className="text-[10px] text-brand-muted/70">EXPECTED SHA-256</div>
                          <div className="text-white truncate">{check.expected_sha256}</div>
                        </div>
                        <div>
                          <div className={`text-[10px] ${isMismatch ? 'text-red-400 font-bold' : 'text-brand-muted/70'}`}>
                            OBSERVED SHA-256
                          </div>
                          <div className={`truncate ${isMismatch ? 'text-red-300 font-bold' : 'text-white'}`}>
                            {check.observed_sha256 || 'None'}
                          </div>
                        </div>
                      </div>

                      {check.error_summary && (
                        <div className="text-amber-300/90 text-[11px] pt-1 border-t border-brand-border/40">
                          {check.error_summary}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <div className="pt-3 border-t border-brand-border/60 flex justify-end">
              <button
                onClick={() => setHistoryMonitor(null)}
                className="px-4 py-2 rounded-xl bg-brand-panel-elevated text-xs font-semibold text-white hover:bg-brand-panel-elevated/80 transition-colors"
              >
                Close History
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
export default QuorumRelayPage;
