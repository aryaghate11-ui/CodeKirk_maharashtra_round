"""Shared, deterministic consumer policy evaluation (no network or database)."""
from collections import Counter
from typing import Literal
from pydantic import BaseModel, Field, model_validator


class QuorumPolicy(BaseModel):
    mode: Literal['k-of-n', 'majority', 'all'] = 'k-of-n'
    threshold: int = Field(default=2, ge=1, le=20)
    expected_builders: int = Field(default=3, ge=1, le=20)
    minimum_operators: int = Field(default=2, ge=1, le=20)
    reject_on_conflict: bool = True

    @model_validator(mode='after')
    def validate_bounds(self):
        if self.mode == 'majority':
            self.threshold = self.expected_builders // 2 + 1
        elif self.mode == 'all':
            self.threshold = self.expected_builders
        if self.threshold > self.expected_builders or self.minimum_operators > self.expected_builders:
            raise ValueError('Threshold and minimum operators must not exceed expected builders')
        return self


def decide(builders: list[dict], candidate: str, policy: QuorumPolicy) -> dict:
    ids = [b['id'] for b in builders]
    if len(ids) != len(set(ids)):
        raise ValueError('Duplicate builder identity')
    keys = [b['public_key'] for b in builders if 'public_key' in b]
    if len(keys) != len(set(keys)):
        raise ValueError('Duplicate signing key')
    counts = Counter(b['artifact_sha256'] for b in builders)
    consensus, matching = counts.most_common(1)[0] if counts else (None, 0)
    operators = len({b['operator'] for b in builders if b['artifact_sha256'] == consensus})
    conflict = len(counts) > 1
    rules = dict(signatures=bool(builders), matches=matching >= policy.threshold,
                 operators=operators >= policy.minimum_operators,
                 candidate=consensus == candidate, conflicts=not conflict)
    if conflict and policy.reject_on_conflict:
        status = 'disagreement'
    elif len(builders) < policy.threshold:
        status = 'pending'
    elif not rules['candidate']:
        status = 'rejected'
    elif rules['matches'] and rules['operators']:
        status = 'verified'
    elif len(builders) >= policy.expected_builders:
        status = 'rejected'
    else:
        status = 'pending'
    return dict(status=status, consensus_sha256=consensus, candidate_sha256=candidate,
                attestation_count=len(builders), rules=rules)
