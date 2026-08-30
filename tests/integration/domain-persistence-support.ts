import { rmSync } from "node:fs";
import { closeDatabase } from "../../src/lib/server/database.ts";

export const directories: string[] = [];
export const BUILDING_VALUE_FIELD_ID =
  "xsd:/Fornitura/Dichiarazione/QuadroEC/Modulo/Fabbricati/Valore";
export const BUILDING_PREVIOUS_VALUE_FIELD_ID =
  "xsd:/Fornitura/Dichiarazione/QuadroEC/Modulo/Fabbricati/ValorePrecSucc";
export const BUILDING_PROVINCE_FIELD_ID =
  "xsd:/Fornitura/Dichiarazione/QuadroEC/Modulo/Fabbricati/Luogo/Provincia";
export const BUILDING_MUNICIPALITY_FIELD_ID =
  "xsd:/Fornitura/Dichiarazione/QuadroEC/Modulo/Fabbricati/Luogo/Italia/CodiceComune";
export const BUILDING_ADMINISTRATIVE_MUNICIPALITY_FIELD_ID =
  "xsd:/Fornitura/Dichiarazione/QuadroEC/Modulo/Fabbricati/Luogo/Italia/CodiceComuneAmministrativo";
export const VESSEL_LENGTH_FIELD_ID =
  "xsd:/Fornitura/Dichiarazione/QuadroEQ/Modulo/Navi/Tipo/Dimensione/Lunghezza";
export const VESSEL_TONNAGE_FIELD_ID =
  "xsd:/Fornitura/Dichiarazione/QuadroEQ/Modulo/Navi/Tipo/Dimensione/Stazza";
export const VESSEL_TYPE_FIELD_ID =
  "xsd:/Fornitura/Dichiarazione/QuadroEQ/Modulo/Navi/Tipo/TipoUnita";
export const SUBSTITUTE_SUCCESSION_OPENING_DATE_FIELD_ID =
  "xsd:/Fornitura/Dichiarazione/QuadroEH/PrimoModulo/SezioneI_DichSost/DatiDefunto/Decesso/DataDecesso";
export const TESTAMENT_FILE_NAME_FIELD_ID =
  "xsd:/Fornitura/Dichiarazione/QuadroEG/Testamento/TestamentoAll/FileName";
export const MORTGAGE_TAX_FIELD_ID =
  "xsd:/Fornitura/Dichiarazione/QuadroEF/SezioneI_ImpostaIpotecaria/ImpostaProporzionale/ImpostaProporzionale_Imposta";
export const MORTGAGE_TAX_BASE_FIELD_ID =
  "xsd:/Fornitura/Dichiarazione/QuadroEF/SezioneI_ImpostaIpotecaria/ImpostaProporzionale/ImpostaProporzionale_Imponibile";

export function cleanupDomainDirectories() {
  for (const directory of directories.splice(0)) {
    closeDatabase(directory);
    rmSync(directory, { recursive: true, force: true });
  }
}
