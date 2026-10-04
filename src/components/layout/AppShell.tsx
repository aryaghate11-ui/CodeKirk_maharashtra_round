import React, { useState } from 'react';
import { Sidebar, PageId } from './Sidebar';
import { Header } from './Header';
import { BlockDriftBackground } from '../background/BlockDriftBackground';
import { SystemStats } from '../../types';

interface AppShellProps {
  currentPage: PageId;
  onNavigate: (page: PageId) => void;
  stats: SystemStats | null;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  onLaunchAttackDemo?: () => void;
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({
  currentPage,
  onNavigate,
  stats,
  onRefresh,
  isRefreshing,
  onLaunchAttackDemo,
  children,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-brand-bg text-brand-text relative overflow-x-hidden">
      {/* Official Originkit 3D Moving Block Drift Background (Behind all UI) */}
      <BlockDriftBackground speed={6} clearCentre={3} />

      {/* Foreground Application Structure */}
      <div className="relative z-10 flex min-h-screen">
        {/* Left Sidebar */}
        <Sidebar
          currentPage={currentPage}
          onNavigate={onNavigate}
          stats={stats}
          isOpen={mobileMenuOpen}
          onClose={() => setMobileMenuOpen(false)}
        />

        {/* Right Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0 lg:pl-64">
          <Header
            currentPage={currentPage}
            onOpenMobileMenu={() => setMobileMenuOpen(true)}
            stats={stats}
            onRefresh={onRefresh}
            isRefreshing={isRefreshing}
            onLaunchAttackDemo={onLaunchAttackDemo}
          />

          <main className="flex-1 p-4 sm:p-8 max-w-7xl w-full mx-auto animate-fade-in">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
};
