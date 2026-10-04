import React, { useEffect, useState } from 'react';
import {
  ChevronDown,
  Crosshair,
  GitCompare,
  LayoutDashboard,
  Radio,
  RefreshCcw,
  ScrollText,
  Server,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import { QuorumLogo } from '../common/QuorumLogo';
import { SystemStats } from '../../types';

export type PageId = 'dashboard' | 'verification' | 'builders' | 'attack-lab' | 'audit' | 'sentinel' | 'relay' | 'living';

interface SidebarProps {
  currentPage: PageId;
  onNavigate: (page: PageId) => void;
  stats: SystemStats | null;
  isOpen?: boolean;
  onClose?: () => void;
}

const primaryItems = [
  { id: 'dashboard' as PageId, label: 'Overview', icon: LayoutDashboard },
  { id: 'verification' as PageId, label: 'Verify a Release', icon: ShieldCheck },
];

const trustItems = [
  { id: 'sentinel' as PageId, label: 'Source Sentinel', icon: GitCompare },
  { id: 'relay' as PageId, label: 'Quorum Relay', icon: Radio },
  { id: 'living' as PageId, label: 'Living Verification', icon: RefreshCcw },
];

const toolItems = [
  { id: 'builders' as PageId, label: 'Builders', icon: Server },
  { id: 'audit' as PageId, label: 'Audit History', icon: ScrollText },
  { id: 'attack-lab' as PageId, label: 'Attack Lab', icon: Crosshair },
];

export const Sidebar: React.FC<SidebarProps> = ({
  currentPage,
  onNavigate,
  stats,
  isOpen = false,
  onClose,
}) => {
  const [toolsOpen, setToolsOpen] = useState(toolItems.some((item) => item.id === currentPage));

  useEffect(() => {
    if (toolItems.some((item) => item.id === currentPage)) setToolsOpen(true);
  }, [currentPage]);

  const renderItems = (items: typeof primaryItems) => items.map((item) => {
    const Icon = item.icon;
    const isActive = currentPage === item.id;
    return (
      <button
        key={item.id}
        onClick={() => {
          onNavigate(item.id);
          onClose?.();
        }}
        className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-left text-sm transition-all duration-150 ${
          isActive
            ? 'bg-brand-panel-elevated/90 text-white border border-brand-border-bright shadow-sm'
            : 'text-brand-muted border border-transparent hover:text-brand-text hover:bg-brand-panel-elevated/40'
        }`}
      >
        <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-quorum-green' : 'text-brand-subtle'}`} />
        <span className="font-medium truncate">{item.label}</span>
        {isActive && <span className="w-1.5 h-1.5 ml-auto rounded-full bg-quorum-green" />}
      </button>
    );
  });

  return (
    <>
      {isOpen && <div onClick={onClose} className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden" />}

      <aside className={`fixed top-0 bottom-0 left-0 z-50 w-60 bg-brand-panel/80 backdrop-blur-md border-r border-brand-border/70 flex flex-col transition-transform duration-200 ease-in-out lg:translate-x-0 ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="px-5 py-5 border-b border-brand-border/60">
          <QuorumLogo size={34} showText showTagline />
        </div>

        <nav className="flex-1 px-3 py-4 overflow-y-auto space-y-5">
          <section>
            <p className="px-3 mb-1.5 text-[10px] font-semibold text-brand-subtle uppercase tracking-[0.16em]">Start here</p>
            <div className="space-y-1">{renderItems(primaryItems)}</div>
          </section>

          <section>
            <p className="px-3 mb-1.5 text-[10px] font-semibold text-brand-subtle uppercase tracking-[0.16em]">Trust layers</p>
            <div className="space-y-1">{renderItems(trustItems)}</div>
          </section>

          <section className="border-t border-brand-border/50 pt-3">
            <button
              onClick={() => setToolsOpen((open) => !open)}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-brand-muted hover:text-white transition-colors"
              aria-expanded={toolsOpen}
            >
              <Wrench className="w-3.5 h-3.5" />
              Evidence & tools
              <ChevronDown className={`w-3.5 h-3.5 ml-auto transition-transform ${toolsOpen ? 'rotate-180' : ''}`} />
            </button>
            {toolsOpen && <div className="space-y-1 mt-1">{renderItems(toolItems)}</div>}
          </section>
        </nav>
      </aside>
    </>
  );
};
