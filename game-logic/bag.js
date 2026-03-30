/**
 * bag.js - Sacchetto lettere con distribuzione ufficiale Scarabeo italiano
 * Gestisce il pescaggio casuale e il conteggio delle lettere rimanenti
 */

// Distribuzione ufficiale Scarabeo italiano
const LETTER_DISTRIBUTION = {
  'A': 14, 'B': 3,  'C': 6,  'D': 4,  'E': 11,
  'F': 3,  'G': 3,  'H': 2,  'I': 12, 'L': 5,
  'M': 5,  'N': 7,  'O': 11, 'P': 4,  'Q': 1,
  'R': 7,  'S': 6,  'T': 7,  'U': 4,  'V': 3,
  'Z': 2,  '?': 2   // ? = Jolly/Blank
};

// Valori in punti ufficiali Scarabeo italiano
const LETTER_VALUES = {
  'A': 1,  'B': 5,  'C': 2,  'D': 5,  'E': 1,
  'F': 5,  'G': 8,  'H': 8,  'I': 1,  'L': 3,
  'M': 3,  'N': 3,  'O': 1,  'P': 5,  'Q': 10,
  'R': 2,  'S': 2,  'T': 2,  'U': 4,  'V': 8,
  'Z': 10, '?': 0   // Il jolly vale 0 punti
};

/**
 * Crea e mescola il sacchetto con tutte le 120 lettere
 * Usa algoritmo Fisher-Yates per mischiare
 */
function createBag() {
  const bag = [];
  
  // Riempi il sacchetto con le lettere nella quantità corretta
  for (const [letter, count] of Object.entries(LETTER_DISTRIBUTION)) {
    for (let i = 0; i < count; i++) {
      bag.push({ letter, value: LETTER_VALUES[letter] });
    }
  }
  
  // Mescola con Fisher-Yates
  shuffleBag(bag);
  
  return bag;
}

/**
 * Algoritmo Fisher-Yates per mescolare il sacchetto
 * Garantisce distribuzione casuale uniforme
 */
function shuffleBag(bag) {
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}

/**
 * Pesca N lettere dal sacchetto
 * Restituisce le lettere pescate e modifica il sacchetto
 */
function drawTiles(bag, count) {
  const drawn = [];
  const actual = Math.min(count, bag.length);
  
  for (let i = 0; i < actual; i++) {
    drawn.push(bag.pop()); // Pop dalla fine (già mescolato)
  }
  
  return drawn;
}

/**
 * Rimette le lettere nel sacchetto e le rimescola
 * Usato quando un giocatore scambia le proprie lettere
 */
function returnTiles(bag, tiles) {
  bag.push(...tiles);
  shuffleBag(bag);
}

/**
 * Ottieni il valore di una lettera
 */
function getLetterValue(letter) {
  return LETTER_VALUES[letter.toUpperCase()] || 0;
}

/**
 * Conta le lettere rimanenti nel sacchetto
 */
function getRemainingCount(bag) {
  return bag.length;
}

/**
 * Verifica se il sacchetto è vuoto
 */
function isBagEmpty(bag) {
  return bag.length === 0;
}

module.exports = {
  LETTER_DISTRIBUTION,
  LETTER_VALUES,
  createBag,
  drawTiles,
  returnTiles,
  getLetterValue,
  getRemainingCount,
  isBagEmpty
};
