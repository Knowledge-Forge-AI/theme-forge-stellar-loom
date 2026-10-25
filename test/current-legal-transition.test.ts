import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AGPL_3_LICENSE_TEXT,
  COMMERCIAL_LICENSE_TEXT,
  FIRST_PARTY_NOTICE_TEXT,
} from "../src/generator/legal.js";
import { generateThemePackageV2 } from "../src/generator/v2-emitter.js";
import { validateThemeV2 } from "../src/v2/index.js";
import {
  assertHistoricalLegalRecord,
  assertLegalProfileConsistency,
  CURRENT_CONTACT,
  HISTORICAL_CONTACT,
  HISTORICAL_LEGAL_PROFILE,
  historicalLegalModule,
  type LegalProfileRow,
} from "./historical-legal-profile.js";
import {
  qualifiedSourceDigest,
  resolveQualifiedSourceDigest,
} from "./recovery-source-qualification.js";

const sha256 = (value: string | Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");

const manifest = JSON.parse(
  readFileSync(new URL("./fixtures/current-legal-profile-v050/manifest.json", import.meta.url), "utf8")
) as {
  schema: string;
  source: {
    commit: string;
    tree: string;
    packageVersion: string;
    packageMetadataPath: string;
    packageMetadataSha256: string;
    legalSourcePath: string;
    legalSourceSha256: string;
    contact: string;
    previousContact: string;
  };
  receipt: {
    resultSha256: string;
    outerResultSha256: string;
    producerStdoutSha256: string;
    producerSchema: string;
    producerInvoked: string;
    parentAcceptanceSha256: string;
    independentReviewSha256: string;
    parentReviewedCurrentReceipt: boolean;
    sourceAndFixtureWrites: boolean;
    repeatedOutputEqual: boolean;
    fullQualification: boolean;
    publication: boolean;
  };
  legalRows: LegalProfileRow[];
  v2Package: {
    input: {
      example: string;
      exampleSha256: string;
      metadata: { name: string; version: string };
    };
    inputIdentity: string;
    inventoryDigest: string;
    provenanceSha256: string;
  };
  counterfactualReceipt: {
    producerVersion: string;
    inputIdentity: string;
    inventoryDigest: string;
    provenanceSha256: string;
    substitutions: string[];
    legalRows: LegalProfileRow[];
  };
  historicalReference: {
    manifestPath: string;
    manifestSha256: string;
    receiptSha256: string;
    inventoryDigest: string;
    provenanceSha256: string;
    counterfactualInventoryDigest: string;
    counterfactualProvenanceSha256: string;
  };
  scope: string;
};

const protocolQualification = JSON.parse(
  readFileSync(new URL("../protocol/catalog-source-qualification.json", import.meta.url), "utf8")
);

describe("current legal contact transition and fail-closed qualification gates", () => {
  it("binds current legal.ts source, current contact, unchanged AGPL, and exact current legal rows", () => {
    expect(manifest.schema).toBe("loom.current-legal-profile.v2");
    // Root acceptance boolean records producer receipt read/review only, not full QA or release qualification.
    expect(manifest.receipt.parentReviewedCurrentReceipt).toBe(true);
    expect(manifest.receipt.producerInvoked).toBe("generateThemePackageV2");
    expect(manifest.receipt.sourceAndFixtureWrites).toBe(false);
    expect(manifest.receipt.repeatedOutputEqual).toBe(true);
    expect(manifest.receipt.fullQualification).toBe(false);
    expect(manifest.receipt.publication).toBe(false);
    expect(manifest.source.packageVersion).toBe("0.5.0");
    expect(manifest.source.packageMetadataPath).toBe("packages/stellar-loom/package.json");
    expect(manifest.source.packageMetadataSha256).toBe(
      "168b43aba5a8966b0caee78d441f4bb63787889bb2895120e44f505194b3236c"
    );
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8")
    ) as { version: string };
    expect(packageJson.version).toBe(manifest.source.packageVersion);
    expect(manifest.source.contact).toBe(CURRENT_CONTACT);
    expect(manifest.source.previousContact).toBe(HISTORICAL_CONTACT);

    const historicalManifestBytes = readFileSync(
      new URL("./fixtures/current-legal-profile/manifest.json", import.meta.url)
    );
    expect(manifest.historicalReference).toEqual({
      manifestPath: "packages/stellar-loom/test/fixtures/current-legal-profile/manifest.json",
      manifestSha256: "e9a58299b14ddc1fe7b77e948ea75094c162a8fe215bd9d73a1b40d7c9023d9b",
      receiptSha256: "4123ec0a208d48aed773a39d63532402e4417ec072b136a95946a82b4f046e64",
      inventoryDigest: "5312a83626b5937f97e677286f01711c916b3375633f91703a28eeae3bb45759",
      provenanceSha256: "77b86e5eb0f55881d128500deceffc53bb82152d53b8aec01ee294b26399f725",
      counterfactualInventoryDigest: "ba15effeb6888296df3afe2f47556e7fe53dda123091f27ef754bf660bae2699",
      counterfactualProvenanceSha256: "18d645330407aa5b4febc0195e67ca4ef92d7ea350b4dccc6bdbffd2fcfb5aac",
    });
    expect(sha256(historicalManifestBytes)).toBe(manifest.historicalReference.manifestSha256);
    const historicalManifest = JSON.parse(historicalManifestBytes.toString("utf8"));
    expect(historicalManifest.schema).toBe("loom.current-legal-profile.v1");
    expect(historicalManifest.receipt.resultSha256).toBe(manifest.historicalReference.receiptSha256);
    expect(historicalManifest.v2Package.inventoryDigest).toBe(manifest.historicalReference.inventoryDigest);
    expect(historicalManifest.v2Package.provenanceSha256).toBe(manifest.historicalReference.provenanceSha256);
    expect(historicalManifest.legalRows).toEqual(manifest.legalRows);
    expect(historicalManifest.v2Package.input).toEqual(manifest.v2Package.input);
    expect(historicalManifest.v2Package.inputIdentity).toBe(manifest.v2Package.inputIdentity);

    const legalSourceBytes = readFileSync(new URL("../src/generator/legal.ts", import.meta.url));
    const legalSourceHash = sha256(legalSourceBytes);
    expect(legalSourceHash).toBe(manifest.source.legalSourceSha256);
    expect(legalSourceHash).toBe(
      protocolQualification.sources.find((r: { path: string }) => r.path === "src/generator/legal.ts")?.sha256
    );
    expect(legalSourceHash).toBe(
      protocolQualification.contactSourceAmendment.sources["src/generator/legal.ts"].qualifiedSha256
    );

    const actualRows: LegalProfileRow[] = [
      {
        path: "COMMERCIAL-LICENSE.md",
        bytes: Buffer.byteLength(COMMERCIAL_LICENSE_TEXT, "utf8"),
        sha256: sha256(COMMERCIAL_LICENSE_TEXT),
      },
      {
        path: "LICENSE",
        bytes: Buffer.byteLength(AGPL_3_LICENSE_TEXT, "utf8"),
        sha256: sha256(AGPL_3_LICENSE_TEXT),
      },
      {
        path: "NOTICE",
        bytes: Buffer.byteLength(FIRST_PARTY_NOTICE_TEXT, "utf8"),
        sha256: sha256(FIRST_PARTY_NOTICE_TEXT),
      },
    ];
    expect(actualRows).toEqual(manifest.legalRows);

    // AGPL-3.0-or-later license text is byte-identical between historical and current profiles.
    expect(actualRows[1]).toEqual(HISTORICAL_LEGAL_PROFILE.LICENSE);

    // Maintained business contact migrated in NOTICE and COMMERCIAL-LICENSE.md only.
    expect(FIRST_PARTY_NOTICE_TEXT).toContain(CURRENT_CONTACT);
    expect(FIRST_PARTY_NOTICE_TEXT).not.toContain(HISTORICAL_CONTACT);
    expect(COMMERCIAL_LICENSE_TEXT).toContain(CURRENT_CONTACT);
    expect(COMMERCIAL_LICENSE_TEXT).not.toContain(HISTORICAL_CONTACT);
  });

  it("derives v2 package provenance rows from current legal bytes and reproduces the same-producer contact-only counterfactual", () => {
    const exampleBytes = readFileSync(new URL("../examples/loom-black-core.theme.json", import.meta.url));
    const inputRecord = {
      example: "packages/stellar-loom/examples/loom-black-core.theme.json",
      exampleSha256: sha256(exampleBytes),
      metadata: manifest.v2Package.input.metadata,
    };
    expect(inputRecord).toEqual(manifest.v2Package.input);
    expect(sha256(JSON.stringify(inputRecord))).toBe(manifest.v2Package.inputIdentity);

    const theme = validateThemeV2(JSON.parse(exampleBytes.toString("utf8")));
    const result = generateThemePackageV2({
      themeSpec: theme,
      metadata: manifest.v2Package.input.metadata,
    });

    assertLegalProfileConsistency(result.files, result.provenance.files, manifest.legalRows, CURRENT_CONTACT);

    for (const expectedRow of manifest.legalRows) {
      const emitted = result.files.get(expectedRow.path);
      expect(emitted).toBeDefined();
      const emittedBytes = Buffer.byteLength(emitted!);
      const emittedSha = sha256(emitted!);
      expect(emittedBytes).toBe(expectedRow.bytes);
      expect(emittedSha).toBe(expectedRow.sha256);

      const provRow = result.provenance.files.find((f) => f.path === expectedRow.path);
      expect(provRow).toEqual({
        path: expectedRow.path,
        size: emittedBytes,
        sha256: emittedSha,
      });
    }

    expect(result.provenance.producer.version).toBe("0.5.0");
    expect(result.provenance.producer.version).toBe(manifest.source.packageVersion);
    expect(manifest.v2Package.inventoryDigest).toBe(
      "66adb4696e80bd8112ff8ca31bbb7208705384d488d1a8949febc1ad084029bc"
    );
    expect(manifest.v2Package.provenanceSha256).toBe(
      "818962d83527bc6d9b24abd620dcda1acebc82f39c9dec37b1a1119dafcf233f"
    );
    expect(result.provenance.inventoryDigest).toBe(manifest.v2Package.inventoryDigest);
    expect(sha256(result.files.get("provenance.json")!)).toBe(manifest.v2Package.provenanceSha256);

    // Non-emitting same-producer contact-only counterfactual: replacing only NOTICE and COMMERCIAL-LICENSE.md in the 0.5.0 producer output (not a historical prior 0.5.0 release).
    expect(manifest.counterfactualReceipt).toEqual({
      producerVersion: "0.5.0",
      inputIdentity: manifest.v2Package.inputIdentity,
      inventoryDigest: "f1488f2f37ef18bba12c35c7d763082d868ac1ea9bd45cceb420312ecf9dce1a",
      provenanceSha256: "1186a933c2a6c2236c711a2cfcb82545e8d2977f223f9018b8775df2c0eb475f",
      substitutions: ["NOTICE", "COMMERCIAL-LICENSE.md"],
      legalRows: [
        HISTORICAL_LEGAL_PROFILE["COMMERCIAL-LICENSE.md"],
        HISTORICAL_LEGAL_PROFILE.LICENSE,
        HISTORICAL_LEGAL_PROFILE.NOTICE,
      ],
    });
    expect(manifest.counterfactualReceipt.producerVersion).toBe(result.provenance.producer.version);

    const counterfactualRows = result.provenance.files.map((row) => {
      if (row.path === "NOTICE") {
        return {
          path: row.path,
          size: HISTORICAL_LEGAL_PROFILE.NOTICE.bytes,
          sha256: HISTORICAL_LEGAL_PROFILE.NOTICE.sha256,
        };
      }
      if (row.path === "COMMERCIAL-LICENSE.md") {
        return {
          path: row.path,
          size: HISTORICAL_LEGAL_PROFILE["COMMERCIAL-LICENSE.md"].bytes,
          sha256: HISTORICAL_LEGAL_PROFILE["COMMERCIAL-LICENSE.md"].sha256,
        };
      }
      return row;
    });
    const changedPaths = result.provenance.files
      .filter((row, index) => {
        const candidate = counterfactualRows[index]!;
        return row.size !== candidate.size || row.sha256 !== candidate.sha256;
      })
      .map((row) => row.path);
    expect(changedPaths).toEqual(["COMMERCIAL-LICENSE.md", "NOTICE"]);
    expect(changedPaths).toEqual([...manifest.counterfactualReceipt.substitutions].sort());

    const counterfactualInventoryDigest = sha256(
      "tfsl.package-inventory-v2\n" + JSON.stringify(counterfactualRows)
    );
    const counterfactualProvenance = {
      ...result.provenance,
      inventoryDigest: counterfactualInventoryDigest,
      files: counterfactualRows,
    };
    const counterfactualProvenanceSha256 = sha256(
      JSON.stringify(counterfactualProvenance, null, 2) + "\n"
    );
    expect(counterfactualInventoryDigest).toBe(manifest.counterfactualReceipt.inventoryDigest);
    expect(counterfactualProvenanceSha256).toBe(manifest.counterfactualReceipt.provenanceSha256);
  });

  it("rejects mixed legal/provenance profiles and tampered legal module exports in the shared helper", () => {
    const currentFiles = new Map<string, string>([
      ["COMMERCIAL-LICENSE.md", COMMERCIAL_LICENSE_TEXT],
      ["LICENSE", AGPL_3_LICENSE_TEXT],
      ["NOTICE", FIRST_PARTY_NOTICE_TEXT],
    ]);
    const currentProvenanceRows = manifest.legalRows.map((r) => ({
      path: r.path,
      size: r.bytes,
      sha256: r.sha256,
    }));

    const historicalMod = historicalLegalModule({
      AGPL_3_LICENSE_TEXT,
      FIRST_PARTY_NOTICE_TEXT,
      COMMERCIAL_LICENSE_TEXT,
    });
    const historicalFiles = new Map<string, string>([
      ["COMMERCIAL-LICENSE.md", historicalMod.COMMERCIAL_LICENSE_TEXT],
      ["LICENSE", historicalMod.AGPL_3_LICENSE_TEXT],
      ["NOTICE", historicalMod.FIRST_PARTY_NOTICE_TEXT],
    ]);
    const historicalProvenanceRows = Object.values(HISTORICAL_LEGAL_PROFILE).map((r) => ({
      path: r.path,
      size: r.bytes,
      sha256: r.sha256,
    }));

    // Positive controls for both profiles
    expect(() =>
      assertLegalProfileConsistency(currentFiles, currentProvenanceRows, manifest.legalRows, CURRENT_CONTACT)
    ).not.toThrow();
    expect(() =>
      assertLegalProfileConsistency(
        historicalFiles,
        historicalProvenanceRows,
        HISTORICAL_LEGAL_PROFILE,
        HISTORICAL_CONTACT
      )
    ).not.toThrow();

    // Historical files with current provenance rows must fail closed
    expect(() =>
      assertLegalProfileConsistency(historicalFiles, currentProvenanceRows, manifest.legalRows, CURRENT_CONTACT)
    ).toThrow(/mismatch/);
    expect(() =>
      assertLegalProfileConsistency(
        historicalFiles,
        currentProvenanceRows,
        HISTORICAL_LEGAL_PROFILE,
        HISTORICAL_CONTACT
      )
    ).toThrow(/disagrees/);

    // Current files with historical provenance rows must fail closed
    expect(() =>
      assertLegalProfileConsistency(currentFiles, historicalProvenanceRows, manifest.legalRows, CURRENT_CONTACT)
    ).toThrow(/disagrees/);
    expect(() =>
      assertLegalProfileConsistency(
        currentFiles,
        historicalProvenanceRows,
        HISTORICAL_LEGAL_PROFILE,
        HISTORICAL_CONTACT
      )
    ).toThrow(/mismatch/);

    // Mixed legal files (current NOTICE with historical COMMERCIAL-LICENSE.md) must fail closed
    const mixedFiles = new Map<string, string>([
      ["COMMERCIAL-LICENSE.md", historicalMod.COMMERCIAL_LICENSE_TEXT],
      ["LICENSE", AGPL_3_LICENSE_TEXT],
      ["NOTICE", FIRST_PARTY_NOTICE_TEXT],
    ]);
    const mixedProvenanceRows = [
      {
        path: "COMMERCIAL-LICENSE.md",
        size: HISTORICAL_LEGAL_PROFILE["COMMERCIAL-LICENSE.md"].bytes,
        sha256: HISTORICAL_LEGAL_PROFILE["COMMERCIAL-LICENSE.md"].sha256,
      },
      {
        path: "LICENSE",
        size: HISTORICAL_LEGAL_PROFILE.LICENSE.bytes,
        sha256: HISTORICAL_LEGAL_PROFILE.LICENSE.sha256,
      },
      {
        path: "NOTICE",
        size: Buffer.byteLength(FIRST_PARTY_NOTICE_TEXT, "utf8"),
        sha256: sha256(FIRST_PARTY_NOTICE_TEXT),
      },
    ];
    expect(() =>
      assertLegalProfileConsistency(mixedFiles, mixedProvenanceRows, manifest.legalRows, CURRENT_CONTACT)
    ).toThrow(/mismatch/);
    expect(() =>
      assertLegalProfileConsistency(mixedFiles, mixedProvenanceRows, HISTORICAL_LEGAL_PROFILE, HISTORICAL_CONTACT)
    ).toThrow(/mismatch/);

    // Current legal rows passed into historical record validator must fail closed
    expect(() => assertHistoricalLegalRecord(manifest.legalRows, "current-as-historical")).toThrow(/mismatch/);

    // Tampered original module exports passed into historicalLegalModule must fail closed
    expect(() =>
      historicalLegalModule({
        AGPL_3_LICENSE_TEXT: AGPL_3_LICENSE_TEXT + "\n",
        FIRST_PARTY_NOTICE_TEXT,
        COMMERCIAL_LICENSE_TEXT,
      })
    ).toThrow(/AGPL_3_LICENSE_TEXT/);
    expect(() =>
      historicalLegalModule({
        AGPL_3_LICENSE_TEXT,
        FIRST_PARTY_NOTICE_TEXT: historicalMod.FIRST_PARTY_NOTICE_TEXT,
        COMMERCIAL_LICENSE_TEXT,
      })
    ).toThrow(/current maintained contact/);
    expect(() =>
      historicalLegalModule({
        AGPL_3_LICENSE_TEXT,
        FIRST_PARTY_NOTICE_TEXT,
      })
    ).toThrow(/Unexpected export keys/);
  });

  it("qualifies generator/legal.ts through contactSourceAmendment and fails closed on wrong prior hash, arbitrary path, malformed amendment, and cross-amendment reuse", () => {
    const priorLegalHash = "1f389ed0d1286e9603890f7fd9ed5f2a4fd91c2981901dfea4ae4cb3b9a9b918";
    const qualifiedLegalHash = "e71b5c1b0a98089b0d4f5ff31dac7d3280a0e47a3cd3b9b5f5d150852048db5b";

    // Positive controls
    expect(qualifiedSourceDigest("generator/legal.ts", priorLegalHash)).toBe(qualifiedLegalHash);
    expect(
      qualifiedSourceDigest(
        "cli-v2.ts",
        "b443b093c334e7e8106531846057d90f147d59cae052610a3d71b21444b8bf52"
      )
    ).toBe("ea5d2196659b5edeed4b9aea3503dfe9b3b6dac3a419bc95c52fe18c94174919");
    expect(
      qualifiedSourceDigest(
        "v2/compiler.ts",
        "30d556dab3eab9750070a56dbd84d73dff4e8a456e525984fbdf35a986450982"
      )
    ).toBe("30d556dab3eab9750070a56dbd84d73dff4e8a456e525984fbdf35a986450982");

    // 1. Wrong contact-amendment prior hash passed by caller
    expect(() =>
      resolveQualifiedSourceDigest(protocolQualification, "generator/legal.ts", "0".repeat(64))
    ).toThrow();

    // 2. Wrong previousQualifiedSha256 in contactSourceAmendment row
    const wrongPriorAmendment = structuredClone(protocolQualification);
    wrongPriorAmendment.contactSourceAmendment.sources["src/generator/legal.ts"].previousQualifiedSha256 =
      "f".repeat(64);
    expect(() =>
      resolveQualifiedSourceDigest(wrongPriorAmendment, "generator/legal.ts", "f".repeat(64))
    ).toThrow();

    // 3. Arbitrary path passed to helper or inserted into contactSourceAmendment
    expect(() =>
      resolveQualifiedSourceDigest(protocolQualification, "generator/unknown.ts", priorLegalHash)
    ).toThrow();
    expect(() =>
      resolveQualifiedSourceDigest(protocolQualification, "src/generator/legal.ts", priorLegalHash)
    ).toThrow();
    expect(() =>
      resolveQualifiedSourceDigest(protocolQualification, "generator/emitter.ts", priorLegalHash)
    ).toThrow();

    const replacedContactKey = structuredClone(protocolQualification);
    replacedContactKey.contactSourceAmendment.sources = {
      "src/generator/emitter.ts": {
        previousQualifiedSha256: priorLegalHash,
        qualifiedSha256: qualifiedLegalHash,
      },
    };
    expect(() =>
      resolveQualifiedSourceDigest(replacedContactKey, "generator/emitter.ts", priorLegalHash)
    ).toThrow();

    const extraContactKey = structuredClone(protocolQualification);
    extraContactKey.contactSourceAmendment.sources["src/generator/emitter.ts"] = {
      previousQualifiedSha256: priorLegalHash,
      qualifiedSha256: qualifiedLegalHash,
    };
    expect(() =>
      resolveQualifiedSourceDigest(extraContactKey, "generator/legal.ts", priorLegalHash)
    ).toThrow();

    // 4. Malformed amendment rows and protocol-row mismatch
    const missingContactSection = structuredClone(protocolQualification);
    delete missingContactSection.contactSourceAmendment;
    expect(() =>
      resolveQualifiedSourceDigest(missingContactSection, "generator/legal.ts", priorLegalHash)
    ).toThrow();

    const nonObjectSources = structuredClone(protocolQualification);
    nonObjectSources.contactSourceAmendment.sources = [];
    expect(() =>
      resolveQualifiedSourceDigest(nonObjectSources, "generator/legal.ts", priorLegalHash)
    ).toThrow();

    const missingPriorField = structuredClone(protocolQualification);
    delete missingPriorField.contactSourceAmendment.sources["src/generator/legal.ts"].previousQualifiedSha256;
    expect(() =>
      resolveQualifiedSourceDigest(missingPriorField, "generator/legal.ts", priorLegalHash)
    ).toThrow();

    const extraFieldRow = structuredClone(protocolQualification);
    extraFieldRow.contactSourceAmendment.sources["src/generator/legal.ts"].extra = "forbidden";
    expect(() =>
      resolveQualifiedSourceDigest(extraFieldRow, "generator/legal.ts", priorLegalHash)
    ).toThrow();

    const protocolRowMismatch = structuredClone(protocolQualification);
    const legalSourceEntry = protocolRowMismatch.sources.find(
      (r: { path: string }) => r.path === "src/generator/legal.ts"
    );
    legalSourceEntry.sha256 = "a".repeat(64);
    expect(() =>
      resolveQualifiedSourceDigest(protocolRowMismatch, "generator/legal.ts", priorLegalHash)
    ).toThrow();

    // 5. Cross-amendment reuse between recoverySourceAmendment and contactSourceAmendment
    const legalInRecovery = structuredClone(protocolQualification);
    legalInRecovery.recoverySourceAmendment.sources["generator/legal.ts"] = {
      historicalSha256: priorLegalHash,
      qualifiedSha256: qualifiedLegalHash,
    };
    expect(() =>
      resolveQualifiedSourceDigest(legalInRecovery, "generator/legal.ts", priorLegalHash)
    ).toThrow();

    const cliInContact = structuredClone(protocolQualification);
    cliInContact.contactSourceAmendment.sources["src/cli-v2.ts"] = {
      previousQualifiedSha256: "b443b093c334e7e8106531846057d90f147d59cae052610a3d71b21444b8bf52",
      qualifiedSha256: "ea5d2196659b5edeed4b9aea3503dfe9b3b6dac3a419bc95c52fe18c94174919",
    };
    expect(() =>
      resolveQualifiedSourceDigest(cliInContact, "generator/legal.ts", priorLegalHash)
    ).toThrow();
  });
});
