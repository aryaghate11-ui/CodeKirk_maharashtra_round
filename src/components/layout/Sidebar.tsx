import React from 'react';
import {
  LayoutDashboard,
  ShieldCheck,
  Server,
  Crosshair,
  ScrollText,
  Radio,
  ExternalLink,
  Lock,
  GitCompare,
} from 'lucide-react';
import { QuorumLogo } from '../common/QuorumLogo';
import { CopyButton } from '../common/CopyButton';
import { truncateAddress } from '../../lib/utils';
import { SystemStats } from '../../types';

export type PageId = 'dashboard' | 'verification' | 'builders' | 'attack-lab' | 'audit' | 'sentinel' | 'relay';

interface SidebarProps {
  currentPage: PageId;
  onNavigate: (page: PageId) => void;
  stats: SystemStats | null;
  isOpen?: boolean;
  onClose?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentPage,
  onNavigate,
  stats,
  isOpen = false,
  onClose,
}) => {
  const navItems = [
    {
      id: 'dashboard' as PageId,
      label: 'Dashboard',
      icon: LayoutDashboard,
      description: 'Overview & key metrics',
    },
    {
      id: 'verification' as PageId,
      label: 'Verify a Release',
      icon: ShieldCheck,
      description: 'Check artifact consensus',
    },
    {
      id: 'sentinel' as PageId,
      label: 'Source Sentinel',
      icon: GitCompare,
      description: 'Pre-release source security',
    },
    {
      id: 'builders' as PageId,
      label: 'Builders',
      icon: Server,
      description: 'Participating build nodes',
    },
    {
      id: 'attack-lab' as PageId,
      label: 'Test Quorum',
      icon: Crosshair,
      description: 'Simulate tamper scenarios',
    },
    {
      id: 'audit' as PageId,
      label: 'Audit History',
      icon: ScrollText,
      description: 'Cryptographic event trail',
    },
    {
      id: 'relay' as PageId,
      label: 'Quorum Relay',
      icon: Radio,
      description: 'Artifact witness monitoring',
    },
  ];

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          onClick={onClose}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
        />
      )}

      <aside
        className={`fixed top-0 bottom-0 left-0 z-50 w-64 bg-brand-panel/75 backdrop-blur-md border-r border-brand-border/70 flex flex-col transition-transform duration-200 ease-in-out lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand Header */}
        <div className="p-5 border-b border-brand-border/60">
          <QuorumLogo size={36} showText showTagline />
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-1.5 overflow-y-auto">
          <div className="px-3 py-1.5 text-[11px] font-semibold text-brand-subtle uppercase tracking-wider">
            Navigation
          </div>

          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentPage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  onNavigate(item.id);
                  onClose?.();
                }}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-left transition-all duration-150 group ${
                  isActive
                    ? 'bg-brand-panel-elevated/85 text-white border border-brand-border-bright font-medium shadow-sm backdrop-blur-sm'
                    : 'text-brand-muted hover:text-brand-text hover:bg-brand-panel-elevated/40'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Icon
                    className={`w-4 h-4 flex-shrink-0 transition-colors ${
                      isActive
                        ? 'text-quorum-green'
                        : 'text-brand-muted group-hover:text-brand-text'
                    }`}
                  />
                  <div className="truncate">
                    <span className="text-sm block">{item.label}</span>
                    <span className="text-[10px] text-brand-subtle block truncate group-hover:text-brand-muted transition-colors">
                      {item.description}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </nav>

        {/* Bottom Prototype Environment Info Card */}
        <div className="p-4 border-t border-brand-border/60 space-y-3">
          <div className="rounded-lg bg-brand-bg-deep/65 backdrop-blur-sm border border-brand-border/60 p-3 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-brand-muted flex items-center gap-1.5 text-[11px]">
                <Radio className="w-3.5 h-3.5 text-quorum-green" />
                Environment
              </span>
              <span className="font-mono text-[11px] text-quorum-green-light font-medium">
                Prototype · Local
              </span>
            </div>

            <div className="flex items-center justify-between text-xs pt-1.5 border-t border-brand-border/50 text-[11px]">
              <span className="text-brand-muted flex items-center gap-1.5">
                <Lock className="w-3 h-3 text-brand-subtle" />
                Backend
              </span>
              <span className="font-mono text-brand-text">
                FastAPI + SQLite
              </span>
            </div>

            <div className="flex items-center justify-between text-xs pt-1 border-t border-brand-border/50 text-[11px]">
              <span className="text-brand-muted">Crypto</span>
              <span className="font-mono text-brand-subtle">
                Ed25519 / SHA-256
              </span>
            </div>
          </div>

          <div className="px-1 text-[11px] text-brand-subtle flex items-center justify-between">
            <span>Decentralized Build Verifier</span>
            <span className="text-brand-muted font-mono text-[10px]">
              v1.0.0-hackathon
            </span>
          </div>
        </div>
      </aside>
    </>
  );
};
