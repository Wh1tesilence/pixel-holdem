// Poker Constants — shared between client and server

// Card ranks: 0=2, 1=3, ..., 8=10, 9=J, 10=Q, 11=K, 12=A
const RANK_NAMES = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const RANK_LONG = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

// Suits: 0=spades, 1=hearts, 2=diamonds, 3=clubs
const SUIT_SYMBOLS = ['♠', '♥', '♦', '♣'];
const SUIT_NAMES = ['spades', 'hearts', 'diamonds', 'clubs'];
const SUIT_COLORS = ['black', 'red', 'red', 'black'];

// Hand types, ordered weakest to strongest
const HAND_TYPES = {
  HIGH_CARD: 0,
  ONE_PAIR: 1,
  TWO_PAIR: 2,
  THREE_OF_A_KIND: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  FOUR_OF_A_KIND: 7,
  STRAIGHT_FLUSH: 8,
  ROYAL_FLUSH: 9
};

const HAND_NAMES = [
  'High Card', 'One Pair', 'Two Pair', 'Three of a Kind',
  'Straight', 'Flush', 'Full House', 'Four of a Kind',
  'Straight Flush', 'Royal Flush'
];

// Game phases
const PHASE = {
  WAITING: 'waiting',
  PRE_FLOP: 'pre_flop',
  FLOP: 'flop',
  TURN: 'turn',
  RIVER: 'river',
  SHOWDOWN: 'showdown',
  HAND_END: 'hand_end'
};

// Player actions
const ACTION = {
  FOLD: 'fold',
  CHECK: 'check',
  CALL: 'call',
  RAISE: 'raise',
  ALL_IN: 'all_in'
};

// Default game settings
const STARTING_CHIPS = 1000;
const SMALL_BLIND = 10;
const BIG_BLIND = 20;
const MIN_RAISE = 20;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 9;
const ROOM_CODE_LENGTH = 6;
const ACTION_TIMEOUT_MS = 30000; // 30s auto-fold

// Convert rank to display string
function rankName(rank) {
  return RANK_NAMES[rank];
}

// Convert suit to display symbol
function suitSymbol(suit) {
  return SUIT_SYMBOLS[suit];
}

// Check if suit is red
function isRed(suit) {
  return suit === 1 || suit === 2; // hearts or diamonds
}

// cardId = suit * 13 + rank
function cardRank(cardId) {
  return cardId % 13;
}

function cardSuit(cardId) {
  return Math.floor(cardId / 13);
}

function cardToString(cardId) {
  return rankName(cardRank(cardId)) + suitSymbol(cardSuit(cardId));
}

// Export for both Node and browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    RANK_NAMES, RANK_LONG, SUIT_SYMBOLS, SUIT_NAMES, SUIT_COLORS,
    HAND_TYPES, HAND_NAMES, PHASE, ACTION,
    STARTING_CHIPS, SMALL_BLIND, BIG_BLIND, MIN_RAISE,
    MIN_PLAYERS, MAX_PLAYERS, ROOM_CODE_LENGTH, ACTION_TIMEOUT_MS,
    rankName, suitSymbol, isRed, cardRank, cardSuit, cardToString
  };
}
