/**
 * scoring.js - Calcolo punteggio con moltiplicatori caselle
 * Gestisce bonus DL, TL, DW, TW e il bonus Scarabeo (tutti 7 tiles = +50)
 */

const { getLetterMultiplier, getWordMultiplier } = require('./board');

/**
 * Calcola il punteggio di una singola parola
 * I moltiplicatori casella si applicano SOLO alle tessere NUOVE
 * Le tessere preesistenti contano solo il loro valore base
 * 
 * @param {Object} wordData - { word, tiles } da word-finder
 * @returns {number} Punteggio della parola
 */
function calculateWordScore(wordData) {
  let baseScore = 0;
  let wordMultiplier = 1;
  
  wordData.tiles.forEach(tile => {
    const letterValue = tile.value || 0;
    
    if (tile.isNew) {
      // Applica moltiplicatore lettera solo alle tessere nuove
      const lm = getLetterMultiplier(tile.cellType);
      baseScore += letterValue * lm;
      
      // Accumula moltiplicatore parola
      const wm = getWordMultiplier(tile.cellType);
      wordMultiplier *= wm;
    } else {
      // Tessere preesistenti: solo valore base
      baseScore += letterValue;
    }
  });
  
  return baseScore * wordMultiplier;
}

/**
 * Calcola il punteggio totale di una mossa (somma di tutte le parole)
 * 
 * @param {Array} words - Array di parole formate dalla mossa
 * @param {number} tilesPlaced - Numero di tessere piazzate (per bonus Scarabeo)
 * @returns {Object} { total, breakdown, scrabboBonus }
 */
function calculateMoveScore(words, tilesPlaced) {
  const breakdown = [];
  let total = 0;
  
  words.forEach(wordData => {
    const score = calculateWordScore(wordData);
    total += score;
    breakdown.push({ word: wordData.word, score });
  });
  
  // Bonus Scarabeo: +50 punti se si piazzano tutte e 7 le tessere in un turno
  let scrabboBonus = 0;
  if (tilesPlaced === 7) {
    scrabboBonus = 50;
    total += scrabboBonus;
  }
  
  return { total, breakdown, scrabboBonus };
}

/**
 * Calcola la penalità per le tessere rimanenti a fine partita
 * I punti delle tessere in mano vengono sottratti al punteggio finale
 */
function calculateEndGamePenalty(rack) {
  return rack.reduce((sum, tile) => sum + (tile.value || 0), 0);
}

/**
 * Calcola il punteggio finale con bonus e penalità
 * Chi ha finito le tessere riceve in più la somma dei punti degli avversari
 */
function calculateFinalScores(players, winnerId) {
  const penaltyTotal = {};
  let totalPenalty = 0;
  
  // Calcola penalità per ogni giocatore
  players.forEach(p => {
    if (p.id !== winnerId) {
      const penalty = calculateEndGamePenalty(p.rack);
      penaltyTotal[p.id] = penalty;
      totalPenalty += penalty;
    }
  });
  
  // Applica penalità e bonus
  const finalScores = {};
  players.forEach(p => {
    finalScores[p.id] = p.score;
    if (p.id === winnerId) {
      finalScores[p.id] += totalPenalty; // Bonus al vincitore
    } else {
      finalScores[p.id] -= (penaltyTotal[p.id] || 0); // Penalità agli altri
    }
  });
  
  return finalScores;
}

module.exports = {
  calculateWordScore,
  calculateMoveScore,
  calculateEndGamePenalty,
  calculateFinalScores
};
