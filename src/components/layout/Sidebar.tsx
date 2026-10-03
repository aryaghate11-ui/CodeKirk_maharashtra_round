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
} from 'lucide-react';
import { QuorumLogo } from '../common/QuorumLogo';
import { CopyButton } from '../common/CopyButton';
import { truncateAddress } from '../../lib/utils';
import { SystemStats } from '../../types';

export type PageId = 'dashboard' | 'verification' | 'builders' | 'attack-lab' | 'audit';

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
      description: 'System overview & metrics',
    },
    {
      id: 'verification' as PageId,
      label: 'Release Verification',
      icon: ShieldCheck,
      description: 'Builder consensus & evidence',
      badge: 'Live',
    },
    {
      id: 'builders' as PageId,
      label: 'Builders Network',
      icon: Server,
      description: 'Independent execution nodes',
    },
    {
      id: 'attack-lab' as PageId,
      label: 'Attack Lab',
      icon: Crosshair,
      description: 'Interactive exploit simulator',
      badge: 'Interactive',
    },
    {
      id: 'audit' as PageId,
      label: 'Audit History',
      icon: ScrollText,
      description: 'On-chain cryptographic logs',
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
        className={`fixed top-0 bottom-0 left-0 z-50 w-64 bg-brand-panel/95 backdrop-blur-xl border-r border-brand-border flex flex-col transition-transform duration-200 ease-in-out lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand Header */}
        <div className="p-5 border-b border-brand-border/70">
          <QuorumLogo size={36} showText showTagline />
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-1.5 overflow-y-auto">
          <div className="px-3 py-1.5 text-[11px] font-semibold text-brand-subtle uppercase tracking-wider">
            Verification Platform
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
                    ? 'bg-brand-panel-elevated text-white border border-brand-border-bright font-medium shadow-sm'
                    : 'text-brand-muted hover:text-brand-text hover:bg-brand-panel-elevated/50'
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

                {item.badge && (
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-medium ${
                      item.badge === 'Interactive'
                        ? 'bg-quorum-amber-bg text-quorum-amber border border-quorum-amber-border'
                        : 'bg-quorum-green-bg text-quorum-green-light border border-quorum-green-border'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Bottom Network & Smart Contract Card */}
        <div className="p-4 border-t border-brand-border/70 space-y-3">
          <div className="rounded-lg bg-brand-bg-deep/70 border border-brand-border p-3 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-brand-muted flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-quorum-green animate-pulse" />
                Network
              </span>
              <span className="font-mono text-[11px] text-brand-text font-medium">
                Sepolia Testnet
              </span>
            </div>

            <div className="flex items-center justify-between text-xs pt-1 border-t border-brand-border/50">
              <span className="text-brand-muted flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-brand-subtle" />
                Contract
              </span>
              <div className="flex items-center gap-1">
                <span className="font-mono text-[11px] text-brand-text">
                  {truncateAddress(
                    stats?.contractAddress ||
                      '0x71C941D29b19e2B2A346C89b14283D05e83aF89E'
                  )}
                </span>
                <CopyButton
                  text={
                    stats?.contractAddress ||
                    '0x71C941D29b19e2B2A346C89b14283D05e83aF89E'
                  }
                  title="Copy contract address"
                />
              </div>
            </div>
          </div>

          <div className="px-1 text-[11px] text-brand-subtle flex items-center justify-between">
            <span>Decentralized Supply Chain</span>
            <span className="flex items-center gap-1 text-brand-muted hover:text-brand-text cursor-pointer">
              Docs <ExternalLink className="w-2.5 h-2.5" />
            </span>
          </div>
        </div>
      </aside>
    </>
  );
};
