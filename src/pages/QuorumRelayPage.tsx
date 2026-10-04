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
  GitHubReleaseInfo,
  GitHubReleaseAsset,
  RelayBaselineEvent,
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
  Globe,
  Download,
  FileText,
  FileCode,
  Sparkles,
  BookmarkCheck,
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

  // Baseline Modal State
  const [isBaselineModalOpen, setIsBaselineModalOpen] = useState(false);
  const [baselineTargetMonitor, setBaselineTargetMonitor] = useState<ArtifactMonitor | null>(null);
  const [baselineHashInput, setBaselineHashInput] = useState('');
  const [baselineApproverInput, setBaselineApproverInput] = useState('Security Operator');
  const [baselineNotesInput, setBaselineNotesInput] = useState('');
  const [isSubmittingBaseline, setIsSubmittingBaseline] = useState(false);
  const [baselineModalError, setBaselineModalError] = useState<string | null>(null);

  // History Modal tab state
  const [historyTab, setHistoryTab] = useState<'checks' | 'baselines'>('checks');
  const [baselineEvents, setBaselineEvents] = useState<RelayBaselineEvent[]>([]);

  // Register Form State
  const [registerMode, setRegisterMode] = useState<'verified' | 'github' | 'manual'>('verified');
  const [formName, setFormName] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formReleaseId, setFormReleaseId] = useState('');
  const [formExpectedHash, setFormExpectedHash] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formInterval, setFormInterval] = useState(3600);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Guided GitHub Release Discovery State
  const [githubRepoInput, setGithubRepoInput] = useState('junegunn/fzf');
  const [githubTagInput, setGithubTagInput] = useState('');
  const [isFetchingGitHub, setIsFetchingGitHub] = useState(false);
  const [githubError, setGithubError] = useState<string | null>(null);
  const [githubReleaseInfo, setGithubReleaseInfo] = useState<GitHubReleaseInfo | null>(null);
  const [selectedAssetIndex, setSelectedAssetIndex] = useState<number | null>(null);

  // Hash Provenance Metadata for Display
  const [provenanceMeta, setProvenanceMeta] = useState<{
    sourceType: 'CONSENSUS' | 'MANIFEST' | 'MANUAL';
    title: string;
    details: string;
    verificationStatus: 'VERIFIED' | 'UNVERIFIED';
    warning?: string;
  } | null>(null);

  // Selection Helper: Verified Release Consensus
  const selectVerifiedRelease = (rel: VerifiedReleaseItem) => {
    setFormReleaseId(rel.release_id);
    setFormExpectedHash(rel.consensus_sha256);
    setFormName(`${rel.artifact_name} (Quorum Consensus Witness)`);
    if (!formUrl || formUrl.includes('raw.githubusercontent') || formUrl.includes('fzf')) {
      setFormUrl(`${rel.repository_url}/releases/download/v1.0/${rel.artifact_name}`);
    }
    setFormDescription(
      `Quorum builder consensus verified for ${rel.artifact_name} (Commit: ${rel.source_commit.slice(0, 10)}).`
    );
    setProvenanceMeta({
      sourceType: 'CONSENSUS',
      title: 'Attested Builder Quorum Consensus',
      details: `Cryptographically verified by multi-builder quorum (${rel.threshold || 2}-of-${rel.expected_builders || 3} builders signed).`,
      verificationStatus: 'VERIFIED',
    });
  };

  // Selection Helper: GitHub Asset
  const selectGitHubAsset = (info: GitHubReleaseInfo, assetIndex: number) => {
    const asset = info.assets[assetIndex];
    if (!asset) return;
    setSelectedAssetIndex(assetIndex);
    setFormName(`${info.release_name || info.tag_name} - ${asset.name}`);
    setFormUrl(asset.download_url);

    if (asset.expected_sha256) {
      setFormExpectedHash(asset.expected_sha256);
      setFormDescription(
        `Author release manifest: ${asset.hash_source || info.manifest_name || 'release checksums'} on GitHub.`
      );
      setProvenanceMeta({
        sourceType: 'MANIFEST',
        title: asset.hash_source || `Release Manifest (${info.manifest_name || 'checksums.txt'})`,
        details: `Extracted from author-published checksum manifest '${info.manifest_name || 'checksums.txt'}' on GitHub Releases.`,
        verificationStatus: 'UNVERIFIED',
        warning:
          'This Version Hash was extracted from the maintainer’s release manifest on GitHub. It is NOT an attested multi-builder Quorum consensus. Quorum Relay will monitor that the download URL bitwise matches this maintainer reference.',
      });
    } else {
      setFormExpectedHash('');
      setFormDescription(`Official GitHub release asset (${asset.name}).`);
      setProvenanceMeta({
        sourceType: 'MANUAL',
        title: 'No Checksum Manifest Found',
        details: 'No author-published checksum entry was found for this asset in this release.',
        verificationStatus: 'UNVERIFIED',
        warning:
          'No author checksum manifest was detected for this asset. Please supply a trusted 64-character hexadecimal Version Hash manually.',
      });
    }
  };

  // Action: Query GitHub API and Discover Release Assets + Manifests
  const handleFetchGitHubRelease = async (repoOverride?: string) => {
    const targetRepo = repoOverride || githubRepoInput;
    if (!targetRepo.trim()) {
      setGithubError('Please enter a GitHub repository (e.g. owner/repo or https://github.com/owner/repo).');
      return;
    }
    setIsFetchingGitHub(true);
    setGithubError(null);
    try {
      const info = await api.getGitHubReleaseInfo(targetRepo.trim(), githubTagInput.trim() || undefined);
      setGithubReleaseInfo(info);
      setGithubRepoInput(info.repository);

      const distAssets = info.assets.filter((a) => !a.is_manifest);
      if (distAssets.length > 0) {
        const assetWithHashIndex = info.assets.findIndex((a) => !a.is_manifest && a.expected_sha256);
        const targetIndex = assetWithHashIndex !== -1 ? assetWithHashIndex : info.assets.findIndex((a) => !a.is_manifest);
        selectGitHubAsset(info, targetIndex);
      } else if (info.assets.length > 0) {
        selectGitHubAsset(info, 0);
      } else {
        setSelectedAssetIndex(null);
      }
    } catch (err: any) {
      setGithubError(err.message || 'Failed to fetch release information from GitHub.');
      setGithubReleaseInfo(null);
      setSelectedAssetIndex(null);
    } finally {
      setIsFetchingGitHub(false);
    }
  };

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

      // Default to Verified Release Consensus if verified releases exist
      if (fetchedReleases.length > 0) {
        setRegisterMode('verified');
        selectVerifiedRelease(fetchedReleases[0]);
      } else {
        setRegisterMode('github');
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

  // Any baseline changes detected across all monitors?
  const hasBaselineChanges = useMemo(() => {
    return monitors.some((m) => m.last_baseline_result === 'CHANGED');
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
                last_baseline_result: (checkResult.baseline_result as any) || m.last_baseline_result,
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

  // Open Baseline Management Modal
  const handleOpenBaselineModal = (monitor: ArtifactMonitor, defaultHash?: string) => {
    setBaselineTargetMonitor(monitor);
    setBaselineHashInput(
      defaultHash ||
      monitor.last_observed_sha256 ||
      monitor.trusted_baseline_sha256 ||
      monitor.expected_sha256
    );
    setBaselineApproverInput(monitor.baseline_approved_by || 'Security Operator');
    setBaselineNotesInput('');
    setBaselineModalError(null);
    setIsBaselineModalOpen(true);
  };

  // Save / Approve Baseline
  const handleSaveBaseline = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!baselineTargetMonitor) return;
    const cleanHash = baselineHashInput.trim().toLowerCase();
    if (!cleanHash || !/^[0-9a-f]{64}$/.test(cleanHash)) {
      setBaselineModalError('Trusted baseline hash must be a valid 64-character hexadecimal SHA-256 string.');
      return;
    }
    if (!baselineApproverInput.trim()) {
      setBaselineModalError('Please specify the operator or authority approving this baseline.');
      return;
    }

    setIsSubmittingBaseline(true);
    setBaselineModalError(null);
    try {
      const updated = await api.establishRelayBaseline(baselineTargetMonitor.id, {
        baseline_sha256: cleanHash,
        approved_by: baselineApproverInput.trim(),
        notes: baselineNotesInput.trim() || undefined,
      });

      // Update monitor list
      setMonitors((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
      setIsBaselineModalOpen(false);
      setBaselineTargetMonitor(null);

      // Refresh stats
      api.getRelayStats().then(setStats).catch(() => {});
    } catch (err: any) {
      setBaselineModalError(err.message || 'Failed to establish trusted baseline.');
    } finally {
      setIsSubmittingBaseline(false);
    }
  };

  // Open history view (fetches both check runs and immutable baseline events)
  const handleOpenHistory = async (monitor: ArtifactMonitor) => {
    setHistoryMonitor(monitor);
    setHistoryChecks([]);
    setBaselineEvents([]);
    setHistoryTab('checks');
    setIsLoadingHistory(true);
    try {
      const [checks, bEvents] = await Promise.all([
        api.getRelayMonitorHistory(monitor.id, 50).catch(() => []),
        api.getRelayBaselineHistory(monitor.id).catch(() => []),
      ]);
      setHistoryChecks(checks);
      setBaselineEvents(bEvents);
    } catch (err: any) {
      console.error('Failed to load check history:', err);
      setHistoryChecks([]);
      setBaselineEvents([]);
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

    if (registerMode === 'verified') {
      if (!formReleaseId) {
        setFormError('Please select a verified release that has achieved builder quorum.');
        return;
      }
    } else {
      const cleanHash = formExpectedHash.trim().toLowerCase();
      if (!cleanHash || !/^[0-9a-f]{64}$/.test(cleanHash)) {
        setFormError('Version Hash must be a valid 64-character hexadecimal SHA-256 string.');
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
      setGithubReleaseInfo(null);
      setSelectedAssetIndex(null);

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
      setRegisterMode('github');
      setGithubRepoInput('junegunn/fzf');
      setFormName('fzf v0.74.4 Linux AMD64 Official Binary Release');
      setFormUrl('https://github.com/junegunn/fzf/releases/download/v0.74.4/fzf-0.74.4-linux_amd64.tar.gz');
      setFormExpectedHash('05e6813a337cc722c3ed07e54a764b75cc5d671e2e60459db0ba696ee5fa7504');
      setFormDescription(
        'Real 2.28 MB compiled release binary for fzf v0.74.4. Version Hash verified against official author-published checksums.txt on GitHub Releases.'
      );
      setProvenanceMeta({
        sourceType: 'MANIFEST',
        title: 'Author Release Manifest (fzf_0.74.4_checksums.txt)',
        details: 'Extracted from official maintainer checksums.txt on GitHub Releases.',
        verificationStatus: 'UNVERIFIED',
        warning:
          'This Version Hash was extracted from the maintainer’s release manifest on GitHub. It is NOT an attested multi-builder Quorum consensus.',
      });
    } else if (type === 'fzf-mismatch') {
      setRegisterMode('manual');
      setFormName('fzf v0.74.4 Binary (Controlled Mismatch Simulation)');
      setFormUrl('https://github.com/junegunn/fzf/releases/download/v0.74.4/fzf-0.74.4-linux_amd64.tar.gz');
      setFormExpectedHash('05e6813a337cc722c3ed07e54a764b75cc5d671e2e60459db0ba696ee5fa7500');
      setFormDescription(
        'Synthetic diverged Version Hash (1-byte modification): Demonstrates Quorum Relay alerting on a tampered checksum or CDN byte substitution.'
      );
      setProvenanceMeta({
        sourceType: 'MANUAL',
        title: 'Controlled Divergence Simulation',
        details: 'Synthetic 1-byte divergent Version Hash to verify alert triggers.',
        verificationStatus: 'UNVERIFIED',
        warning: 'Simulated hash divergence for demonstration purposes.',
      });
    } else if (type === 'fzf-error') {
      setRegisterMode('manual');
      setFormName('fzf v0.74.4 (Unreachable Artifact URL Test)');
      setFormUrl('https://github.com/junegunn/fzf/releases/download/v0.74.4/fzf-nonexistent-archive-404.tar.gz');
      setFormExpectedHash('05e6813a337cc722c3ed07e54a764b75cc5d671e2e60459db0ba696ee5fa7504');
      setFormDescription(
        'Unreachable mirror test: Demonstrates clean HTTP 404 / network failure reporting as ERROR instead of MISMATCH.'
      );
      setProvenanceMeta({
        sourceType: 'MANUAL',
        title: 'Unreachable Mirror Test',
        details: 'Simulated 404 missing resource to verify network failure handling.',
        verificationStatus: 'UNVERIFIED',
      });
    } else if (type === 'divergence') {
      setRegisterMode('verified');
      if (selectedRelease) {
        selectVerifiedRelease(selectedRelease);
      }
      setFormName('Hey v0.1.4 (Divergence Demo: README vs Binary)');
      setFormUrl('https://raw.githubusercontent.com/rakyll/hey/master/README.md');
      setFormDescription(
        'Intentional divergence demo: monitors a documentation file against the compiled binary consensus hash to demonstrate Quorum Relay catching non-matching artifacts.'
      );
    } else {
      setRegisterMode('manual');
      setFormName('Synthetic Fixture Witness (Matching Reference Demo)');
      setFormUrl('https://raw.githubusercontent.com/rakyll/hey/master/README.md');
      setFormExpectedHash('45224023b4b88d26638a1c4875aab997f5fdae265e985426c8023f3b6b667d18');
      setFormDescription(
        'Synthetic/demo fixture only: demonstrates an identical byte stream matching an unverified manual reference hash.'
      );
      setProvenanceMeta({
        sourceType: 'MANUAL',
        title: 'Manual Reference Demo',
        details: 'Custom hash of raw documentation text.',
        verificationStatus: 'UNVERIFIED',
      });
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
              Quorum Relay independently downloads published software artifacts from public HTTPS endpoints, computes their Current Hash, and compares them against the expected Version Hash and your approved Trusted Baseline Hash. It detects post-verification supply chain attacks, CDN cache poisoning, and mirror substitutions before users execute compromised binaries.
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

      {/* 1b. Three-Hash Architecture Quick Guide */}
      <div className="rounded-xl border border-brand-border/70 bg-brand-panel/60 backdrop-blur-md p-4 space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-white uppercase tracking-wider">
          <Info className="w-4 h-4 text-quorum-blue-primary" />
          <span>Quorum Relay Three-Hash Architecture & Verification Checks</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="p-3 rounded-lg bg-brand-bg-deep/80 border border-brand-border/60 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white">Version Hash</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-950/60 border border-emerald-800/60 text-emerald-300">
                Check A
              </span>
            </div>
            <p className="text-[11px] text-brand-muted leading-relaxed">
              The expected SHA-256 hash for the selected software release, obtained from its published checksum manifest or a verified internal consensus record.
            </p>
          </div>

          <div className="p-3 rounded-lg bg-brand-bg-deep/80 border border-brand-border/60 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white">Current Hash</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-950/60 border border-cyan-800/60 text-cyan-300">
                Live Witness
              </span>
            </div>
            <p className="text-[11px] text-brand-muted leading-relaxed">
              The SHA-256 hash calculated from the actual bytes downloaded by Quorum Relay during the latest check. Compared independently against both hashes.
            </p>
          </div>

          <div className="p-3 rounded-lg bg-brand-bg-deep/80 border border-brand-border/60 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white">Trusted Baseline Hash</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-950/60 border border-amber-800/60 text-amber-300">
                Check B
              </span>
            </div>
            <p className="text-[11px] text-brand-muted leading-relaxed">
              The previously approved hash saved for comparison with future downloads. Warns on divergence without automatically assuming malicious attacks.
            </p>
          </div>
        </div>
      </div>

      {/* 2. Integrity Alert Banner (Shows when any monitor has a MISMATCH against Version Hash) */}
      {hasMismatches && (
        <div className="rounded-xl border border-red-500/80 bg-red-950/60 backdrop-blur-md p-4 sm:p-5 shadow-lg shadow-red-950/30 flex items-start gap-4 animate-pulse">
          <AlertOctagon className="w-6 h-6 text-red-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h3 className="text-sm sm:text-base font-bold text-red-200">
              Integrity Alert: Current Hash Diverged From Version Hash
            </h3>
            <p className="text-xs sm:text-sm text-red-300/90 leading-relaxed">
              The downloaded artifact's Current Hash does not match the expected Version Hash (from release consensus or maintainer manifest). Possible causes include URL misconfiguration, downloading documentation instead of the compiled binary, incomplete mirror deployment, or post-release artifact substitution. Investigate before distributing or executing the artifact.
            </p>
          </div>
        </div>
      )}

      {/* 2b. Baseline Divergence Alert Banner (Shows when any monitor has diverged from approved Trusted Baseline) */}
      {hasBaselineChanges && (
        <div className="rounded-xl border border-amber-500/80 bg-amber-950/60 backdrop-blur-md p-4 sm:p-5 shadow-lg shadow-amber-950/30 flex items-start gap-4">
          <AlertTriangle className="w-6 h-6 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h3 className="text-sm sm:text-base font-bold text-amber-200">
              Baseline Alert: Current Hash Diverged From Trusted Baseline Hash
            </h3>
            <p className="text-xs sm:text-sm text-amber-300/90 leading-relaxed">
              One or more monitored artifacts have a Current Hash that differs from your established Trusted Baseline Hash. Possible causes include upstream version upgrades, build environment variations, or post-approval modifications. Review the Current Hash and approve an updated baseline if the change is expected.
            </p>
          </div>
        </div>
      )}

      {/* 3. Telemetry Metrics Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
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
            <span className="text-xs font-medium text-emerald-400 uppercase tracking-wider">Version Matches</span>
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

        <Card className={`p-4 backdrop-blur-md transition-all ${
          stats && (stats.baseline_changes_count || 0) > 0
            ? 'bg-amber-950/40 border-amber-700/80 shadow-amber-950/30'
            : 'bg-brand-panel/75 border-brand-border/70'
        }`}>
          <div className="flex items-center justify-between">
            <span className={`text-xs font-medium uppercase tracking-wider ${stats && (stats.baseline_changes_count || 0) > 0 ? 'text-amber-300 font-bold' : 'text-cyan-400'}`}>
              Baselines
            </span>
            <Lock className={`w-4 h-4 ${stats && (stats.baseline_changes_count || 0) > 0 ? 'text-amber-400 animate-pulse' : 'text-cyan-400'}`} />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-white">{stats ? stats.baselines_established_count || 0 : '—'}</span>
            <span className="text-xs text-brand-muted">
              {stats && (stats.baseline_changes_count || 0) > 0
                ? `${stats.baseline_changes_count} diverged`
                : 'active'}
            </span>
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

                      {/* Status Badges */}
                      {isMatch && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-950/60 border border-emerald-700/80 text-emerald-400">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>VERSION MATCH · {monitor.provenance === 'VERIFIED_RELEASE_CONSENSUS' ? 'CONSENSUS INTACT' : 'MANIFEST MATCH'}</span>
                        </span>
                      )}
                      {isMismatch && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-red-950/80 border border-red-600 text-red-300 animate-pulse">
                          <ShieldAlert className="w-3.5 h-3.5" />
                          <span>VERSION MISMATCH · HASH DIVERGED</span>
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

                      {/* Baseline Status Badge */}
                      {!monitor.trusted_baseline_sha256 ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-zinc-800/80 border border-zinc-700/80 text-zinc-300" title="No approved baseline configured">
                          <Lock className="w-3 h-3 text-zinc-400" />
                          <span>Baseline not established</span>
                        </span>
                      ) : monitor.last_baseline_result === 'MATCH' ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-950/70 border border-emerald-600 text-emerald-300">
                          <ShieldCheck className="w-3.5 h-3.5" />
                          <span>BASELINE INTACT</span>
                        </span>
                      ) : monitor.last_baseline_result === 'CHANGED' ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-amber-950/80 border border-amber-600 text-amber-300 animate-pulse">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          <span>BASELINE CHANGED</span>
                        </span>
                      ) : monitor.last_baseline_result === 'ERROR' ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-950/60 border border-amber-700/80 text-amber-400">
                          <span>BASELINE CHECK FAILED</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-brand-bg-deep/70 border border-brand-border text-brand-muted">
                          <span>BASELINE PENDING</span>
                        </span>
                      )}

                      {/* Provenance Badge */}
                      {monitor.provenance === 'VERIFIED_RELEASE_CONSENSUS' ? (
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono bg-quorum-blue-primary/10 border border-quorum-blue-primary/40 text-quorum-blue-light"
                          title="Version Hash was cryptographically derived from verified builder consensus."
                        >
                          <ShieldCheck className="w-3 h-3 text-quorum-blue-primary" />
                          <span>VERIFIED RELEASE CONSENSUS</span>
                        </span>
                      ) : (
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono bg-amber-950/40 border border-amber-800/50 text-amber-300"
                          title="Manual unverified Version Hash. Does not have builder quorum evidence."
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

                    {/* 3-Way Hash Comparison Box: Version Hash, Trusted Baseline Hash, Current Hash */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 pt-2">
                      {/* 1. Version Hash / Expected Release Checksum */}
                      <div className="p-2.5 rounded-lg bg-brand-bg-deep/80 border border-brand-border/60 flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between text-[11px] font-mono text-brand-muted mb-1">
                            <span title="Expected SHA-256 for the selected software release, obtained from its published checksum manifest or a verified internal consensus record">
                              VERSION HASH
                            </span>
                            {monitor.release_name && (
                              <span className="text-brand-muted/70 truncate max-w-[120px]">
                                [{monitor.release_name}]
                              </span>
                            )}
                          </div>
                          <div className="flex items-center justify-between">
                            <code className="text-xs font-mono text-white tracking-wider font-semibold">
                              {truncateHash(monitor.expected_sha256, 9, 9)}
                            </code>
                            <CopyButton text={monitor.expected_sha256} />
                          </div>
                        </div>
                        <div className="text-[10px] text-brand-muted/70 mt-2 truncate">
                          {monitor.provenance === 'VERIFIED_RELEASE_CONSENSUS'
                            ? 'Attested multi-builder quorum'
                            : 'Author maintainer manifest'}
                        </div>
                      </div>

                      {/* 2. Trusted Baseline Hash */}
                      <div className={`p-2.5 rounded-lg border flex flex-col justify-between ${
                        !monitor.trusted_baseline_sha256
                          ? 'bg-brand-bg-deep/60 border-brand-border/50 border-dashed'
                          : monitor.last_baseline_result === 'CHANGED'
                          ? 'bg-amber-950/20 border-amber-700/70'
                          : 'bg-brand-bg-deep/80 border-brand-border/60'
                      }`}>
                        <div>
                          <div className="flex items-center justify-between text-[11px] font-mono mb-1">
                            <span
                              className={monitor.trusted_baseline_sha256 ? 'text-brand-muted' : 'text-zinc-400 font-medium'}
                              title="The previously approved hash saved for comparison with future downloads"
                            >
                              TRUSTED BASELINE HASH
                            </span>
                            <button
                              type="button"
                              onClick={() => handleOpenBaselineModal(monitor)}
                              className="text-[10px] font-sans px-1.5 py-0.5 rounded bg-quorum-blue-primary/10 hover:bg-quorum-blue-primary/20 text-quorum-blue-light border border-quorum-blue-primary/30 transition-colors"
                            >
                              {monitor.trusted_baseline_sha256 ? 'Update' : '+ Establish'}
                            </button>
                          </div>

                          {monitor.trusted_baseline_sha256 ? (
                            <div className="flex items-center justify-between">
                              <code className="text-xs font-mono text-cyan-200 tracking-wider font-semibold">
                                {truncateHash(monitor.trusted_baseline_sha256, 9, 9)}
                              </code>
                              <CopyButton text={monitor.trusted_baseline_sha256} />
                            </div>
                          ) : (
                            <div className="text-xs font-sans text-zinc-400 italic py-0.5">
                              Baseline not established
                            </div>
                          )}
                        </div>

                        <div className="text-[10px] text-brand-muted/70 mt-2 truncate">
                          {monitor.trusted_baseline_sha256 ? (
                            <span>
                              Approved: <strong className="text-brand-muted">{monitor.baseline_approved_by || 'Operator'}</strong>
                              {monitor.previous_baseline_sha256 && ` · Prev: ${truncateHash(monitor.previous_baseline_sha256, 4, 4)}`}
                            </span>
                          ) : (
                            <span className="text-zinc-500">Requires explicit user approval</span>
                          )}
                        </div>
                      </div>

                      {/* 3. Current Hash (Calculated from downloaded bytes) */}
                      <div className={`p-2.5 rounded-lg border flex flex-col justify-between ${
                        isMismatch
                          ? 'bg-red-950/40 border-red-700/80 text-red-300'
                          : isMatch
                          ? 'bg-emerald-950/20 border-emerald-800/50 text-emerald-300'
                          : 'bg-brand-bg-deep/80 border-brand-border/60 text-brand-muted'
                      }`}>
                        <div>
                          <div className="flex items-center justify-between text-[11px] font-mono mb-1">
                            <span
                              className={isMismatch ? 'text-red-400 font-bold' : 'text-brand-muted'}
                              title="The SHA-256 hash calculated from the actual bytes downloaded by Quorum Relay during the latest check"
                            >
                              CURRENT HASH
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
                                ? truncateHash(monitor.last_observed_sha256, 9, 9)
                                : 'Not downloaded yet'}
                            </code>
                            {monitor.last_observed_sha256 && (
                              <CopyButton text={monitor.last_observed_sha256} />
                            )}
                          </div>
                        </div>

                        <div className="text-[10px] font-mono mt-2 pt-1 border-t border-brand-border/30 flex items-center justify-between">
                          <span>
                            vs Version:{' '}
                            <strong className={isMatch ? 'text-emerald-400' : isMismatch ? 'text-red-400 font-bold' : 'text-brand-muted'}>
                              {isMatch ? 'MATCH' : isMismatch ? 'MISMATCH' : 'PENDING'}
                            </strong>
                          </span>
                          <span>
                            vs Baseline:{' '}
                            <strong className={
                              !monitor.trusted_baseline_sha256
                                ? 'text-zinc-400 font-normal'
                                : monitor.last_baseline_result === 'MATCH'
                                ? 'text-emerald-400'
                                : monitor.last_baseline_result === 'CHANGED'
                                ? 'text-amber-400 font-bold'
                                : 'text-brand-muted'
                            }>
                              {!monitor.trusted_baseline_sha256 ? 'NOT SET' : monitor.last_baseline_result === 'MATCH' ? 'INTACT' : monitor.last_baseline_result}
                            </strong>
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Baseline Change Alert Callout (If Current Hash diverged from trusted baseline) */}
                    {monitor.last_baseline_result === 'CHANGED' && monitor.trusted_baseline_sha256 && (
                      <div className="p-3 rounded-lg bg-amber-950/40 border border-amber-600/80 text-amber-200 text-xs font-mono space-y-1.5 mt-2">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 font-bold text-amber-300">
                            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                            <span>Baseline Change Detected</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleOpenBaselineModal(monitor, monitor.last_observed_sha256 || undefined)}
                            className="px-2.5 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/50 text-[11px] font-semibold transition-colors flex items-center gap-1 w-fit"
                          >
                            <Lock className="w-3 h-3" />
                            <span>Review & Approve New Baseline</span>
                          </button>
                        </div>
                        <p className="text-amber-200/90 leading-relaxed font-sans text-xs">
                          The Current Hash has diverged from your approved Trusted Baseline Hash. Possible causes include a legitimate software update, mirror deployment, or rebuild variance. Review both hashes before explicitly approving an updated baseline.
                        </p>
                        <div className="flex flex-wrap items-center gap-4 text-[11px] pt-1 border-t border-amber-800/40">
                          <div>
                            <span className="text-amber-400/70">Trusted Baseline Hash:</span>{' '}
                            <code className="text-white font-mono">{truncateHash(monitor.trusted_baseline_sha256, 12, 12)}</code>
                          </div>
                          <div>
                            <span className="text-amber-400/70">Current Hash:</span>{' '}
                            <code className="text-amber-300 font-bold font-mono">{truncateHash(monitor.last_observed_sha256 || '', 12, 12)}</code>
                          </div>
                        </div>
                      </div>
                    )}

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
                        onClick={() => handleOpenBaselineModal(monitor)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-panel-elevated/80 hover:bg-brand-panel-elevated text-brand-muted hover:text-white border border-brand-border/80 transition-all"
                        title="Establish or update the approved Trusted Baseline"
                      >
                        <Lock className="w-3.5 h-3.5 text-cyan-400" />
                        <span>Baseline</span>
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
                title="Simulates an unauthorized binary substitution or mirror divergence by testing real fzf bytes against a modified Version Hash"
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
                title="Monitors README.md against the compiled binary Version Hash to demonstrate divergence detection"
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
                To monitor a genuine release binary: select <strong>Verified Release Consensus</strong>, choose an attested release from builder quorum (e.g. <code>hey-linux-amd64</code>), paste the official binary download URL from your mirror or CDN, and click Register. Quorum Relay will independently verify that the downloaded binary's Current Hash matches the cryptographic Version Hash.
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
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setRegisterMode('verified');
                      if (verifiedReleases.length > 0) {
                        selectVerifiedRelease(verifiedReleases[0]);
                      }
                    }}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      registerMode === 'verified'
                        ? 'bg-quorum-blue-primary/10 border-quorum-blue-primary text-white shadow-sm ring-1 ring-quorum-blue-primary/30'
                        : 'bg-brand-bg-deep/60 border-brand-border/60 text-brand-muted hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-semibold text-xs text-quorum-blue-light mb-1">
                      <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                      <span>Verified Consensus</span>
                    </div>
                    <p className="text-[11px] text-brand-muted leading-tight">
                      Bound to Quorum multi-builder quorum.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setRegisterMode('github');
                      if (!githubReleaseInfo && !isFetchingGitHub) {
                        handleFetchGitHubRelease('junegunn/fzf');
                      }
                    }}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      registerMode === 'github'
                        ? 'bg-cyan-950/30 border-cyan-500/80 text-white shadow-sm ring-1 ring-cyan-500/30'
                        : 'bg-brand-bg-deep/60 border-brand-border/60 text-brand-muted hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-semibold text-xs text-cyan-300 mb-1">
                      <Globe className="w-3.5 h-3.5 shrink-0" />
                      <span>Public GitHub Release</span>
                    </div>
                    <p className="text-[11px] text-brand-muted leading-tight">
                      Auto-discover assets & author manifests.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setRegisterMode('manual');
                      setProvenanceMeta({
                        sourceType: 'MANUAL',
                        title: 'Manual Version Hash Specification',
                        details: 'User-specified target Version Hash. Not attested by quorum or release manifest.',
                        verificationStatus: 'UNVERIFIED',
                        warning:
                          'Manual Version Hashes are marked as MANUAL_UNVERIFIED because they were not authenticated by multi-builder quorum or an official release manifest.',
                      });
                    }}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      registerMode === 'manual'
                        ? 'bg-amber-950/20 border-amber-700/80 text-white shadow-sm ring-1 ring-amber-700/30'
                        : 'bg-brand-bg-deep/60 border-brand-border/60 text-brand-muted hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-semibold text-xs text-amber-400 mb-1">
                      <FileCode className="w-3.5 h-3.5 shrink-0" />
                      <span>Manual Version Hash</span>
                    </div>
                    <p className="text-[11px] text-brand-muted leading-tight">
                      Direct 64-char hexadecimal hash entry.
                    </p>
                  </button>
                </div>
              </div>

              {/* Mode 1: Select Verified Release */}
              {registerMode === 'verified' && (
                <div className="space-y-3 p-3.5 rounded-xl bg-brand-bg-deep/80 border border-brand-border/70">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-white flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-emerald-400" />
                      <span>Attested Quorum Release</span>
                    </label>
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-emerald-950/60 text-emerald-300 border border-emerald-800/60">
                      VERIFIED_RELEASE_CONSENSUS
                    </span>
                  </div>

                  {verifiedReleases.length === 0 ? (
                    <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-800/60 text-xs text-amber-300 space-y-2">
                      <p>
                        No releases have achieved builder quorum in this environment yet. Verify a release on the <strong>Verify a Release</strong> page first, or use the <strong>Public GitHub Release</strong> workflow.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setRegisterMode('github');
                          handleFetchGitHubRelease('junegunn/fzf');
                        }}
                        className="px-3 py-1.5 rounded-lg bg-cyan-900/60 hover:bg-cyan-800 text-xs font-medium text-cyan-200 transition-colors"
                      >
                        Switch to Public GitHub Release
                      </button>
                    </div>
                  ) : (
                    <>
                      <select
                        value={formReleaseId}
                        onChange={(e) => {
                          const rel = verifiedReleases.find((r) => r.release_id === e.target.value);
                          if (rel) selectVerifiedRelease(rel);
                        }}
                        className="w-full px-3 py-2 bg-brand-panel border border-brand-border rounded-xl text-sm text-white focus:outline-none focus:border-quorum-blue-primary"
                      >
                        {verifiedReleases.map((r) => (
                          <option key={r.release_id} value={r.release_id}>
                            {r.artifact_name} · Commit: {r.source_commit.slice(0, 8)} · Consensus: {truncateHash(r.consensus_sha256, 8, 8)} ({r.attestation_count || r.threshold}-of-{r.expected_builders} builders)
                          </option>
                        ))}
                      </select>

                      {/* Selected release highlight card */}
                      {(() => {
                        const sel = verifiedReleases.find((r) => r.release_id === formReleaseId) || verifiedReleases[0];
                        if (!sel) return null;
                        return (
                          <div className="p-3 rounded-lg bg-emerald-950/20 border border-emerald-800/40 text-xs space-y-1.5">
                            <div className="flex items-center justify-between text-emerald-300 font-semibold">
                              <span>Consensus Anchor: {sel.artifact_name}</span>
                              <span className="font-mono text-[11px] text-emerald-400">
                                {sel.attestation_count || sel.threshold}/{sel.expected_builders} Builders Signed
                              </span>
                            </div>
                            <div className="font-mono text-[11px] text-brand-muted break-all flex items-center justify-between gap-2 bg-black/40 p-2 rounded border border-emerald-900/30">
                              <span>{sel.consensus_sha256}</span>
                              <CopyButton text={sel.consensus_sha256} />
                            </div>
                            <p className="text-[11px] text-emerald-200/80">
                              Repository: {sel.repository_url} @ {sel.source_commit.slice(0, 10)}
                            </p>
                          </div>
                        );
                      })()}
                    </>
                  )}
                </div>
              )}

              {/* Mode 2: Guided Public GitHub Release Discovery */}
              {registerMode === 'github' && (
                <div className="space-y-3 p-3.5 rounded-xl bg-brand-bg-deep/80 border border-brand-border/70">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-white flex items-center gap-1.5">
                      <Globe className="w-4 h-4 text-cyan-400" />
                      <span>Select Release / Fetch Version Hash</span>
                    </label>
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-cyan-950/60 text-cyan-300 border border-cyan-800/60">
                      Guided GitHub Inspection
                    </span>
                  </div>

                  {/* Quick Repo Pills */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-brand-muted font-mono">Popular repos:</span>
                    <button
                      type="button"
                      onClick={() => {
                        setGithubRepoInput('junegunn/fzf');
                        handleFetchGitHubRelease('junegunn/fzf');
                      }}
                      className="px-2 py-0.5 rounded bg-brand-panel hover:bg-brand-panel-elevated text-[11px] text-brand-muted hover:text-white border border-brand-border/60 transition-colors"
                    >
                      junegunn/fzf
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setGithubRepoInput('BurntSushi/ripgrep');
                        handleFetchGitHubRelease('BurntSushi/ripgrep');
                      }}
                      className="px-2 py-0.5 rounded bg-brand-panel hover:bg-brand-panel-elevated text-[11px] text-brand-muted hover:text-white border border-brand-border/60 transition-colors"
                    >
                      BurntSushi/ripgrep
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setGithubRepoInput('cli/cli');
                        handleFetchGitHubRelease('cli/cli');
                      }}
                      className="px-2 py-0.5 rounded bg-brand-panel hover:bg-brand-panel-elevated text-[11px] text-brand-muted hover:text-white border border-brand-border/60 transition-colors"
                    >
                      cli/cli
                    </button>
                  </div>

                  {/* Repo + Tag input and fetch button */}
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                    <div className="sm:col-span-8">
                      <input
                        type="text"
                        placeholder="owner/repo or https://github.com/owner/repo"
                        value={githubRepoInput}
                        onChange={(e) => setGithubRepoInput(e.target.value)}
                        className="w-full px-3 py-2 bg-brand-panel border border-brand-border rounded-xl text-xs text-white font-mono placeholder-brand-muted focus:outline-none focus:border-cyan-500"
                      />
                    </div>
                    <div className="sm:col-span-4 flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleFetchGitHubRelease()}
                        disabled={isFetchingGitHub}
                        className={`w-full px-3 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-sm ${
                          isFetchingGitHub
                            ? 'bg-brand-panel-elevated text-brand-muted cursor-not-allowed'
                            : 'bg-cyan-600 hover:bg-cyan-500 text-white hover:scale-[1.02] active:scale-[0.98]'
                        }`}
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isFetchingGitHub ? 'animate-spin' : ''}`} />
                        <span>{isFetchingGitHub ? 'Fetching...' : 'Fetch Assets'}</span>
                      </button>
                    </div>
                  </div>

                  {/* GitHub Error state */}
                  {githubError && (
                    <div className="p-2.5 rounded-lg bg-red-950/40 border border-red-800 text-xs text-red-300 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                      <div>
                        <span>{githubError}</span>
                        <div className="mt-1 text-[11px] text-red-200/70">
                          Tip: Double-check repository spelling, or switch to <strong>Manual Reference</strong> mode.
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Loading state */}
                  {isFetchingGitHub && (
                    <div className="p-4 rounded-xl bg-black/40 border border-cyan-800/40 text-center space-y-2">
                      <RefreshCw className="w-5 h-5 text-cyan-400 animate-spin mx-auto" />
                      <div className="text-xs text-white font-medium">
                        Inspecting release assets and parsing checksum manifests...
                      </div>
                      <p className="text-[11px] text-brand-muted">
                        All outbound requests use SSRF-safe connection inspection with redirect validation.
                      </p>
                    </div>
                  )}

                  {/* Empty state (before fetch) */}
                  {!githubReleaseInfo && !isFetchingGitHub && !githubError && (
                    <div className="p-3 rounded-lg bg-black/30 border border-brand-border/50 text-xs text-brand-muted space-y-1">
                      <div className="text-white font-medium flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                        <span>Automatic Manifest Discovery</span>
                      </div>
                      <p>
                        Click <strong>Fetch Assets</strong> to discover release binaries and parse official author checksum manifests (e.g. <code>checksums.txt</code>, <code>SHA256SUMS</code>) to auto-populate the exact hash.
                      </p>
                    </div>
                  )}

                  {/* Loaded release info */}
                  {githubReleaseInfo && (
                    <div className="space-y-3 pt-1">
                      {/* Release header pill */}
                      <div className="p-2.5 rounded-lg bg-black/50 border border-cyan-800/40 flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-white">{githubReleaseInfo.release_name}</span>
                          <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-cyan-950/80 text-cyan-300 border border-cyan-800/60">
                            {githubReleaseInfo.tag_name}
                          </span>
                        </div>
                        {githubReleaseInfo.manifest_found ? (
                          <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800/60 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Manifest: {githubReleaseInfo.manifest_name}</span>
                          </span>
                        ) : (
                          <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800/60">
                            No Manifest File
                          </span>
                        )}
                      </div>

                      {/* Asset selector */}
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-brand-muted">
                          Select Release Asset to Monitor
                        </label>
                        {githubReleaseInfo.assets.filter((a) => !a.is_manifest).length === 0 ? (
                          <div className="p-2.5 rounded-lg bg-amber-950/30 border border-amber-800/60 text-xs text-amber-300">
                            No binary assets found in this release. Please enter URL and Version Hash manually.
                          </div>
                        ) : (
                          <select
                            value={selectedAssetIndex ?? 0}
                            onChange={(e) => selectGitHubAsset(githubReleaseInfo, Number(e.target.value))}
                            className="w-full px-3 py-2 bg-brand-panel border border-brand-border rounded-xl text-sm text-white focus:outline-none focus:border-cyan-500 font-mono"
                          >
                            {githubReleaseInfo.assets
                              .map((a, idx) => ({ ...a, originalIndex: idx }))
                              .filter((a) => !a.is_manifest)
                              .map((a) => (
                                <option key={a.name} value={a.originalIndex}>
                                  {a.name} ({Math.round(a.size_bytes / 1024)} KB) {a.expected_sha256 ? '· [Checksum Available]' : '· [No Checksum]'}
                                </option>
                              ))}
                          </select>
                        )}
                      </div>

                      {/* Hash extraction outcome */}
                      {selectedAssetIndex !== null && githubReleaseInfo.assets[selectedAssetIndex] && (
                        <div>
                          {githubReleaseInfo.assets[selectedAssetIndex].expected_sha256 ? (
                            <div className="p-3 rounded-lg bg-emerald-950/20 border border-emerald-800/40 text-xs space-y-1.5">
                              <div className="flex items-center justify-between text-emerald-300 font-semibold">
                                <span className="flex items-center gap-1.5">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                                  <span>Version Hash (Auto-Populated from Maintainer Manifest)</span>
                                </span>
                                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800/50">
                                  MANUAL_UNVERIFIED · Author Reference
                                </span>
                              </div>
                              <div className="font-mono text-[11px] text-white break-all flex items-center justify-between gap-2 bg-black/40 p-2 rounded border border-emerald-900/30">
                                <span>{githubReleaseInfo.assets[selectedAssetIndex].expected_sha256}</span>
                                <CopyButton text={githubReleaseInfo.assets[selectedAssetIndex].expected_sha256!} />
                              </div>
                              <p className="text-[11px] text-brand-muted leading-relaxed">
                                {provenanceMeta?.warning ||
                                  'Extracted from author release manifest on GitHub. Note: While published by the maintainer, it is not an attested multi-builder Quorum consensus.'}
                              </p>
                            </div>
                          ) : (
                            <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-800/60 text-xs space-y-2">
                              <div className="flex items-start gap-2 text-amber-300 font-medium">
                                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                                <span>
                                  No author checksum was published for <code>{githubReleaseInfo.assets[selectedAssetIndex].name}</code> in this release.
                                </span>
                              </div>
                              <p className="text-[11px] text-brand-muted">
                                Please supply the Version Hash manually below.
                              </p>
                              <div>
                                <label className="text-[11px] font-medium text-brand-muted">
                                  Version Hash (Expected SHA-256)
                                </label>
                                <input
                                  type="text"
                                  placeholder="64-character hexadecimal SHA-256 hash"
                                  value={formExpectedHash}
                                  onChange={(e) => setFormExpectedHash(e.target.value)}
                                  className="w-full px-3 py-2 bg-brand-panel border border-brand-border rounded-xl text-xs text-white font-mono placeholder-brand-muted focus:outline-none focus:border-amber-500"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Mode 3: Manual SHA-256 Input */}
              {registerMode === 'manual' && (
                <div className="space-y-2 p-3.5 rounded-xl bg-brand-bg-deep/80 border border-brand-border/70">
                  <div className="p-2.5 rounded-lg bg-amber-950/40 border border-amber-800/70 text-amber-200 text-xs flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <span>
                      <strong>Warning:</strong> Manual Version Hashes are marked as <code>MANUAL_UNVERIFIED</code> because they were not produced by an attested multi-builder quorum or an official release manifest.
                    </span>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-brand-muted">
                      Version Hash (Expected SHA-256)
                    </label>
                    <input
                      type="text"
                      placeholder="64-character hexadecimal SHA-256 hash"
                      value={formExpectedHash}
                      onChange={(e) => setFormExpectedHash(e.target.value)}
                      className="w-full px-3 py-2 bg-brand-panel border border-brand-border rounded-xl text-sm text-white font-mono placeholder-brand-muted focus:outline-none focus:border-quorum-blue-primary"
                    />
                  </div>
                </div>
              )}

              {/* Expected Hash Summary Badge */}
              {formExpectedHash && (
                <div className="p-2.5 rounded-xl bg-brand-bg-deep/90 border border-brand-border/80 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-brand-muted">Active Version Hash:</span>
                    <span className="font-mono text-white text-[11px]">{truncateHash(formExpectedHash, 10, 10)}</span>
                  </div>
                  <span
                    className={`font-mono text-[10px] px-2 py-0.5 rounded border ${
                      registerMode === 'verified'
                        ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800/60'
                        : 'bg-amber-950/80 text-amber-300 border-amber-800/60'
                    }`}
                  >
                    {registerMode === 'verified' ? 'VERIFIED_RELEASE_CONSENSUS' : 'MANUAL_UNVERIFIED'}
                  </span>
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

      {/* 6b. Establish / Update Trusted Baseline Modal */}
      {isBaselineModalOpen && baselineTargetMonitor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="relative w-full max-w-xl rounded-2xl border border-brand-border/80 bg-brand-panel p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-brand-border/60">
              <div className="flex items-center gap-2.5">
                <Lock className="w-5 h-5 text-cyan-400" />
                <h2 className="text-lg font-bold text-white">
                  {baselineTargetMonitor.trusted_baseline_sha256 ? 'Update Trusted Baseline' : 'Establish Trusted Baseline'}
                </h2>
              </div>
              <button
                onClick={() => {
                  setIsBaselineModalOpen(false);
                  setBaselineTargetMonitor(null);
                }}
                className="text-brand-muted hover:text-white p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            {/* Target artifact info */}
            <div className="p-3.5 rounded-xl bg-brand-bg-deep/70 border border-brand-border/70 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-brand-muted">Target Monitor:</span>
                <span className="text-white font-semibold truncate max-w-xs">{baselineTargetMonitor.name}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-brand-muted">Monitored URL:</span>
                <span className="text-quorum-blue-light font-mono truncate max-w-xs">{baselineTargetMonitor.artifact_url}</span>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-brand-border/40">
                <span className="text-brand-muted">Current Baseline:</span>
                <span className="font-mono text-cyan-300">
                  {baselineTargetMonitor.trusted_baseline_sha256
                    ? truncateHash(baselineTargetMonitor.trusted_baseline_sha256, 12, 12)
                    : 'None (Unestablished)'}
                </span>
              </div>
              {baselineTargetMonitor.previous_baseline_sha256 && (
                <div className="flex items-center justify-between">
                  <span className="text-brand-muted">Previous Baseline:</span>
                  <span className="font-mono text-zinc-400">
                    {truncateHash(baselineTargetMonitor.previous_baseline_sha256, 12, 12)}
                  </span>
                </div>
              )}
            </div>

            {/* Explanatory note */}
            <div className="p-3 rounded-xl bg-cyan-950/30 border border-cyan-800/60 text-xs text-cyan-200/90 leading-relaxed space-y-1">
              <div className="font-semibold text-cyan-300 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-cyan-400" />
                <span>Explicit Operator Approval Required</span>
              </div>
              <p>
                A Trusted Baseline Hash is the previously approved hash saved for comparison with future downloads. Establishing or updating a baseline records an immutable audit event with your operator identity, justification notes, and timestamp.
              </p>
            </div>

            {baselineModalError && (
              <div className="p-3 rounded-xl bg-red-950/50 border border-red-800 text-xs text-red-300 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span>{baselineModalError}</span>
              </div>
            )}

            <form onSubmit={handleSaveBaseline} className="space-y-4">
              {/* Quick prefill chips */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-brand-muted uppercase tracking-wider">
                  Baseline Source Selection
                </label>
                <div className="flex flex-wrap gap-2">
                  {baselineTargetMonitor.last_observed_sha256 && (
                    <button
                      type="button"
                      onClick={() => setBaselineHashInput(baselineTargetMonitor.last_observed_sha256 || '')}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-mono bg-brand-panel-elevated hover:bg-brand-panel-elevated/80 text-white border border-brand-border/80 flex items-center gap-1.5"
                    >
                      <Download className="w-3 h-3 text-cyan-400" />
                      <span>Use Current Hash ({truncateHash(baselineTargetMonitor.last_observed_sha256, 6, 6)})</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setBaselineHashInput(baselineTargetMonitor.expected_sha256)}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-mono bg-brand-panel-elevated hover:bg-brand-panel-elevated/80 text-white border border-brand-border/80 flex items-center gap-1.5"
                  >
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    <span>Use Version Hash ({truncateHash(baselineTargetMonitor.expected_sha256, 6, 6)})</span>
                  </button>
                </div>
              </div>

              {/* Hash input */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-brand-muted">
                  Trusted Baseline SHA-256 Hash
                </label>
                <input
                  type="text"
                  placeholder="64-character hexadecimal SHA-256 hash"
                  value={baselineHashInput}
                  onChange={(e) => setBaselineHashInput(e.target.value)}
                  className="w-full px-3 py-2 bg-brand-bg-deep/90 border border-brand-border rounded-xl text-xs text-white font-mono placeholder-brand-muted focus:outline-none focus:border-cyan-500"
                />
              </div>

              {/* Approver Identity */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-brand-muted">
                  Approving Operator / Authority
                </label>
                <input
                  type="text"
                  placeholder="e.g. Lead Release Engineer / Security Operator"
                  value={baselineApproverInput}
                  onChange={(e) => setBaselineApproverInput(e.target.value)}
                  className="w-full px-3 py-2 bg-brand-bg-deep/90 border border-brand-border rounded-xl text-sm text-white placeholder-brand-muted focus:outline-none focus:border-cyan-500"
                />
              </div>

              {/* Approval Notes */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-brand-muted">
                  Approval Notes / Justification (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Approved official v0.74.4 release binary after hash & signature verification"
                  value={baselineNotesInput}
                  onChange={(e) => setBaselineNotesInput(e.target.value)}
                  className="w-full px-3 py-2 bg-brand-bg-deep/90 border border-brand-border rounded-xl text-sm text-white placeholder-brand-muted focus:outline-none focus:border-cyan-500"
                />
              </div>

              {/* Modal Actions */}
              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-brand-border/60">
                <button
                  type="button"
                  onClick={() => {
                    setIsBaselineModalOpen(false);
                    setBaselineTargetMonitor(null);
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-brand-muted hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingBaseline}
                  className="px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition-all shadow-md flex items-center gap-2"
                >
                  {isSubmittingBaseline && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>{isSubmittingBaseline ? 'Recording...' : 'Approve & Save Baseline'}</span>
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
                  <h2 className="text-lg font-bold text-white">Witness Audit & Check History</h2>
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

            {/* Tab selector: Check Runs vs Baseline Audit Trail */}
            <div className="flex items-center gap-2 border-b border-brand-border/60 pb-2">
              <button
                type="button"
                onClick={() => setHistoryTab('checks')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                  historyTab === 'checks'
                    ? 'bg-quorum-blue-primary text-white shadow-sm'
                    : 'text-brand-muted hover:text-white hover:bg-brand-panel-elevated'
                }`}
              >
                <Activity className="w-3.5 h-3.5" />
                <span>Check Runs ({historyChecks.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setHistoryTab('baselines')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                  historyTab === 'baselines'
                    ? 'bg-cyan-600 text-white shadow-sm'
                    : 'text-brand-muted hover:text-white hover:bg-brand-panel-elevated'
                }`}
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Baseline Audit Trail ({baselineEvents.length})</span>
              </button>
            </div>

            {/* Content List */}
            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
              {isLoadingHistory ? (
                <div className="py-12 text-center text-brand-muted space-y-2">
                  <RefreshCw className="w-6 h-6 animate-spin text-quorum-blue-primary mx-auto" />
                  <p className="text-xs">Loading audit telemetry...</p>
                </div>
              ) : historyTab === 'checks' ? (
                historyChecks.length === 0 ? (
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
                                <span>VERSION MATCH</span>
                              </span>
                            )}
                            {isMismatch && (
                              <span className="inline-flex items-center gap-1 font-bold text-red-400 animate-pulse">
                                <ShieldAlert className="w-3.5 h-3.5" />
                                <span>VERSION MISMATCH</span>
                              </span>
                            )}
                            {check.result === 'ERROR' && (
                              <span className="inline-flex items-center gap-1 font-bold text-amber-400">
                                <AlertTriangle className="w-3.5 h-3.5" />
                                <span>ERROR</span>
                              </span>
                            )}

                            {/* Baseline check result pill */}
                            {check.baseline_result && (
                              <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                                check.baseline_result === 'MATCH'
                                  ? 'bg-emerald-950/60 text-emerald-300 border-emerald-700/60'
                                  : check.baseline_result === 'CHANGED'
                                  ? 'bg-amber-950/80 text-amber-300 border-amber-600'
                                  : 'bg-zinc-800 text-zinc-300 border-zinc-700'
                              }`}>
                                BASELINE: {check.baseline_result}
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

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                          <div>
                            <div className="text-[10px] text-brand-muted/70">VERSION HASH</div>
                            <div className="text-white truncate font-mono">{check.expected_sha256}</div>
                          </div>
                          <div>
                            <div className="text-[10px] text-brand-muted/70">TRUSTED BASELINE HASH</div>
                            <div className="text-cyan-300 truncate font-mono">
                              {check.trusted_baseline_sha256 || 'Baseline not established'}
                            </div>
                          </div>
                          <div>
                            <div className={`text-[10px] ${isMismatch ? 'text-red-400 font-bold' : 'text-brand-muted/70'}`}>
                              CURRENT HASH
                            </div>
                            <div className={`truncate font-mono ${isMismatch ? 'text-red-300 font-bold' : 'text-white'}`}>
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
                )
              ) : (
                /* Tab 2: Baseline Audit Trail */
                baselineEvents.length === 0 ? (
                  <div className="py-12 text-center text-brand-muted text-xs space-y-1">
                    <Lock className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
                    <p className="text-white font-medium">No baseline events recorded</p>
                    <p className="text-brand-muted">
                      Use the "Baseline" button on the monitor card to establish an approved trusted baseline.
                    </p>
                  </div>
                ) : (
                  baselineEvents.map((evt) => {
                    const isEstablished = evt.event_type === 'BASELINE_ESTABLISHED';
                    const isUpdated = evt.event_type === 'BASELINE_UPDATED';
                    const isDivergence = evt.event_type === 'BASELINE_DIVERGENCE';

                    return (
                      <div
                        key={evt.id}
                        className={`p-3.5 rounded-xl border text-xs font-mono space-y-2 transition-all ${
                          isDivergence
                            ? 'bg-amber-950/30 border-amber-700/80 text-amber-200'
                            : isUpdated
                            ? 'bg-brand-bg-deep/70 border-cyan-800/60 text-cyan-200'
                            : 'bg-brand-bg-deep/70 border-brand-border/70 text-brand-muted'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {isEstablished && (
                              <span className="inline-flex items-center gap-1 font-bold text-cyan-400 px-2 py-0.5 rounded bg-cyan-950/60 border border-cyan-700/60">
                                <Lock className="w-3 h-3" />
                                <span>BASELINE ESTABLISHED</span>
                              </span>
                            )}
                            {isUpdated && (
                              <span className="inline-flex items-center gap-1 font-bold text-emerald-400 px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-700/60">
                                <ShieldCheck className="w-3 h-3" />
                                <span>BASELINE UPDATED</span>
                              </span>
                            )}
                            {isDivergence && (
                              <span className="inline-flex items-center gap-1 font-bold text-amber-300 px-2 py-0.5 rounded bg-amber-950/80 border border-amber-600 animate-pulse">
                                <AlertTriangle className="w-3 h-3" />
                                <span>BASELINE DIVERGENCE DETECTED</span>
                              </span>
                            )}
                            <span className="text-brand-muted/70">·</span>
                            <span className="text-white">
                              {evt.created_at.replace('T', ' ')}
                            </span>
                          </div>

                          <div className="text-brand-muted">
                            Approved by: <strong className="text-white">{evt.approved_by || 'Operator'}</strong>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                          {evt.trusted_baseline_sha256 && (
                            <div>
                              <div className="text-[10px] text-brand-muted/70">TRUSTED BASELINE HASH</div>
                              <div className="text-cyan-300 truncate font-mono">{evt.trusted_baseline_sha256}</div>
                            </div>
                          )}
                          {evt.previous_baseline_sha256 && (
                            <div>
                              <div className="text-[10px] text-brand-muted/70">PREVIOUS BASELINE HASH</div>
                              <div className="text-zinc-400 truncate font-mono">{evt.previous_baseline_sha256}</div>
                            </div>
                          )}
                          {evt.observed_sha256 && (
                            <div>
                              <div className="text-[10px] text-amber-400 font-semibold">CURRENT DIVERGENT HASH</div>
                              <div className="text-amber-200 truncate font-mono font-bold">{evt.observed_sha256}</div>
                            </div>
                          )}
                        </div>

                        {evt.notes && (
                          <div className="text-brand-muted text-[11px] pt-1 border-t border-brand-border/40 font-sans">
                            Justification: <span className="text-white">{evt.notes}</span>
                          </div>
                        )}
                      </div>
                    );
                  })
                )
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
