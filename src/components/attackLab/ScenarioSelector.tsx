import React from 'react';
import { ScenarioId, ScenarioDefinition } from '../../types';
import { SCENARIO_DEFINITIONS } from '../../mock/scenarios';
import { ShieldCheck, GitFork, KeyRound, FileWarning, ShieldAlert } from 'lucide-react';

interface ScenarioSelectorProps {
  selectedScenario: ScenarioId;
  onSelectScenario: (id: ScenarioId) => void;
}

export const ScenarioSelector: React.FC<ScenarioSelectorProps> = ({
  selectedScenario,
  onSelectScenario,
}) => {
  const scenarioIcons: Record<ScenarioId, React.ReactNode> = {
    valid: <ShieldCheck className="w-4 h-4 text-quorum-green" />,
    conflict: <GitFork className="w-4 h-4 text-quorum-amber" />,
    tampered: <ShieldAlert className="w-4 h-4 text-quorum-red" />,
    invalidSignature: <KeyRound className="w-4 h-4 text-quorum-red" />,
    auditTampering: <FileWarning className="w-4 h-4 text-purple-400" />,
  };

  const scenarios: ScenarioDefinition[] = [
    SCENARIO_DEFINITIONS.valid,
    SCENARIO_DEFINITIONS.conflict,
    SCENARIO_DEFINITIONS.tampered,
    SCENARIO_DEFINITIONS.invalidSignature,
    SCENARIO_DEFINITIONS.auditTampering,
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
      {scenarios.map((sc) => {
        const isSelected = selectedScenario === sc.id;
        return (
          <button
            key={sc.id}
            onClick={() => onSelectScenario(sc.id)}
            className={`p-3.5 rounded-xl border text-left transition-all duration-200 flex flex-col justify-between ${
              isSelected
                ? 'bg-brand-panel-elevated border-brand-border-bright ring-1 ring-quorum-green/30 shadow-panel'
                : 'bg-brand-panel/60 border-brand-border hover:bg-brand-panel-elevated/40 hover:border-brand-border-bright'
            }`}
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="p-1.5 rounded-lg bg-brand-bg-deep border border-brand-border">
                  {scenarioIcons[sc.id]}
                </div>
                <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-brand-bg-deep border border-brand-border text-brand-muted">
                  {sc.badge}
                </span>
              </div>

              <div>
                <h4
                  className={`text-xs font-bold tracking-tight line-clamp-1 ${
                    isSelected ? 'text-white' : 'text-slate-200'
                  }`}
                >
                  {sc.name.split('—')[0].trim()}
                </h4>
                <p className="text-[11px] text-brand-muted line-clamp-2 mt-1">
                  {sc.subtitle}
                </p>
              </div>
            </div>

            <div className="mt-3 pt-2 border-t border-brand-border/40 text-[10px] font-mono text-brand-subtle flex items-center justify-between">
              <span>Threat Sim</span>
              <span className={isSelected ? 'text-quorum-green-light font-semibold' : ''}>
                {isSelected ? 'ACTIVE' : 'SELECT'}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
};
