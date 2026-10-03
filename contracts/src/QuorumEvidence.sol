// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Immutable anchors for Quorum release-verification evidence.
/// @dev Full attestations remain off-chain. Only their canonical SHA-256 digest is stored here.
contract QuorumEvidence {
    address public immutable owner = msg.sender;
    error Unauthorized();
    enum Decision {
        Pending,
        Verified,
        Rejected,
        Disagreement
    }

    struct Anchor {
        bytes32 evidenceHash;
        Decision decision;
        bool conflict;
        uint64 anchoredAt;
        address submitter;
    }

    mapping(bytes32 releaseIdHash => Anchor anchor) private anchors;

    event EvidenceAnchored(
        bytes32 indexed releaseIdHash,
        bytes32 indexed evidenceHash,
        Decision decision,
        bool conflict,
        address indexed submitter
    );
    event ConflictAnchored(bytes32 indexed releaseIdHash, bytes32 indexed evidenceHash);

    error AlreadyAnchored(bytes32 releaseIdHash);
    error EmptyEvidenceHash();
    error InvalidDecision(uint8 decision);

    function anchorEvidence(
        bytes32 releaseIdHash,
        bytes32 evidenceHash,
        uint8 decision,
        bool conflict
    ) external {
        if (msg.sender != owner) revert Unauthorized();
        if (evidenceHash == bytes32(0)) revert EmptyEvidenceHash();
        if (anchors[releaseIdHash].evidenceHash != bytes32(0)) {
            revert AlreadyAnchored(releaseIdHash);
        }
        if (decision == uint8(Decision.Pending) || decision > uint8(Decision.Disagreement)) {
            revert InvalidDecision(decision);
        }

        anchors[releaseIdHash] = Anchor({
            evidenceHash: evidenceHash,
            decision: Decision(decision),
            conflict: conflict,
            anchoredAt: uint64(block.timestamp),
            submitter: msg.sender
        });

        emit EvidenceAnchored(
            releaseIdHash,
            evidenceHash,
            Decision(decision),
            conflict,
            msg.sender
        );
        if (conflict) emit ConflictAnchored(releaseIdHash, evidenceHash);
    }

    function getAnchor(bytes32 releaseIdHash) external view returns (Anchor memory) {
        return anchors[releaseIdHash];
    }

    function verifyEvidence(
        bytes32 releaseIdHash,
        bytes32 evidenceHash
    ) external view returns (bool) {
        return evidenceHash != bytes32(0) && anchors[releaseIdHash].evidenceHash == evidenceHash;
    }
}

