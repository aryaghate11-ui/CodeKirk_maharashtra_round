import React, { useState, useEffect } from 'react';
import { PolicyComparator } from '../components/attackLab/PolicyComparator';
import { TamperSimulator } from '../components/attackLab/TamperSimulator';
import { SCENARIO_DEFINITIONS } from '../mock/scenarios';
import { ScenarioId, VerificationResult } from '../types';
import { api } from '../services/api';
import { Card, CardHeader } from '../components/common/Card';
import { BuilderEvidenceTable } from '../components/verification/BuilderEvidenceTable';
import { DecisionBadge } from '../components/common/Badge';
import { ApiErrorBanner } from '../components/common/ApiErrorBanner';
import {
  Crosshair,
  Server,
  Play,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Sparkles,
  RefreshCw,
  Terminal,
} from 'lucide-react';
import { PageId } from '../components/layout/Sidebar';

interface AttackLabPageProps {
  onNavigate?: (page: PageId) => void;
  onSelectRelease?: (releaseId: string) => void;
}

export const AttackLabPage: React.FC<AttackLabPageProps> = ({
  onNavigate,
  onSelectRelease,
}) => {
  const [selectedScenarioId, setSelectedScenarioId] = useState<ScenarioId>('valid');
  const [activePolicy, setActivePolicy] = useState<'2-of-3' | '3-of-3'>('2-of-3');
  const [verification, setVerification] = useState<VerificationResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState<Error | string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const scenario = SCENARIO_DEFINITIONS[selectedScenarioId] || SCENARIO_DEFINITIONS.valid;

  const runScenario = async (scenarioId: ScenarioId) => {
    setSelectedScenarioId(scenarioId);
    setIsLoading(true);
    setApiError(null);

    try {
      const res = await api.runDemoScenario(scenarioId, activePolicy);
      setVerification(res);
    } catch (err: any) {
      console.error('Failed to run backend demo scenario', err);
      setApiError(err);
      setVerification(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    runScenario(selectedScenarioId);
  }, [activePolicy]);

  const currentDecision = verification ? verification.decision : scenario.expectedDecision2of3;

  return (
    <div className="space-y-6">
      {apiError && (
        <ApiErrorBanner
          error={apiError}
          endpoint="/demo/verify"
          onRetry={() => runScenario(selectedScenarioId)}
        />
      )}

      {/* Page Header */}
      <div>
        <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-quorum-amber-bg border border-quorum-amber-border text-[11px] font-mono font-semibold text-quorum-amber-light mb-2">
          <Crosshair className="w-3.5 h-3.5 text-quorum-amber" />
          Interactive Verification Scenarios
        </div>
        <h2 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
          Test Quorum
        </h2>
        <p className="text-xs sm:text-sm text-brand-muted mt-1 leading-relaxed">
          Try three scenarios to see how Quorum handles trustworthy, tampered, and conflicting build evidence.
        </p>
      </div>

      {/* 3 Scenario Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Scenario 1: Valid Release */}
        <div
          className={`p-5 rounded-2xl border backdrop-blur-md transition-all flex flex-col justify-between ${
            selectedScenarioId === 'valid'
              ? 'bg-brand-panel-elevated/80 border-quorum-green-border shadow-glow-green/20 ring-1 ring-quorum-green/30'
              : 'bg-brand-panel/75 border-brand-border/70 hover:border-brand-border-bright'
          }`}
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-quorum-green-bg/80 border border-quorum-green-border/80 text-quorum-green-light font-bold">
                SCENARIO 1
              </span>
              <span className="text-[10px] font-mono text-quorum-green font-semibold">
                EXPECTED: VERIFIED
              </span>
            </div>

            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-quorum-green-bg/60 border border-quorum-green-border text-quorum-green backdrop-blur-sm">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-white tracking-tight">
                Valid Release
              </h3>
            </div>

            <p className="text-xs text-brand-muted leading-relaxed">
              All 3 independent builders compile from source and produce identical SHA-256 hashes matching the published candidate.
            </p>
          </div>

          <div className="pt-5">
            <button
              onClick={() => runScenario('valid')}
              disabled={isLoading && selectedScenarioId === 'valid'}
              className={`w-full py-2.5 px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                selectedScenarioId === 'valid'
                  ? 'bg-quorum-green text-black hover:bg-quorum-green-light shadow-glow-green'
                  : 'bg-brand-panel-elevated/80 backdrop-blur-sm text-brand-text hover:text-white border border-brand-border/70'
              }`}
            >
              {isLoading && selectedScenarioId === 'valid' ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Evaluating...</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Run Valid Scenario</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Scenario 2: Tampered Release */}
        <div
          className={`p-5 rounded-2xl border backdrop-blur-md transition-all flex flex-col justify-between ${
            selectedScenarioId === 'tampered'
              ? 'bg-brand-panel-elevated/80 border-quorum-red-border shadow-glow-red/20 ring-1 ring-quorum-red/30'
              : 'bg-brand-panel/75 border-brand-border/70 hover:border-brand-border-bright'
          }`}
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-quorum-red-bg/80 border border-quorum-red-border/80 text-quorum-red-light font-bold">
                SCENARIO 2
              </span>
              <span className="text-[10px] font-mono text-quorum-red font-semibold">
                EXPECTED: REJECTED
              </span>
            </div>

            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-quorum-red-bg/60 border border-quorum-red-border text-quorum-red backdrop-blur-sm">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-white tracking-tight">
                Tampered Binary
              </h3>
            </div>

            <p className="text-xs text-brand-muted leading-relaxed">
              The published binary was modified after build. Builders agree with each other, but reject the published file due to hash mismatch.
            </p>
          </div>

          <div className="pt-5">
            <button
              onClick={() => runScenario('tampered')}
              disabled={isLoading && selectedScenarioId === 'tampered'}
              className={`w-full py-2.5 px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                selectedScenarioId === 'tampered'
                  ? 'bg-quorum-red text-white hover:bg-quorum-red-light shadow-glow-red'
                  : 'bg-brand-panel-elevated/80 backdrop-blur-sm text-brand-text hover:text-white border border-brand-border/70'
              }`}
            >
              {isLoading && selectedScenarioId === 'tampered' ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Evaluating...</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Run Tampered Scenario</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Scenario 3: Conflicting Builder */}
        <div
          className={`p-5 rounded-2xl border backdrop-blur-md transition-all flex flex-col justify-between ${
            selectedScenarioId === 'conflict'
              ? 'bg-brand-panel-elevated/80 border-quorum-amber-border shadow-glow-amber/20 ring-1 ring-quorum-amber/30'
              : 'bg-brand-panel/75 border-brand-border/70 hover:border-brand-border-bright'
          }`}
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-quorum-amber-bg/80 border border-quorum-amber-border/80 text-quorum-amber-light font-bold">
                SCENARIO 3
              </span>
              <span className="text-[10px] font-mono text-quorum-amber font-semibold">
                EXPECTED: DISAGREEMENT
              </span>
            </div>

            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-quorum-amber-bg/60 border border-quorum-amber-border text-quorum-amber backdrop-blur-sm">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-white tracking-tight">
                Conflicting Builder
              </h3>
            </div>

            <p className="text-xs text-brand-muted leading-relaxed">
              One builder environment diverged and produced a differing hash from identical source. Quorum flags and isolates the divergence.
            </p>
          </div>

          <div className="pt-5">
            <button
              onClick={() => runScenario('conflict')}
              disabled={isLoading && selectedScenarioId === 'conflict'}
              className={`w-full py-2.5 px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                selectedScenarioId === 'conflict'
                  ? 'bg-quorum-amber text-black hover:bg-quorum-amber-light shadow-glow-amber'
                  : 'bg-brand-panel-elevated/80 backdrop-blur-sm text-brand-text hover:text-white border border-brand-border/70'
              }`}
            >
              {isLoading && selectedScenarioId === 'conflict' ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Evaluating...</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Run Conflict Scenario</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Scenario Execution Result Panel */}
      {verification && (
        <div
          className={`p-6 rounded-2xl border backdrop-blur-md transition-all ${
            currentDecision === 'ACCEPTED'
              ? 'bg-quorum-green-bg/40 border-quorum-green-border'
              : currentDecision === 'REJECTED'
              ? 'bg-quorum-red-bg/40 border-quorum-red-border'
              : 'bg-quorum-amber-bg/40 border-quorum-amber-border'
          }`}
        >
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
            <div className="space-y-2">
              <div className="flex items-center gap-2.5">
                <span className="text-[11px] font-mono text-brand-muted uppercase tracking-wider">
                  Scenario Outcome:
                </span>
                <DecisionBadge decision={currentDecision} size="lg" />
              </div>

              <h4 className="text-lg font-bold text-white tracking-tight">
                {currentDecision === 'ACCEPTED' && 'Release Verified: Consensus Reached'}
                {currentDecision === 'REJECTED' && 'Release Rejected: Candidate Hash Mismatch'}
                {currentDecision === 'CONFLICT' && 'Builders Disagree: Node Divergence Detected'}
              </h4>

              <p className="text-xs text-brand-text max-w-2xl leading-relaxed">
                {verification.explanation || scenario.description}
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-shrink-0">
              {onNavigate && onSelectRelease && (
                <button
                  onClick={() => {
                    onSelectRelease(verification.release.id);
                    onNavigate('verification');
                  }}
                  className="px-4 py-2.5 rounded-xl text-xs font-bold text-white bg-brand-panel-elevated/80 backdrop-blur-sm hover:bg-brand-panel border border-brand-border/70 transition-all flex items-center justify-center gap-1.5"
                >
                  <span>Inspect in Verifier</span>
                  <ArrowRight className="w-4 h-4 text-quorum-green" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Real Live Builder Evidence for this Scenario */}
      {verification && (
        <Card>
          <CardHeader
            title={`Evidence Under Scenario: ${scenario.name}`}
            subtitle="Real attestations evaluated by FastAPI consensus engine with Ed25519 signatures"
            icon={<Terminal className="w-4 h-4 text-quorum-green" />}
            badge={
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-brand-bg-deep/70 backdrop-blur-sm border border-brand-border text-white">
                Policy: {activePolicy}
              </span>
            }
          />
          <BuilderEvidenceTable
            attestations={verification.attestations}
            consensusHash={verification.consensusHash}
            conflictDetected={verification.conflictDetected}
          />
        </Card>
      )}

      {/* Collapsible Advanced Threat Simulator & Policy Comparator Accordion */}
      <div className="rounded-xl border border-brand-border/70 bg-brand-panel/75 backdrop-blur-md overflow-hidden">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="w-full p-4 flex items-center justify-between text-left hover:bg-brand-panel-elevated/50 transition-colors"
        >
          <div className="space-y-0.5">
            <span className="text-xs font-bold text-white block">
              Advanced Details: Threat Simulator & Policy Sensitivity
            </span>
            <span className="text-[11px] text-brand-muted block">
              Inspect visual attack injection paths and test 2-of-3 vs 3-of-3 quorum policy trade-offs.
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-xs font-mono text-brand-muted">
            <span>{showAdvanced ? 'Hide Advanced' : 'Show Advanced'}</span>
            {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </button>

        {showAdvanced && (
          <div className="p-4 pt-2 border-t border-brand-border/60 space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
              <TamperSimulator scenario={scenario} />
              <PolicyComparator
                scenarioId={selectedScenarioId}
                agreement={verification ? verification.agreement : 2}
                totalBuilders={verification ? verification.totalBuilders : 3}
                decision2of3={scenario.expectedDecision2of3}
                decision3of3={scenario.expectedDecision3of3}
                activePolicy={activePolicy}
                onTogglePolicy={setActivePolicy}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
