/**
 * board.js - Definizione del tabellone 15×15 e caselle bonus
 * Il tabellone Scarabeo classico ha una distribuzione precisa di caselle speciali
 */

// Tipi di caselle bonus
const CELL_TYPES = {
  NORMAL: 'N',      // Casella normale
  DL: 'DL',         // Doppia Lettera
  TL: 'TL',         // Tripla Lettera
  DW: 'DW',         // Doppia Parola (Double Word)
  TW: 'TW',         // Tripla Parola (Triple Word)
  CENTER: 'CENTER'  // Centro (Doppia Parola + stella)
};

/**
 * Layout ufficiale del tabellone Scarabeo 15×15
 * Rappresentato come stringa per ogni riga
 * TW=Tripla Parola, DW=Doppia Parola, TL=Tripla Lettera, DL=Doppia Lettera, N=Normale
 */
const BOARD_LAYOUT = [
  ['TW','N', 'N', 'DL','N', 'N', 'N', 'TW','N', 'N', 'N', 'DL','N', 'N', 'TW'],
  ['N', 'DW','N', 'N', 'N', 'TL','N', 'N', 'N', 'TL','N', 'N', 'N', 'DW','N'],
  ['N', 'N', 'DW','N', 'N', 'N', 'DL','N', 'DL','N', 'N', 'N', 'DW','N', 'N'],
  ['DL','N', 'N', 'DW','N', 'N', 'N', 'DL','N', 'N', 'N', 'DW','N', 'N', 'DL'],
  ['N', 'N', 'N', 'N', 'DW','N', 'N', 'N', 'N', 'N', 'DW','N', 'N', 'N', 'N'],
  ['N', 'TL','N', 'N', 'N', 'TL','N', 'N', 'N', 'TL','N', 'N', 'N', 'TL','N'],
  ['N', 'N', 'DL','N', 'N', 'N', 'DL','N', 'DL','N', 'N', 'N', 'DL','N', 'N'],
  ['TW','N', 'N', 'DL','N', 'N', 'N', 'CT','N', 'N', 'N', 'DL','N', 'N', 'TW'],
  ['N', 'N', 'DL','N', 'N', 'N', 'DL','N', 'DL','N', 'N', 'N', 'DL','N', 'N'],
  ['N', 'TL','N', 'N', 'N', 'TL','N', 'N', 'N', 'TL','N', 'N', 'N', 'TL','N'],
  ['N', 'N', 'N', 'N', 'DW','N', 'N', 'N', 'N', 'N', 'DW','N', 'N', 'N', 'N'],
  ['DL','N', 'N', 'DW','N', 'N', 'N', 'DL','N', 'N', 'N', 'DW','N', 'N', 'DL'],
  ['N', 'N', 'DW','N', 'N', 'N', 'DL','N', 'DL','N', 'N', 'N', 'DW','N', 'N'],
  ['N', 'DW','N', 'N', 'N', 'TL','N', 'N', 'N', 'TL','N', 'N', 'N', 'DW','N'],
  ['TW','N', 'N', 'DL','N', 'N', 'N', 'TW','N', 'N', 'N', 'DL','N', 'N', 'TW']
];

/**
 * Crea una nuova istanza del tabellone vuoto
 * Ogni cella contiene: { type, letter, value, isPlaced }
 */
function createBoard() {
  const board = [];
  for (let r = 0; r < 15; r++) {
    board[r] = [];
    for (let c = 0; c < 15; c++) {
      board[r][c] = {
        type: BOARD_LAYOUT[r][c],  // Tipo casella bonus
        letter: null,               // Lettera piazzata (null se vuota)
        value: 0,                   // Valore della lettera piazzata
        isNew: false                // Flag: lettera appena piazzata in questo turno
      };
    }
  }
  return board;
}

/**
 * Verifica se una cella è vuota
 */
function isCellEmpty(board, row, col) {
  return board[row][col].letter === null;
}

/**
 * Verifica se la posizione è valida (dentro il tabellone)
 */
function isValidPosition(row, col) {
  return row >= 0 && row < 15 && col >= 0 && col < 15;
}

/**
 * Calcola il moltiplicatore lettera per una casella
 * Restituisce 1 per caselle normali, 2 per DL, 3 per TL
 * Nota: il moltiplicatore lettera si applica solo alle lettere NUOVE
 */
function getLetterMultiplier(cellType) {
  if (cellType === 'DL') return 2;
  if (cellType === 'TL') return 3;
  return 1;
}

/**
 * Calcola il moltiplicatore parola per una casella
 * Restituisce 1 per caselle normali, 2 per DW/CENTER, 3 per TW
 */
function getWordMultiplier(cellType) {
  if (cellType === 'DW' || cellType === 'CT') return 2;
  if (cellType === 'TW') return 3;
  return 1;
}

/**
 * Serializza il tabellone per invio via WebSocket (JSON)
 */
function serializeBoard(board) {
  return board.map(row => row.map(cell => ({
    type: cell.type,
    letter: cell.letter,
    value: cell.value
  })));
}

/**
 * Verifica se il tabellone è completamente vuoto (prima mossa)
 */
function isBoardEmpty(board) {
  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) {
      if (board[r][c].letter !== null) return false;
    }
  }
  return true;
}

module.exports = {
  BOARD_LAYOUT,
  CELL_TYPES,
  createBoard,
  isCellEmpty,
  isValidPosition,
  getLetterMultiplier,
  getWordMultiplier,
  serializeBoard,
  isBoardEmpty
};
