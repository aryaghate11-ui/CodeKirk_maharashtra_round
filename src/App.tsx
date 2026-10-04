import React, { useState, useEffect } from 'react';
import { AppShell } from './components/layout/AppShell';
import { PageId } from './components/layout/Sidebar';
import { DashboardPage } from './pages/DashboardPage';
import { ReleaseVerificationPage } from './pages/ReleaseVerificationPage';
import { BuildersPage } from './pages/BuildersPage';
import { AttackLabPage } from './pages/AttackLabPage';
import { AuditHistoryPage } from './pages/AuditHistoryPage';
import { SourceSentinelPage } from './pages/SourceSentinelPage';
import { QuorumRelayPage } from './pages/QuorumRelayPage';
import { LivingVerificationPage } from './pages/LivingVerificationPage';
import { SystemStats } from './types';
import { api } from './services/api';

export const App: React.FC = () => {
  const [currentPage, setCurrentPage] = useState<PageId>('dashboard');
  const [selectedReleaseId, setSelectedReleaseId] = useState<string>('');
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchStats = async () => {
    try {
      setIsRefreshing(true);
      const data = await api.getSystemStats();
      setStats(data);
    } catch (e) {
      console.error('Failed to fetch system stats', e);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const handleRefresh = () => {
    fetchStats();
  };

  const handleSelectRelease = (releaseId: string) => {
    setSelectedReleaseId(releaseId);
    setCurrentPage('verification');
  };

  const handleLaunchAttackDemo = () => {
    setCurrentPage('attack-lab');
  };

  return (
    <AppShell
      currentPage={currentPage}
      onNavigate={setCurrentPage}
      stats={stats}
      onRefresh={handleRefresh}
      isRefreshing={isRefreshing}
      onLaunchAttackDemo={handleLaunchAttackDemo}
    >
      {currentPage === 'dashboard' && (
        <DashboardPage
          onNavigate={setCurrentPage}
          onSelectRelease={handleSelectRelease}
        />
      )}

      {currentPage === 'verification' && (
        <ReleaseVerificationPage selectedReleaseId={selectedReleaseId} onNavigate={setCurrentPage} />
      )}

      {currentPage === 'builders' && <BuildersPage />}

      {currentPage === 'attack-lab' && <AttackLabPage />}

      {currentPage === 'audit' && <AuditHistoryPage />}

      {currentPage === 'sentinel' && <SourceSentinelPage />}
      {currentPage === 'relay' && <QuorumRelayPage />}
      {currentPage === 'living' && <LivingVerificationPage />}
    </AppShell>
  );
};

export default App;
