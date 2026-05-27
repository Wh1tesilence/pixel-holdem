// Game Engine — Texas Hold'em state machine
// Runs server-side as the single source of truth.

const { createDeck, shuffle, deal } = require('./deck.js');
const { evaluateHand, compareHands } = require('./evaluator.js');
const { PHASE, ACTION, HAND_NAMES, SMALL_BLIND, BIG_BLIND, MIN_RAISE, STARTING_CHIPS } = require('./constants.js');

class GameEngine {
  constructor(players) {
    this.players = players.map((name) => ({
      id: name,
      name: name,
      chips: STARTING_CHIPS,
      holeCards: [],
      folded: false,
      isAllIn: false,
      currentBetThisRound: 0,    // chips put in during current betting round
      totalBetThisHand: 0,        // total chips put in this hand (for side pot calc)
      hasActedThisRound: false,
      isActive: true,             // still in the game (not busted)
      lastAction: null
    }));

    this.dealerIdx = Math.floor(Math.random() * this.players.length);
    this.phase = PHASE.WAITING;
    this.deck = [];
    this.communityCards = [];
    this.pot = 0;
    this.sidePots = [];
    this.currentBet = 0;           // highest bet this round
    this.currentPlayerIdx = -1;
    this.smallBlind = SMALL_BLIND;
    this.bigBlind = BIG_BLIND;
    this.handNumber = 0;
    this.result = null;
    this.minRaise = MIN_RAISE;
    this.lastRaiseAmount = 0;      // size of the last raise (for min re-raise)
  }

  // ---- Player helpers ----

  activePlayers() {
    return this.players.filter(p => p.isActive);
  }

  actingPlayers() {
    return this.players.filter(p => !p.folded && !p.isAllIn && p.isActive);
  }

  playersInHand() {
    return this.players.filter(p => p.isActive);
  }

  getPlayer(playerId) {
    return this.players.find(p => p.id === playerId);
  }

  // ---- Blind / position helpers ----

  findNextActive(fromIdx) {
    const n = this.players.length;
    for (let i = 1; i <= n; i++) {
      const idx = (fromIdx + i) % n;
      if (this.players[idx].isActive) return idx;
    }
    return -1;
  }

  smallBlindIdx() {
    if (this.activePlayers().length === 2) {
      return this.dealerIdx; // heads-up: dealer is small blind
    }
    return this.findNextActive(this.dealerIdx);
  }

  bigBlindIdx() {
    const sb = this.smallBlindIdx();
    if (this.activePlayers().length === 2) {
      return this.findNextActive(sb);
    }
    return this.findNextActive(sb);
  }

  firstToActIdx() {
    if (this.phase === PHASE.PRE_FLOP) {
      // After big blind
      const bb = this.bigBlindIdx();
      return this.findNextActive(bb);
    }
    // Other rounds: first active player after dealer
    return this.findNextActive(this.dealerIdx);
  }

  // ---- Hand lifecycle ----

  canStart() {
    return this.activePlayers().length >= 2;
  }

  startHand() {
    this.handNumber++;
    this.phase = PHASE.PRE_FLOP;

    // Reset per-hand state
    this.deck = shuffle(createDeck());
    this.communityCards = [];
    this.pot = 0;
    this.sidePots = [];
    this.currentBet = 0;
    this.result = null;
    this.lastRaiseAmount = 0;

    for (const p of this.players) {
      if (p.isActive) {
        p.holeCards = [];
        p.folded = false;
        p.isAllIn = false;
        p.currentBetThisRound = 0;
        p.totalBetThisHand = 0;
        p.hasActedThisRound = false;
        p.lastAction = null;
      } else {
        p.holeCards = [];
        p.folded = true;
        p.isAllIn = false;
        p.currentBetThisRound = 0;
        p.totalBetThisHand = 0;
        p.hasActedThisRound = false;
        p.lastAction = null;
      }
    }

    // Deal 2 hole cards to each active player
    for (const p of this.activePlayers()) {
      p.holeCards = deal(this.deck, 2);
    }

    // Post blinds
    this.postBlinds();

    // Set first player to act
    this.currentPlayerIdx = this.firstToActIdx();

    // Handle rare case: first-to-act is all-in from blinds
    const first = this.players[this.currentPlayerIdx];
    if (first && (first.folded || first.isAllIn || !first.isActive)) {
      this.advanceToNextPlayer();
    }
  }

  postBlinds() {
    const sbIdx = this.smallBlindIdx();
    const bbIdx = this.bigBlindIdx();

    const sb = this.players[sbIdx];
    const bb = this.players[bbIdx];

    // Small blind
    const sbAmount = Math.min(this.smallBlind, sb.chips);
    sb.chips -= sbAmount;
    sb.totalBetThisHand += sbAmount;
    sb.currentBetThisRound += sbAmount;

    // Big blind
    const bbAmount = Math.min(this.bigBlind, bb.chips);
    bb.chips -= bbAmount;
    bb.totalBetThisHand += bbAmount;
    bb.currentBetThisRound += bbAmount;

    this.currentBet = bbAmount;
    this.pot = sbAmount + bbAmount;

    if (sb.chips === 0) sb.isAllIn = true;
    if (bb.chips === 0) bb.isAllIn = true;
  }

  // ---- Betting round management ----

  isRoundComplete() {
    const actors = this.actingPlayers();
    if (actors.length <= 1) return true;

    return actors.every(p => p.hasActedThisRound && p.currentBetThisRound === this.currentBet);
  }

  advanceToNextPlayer() {
    if (this.actingPlayers().length <= 1) {
      this.finishBettingRound();
      return;
    }

    const n = this.players.length;
    let attempts = 0;
    while (attempts < n) {
      this.currentPlayerIdx = (this.currentPlayerIdx + 1) % n;
      const p = this.players[this.currentPlayerIdx];
      if (!p.folded && !p.isAllIn && p.isActive) {
        return;
      }
      attempts++;
    }

    this.finishBettingRound();
  }

  // ---- Player actions ----

  getAvailableActions(playerId) {
    const player = this.getPlayer(playerId);
    if (!player || player.folded || player.isAllIn) return [];

    const toCall = this.currentBet - player.currentBetThisRound;
    const actions = [];

    // Fold always available
    actions.push(ACTION.FOLD);

    // Check only if no need to call
    if (toCall === 0) {
      actions.push(ACTION.CHECK);
    }

    // Call if there's a bet to match and player can afford it
    if (toCall > 0) {
      actions.push(ACTION.CALL);
      if (toCall >= player.chips) {
        actions.push(ACTION.ALL_IN);
      }
    }

    // Raise if player has enough chips
    const minTotalRaise = this.currentBet + Math.max(this.minRaise, this.lastRaiseAmount);
    if (player.chips > toCall && player.chips >= minTotalRaise - player.currentBetThisRound) {
      actions.push(ACTION.RAISE);
    }

    // All-in always available
    if (!actions.includes(ACTION.ALL_IN) && player.chips > 0) {
      actions.push(ACTION.ALL_IN);
    }

    return [...new Set(actions)];
  }

  handleAction(playerId, action, amount = 0) {
    const player = this.getPlayer(playerId);
    if (!player || player.folded || player.isAllIn) {
      return { error: 'Player cannot act' };
    }
    if (this.players.indexOf(player) !== this.currentPlayerIdx) {
      return { error: 'Not your turn' };
    }

    const available = this.getAvailableActions(playerId);
    if (!available.includes(action)) {
      return { error: `Invalid action: ${action}. Available: ${available.join(', ')}` };
    }

    player.hasActedThisRound = true;
    player.lastAction = action;

    switch (action) {
      case ACTION.FOLD:
        player.folded = true;
        break;

      case ACTION.CHECK:
        // Do nothing, bet stays
        break;

      case ACTION.CALL: {
        const callAmt = Math.min(this.currentBet - player.currentBetThisRound, player.chips);
        player.chips -= callAmt;
        player.totalBetThisHand += callAmt;
        player.currentBetThisRound += callAmt;
        if (player.chips === 0) player.isAllIn = true;
        break;
      }

      case ACTION.RAISE: {
        const toCall = this.currentBet - player.currentBetThisRound;
        const totalNeeded = toCall + amount;
        const actual = Math.min(totalNeeded, player.chips);
        player.chips -= actual;
        player.totalBetThisHand += actual;
        player.currentBetThisRound += actual;

        this.currentBet = player.currentBetThisRound;
        this.lastRaiseAmount = amount;
        if (player.chips === 0) player.isAllIn = true;

        // Reset acted state: others must respond to the raise
        for (const p of this.players) {
          if (p.id !== playerId && !p.folded && !p.isAllIn) {
            p.hasActedThisRound = false;
          }
        }
        break;
      }

      case ACTION.ALL_IN: {
        const allInAmt = player.chips;
        player.chips = 0;
        player.totalBetThisHand += allInAmt;
        player.currentBetThisRound += allInAmt;
        player.isAllIn = true;

        if (player.currentBetThisRound > this.currentBet) {
          this.currentBet = player.currentBetThisRound;
          this.lastRaiseAmount = player.currentBetThisRound - (this.currentBet - this.lastRaiseAmount);
          // Reset others if it's a valid raise
          if (allInAmt >= this.minRaise || player.currentBetThisRound === this.currentBet) {
            for (const p of this.players) {
              if (p.id !== playerId && !p.folded && !p.isAllIn) {
                p.hasActedThisRound = false;
              }
            }
          }
        }
        break;
      }
    }

    // Update pot
    this.recalculatePot();

    // Check if round is complete
    if (this.isRoundComplete()) {
      this.finishBettingRound();
    } else {
      this.advanceToNextPlayer();
    }

    return { success: true };
  }

  recalculatePot() {
    this.pot = this.players.reduce((sum, p) => sum + p.totalBetThisHand, 0);
  }

  finishBettingRound() {
    // Reset betting round state
    for (const p of this.players) {
      p.currentBetThisRound = 0;
      p.hasActedThisRound = false;
    }
    this.currentBet = 0;
    this.lastRaiseAmount = 0;

    // Advance game phase
    switch (this.phase) {
      case PHASE.PRE_FLOP:
        this.dealFlop();
        break;
      case PHASE.FLOP:
        this.dealTurn();
        break;
      case PHASE.TURN:
        this.dealRiver();
        break;
      case PHASE.RIVER:
        this.goToShowdown();
        break;
    }
  }

  // ---- Dealing community cards ----

  dealFlop() {
    deal(this.deck, 1); // burn
    this.communityCards.push(...deal(this.deck, 3));
    this.phase = PHASE.FLOP;
    this.startBettingRound();
  }

  dealTurn() {
    deal(this.deck, 1); // burn
    this.communityCards.push(...deal(this.deck, 1));
    this.phase = PHASE.TURN;
    this.startBettingRound();
  }

  dealRiver() {
    deal(this.deck, 1); // burn
    this.communityCards.push(...deal(this.deck, 1));
    this.phase = PHASE.RIVER;
    this.startBettingRound();
  }

  startBettingRound() {
    const actors = this.actingPlayers();
    if (actors.length <= 1) {
      // Everyone else folded or all-in, skip remaining betting
      this.goToShowdown();
      return;
    }
    this.currentPlayerIdx = this.firstToActIdx();
  }

  // ---- Showdown ----

  goToShowdown() {
    this.phase = PHASE.SHOWDOWN;

    const contenders = this.players.filter(p => !p.folded && p.isActive);
    const results = [];

    if (contenders.length === 1) {
      // Only one left — no need to evaluate
      const winner = contenders[0];
      this.calculateAndAwardPots([{ playerId: winner.id, hand: null, handType: -1, handName: 'Last standing', kickers: [] }]);
      return;
    }

    // Evaluate each contender's best hand
    for (const player of contenders) {
      const allCards = [...player.holeCards, ...this.communityCards];
      if (allCards.length < 5) {
        // Edge case: not enough cards (extreme all-in scenario)
        results.push({ playerId: player.id, hand: null, handType: -1, handName: 'N/A', kickers: [] });
        continue;
      }
      const evaluation = evaluateHand(allCards);
      results.push({
        playerId: player.id,
        hand: evaluation,
        handType: evaluation.handType,
        handName: evaluation.handName,
        kickers: evaluation.kickers,
        cards: evaluation.cards
      });
    }

    this.calculateAndAwardPots(results);
  }

  calculateAndAwardPots(results) {
    // Calculate side pots
    // Collect all players' total contributions and their results
    const allContributions = this.players
      .filter(p => !p.folded && p.isActive)
      .map(p => ({
        playerId: p.id,
        contributed: p.totalBetThisHand,
        result: results.find(r => r.playerId === p.id)
      }));

    // Sort by contribution ascending
    allContributions.sort((a, b) => a.contributed - b.contributed);

    // For each level, calculate a side pot
    let prevLevel = 0;
    const pots = [];
    let remainingPot = this.pot;

    for (const entry of allContributions) {
      const level = entry.contributed;
      if (level <= prevLevel) continue;

      const diff = level - prevLevel;

      // Eligible players: those who contributed at least `level`
      const eligible = allContributions.filter(e => e.contributed >= level);

      // Calculate this side pot
      const sidePotAmount = diff * eligible.length;
      if (sidePotAmount > 0 && eligible.length > 0) {
        pots.push({
          amount: sidePotAmount,
          eligibles: eligible.map(e => e.playerId)
        });
      }

      prevLevel = level;
    }

    // Any leftover goes to the highest level pot
    const totalDistributed = pots.reduce((s, p) => s + p.amount, 0);
    if (remainingPot > totalDistributed && pots.length > 0) {
      pots[pots.length - 1].amount += (remainingPot - totalDistributed);
    }

    // Award each pot
    const winners = [];
    const awards = []; // { playerId, amount, handName, potIndex }

    for (let i = 0; i < pots.length; i++) {
      const pot = pots[i];
      const eligibleResults = allContributions
        .filter(e => pot.eligibles.includes(e.playerId))
        .map(e => e.result)
        .filter(r => r && r.hand !== null);

      if (eligibleResults.length === 0) {
        // No results to compare — give to first eligible
        const first = allContributions.find(e => pot.eligibles.includes(e.playerId));
        if (first) {
          awards.push({ playerId: first.playerId, amount: pot.amount, handName: 'Default', potIndex: i });
          const player = this.getPlayer(first.playerId);
          if (player) player.chips += pot.amount;
        }
        continue;
      }

      // Find best hand among eligible
      let best = eligibleResults[0];
      for (let j = 1; j < eligibleResults.length; j++) {
        if (compareHands(eligibleResults[j].hand, best.hand) > 0) {
          best = eligibleResults[j];
        }
      }

      // Check for ties
      const tied = eligibleResults.filter(r => r !== best && compareHands(r.hand, best.hand) === 0);

      if (tied.length > 0) {
        // Split pot among tied winners
        const allWinners = [best, ...tied];
        const splitAmount = Math.floor(pot.amount / allWinners.length);
        const remainder = pot.amount - splitAmount * allWinners.length;

        for (const w of allWinners) {
          const amt = splitAmount + (w === best ? remainder : 0);
          awards.push({ playerId: w.playerId, amount: amt, handName: best.handName, potIndex: i, isSplit: true });
          const player = this.getPlayer(w.playerId);
          if (player) player.chips += amt;
        }
      } else {
        awards.push({ playerId: best.playerId, amount: pot.amount, handName: best.handName, potIndex: i });
        const player = this.getPlayer(best.playerId);
        if (player) player.chips += pot.amount;
      }

      if (!winners.includes(best.playerId)) winners.push(best.playerId);
    }

    // Determine eliminated players
    for (const p of this.players) {
      if (p.chips <= 0 && p.isActive) {
        p.isActive = false;
        p.folded = true;
      }
    }

    this.result = { awards, results, winners };
    this.phase = PHASE.HAND_END;
  }

  // ---- Next hand ----

  nextHand() {
    if (this.activePlayers().length < 2) {
      return { gameOver: true, winner: this.activePlayers()[0] || this.players[0] };
    }

    // Rotate dealer
    this.dealerIdx = this.findNextActive(this.dealerIdx);

    // Update blinds (escalating blinds every 10 hands)
    if (this.handNumber % 10 === 0) {
      this.smallBlind *= 2;
      this.bigBlind *= 2;
      this.minRaise = this.bigBlind;
    }

    this.phase = PHASE.PRE_FLOP;
    this.startHand();
    return { gameOver: false };
  }

  // ---- State snapshot for clients ----

  getState(forPlayerId = null) {
    const players = this.players.map(p => {
      const base = {
        id: p.id,
        name: p.name,
        chips: p.chips,
        folded: p.folded,
        isAllIn: p.isAllIn,
        isActive: p.isActive,
        currentBetThisRound: p.currentBetThisRound,
        totalBetThisHand: p.totalBetThisHand,
        hasActedThisRound: p.hasActedThisRound,
        lastAction: p.lastAction,
        holeCardCount: p.holeCards.length
      };

      // Only reveal hole cards to the owning player, or at showdown
      if (p.id === forPlayerId || this.phase === PHASE.SHOWDOWN || this.phase === PHASE.HAND_END) {
        base.holeCards = p.holeCards;
      } else {
        base.holeCards = p.holeCards.length > 0 ? [-1, -1] : []; // -1 = hidden
      }

      return base;
    });

    const state = {
      phase: this.phase,
      handNumber: this.handNumber,
      communityCards: this.communityCards,
      pot: this.pot,
      sidePots: this.sidePots,
      currentBet: this.currentBet,
      currentPlayerIdx: this.currentPlayerIdx,
      dealerIdx: this.dealerIdx,
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      players: players,
      result: this.result,
      availableActions: null
    };

    // Include available actions if it's this player's turn
    if (forPlayerId) {
      const player = this.getPlayer(forPlayerId);
      if (player && this.players.indexOf(player) === this.currentPlayerIdx) {
        state.availableActions = this.getAvailableActions(forPlayerId);
        // Include min/max raise info
        const toCall = this.currentBet - player.currentBetThisRound;
        state.minRaiseAmount = Math.max(this.minRaise, this.lastRaiseAmount);
        state.maxRaiseAmount = player.chips - toCall;
        state.toCall = toCall;
      }
    }

    return state;
  }
}

module.exports = { GameEngine };
