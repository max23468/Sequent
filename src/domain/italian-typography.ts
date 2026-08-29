const ASCII_ACCENTED_WORDS: Record<string, string> = {
  "affinche'": "affinché",
  "attivita'": "attività",
  "avra'": "avrà",
  "capacita'": "capacità",
  "citta'": "città",
  "cio'": "ciò",
  "cosi'": "così",
  "disabilita'": "disabilità",
  "disponibilita'": "disponibilità",
  "dovra'": "dovrà",
  "eredita'": "eredità",
  "fara'": "farà",
  "finalita'": "finalità",
  "finche'": "finché",
  "gia'": "già",
  "identita'": "identità",
  "localita'": "località",
  "modalita'": "modalità",
  "nazionalita'": "nazionalità",
  "nonche'": "nonché",
  "novita'": "novità",
  "opportunita'": "opportunità",
  "passivita'": "passività",
  "perche'": "perché",
  "pero'": "però",
  "piu'": "più",
  "poiche'": "poiché",
  "possibilita'": "possibilità",
  "priorita'": "priorità",
  "proprieta'": "proprietà",
  "pubblicita'": "pubblicità",
  "puo'": "può",
  "qualita'": "qualità",
  "quantita'": "quantità",
  "responsabilita'": "responsabilità",
  "sara'": "sarà",
  "societa'": "società",
  "unita'": "unità",
  "utilita'": "utilità",
  "validita'": "validità",
  "velocita'": "velocità",
  "verita'": "verità",
  "verra'": "verrà",
  "volonta'": "volontà",
};

const UPPERCASE_FINAL_ACCENTS: Record<string, string> = {
  A: "À",
  E: "È",
  I: "Ì",
  O: "Ò",
  U: "Ù",
};

function preserveCase(source: string, normalized: string): string {
  if (source === source.toUpperCase()) return normalized.toUpperCase();
  if (source[0] === source[0]?.toUpperCase())
    return `${normalized[0]?.toUpperCase() ?? ""}${normalized.slice(1)}`;
  return normalized;
}

export function normalizeItalianTypography(value: string): string {
  return value
    .replace(/\p{L}+'?/gu, (word) => {
      const lowerWord = word.toLocaleLowerCase("it-IT");
      const normalized = ASCII_ACCENTED_WORDS[lowerWord] ?? ASCII_ACCENTED_WORDS[`${lowerWord}'`];
      return normalized ? preserveCase(word, normalized) : word;
    })
    .replace(/(?<!['’\p{L}])E'(?=\s)/gu, "È")
    .replace(/(?<!['’\p{L}])e'(?=\s)/gu, "è")
    .replace(/(?<!['’\p{L}])([A-ZÀ-Ü]+)([AEIOU])'(?=\s|$)/gu, (_, stem, vowel) => {
      const accented = UPPERCASE_FINAL_ACCENTS[String(vowel)] ?? String(vowel);
      return `${stem}${accented}`;
    });
}
