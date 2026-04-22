import whoWfaBoys from "./data/wfa_boys.csv?raw";
import whoWfaGirls from "./data/wfa_girls.csv?raw";
import whoLhfaBoys02 from "./data/lhfa_boys_0_2.csv?raw";
import whoLhfaGirls02 from "./data/lhfa_girls_0_2.csv?raw";
import whoLhfaBoys25 from "./data/lhfa_boys_2_5.csv?raw";
import whoLhfaGirls25 from "./data/lhfa_girls_2_5.csv?raw";
import cdcWtageinf from "./data/cdc/wtageinf.csv?raw";
import cdcWtage from "./data/cdc/wtage.csv?raw";
import cdcLenageinf from "./data/cdc/lenageinf.csv?raw";
import cdcStatage from "./data/cdc/statage.csv?raw";

import type { MeasurementType, ResolvedStandard, Sex } from "./growth";

export interface LmsRow {
  month: number;
  L: number;
  M: number;
  S: number;
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const row: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = cells[i];
    return row;
  });
}

function parseWho(text: string): LmsRow[] {
  return parseCsv(text)
    .map((r) => ({ month: +r.month, L: +r.L, M: +r.M, S: +r.S }))
    .sort((a, b) => a.month - b.month);
}

function parseCdc(text: string, sex: Sex): LmsRow[] {
  const sexNum = sex === "boy" ? "1" : "2";
  return parseCsv(text)
    .filter((r) => r.Sex === sexNum)
    .map((r) => ({ month: +r.Agemos, L: +r.L, M: +r.M, S: +r.S }))
    .sort((a, b) => a.month - b.month);
}

const whoTables = {
  boy: {
    weight: parseWho(whoWfaBoys),
    height_0_2: parseWho(whoLhfaBoys02),
    height_2_5: parseWho(whoLhfaBoys25),
  },
  girl: {
    weight: parseWho(whoWfaGirls),
    height_0_2: parseWho(whoLhfaGirls02),
    height_2_5: parseWho(whoLhfaGirls25),
  },
};

const cdcTables = {
  boy: {
    weight_inf: parseCdc(cdcWtageinf, "boy"),
    weight: parseCdc(cdcWtage, "boy"),
    height_inf: parseCdc(cdcLenageinf, "boy"),
    height: parseCdc(cdcStatage, "boy"),
  },
  girl: {
    weight_inf: parseCdc(cdcWtageinf, "girl"),
    weight: parseCdc(cdcWtage, "girl"),
    height_inf: parseCdc(cdcLenageinf, "girl"),
    height: parseCdc(cdcStatage, "girl"),
  },
};

export function getReference(
  standard: ResolvedStandard,
  sex: Sex,
  measurementType: MeasurementType,
  ageMonths: number,
): LmsRow[] {
  if (standard === "who") {
    const bySex = whoTables[sex];
    if (measurementType === "weight") return bySex.weight;
    return ageMonths < 24 ? bySex.height_0_2 : bySex.height_2_5;
  }
  const bySex = cdcTables[sex];
  if (measurementType === "weight") return ageMonths < 24 ? bySex.weight_inf : bySex.weight;
  return ageMonths < 24 ? bySex.height_inf : bySex.height;
}
