// Deck operations
// cardId = suit * 13 + rank  (0-51)

function createDeck() {
  const deck = [];
  for (let i = 0; i < 52; i++) {
    deck.push(i);
  }
  return deck;
}

function shuffle(deck) {
  // Fisher-Yates shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function deal(deck, count) {
  const cards = [];
  for (let i = 0; i < count; i++) {
    cards.push(deck.pop());
  }
  return cards;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createDeck, shuffle, deal };
}
