import React from 'react';
import { Menu, Activity, ShieldCheck, Database, RefreshCw, Zap } from 'lucide-react';
import { PageId } from './Sidebar';
import { SystemStats } from '../../types';
import { api } from '../../services/api';

interface HeaderProps {
  currentPage: PageId;
  onOpenMobileMenu: () => void;
  stats: SystemStats | null;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  onLaunchAttackDemo?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentPage,
  onOpenMobileMenu,
  stats,
  onRefresh,
  isRefreshing = false,
  onLaunchAttackDemo,
}) => {
  const pageTitles: Record<PageId, { title: string; subtitle: string }> = {
    dashboard: {
      title: 'Verification Overview',
      subtitle: 'Real-time telemetry and consensus metrics across all monitored open-source releases.',
    },
    verification: {
      title: 'Release Verification',
      subtitle: 'Deterministic build parity and cryptographic attestation consensus across independent builders.',
    },
    builders: {
      title: 'Independent Builders Network',
      subtitle: 'Isolated multi-environment execution nodes performing uncoordinated source builds.',
    },
    'attack-lab': {
      title: 'Security & Attack Lab',
      subtitle: 'Simulate supply-chain threats: tampered binaries, builder divergence, forged signatures, and audit corruption.',
    },
    audit: {
      title: 'Audit & Provenance Trail',
      subtitle: 'Immutable cryptographic ledger of build attestations, hashes, and smart contract state.',
    },
  };

  const currentMeta = pageTitles[currentPage];

  return (
    <header className="sticky top-0 z-30 bg-brand-bg/80 backdrop-blur-xl border-b border-brand-border/80 px-4 sm:px-8 py-4 transition-all">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Left: Mobile hamburger & Page Title */}
        <div className="flex items-center gap-3">
          <button
            onClick={onOpenMobileMenu}
            className="lg:hidden p-2 rounded-lg text-brand-muted hover:text-white hover:bg-brand-panel-elevated border border-brand-border"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-lg sm:text-xl font-bold tracking-tight text-white flex items-center gap-2">
                {currentMeta.title}
              </h1>
              {currentPage === 'verification' && (
                <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-quorum-green-bg text-quorum-green-light border border-quorum-green-border">
                  <ShieldCheck className="w-3 h-3" />
                  Primary Verifier
                </span>
              )}
            </div>
            <p className="text-xs text-brand-muted mt-0.5 line-clamp-1 max-w-xl">
              {currentMeta.subtitle}
            </p>
          </div>
        </div>

        {/* Right: Controls & Network Status */}
        <div className="flex items-center gap-2.5 flex-wrap sm:flex-nowrap">
          {/* Quick Attack Lab Demo Trigger */}
          {currentPage !== 'attack-lab' && onLaunchAttackDemo && (
            <button
              onClick={onLaunchAttackDemo}
              className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-quorum-amber-light bg-quorum-amber-bg/70 hover:bg-quorum-amber-bg border border-quorum-amber-border transition-colors shadow-sm"
            >
              <Zap className="w-3.5 h-3.5 text-quorum-amber" />
              <span>Simulate Attack</span>
            </button>
          )}

          {/* Backend Connection Badge */}
          <div
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs border ${
              api.isStrictBackendMode() && !stats?.isBackendConnected
                ? 'border-quorum-red-border bg-quorum-red-bg/50 text-quorum-red-light'
                : 'border-brand-border bg-brand-panel/90 text-brand-muted'
            }`}
            title={
              stats?.isBackendConnected
                ? `Connected to FastAPI Backend at ${import.meta.env.VITE_API_URL || 'http://localhost:8000'} (Latency: ${stats.backendLatencyMs}ms)`
                : api.isStrictBackendMode()
                ? 'Strict Backend Mode: Mock fallback is disabled. Backend is currently offline.'
                : 'Running in Self-Contained High-Fidelity Mock Mode (Ready for FastAPI integration)'
            }
          >
            <Database className="w-3.5 h-3.5 text-brand-subtle" />
            <span className="hidden sm:inline">Engine:</span>
            <span
              className={`font-mono text-[11px] font-medium ${
                stats?.isBackendConnected
                  ? 'text-quorum-green'
                  : api.isStrictBackendMode()
                  ? 'text-quorum-red-light font-bold'
                  : 'text-brand-text'
              }`}
            >
              {stats?.isBackendConnected
                ? 'FastAPI Live'
                : api.isStrictBackendMode()
                ? 'FastAPI Offline (Strict)'
                : 'Verified Mock'}
            </span>
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                stats?.isBackendConnected
                  ? 'bg-quorum-green animate-pulse'
                  : api.isStrictBackendMode()
                  ? 'bg-quorum-red animate-ping'
                  : 'bg-quorum-amber'
              }`}
            />
          </div>

          {/* Network Indicator */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-lg text-xs border border-brand-border bg-brand-panel/90 text-brand-muted">
            <span className="w-2 h-2 rounded-full bg-quorum-green shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
            <span className="font-medium text-brand-text">Sepolia</span>
            <span className="hidden xl:inline text-brand-subtle font-mono text-[11px]">
              #5.8M
            </span>
          </div>

          {/* Refresh Action */}
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              className="p-1.5 rounded-lg text-brand-muted hover:text-white hover:bg-brand-panel-elevated border border-brand-border transition-all disabled:opacity-50"
              title="Refresh telemetry"
              aria-label="Refresh telemetry"
            >
              <RefreshCw
                className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-quorum-green' : ''}`}
              />
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
