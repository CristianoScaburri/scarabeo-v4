/**
 * dictionary.js - Dizionario italiano per la validazione delle parole
 * Usa un set di parole italiane comuni; in produzione sostituire con wordlist completa
 */

const fs = require('fs');
const path = require('path');

// Set di parole italiano in memoria (caricato all'avvio)
let wordSet = null;

/**
 * Lista di parole italiane comuni integrata come fallback
 * In produzione, caricare da file dizionario-it.txt (OWL, Zingarelli, etc.)
 * Questa lista contiene circa 500 parole comuni per demo/sviluppo
 */
const BUILT_IN_WORDS = [
  // Articoli e preposizioni
  'IL','LA','LO','LE','GLI','UN','UNA','UNO',
  'DI','DA','IN','CON','SU','PER','TRA','FRA',
  'DEL','DELLA','DELLO','DEGLI','DELLE','DEI',
  'AL','ALLA','ALLO','AGLI','ALLE','AI',
  'DAL','DALLA','DALLO','DAGLI','DALLE','DAI',
  'NEL','NELLA','NELLO','NEGLI','NELLE','NEI',
  'SUL','SULLA','SULLO','SUGLI','SULLE','SUI',
  
  // Congiunzioni e avverbi
  'E','ED','O','MA','SE','CHE','NON','SI','CI','NE',
  'ORA','GIA','MAI','PIU','QUI','LI','LA','SU','GIU',
  'COME','QUANDO','DOVE','MENTRE','PERCHE','ANCHE',
  
  // Numeri
  'UNO','DUE','TRE','QUATTRO','CINQUE','SEI','SETTE','OTTO','NOVE','DIECI',
  'CENTO','MILLE','ZERO',
  
  // Colori
  'ROSSO','ROSSA','ROSSI','ROSSE','BLU','VERDE','VERDI',
  'GIALLO','GIALLA','BIANCO','BIANCA','NERO','NERA',
  'VIOLA','AZZURRO','AZZURRA','ROSA','GRIGIO','GRIGIA',
  
  // Casa e oggetti
  'CASA','CASE','PORTA','PORTE','FINESTRA','FINESTRE',
  'TAVOLO','TAVOLI','SEDIA','SEDIE','LETTO','LETTI',
  'CUCINA','BAGNO','SALOTTO','CAMERA','SCALE',
  'LIBRO','LIBRI','PENNA','PENNE','CARTA','CARTE',
  'CHIAVE','CHIAVI','BORSA','BORSE','TELEFONO',
  'COMPUTER','SCHERMO','TASTIERA','MOUSE',
  
  // Cibo e bevande
  'PANE','PIZZA','PASTA','RISO','CARNE','PESCE',
  'FRUTTA','VERDURA','POMODORO','POMODORI','PATATA','PATATE',
  'INSALATA','MINESTRA','ZUPPA','BRODO','SUGO','SALSA',
  'ACQUA','VINO','BIRRA','LATTE','CAFFE','TE','SUCCO',
  'MELA','MELE','PERA','PERE','UVA','LIMONE','ARANCIA',
  'OLIO','SALE','PEPE','AGLIO','CIPOLLA','CAROTA',
  
  // Animali
  'GATTO','GATTI','CANE','CANI','UCCELLO','UCCELLI',
  'PESCE','PESCI','CAVALLO','CAVALLI','MUCCA','MUCCHE',
  'LEONE','LEONI','TIGRE','TIGRI','ELEFANTE','ELEFANTI',
  'TOPO','TOPI','CONIGLIO','CONIGLI','VOLPE','VOLPI',
  'LUPO','LUPI','ORSO','ORSI','CERVO','CERVI',
  
  // Natura
  'SOLE','LUNA','STELLE','STELLA','CIELO','TERRA','MARE',
  'FIUME','LAGO','MONTAGNA','MONTAGNE','BOSCO','BOSCHI',
  'FIORE','FIORI','ALBERO','ALBERI','ERBA','FOGLIA','FOGLIE',
  'PIOGGIA','NEVE','VENTO','NUVOLA','NUVOLE','FULMINE',
  
  // Persone e famiglia
  'UOMO','UOMINI','DONNA','DONNE','BAMBINO','BAMBINI',
  'BAMBINA','BAMBINE','RAGAZZO','RAGAZZI','RAGAZZA','RAGAZZE',
  'PADRE','MADRE','FIGLIO','FIGLI','FIGLIA','FIGLIE',
  'FRATELLO','FRATELLI','SORELLA','SORELLE','NONNO','NONNA',
  'ZIO','ZII','ZIA','ZIE','CUGINO','CUGINA',
  
  // Corpo umano
  'TESTA','MANO','MANI','PIEDE','PIEDI','BRACCIO','BRACCIA',
  'OCCHIO','OCCHI','NASO','BOCCA','ORECCHIO','ORECCHIE',
  'CUORE','POLMONE','POLMONI','STOMACO','SCHIENA','GAMBA','GAMBE',
  
  // Verbi comuni (presente indicativo e infinito)
  'ESSERE','AVERE','FARE','DIRE','ANDARE','VENIRE','DARE','STARE',
  'POTERE','VOLERE','DOVERE','SAPERE','VEDERE','SENTIRE',
  'PARLARE','MANGIARE','BERE','DORMIRE','LAVORARE','STUDIARE',
  'LEGGERE','SCRIVERE','GIOCARE','CORRERE','CAMMINARE','NUOTARE',
  'AMARE','VIVERE','MORIRE','NASCERE','CRESCERE','IMPARARE',
  
  // Aggettivi comuni
  'BELLO','BELLA','BELLI','BELLE','BRUTTO','BRUTTA',
  'GRANDE','GRANDI','PICCOLO','PICCOLA','PICCOLI','PICCOLE',
  'LUNGO','LUNGA','CORTO','CORTA','ALTO','ALTA','BASSO','BASSA',
  'NUOVO','NUOVA','VECCHIO','VECCHIA','GIOVANE','GIOVANI',
  'BUONO','BUONA','CATTIVO','CATTIVA','FORTE','DEBOLE',
  'VELOCE','LENTO','LENTA','CALDO','CALDA','FREDDO','FREDDA',
  'FACILE','DIFFICILE','VERO','VERA','FALSO','FALSA',
  
  // Luoghi
  'CITTA','PAESE','QUARTIERE','VIA','PIAZZA','STRADA','STRADE',
  'PARCO','GIARDINO','GIARDINI','SCUOLA','SCUOLE','CHIESA','CHIESE',
  'OSPEDALE','OSPEDALI','UFFICIO','UFFICI','NEGOZIO','NEGOZI',
  'MERCATO','RISTORANTE','ALBERGO','HOTEL','AEROPORTO','STAZIONE',
  
  // Tempo
  'GIORNO','GIORNI','NOTTE','NOTTI','ORA','ORE','MINUTO','MINUTI',
  'ANNO','ANNI','MESE','MESI','SETTIMANA','SETTIMANE',
  'IERI','OGGI','DOMANI','MATTINA','POMERIGGIO','SERA',
  'LUNEDI','MARTEDI','MERCOLEDI','GIOVEDI','VENERDI','SABATO','DOMENICA',
  'GENNAIO','FEBBRAIO','MARZO','APRILE','MAGGIO','GIUGNO',
  'LUGLIO','AGOSTO','SETTEMBRE','OTTOBRE','NOVEMBRE','DICEMBRE',
  'ESTATE','AUTUNNO','INVERNO','PRIMAVERA',
  
  // Sport e giochi
  'SPORT','CALCIO','TENNIS','NUOTO','CORSA','GIOCO','GIOCHI',
  'SQUADRA','SQUADRE','PALLA','PALLONE','CAMPO','CAMPI',
  
  // Parole di 2 lettere utili
  'IO','TU','LUI','LEI','NOI','VOI','LO','LA','LE','LI',
  'MI','TI','VI','CI','NE','SI','MA','SA','FA','DA',
  'VA','HA','SO','DO','RE','ME','TE','SE','NO','SU',
  
  // Altre parole utili
  'TEMPO','VITA','MONDO','GENTE','COSA','COSE','MODO','MODI',
  'PARTE','PARTI','PUNTO','PUNTI','FORMA','FORME','TIPO','TIPI',
  'PROBLEMA','PROBLEMI','IDEA','IDEE','STORIA','STORIE',
  'MUSICA','ARTE','FILM','TEATRO','CINEMA','SPORT',
  'SCUOLA','CLASSE','LEZIONE','LEZIONI','PROFESSORE','PROFESSORI',
  'AMICO','AMICI','AMICA','AMICHE','NEMICO','NEMICI',
  'AMORE','PAURA','GIOIA','DOLORE','FELICE','TRISTE',
  'PAROLA','PAROLE','LINGUA','LINGUE','ITALIANO','ITALIANA'
];

/**
 * Carica il dizionario dal file o usa la lista integrata
 * Il file dovrebbe contenere una parola per riga in maiuscolo
 */
function loadDictionary() {
  if (wordSet !== null) return; // Già caricato
  
  wordSet = new Set();
  
  // Prova a caricare il file dizionario esterno
  const dictPath = path.join(__dirname, '../assets/dizionario-it.txt');
  if (fs.existsSync(dictPath)) {
    try {
      const content = fs.readFileSync(dictPath, 'utf8');
      const lines = content.split('\n');
      let count = 0;
      lines.forEach(line => {
        const word = line.trim().toUpperCase();
        if (word.length >= 2) {
          wordSet.add(word);
          count++;
        }
      });
      console.log(`📚 Dizionario caricato: ${count} parole da file`);
    } catch (err) {
      console.warn('⚠️  Errore caricamento dizionario file, uso lista integrata');
      loadBuiltIn();
    }
  } else {
    console.log('📚 Uso dizionario integrato (aggiungi dizionario-it.txt per espandere)');
    loadBuiltIn();
  }
}

function loadBuiltIn() {
  BUILT_IN_WORDS.forEach(w => wordSet.add(w.toUpperCase()));
  console.log(`📚 Dizionario integrato: ${wordSet.size} parole`);
}

/**
 * Verifica se una parola è valida nel dizionario italiano
 * @param {string} word - La parola da verificare (case insensitive)
 * @returns {boolean}
 */
function isValidWord(word) {
  if (!wordSet) loadDictionary();
  return wordSet.has(word.toUpperCase());
}

/**
 * Verifica tutte le parole di una mossa
 * @param {Array} words - Array di {word} da word-finder
 * @returns {Object} { valid: boolean, invalidWords: [] }
 */
function validateWords(words) {
  if (!wordSet) loadDictionary();
  
  const invalidWords = [];
  words.forEach(w => {
    if (!isValidWord(w.word)) {
      invalidWords.push(w.word);
    }
  });
  
  return {
    valid: invalidWords.length === 0,
    invalidWords
  };
}

// Pre-carica il dizionario all'import del modulo
loadDictionary();

module.exports = { loadDictionary, isValidWord, validateWords };
