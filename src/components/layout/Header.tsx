import React, { useState } from 'react';
import { Lock, Menu, RefreshCw, Unlock } from 'lucide-react';
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
  onLaunchAttackDemo: _onLaunchAttackDemo,
}) => {
  const [adminUnlocked, setAdminUnlocked] = useState(api.isAdminUnlocked());
  const [authBusy, setAuthBusy] = useState(false);

  const toggleAdmin = async () => {
    if (adminUnlocked) {
      api.lockAdmin();
      setAdminUnlocked(false);
      return;
    }
    const token = window.prompt('Enter the Quorum admin token shown in the backend terminal:');
    if (!token) return;
    try {
      setAuthBusy(true);
      await api.unlockAdmin(token);
      setAdminUnlocked(true);
    } catch (error: any) {
      window.alert(error.message || 'Administrator authorization failed.');
    } finally {
      setAuthBusy(false);
    }
  };
  const pageTitles: Record<PageId, { title: string; subtitle: string }> = {
    dashboard: {
      title: 'Can we trust this software?',
      subtitle: 'Quorum compares signed build evidence from multiple builders before a software release is trusted.',
    },
    verification: {
      title: 'Verify a Release',
      subtitle: 'Compare signed builder evidence to confirm an artifact matches source code.',
    },
    builders: {
      title: 'Builders',
      subtitle: 'Different builders independently submit signed evidence about the same software release.',
    },
    'attack-lab': {
      title: 'Test Quorum',
      subtitle: 'Try three scenarios to see how Quorum handles trustworthy, tampered, and conflicting build evidence.',
    },
    audit: {
      title: 'Audit History',
      subtitle: 'Review the sequence of verification events recorded by the application.',
    },
    sentinel: {
      title: 'Source Sentinel',
      subtitle: 'Detect suspicious modifications, backdoors, and dependency changes in source code before release verification.',
    },
    relay: {
      title: 'Quorum Relay',
      subtitle: 'Post-verification independent witness monitoring to detect artifact tampering or mirror substitution.',
    },
    living: {
      title: 'Living Verification',
      subtitle: 'Re-evaluate historical release trust when a builder key is compromised or reinstated.',
    },
  };

  const currentMeta = pageTitles[currentPage];

  return (
    <header className="sticky top-0 z-30 bg-brand-bg/80 backdrop-blur-md border-b border-brand-border/70 px-4 sm:px-8 py-3.5 transition-all">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Left: Mobile hamburger & Page Title */}
        <div className="flex items-center gap-3">
          <button
            onClick={onOpenMobileMenu}
            className="lg:hidden p-2 rounded-lg text-brand-muted hover:text-white hover:bg-brand-panel-elevated/80 border border-brand-border/80 backdrop-blur-sm"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-lg sm:text-xl font-bold tracking-tight text-white flex items-center gap-2">
                {currentMeta.title}
              </h1>
            </div>
            <p className="text-xs text-brand-muted mt-0.5 line-clamp-1 max-w-xl">
              {currentMeta.subtitle}
            </p>
          </div>
        </div>

        {/* Right: Controls & Real Backend Status */}
        <div className="flex items-center gap-2.5 flex-wrap sm:flex-nowrap">
          <button
            onClick={toggleAdmin}
            disabled={authBusy}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-50 ${adminUnlocked ? 'border-quorum-green-border bg-quorum-green-bg/50 text-quorum-green-light' : 'border-brand-border bg-brand-panel-elevated/70 text-brand-muted hover:text-white'}`}
            title={adminUnlocked ? 'Administrator actions are unlocked for this tab. Click to lock.' : 'Unlock protected administrator actions.'}
          >
            {adminUnlocked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
            {adminUnlocked ? 'Admin unlocked' : 'Admin locked'}
          </button>
          {/* Backend Connection Indicator */}
          <div
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border backdrop-blur-sm ${
              stats?.isBackendConnected
                ? 'border-quorum-green-border bg-quorum-green-bg/50 text-quorum-green-light'
                : 'border-quorum-red-border bg-quorum-red-bg/40 text-quorum-red-light'
            }`}
            title={
              stats?.isBackendConnected
                ? 'Connected to the FastAPI verification backend (SQLite)'
                : 'Backend connection unavailable. Please check that FastAPI is running.'
            }
          >
            <span
              className={`w-2 h-2 rounded-full ${
                stats?.isBackendConnected
                  ? 'bg-quorum-green animate-pulse'
                  : 'bg-quorum-red'
              }`}
            />
            <span className="font-medium">
              {stats?.isBackendConnected ? 'Connected' : 'Disconnected'}
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
