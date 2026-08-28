import { getCatalogField } from "../../domain/official-catalog/catalog.ts";

export type SpecialPlacement = {
  page: number;
  x: number;
  top: number;
  width: number;
  kind?: "text" | "checkbox";
  align?: "left" | "center";
  verticalOffset?: number;
  rightInset?: number;
};

const text = (page: number, x: number, top: number, width: number): SpecialPlacement => ({
  page,
  x,
  top,
  width,
  verticalOffset: 3.5,
});
const check = (page: number, x: number, top: number): SpecialPlacement => ({
  page,
  x,
  top,
  width: 14,
  kind: "checkbox",
  align: "center",
  verticalOffset: 0.7,
});

function personPlacement(
  page: number,
  top: number,
  path: string,
  rows = { date: 24, dateValue: 32, fiscal: 60 },
): SpecialPlacement | null {
  if (path.endsWith("/Cognome") || path.endsWith("/Denominazione"))
    return text(page, 110, top, 209);
  if (path.endsWith("/Nome")) return text(page, 330, top, 201);
  if (path.endsWith("/Sesso")) return text(page, 546, top, 14);
  if (path.endsWith("/DataNascita")) return text(page, 110, top + rows.dateValue, 101);
  if (path.endsWith("/ComuneNascita")) return text(page, 229, top + rows.date, 262);
  if (path.endsWith("/ProvinciaNascita")) return text(page, 502, top + rows.date, 58);
  if (path.endsWith("/CodiceFiscale")) return text(page, 110, top + rows.fiscal, 209);
  if (path.endsWith("/CodiceCarica")) return text(page, 327, top + rows.fiscal, 14);
  if (path.endsWith("/CodiceFiscaleRappresentato")) return text(page, 350, top + rows.fiscal, 210);
  return null;
}

const registration = (
  page: number,
  top: number,
  path: string,
  names: { office: string; year?: string },
): SpecialPlacement | null => {
  if (path.endsWith(`/${names.office}`)) return text(page, 110, top, 165);
  if (path.endsWith("/Serie")) return text(page, 291, top, 34);
  if (path.endsWith("/NumeroRegistrazione") || path.endsWith("/Numero"))
    return text(page, 335, top, 63);
  if (path.endsWith("/SottonumeroRegistrazione")) return text(page, 407, top, 64);
  if (path.endsWith("/DataRegistrazione")) return text(page, 481, top, 67);
  if (names.year && path.endsWith(`/${names.year}`)) return text(page, 336, top, 61);
  if (path.endsWith("/Volume")) return text(page, 407, top, 70);
  return null;
};

function ehPlacement(path: string, occurrenceIndex: number): SpecialPlacement | null {
  if (path.endsWith("/Luogo/CodiceComune")) return null;
  if (path.includes("/Presentatore/")) return personPlacement(9, 162, path);
  if (path.includes("/DatiDefunto/DatiAnagrafici/")) return personPlacement(9, 306, path);
  if (path.endsWith("/DatiDefunto/Decesso/FlagDeceduto")) return check(9, 110, 356);
  if (path.endsWith("/DatiDefunto/Decesso/DataDecesso")) return text(9, 110, 386, 101);
  if (path.endsWith("/DatiDefunto/Decesso/Comune")) return text(9, 229, 378, 262);
  if (path.endsWith("/DatiDefunto/Decesso/Provincia")) return text(9, 502, 378, 58);
  if (path.endsWith("/DatiDefunto/MortePresunta/FlagAssenza")) return check(9, 110, 404);
  if (path.endsWith("/DatiDefunto/MortePresunta/Tribunale")) return text(9, 110, 426, 101);
  if (path.endsWith("/DatiDefunto/MortePresunta/DataDeposito")) return text(9, 305, 434, 101);
  if (path.endsWith("/DatiDefunto/MortePresunta/Sentenza")) return text(9, 488, 426, 72);
  if (path.endsWith("/Dichiarante/PresenzaDichiarante")) return check(9, 326, 444);
  if (path.endsWith("/Dichiarante/FlagAssenzaDichiarante")) return check(9, 410, 444);

  if (path.includes("/Eredi/")) {
    if (occurrenceIndex > 2) return null;
    const top = 473 + Math.min(occurrenceIndex, 2) * 84;
    if (path.endsWith("/Cognome") || path.endsWith("/Denominazione")) return text(9, 110, top, 209);
    if (path.endsWith("/Nome")) return text(9, 330, top, 202);
    if (path.endsWith("/Sesso")) return text(9, 546, top, 14);
    if (path.endsWith("/DataNascita")) return text(9, 110, top + 32, 101);
    if (path.endsWith("/ComuneNascita")) return text(9, 229, top + 24, 303);
    if (path.endsWith("/ProvinciaNascita")) return text(9, 110, top + 48, 58);
    if (path.endsWith("/CodiceFiscale")) return text(9, 229, top + 48, 230);
    if (path.endsWith("/GradoParentela")) return text(9, 487, top + 48, 44);
  }
  if (path.endsWith("/Testamento/FlagAssenzaTestamento")) return check(9, 110, 725);
  if (path.endsWith("/Testamento/PresenzaTestamento/FlagTestamento")) return check(9, 229, 725);
  if (path.includes("/RegistrazioneTestamento/"))
    return occurrenceIndex > 1
      ? null
      : registration(9, 762 + occurrenceIndex * 36, path, {
          office: "UfficioDiRegistrazione",
        });

  if (path.endsWith("/ReintegroDiritti/FlagReintegro")) return check(10, 110, 60);
  if (path.includes("/ReintegroDiritti/") && !path.endsWith("/FlagReintegro"))
    return registration(10, 102, path, { office: "UfficioDiRegistrazione" });
  if (path.endsWith("/Interdetti/FlagAssenzaInterdetti")) return check(10, 110, 151);
  if (path.endsWith("/PresenzaInterdetti/FlagInterdetti")) return check(10, 110, 181);
  if (path.includes("/PresenzaInterdetti/IdentificazioneSoggetto/"))
    return path.endsWith("/Rigo") ? text(10, 283, 186, 23) : text(10, 319, 186, 28);
  if (path.endsWith("/PresenzaInterdetti/Certificatore")) return text(10, 117, 210, 431);
  if (path.endsWith("/Rinuncia/FlagAssenzaRinuncia")) return check(10, 110, 235);
  if (path.endsWith("/PresenzaRinuncia/FlagRinuncia")) return check(10, 110, 265);
  if (path.includes("/PresenzaRinuncia/IdentificazioneSoggetto/"))
    return path.endsWith("/Rigo") ? text(10, 283, 270, 23) : text(10, 319, 270, 28);
  if (path.includes("/RegistrazioneRinuncia/"))
    return registration(10, 295, path, { office: "UfficioDiRegistrazione" });
  if (path.endsWith("/Separazione/FlagAssenzaSeparazione")) return check(10, 110, 330);
  if (path.endsWith("/Separazione/FlagSeparazione")) return check(10, 110, 361);
  if (path.endsWith("/FlagNoScioglimentoUnioneCivile")) return check(10, 110, 391);
  if (path.endsWith("/Aziende/FlagAzienda")) return check(10, 110, 426);
  if (path.endsWith("/Aziende/DataDeposito")) return text(10, 466, 426, 82);
  if (path.endsWith("/Aziende/CameraCommercio")) return text(10, 466, 450, 58);
  if (path.endsWith("/FlagProspetto")) return check(10, 110, 482);
  if (path.endsWith("/FlagInventari")) return check(10, 110, 509);
  if (path.endsWith("/FlagPassivita")) return check(10, 110, 536);
  if (path.endsWith("/Navi/FlagNavi")) return check(10, 110, 571);
  if (path.endsWith("/Navi/SiglaUfficioIscrizione")) return text(10, 142, 595, 106);
  if (path.endsWith("/Navi/AnnoIscrizione")) return text(10, 258, 595, 91);
  if (path.endsWith("/Navi/NumeroIscrizione")) return text(10, 359, 595, 189);
  if (path.endsWith("/Aeromobili/FlagAeromobili")) return check(10, 110, 630);
  if (path.endsWith("/Aeromobili/Nazionalita")) return text(10, 142, 653, 106);
  if (path.endsWith("/Aeromobili/AnnoImmatricolazione")) return text(10, 258, 653, 91);
  if (path.endsWith("/Aeromobili/NumeroImmatricolazione")) return text(10, 359, 653, 189);

  const property = path.includes("/ImmobilePrincipale/")
    ? 0
    : path.includes("/ImmobileContiguo/")
      ? 1
      : path.includes("/Pertinenza/")
        ? 2 + Math.min(occurrenceIndex, 2)
        : -1;
  if (property >= 0) {
    if (path.includes("/Pertinenza/") && occurrenceIndex > 2) return null;
    const top = 90 + property * 72;
    if (path.endsWith("/Luogo/Provincia")) return text(11, 116, top, 56);
    if (path.endsWith("/Luogo/Comune")) return text(11, 182, top, 180);
    if (path.endsWith("/Luogo/Indirizzo")) return text(11, 372, top, 176);
    if (path.endsWith("/SezioneUrbana")) return text(11, 117, top + 24, 54);
    if (path.endsWith("/DatiCatastali/Foglio")) return text(11, 181, top + 24, 68);
    if (path.endsWith("/DatiCatastali/Particella")) return text(11, 259, top + 24, 84);
    if (path.endsWith("/DatiCatastali/Subalterno")) return text(11, 352, top + 24, 196);
  }
  const optionTops: Array<[string, number]> = [
    ["FlagComuneResidenza", 458],
    ["FlagComuneAttivita", 482],
    ["FlagCambioResidenza", 510],
    ["FlagNessunaAltraCasaComune", 534],
    ["AltraCasa/FlagNessunaAltraCasa", 562],
    ["AltraCasa/FlagVenditaAltraCasa", 606],
    ["FlagTrasferimentoPrima", 635],
    ["FlagResidenteEstero2", 680],
    ["Opzioni/FlagTrasferitoEstero", 704],
    ["FlagSedeLavoro", 748],
    ["Opzioni/FlagForzeArmate", 776],
    ["FlagContigui", 804],
  ];
  for (const [suffix, top] of optionTops)
    if (path.endsWith(`/${suffix}`)) return check(11, 142, top);

  if (path.endsWith("/SezioneIII_CreditoImposta/TipologiaImposta")) return text(12, 116, 90, 232);
  if (path.endsWith("/SezioneIII_CreditoImposta/Imposta"))
    return { ...text(12, 359, 95, 139), rightInset: 0 };
  if (path.includes("/RegistrazioneAcquisto/"))
    return registration(12, 139, path, { office: "UfficioDiRegistrazione" });
  if (path.includes("/RegistrazioneVendita/"))
    return registration(12, 198, path, { office: "UfficioDiRegistrazione" });
  if (path.endsWith("/AgevolazTipoA/FlagA")) return check(12, 110, 312);
  if (path.endsWith("/AgevolazTipoA/NumProtocollo")) return text(12, 384, 306, 88);
  if (path.endsWith("/AgevolazTipoA/Data")) return text(12, 482, 316, 66);
  if (path.endsWith("/AgevolazTipoL/FlagL")) return check(12, 110, 348);
  if (path.endsWith("/AgevolazTipoL/NumProtocollo")) return text(12, 384, 342, 88);
  if (path.endsWith("/AgevolazTipoL/Data")) return text(12, 482, 352, 66);
  const agevolazioni: Array<[string, number]> = [
    ["FlagC", 438],
    ["FlagD", 466],
    ["FlagE", 497],
    ["FlagQ", 530],
  ];
  for (const [suffix, top] of agevolazioni)
    if (path.endsWith(`/${suffix}`)) return check(12, 110, top);
  if (path.includes("/EstremiDichiarazionePrecedente/")) {
    if (path.endsWith("/Anno")) return text(12, 337, 655, 60);
    if (path.endsWith("/Volume")) return text(12, 407, 655, 70);
    if (path.endsWith("/Numero")) return text(12, 487, 655, 61);
  }
  if (path.endsWith("/Riduzioni/UfficioTerritoriale")) return text(12, 121, 655, 206);
  if (path.includes("/EstremiDonazionePrecedente/")) {
    if (path.endsWith("/UfficioDiRegistrazione")) return text(12, 121, 702, 206);
    if (path.endsWith("/Serie")) return text(12, 337, 702, 61);
    if (path.endsWith("/NumeroRegistrazione")) return text(12, 407, 702, 70);
    if (path.endsWith("/SottonumeroRegistrazione")) return text(12, 487, 702, 61);
  }
  return null;
}

function eiPlacement(path: string, occurrenceIndex: number): SpecialPlacement | null {
  if (path.endsWith("/Luogo/CodiceComuneAmministrativo")) return null;
  if (path.includes("/Presentatore/"))
    return personPlacement(13, 187, path, { date: 36, dateValue: 44, fiscal: 72 });
  if (path.endsWith("/SezioneI_AttiLegali/FlagAttiLegali")) return check(13, 110, 322);
  if (path.includes("/Immobile/")) {
    if (path.endsWith("/TipoCatasto")) return text(13, 117, 426, 87);
    if (path.endsWith("/Luogo/Provincia")) return text(13, 214, 426, 89);
    if (path.endsWith("/Luogo/ComuneAmministrativo")) return text(13, 313, 426, 235);
    if (path.endsWith("/Luogo/CodiceComune")) return text(13, 116, 462, 89);
    if (path.endsWith("/DatiCatastali/Foglio")) return text(13, 215, 462, 88);
    if (path.endsWith("/DatiCatastali/Particella")) return text(13, 313, 462, 88);
    if (path.endsWith("/DatiCatastali/Subalterno")) return text(13, 410, 462, 88);
    if (path.endsWith("/SezioneUrbana")) return text(13, 508, 462, 40);
  }
  if (path.includes("/EstremiTrascrizione/")) {
    if (occurrenceIndex > 2) return null;
    const top = 534 + Math.min(occurrenceIndex, 2) * 36;
    if (path.endsWith("/UfficioTrascrizione")) return text(13, 117, top, 307);
    if (path.endsWith("/RegistroParticolare")) return text(13, 434, top, 73);
    if (path.endsWith("/Anno")) return text(13, 517, top, 31);
  }
  if (path.includes("/EstremiRegistrazione/")) {
    if (occurrenceIndex > 2) return null;
    const top = 666 + Math.min(occurrenceIndex, 2) * 36;
    if (path.endsWith("/UfficioTerritoriale")) return text(13, 120, top, 206);
    if (path.endsWith("/Anno")) return text(13, 336, top, 61);
    if (path.endsWith("/Volume")) return text(13, 407, top, 70);
    if (path.endsWith("/Numero")) return text(13, 486, top, 62);
  }
  if (path.endsWith("/Continuazione")) return check(13, 525, 773);
  return null;
}

export function specialFacsimilePlacement(
  fieldId: string,
  occurrenceIndex = 0,
): SpecialPlacement | null {
  const field = getCatalogField(fieldId);
  if (!field) return null;
  if (field.quadro === "EH") return ehPlacement(field.technicalPath, occurrenceIndex);
  if (field.quadro === "EI") return eiPlacement(field.technicalPath, occurrenceIndex);
  return null;
}
