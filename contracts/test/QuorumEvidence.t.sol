// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {QuorumEvidence} from "../src/QuorumEvidence.sol";

contract UntrustedWriter {
    function write(QuorumEvidence target) external {
        target.anchorEvidence(sha256('foreign'), sha256('injected'), 1, false);
    }
}

contract QuorumEvidenceTest {
    function testRejectsUntrustedWriter() public {
        QuorumEvidence target = new QuorumEvidence();
        UntrustedWriter attacker = new UntrustedWriter();
        try attacker.write(target) { revert('unauthorized writer accepted'); } catch {}
    }
    function testAnchorsAndVerifiesEvidence() public {
        QuorumEvidence contractUnderTest = new QuorumEvidence();
        bytes32 releaseIdHash = sha256("release-one");
        bytes32 evidenceHash = sha256("evidence-one");

        contractUnderTest.anchorEvidence(releaseIdHash, evidenceHash, 1, false);
        require(contractUnderTest.verifyEvidence(releaseIdHash, evidenceHash), "anchor missing");

        QuorumEvidence.Anchor memory anchor = contractUnderTest.getAnchor(releaseIdHash);
        require(anchor.evidenceHash == evidenceHash, "wrong evidence hash");
        require(uint8(anchor.decision) == 1, "wrong decision");
        require(!anchor.conflict, "unexpected conflict");
    }

    function testRejectsReplacingAnAnchor() public {
        QuorumEvidence contractUnderTest = new QuorumEvidence();
        bytes32 releaseIdHash = sha256("release-two");
        contractUnderTest.anchorEvidence(releaseIdHash, sha256("first"), 1, false);

        try contractUnderTest.anchorEvidence(releaseIdHash, sha256("second"), 2, true) {
            revert("replacement was accepted");
        } catch {}
    }

    function testRecordsConflictDecision() public {
        QuorumEvidence contractUnderTest = new QuorumEvidence();
        bytes32 releaseIdHash = sha256("release-three");
        bytes32 evidenceHash = sha256("conflicting-evidence");
        contractUnderTest.anchorEvidence(releaseIdHash, evidenceHash, 3, true);

        QuorumEvidence.Anchor memory anchor = contractUnderTest.getAnchor(releaseIdHash);
        require(uint8(anchor.decision) == 3, "not disagreement");
        require(anchor.conflict, "conflict not recorded");
    }
}

