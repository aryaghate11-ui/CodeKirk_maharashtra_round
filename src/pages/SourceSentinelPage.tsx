import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardBody } from '../components/common/Card';
import { CopyButton } from '../components/common/CopyButton';
import { truncateHash, formatRelativeTime } from '../lib/utils';
import { api, BackendError } from '../services/api';
import {
  ComparisonResponse,
  ComparisonListItem,
  FixtureItem,
  SourceFinding,
  FindingCategory,
  RiskLevel,
  ReviewStatus,
} from '../types/sentinel';
import {
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Info,
  GitCompare,
  GitCommit,
  CheckCircle2,
  FileCode,
  FileText,
  Clock,
  Sparkles,
  ExternalLink,
  ChevronRight,
  Filter,
  Check,
  Flag,
  Loader2,
  Search,
  Lock,
} from 'lucide-react';

const CATEGORY_LABELS: Record<FindingCategory, string> = {
  AUTH_PERMISSIONS: 'Auth & Permissions',
  CRYPTO_SIGNATURES: 'Crypto & Signatures',
  DEPENDENCY_CHANGES: 'Dependency Manifest',
  NETWORK_EXFILTRATION: 'Network / Exfil',
  BUILD_WORKFLOWS: 'Build Workflows',
  SECRETS_HANDLING: 'Secrets Handling',
};

const RISK_BADGE_STYLES: Record<RiskLevel, { bg: string; border: string; text: string }> = {
  CRITICAL: { bg: 'bg-red-950/50', border: 'border-red-800/80', text: 'text-red-400' },
  HIGH: { bg: 'bg-orange-950/50', border: 'border-orange-800/80', text: 'text-orange-400' },
  MEDIUM: { bg: 'bg-amber-950/50', border: 'border-amber-800/80', text: 'text-amber-400' },
  LOW: { bg: 'bg-blue-950/50', border: 'border-blue-800/80', text: 'text-blue-400' },
  INFO: { bg: 'bg-emerald-950/50', border: 'border-emerald-800/80', text: 'text-emerald-400' },
};

const REVIEW_BADGE_STYLES: Record<ReviewStatus, { bg: string; border: string; text: string }> = {
  APPROVED: { bg: 'bg-quorum-green-bg/70', border: 'border-quorum-green-border', text: 'text-quorum-green-light' },
  FLAGGED: { bg: 'bg-quorum-red-bg/70', border: 'border-quorum-red-border', text: 'text-quorum-red-light' },
  PENDING: { bg: 'bg-brand-bg-deep/70', border: 'border-brand-border', text: 'text-brand-muted' },
};

export const SourceSentinelPage: React.FC = () => {
  // State
  const [fixtures, setFixtures] = useState<FixtureItem[]>([]);
  const [comparisons, setComparisons] = useState<ComparisonListItem[]>([]);
  const [activeComparison, setActiveComparison] = useState<ComparisonResponse | null>(null);

  // Form input state
  const [mode, setMode] = useState<'fixture' | 'git' | 'cross-repo'>('fixture');
  const [selectedFixtureId, setSelectedFixtureId] = useState<string>('clean-refactor');

  // Within-repo Git state
  const [gitRepoUrl, setGitRepoUrl] = useState<string>(
    'https://github.com/sarishanasane-beep/anasane-clinical-laboratory'
  );
  const [gitBaseCommit, setGitBaseCommit] = useState<string>('2fbbca4d68');
  const [gitTargetCommit, setGitTargetCommit] = useState<string>('0d2339c9ce');

  // Cross-repo Git state
  const [crossBaseRepoUrl, setCrossBaseRepoUrl] = useState<string>(
    'https://github.com/sarishanasane-beep/anasane-clinical-laboratory'
  );
  const [crossBaseCommit, setCrossBaseCommit] = useState<string>('0d2339c9ce');
  const [crossTargetRepoUrl, setCrossTargetRepoUrl] = useState<string>(
    'https://github.com/sarishanasane-beep/anasane-clinical-laboratory2'
  );
  const [crossTargetCommit, setCrossTargetCommit] = useState<string>('0310481518');

  // Loading & Error state
  const [isComparing, setIsComparing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Review state
  const [reviewNotesInput, setReviewNotesInput] = useState<string>('');
  const [isUpdatingReview, setIsUpdatingReview] = useState(false);

  // Diff & Filter state
  const [selectedDiffFileIndex, setSelectedDiffFileIndex] = useState<number>(0);
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>('ALL');

  // Clinical Lab Demo Presets
  const handleLoadClinicalPreset = (type: 'repo1' | 'repo2' | 'cross') => {
    if (type === 'repo1') {
      setMode('git');
      setGitRepoUrl('https://github.com/sarishanasane-beep/anasane-clinical-laboratory');
      setGitBaseCommit('2fbbca4d68');
      setGitTargetCommit('0d2339c9ce');
    } else if (type === 'repo2') {
      setMode('git');
      setGitRepoUrl('https://github.com/sarishanasane-beep/anasane-clinical-laboratory2');
      setGitBaseCommit('e6961c12e1');
      setGitTargetCommit('0310481518');
    } else {
      setMode('cross-repo');
      setCrossBaseRepoUrl('https://github.com/sarishanasane-beep/anasane-clinical-laboratory');
      setCrossBaseCommit('0d2339c9ce');
      setCrossTargetRepoUrl('https://github.com/sarishanasane-beep/anasane-clinical-laboratory2');
      setCrossTargetCommit('0310481518');
    }
  };

  // Load initial fixtures and historical comparisons
  const loadInitialData = async () => {
    try {
      setErrorMessage(null);
      const [fixts, comps] = await Promise.all([
        api.getSentinelFixtures(),
        api.getSentinelComparisons(50),
      ]);
      setFixtures(fixts);
      setComparisons(comps);
      if (fixts.length > 0 && !selectedFixtureId) {
        setSelectedFixtureId(fixts[0].id);
      }
      // If there are previous comparisons, load the newest one
      if (comps.length > 0 && !activeComparison) {
        const first = await api.getSentinelComparison(comps[0].id);
        setActiveComparison(first);
        setReviewNotesInput(first.reviewer_notes || '');
      }
    } catch (e: any) {
      console.error('Failed to load Source Sentinel data:', e);
      setErrorMessage(e.message || 'Failed to load initial Source Sentinel records.');
    }
  };

  useEffect(() => {
    loadInitialData();
  }, []);

  // Handle running comparison
  const handleRunComparison = async () => {
    setIsComparing(true);
    setErrorMessage(null);
    try {
      let payload: any;
      if (mode === 'fixture') {
        payload = { mode: 'fixture', fixture_id: selectedFixtureId };
      } else if (mode === 'cross-repo') {
        payload = {
          mode: 'cross-repo',
          base_repository_url: crossBaseRepoUrl.trim(),
          target_repository_url: crossTargetRepoUrl.trim(),
          base_commit: crossBaseCommit.trim(),
          target_commit: crossTargetCommit.trim(),
        };
      } else {
        payload = {
          mode: 'git',
          repository_url: gitRepoUrl.trim(),
          base_commit: gitBaseCommit.trim(),
          target_commit: gitTargetCommit.trim(),
        };
      }

      const result = await api.compareSource(payload);
      setActiveComparison(result);
      setReviewNotesInput(result.reviewer_notes || '');
      setSelectedDiffFileIndex(0);

      // Refresh history list
      const refreshedComps = await api.getSentinelComparisons(50);
      setComparisons(refreshedComps);
    } catch (e: any) {
      console.error('Source comparison failed:', e);
      setErrorMessage(e.message || 'Source code comparison failed.');
    } finally {
      setIsComparing(false);
    }
  };

  // Handle selecting a historical comparison
  const handleSelectHistorical = async (id: string) => {
    try {
      setErrorMessage(null);
      const item = await api.getSentinelComparison(id);
      setActiveComparison(item);
      setReviewNotesInput(item.reviewer_notes || '');
      setSelectedDiffFileIndex(0);
    } catch (e: any) {
      setErrorMessage(e.message || 'Failed to load historical comparison.');
    }
  };

  // Handle review status update
  const handleUpdateReview = async (newStatus: ReviewStatus) => {
    if (!activeComparison) return;
    setIsUpdatingReview(true);
    try {
      const updated = await api.updateSentinelReview(activeComparison.id, {
        review_status: newStatus,
        notes: reviewNotesInput.trim(),
      });
      setActiveComparison(updated);

      // Refresh list status
      const refreshedComps = await api.getSentinelComparisons(50);
      setComparisons(refreshedComps);
    } catch (e: any) {
      setErrorMessage(e.message || 'Failed to update review status.');
    } finally {
      setIsUpdatingReview(false);
    }
  };

  // Filtered findings
  const filteredFindings = activeComparison?.findings.filter((f) => {
    if (selectedCategoryFilter === 'ALL') return true;
    return f.category === selectedCategoryFilter;
  }) || [];

  const currentDiffFile = activeComparison?.diff_files[selectedDiffFileIndex] || null;

  return (
    <div className="space-y-6">
      {/* Top Banner & Overview */}
      <div className="p-6 rounded-2xl bg-brand-panel/75 backdrop-blur-md border border-brand-border/70 shadow-panel">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-brand-bg-deep border border-brand-border text-[11px] font-mono font-semibold text-brand-muted">
              <Sparkles className="w-3.5 h-3.5 text-quorum-green" />
              USP 1 · Pre-Release Source Defense
            </div>
            <h1 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-2.5">
              <span>Source Sentinel</span>
            </h1>
            <p className="text-xs sm:text-sm text-brand-muted max-w-2xl">
              Inspects source changes between releases. Flags suspicious modifications to authentication,
              cryptographic verification, package install hooks, network calls, and CI/CD workflows before a build is trusted.
            </p>
          </div>

          {/* Quick Metrics */}
          <div className="grid grid-cols-3 gap-2 text-center sm:text-right font-mono">
            <div className="p-2.5 rounded-xl bg-brand-bg-deep/70 border border-brand-border">
              <span className="text-[10px] text-brand-muted uppercase block">Total Scans</span>
              <span className="text-lg font-bold text-white">{comparisons.length}</span>
            </div>
            <div className="p-2.5 rounded-xl bg-brand-bg-deep/70 border border-brand-border">
              <span className="text-[10px] text-brand-muted uppercase block">Critical/High</span>
              <span className="text-lg font-bold text-quorum-red-light">
                {comparisons.filter((c) => c.risk_level === 'CRITICAL' || c.risk_level === 'HIGH').length}
              </span>
            </div>
            <div className="p-2.5 rounded-xl bg-brand-bg-deep/70 border border-brand-border">
              <span className="text-[10px] text-brand-muted uppercase block">Pending</span>
              <span className="text-lg font-bold text-quorum-amber-light">
                {comparisons.filter((c) => c.review_status === 'PENDING').length}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Error Banner */}
      {errorMessage && (
        <div className="p-4 rounded-xl bg-quorum-red-bg/80 border border-quorum-red-border text-quorum-red-light text-xs font-mono flex items-start gap-2.5 shadow-sm">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <strong>Analysis Error: </strong> {errorMessage}
          </div>
          <button onClick={() => setErrorMessage(null)} className="text-white hover:underline text-[11px]">
            Dismiss
          </button>
        </div>
      )}

      {/* Comparison Launcher Card */}
      <Card>
        <CardHeader
          title="Run Source Comparison"
          subtitle="Select a reproducible demo fixture or enter a public Git repository"
          icon={<GitCompare className="w-4 h-4 text-quorum-green" />}
        />
        <CardBody className="space-y-5">
          {/* Mode Switcher Tabs */}
          <div className="flex flex-wrap items-center gap-2 p-1 rounded-xl bg-brand-bg-deep border border-brand-border w-fit text-xs font-medium">
            <button
              onClick={() => setMode('fixture')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                mode === 'fixture'
                  ? 'bg-brand-panel-elevated text-white shadow-sm font-semibold'
                  : 'text-brand-muted hover:text-white'
              }`}
            >
              Mode 1: Demo Fixtures
            </button>
            <button
              onClick={() => setMode('git')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                mode === 'git'
                  ? 'bg-brand-panel-elevated text-white shadow-sm font-semibold'
                  : 'text-brand-muted hover:text-white'
              }`}
            >
              Mode 2: Within-Repository Git
            </button>
            <button
              onClick={() => setMode('cross-repo')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                mode === 'cross-repo'
                  ? 'bg-brand-panel-elevated text-white shadow-sm font-semibold'
                  : 'text-brand-muted hover:text-white'
              }`}
            >
              Mode 3: Cross-Repository Compare
            </button>
          </div>

          {/* Quick Preset Buttons for Real GitHub Clinical Laboratory Repos */}
          <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-xl bg-brand-bg-deep/70 border border-brand-border/60">
            <span className="text-[11px] font-mono text-brand-muted shrink-0">Real GitHub Presets:</span>
            <button
              type="button"
              onClick={() => handleLoadClinicalPreset('repo1')}
              className="px-2.5 py-1 rounded bg-brand-panel-elevated/80 hover:bg-brand-panel-elevated text-xs font-medium text-quorum-green-light hover:text-white border border-brand-border/80 transition-colors"
              title="Compare commits in anasane-clinical-laboratory (2fbbca4d68 -> 0d2339c9ce)"
            >
              Clinical Lab 1 (Within-Repo)
            </button>
            <button
              type="button"
              onClick={() => handleLoadClinicalPreset('repo2')}
              className="px-2.5 py-1 rounded bg-brand-panel-elevated/80 hover:bg-brand-panel-elevated text-xs font-medium text-quorum-blue-light hover:text-white border border-brand-border/80 transition-colors"
              title="Compare commits in anasane-clinical-laboratory2 (e6961c12e1 -> 0310481518)"
            >
              Clinical Lab 2 (Within-Repo)
            </button>
            <button
              type="button"
              onClick={() => handleLoadClinicalPreset('cross')}
              className="px-2.5 py-1 rounded bg-purple-950/40 hover:bg-purple-950/80 text-xs font-medium text-purple-300 hover:text-white border border-purple-800/60 transition-colors"
              title="Compare corresponding files across anasane-clinical-laboratory and anasane-clinical-laboratory2"
            >
              Cross-Repo: Lab 1 vs Lab 2
            </button>
          </div>

          {/* Mode 1: Fixture Selector */}
          {mode === 'fixture' && (
            <div className="space-y-3">
              <label className="text-xs font-mono font-semibold text-brand-muted uppercase tracking-wider block">
                Select Deterministic Fixture Scenario
              </label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {fixtures.map((f) => {
                  const isSelected = selectedFixtureId === f.id;
                  const riskStyle = RISK_BADGE_STYLES[f.expected_risk];
                  return (
                    <div
                      key={f.id}
                      onClick={() => setSelectedFixtureId(f.id)}
                      className={`p-3.5 rounded-xl border text-left cursor-pointer transition-all ${
                        isSelected
                          ? 'bg-brand-panel-elevated/90 border-brand-border-bright ring-1 ring-quorum-green/40 shadow-sm'
                          : 'bg-brand-bg-deep/70 border-brand-border hover:bg-brand-panel-elevated/40'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-brand-bg border border-brand-border text-brand-muted">
                          DEMO FIXTURE
                        </span>
                        <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${riskStyle.bg} ${riskStyle.border} ${riskStyle.text}`}>
                          {f.expected_risk}
                        </span>
                      </div>
                      <h3 className="text-xs font-bold text-white mb-1">{f.name}</h3>
                      <p className="text-[11px] text-brand-muted line-clamp-2 leading-relaxed mb-2">
                        {f.description}
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {f.category_tags.map((tag) => (
                          <span key={tag} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-brand-panel text-brand-subtle">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Mode 2: Live Git (Within Repository) Input */}
          {mode === 'git' && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl bg-brand-bg-deep/70 border border-brand-border text-xs text-brand-muted flex items-start gap-2.5">
                <Lock className="w-4 h-4 text-quorum-green flex-shrink-0 mt-0.5" />
                <p className="leading-relaxed">
                  <strong className="text-white">Bounded & SSRF-Protected Acquisition:</strong> Source Sentinel downloads public repository tarball archives over HTTPS. Private IP ranges, internal loopback, and code execution hooks are strictly blocked. Maximum 15 MB archive size limit.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <div>
                  <label className="text-[10px] font-mono font-semibold text-brand-muted uppercase block mb-1">
                    Public Git Repository URL
                  </label>
                  <input
                    type="text"
                    value={gitRepoUrl}
                    onChange={(e) => setGitRepoUrl(e.target.value)}
                    placeholder="https://github.com/owner/repo"
                    className="w-full bg-brand-bg-deep border border-brand-border rounded-lg p-2 text-white font-mono focus:border-quorum-green focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-mono font-semibold text-brand-muted uppercase block mb-1">
                    Trusted Base Commit (or Tag)
                  </label>
                  <input
                    type="text"
                    value={gitBaseCommit}
                    onChange={(e) => setGitBaseCommit(e.target.value)}
                    placeholder="e.g. 2fbbca4d68"
                    className="w-full bg-brand-bg-deep border border-brand-border rounded-lg p-2 text-white font-mono focus:border-quorum-green focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-mono font-semibold text-brand-muted uppercase block mb-1">
                    Proposed Target Commit (or Tag)
                  </label>
                  <input
                    type="text"
                    value={gitTargetCommit}
                    onChange={(e) => setGitTargetCommit(e.target.value)}
                    placeholder="e.g. 0d2339c9ce"
                    className="w-full bg-brand-bg-deep border border-brand-border rounded-lg p-2 text-white font-mono focus:border-quorum-green focus:outline-none"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Mode 3: Cross-Repository Comparison Input */}
          {mode === 'cross-repo' && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl bg-brand-bg-deep/70 border border-brand-border text-xs text-brand-muted flex items-start gap-2.5">
                <GitCompare className="w-4 h-4 text-purple-400 flex-shrink-0 mt-0.5" />
                <p className="leading-relaxed">
                  <strong className="text-white">Cross-Repository Independent Comparison:</strong> Compares corresponding source files between two independent public repositories without requiring a shared git commit history.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                {/* Base Repository Column */}
                <div className="p-3.5 rounded-xl bg-brand-bg-deep/50 border border-brand-border space-y-2.5">
                  <span className="text-[10px] font-mono font-bold text-quorum-blue-light uppercase tracking-wider block">
                    Base Reference Repository
                  </span>
                  <div>
                    <label className="text-[10px] font-mono text-brand-muted block mb-1">
                      Repository URL
                    </label>
                    <input
                      type="text"
                      value={crossBaseRepoUrl}
                      onChange={(e) => setCrossBaseRepoUrl(e.target.value)}
                      placeholder="https://github.com/owner/base-repo"
                      className="w-full bg-brand-bg-deep border border-brand-border rounded-lg p-2 text-white font-mono focus:border-quorum-green focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-mono text-brand-muted block mb-1">
                      Commit SHA / Branch / Tag
                    </label>
                    <input
                      type="text"
                      value={crossBaseCommit}
                      onChange={(e) => setCrossBaseCommit(e.target.value)}
                      placeholder="e.g. 0d2339c9ce or main"
                      className="w-full bg-brand-bg-deep border border-brand-border rounded-lg p-2 text-white font-mono focus:border-quorum-green focus:outline-none"
                    />
                  </div>
                </div>

                {/* Target Repository Column */}
                <div className="p-3.5 rounded-xl bg-brand-bg-deep/50 border border-brand-border space-y-2.5">
                  <span className="text-[10px] font-mono font-bold text-purple-300 uppercase tracking-wider block">
                    Target Proposed Repository
                  </span>
                  <div>
                    <label className="text-[10px] font-mono text-brand-muted block mb-1">
                      Repository URL
                    </label>
                    <input
                      type="text"
                      value={crossTargetRepoUrl}
                      onChange={(e) => setCrossTargetRepoUrl(e.target.value)}
                      placeholder="https://github.com/owner/target-repo"
                      className="w-full bg-brand-bg-deep border border-brand-border rounded-lg p-2 text-white font-mono focus:border-quorum-green focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-mono text-brand-muted block mb-1">
                      Commit SHA / Branch / Tag
                    </label>
                    <input
                      type="text"
                      value={crossTargetCommit}
                      onChange={(e) => setCrossTargetCommit(e.target.value)}
                      placeholder="e.g. 0310481518 or main"
                      className="w-full bg-brand-bg-deep border border-brand-border rounded-lg p-2 text-white font-mono focus:border-quorum-green focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Action Button */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              onClick={handleRunComparison}
              disabled={isComparing}
              className="px-5 py-2.5 rounded-xl text-xs font-bold text-black bg-quorum-green hover:bg-quorum-green-light disabled:opacity-50 transition-all flex items-center gap-2 shadow-glow-green cursor-pointer"
            >
              {isComparing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-black" />
                  <span>Analyzing Source Diffs…</span>
                </>
              ) : (
                <>
                  <Search className="w-4 h-4 text-black" />
                  <span>Execute Source Sentinel Scan</span>
                </>
              )}
            </button>
          </div>
        </CardBody>
      </Card>

      {/* Active Comparison Presentation */}
      {activeComparison && (
        <div className="space-y-6">
          {/* Risk Level Banner */}
          <div
            className={`p-5 rounded-2xl border backdrop-blur-md transition-all ${
              activeComparison.risk_level === 'CRITICAL' || activeComparison.risk_level === 'HIGH'
                ? 'bg-quorum-red-bg/50 border-quorum-red-border text-white'
                : activeComparison.risk_level === 'MEDIUM'
                ? 'bg-quorum-amber-bg/50 border-quorum-amber-border text-white'
                : 'bg-quorum-green-bg/50 border-quorum-green-border text-white'
            }`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start sm:items-center gap-3.5">
                <div
                  className={`p-3 rounded-xl border ${
                    activeComparison.risk_level === 'CRITICAL' || activeComparison.risk_level === 'HIGH'
                      ? 'bg-quorum-red-bg border-quorum-red-border text-quorum-red'
                      : activeComparison.risk_level === 'MEDIUM'
                      ? 'bg-quorum-amber-bg border-quorum-amber-border text-quorum-amber'
                      : 'bg-quorum-green-bg border-quorum-green-border text-quorum-green'
                  }`}
                >
                  {activeComparison.risk_level === 'CRITICAL' ? (
                    <ShieldAlert className="w-7 h-7 text-quorum-red-light" />
                  ) : activeComparison.risk_level === 'HIGH' ? (
                    <AlertTriangle className="w-7 h-7 text-quorum-red-light" />
                  ) : activeComparison.risk_level === 'MEDIUM' ? (
                    <AlertTriangle className="w-7 h-7 text-quorum-amber-light" />
                  ) : (
                    <ShieldCheck className="w-7 h-7 text-quorum-green-light" />
                  )}
                </div>

                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono uppercase tracking-wider text-brand-muted">
                      Source Risk Assessment:
                    </span>
                    <span
                      className={`text-xs font-mono font-bold px-2 py-0.5 rounded border ${
                        RISK_BADGE_STYLES[activeComparison.risk_level].bg
                      } ${RISK_BADGE_STYLES[activeComparison.risk_level].border} ${
                        RISK_BADGE_STYLES[activeComparison.risk_level].text
                      }`}
                    >
                      {activeComparison.risk_level} RISK
                    </span>
                    {activeComparison.is_fixture && (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-brand-bg-deep border border-brand-border text-brand-muted">
                        DEMO FIXTURE
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-medium mt-1 text-slate-200">
                    {activeComparison.findings.length === 0
                      ? 'No security-sensitive changes identified. Diff comprises clean formatting, documentation, or routine logic updates.'
                      : `${activeComparison.findings.length} security-sensitive finding(s) detected across ${activeComparison.summary.files_changed_count} changed file(s). Review findings before verifying releases from this source code.`}
                  </p>
                </div>
              </div>

              {/* Review Status Pill */}
              <div className="flex-shrink-0 sm:text-right font-mono text-xs">
                <span className="text-brand-muted block text-[11px] uppercase mb-1">Human Review Status</span>
                <span
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-bold ${
                    REVIEW_BADGE_STYLES[activeComparison.review_status].bg
                  } ${REVIEW_BADGE_STYLES[activeComparison.review_status].border} ${
                    REVIEW_BADGE_STYLES[activeComparison.review_status].text
                  }`}
                >
                  {activeComparison.review_status === 'APPROVED' && <Check className="w-3.5 h-3.5" />}
                  {activeComparison.review_status === 'FLAGGED' && <Flag className="w-3.5 h-3.5" />}
                  {activeComparison.review_status === 'PENDING' && <Clock className="w-3.5 h-3.5" />}
                  {activeComparison.review_status}
                </span>
              </div>
            </div>
          </div>

          {/* Metadata & Human Review Row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Metadata Card */}
            <div className="lg:col-span-2">
              <Card>
                <CardHeader
                  title="Source Provenance & Tree Hashes"
                  subtitle="Cryptographic snapshots computed deterministically over retrieved files"
                  icon={<FileCode className="w-4 h-4 text-quorum-green" />}
                />
                <CardBody className="space-y-3 text-xs font-mono">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="p-3 rounded-lg bg-brand-bg-deep/70 border border-brand-border space-y-1">
                      <span className="text-[10px] text-brand-muted uppercase block">Repository URL</span>
                      <span className="text-white font-semibold break-all">{activeComparison.repository_url}</span>
                    </div>
                    <div className="p-3 rounded-lg bg-brand-bg-deep/70 border border-brand-border space-y-1">
                      <span className="text-[10px] text-brand-muted uppercase block">Target Commit</span>
                      <div className="flex items-center justify-between">
                        <span className="text-white font-semibold">{truncateHash(activeComparison.target_commit, 8, 8)}</span>
                        <CopyButton text={activeComparison.target_commit} />
                      </div>
                    </div>
                    <div className="p-3 rounded-lg bg-brand-bg-deep/70 border border-brand-border space-y-1">
                      <span className="text-[10px] text-brand-muted uppercase block">Base Snapshot SHA-256</span>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-300">{truncateHash(activeComparison.base_snapshot_hash, 8, 8)}</span>
                        <CopyButton text={activeComparison.base_snapshot_hash} />
                      </div>
                    </div>
                    <div className="p-3 rounded-lg bg-brand-bg-deep/70 border border-brand-border space-y-1">
                      <span className="text-[10px] text-brand-muted uppercase block">Target Snapshot SHA-256</span>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-300">{truncateHash(activeComparison.target_snapshot_hash, 8, 8)}</span>
                        <CopyButton text={activeComparison.target_snapshot_hash} />
                      </div>
                    </div>
                  </div>

                  {/* Diff Stats Bar */}
                  <div className="p-3 rounded-lg bg-brand-panel-elevated/40 border border-brand-border flex items-center justify-around text-center">
                    <div>
                      <span className="text-[10px] text-brand-muted uppercase block">Files Changed</span>
                      <span className="text-sm font-bold text-white">{activeComparison.summary.files_changed_count}</span>
                    </div>
                    <div className="border-r border-brand-border h-6" />
                    <div>
                      <span className="text-[10px] text-brand-muted uppercase block">Additions</span>
                      <span className="text-sm font-bold text-quorum-green-light">+{activeComparison.summary.additions_count}</span>
                    </div>
                    <div className="border-r border-brand-border h-6" />
                    <div>
                      <span className="text-[10px] text-brand-muted uppercase block">Deletions</span>
                      <span className="text-sm font-bold text-quorum-red-light">-{activeComparison.summary.deletions_count}</span>
                    </div>
                  </div>
                </CardBody>
              </Card>
            </div>

            {/* Human Review Workflow Card */}
            <div>
              <Card>
                <CardHeader
                  title="Auditor Review Workflow"
                  subtitle="Record security assessment decisions"
                  icon={<Clock className="w-4 h-4 text-quorum-amber" />}
                />
                <CardBody className="space-y-4 text-xs">
                  <div>
                    <label className="text-[10px] font-mono font-semibold text-brand-muted uppercase block mb-1">
                      Reviewer Notes & Decision Rationale
                    </label>
                    <textarea
                      value={reviewNotesInput}
                      onChange={(e) => setReviewNotesInput(e.target.value)}
                      placeholder="Add security audit observations, verified commit sign-offs, or flags..."
                      rows={3}
                      className="w-full bg-brand-bg-deep border border-brand-border rounded-lg p-2.5 text-white font-sans focus:border-quorum-green focus:outline-none text-xs"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => handleUpdateReview('APPROVED')}
                      disabled={isUpdatingReview}
                      className="px-3 py-2 rounded-lg text-xs font-bold text-black bg-quorum-green hover:bg-quorum-green-light disabled:opacity-50 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5 text-black" />
                      <span>Approve Code</span>
                    </button>
                    <button
                      onClick={() => handleUpdateReview('FLAGGED')}
                      disabled={isUpdatingReview}
                      className="px-3 py-2 rounded-lg text-xs font-bold text-white bg-red-600 hover:bg-red-500 disabled:opacity-50 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Flag className="w-3.5 h-3.5 text-white" />
                      <span>Flag as Risk</span>
                    </button>
                  </div>

                  {activeComparison.reviewed_at && (
                    <p className="text-[10px] font-mono text-brand-muted">
                      Last decision: {new Date(activeComparison.reviewed_at).toLocaleString()}
                    </p>
                  )}
                </CardBody>
              </Card>
            </div>
          </div>

          {/* Security Findings Section */}
          <Card>
            <CardHeader
              title={`Security Findings (${activeComparison.findings.length})`}
              subtitle="Heuristic and pattern-based rule detections classified across critical categories"
              icon={<ShieldAlert className="w-4 h-4 text-quorum-red" />}
            />
            <CardBody className="space-y-4">
              {/* Category Filter Pills */}
              <div className="flex flex-wrap items-center gap-1.5 text-xs font-mono">
                <span className="text-brand-muted text-[11px] mr-1">Filter:</span>
                <button
                  onClick={() => setSelectedCategoryFilter('ALL')}
                  className={`px-2.5 py-1 rounded-md transition-all ${
                    selectedCategoryFilter === 'ALL'
                      ? 'bg-quorum-green text-black font-bold'
                      : 'bg-brand-bg-deep text-brand-muted hover:text-white border border-brand-border'
                  }`}
                >
                  ALL ({activeComparison.findings.length})
                </button>
                {Object.entries(CATEGORY_LABELS).map(([cat, label]) => {
                  const count = activeComparison.summary.category_counts[cat as FindingCategory] || 0;
                  if (count === 0) return null;
                  return (
                    <button
                      key={cat}
                      onClick={() => setSelectedCategoryFilter(cat)}
                      className={`px-2.5 py-1 rounded-md transition-all ${
                        selectedCategoryFilter === cat
                          ? 'bg-brand-panel-elevated text-white font-bold border border-brand-border-bright'
                          : 'bg-brand-bg-deep text-brand-muted hover:text-white border border-brand-border'
                      }`}
                    >
                      {label} ({count})
                    </button>
                  );
                })}
              </div>

              {/* Findings List */}
              {filteredFindings.length === 0 ? (
                <div className="p-6 rounded-xl bg-brand-bg-deep/50 border border-brand-border text-center space-y-2">
                  <CheckCircle2 className="w-8 h-8 text-quorum-green mx-auto" />
                  <p className="text-xs font-medium text-white">
                    {selectedCategoryFilter === 'ALL'
                      ? 'Zero security-sensitive changes flagged.'
                      : `No findings under category "${CATEGORY_LABELS[selectedCategoryFilter as FindingCategory]}".`}
                  </p>
                  <p className="text-[11px] text-brand-muted">
                    Always review full diffs manually before production deployments.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredFindings.map((finding) => {
                    const sevStyle = RISK_BADGE_STYLES[finding.severity];
                    return (
                      <div
                        key={finding.id}
                        className="p-4 rounded-xl bg-brand-bg-deep/75 border border-brand-border space-y-2.5 text-xs transition-all hover:border-brand-border-bright"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${sevStyle.bg} ${sevStyle.border} ${sevStyle.text}`}
                            >
                              {finding.severity}
                            </span>
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-brand-panel border border-brand-border text-brand-muted">
                              {CATEGORY_LABELS[finding.category]}
                            </span>
                            <span className="font-bold text-white text-sm">{finding.title}</span>
                          </div>
                          <span className="text-[11px] font-mono text-brand-muted">
                            {finding.file_path}
                            {finding.line_number ? `:${finding.line_number}` : ''}
                          </span>
                        </div>

                        {/* Evidence Code Snippet */}
                        <div className="p-2.5 rounded-lg bg-black/60 border border-brand-border/60 font-mono text-xs text-red-300 overflow-x-auto">
                          <code>{finding.snippet}</code>
                        </div>

                        {/* Explanation & Action */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] text-brand-muted">
                          <div>
                            <strong className="text-white">Explanation: </strong> {finding.explanation}
                          </div>
                          <div>
                            <strong className="text-quorum-green-light">Recommended Action: </strong>{' '}
                            {finding.recommended_action}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardBody>
          </Card>

          {/* Line-by-Line Unified Diff Viewer */}
          <Card>
            <CardHeader
              title="Line-by-Line Unified Diff Viewer"
              subtitle="Inspect bit-for-bit additions and deletions between base and target source snapshots"
              icon={<GitCompare className="w-4 h-4 text-quorum-green" />}
            />
            <CardBody className="space-y-4">
              {/* File Selection Tabs */}
              <div className="flex flex-wrap gap-2 border-b border-brand-border pb-3">
                {activeComparison.diff_files.map((df, idx) => {
                  const isSelected = selectedDiffFileIndex === idx;
                  return (
                    <button
                      key={df.file_path}
                      onClick={() => setSelectedDiffFileIndex(idx)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-all flex items-center gap-2 ${
                        isSelected
                          ? 'bg-brand-panel-elevated text-white border border-brand-border-bright font-semibold'
                          : 'bg-brand-bg-deep/70 text-brand-muted hover:text-white border border-brand-border'
                      }`}
                    >
                      <span>{df.file_path}</span>
                      <span className="text-[10px] text-quorum-green-light">+{df.additions}</span>
                      <span className="text-[10px] text-quorum-red-light">-{df.deletions}</span>
                    </button>
                  );
                })}
              </div>

              {/* Code Diff Display */}
              {currentDiffFile ? (
                <div className="rounded-xl border border-brand-border bg-black/80 font-mono text-xs overflow-x-auto max-h-[500px] overflow-y-auto">
                  <div className="p-3 border-b border-brand-border/60 bg-brand-panel-elevated/40 flex items-center justify-between text-xs text-brand-muted">
                    <span>File: <strong className="text-white">{currentDiffFile.file_path}</strong> ({currentDiffFile.change_type})</span>
                    <span>+{currentDiffFile.additions} / -{currentDiffFile.deletions} lines</span>
                  </div>
                  <pre className="p-4 leading-relaxed whitespace-pre font-mono text-[11px]">
                    {currentDiffFile.diff_content.split('\n').map((line, i) => {
                      let lineClass = 'text-brand-muted';
                      if (line.startsWith('+++') || line.startsWith('---')) {
                        lineClass = 'text-brand-subtle font-bold';
                      } else if (line.startsWith('+')) {
                        lineClass = 'text-emerald-300 bg-emerald-950/30 block -mx-4 px-4';
                      } else if (line.startsWith('-')) {
                        lineClass = 'text-red-300 bg-red-950/30 block -mx-4 px-4';
                      } else if (line.startsWith('@@')) {
                        lineClass = 'text-cyan-400 font-bold block -mx-4 px-4 bg-cyan-950/20';
                      }
                      return (
                        <div key={i} className={lineClass}>
                          {line || ' '}
                        </div>
                      );
                    })}
                  </pre>
                </div>
              ) : (
                <p className="text-xs text-brand-muted">No files modified.</p>
              )}
            </CardBody>
          </Card>
        </div>
      )}

      {/* Comparison History Table */}
      <Card>
        <CardHeader
          title="Historical Source Sentinel Scans"
          subtitle="Persistent audit log of previous comparisons and human reviews"
          icon={<Clock className="w-4 h-4 text-quorum-green" />}
        />
        <CardBody>
          {comparisons.length === 0 ? (
            <p className="text-xs text-brand-muted">No previous source comparisons recorded in database.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left font-mono">
                <thead>
                  <tr className="border-b border-brand-border text-brand-muted">
                    <th className="py-2.5 pr-4">Date / Time</th>
                    <th className="py-2.5 pr-4">Target Commit</th>
                    <th className="py-2.5 pr-4">Type</th>
                    <th className="py-2.5 pr-4">Risk Level</th>
                    <th className="py-2.5 pr-4">Findings</th>
                    <th className="py-2.5 pr-4">Review Status</th>
                    <th className="py-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-border/40">
                  {comparisons.map((c) => {
                    const riskStyle = RISK_BADGE_STYLES[c.risk_level];
                    const reviewStyle = REVIEW_BADGE_STYLES[c.review_status];
                    const isCurrent = activeComparison?.id === c.id;
                    return (
                      <tr key={c.id} className={isCurrent ? 'bg-brand-panel-elevated/40' : 'hover:bg-brand-bg-deep/40'}>
                        <td className="py-3 pr-4 text-brand-muted">{formatRelativeTime(c.created_at)}</td>
                        <td className="py-3 pr-4 text-white font-semibold">{truncateHash(c.target_commit, 7, 7)}</td>
                        <td className="py-3 pr-4">
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-bg-deep border border-brand-border text-brand-subtle">
                            {c.is_fixture ? 'FIXTURE' : 'GIT'}
                          </span>
                        </td>
                        <td className="py-3 pr-4">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${riskStyle.bg} ${riskStyle.border} ${riskStyle.text}`}>
                            {c.risk_level}
                          </span>
                        </td>
                        <td className="py-3 pr-4 text-slate-300">
                          {c.findings_count} flagged
                        </td>
                        <td className="py-3 pr-4">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${reviewStyle.bg} ${reviewStyle.border} ${reviewStyle.text}`}>
                            {c.review_status}
                          </span>
                        </td>
                        <td className="py-3 text-right">
                          <button
                            onClick={() => handleSelectHistorical(c.id)}
                            className="text-quorum-green hover:underline text-xs cursor-pointer"
                          >
                            Inspect →
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
};
