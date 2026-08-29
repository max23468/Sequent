import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { calculateDeclarationTaxSummary } from "../../src/domain/calculation.ts";
import { addSnapshotAutomaticOfficialFieldValues } from "../../src/domain/automatic-official-fields.ts";
import type { CanonicalFieldValue, DeclarationSnapshot } from "../../src/domain/declaration.ts";
import { deriveOfficialFieldValue } from "../../src/domain/derived-fields.ts";
import {
  QUADRI,
  getResolvedTechnicalFacetAlternatives,
  listQuadroFields,
  listQuadroTechnicalElements,
  listTechnicalEnumerationValues,
  type QuadroId,
  type TechnicalElement,
} from "../../src/domain/official-catalog/catalog.ts";
import {
  OPERATIONAL_SECTION_AREAS,
  isOperationalParityAutomatic,
  isOperationalParityEditable,
  isOperationalParityOfficeReserved,
  listOperationalAreaFields,
  type OperationalArea,
  type OperationalParityRow,
  type OperationalSectionId,
} from "../../src/domain/operational-parity.ts";
import { validateFieldValue } from "../../src/domain/validation.ts";
import {
  readCanonicalFieldsFromView,
  removeCanonicalOccurrenceFromView,
  reorderCanonicalOccurrencesFromView,
  saveCanonicalFieldsFromView,
  type CanonicalFieldView,
} from "../../src/lib/server/canonical-field-views.ts";
import { closeDatabase, openDatabase } from "../../src/lib/server/database.ts";
import {
  buildComplianceReport,
  confirmCalculationRun,
  confirmDevolutionScenario,
  createSharedAsset,
  createSharedSubject,
  getAutomaticOfficialFieldValues,
  listCanonicalOccurrenceIds,
  runSuccessionCalculation,
  saveDevolutionScenario,
  type AssetKind,
} from "../../src/lib/server/domain.ts";
import {
  createPractice,
  createSuccessiveDeclaration,
  getDeclaration,
} from "../../src/lib/server/practices.ts";

const checkedInMap = JSON.parse(
  readFileSync("src/domain/official-catalog/operational-view-parity.json", "utf8"),
) as OperationalParityRow[];
const coveredRows = checkedInMap.filter((row) => row.currentCoverage === "coperto");
const editableRows = coveredRows.filter((row) => isOperationalParityEditable(row));
const derivedRows = coveredRows.filter((row) => row.handling === "derivato");
const automaticRows = coveredRows.filter((row) => row.handling === "gestito-automaticamente");
const contextualRows = coveredRows.filter((row) => row.handling === "gestione-contestuale");
const automaticRowsForFirst = coveredRows.filter((row) =>
  isOperationalParityAutomatic(row, "first"),
);
const candidateReadOnlyRows = checkedInMap.filter(
  (row) =>
    row.operationalVisibility === "esatta" &&
    row.operationalEditability === "sola-lettura" &&
    row.semanticReview.status === "candidata",
);
const unresolvedReadOnlyRows = checkedInMap.filter(
  (row) =>
    row.operationalVisibility === "esatta" &&
    row.operationalEditability === "sola-lettura" &&
    row.semanticReview.status === "irrisolta",
);
const guardedReadOnlyRows = [...candidateReadOnlyRows, ...unresolvedReadOnlyRows];
const missingRows = checkedInMap.filter((row) => row.currentCoverage === "mancante");
const officeReservedRows = coveredRows.filter((row) => isOperationalParityOfficeReserved(row));
const directories: string[] = [];

const ASSET_KIND_BY_QUADRO: Partial<Record<QuadroId, AssetKind>> = {
  EB: "land",
  EC: "building",
  ED: "liability",
  EL: "tavolare_land",
  EM: "tavolare_building",
  EN: "company",
  EO: "securities",
  EP: "aircraft",
  EQ: "vessel",
  ER: "other",
};

const SECTION_BY_AREA = Object.fromEntries(
  Object.entries(OPERATIONAL_SECTION_AREAS).map(([section, area]) => [area, section]),
) as Record<OperationalArea, OperationalSectionId>;

const BASE_SYNTHETIC_VALUES = [
  "0",
  "1",
  "01",
  "001",
  "0001",
  "00001",
  "000001",
  "0000001",
  "00000001",
  "000000001",
  "0000000001",
  "00000000001",
  "000000000001",
  "A",
  "AA",
  "AAA",
  "TEST",
  "TESTO",
  "ROMA",
  "RM",
  "EE",
  "M",
  "F",
  "01012020",
  "02022021",
  "2020",
  "2021",
  "test@example.invalid",
  "IT00X0000000000000000000000",
  "RSSMRA80A01H501U",
  "VRDLGI80A01H501U",
  "12345678901",
  "10987654321",
  "1,00",
  "2,00",
  "100",
  "200",
  "1000",
  "2000",
];

interface RuntimeCase {
  row: OperationalParityRow;
  field: ReturnType<typeof listQuadroFields>[number];
}

interface RuntimeIdentity {
  entityId: string | null;
  occurrenceId: string | null;
}

interface PreparedRuntimeCase {
  testCase: RuntimeCase;
  identity: RuntimeIdentity;
  values: [string, string];
}

interface CoveredChoiceAlternative {
  member: TechnicalElement;
  cases: RuntimeCase[];
}

interface CoveredChoiceFamily {
  choiceGroup: string;
  quadro: QuadroId;
  alternatives: CoveredChoiceAlternative[];
  activator: RuntimeCase | null;
  requiredWhenActive: boolean;
}

type DeclarationKind = DeclarationSnapshot["declarationKind"];
type EditableViewKind = CanonicalFieldView["kind"];

function rowAppliesToDeclarationKind(
  row: OperationalParityRow,
  declarationKind: DeclarationKind,
): boolean {
  return row.applicability.declarationKinds.some(
    (applicableKind) => applicableKind === "all" || applicableKind === declarationKind,
  );
}

function runtimeCase(row: OperationalParityRow): RuntimeCase {
  const field = listQuadroFields(row.quadro).find(
    (candidate) => candidate.canonicalId === row.fieldId,
  );
  if (!field) throw new Error(`FIELD_NOT_FOUND:${row.fieldId}`);
  return { row, field };
}

function isTechnicalDescendant(path: string, parentPath: string): boolean {
  return path.startsWith(`${parentPath}/`);
}

function parentTechnicalPath(path: string): string {
  return path.slice(0, path.lastIndexOf("/"));
}

function syntheticValues(testCase: RuntimeCase): [string, string] {
  const { field, row } = testCase;
  const candidates = [
    ...field.options.map((option) => option.value),
    ...listTechnicalEnumerationValues(row.fieldId),
    ...getResolvedTechnicalFacetAlternatives(row.fieldId).flatMap(
      (facets) => facets.enumeration ?? [],
    ),
    ...BASE_SYNTHETIC_VALUES,
  ];
  const valid = [...new Set(candidates)].filter(
    (value) => value !== "" && validateFieldValue(row.fieldId, value).length === 0,
  );
  const first = valid[0];
  if (first === undefined) throw new Error(`SYNTHETIC_VALUE_NOT_FOUND:${row.fieldId}`);
  return [first, valid.find((value) => value !== first) ?? ""];
}

function operationalView(row: OperationalParityRow): CanonicalFieldView {
  return {
    kind: "operational",
    section: SECTION_BY_AREA[row.candidateOperationalArea],
  };
}

function quadriView(row: OperationalParityRow): CanonicalFieldView {
  return { kind: "quadri", quadro: row.quadro };
}

function runtimeIdentity(
  testCase: RuntimeCase,
  context: {
    decedentId: string | null;
    subjectId: string | null;
    assetIds: Map<QuadroId, string>;
    occurrences: Map<string, string>;
  },
): RuntimeIdentity {
  const scope = testCase.row.cardinality.entityScope;
  if (scope === "decedent") return { entityId: context.decedentId, occurrenceId: null };
  if (scope === "subject") return { entityId: context.subjectId, occurrenceId: null };
  if (scope === "asset") {
    const assetId = context.assetIds.get(testCase.row.quadro);
    if (!assetId) throw new Error(`ASSET_NOT_FOUND:${testCase.row.quadro}`);
    return { entityId: assetId, occurrenceId: null };
  }
  if (scope === "occurrence") {
    const group = testCase.row.cardinality.occurrenceGroup;
    if (!group) throw new Error(`OCCURRENCE_GROUP_NOT_FOUND:${testCase.row.fieldId}`);
    const occurrenceId = context.occurrences.get(group) ?? randomUUID();
    context.occurrences.set(group, occurrenceId);
    return { entityId: null, occurrenceId };
  }
  return { entityId: null, occurrenceId: null };
}

function viewForCase(testCase: RuntimeCase, kind: EditableViewKind): CanonicalFieldView {
  return kind === "quadri" ? quadriView(testCase.row) : operationalView(testCase.row);
}

function savePreparedCases(
  database: ReturnType<typeof openDatabase>,
  input: {
    practiceId: string;
    declarationId: string;
    expectedRevision: number;
    cases: PreparedRuntimeCase[];
    viewKind: EditableViewKind;
    valueIndex: 0 | 1;
  },
): number {
  const groups = new Map<
    string,
    {
      view: CanonicalFieldView;
      identity: RuntimeIdentity;
      cases: PreparedRuntimeCase[];
    }
  >();
  for (const preparedCase of input.cases) {
    const view = viewForCase(preparedCase.testCase, input.viewKind);
    const viewId = view.kind === "quadri" ? view.quadro : view.section;
    const key = [
      view.kind,
      viewId,
      preparedCase.testCase.row.cardinality.entityScope,
      preparedCase.testCase.row.cardinality.occurrenceGroup ?? "",
      preparedCase.identity.entityId ?? "",
      preparedCase.identity.occurrenceId ?? "",
    ].join("|");
    const group = groups.get(key) ?? { view, identity: preparedCase.identity, cases: [] };
    group.cases.push(preparedCase);
    groups.set(key, group);
  }

  let revision = input.expectedRevision;
  for (const group of groups.values()) {
    const result = saveCanonicalFieldsFromView(database, {
      practiceId: input.practiceId,
      declarationId: input.declarationId,
      expectedRevision: revision,
      view: group.view,
      fields: group.cases.map(({ testCase, values }) => ({
        fieldId: testCase.row.fieldId,
        value: values[input.valueIndex],
      })),
      ...group.identity,
      confirmOfficialRules: true,
    });
    expect(
      result.issues,
      group.cases.map(({ testCase }) => testCase.row.fieldId).join(", "),
    ).toEqual([]);
    revision = result.revision;
  }
  return revision;
}

function expectPreparedCases(
  database: ReturnType<typeof openDatabase>,
  input: {
    practiceId: string;
    declarationId: string;
    cases: PreparedRuntimeCase[];
    valueIndex: 0 | 1;
  },
) {
  const reads = new Map<EditableViewKind, Map<string, CanonicalFieldValue | undefined>>([
    ["quadri", new Map()],
    ["operational", new Map()],
  ]);
  for (const viewKind of ["quadri", "operational"] as const) {
    const groups = Map.groupBy(input.cases, ({ testCase }) => {
      const view = viewForCase(testCase, viewKind);
      return view.kind === "quadri" ? view.quadro : view.section;
    });
    for (const cases of groups.values()) {
      const values = readCanonicalFieldsFromView(database, {
        practiceId: input.practiceId,
        declarationId: input.declarationId,
        view: viewForCase(cases[0]!.testCase, viewKind),
        fields: cases.map(({ testCase, identity }) => ({
          fieldId: testCase.row.fieldId,
          ...identity,
        })),
      });
      for (const [index, preparedCase] of cases.entries()) {
        reads.get(viewKind)!.set(runtimeCaseIdentityKey(preparedCase), values[index]);
      }
    }
  }
  for (const preparedCase of input.cases) {
    const key = runtimeCaseIdentityKey(preparedCase);
    const fromQuadri = reads.get("quadri")!.get(key);
    const fromOperational = reads.get("operational")!.get(key);
    expect(fromQuadri, preparedCase.testCase.row.fieldId).toMatchObject({
      fieldId: preparedCase.testCase.row.fieldId,
      entityId: preparedCase.identity.entityId,
      occurrenceId: preparedCase.identity.occurrenceId,
      value: preparedCase.values[input.valueIndex],
    });
    expect(fromOperational, preparedCase.testCase.row.fieldId).toEqual(fromQuadri);
  }
}

function runtimeCaseIdentityKey(preparedCase: PreparedRuntimeCase): string {
  return [
    preparedCase.testCase.row.fieldId,
    preparedCase.identity.entityId ?? "",
    preparedCase.identity.occurrenceId ?? "",
  ].join("|");
}

function prepareAllEditableCases(
  database: ReturnType<typeof openDatabase>,
  declarationKind: DeclarationKind,
) {
  const declarationEditableRows = coveredRows.filter(
    (row) =>
      isOperationalParityEditable(row, declarationKind) &&
      rowAppliesToDeclarationKind(row, declarationKind),
  );
  const practice = createPractice(database, `Parità sintetica ${declarationKind}`);
  const declaration =
    declarationKind === "first"
      ? getDeclaration(database, practice.declarationId, practice.id)!
      : createSuccessiveDeclaration(database, practice.id, practice.declarationId, declarationKind);
  const decedent = createSharedSubject(database, practice.id, {
    role: "decedent",
    displayName: "Defunto sintetico",
  });
  const subject = createSharedSubject(database, practice.id, {
    role: "beneficiary",
    displayName: "Beneficiario sintetico",
    declarationId: declaration.id,
  });
  const assetIds = new Map<QuadroId, string>();
  for (const quadro of new Set(
    declarationEditableRows
      .filter((row) => row.cardinality.entityScope === "asset")
      .map((row) => row.quadro),
  )) {
    const kind = ASSET_KIND_BY_QUADRO[quadro];
    if (!kind) throw new Error(`ASSET_KIND_NOT_FOUND:${quadro}`);
    const asset = createSharedAsset(database, practice.id, {
      kind,
      displayName: `Bene sintetico ${quadro}`,
      declarationId: declaration.id,
    });
    assetIds.set(quadro, asset.id);
  }
  const context = {
    decedentId: decedent.id,
    subjectId: subject.id,
    assetIds,
    occurrences: new Map<string, string>(),
  };
  const cases = declarationEditableRows.map(runtimeCase).map((testCase) => ({
    testCase,
    identity: runtimeIdentity(testCase, context),
    values: syntheticValues(testCase),
  }));
  return { practice, declaration, cases };
}

const families = [
  ...editableRows
    .map(runtimeCase)
    .reduce((groups, testCase) => {
      const key = [
        testCase.row.quadro,
        testCase.row.candidateOperationalArea,
        testCase.row.professionalObject,
        testCase.row.cardinality.entityScope,
        testCase.row.applicability.declarationKinds.join(","),
      ].join("|");
      const group = groups.get(key) ?? [];
      group.push(testCase);
      groups.set(key, group);
      return groups;
    }, new Map<string, RuntimeCase[]>())
    .entries(),
].map(([key, cases]) => ({ key, cases }));

const occurrenceFamilies = [
  ...editableRows
    .filter((row) => row.cardinality.entityScope === "occurrence")
    .map(runtimeCase)
    .reduce((groups, testCase) => {
      const groupId = testCase.row.cardinality.occurrenceGroup;
      if (!groupId) throw new Error(`OCCURRENCE_GROUP_NOT_FOUND:${testCase.row.fieldId}`);
      const group = groups.get(groupId) ?? [];
      group.push(testCase);
      groups.set(groupId, group);
      return groups;
    }, new Map<string, RuntimeCase[]>())
    .entries(),
].map(([groupId, cases]) => ({ groupId, cases }));

const editableRowsByFieldId = new Map(editableRows.map((row) => [row.fieldId, row]));
const coveredChoiceGroups = new Set(
  editableRows
    .map((row) => row.applicability.choiceGroup)
    .filter((choiceGroup): choiceGroup is string => choiceGroup !== null),
);
const coveredChoiceFamilies = QUADRI.flatMap((quadro): CoveredChoiceFamily[] => {
  const technicalElements = listQuadroTechnicalElements(quadro);
  const fields = listQuadroFields(quadro).filter((field) => field.visibleFieldId !== null);
  const choiceGroups = [
    ...new Set(
      technicalElements
        .map((element) => element.choiceGroup)
        .filter(
          (choiceGroup): choiceGroup is string =>
            choiceGroup !== null && coveredChoiceGroups.has(choiceGroup),
        ),
    ),
  ];
  return choiceGroups.flatMap((choiceGroup): CoveredChoiceFamily[] => {
    const alternatives = technicalElements
      .filter((element) => element.choiceGroup === choiceGroup)
      .map((member): CoveredChoiceAlternative | null => {
        const memberFields = fields.filter((field) =>
          member.kind === "field"
            ? field.path === member.path
            : isTechnicalDescendant(field.path, member.path),
        );
        const cases = memberFields.flatMap((field) => {
          const row = editableRowsByFieldId.get(field.canonicalId);
          return row ? [runtimeCase(row)] : [];
        });
        return memberFields.length > 0 && cases.length === memberFields.length
          ? { member, cases }
          : null;
      });
    if (alternatives.some((alternative) => alternative === null)) return [];
    const completeAlternatives = alternatives as CoveredChoiceAlternative[];
    const representative = completeAlternatives[0]?.cases[0];
    if (!representative || completeAlternatives.length < 2) return [];
    const alternativeFieldIds = new Set(
      completeAlternatives.flatMap((alternative) =>
        alternative.cases.map((testCase) => testCase.row.fieldId),
      ),
    );
    const choiceParentPath = parentTechnicalPath(completeAlternatives[0]!.member.path);
    const activator = fields
      .filter((field) => isTechnicalDescendant(field.path, choiceParentPath))
      .map((field) => editableRowsByFieldId.get(field.canonicalId))
      .filter((row): row is OperationalParityRow => row !== undefined)
      .filter(
        (row) =>
          row.cardinality.entityScope === representative.row.cardinality.entityScope &&
          row.cardinality.occurrenceGroup === representative.row.cardinality.occurrenceGroup,
      )
      .find((row) => !alternativeFieldIds.has(row.fieldId));
    return [
      {
        choiceGroup,
        quadro,
        alternatives: completeAlternatives,
        activator: activator ? runtimeCase(activator) : null,
        requiredWhenActive: completeAlternatives.some(
          (alternative) => alternative.member.minOccurs > 0,
        ),
      },
    ];
  });
});
const conditionalRows = editableRows.filter(
  (row) => row.applicability.xsdPresence === "condizionale",
);
const conditionalContexts = [
  ...Map.groupBy(conditionalRows.map(runtimeCase), ({ row }) =>
    [row.quadro, row.cardinality.entityScope, row.cardinality.occurrenceGroup ?? ""].join("|"),
  ).entries(),
].map(([key, cases]) => {
  const representative = cases[0]!;
  const activator = editableRows
    .filter((row) => row.applicability.xsdPresence === "obbligatorio-nel-contesto")
    .filter(
      (row) =>
        row.quadro === representative.row.quadro &&
        row.cardinality.entityScope === representative.row.cardinality.entityScope &&
        row.cardinality.occurrenceGroup === representative.row.cardinality.occurrenceGroup,
    )
    .map(runtimeCase)[0];
  return { key, cases, activator };
});

const coveredEhCases = editableRows.filter((row) => row.quadro === "EH").map(runtimeCase);
const isolatedEntityCases = editableRows
  .filter((row) => ["subject", "asset"].includes(row.cardinality.entityScope))
  .map(runtimeCase);

const DECLARATION_KINDS: DeclarationKind[] = [
  "first",
  "substitute-1",
  "substitute-2",
  "substitute-3",
];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    closeDatabase(directory);
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("round-trip parametrico dei campi coperti", () => {
  it("usa la matrice generata come inventario unico dei campi coperti", () => {
    expect(coveredRows).toHaveLength(715);
    expect(editableRows).toHaveLength(644);
    expect(derivedRows).toHaveLength(5);
    expect(automaticRows).toHaveLength(56);
    expect(contextualRows).toHaveLength(2);
    expect(officeReservedRows).toHaveLength(8);
    expect(automaticRowsForFirst).toHaveLength(58);
    expect(candidateReadOnlyRows).toHaveLength(0);
    expect(unresolvedReadOnlyRows).toHaveLength(0);
    expect(guardedReadOnlyRows).toHaveLength(0);
    expect(missingRows).toHaveLength(0);
    expect(missingRows.every((row) => row.operationalVisibility === "assente")).toBe(true);
    expect(guardedReadOnlyRows.some((row) => row.handling === "gestito-automaticamente")).toBe(
      false,
    );
    expect(conditionalRows).toHaveLength(260);
    expect(
      editableRows.filter((row) => row.applicability.xsdPresence === "obbligatorio-nel-contesto"),
    ).toHaveLength(384);
    expect(new Set(editableRows.flatMap((row) => row.applicability.declarationKinds))).toEqual(
      new Set(["all", "substitute-1", "substitute-2", "substitute-3"]),
    );
    expect(coveredChoiceFamilies.map(({ choiceGroup }) => choiceGroup).sort()).toEqual([
      "choice-10",
      "choice-11",
      "choice-12",
      "choice-13",
      "choice-14",
      "choice-15",
      "choice-16",
      "choice-17",
      "choice-3",
      "choice-8",
      "choice-9",
    ]);
    expect(conditionalContexts).toHaveLength(21);
    expect(conditionalContexts.filter(({ activator }) => activator === undefined)).toEqual([
      expect.objectContaining({ key: "EF|declaration|" }),
    ]);
    expect(occurrenceFamilies).toHaveLength(11);
    expect(occurrenceFamilies.flatMap((family) => family.cases)).toHaveLength(103);
    expect(coveredEhCases).toHaveLength(207);
    expect(isolatedEntityCases).toHaveLength(305);
    expect(
      isolatedEntityCases.filter(({ row }) => row.cardinality.entityScope === "subject"),
    ).toHaveLength(21);
    expect(
      isolatedEntityCases.filter(({ row }) => row.cardinality.entityScope === "asset"),
    ).toHaveLength(284);
    expect(
      coveredEhCases.filter(({ row }) => row.cardinality.entityScope === "occurrence"),
    ).toHaveLength(79);
    expect(
      new Set(
        coveredEhCases
          .filter(({ row }) => row.cardinality.entityScope === "occurrence")
          .map(({ row }) => row.cardinality.occurrenceGroup),
      ).size,
    ).toBe(6);
    expect(families.flatMap((family) => family.cases)).toHaveLength(644);
    expect(
      new Set(families.flatMap((family) => family.cases.map(({ row }) => row.fieldId))).size,
    ).toBe(644);
  });

  for (const family of families) {
    it(
      `salva e riapre in entrambe le direzioni ${family.key} (${family.cases.length})`,
      { timeout: 30_000 },
      () => {
        const directory = mkdtempSync(join(tmpdir(), "sequent-operational-parity-"));
        directories.push(directory);
        let database = openDatabase(directory);
        const practice = createPractice(database, `Parità sintetica ${family.key}`);
        const firstRow = family.cases[0]!.row;
        const familyDeclarationKind: DeclarationKind =
          firstRow.quadro === "EH"
            ? "substitute-1"
            : firstRow.applicability.declarationKinds.some(
                  (applicableKind) => applicableKind === "all",
                )
              ? "first"
              : (firstRow.applicability.declarationKinds[0] as DeclarationKind);
        const declaration =
          familyDeclarationKind !== "first"
            ? createSuccessiveDeclaration(
                database,
                practice.id,
                practice.declarationId,
                familyDeclarationKind,
              )
            : getDeclaration(database, practice.declarationId, practice.id)!;
        const decedent = family.cases.some(({ row }) => row.cardinality.entityScope === "decedent")
          ? createSharedSubject(database, practice.id, {
              role: "decedent",
              displayName: "Defunto sintetico",
            })
          : null;
        const subject = family.cases.some(({ row }) => row.cardinality.entityScope === "subject")
          ? createSharedSubject(database, practice.id, {
              role: "beneficiary",
              displayName: "Beneficiario sintetico",
              declarationId: declaration.id,
            })
          : null;
        const assetKind = ASSET_KIND_BY_QUADRO[firstRow.quadro];
        const asset = family.cases.some(({ row }) => row.cardinality.entityScope === "asset")
          ? createSharedAsset(database, practice.id, {
              kind: assetKind,
              displayName: "Bene sintetico",
              declarationId: declaration.id,
            })
          : null;
        if (family.cases.some(({ row }) => row.cardinality.entityScope === "asset") && !assetKind)
          throw new Error(`ASSET_KIND_NOT_FOUND:${firstRow.quadro}`);
        const context = {
          decedentId: decedent?.id ?? null,
          subjectId: subject?.id ?? null,
          assetIds: new Map<QuadroId, string>(asset ? [[firstRow.quadro, asset.id]] : []),
          occurrences: new Map<string, string>(),
        };
        const cases = family.cases.map((testCase) => ({
          testCase,
          identity: runtimeIdentity(testCase, context),
          values: syntheticValues(testCase),
        }));
        const initialRevision = declaration.revision;
        let revision = initialRevision;
        for (const { testCase, identity, values } of cases) {
          const result = saveCanonicalFieldsFromView(database, {
            practiceId: practice.id,
            declarationId: declaration.id,
            expectedRevision: revision,
            view: quadriView(testCase.row),
            fields: [{ fieldId: testCase.row.fieldId, value: values[0] }],
            ...identity,
            confirmOfficialRules: true,
          });
          expect(result.issues, testCase.row.fieldId).toEqual([]);
          revision = result.revision;
        }
        const snapshotAfterQuadri = getDeclaration(database, declaration.id, practice.id)!;
        expect(() =>
          savePreparedCases(database, {
            practiceId: practice.id,
            declarationId: declaration.id,
            expectedRevision: initialRevision,
            cases,
            viewKind: "operational",
            valueIndex: 1,
          }),
        ).toThrow("REVISION_CONFLICT");
        expect(getDeclaration(database, declaration.id, practice.id)).toEqual(snapshotAfterQuadri);
        closeDatabase(directory);
        database = openDatabase(directory);
        expectPreparedCases(database, {
          practiceId: practice.id,
          declarationId: declaration.id,
          cases,
          valueIndex: 0,
        });

        const revisionBeforeOperational = revision;
        for (const { testCase, identity, values } of cases) {
          const result = saveCanonicalFieldsFromView(database, {
            practiceId: practice.id,
            declarationId: declaration.id,
            expectedRevision: revision,
            view: operationalView(testCase.row),
            fields: [{ fieldId: testCase.row.fieldId, value: values[1] }],
            ...identity,
            confirmOfficialRules: true,
          });
          expect(result.issues, testCase.row.fieldId).toEqual([]);
          revision = result.revision;
        }
        const snapshotAfterOperational = getDeclaration(database, declaration.id, practice.id)!;
        expect(() =>
          savePreparedCases(database, {
            practiceId: practice.id,
            declarationId: declaration.id,
            expectedRevision: revisionBeforeOperational,
            cases,
            viewKind: "quadri",
            valueIndex: 0,
          }),
        ).toThrow("REVISION_CONFLICT");
        expect(getDeclaration(database, declaration.id, practice.id)).toEqual(
          snapshotAfterOperational,
        );
        closeDatabase(directory);
        database = openDatabase(directory);
        expectPreparedCases(database, {
          practiceId: practice.id,
          declarationId: declaration.id,
          cases,
          valueIndex: 1,
        });
      },
    );
  }

  for (const declarationKind of DECLARATION_KINDS) {
    const expectedEditableCount =
      declarationKind === "first" ? 641 : declarationKind === "substitute-1" ? 646 : 644;
    it(
      `esercita tutti i ${expectedEditableCount} input su dichiarazione ${declarationKind}`,
      { timeout: 30_000 },
      () => {
        const directory = mkdtempSync(join(tmpdir(), "sequent-operational-kinds-"));
        directories.push(directory);
        let database = openDatabase(directory);
        const { practice, declaration, cases } = prepareAllEditableCases(database, declarationKind);
        expect(cases).toHaveLength(expectedEditableCount);
        expect(declaration.declaration.declarationKind).toBe(declarationKind);

        let revision = savePreparedCases(database, {
          practiceId: practice.id,
          declarationId: declaration.id,
          expectedRevision: declaration.revision,
          cases,
          viewKind: "quadri",
          valueIndex: 0,
        });
        closeDatabase(directory);
        database = openDatabase(directory);
        expectPreparedCases(database, {
          practiceId: practice.id,
          declarationId: declaration.id,
          cases,
          valueIndex: 0,
        });

        revision = savePreparedCases(database, {
          practiceId: practice.id,
          declarationId: declaration.id,
          expectedRevision: revision,
          cases,
          viewKind: "operational",
          valueIndex: 1,
        });
        closeDatabase(directory);
        database = openDatabase(directory);
        expectPreparedCases(database, {
          practiceId: practice.id,
          declarationId: declaration.id,
          cases,
          valueIndex: 1,
        });
        expect(getDeclaration(database, declaration.id, practice.id)?.revision).toBe(revision);
      },
    );
  }

  it(
    "copia e isola tutti i 641 input applicabili alla prima dichiarazione",
    { timeout: 30_000 },
    () => {
      const directory = mkdtempSync(join(tmpdir(), "sequent-operational-declarations-"));
      directories.push(directory);
      let database = openDatabase(directory);
      const {
        practice,
        declaration,
        cases: baseCases,
      } = prepareAllEditableCases(database, "first");
      const duplicateOccurrenceIds = new Map<string, string>();
      const duplicateOccurrenceCases = editableRows
        .filter((row) => row.cardinality.entityScope === "occurrence")
        .map(runtimeCase)
        .map((testCase): PreparedRuntimeCase => {
          const occurrenceGroup = testCase.row.cardinality.occurrenceGroup;
          if (!occurrenceGroup)
            throw new Error(`OCCURRENCE_GROUP_NOT_FOUND:${testCase.row.fieldId}`);
          const occurrenceId = duplicateOccurrenceIds.get(occurrenceGroup) ?? randomUUID();
          duplicateOccurrenceIds.set(occurrenceGroup, occurrenceId);
          const values = syntheticValues(testCase);
          return {
            testCase,
            identity: { entityId: null, occurrenceId },
            values: [values[1] || values[0], ""],
          };
        });
      const cases = [...baseCases, ...duplicateOccurrenceCases];
      expect(baseCases).toHaveLength(641);
      expect(duplicateOccurrenceCases).toHaveLength(103);
      expect(duplicateOccurrenceIds.size).toBe(11);
      expect(cases).toHaveLength(744);

      const sourceRevision = savePreparedCases(database, {
        practiceId: practice.id,
        declarationId: declaration.id,
        expectedRevision: declaration.revision,
        cases,
        viewKind: "quadri",
        valueIndex: 0,
      });
      closeDatabase(directory);
      database = openDatabase(directory);
      const successive = createSuccessiveDeclaration(
        database,
        practice.id,
        declaration.id,
        "substitute-2",
      );
      closeDatabase(directory);
      database = openDatabase(directory);
      const sourceAfterCopy = getDeclaration(database, declaration.id, practice.id)!;
      const successiveAfterCopy = getDeclaration(database, successive.id, practice.id)!;
      const copiedFieldIds = new Set(
        Object.values(successiveAfterCopy.declaration.fields).map((field) => field.fieldId),
      );
      const successiveCases = cases.filter(({ testCase }) =>
        copiedFieldIds.has(testCase.row.fieldId),
      );
      expect(
        [...new Set(cases.map(({ testCase }) => testCase.row.fieldId))].filter(
          (fieldId) => !copiedFieldIds.has(fieldId),
        ),
      ).toEqual([
        "xsd:/Fornitura/Dichiarazione/Frontespizio/Presentatore/DecorrenzaTerminePresentazione",
      ]);
      const expectedCopiedFields = Object.fromEntries(
        Object.entries(sourceAfterCopy.declaration.fields).filter(([, field]) =>
          copiedFieldIds.has(field.fieldId),
        ),
      );
      expect(Object.keys(sourceAfterCopy.declaration.fields)).toHaveLength(744);
      expect(successiveCases).toHaveLength(743);
      expect(successiveAfterCopy.declaration.fields).toEqual(expectedCopiedFields);
      expectPreparedCases(database, {
        practiceId: practice.id,
        declarationId: successive.id,
        cases: successiveCases,
        valueIndex: 0,
      });

      const successiveRevision = savePreparedCases(database, {
        practiceId: practice.id,
        declarationId: successive.id,
        expectedRevision: successive.revision,
        cases: successiveCases,
        viewKind: "operational",
        valueIndex: 1,
      });
      closeDatabase(directory);
      database = openDatabase(directory);
      expectPreparedCases(database, {
        practiceId: practice.id,
        declarationId: declaration.id,
        cases,
        valueIndex: 0,
      });
      expectPreparedCases(database, {
        practiceId: practice.id,
        declarationId: successive.id,
        cases: successiveCases,
        valueIndex: 1,
      });
      expect(getDeclaration(database, declaration.id, practice.id)?.revision).toBe(sourceRevision);
      expect(getDeclaration(database, successive.id, practice.id)?.revision).toBe(
        successiveRevision,
      );
    },
  );

  for (const occurrenceFamily of occurrenceFamilies) {
    it(
      `crea, riordina e rimuove ${occurrenceFamily.groupId} (${occurrenceFamily.cases.length})`,
      { timeout: 30_000 },
      () => {
        const directory = mkdtempSync(join(tmpdir(), "sequent-operational-occurrence-"));
        directories.push(directory);
        let database = openDatabase(directory);
        const practice = createPractice(database, "Occorrenze sintetiche");
        const firstOccurrenceId = randomUUID();
        const secondOccurrenceId = randomUUID();
        const thirdOccurrenceId = randomUUID();
        const firstCases = occurrenceFamily.cases.map((testCase) => ({
          testCase,
          identity: { entityId: null, occurrenceId: firstOccurrenceId },
          values: syntheticValues(testCase),
        }));
        const secondCases = occurrenceFamily.cases.map((testCase) => {
          const values = syntheticValues(testCase);
          return {
            testCase,
            identity: { entityId: null, occurrenceId: secondOccurrenceId },
            values: [values[0], values[1] || values[0]] as [string, string],
          };
        });
        const thirdCases = occurrenceFamily.cases.map((testCase) => ({
          testCase,
          identity: { entityId: null, occurrenceId: thirdOccurrenceId },
          values: syntheticValues(testCase),
        }));
        expect(
          secondCases.some(({ values }, index) => values[1] !== firstCases[index]!.values[0]),
        ).toBe(true);
        let revision = savePreparedCases(database, {
          practiceId: practice.id,
          declarationId: practice.declarationId,
          expectedRevision: practice.revision,
          cases: firstCases,
          viewKind: "quadri",
          valueIndex: 0,
        });
        revision = savePreparedCases(database, {
          practiceId: practice.id,
          declarationId: practice.declarationId,
          expectedRevision: revision,
          cases: secondCases,
          viewKind: "operational",
          valueIndex: 1,
        });
        revision = savePreparedCases(database, {
          practiceId: practice.id,
          declarationId: practice.declarationId,
          expectedRevision: revision,
          cases: thirdCases,
          viewKind: "quadri",
          valueIndex: 0,
        });
        expect(
          listCanonicalOccurrenceIds(
            getDeclaration(database, practice.declarationId, practice.id)!.declaration,
            occurrenceFamily.groupId,
          ),
        ).toEqual([firstOccurrenceId, secondOccurrenceId, thirdOccurrenceId]);

        revision = reorderCanonicalOccurrencesFromView(database, {
          practiceId: practice.id,
          declarationId: practice.declarationId,
          expectedRevision: revision,
          view: quadriView(occurrenceFamily.cases[0]!.row),
          occurrenceGroup: occurrenceFamily.groupId,
          occurrenceIds: [thirdOccurrenceId, firstOccurrenceId, secondOccurrenceId],
        });
        closeDatabase(directory);
        database = openDatabase(directory);
        expect(
          listCanonicalOccurrenceIds(
            getDeclaration(database, practice.declarationId, practice.id)!.declaration,
            occurrenceFamily.groupId,
          ),
        ).toEqual([thirdOccurrenceId, firstOccurrenceId, secondOccurrenceId]);
        expectPreparedCases(database, {
          practiceId: practice.id,
          declarationId: practice.declarationId,
          cases: firstCases,
          valueIndex: 0,
        });
        expectPreparedCases(database, {
          practiceId: practice.id,
          declarationId: practice.declarationId,
          cases: secondCases,
          valueIndex: 1,
        });
        expectPreparedCases(database, {
          practiceId: practice.id,
          declarationId: practice.declarationId,
          cases: thirdCases,
          valueIndex: 0,
        });

        const revisionBeforeRemoval = revision;
        const beforeRemoval = getDeclaration(database, practice.declarationId, practice.id)!;
        const removedKeys = new Set(
          Object.entries(beforeRemoval.declaration.fields)
            .filter(([, field]) => field.occurrenceId === firstOccurrenceId)
            .map(([key]) => key),
        );
        expect(removedKeys.size).toBe(occurrenceFamily.cases.length);
        revision = removeCanonicalOccurrenceFromView(database, {
          practiceId: practice.id,
          declarationId: practice.declarationId,
          expectedRevision: revision,
          view: operationalView(occurrenceFamily.cases[0]!.row),
          occurrenceGroup: occurrenceFamily.groupId,
          occurrenceId: firstOccurrenceId,
        });
        closeDatabase(directory);
        database = openDatabase(directory);
        const afterRemoval = getDeclaration(database, practice.declarationId, practice.id)!;
        expect(
          listCanonicalOccurrenceIds(afterRemoval.declaration, occurrenceFamily.groupId),
        ).toEqual([thirdOccurrenceId, secondOccurrenceId]);
        expect(
          Object.values(afterRemoval.declaration.fields).some(
            (field) =>
              field.occurrenceId === firstOccurrenceId &&
              occurrenceFamily.cases.some(({ row }) => row.fieldId === field.fieldId),
          ),
        ).toBe(false);
        for (const removedKey of removedKeys) {
          expect(afterRemoval.declaration.fields[removedKey]).toBeUndefined();
          expect(afterRemoval.declaration.officialRuleConfirmations[removedKey]).toBeUndefined();
        }
        expectPreparedCases(database, {
          practiceId: practice.id,
          declarationId: practice.declarationId,
          cases: secondCases,
          valueIndex: 1,
        });
        expectPreparedCases(database, {
          practiceId: practice.id,
          declarationId: practice.declarationId,
          cases: thirdCases,
          valueIndex: 0,
        });
        expect(() =>
          reorderCanonicalOccurrencesFromView(database, {
            practiceId: practice.id,
            declarationId: practice.declarationId,
            expectedRevision: revisionBeforeRemoval,
            view: quadriView(occurrenceFamily.cases[0]!.row),
            occurrenceGroup: occurrenceFamily.groupId,
            occurrenceIds: [secondOccurrenceId, thirdOccurrenceId],
          }),
        ).toThrow("REVISION_CONFLICT");
        expect(() =>
          reorderCanonicalOccurrencesFromView(database, {
            practiceId: practice.id,
            declarationId: practice.declarationId,
            expectedRevision: revision,
            view: quadriView(occurrenceFamily.cases[0]!.row),
            occurrenceGroup: occurrenceFamily.groupId,
            occurrenceIds: [thirdOccurrenceId, thirdOccurrenceId],
          }),
        ).toThrow("OCCURRENCE_ORDER_INVALID");
        expect(() =>
          removeCanonicalOccurrenceFromView(database, {
            practiceId: practice.id,
            declarationId: practice.declarationId,
            expectedRevision: revision,
            view: operationalView(occurrenceFamily.cases[0]!.row),
            occurrenceGroup: occurrenceFamily.groupId,
            occurrenceId: firstOccurrenceId,
          }),
        ).toThrow("OCCURRENCE_NOT_FOUND");
        expect(getDeclaration(database, practice.declarationId, practice.id)?.revision).toBe(
          revision,
        );
      },
    );
  }

  for (const choiceFamily of coveredChoiceFamilies) {
    for (const declarationKind of DECLARATION_KINDS) {
      it(
        `applica ${choiceFamily.choiceGroup} nei due versi su ${declarationKind}`,
        { timeout: 30_000 },
        () => {
          const directory = mkdtempSync(join(tmpdir(), "sequent-operational-choice-"));
          directories.push(directory);
          let database = openDatabase(directory);
          const practice = createPractice(
            database,
            `Choice sintetica ${choiceFamily.choiceGroup} ${declarationKind}`,
          );
          const declaration =
            declarationKind === "first"
              ? getDeclaration(database, practice.declarationId, practice.id)!
              : createSuccessiveDeclaration(
                  database,
                  practice.id,
                  practice.declarationId,
                  declarationKind,
                );
          const representative = choiceFamily.alternatives[0]!.cases[0]!;
          const scope = representative.row.cardinality.entityScope;
          const subjectId =
            scope === "subject"
              ? createSharedSubject(database, practice.id, {
                  role: "beneficiary",
                  displayName: `Soggetto ${choiceFamily.choiceGroup}`,
                  declarationId: declaration.id,
                }).id
              : null;
          const asset =
            scope === "asset"
              ? createSharedAsset(database, practice.id, {
                  kind: ASSET_KIND_BY_QUADRO[choiceFamily.quadro],
                  displayName: `Bene ${choiceFamily.choiceGroup}`,
                  declarationId: declaration.id,
                })
              : null;
          const choiceContext = {
            decedentId: null,
            subjectId,
            assetIds: new Map<QuadroId, string>(asset ? [[choiceFamily.quadro, asset.id]] : []),
            occurrences: new Map<string, string>(),
          };
          const representativeIdentity = runtimeIdentity(representative, choiceContext);
          let revision = declaration.revision;
          if (choiceFamily.activator) {
            const activatorCase: PreparedRuntimeCase = {
              testCase: choiceFamily.activator,
              identity: runtimeIdentity(choiceFamily.activator, choiceContext),
              values: syntheticValues(choiceFamily.activator),
            };
            revision = savePreparedCases(database, {
              practiceId: practice.id,
              declarationId: declaration.id,
              expectedRevision: revision,
              cases: [activatorCase],
              viewKind: "quadri",
              valueIndex: 0,
            });
          }
          const contextIdentity =
            representativeIdentity.occurrenceId ?? representativeIdentity.entityId ?? "declaration";
          const missingChoiceId = `REQUIRED_CHOICE_MISSING:${choiceFamily.choiceGroup}:${contextIdentity}`;
          const exclusivityId = `CHOICE_EXCLUSIVITY_VIOLATION:${choiceFamily.choiceGroup}:${contextIdentity}`;
          const issuesWithoutAlternative = buildComplianceReport(
            database,
            practice.id,
            declaration.id,
          ).issues.map(({ id }) => id);
          if (choiceFamily.activator && choiceFamily.requiredWhenActive)
            expect(issuesWithoutAlternative).toContain(missingChoiceId);
          else expect(issuesWithoutAlternative).not.toContain(missingChoiceId);

          const firstAlternative = choiceFamily.alternatives[0]!.cases.map(
            (testCase): PreparedRuntimeCase => ({
              testCase,
              identity: runtimeIdentity(testCase, choiceContext),
              values: syntheticValues(testCase),
            }),
          );
          revision = savePreparedCases(database, {
            practiceId: practice.id,
            declarationId: declaration.id,
            expectedRevision: revision,
            cases: firstAlternative,
            viewKind: "quadri",
            valueIndex: 0,
          });
          const singleAlternativeIssues = buildComplianceReport(
            database,
            practice.id,
            declaration.id,
          ).issues.map(({ id }) => id);
          expect(singleAlternativeIssues).not.toContain(missingChoiceId);
          expect(singleAlternativeIssues).not.toContain(exclusivityId);
          expectPreparedCases(database, {
            practiceId: practice.id,
            declarationId: declaration.id,
            cases: firstAlternative,
            valueIndex: 0,
          });

          const secondAlternative = choiceFamily.alternatives[1]!.cases.map(
            (testCase): PreparedRuntimeCase => ({
              testCase,
              identity: runtimeIdentity(testCase, choiceContext),
              values: syntheticValues(testCase),
            }),
          );
          revision = savePreparedCases(database, {
            practiceId: practice.id,
            declarationId: declaration.id,
            expectedRevision: revision,
            cases: secondAlternative,
            viewKind: "operational",
            valueIndex: 0,
          });
          closeDatabase(directory);
          database = openDatabase(directory);
          expectPreparedCases(database, {
            practiceId: practice.id,
            declarationId: declaration.id,
            cases: [...firstAlternative, ...secondAlternative],
            valueIndex: 0,
          });
          expect(
            buildComplianceReport(database, practice.id, declaration.id).issues.map(({ id }) => id),
          ).toContain(exclusivityId);
          expect(getDeclaration(database, declaration.id, practice.id)?.revision).toBe(revision);
        },
      );
    }
  }

  for (const declarationKind of DECLARATION_KINDS) {
    it(
      `mantiene facoltativi i 260 campi XSD condizionali su ${declarationKind}`,
      { timeout: 30_000 },
      () => {
        const directory = mkdtempSync(join(tmpdir(), "sequent-operational-conditional-"));
        directories.push(directory);
        const database = openDatabase(directory);
        const practice = createPractice(database, `Condizionali sintetici ${declarationKind}`);
        const declaration =
          declarationKind === "first"
            ? getDeclaration(database, practice.declarationId, practice.id)!
            : createSuccessiveDeclaration(
                database,
                practice.id,
                practice.declarationId,
                declarationKind,
              );
        const decedent = createSharedSubject(database, practice.id, {
          role: "decedent",
          displayName: "Defunto condizionali",
        });
        const subject = createSharedSubject(database, practice.id, {
          role: "beneficiary",
          displayName: "Soggetto condizionali",
          declarationId: declaration.id,
        });
        const assetIds = new Map<QuadroId, string>();
        for (const quadro of new Set(
          conditionalContexts
            .flatMap(({ cases }) => cases)
            .filter(({ row }) => row.cardinality.entityScope === "asset")
            .map(({ row }) => row.quadro),
        )) {
          const asset = createSharedAsset(database, practice.id, {
            kind: ASSET_KIND_BY_QUADRO[quadro],
            displayName: `Bene condizionali ${quadro}`,
            declarationId: declaration.id,
          });
          assetIds.set(quadro, asset.id);
        }
        const context = {
          decedentId: decedent.id,
          subjectId: subject.id,
          assetIds,
          occurrences: new Map<string, string>(),
        };
        const activatedContexts = conditionalContexts.filter(
          (candidate): candidate is typeof candidate & { activator: RuntimeCase } =>
            candidate.activator !== undefined,
        );
        const activators = activatedContexts.map(({ activator }): PreparedRuntimeCase => ({
          testCase: activator,
          identity: runtimeIdentity(activator, context),
          values: syntheticValues(activator),
        }));
        let revision = savePreparedCases(database, {
          practiceId: practice.id,
          declarationId: declaration.id,
          expectedRevision: declaration.revision,
          cases: activators,
          viewKind: "quadri",
          valueIndex: 0,
        });
        const issueIds = new Set(
          buildComplianceReport(database, practice.id, declaration.id).issues.map(({ id }) => id),
        );
        for (const conditionalContext of activatedContexts) {
          const identity = runtimeIdentity(conditionalContext.cases[0]!, context);
          const contextIdentity = identity.occurrenceId ?? identity.entityId ?? "declaration";
          for (const { row } of conditionalContext.cases)
            expect(issueIds).not.toContain(
              `REQUIRED_FIELD_MISSING:${row.fieldId}:${contextIdentity}`,
            );
        }

        const declarationContext = conditionalContexts.find(
          ({ key }) => key === "EF|declaration|",
        )!;
        const firstActivator = declarationContext.cases[0]!;
        revision = savePreparedCases(database, {
          practiceId: practice.id,
          declarationId: declaration.id,
          expectedRevision: revision,
          cases: [
            {
              testCase: firstActivator,
              identity: { entityId: null, occurrenceId: null },
              values: syntheticValues(firstActivator),
            },
          ],
          viewKind: "quadri",
          valueIndex: 0,
        });
        const firstEfIssueIds = new Set(
          buildComplianceReport(database, practice.id, declaration.id).issues.map(({ id }) => id),
        );

        const secondPractice = createPractice(
          database,
          `Condizionali EF sintetici ${declarationKind}`,
        );
        const secondDeclaration =
          declarationKind === "first"
            ? getDeclaration(database, secondPractice.declarationId, secondPractice.id)!
            : createSuccessiveDeclaration(
                database,
                secondPractice.id,
                secondPractice.declarationId,
                declarationKind,
              );
        const secondActivator = declarationContext.cases[1]!;
        savePreparedCases(database, {
          practiceId: secondPractice.id,
          declarationId: secondDeclaration.id,
          expectedRevision: secondDeclaration.revision,
          cases: [
            {
              testCase: secondActivator,
              identity: { entityId: null, occurrenceId: null },
              values: syntheticValues(secondActivator),
            },
          ],
          viewKind: "operational",
          valueIndex: 0,
        });
        const secondEfIssueIds = new Set(
          buildComplianceReport(database, secondPractice.id, secondDeclaration.id).issues.map(
            ({ id }) => id,
          ),
        );
        for (const { row } of declarationContext.cases) {
          const requiredIssueId = `REQUIRED_FIELD_MISSING:${row.fieldId}:declaration`;
          const evidence =
            row.fieldId === firstActivator.row.fieldId ? secondEfIssueIds : firstEfIssueIds;
          expect(evidence).not.toContain(requiredIssueId);
        }
        expect(getDeclaration(database, declaration.id, practice.id)?.revision).toBe(revision);
      },
    );
  }

  it("mantiene i 5 derivati sulla stessa fonte, in sola lettura e con ricalcolo deterministico", () => {
    const before = { declarationKind: "first" as const, quadroEaTypeCounts: {} };
    const after = {
      declarationKind: "substitute-2" as const,
      quadroEaTypeCounts: { "1": 2, "2": 3, "3": 4 },
    };
    for (const row of derivedRows) {
      const officialField = runtimeCase(row).field;
      const operationalField = listOperationalAreaFields(row.candidateOperationalArea).find(
        (field) => field.canonicalId === row.fieldId,
      );
      expect(operationalField).toBeDefined();
      expect(officialField.derivedFrom).toBe(operationalField?.derivedFrom);
      expect(officialField.entryMode).toBe("derived");
      expect(isOperationalParityEditable(row)).toBe(false);
      const firstRead = deriveOfficialFieldValue(officialField.derivedFrom, before);
      expect(deriveOfficialFieldValue(operationalField?.derivedFrom, before)).toBe(firstRead);
      const recalculated = deriveOfficialFieldValue(officialField.derivedFrom, after);
      expect(deriveOfficialFieldValue(operationalField?.derivedFrom, after)).toBe(recalculated);
      expect(recalculated).not.toBe(firstRead);
    }
  });

  it("legge i 58 automatici della dichiarazione ordinaria dalla stessa esecuzione confermata e li blocca in entrambe le viste", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-operational-automatic-"));
    directories.push(directory);
    let database = openDatabase(directory);
    const practice = createPractice(database, "Automatici sintetici");
    const decedent = createSharedSubject(database, practice.id, {
      role: "decedent",
      displayName: "Defunto automatici",
    });
    const beneficiary = createSharedSubject(database, practice.id, {
      role: "beneficiary",
      displayName: "Beneficiario automatici",
    });
    const company = createSharedAsset(database, practice.id, {
      kind: "company",
      displayName: "Azienda automatica",
      valueCents: 20_000_000n,
    });
    let revision = saveCanonicalFieldsFromView(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 1,
      view: { kind: "quadri", quadro: "EA" },
      entityId: beneficiary.id,
      fields: [
        { fieldId: "quadro-ea.soggetto.tipo", value: "1" },
        { fieldId: "quadro-ea.soggetto.grado-parentela", value: "10" },
      ],
      confirmOfficialRules: true,
    }).revision;
    revision = saveCanonicalFieldsFromView(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: revision,
      view: { kind: "quadri", quadro: "Frontespizio" },
      entityId: decedent.id,
      fields: [{ fieldId: "frontespizio.defunto.data-decesso", value: "01012025" }],
      confirmOfficialRules: true,
    }).revision;
    revision = saveCanonicalFieldsFromView(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: revision,
      view: { kind: "quadri", quadro: "EN" },
      entityId: company.id,
      fields: [
        {
          fieldId: "xsd:/Fornitura/Dichiarazione/QuadroEN/Modulo/Aziende/Valore",
          value: "200000",
        },
      ],
      confirmOfficialRules: true,
    }).revision;
    revision = saveCanonicalFieldsFromView(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: revision,
      view: { kind: "quadri", quadro: "EF" },
      fields: [
        {
          fieldId:
            "xsd:/Fornitura/Dichiarazione/QuadroEF/SezioneVBis_ImpostaSuccessione/ImpostaCalcolata/TempisticaPagamento",
          value: "1",
        },
      ],
      confirmOfficialRules: true,
    }).revision;
    const scenario = saveDevolutionScenario(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: revision,
      shares: [
        {
          assetId: company.id,
          beneficiaryId: beneficiary.id,
          numerator: 1n,
          denominator: 1n,
          rightCode: "1",
        },
      ],
    });
    expect(scenario.issues).toEqual([]);
    revision = confirmDevolutionScenario(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      scenarioId: scenario.id,
      expectedRevision: revision,
    });
    const calculation = runSuccessionCalculation(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
    });
    expect(calculation.issues).toEqual([]);
    expect(calculation.status).toBe("draft");
    expect(Object.keys(calculation.declarationTaxes.officialFieldValues).sort()).toEqual(
      automaticRowsForFirst.map((row) => row.fieldId).sort(),
    );
    revision = confirmCalculationRun(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      calculationId: calculation.id,
      expectedRevision: revision,
    });
    const automatic = getAutomaticOfficialFieldValues(
      database,
      practice.id,
      practice.declarationId,
    );
    expect(automatic?.calculationId).toBe(calculation.id);

    for (const row of automaticRowsForFirst) {
      const expectedValue = calculation.declarationTaxes.officialFieldValues[row.fieldId];
      const fromQuadri = readCanonicalFieldsFromView(database, {
        practiceId: practice.id,
        declarationId: practice.declarationId,
        view: quadriView(row),
        fields: [{ fieldId: row.fieldId }],
      })[0];
      const fromOperational = readCanonicalFieldsFromView(database, {
        practiceId: practice.id,
        declarationId: practice.declarationId,
        view: operationalView(row),
        fields: [{ fieldId: row.fieldId }],
      })[0];
      expect(fromQuadri, row.fieldId).toMatchObject({
        fieldId: row.fieldId,
        value: expectedValue,
        state: "calculated",
      });
      expect(fromOperational, row.fieldId).toEqual(fromQuadri);
      for (const view of [quadriView(row), operationalView(row)]) {
        const rejected = saveCanonicalFieldsFromView(database, {
          practiceId: practice.id,
          declarationId: practice.declarationId,
          expectedRevision: revision,
          view,
          fields: [{ fieldId: row.fieldId, value: "999" }],
          confirmOfficialRules: true,
        });
        expect(rejected.revision, row.fieldId).toBe(revision);
        expect(rejected.issues[0]?.id, row.fieldId).toBe("FIELD_NOT_EDITABLE_FROM_VIEW");
      }
    }

    const snapshot = getDeclaration(database, practice.declarationId, practice.id)!;
    closeDatabase(directory);
    database = openDatabase(directory);
    expect(getDeclaration(database, practice.declarationId, practice.id)).toEqual(snapshot);
    expect(
      getAutomaticOfficialFieldValues(database, practice.id, practice.declarationId)?.values,
    ).toEqual(calculation.declarationTaxes.officialFieldValues);
    const successive = createSuccessiveDeclaration(
      database,
      practice.id,
      practice.declarationId,
      "substitute-1",
    );
    expect(getAutomaticOfficialFieldValues(database, practice.id, successive.id)).toBeNull();
    for (const row of automaticRowsForFirst) {
      for (const view of [quadriView(row), operationalView(row)])
        expect(
          readCanonicalFieldsFromView(database, {
            practiceId: practice.id,
            declarationId: successive.id,
            view,
            fields: [{ fieldId: row.fieldId }],
          })[0],
          `${row.fieldId} non deve ereditare il calcolo confermato della sorgente`,
        ).toBeUndefined();
    }
    expect(
      getAutomaticOfficialFieldValues(database, practice.id, practice.declarationId)?.values,
    ).toEqual(calculation.declarationTaxes.officialFieldValues);
  });

  it("ricalcola deterministicamente l’intera mappa degli automatici", () => {
    const baseOptions = {
      openingDate: "2025-01-01",
      automaticLandRegistry: true,
      copyRequested: false,
      paymentTiming: 1 as const,
    };
    const before = calculateDeclarationTaxSummary([], 0n, baseOptions).officialFieldValues;
    const repeated = calculateDeclarationTaxSummary([], 0n, baseOptions).officialFieldValues;
    const after = calculateDeclarationTaxSummary(
      [
        {
          assetId: "immobile-roma",
          beneficiaryId: "beneficiario",
          treatment: "estate",
          valueCents: 1_000_000n,
          assetValueCents: 1_000_000n,
          assetKind: "building",
          municipalityCode: "H501",
          provinceCode: "RM",
          relationshipCode: "01",
          rightCode: "1",
        },
        {
          assetId: "immobile-milano",
          beneficiaryId: "beneficiario",
          treatment: "estate",
          valueCents: 1_000_000n,
          assetValueCents: 1_000_000n,
          assetKind: "building",
          municipalityCode: "F205",
          provinceCode: "MI",
          relationshipCode: "01",
          rightCode: "1",
        },
      ],
      0n,
      {
        ...baseOptions,
        copyRequested: true,
        penaltiesCents: [100_00n, 200_00n],
        interestCents: [50_00n],
      },
    ).officialFieldValues;
    const snapshotAutomaticFieldIds = new Set([
      "xsd:/Fornitura/Dichiarazione/Frontespizio/IdentificativoProdSoftware",
      ...QUADRI.filter((quadro) => quadro !== "Frontespizio").map(
        (quadro) => `xsd:/Fornitura/Dichiarazione/Frontespizio/FirmaModello/Casella${quadro}`,
      ),
    ]);
    expect(Object.keys(before).sort()).toEqual(
      automaticRowsForFirst
        .map((row) => row.fieldId)
        .filter((fieldId) => !snapshotAutomaticFieldIds.has(fieldId))
        .sort(),
    );
    expect(repeated).toEqual(before);
    expect(after).not.toEqual(before);
    const declarationWithEa = {
      fields: {
        "campo-ea": {
          fieldId: "quadro-ea.soggetto.codice-fiscale",
          entityId: "soggetto-sintetico",
          occurrenceId: null,
          value: "RSSMRA80A01H501U",
        },
      },
    } as unknown as DeclarationSnapshot;
    const snapshotBefore = addSnapshotAutomaticOfficialFieldValues(declarationWithEa, before);
    const snapshotRepeated = addSnapshotAutomaticOfficialFieldValues(declarationWithEa, repeated);
    expect(Object.keys(snapshotBefore).sort()).toEqual(
      automaticRowsForFirst.map((row) => row.fieldId).sort(),
    );
    expect(snapshotRepeated).toEqual(snapshotBefore);
    expect(
      snapshotBefore["xsd:/Fornitura/Dichiarazione/Frontespizio/IdentificativoProdSoftware"],
    ).toBe("SEQUENT");
    expect(snapshotBefore["xsd:/Fornitura/Dichiarazione/Frontespizio/FirmaModello/CasellaEA"]).toBe(
      "1",
    );
    expect(snapshotBefore["xsd:/Fornitura/Dichiarazione/Frontespizio/FirmaModello/CasellaEB"]).toBe(
      "0",
    );
    expect(
      after[
        "xsd:/Fornitura/Dichiarazione/QuadroEF/SezioneIII_TassaIpotecaria/Circoscrizioni_Imposta"
      ],
    ).toBe("240");
    expect(
      after[
        "xsd:/Fornitura/Dichiarazione/QuadroEF/SezioneVI_SanzioniInteressi/TotaleDaVersare/TotaleDaVersare_Sanzioni"
      ],
    ).toBe("300");
  });

  it(
    "isola tutti i 305 input di soggetti e beni su 610 identità canoniche",
    { timeout: 30_000 },
    () => {
      const directory = mkdtempSync(join(tmpdir(), "sequent-operational-isolation-"));
      directories.push(directory);
      let database = openDatabase(directory);
      const practice = createPractice(database, "Isolamento sintetico");
      const firstSubject = createSharedSubject(database, practice.id, {
        role: "beneficiary",
        displayName: "Primo soggetto",
      });
      const secondSubject = createSharedSubject(database, practice.id, {
        role: "beneficiary",
        displayName: "Secondo soggetto",
      });
      const firstAssetIds = new Map<QuadroId, string>();
      const secondAssetIds = new Map<QuadroId, string>();
      for (const quadro of new Set(
        isolatedEntityCases
          .filter(({ row }) => row.cardinality.entityScope === "asset")
          .map(({ row }) => row.quadro),
      )) {
        const kind = ASSET_KIND_BY_QUADRO[quadro];
        if (!kind) throw new Error(`ASSET_KIND_NOT_FOUND:${quadro}`);
        const firstAsset = createSharedAsset(database, practice.id, {
          kind,
          displayName: `Primo bene ${quadro}`,
        });
        const secondAsset = createSharedAsset(database, practice.id, {
          kind,
          displayName: `Secondo bene ${quadro}`,
        });
        firstAssetIds.set(quadro, firstAsset.id);
        secondAssetIds.set(quadro, secondAsset.id);
      }
      const firstContext = {
        decedentId: null,
        subjectId: firstSubject.id,
        assetIds: firstAssetIds,
        occurrences: new Map<string, string>(),
      };
      const secondContext = {
        decedentId: null,
        subjectId: secondSubject.id,
        assetIds: secondAssetIds,
        occurrences: new Map<string, string>(),
      };
      const firstCases = isolatedEntityCases.map((testCase) => ({
        testCase,
        identity: runtimeIdentity(testCase, firstContext),
        values: syntheticValues(testCase),
      }));
      const secondCases = isolatedEntityCases.map((testCase) => ({
        testCase,
        identity: runtimeIdentity(testCase, secondContext),
        values: syntheticValues(testCase),
      }));

      let revision = savePreparedCases(database, {
        practiceId: practice.id,
        declarationId: practice.declarationId,
        expectedRevision: practice.revision,
        cases: firstCases,
        viewKind: "quadri",
        valueIndex: 0,
      });
      revision = savePreparedCases(database, {
        practiceId: practice.id,
        declarationId: practice.declarationId,
        expectedRevision: revision,
        cases: secondCases,
        viewKind: "operational",
        valueIndex: 0,
      });
      revision = savePreparedCases(database, {
        practiceId: practice.id,
        declarationId: practice.declarationId,
        expectedRevision: revision,
        cases: secondCases,
        viewKind: "operational",
        valueIndex: 1,
      });
      closeDatabase(directory);
      database = openDatabase(directory);
      expectPreparedCases(database, {
        practiceId: practice.id,
        declarationId: practice.declarationId,
        cases: firstCases,
        valueIndex: 0,
      });
      expectPreparedCases(database, {
        practiceId: practice.id,
        declarationId: practice.declarationId,
        cases: secondCases,
        valueIndex: 1,
      });
      expect(
        Object.keys(
          getDeclaration(database, practice.declarationId, practice.id)!.declaration.fields,
        ),
      ).toHaveLength(610);
      expect(getDeclaration(database, practice.declarationId, practice.id)?.revision).toBe(
        revision,
      );
    },
  );

  it(
    "copia tutti i 207 input EH nella successiva e isola 286 identità canoniche",
    { timeout: 30_000 },
    () => {
      const directory = mkdtempSync(join(tmpdir(), "sequent-operational-eh-"));
      directories.push(directory);
      let database = openDatabase(directory);
      const practice = createPractice(database, "EH sintetico");
      const occurrenceIds = new Map<string, [string, string]>();
      const cases = coveredEhCases.flatMap((testCase): PreparedRuntimeCase[] => {
        const values = syntheticValues(testCase);
        const occurrenceGroup = testCase.row.cardinality.occurrenceGroup;
        if (!occurrenceGroup)
          return [
            {
              testCase,
              identity: { entityId: null, occurrenceId: null },
              values,
            },
          ];
        const identities: [string, string] = occurrenceIds.get(occurrenceGroup) ?? [
          randomUUID(),
          randomUUID(),
        ];
        occurrenceIds.set(occurrenceGroup, identities);
        return [
          {
            testCase,
            identity: { entityId: null, occurrenceId: identities[0] },
            values,
          },
          {
            testCase,
            identity: { entityId: null, occurrenceId: identities[1] },
            values: [values[1] || values[0], ""],
          },
        ];
      });
      expect(occurrenceIds.size).toBe(6);
      expect(cases).toHaveLength(286);

      const sourceRevision = savePreparedCases(database, {
        practiceId: practice.id,
        declarationId: practice.declarationId,
        expectedRevision: practice.revision,
        cases,
        viewKind: "quadri",
        valueIndex: 0,
      });
      closeDatabase(directory);
      database = openDatabase(directory);
      expectPreparedCases(database, {
        practiceId: practice.id,
        declarationId: practice.declarationId,
        cases,
        valueIndex: 0,
      });

      const successive = createSuccessiveDeclaration(
        database,
        practice.id,
        practice.declarationId,
        "substitute-3",
      );
      closeDatabase(directory);
      database = openDatabase(directory);
      const sourceAfterCopy = getDeclaration(database, practice.declarationId, practice.id)!;
      const successiveAfterCopy = getDeclaration(database, successive.id, practice.id)!;
      expect(Object.keys(sourceAfterCopy.declaration.fields)).toHaveLength(286);
      expect(successiveAfterCopy.declaration.fields).toEqual(sourceAfterCopy.declaration.fields);
      expectPreparedCases(database, {
        practiceId: practice.id,
        declarationId: successive.id,
        cases,
        valueIndex: 0,
      });

      const successiveRevision = savePreparedCases(database, {
        practiceId: practice.id,
        declarationId: successive.id,
        expectedRevision: successive.revision,
        cases,
        viewKind: "operational",
        valueIndex: 1,
      });
      closeDatabase(directory);
      database = openDatabase(directory);
      expectPreparedCases(database, {
        practiceId: practice.id,
        declarationId: practice.declarationId,
        cases,
        valueIndex: 0,
      });
      expectPreparedCases(database, {
        practiceId: practice.id,
        declarationId: successive.id,
        cases,
        valueIndex: 1,
      });
      expect(getDeclaration(database, practice.declarationId, practice.id)?.revision).toBe(
        sourceRevision,
      );
      expect(getDeclaration(database, successive.id, practice.id)?.revision).toBe(
        successiveRevision,
      );
    },
  );

  it("mantiene gli 8 campi riservati all’ufficio visibili e non producibili da Sequent", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-operational-office-reserved-"));
    directories.push(directory);
    let database = openDatabase(directory);
    const practice = createPractice(database, "Campi ufficio sintetici");
    const declaration = getDeclaration(database, practice.declarationId, practice.id)!;
    const snapshotBeforeAttempts = getDeclaration(database, declaration.id, practice.id)!;

    for (const row of officeReservedRows) {
      const attemptedValue = syntheticValues(runtimeCase(row))[0];
      for (const view of [quadriView(row), operationalView(row)]) {
        const result = saveCanonicalFieldsFromView(database, {
          practiceId: practice.id,
          declarationId: declaration.id,
          expectedRevision: declaration.revision,
          view,
          fields: [{ fieldId: row.fieldId, value: attemptedValue }],
          confirmOfficialRules: true,
        });
        expect(result.revision, `${view.kind}:${row.fieldId}`).toBe(declaration.revision);
        expect(result.issues, `${view.kind}:${row.fieldId}`).toEqual([
          expect.objectContaining({
            id: "FIELD_NOT_EDITABLE_FROM_VIEW",
            level: "blocking",
            fieldId: row.fieldId,
          }),
        ]);
        expect(
          readCanonicalFieldsFromView(database, {
            practiceId: practice.id,
            declarationId: declaration.id,
            view,
            fields: [{ fieldId: row.fieldId }],
          })[0],
          `${view.kind}:${row.fieldId}`,
        ).toBeUndefined();
      }
    }

    closeDatabase(directory);
    database = openDatabase(directory);
    expect(getDeclaration(database, declaration.id, practice.id)).toEqual(snapshotBeforeAttempts);
  });

  it("rifiuta revisioni stale e campi fuori vista o non applicabili", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-operational-boundary-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Confini sintetici");
    const row = editableRows.find(
      (candidate) => candidate.cardinality.entityScope === "declaration",
    )!;
    const values = syntheticValues(runtimeCase(row));
    const first = saveCanonicalFieldsFromView(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 1,
      view: quadriView(row),
      fields: [{ fieldId: row.fieldId, value: values[0] }],
      confirmOfficialRules: true,
    });
    expect(first.issues).toEqual([]);
    expect(() =>
      saveCanonicalFieldsFromView(database, {
        practiceId: practice.id,
        declarationId: practice.declarationId,
        expectedRevision: 1,
        view: operationalView(row),
        fields: [{ fieldId: row.fieldId, value: values[1] }],
        confirmOfficialRules: true,
      }),
    ).toThrow("REVISION_CONFLICT");

    const substituteOnly = checkedInMap.find(
      (candidate) => candidate.fieldId === "frontespizio.dichiarazione-precedente.anno",
    )!;
    const notApplicable = saveCanonicalFieldsFromView(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: first.revision,
      view: quadriView(substituteOnly),
      fields: [{ fieldId: substituteOnly.fieldId, value: "2020" }],
      confirmOfficialRules: true,
    });
    expect(notApplicable.issues[0]?.id).toBe("FIELD_NOT_EDITABLE_FROM_VIEW");
    const wrongOperationalArea = saveCanonicalFieldsFromView(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: first.revision,
      view: { kind: "operational", section: "documents" },
      fields: [{ fieldId: row.fieldId, value: values[1] }],
      confirmOfficialRules: true,
    });
    expect(wrongOperationalArea.issues[0]?.id).toBe("FIELD_NOT_EDITABLE_FROM_VIEW");
  });
});
