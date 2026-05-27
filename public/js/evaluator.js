// Hand Evaluator — find best 5-card hand from 7 cards
// cardId = suit * 13 + rank, rank: 0=2 .. 12=A

function cardRank(cardId) { return cardId % 13; }
function cardSuit(cardId) { return Math.floor(cardId / 13); }

// Score = handType * 13^5 + k1*13^4 + k2*13^3 + k3*13^2 + k4*13 + k5
const P13_5 = 371293;
const P13_4 = 28561;
const P13_3 = 2197;
const P13_2 = 169;
const P13_1 = 13;

function evaluateHand(sevenCards) {
  if (sevenCards.length !== 7) {
    throw new Error('evaluateHand requires exactly 7 cards');
  }

  // Generate all C(7,5) = 21 combinations
  const combos = [];
  for (let a = 0; a < 3; a++) {
    for (let b = a + 1; b < 4; b++) {
      for (let c = b + 1; c < 5; c++) {
        for (let d = c + 1; d < 6; d++) {
          for (let e = d + 1; e < 7; e++) {
            combos.push([sevenCards[a], sevenCards[b], sevenCards[c], sevenCards[d], sevenCards[e]]);
          }
        }
      }
    }
  }

  let bestScore = -1;
  let bestCards = null;
  let bestHandType = -1;
  let bestKickers = null;

  for (const combo of combos) {
    const { handType, kickers } = evaluateFive(combo);
    const score = handType * P13_5 +
      kickers[0] * P13_4 +
      kickers[1] * P13_3 +
      kickers[2] * P13_2 +
      kickers[3] * P13_1 +
      kickers[4];

    if (score > bestScore) {
      bestScore = score;
      bestCards = combo;
      bestHandType = handType;
      bestKickers = kickers;
    }
  }

  return {
    handType: bestHandType,
    handName: ['High Card', 'One Pair', 'Two Pair', 'Three of a Kind',
               'Straight', 'Flush', 'Full House', 'Four of a Kind',
               'Straight Flush', 'Royal Flush'][bestHandType],
    cards: bestCards,
    kickers: bestKickers,
    score: bestScore
  };
}

function evaluateFive(cards) {
  const ranks = cards.map(cardRank);
  const suits = cards.map(cardSuit);

  // Sort ranks descending
  ranks.sort((a, b) => b - a);

  const isFlush = suits.every(s => s === suits[0]);

  // Check straight
  const isNormalStraight = ranks[0] - ranks[1] === 1 &&
    ranks[1] - ranks[2] === 1 &&
    ranks[2] - ranks[3] === 1 &&
    ranks[3] - ranks[4] === 1;

  // Wheel: A-2-3-4-5 (ranks: 12, 3, 2, 1, 0)
  const isWheel = ranks[0] === 12 && ranks[1] === 3 &&
    ranks[2] === 2 && ranks[3] === 1 && ranks[4] === 0;

  const isStraight = isNormalStraight || isWheel;

  // Count rank frequencies
  const freq = {};
  for (const r of ranks) {
    freq[r] = (freq[r] || 0) + 1;
  }

  // Separate by frequency: quads, trips, pairs, singles
  const groups = { 4: [], 3: [], 2: [], 1: [] };
  for (const [r, count] of Object.entries(freq)) {
    groups[count].push(parseInt(r));
  }

  // Sort each group descending
  for (const key of [4, 3, 2, 1]) {
    groups[key].sort((a, b) => b - a);
  }

  // --- Classify hand ---
  let handType;
  let kickers;

  if (isFlush && isStraight) {
    if (isWheel) {
      // Straight flush: wheel (5-high)
      handType = 8; // STRAIGHT_FLUSH
      kickers = [3, 2, 1, 0, -1]; // 5-4-3-2-A
    } else if (ranks[0] === 12 && ranks[1] === 11) {
      // Royal Flush: A-K-Q-J-10
      handType = 9;
      kickers = [12, 11, 10, 9, 8];
    } else {
      handType = 8;
      kickers = [...ranks];
    }
  } else if (groups[4].length > 0) {
    // Four of a Kind
    handType = 7;
    const quad = groups[4][0];
    const kicker = groups[1][0];
    kickers = [quad, quad, quad, quad, kicker];
  } else if (groups[3].length > 0 && groups[2].length > 0) {
    // Full House
    handType = 6;
    const trip = groups[3][0];
    const pair = groups[2][0];
    kickers = [trip, trip, trip, pair, pair];
  } else if (isFlush) {
    handType = 5;
    kickers = [...ranks];
  } else if (isStraight) {
    handType = 4;
    if (isWheel) {
      kickers = [3, 2, 1, 0, -1]; // 5-high straight
    } else {
      kickers = [...ranks];
    }
  } else if (groups[3].length > 0) {
    // Three of a Kind
    handType = 3;
    const trip = groups[3][0];
    const kick = groups[1];
    kickers = [trip, trip, trip, kick[0], kick[1]];
  } else if (groups[2].length >= 2) {
    // Two Pair
    handType = 2;
    const high = groups[2][0];
    const low = groups[2][1];
    const kick = groups[1][0];
    kickers = [high, high, low, low, kick];
  } else if (groups[2].length === 1) {
    // One Pair
    handType = 1;
    const pair = groups[2][0];
    const kick = groups[1];
    kickers = [pair, pair, kick[0], kick[1], kick[2]];
  } else {
    // High Card
    handType = 0;
    kickers = [...ranks];
  }

  return { handType, kickers };
}

// Compare two hands (hand objects from evaluateHand). Returns >0 if hand1 wins.
function compareHands(hand1, hand2) {
  if (hand1.handType !== hand2.handType) {
    return hand1.handType - hand2.handType;
  }
  for (let i = 0; i < 5; i++) {
    if (hand1.kickers[i] !== hand2.kickers[i]) {
      return hand1.kickers[i] - hand2.kickers[i];
    }
  }
  return 0; // exact tie (split pot)
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { evaluateHand, evaluateFive, compareHands };
}
