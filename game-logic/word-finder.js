/**
 * word-finder.js v2
 *
 * FIX: gestione tessera singola — ora cerca in entrambe le direzioni
 * FIX: findMainWord con tessera singola restituisce la parola più lunga trovata
 * NEW: exporta anche determineIsHorizontal per uso esterno
 */

const { isValidPosition } = require('./board');

function findWordsFormed(board, newTiles) {
  if (newTiles.length === 0) return [];

  const tempBoard = board.map(row => row.map(cell => ({ ...cell })));
  newTiles.forEach(t => {
    tempBoard[t.row][t.col].letter = t.letter;
    tempBoard[t.row][t.col].value = t.value;
    tempBoard[t.row][t.col].isNew = true;
  });

  const words = [];

  if (newTiles.length === 1) {
    // FIX: tessera singola — cerca parola in entrambe le direzioni
    const tile = newTiles[0];
    const hWord = extractWordAt(tempBoard, tile.row, tile.col, true);
    const vWord = extractWordAt(tempBoard, tile.row, tile.col, false);
    if (hWord && hWord.word.length > 1) words.push(hWord);
    if (vWord && vWord.word.length > 1) words.push(vWord);
    // Se nessuna parola trovata, crea una "parola" di 1 lettera (gestita come errore altrove)
    if (words.length === 0) {
      words.push({ word: tile.letter, tiles: [{ ...tile, cellType: tempBoard[tile.row][tile.col].type, isNew: true }] });
    }
    return words;
  }

  const rows = newTiles.map(t => t.row);
  const cols = newTiles.map(t => t.col);
  const isHorizontal = new Set(rows).size === 1;

  // Parola principale
  const mainWord = findMainWord(tempBoard, newTiles, isHorizontal);
  if (mainWord && mainWord.word.length > 1) words.push(mainWord);

  // Parole trasversali
  newTiles.forEach(tile => {
    const cross = extractWordAt(tempBoard, tile.row, tile.col, !isHorizontal);
    if (cross && cross.word.length > 1) words.push(cross);
  });

  return words;
}

/** Estrae la parola passante per (row, col) nella direzione indicata */
function extractWordAt(board, row, col, isHorizontal) {
  let r = row, c = col;

  // Vai all'inizio
  if (isHorizontal) { while (c > 0 && board[r][c-1].letter) c--; }
  else              { while (r > 0 && board[r-1][c].letter) r--; }

  const tiles = [];
  while (isValidPosition(r, c) && board[r][c].letter) {
    tiles.push({
      row: r, col: c,
      letter: board[r][c].letter,
      value: board[r][c].value,
      isNew: board[r][c].isNew || false,
      cellType: board[r][c].type
    });
    if (isHorizontal) c++; else r++;
  }

  if (tiles.length === 0) return null;
  return { word: tiles.map(t => t.letter).join(''), tiles, isHorizontal };
}

function findMainWord(board, newTiles, isHorizontal) {
  const ref = newTiles[0];
  return extractWordAt(board, ref.row, ref.col, isHorizontal);
}

function validateAlignment(board, newTiles) {
  if (newTiles.length === 0) return { valid: false, reason: 'Nessuna tessera piazzata' };
  if (newTiles.length === 1) return { valid: true };

  const rows = newTiles.map(t => t.row);
  const cols = newTiles.map(t => t.col);
  const sameRow = rows.every(r => r === rows[0]);
  const sameCol = cols.every(c => c === cols[0]);

  if (!sameRow && !sameCol)
    return { valid: false, reason: 'Le tessere devono essere sulla stessa riga o colonna' };

  if (sameRow) {
    const minC = Math.min(...cols), maxC = Math.max(...cols);
    for (let c = minC; c <= maxC; c++) {
      if (!newTiles.some(t => t.col === c) && !board[rows[0]][c].letter)
        return { valid: false, reason: 'Sequenza non continua: c\'è un buco tra le tessere' };
    }
  } else {
    const minR = Math.min(...rows), maxR = Math.max(...rows);
    for (let r = minR; r <= maxR; r++) {
      if (!newTiles.some(t => t.row === r) && !board[r][cols[0]].letter)
        return { valid: false, reason: 'Sequenza non continua: c\'è un buco tra le tessere' };
    }
  }
  return { valid: true };
}

function determineDirection(tiles) {
  if (tiles.length <= 1) return true;
  return new Set(tiles.map(t => t.row)).size === 1;
}

module.exports = { findWordsFormed, validateAlignment, determineDirection };
