import { QUADRI, listQuadroFields, type QuadroId } from "./official-catalog/catalog.ts";

export const OPERATIONAL_AREAS = [
  "Panoramica",
  "Documenti",
  "Persone",
  "Patrimonio",
  "Devoluzione",
  "Imposte e pagamenti",
  "Controlli finali",
  "Riepilogo finale",
] as const;

export type OperationalArea = (typeof OPERATIONAL_AREAS)[number];
export const OPERATIONAL_SECTION_AREAS = {
  overview: "Panoramica",
  documents: "Documenti",
  people: "Persone",
  estate: "Patrimonio",
  devolution: "Devoluzione",
  taxes: "Imposte e pagamenti",
  checks: "Controlli finali",
  final: "Riepilogo finale",
} as const satisfies Record<string, OperationalArea>;

export type OperationalSectionId = keyof typeof OPERATIONAL_SECTION_AREAS;
type OperationalVisibility = "esatta" | "sintetica" | "assente";
type OperationalEditability = "completa" | "sola-lettura" | "assente";
type CoverageStatus = "coperto" | "parziale" | "mancante";
type FieldHandling = "inserito" | "derivato" | "gestito-automaticamente";
type SemanticReviewStatus = "qualificata" | "candidata" | "irrisolta";
type SemanticCategory =
  | "dato-professionale"
  | "importo-professionale"
  | "totale-o-importo-calcolato"
  | "casella-di-presenza-o-scelta"
  | "sottoscrizione"
  | "dato-di-servizio"
  | "indicatore-derivato";

interface ReviewEvidence {
  status: SemanticReviewStatus;
  reason: string;
  provenance: string[];
  blocker: string | null;
}

export interface OperationalParityRow {
  fieldId: string;
  technicalPath: string;
  quadro: QuadroId;
  officialSection: string | null;
  visibleNumber: string | null;
  label: string;
  professionalObject: string;
  cardinality: {
    fieldMin: number;
    fieldMax: number | "unbounded";
    effectiveMin: number;
    effectiveMax: number | "unbounded";
    entityScope: "decedent" | "subject" | "asset" | "occurrence" | "declaration";
    occurrenceGroup: string | null;
  };
  applicability: {
    declarationKinds: Array<"first" | "substitute-1" | "substitute-2" | "substitute-3"> | ["all"];
    xsdPresence: "obbligatorio-nel-contesto" | "condizionale";
    choiceGroup: string | null;
    officialRuleIds: string[];
  };
  semanticCategory: SemanticCategory;
  handling: FieldHandling | null;
  handlingBasis:
    | "explicit-derived-rule"
    | "official-deterministic-rule"
    | "professional-attestation"
    | "explicit-professional-input"
    | "professional-object-input"
    | "catalog-default-candidate"
    | "insufficient-official-source";
  semanticReview: ReviewEvidence;
  declarationIdentity: {
    owner: "snapshot-della-dichiarazione-selezionata";
    successiveDeclarationBehavior: "copiato-alla-creazione-poi-isolato";
    liveReferenceToSourceDeclaration: false;
    identityDimensions: string[];
    ehMeaning: "quadro-EH-della-dichiarazione-selezionata" | null;
    review: ReviewEvidence;
  };
  operationalVisibility: OperationalVisibility;
  operationalEditability: OperationalEditability;
  candidateOperationalArea: OperationalArea;
  candidateContext: string;
  destinationReview: ReviewEvidence & { uiDecision: "definitiva" | "non-definitiva" };
  currentCoverage: CoverageStatus;
  coverageReason: string;
  currentEvidence: string[];
  requiredParityTests: string[];
}

type VisibleCatalogField = ReturnType<typeof listQuadroFields>[number];

const ASSET_QUADRI = new Set<QuadroId>([
  "EB",
  "EC",
  "ED",
  "EL",
  "EM",
  "EN",
  "EO",
  "EP",
  "EQ",
  "ER",
]);

const ASSET_OBJECTS: Partial<Record<QuadroId, string>> = {
  EB: "terreno",
  EC: "fabbricato",
  ED: "passività",
  EL: "terreno tavolare",
  EM: "fabbricato tavolare",
  EN: "azienda o partecipazione aziendale",
  EO: "titolo o rapporto finanziario",
  EP: "aeromobile",
  EQ: "nave o imbarcazione",
  ER: "altro bene, rendita, credito o denaro",
};

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function officialProvenance(field: VisibleCatalogField): string[] {
  return unique([
    ...field.sourceIds,
    `${field.sourceId}:${field.sourcePointer}`,
    ...field.instructions.map((instruction) => `${instruction.id}:${instruction.sourcePointer}`),
  ]);
}

function officialText(field: VisibleCatalogField): string {
  return [...field.documentation, ...field.instructions.map((item) => item.instruction)]
    .join(" ")
    .toLocaleLowerCase("it");
}

function isAssetDistribution(path: string): boolean {
  return (
    path.includes("/Devoluzione") ||
    path.includes("/Ripartizione") ||
    path.includes("/IdentificazioneSoggetto") ||
    path.includes("/QuotaElementi")
  );
}

function isSignature(field: VisibleCatalogField): boolean {
  return field.name.includes("Firma") || field.path.includes("/FirmaModello/FirmaDichiarante");
}

function isCompiledQuadroBox(field: VisibleCatalogField): boolean {
  return /\/FirmaModello\/Casella(?:EA|EB|EC|ED|EE|EF|EG|EH|EI|EL|EM|EN|EO|EP|EQ|ER)$/.test(
    field.path,
  );
}

function isServiceField(field: VisibleCatalogField): boolean {
  return (
    field.path.includes("/CampiServizio/") || field.path.endsWith("/IdentificativoProdSoftware")
  );
}

function isPresenceOrChoice(field: VisibleCatalogField): boolean {
  return (
    field.control === "checkbox" ||
    /^(?:Flag|Presenza|Casella)/.test(field.name) ||
    field.path.includes("/Opzioni/")
  );
}

function isAmount(field: VisibleCatalogField): boolean {
  return /(?:Valore|Importo|Imposta|Acconto|Sanzioni|Interessi|DaVersare|Versata)$/.test(
    field.name,
  );
}

function hasDeterministicOfficialRule(quadro: QuadroId, field: VisibleCatalogField): boolean {
  if (quadro !== "EE" && quadro !== "EF") return false;
  return /\bdeve essere (?:uguale|pari)\b/.test(officialText(field));
}

function isUnresolvedEfAmount(quadro: QuadroId, field: VisibleCatalogField): boolean {
  if (quadro !== "EF" || hasDeterministicOfficialRule(quadro, field)) return false;
  if (field.name === "ImpostaNonDovuta") return false;
  return (
    field.name === "Imposta" ||
    (field.name === "CreditoImposta" && field.documentation.length === 0) ||
    /_(?:Sanzioni|Interessi)$/.test(field.name)
  );
}

function professionalObject(quadro: QuadroId, path: string): string {
  if (quadro === "EA") return "posizione successoria del soggetto";
  if (ASSET_QUADRI.has(quadro))
    return isAssetDistribution(path)
      ? `attribuzione di ${ASSET_OBJECTS[quadro] ?? "bene"}`
      : (ASSET_OBJECTS[quadro] ?? "bene o passività");
  if (quadro === "EE") return "riepilogo dell’attivo e del passivo";
  if (quadro === "EF") return "liquidazione, tributo o pagamento";
  if (quadro === "EG") return "documento o allegato della dichiarazione";
  if (quadro === "EI")
    return path.includes("/Presentatore/")
      ? "presentatore"
      : path.includes("/SezioneI_AttiLegali/")
        ? "atto o passaggio legale"
        : "immobile e dati dell’intestatario";
  if (quadro === "EH") {
    if (path.includes("/SezioneII_AgevPrimaCasa/")) return "agevolazione prima casa";
    if (path.includes("/SezioneIII_CreditoImposta/")) return "credito d’imposta";
    if (path.includes("/SezioneIV_AltreAgevRiduz/"))
      return path.includes("EstremiDonazionePrecedente")
        ? "donazione precedente"
        : "agevolazione, esenzione o riduzione";
    if (path.includes("/DatiDefunto/")) return "defunto indicato nel Quadro EH";
    if (path.includes("/Eredi/") || path.includes("/Interdetti/") || path.includes("/Rinuncia/"))
      return "soggetto indicato nel Quadro EH";
    return "situazione dichiarata nel Quadro EH";
  }
  if (path.includes("/DatiDefunto/") || path.endsWith("/CodiceFiscaleDefunto")) return "defunto";
  if (path.includes("/Presentatore/")) return "presentatore";
  if (path.includes("/ImpegnoATrasmettere/")) return "intermediario";
  if (path.includes("/Versamento/") || path.includes("/F24/") || path.endsWith("/ImportoDaVersare"))
    return "pagamento della dichiarazione";
  if (
    path.includes("/FirmaModello/") ||
    path.includes("/CampiServizio/") ||
    path.endsWith("/IdentificativoProdSoftware") ||
    path.endsWith("/FirmaDichiarante")
  )
    return "modello finale e dati di servizio";
  if (path.includes("/Beneficiari/")) return "riepilogo dei beneficiari";
  if (path.includes("/Testamento/")) return "testamento";
  if (path.includes("/Devoluzione/")) return "titolo della devoluzione";
  return "dichiarazione";
}

function candidateDestination(
  quadro: QuadroId,
  field: VisibleCatalogField,
): { area: OperationalArea; context: string; unresolved: boolean } {
  const path = field.path;
  if (isServiceField(field))
    return {
      area: "Controlli finali",
      context: "Dettaglio tecnico di produzione o ricezione, fuori dalla navigazione ordinaria",
      unresolved: true,
    };
  if (isSignature(field))
    return {
      area: "Riepilogo finale",
      context: "Sottoscrizione o attestazione finale nel proprio contesto dichiarativo",
      unresolved: false,
    };
  if (quadro === "EA")
    return { area: "Persone", context: "Scheda e posizione successoria", unresolved: false };
  if (ASSET_QUADRI.has(quadro))
    return isAssetDistribution(path)
      ? {
          area: "Devoluzione",
          context: "Attribuzione del singolo bene o della passività",
          unresolved: false,
        }
      : {
          area: "Patrimonio",
          context: `Scheda ${ASSET_OBJECTS[quadro] ?? "del bene"}`,
          unresolved: false,
        };
  if (quadro === "EE")
    return {
      area: "Controlli finali",
      context: "Quadratura dell’attivo e del passivo",
      unresolved: false,
    };
  if (quadro === "EF")
    return {
      area: "Imposte e pagamenti",
      context: "Liquidazione e importi da versare",
      unresolved: false,
    };
  if (quadro === "EG")
    return {
      area: "Documenti",
      context: "Allegati richiesti e documenti inclusi",
      unresolved: false,
    };
  if (quadro === "EI")
    return path.includes("/Presentatore/")
      ? { area: "Persone", context: "Presentatore degli atti legali", unresolved: false }
      : {
          area: "Patrimonio",
          context: "Volture, intestazioni e passaggi senza atti",
          unresolved: false,
        };
  if (quadro === "EH") {
    if (path.includes("/SezioneII_AgevPrimaCasa/"))
      return {
        area: "Patrimonio",
        context: "Agevolazioni collegate agli immobili della dichiarazione selezionata",
        unresolved: false,
      };
    if (path.includes("/SezioneIII_CreditoImposta/") || path.includes("/SezioneIV_AltreAgevRiduz/"))
      return {
        area: "Imposte e pagamenti",
        context: "Crediti, esenzioni e riduzioni della dichiarazione selezionata",
        unresolved: false,
      };
    if (
      path.includes("/Presentatore/") ||
      path.includes("/Eredi/") ||
      path.includes("/Interdetti/") ||
      path.includes("/Rinuncia/") ||
      path.includes("/DatiDefunto/") ||
      path.includes("/Separazione/") ||
      path.includes("/Dichiarante/")
    )
      return {
        area: "Persone",
        context: "Soggetti ed eventi personali del Quadro EH selezionato",
        unresolved: false,
      };
    if (path.includes("/Testamento/") || path.includes("/ReintegroDiritti/"))
      return {
        area: "Devoluzione",
        context: "Titolo ed eventi che incidono sulla devoluzione nel Quadro EH",
        unresolved: false,
      };
    if (path.includes("/Aziende/") || path.includes("/Navi/") || path.includes("/Aeromobili/"))
      return {
        area: "Patrimonio",
        context: "Eventi patrimoniali sopravvenuti nel Quadro EH",
        unresolved: false,
      };
    return {
      area: "Panoramica",
      context: "Indicatori generali del Quadro EH della dichiarazione selezionata",
      unresolved: false,
    };
  }
  if (
    path.includes("/DatiDefunto/") ||
    path.endsWith("/CodiceFiscaleDefunto") ||
    path.includes("/Presentatore/")
  )
    return {
      area: "Persone",
      context: path.includes("/Presentatore/") ? "Presentatore" : "Defunto",
      unresolved: false,
    };
  if (path.includes("/Versamento/") || path.includes("/F24/") || path.endsWith("/ImportoDaVersare"))
    return { area: "Imposte e pagamenti", context: "Addebito e versamento", unresolved: false };
  if (path.includes("/FirmaModello/") || path.includes("/ImpegnoATrasmettere/"))
    return {
      area: "Riepilogo finale",
      context: "Modello, sottoscrizione e trasmissione",
      unresolved: false,
    };
  if (path.includes("/Devoluzione/") || path.includes("/Beneficiari/"))
    return {
      area: "Devoluzione",
      context: "Titolo e riepilogo della devoluzione",
      unresolved: false,
    };
  return {
    area: "Panoramica",
    context: "Dati generali della dichiarazione",
    unresolved: false,
  };
}

function handlingAssessment(
  quadro: QuadroId,
  field: VisibleCatalogField,
): Pick<
  OperationalParityRow,
  "semanticCategory" | "handling" | "handlingBasis" | "semanticReview"
> {
  const provenance = officialProvenance(field);
  if (field.entryMode === "derived" && field.derivedFrom)
    return {
      semanticCategory: "indicatore-derivato",
      handling: "derivato",
      handlingBasis: "explicit-derived-rule",
      semanticReview: {
        status: "qualificata",
        reason: `Il catalogo collega esplicitamente il campo alla fonte ${field.derivedFrom}.`,
        provenance: [...provenance, "src/domain/derived-fields.ts#deriveOfficialFieldValue"],
        blocker: null,
      },
    };
  if (isServiceField(field))
    return {
      semanticCategory: "dato-di-servizio",
      handling: null,
      handlingBasis: "insufficient-official-source",
      semanticReview: {
        status: "irrisolta",
        reason:
          "Le fonti qualificano percorso, tipo e condizioni di presenza, ma non identificano il soggetto che produce il valore.",
        provenance,
        blocker:
          "Serve una fonte ufficiale o un contratto di trasmissione che attribuisca esplicitamente la produzione del dato al software, all’ufficio o al professionista.",
      },
    };
  if (isCompiledQuadroBox(field))
    return {
      semanticCategory: "casella-di-presenza-o-scelta",
      handling: null,
      handlingBasis: "insufficient-official-source",
      semanticReview: {
        status: "irrisolta",
        reason:
          "Il modello identifica la casella del Quadro compilato, ma le fonti catalogate non stabiliscono se debba essere valorizzata dal professionista o derivata dalla presenza dei Quadri.",
        provenance: [...provenance, "src/lib/server/official-facsimile.ts#derivedFrontValues"],
        blocker:
          "Qualificare con una regola ufficiale la relazione fra presenza del Quadro e casella del frontespizio; l’implementazione del facsimile è solo evidenza del comportamento attuale.",
      },
    };
  if (field.path.endsWith("/Frontespizio/ImportoDaVersare"))
    return {
      semanticCategory: "importo-professionale",
      handling: null,
      handlingBasis: "insufficient-official-source",
      semanticReview: {
        status: "irrisolta",
        reason:
          "La fonte definisce quando il campo è obbligatorio, ma non fornisce una formula né attribuisce esplicitamente l’inserimento.",
        provenance,
        blocker:
          "Serve la regola ufficiale che colleghi l’importo del frontespizio agli importi EF o una fonte che lo dichiari inserito.",
      },
    };
  if (isUnresolvedEfAmount(quadro, field))
    return {
      semanticCategory: "importo-professionale",
      handling: null,
      handlingBasis: "insufficient-official-source",
      semanticReview: {
        status: "irrisolta",
        reason:
          "Per questo importo EF la fonte non contiene una formula deterministica né una regola esplicita di valorizzazione professionale.",
        provenance,
        blocker:
          "Qualificare la provenienza dell’importo tramite guida di calcolo, istruzione ufficiale o contratto di acquisizione esterno.",
      },
    };
  if (quadro === "EF" && field.name === "ImpostaNonDovuta")
    return {
      semanticCategory: "casella-di-presenza-o-scelta",
      handling: "gestito-automaticamente",
      handlingBasis: "official-deterministic-rule",
      semanticReview: {
        status: "qualificata",
        reason:
          "L’XSD fissa il valore a 1 e la regola ufficiale determina la presenza in base al presentatore e alle caselle di disabilità del Quadro EA.",
        provenance: [
          ...provenance,
          "SRC-08:/Fornitura/Dichiarazione/QuadroEF/SezioneVBis_ImpostaSuccessione/ImpostaNonDovuta@fixed=1",
        ],
        blocker: null,
      },
    };
  if (hasDeterministicOfficialRule(quadro, field))
    return {
      semanticCategory: "totale-o-importo-calcolato",
      handling: "gestito-automaticamente",
      handlingBasis: "official-deterministic-rule",
      semanticReview: {
        status: "qualificata",
        reason:
          "La regola ufficiale definisce un’uguaglianza o una formula deterministica rispetto ad altri campi.",
        provenance,
        blocker: null,
      },
    };
  if (isSignature(field))
    return {
      semanticCategory: "sottoscrizione",
      handling: "inserito",
      handlingBasis: "professional-attestation",
      semanticReview: {
        status: "qualificata",
        reason:
          "Il campo rappresenta una sottoscrizione o attestazione professionale visibile e non un risultato calcolabile da altri dati.",
        provenance,
        blocker: null,
      },
    };
  if (
    quadro === "EF" &&
    /(?:pu[oò] essere valorizzato|indicare il numero)/.test(officialText(field))
  )
    return {
      semanticCategory: isAmount(field) ? "importo-professionale" : "dato-professionale",
      handling: "inserito",
      handlingBasis: "explicit-professional-input",
      semanticReview: {
        status: "qualificata",
        reason:
          "La fonte descrive esplicitamente la valorizzazione del dato professionale e i relativi vincoli, senza definirne una formula automatica.",
        provenance,
        blocker: null,
      },
    };
  if (isPresenceOrChoice(field))
    return {
      semanticCategory: "casella-di-presenza-o-scelta",
      handling: "inserito",
      handlingBasis: "catalog-default-candidate",
      semanticReview: {
        status: "candidata",
        reason:
          "Il modello espone una casella o scelta professionale, ma le fonti non escludono in modo esplicito che la sua presenza possa essere derivata da altri dati.",
        provenance,
        blocker: null,
      },
    };
  const scope = field.entityScope ?? "declaration";
  if (scope !== "declaration" || quadro === "EG")
    return {
      semanticCategory: isAmount(field) ? "importo-professionale" : "dato-professionale",
      handling: "inserito",
      handlingBasis: "professional-object-input",
      semanticReview: {
        status: "qualificata",
        reason:
          "Il campo descrive direttamente un soggetto, bene, documento o occorrenza professionale identificata dal catalogo, senza una regola di derivazione associata.",
        provenance,
        blocker: null,
      },
    };
  return {
    semanticCategory: isAmount(field) ? "importo-professionale" : "dato-professionale",
    handling: "inserito",
    handlingBasis: "catalog-default-candidate",
    semanticReview: {
      status: "candidata",
      reason:
        "La classificazione come inserito resta una proposta: il catalogo usa il default editabile, ma non contiene una regola esplicita sul produttore del valore.",
      provenance,
      blocker: null,
    },
  };
}

function declarationIdentity(
  quadro: QuadroId,
  field: VisibleCatalogField,
): OperationalParityRow["declarationIdentity"] {
  const scope = field.entityScope ?? "declaration";
  const identityDimensions = [
    "declarationId",
    "fieldId",
    ...(scope === "subject" || scope === "asset" || scope === "decedent" ? ["entityId"] : []),
    ...(scope === "occurrence" ? ["occurrenceId"] : []),
  ];
  return {
    owner: "snapshot-della-dichiarazione-selezionata",
    successiveDeclarationBehavior: "copiato-alla-creazione-poi-isolato",
    liveReferenceToSourceDeclaration: false,
    identityDimensions,
    ehMeaning: quadro === "EH" ? "quadro-EH-della-dichiarazione-selezionata" : null,
    review: {
      status: "qualificata",
      reason:
        quadro === "EH"
          ? "Il campo EH appartiene al JSON revisionato della dichiarazione selezionata: non è un contenitore globale delle dichiarazioni successive né un riferimento vivo alla dichiarazione sorgente. Alla creazione di una successiva viene copiato nello snapshot e da quel momento evolve isolatamente."
          : "Il campo appartiene al JSON revisionato della dichiarazione selezionata; una dichiarazione successiva ne riceve una copia iniziale e poi evolve isolatamente.",
      provenance: [
        "docs/contracts/data-model.md#fondazione-persistente",
        "docs/contracts/data-model.md#dominio-della-pratica",
        "src/lib/server/practices.ts#createSuccessiveDeclaration",
        "src/domain/declaration.ts#canonicalFieldKey",
      ],
      blocker: null,
    },
  };
}

function destinationReview(
  destination: ReturnType<typeof candidateDestination>,
): OperationalParityRow["destinationReview"] {
  if (destination.unresolved)
    return {
      status: "irrisolta",
      reason:
        "L’area è soltanto il punto tecnico più vicino: non è ancora dimostrato che il campo debba essere visibile nella navigazione operativa ordinaria.",
      provenance: [
        "docs/contracts/operational-view-parity.md#criterio-di-qualificazione-semantica",
      ],
      blocker:
        "Decidere, con il contratto di produzione o trasmissione, se il dato tecnico debba essere nascosto, diagnostico o consultabile nei controlli finali.",
      uiDecision: "non-definitiva",
    };
  return {
    status: "qualificata",
    reason:
      "L’area è stata confermata come destinazione professionale della vista operativa; il campo conserva identità e persistenza canoniche della vista Quadri.",
    provenance: [
      "docs/MASTER_PLAN.md#83-sezioni-della-vista-operativa",
      "docs/contracts/operational-view-parity.md#destinazioni-operative",
    ],
    blocker: null,
    uiDecision: "definitiva",
  };
}

function currentOperationalCoverage(
  destination: ReturnType<typeof candidateDestination>,
  assessment: ReturnType<typeof handlingAssessment>,
): Pick<
  OperationalParityRow,
  | "operationalVisibility"
  | "operationalEditability"
  | "currentCoverage"
  | "coverageReason"
  | "currentEvidence"
> {
  if (destination.unresolved)
    return {
      operationalVisibility: "assente",
      operationalEditability: "assente",
      currentCoverage: "mancante",
      coverageReason:
        "Il dato tecnico o di servizio non ha una destinazione approvata nella navigazione operativa ordinaria.",
      currentEvidence: [
        "src/domain/operational-parity.ts#listOperationalAreaFields",
        "src/lib/components/OperationalAreaFields.svelte",
      ],
    };
  if (isOperationalParityEditable(assessment))
    return {
      operationalVisibility: "esatta",
      operationalEditability: "completa",
      currentCoverage: "coperto",
      coverageReason:
        "Il campo canonico è visibile e modificabile nella propria area operativa e viene salvato dalla stessa azione usata nella Vista Quadri.",
      currentEvidence: [
        "src/domain/operational-parity.ts#listOperationalAreaFields",
        "src/lib/components/OperationalFieldGroup.svelte",
        "src/routes/pratiche/[id]/+page.server.ts#saveFields",
      ],
    };
  if (assessment.handling === "derivato")
    return {
      operationalVisibility: "esatta",
      operationalEditability: "sola-lettura",
      currentCoverage: "coperto",
      coverageReason:
        "Il valore derivato è mostrato in sola lettura in entrambe le viste dalla stessa funzione deterministica.",
      currentEvidence: [
        "src/domain/operational-parity.ts#listOperationalAreaFields",
        "src/lib/components/OfficialFieldControl.svelte",
        "src/domain/derived-fields.ts#deriveOfficialFieldValue",
      ],
    };
  const reason =
    assessment.semanticReview.status === "candidata"
      ? "Il campo canonico è visibile, ma resta in sola lettura nella Vista operativa finché la modalità di compilazione non viene qualificata."
      : assessment.semanticReview.status === "irrisolta"
        ? "Il campo canonico è visibile, ma il blocker semantico impedisce di renderlo modificabile nella Vista operativa."
        : "Il campo canonico è visibile, ma la gestione automatica non è ancora applicata in modo coerente e non modificabile in entrambe le viste.";
  return {
    operationalVisibility: "esatta",
    operationalEditability: "sola-lettura",
    currentCoverage: "parziale",
    coverageReason: reason,
    currentEvidence: [
      "src/domain/operational-parity.ts#listOperationalAreaFields",
      "src/lib/components/OperationalFieldGroup.svelte",
      "src/lib/components/OfficialFieldControl.svelte",
    ],
  };
}

export function isOperationalParityEditable(
  parity: Pick<OperationalParityRow, "handling" | "semanticReview">,
): boolean {
  return parity.handling === "inserito" && parity.semanticReview.status === "qualificata";
}

function requiredParityTests(handling: FieldHandling | null, scope: string): string[] {
  const common = ["persistenza-e-rilettura", "isolamento-della-dichiarazione"];
  if (handling === null)
    return ["qualificazione-semantica-bloccante", "nessuna-promozione-ui", ...common];
  if (handling === "derivato")
    return ["stessa-fonte-in-entrambe-le-viste", "sola-lettura-coerente", ...common];
  if (handling === "gestito-automaticamente")
    return ["generazione-automatica-coerente", "sola-lettura-in-entrambe-le-viste", ...common];
  return [
    "vista-quadri-verso-vista-operativa",
    "vista-operativa-verso-vista-quadri",
    "conflitto-di-revisione",
    ...(scope === "occurrence" ? ["cardinalità-e-ordine-delle-occorrenze"] : []),
    ...(scope === "subject" || scope === "asset" || scope === "decedent"
      ? ["isolamento-per-oggetto-professionale"]
      : []),
    ...common,
  ];
}

export function buildOperationalParityMap(): OperationalParityRow[] {
  return QUADRI.flatMap((quadro) =>
    listQuadroFields(quadro)
      .filter((field) => field.visibleFieldId !== null)
      .map((field) => {
        const destination = candidateDestination(quadro, field);
        const assessment = handlingAssessment(quadro, field);
        const scope = field.entityScope ?? "declaration";
        return {
          fieldId: field.canonicalId,
          technicalPath: field.path,
          quadro,
          officialSection: field.section,
          visibleNumber: field.visibleNumber,
          label: field.label,
          professionalObject: professionalObject(quadro, field.path),
          cardinality: {
            fieldMin: field.minOccurs,
            fieldMax: field.maxOccurs,
            effectiveMin: field.effectiveMinOccurs,
            effectiveMax: field.effectiveMaxOccurs,
            entityScope: scope,
            occurrenceGroup: field.occurrenceGroup,
          },
          applicability: {
            declarationKinds:
              field.appliesToDeclarationKinds.length > 0
                ? field.appliesToDeclarationKinds
                : (["all"] as ["all"]),
            xsdPresence: field.minOccurs > 0 ? "obbligatorio-nel-contesto" : "condizionale",
            choiceGroup: field.choiceGroup,
            officialRuleIds: field.instructions.map((instruction) => instruction.id),
          },
          ...assessment,
          declarationIdentity: declarationIdentity(quadro, field),
          ...currentOperationalCoverage(destination, assessment),
          candidateOperationalArea: destination.area,
          candidateContext: destination.context,
          destinationReview: destinationReview(destination),
          requiredParityTests: requiredParityTests(assessment.handling, scope),
        } satisfies OperationalParityRow;
      }),
  );
}

export type OperationalAreaField = VisibleCatalogField & {
  operationalParity: OperationalParityRow;
};

export function isOperationalSectionId(value: string): value is OperationalSectionId {
  return value in OPERATIONAL_SECTION_AREAS;
}

export function listOperationalAreaFields(area: OperationalArea): OperationalAreaField[] {
  const rows = buildOperationalParityMap().filter(
    (row) =>
      row.candidateOperationalArea === area && row.destinationReview.uiDecision === "definitiva",
  );
  const fields = new Map(
    QUADRI.flatMap((quadro) =>
      listQuadroFields(quadro)
        .filter((field) => field.visibleFieldId !== null)
        .map((field) => [field.canonicalId, field] as const),
    ),
  );
  return rows.flatMap((row) => {
    const field = fields.get(row.fieldId);
    return field ? [{ ...field, operationalParity: row }] : [];
  });
}
