import React, { useState } from 'react';
import { ScenarioSelector } from '../components/attackLab/ScenarioSelector';
import { PolicyComparator } from '../components/attackLab/PolicyComparator';
import { TamperSimulator } from '../components/attackLab/TamperSimulator';
import { SCENARIO_DEFINITIONS } from '../mock/scenarios';
import { ScenarioId } from '../types';
import { getMockVerificationForScenario } from '../mock/scenarios';
import { Card, CardHeader, CardBody } from '../components/common/Card';
import { BuilderEvidenceTable } from '../components/verification/BuilderEvidenceTable';
import { DecisionBadge } from '../components/common/Badge';
import { Crosshair, ShieldAlert, Sparkles, Terminal } from 'lucide-react';

export const AttackLabPage: React.FC = () => {
  const [selectedScenarioId, setSelectedScenarioId] = useState<ScenarioId>('conflict');
  const [activePolicy, setActivePolicy] = useState<'2-of-3' | '3-of-3'>('2-of-3');

  const scenario = SCENARIO_DEFINITIONS[selectedScenarioId] || SCENARIO_DEFINITIONS.conflict;
  const verification = getMockVerificationForScenario(selectedScenarioId, activePolicy);

  return (
    <div className="space-y-6">
      {/* Attack Lab Banner */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-brand-panel via-quorum-amber-bg/30 to-brand-panel border border-brand-border-bright shadow-panel">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5 max-w-3xl">
            <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-quorum-amber-bg border border-quorum-amber-border text-[11px] font-mono font-semibold text-quorum-amber-light">
              <Crosshair className="w-3.5 h-3.5 text-quorum-amber" />
              Interactive Supply-Chain Threat Simulation
            </div>
            <h2 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
              Security & Attack Lab
            </h2>
            <p className="text-xs sm:text-sm text-brand-muted leading-relaxed">
              Experience why traditional centralized build pipelines fail against advanced supply-chain compromises (e.g. SolarWinds Orion build server injection, XZ Utils upstream sabotage). Select real-world threat vectors below to observe how Quorum isolates rogue nodes and enforces decentralized consensus.
            </p>
          </div>

          <div className="flex-shrink-0">
            <div className="p-3 rounded-xl bg-brand-bg-deep border border-brand-border text-right space-y-1">
              <span className="text-[10px] font-mono text-brand-subtle uppercase block">
                Active Simulation Decision
              </span>
              <DecisionBadge decision={verification.decision} size="lg" />
            </div>
          </div>
        </div>
      </div>

      {/* Scenario Selector Tabs */}
      <div className="space-y-2">
        <span className="text-xs font-mono text-brand-muted uppercase tracking-wider block">
          Select Threat Scenario to Test:
        </span>
        <ScenarioSelector
          selectedScenario={selectedScenarioId}
          onSelectScenario={setSelectedScenarioId}
        />
      </div>

      {/* Two Column Grid: Visual Attack Flow (Left) + Policy Sensitivity Comparator (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        <TamperSimulator scenario={scenario} />

        <PolicyComparator
          scenarioId={selectedScenarioId}
          agreement={verification.agreement}
          totalBuilders={verification.totalBuilders}
          decision2of3={scenario.expectedDecision2of3}
          decision3of3={scenario.expectedDecision3of3}
          activePolicy={activePolicy}
          onTogglePolicy={setActivePolicy}
        />
      </div>

      {/* Live Builder Evidence Under Selected Scenario */}
      <Card>
        <CardHeader
          title={`Simulated Builder Evidence — ${scenario.name}`}
          subtitle="Real-time cryptographic attestation table showing hash match or discrepancy"
          icon={<Terminal className="w-4 h-4 text-quorum-green" />}
          badge={
            <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-brand-bg-deep border border-brand-border text-white">
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
    </div>
  );
};
