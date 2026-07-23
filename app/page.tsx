"use client";

import { useMemo, useRef, useState } from "react";

type NumberCard = { id: string; kind: "number"; value: number };
type ModifierCard = { id: string; kind: "modifier"; value: 2 | 4 | 6 | 8 | 10; label: string };
type DoubleCard = { id: string; kind: "double"; label: "×2" };
type ActionCard = {
  id: string;
  kind: "action";
  action: "freeze" | "flip3" | "secondChance";
  label: string;
};
type Card = NumberCard | ModifierCard | DoubleCard | ActionCard;

type Player = {
  id: string;
  name: string;
  total: number;
  hand: Card[];
  status: "playing" | "stayed" | "busted";
  flip7: boolean;
};

type ForcedDraw = { playerId: string; remaining: number; resumeFromId: string } | null;
type PendingAction = { card: ActionCard; sourceId: string } | null;
type SoundKind = "flip" | "stay" | "bust" | "roundWin" | "gameWin";

const SCORE_OPTIONS = [50, 100, 150, 200] as const;
const colors = ["coral", "gold", "teal", "plum", "sky", "rose", "lime", "amber"];

function createDeck(): Card[] {
  const cards: Card[] = [{ id: "n-0-0", kind: "number", value: 0 }];
  for (let value = 1; value <= 12; value += 1) {
    for (let copy = 0; copy < value; copy += 1) {
      cards.push({ id: `n-${value}-${copy}`, kind: "number", value });
    }
  }
  ([2, 4, 6, 8, 10] as const).forEach((value) => {
    cards.push({ id: `mod-${value}`, kind: "modifier", value, label: `+${value}` });
  });
  cards.push({ id: "mod-double", kind: "double", label: "×2" });
  for (let copy = 0; copy < 3; copy += 1) {
    cards.push({ id: `freeze-${copy}`, kind: "action", action: "freeze", label: "Freeze" });
    cards.push({ id: `flip3-${copy}`, kind: "action", action: "flip3", label: "Flip Three" });
    cards.push({
      id: `chance-${copy}`,
      kind: "action",
      action: "secondChance",
      label: "Second Chance",
    });
  }
  return shuffle(cards);
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

function scoreHand(player: Player): number {
  if (player.status === "busted") return 0;
  const numberTotal = player.hand.reduce(
    (sum, card) => sum + (card.kind === "number" ? card.value : 0),
    0,
  );
  const addition = player.hand.reduce(
    (sum, card) => sum + (card.kind === "modifier" ? card.value : 0),
    0,
  );
  const hasDouble = player.hand.some((card) => card.kind === "double");
  return numberTotal * (hasDouble ? 2 : 1) + addition + (player.flip7 ? 15 : 0);
}

function cardLabel(card: Card): string {
  if (card.kind === "number") return String(card.value);
  return card.label;
}

function cardClass(card: Card): string {
  if (card.kind === "number") return `number number-${card.value}`;
  if (card.kind === "modifier" || card.kind === "double") return "modifier";
  if (card.action === "secondChance") return "chance";
  return "action";
}

function nextPlayingIndex(players: Player[], fromIndex: number): number | null {
  for (let offset = 1; offset <= players.length; offset += 1) {
    const candidate = (fromIndex + offset) % players.length;
    if (players[candidate].status === "playing") return candidate;
  }
  return null;
}

export default function Home() {
  const [screen, setScreen] = useState<"setup" | "game" | "gameOver">("setup");
  const [names, setNames] = useState(["", ""]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [deck, setDeck] = useState<Card[]>([]);
  const [discard, setDiscard] = useState<Card[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [round, setRound] = useState(1);
  const [lastCard, setLastCard] = useState<Card | null>(null);
  const [notice, setNotice] = useState("Draw your first card to begin.");
  const [roundSummary, setRoundSummary] = useState<Player[] | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [forcedDraw, setForcedDraw] = useState<ForcedDraw>(null);
  const [showRules, setShowRules] = useState(false);
  const [targetScore, setTargetScore] = useState<number>(200);
  const [soundOn, setSoundOn] = useState(true);
  const [bustCards, setBustCards] = useState<Record<string, string>>({});
  const audioContextRef = useRef<AudioContext | null>(null);

  const activePlayer = players[activeIndex];
  const activeScore = activePlayer ? scoreHand(activePlayer) : 0;
  const activeNumbers = activePlayer
    ? activePlayer.hand.filter((card): card is NumberCard => card.kind === "number").length
    : 0;
  const roundHigh = roundSummary
    ? Math.max(...roundSummary.map((player) => scoreHand(player)))
    : 0;
  const roundWinners = roundSummary
    ? roundSummary.filter((player) => scoreHand(player) === roundHigh && roundHigh > 0)
    : [];

  const leaders = useMemo(() => {
    if (!players.length) return [];
    const high = Math.max(...players.map((player) => player.total));
    return players.filter((player) => player.total === high);
  }, [players]);

  function updateName(index: number, value: string) {
    setNames((current) => current.map((name, i) => (i === index ? value.slice(0, 18) : name)));
  }

  function addPlayer() {
    if (names.length < 8) setNames((current) => [...current, ""]);
  }

  function removePlayer(index: number) {
    if (names.length > 2) setNames((current) => current.filter((_, i) => i !== index));
  }

  function playSound(kind: SoundKind, delay = 0) {
    if (!soundOn || typeof window === "undefined") return;
    const AudioContextClass = window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = audioContextRef.current || new AudioContextClass();
    audioContextRef.current = context;
    if (context.state === "suspended") void context.resume();

    const patterns: Record<SoundKind, Array<[number, number, number, OscillatorType, number]>> = {
      flip: [[330, 0, .055, "square", .055], [660, .045, .075, "triangle", .04]],
      stay: [[523, 0, .1, "triangle", .045], [392, .09, .16, "triangle", .05], [262, .19, .24, "sine", .055]],
      bust: [[260, 0, .13, "sawtooth", .075], [180, .11, .18, "sawtooth", .07], [92, .27, .28, "square", .055]],
      roundWin: [[392, 0, .13, "square", .045], [523, .12, .13, "square", .045], [659, .24, .15, "square", .05], [784, .37, .3, "triangle", .055]],
      gameWin: [[392, 0, .18, "square", .05], [523, .11, .18, "square", .05], [659, .22, .2, "square", .055], [784, .34, .24, "triangle", .06], [1047, .5, .48, "triangle", .065]],
    };

    patterns[kind].forEach(([frequency, offset, duration, wave, volume]) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + delay + offset;
      oscillator.type = wave;
      oscillator.frequency.setValueAtTime(frequency, start);
      if (kind === "bust") {
        oscillator.frequency.exponentialRampToValueAtTime(frequency * .62, start + duration);
      }
      gain.gain.setValueAtTime(.0001, start);
      gain.gain.exponentialRampToValueAtTime(volume, start + .018);
      gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + duration + .02);
    });
  }

  function startGame() {
    const cleanNames = names.map((name, index) => name.trim() || `Player ${index + 1}`);
    const freshPlayers = cleanNames.map((name, index) => ({
      id: `player-${Date.now()}-${index}`,
      name,
      total: 0,
      hand: [],
      status: "playing" as const,
      flip7: false,
    }));
    setPlayers(freshPlayers);
    setDeck(createDeck());
    setDiscard([]);
    setRound(1);
    setActiveIndex(0);
    setLastCard(null);
    setNotice(`${freshPlayers[0].name}, draw your first card.`);
    setRoundSummary(null);
    setPendingAction(null);
    setForcedDraw(null);
    setBustCards({});
    setScreen("game");
  }

  function resetToSetup() {
    setScreen("setup");
    setPlayers([]);
    setLastCard(null);
    setRoundSummary(null);
    setBustCards({});
  }

  function drawTopCard(): { card: Card; nextDeck: Card[] } {
    if (deck.length) return { card: deck[0], nextDeck: deck.slice(1) };
    const recycled = shuffle(discard);
    setDiscard([]);
    return { card: recycled[0], nextDeck: recycled.slice(1) };
  }

  function finishRound(updatedPlayers: Player[], message?: string) {
    const scored = updatedPlayers.map((player) => ({
      ...player,
      total: player.total + scoreHand(player),
    }));
    setPlayers(scored);
    setRoundSummary(scored);
    setPendingAction(null);
    setForcedDraw(null);
    setNotice(message || "Round complete. Points are on the board.");
    playSound("roundWin", .55);
  }

  function handOff(updatedPlayers: Player[], fromIndex: number, message: string) {
    const next = nextPlayingIndex(updatedPlayers, fromIndex);
    if (next === null || updatedPlayers.filter((player) => player.status === "playing").length === 0) {
      finishRound(updatedPlayers, message);
      return;
    }
    setPlayers(updatedPlayers);
    setActiveIndex(next);
    setNotice(message);
  }

  function resolveCardFor(playerIndex: number, card: Card, nextDeck: Card[]) {
    const updated = players.map((player) => ({ ...player, hand: [...player.hand] }));
    const player = updated[playerIndex];
    setDeck(nextDeck);
    setLastCard(card);

    if (card.kind === "number") {
      const duplicate = player.hand.some(
        (held) => held.kind === "number" && held.value === card.value,
      );
      if (duplicate) {
        const chanceIndex = player.hand.findIndex(
          (held) => held.kind === "action" && held.action === "secondChance",
        );
        if (chanceIndex >= 0) {
          const usedChance = player.hand.splice(chanceIndex, 1)[0];
          setDiscard((current) => [...current, usedChance, card]);
          setPlayers(updated);
          const message = `${player.name} used a Second Chance. The duplicate ${card.value} is discarded.`;
          setNotice(message);
          continueAfterDraw(updated, playerIndex, message);
          return;
        }
        player.hand.push(card);
        player.status = "busted";
        setBustCards((current) => ({ ...current, [player.id]: card.id }));
        playSound("bust", .08);
        setPlayers(updated);
        const message = `${player.name} flipped another ${card.value} and busted.`;
        setNotice(message);
        continueAfterDraw(updated, playerIndex, message, true);
        return;
      }
      player.hand.push(card);
      const uniqueNumbers = player.hand.filter((held) => held.kind === "number").length;
      if (uniqueNumbers === 7) {
        player.flip7 = true;
        setPlayers(updated);
        finishRound(updated, `${player.name} flipped seven unique numbers! +15 bonus.`);
        return;
      }
      setPlayers(updated);
      const message = `${player.name} flipped a ${card.value}.`;
      setNotice(message);
      continueAfterDraw(updated, playerIndex, message);
      return;
    }

    player.hand.push(card);
    setPlayers(updated);
    if (card.kind === "action" && card.action !== "secondChance") {
      setPendingAction({ card, sourceId: player.id });
      setNotice(`${player.name} drew ${card.label}. Choose a player.`);
      return;
    }
    let message = `${player.name} is protected by a Second Chance.`;
    if (card.kind === "modifier") message = `${player.name} added ${card.label} to this round.`;
    if (card.kind === "double") message = `${player.name} will double their number cards.`;
    setNotice(message);
    continueAfterDraw(updated, playerIndex, message);
  }

  function continueAfterDraw(updated: Player[], playerIndex: number, message: string, playerOut = false) {
    if (forcedDraw && forcedDraw.playerId === updated[playerIndex].id) {
      const remaining = forcedDraw.remaining - 1;
      if (remaining > 0 && !playerOut && updated[playerIndex].status === "playing") {
        setForcedDraw({ ...forcedDraw, remaining });
        setActiveIndex(playerIndex);
        setPlayers(updated);
        return;
      }
      const resumeIndex = updated.findIndex((player) => player.id === forcedDraw.resumeFromId);
      setForcedDraw(null);
      handOff(updated, resumeIndex >= 0 ? resumeIndex : playerIndex, message);
      return;
    }
    handOff(updated, playerIndex, message);
  }

  function drawCard() {
    if (!activePlayer || activePlayer.status !== "playing" || pendingAction || roundSummary) return;
    playSound("flip");
    const { card, nextDeck } = drawTopCard();
    resolveCardFor(activeIndex, card, nextDeck);
  }

  function stay() {
    if (!activePlayer || activePlayer.hand.length === 0 || forcedDraw) return;
    playSound("stay");
    const updated = players.map((player, index) =>
      index === activeIndex ? { ...player, status: "stayed" as const } : player,
    );
    handOff(updated, activeIndex, `${activePlayer.name} stayed with ${scoreHand(activePlayer)} points.`);
  }

  function targetAction(targetId: string) {
    if (!pendingAction) return;
    const targetIndex = players.findIndex((player) => player.id === targetId);
    const sourceIndex = players.findIndex((player) => player.id === pendingAction.sourceId);
    if (targetIndex < 0 || sourceIndex < 0) return;
    const target = players[targetIndex];
    const card = pendingAction.card;
    const actionResolvedPlayers = players.map((player, index) =>
      index === sourceIndex
        ? { ...player, hand: player.hand.filter((held) => held.id !== card.id) }
        : player,
    );
    setDiscard((current) => [...current, card]);
    setPendingAction(null);
    if (card.action === "freeze") {
      const updated = actionResolvedPlayers.map((player, index) =>
        index === targetIndex ? { ...player, status: "stayed" as const } : player,
      );
      setNotice(`${target.name} was frozen and banks ${scoreHand(target)} points.`);
      if (forcedDraw?.playerId === targetId) setForcedDraw(null);
      if (forcedDraw?.playerId === pendingAction.sourceId) {
        continueAfterDraw(
          updated,
          sourceIndex,
          `${target.name} was frozen and is safe for the round.`,
          updated[sourceIndex].status !== "playing",
        );
      } else {
        handOff(updated, sourceIndex, `${target.name} was frozen and is safe for the round.`);
      }
      return;
    }
    setForcedDraw({ playerId: targetId, remaining: 3, resumeFromId: pendingAction.sourceId });
    setActiveIndex(targetIndex);
    setPlayers(actionResolvedPlayers);
    setNotice(`${target.name} must flip three cards.`);
  }

  function nextRound() {
    const hasWinner = players.some((player) => player.total >= targetScore);
    if (hasWinner) {
      playSound("gameWin");
      setRoundSummary(null);
      setScreen("gameOver");
      return;
    }
    const starter = round % players.length;
    const renewed = players.map((player) => ({
      ...player,
      hand: [],
      status: "playing" as const,
      flip7: false,
    }));
    const completedRoundCards = players.flatMap((player) => player.hand);
    const availableDiscard = [...discard, ...completedRoundCards];
    if (deck.length === 0) {
      setDeck(shuffle(availableDiscard));
      setDiscard([]);
    } else {
      setDiscard(availableDiscard);
    }
    setPlayers(renewed);
    setRound((value) => value + 1);
    setActiveIndex(starter);
    setLastCard(null);
    setRoundSummary(null);
    setForcedDraw(null);
    setPendingAction(null);
    setBustCards({});
    setNotice(`${renewed[starter].name}, draw your first card.`);
  }

  if (screen === "setup") {
    return (
      <main className="setup-shell">
        <section className="setup-copy">
          <p className="eyebrow">ONE DEVICE · 2–8 PLAYERS</p>
          <h1>
            FLIP <span>SEVEN</span>
          </h1>
          <p className="intro">
            Press your luck. Dodge duplicates. Be the first to reach 200.
          </p>
          <div className="mini-cards" aria-hidden="true">
            <div className="mini-card one">7</div>
            <div className="mini-card two">+</div>
            <div className="mini-card three">×2</div>
          </div>
          <button className="text-button" onClick={() => setShowRules(true)}>
            How to play <span>↗</span>
          </button>
        </section>

        <section className="setup-panel" aria-labelledby="players-title">
          <div className="panel-heading">
            <div>
              <p className="step">SET THE TABLE</p>
              <h2 id="players-title">Who’s playing?</h2>
            </div>
            <span className="player-count">{names.length}/8</span>
          </div>
          <div className="player-inputs">
            {names.map((name, index) => (
              <label className="player-input" key={index}>
                <span className={`avatar ${colors[index]}`}>{index + 1}</span>
                <input
                  aria-label={`Player ${index + 1} name`}
                  value={name}
                  onChange={(event) => updateName(index, event.target.value)}
                  placeholder={`Player ${index + 1}`}
                  autoComplete="off"
                />
                {names.length > 2 && (
                  <button aria-label={`Remove player ${index + 1}`} onClick={() => removePlayer(index)}>
                    ×
                  </button>
                )}
              </label>
            ))}
          </div>
          {names.length < 8 && (
            <button className="add-player" onClick={addPlayer}>
              <span>+</span> Add another player
            </button>
          )}
          <fieldset className="goal-selector">
            <legend>PLAY TO</legend>
            <div>
              {SCORE_OPTIONS.map((score) => (
                <button
                  key={score}
                  type="button"
                  className={targetScore === score ? "selected" : ""}
                  onClick={() => setTargetScore(score)}
                  aria-pressed={targetScore === score}
                >
                  {score}
                </button>
              ))}
            </div>
          </fieldset>
          <button className="start-game" onClick={startGame}>
            Start game <span>→</span>
          </button>
          <p className="device-note">Everyone’s cards stay visible on the shared table.</p>
        </section>
        {showRules && <RulesModal onClose={() => setShowRules(false)} />}
      </main>
    );
  }

  if (screen === "gameOver") {
    return (
      <main className="game-over-shell">
        <div className="winner-card">
          <p className="eyebrow">GAME OVER</p>
          <div className="trophy" aria-hidden="true">★</div>
          <h1>{leaders.map((player) => player.name).join(" & ")} {leaders.length > 1 ? "win" : "wins"}!</h1>
          <p className="winner-score">{leaders[0]?.total} points</p>
          <div className="final-scores">
            {[...players].sort((a, b) => b.total - a.total).map((player, index) => (
              <div key={player.id}>
                <span>{index + 1}</span>
                <strong>{player.name}</strong>
                <b>{player.total}</b>
              </div>
            ))}
          </div>
          <button className="start-game" onClick={resetToSetup}>Play again <span>↻</span></button>
        </div>
      </main>
    );
  }

  return (
    <main className="game-shell">
      <header className="game-header">
        <button className="wordmark" onClick={resetToSetup} aria-label="Return to player setup">
          FLIP <span>SEVEN</span>
        </button>
        <div className="round-chip">ROUND <strong>{round}</strong><span> / {targetScore} PTS</span></div>
        <div className="header-actions">
          <button
            className={soundOn ? "sound-on" : ""}
            onClick={() => setSoundOn((value) => !value)}
            aria-label={soundOn ? "Mute game sounds" : "Turn on game sounds"}
            title={soundOn ? "Sound on" : "Sound off"}
          >{soundOn ? "♫" : "×"}</button>
          <button onClick={() => setShowRules(true)}>?</button>
          <button onClick={resetToSetup} aria-label="Start a new game">↻</button>
        </div>
      </header>

      <section className="score-rail" aria-label="Scoreboard">
        {players.map((player, index) => (
          <div className={`score-player ${index === activeIndex && player.status === "playing" ? "active" : ""}`} key={player.id}>
            <span className={`avatar ${colors[index]}`}>{player.name.charAt(0).toUpperCase()}</span>
            <div><strong>{player.name}</strong><small>{player.status === "playing" ? "IN ROUND" : player.status.toUpperCase()}</small></div>
            <b>{player.total}</b>
          </div>
        ))}
      </section>

      <section className="table-area">
        <div className="turn-copy">
          <p className="eyebrow">CURRENT TURN</p>
          <h1>{activePlayer?.name}</h1>
          <p>{notice}</p>
        </div>

        <div className="draw-stage">
          <div className="deck-stack" aria-label={`${deck.length} cards left`}>
            <div className="deck-card back"><span>F<span>7</span></span></div>
            <small>{deck.length} LEFT</small>
          </div>

          <div className="active-card-zone">
            <p>LAST FLIP</p>
            {lastCard ? (
              <PlayingCard card={lastCard} large highlighted={Object.values(bustCards).includes(lastCard.id)} />
            ) : (
              <div className="empty-card"><span>?</span><small>READY</small></div>
            )}
          </div>

          <div className="round-meter">
            <p>ROUND VALUE</p>
            <strong>{activeScore}</strong>
            <div className="seven-track" aria-label={`${activeNumbers} of 7 unique number cards`}>
              {Array.from({ length: 7 }, (_, index) => <i className={index < activeNumbers ? "filled" : ""} key={index} />)}
            </div>
            <small>{activeNumbers}/7 TO FLIP 7</small>
          </div>
        </div>

        <div className="hand-section">
          <div className="hand-heading"><span>CARDS ON THE TABLE</span><small>OPEN HANDS</small></div>
          <div className="table-hands">
            {players.map((player, index) => (
              <section
                className={`player-hand-panel ${index === activeIndex && player.status === "playing" ? "active" : ""} ${player.status}`}
                key={player.id}
                aria-label={`${player.name}'s cards`}
              >
                <div className="player-hand-heading">
                  <span className={`avatar ${colors[index]}`}>{player.name.charAt(0).toUpperCase()}</span>
                  <div>
                    <strong>{player.name}</strong>
                    <small>{player.status === "playing" ? `${scoreHand(player)} round points` : player.status}</small>
                  </div>
                  <b>{player.hand.filter((card) => card.kind === "number").length}/7</b>
                </div>
                <div className="player-card-line">
                  {player.hand.length
                    ? player.hand.map((card) => <PlayingCard card={card} key={card.id} highlighted={bustCards[player.id] === card.id} />)
                    : <p className="empty-hand">No cards yet</p>}
                </div>
              </section>
            ))}
          </div>
        </div>

        <div className="decision-bar">
          <div><span className="pulse" /> {forcedDraw ? `${forcedDraw.remaining} forced flip${forcedDraw.remaining === 1 ? "" : "s"} left` : "Your decision"}</div>
          <button className="stay-button" onClick={stay} disabled={!activePlayer?.hand.length || Boolean(forcedDraw)}>Stay <small>Bank {activeScore}</small></button>
          <button className="hit-button" onClick={drawCard}>{forcedDraw ? "Flip next" : "Flip a card"} <span>↗</span></button>
        </div>
      </section>

      {pendingAction && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="action-title">
          <div className="action-modal">
            <PlayingCard card={pendingAction.card} large />
            <p className="eyebrow">ACTION CARD</p>
            <h2 id="action-title">Choose a player to {pendingAction.card.action === "freeze" ? "freeze" : "flip three"}</h2>
            <p>{pendingAction.card.action === "freeze" ? "They bank their current round points immediately." : "They must take the next three cards, one at a time."}</p>
            <div className="target-list">
              {players.filter((player) => player.status === "playing").map((player) => (
                <button key={player.id} onClick={() => targetAction(player.id)}>
                  <span>{player.name.charAt(0).toUpperCase()}</span><strong>{player.name}</strong><b>{scoreHand(player)} pts</b>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {roundSummary && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="round-title">
          <div className="round-modal">
            <div className="round-celebration" aria-hidden="true">✦ ★ ✦</div>
            <p className="eyebrow">ROUND {round} COMPLETE</p>
            <h2 id="round-title">
              {roundWinners.length
                ? `${roundWinners.map((player) => player.name).join(" & ")} ${roundWinners.length > 1 ? "win" : "wins"} the round!`
                : "No points this round"}
            </h2>
            <p>{notice}</p>
            <div className="round-results">
              {[...roundSummary].sort((a, b) => scoreHand(b) - scoreHand(a)).map((player, index) => (
                <div key={player.id} className={`${index === 0 && scoreHand(player) > 0 ? "round-leader" : ""} ${player.status === "busted" ? "busted-result" : ""}`}>
                  <div className="round-result-main">
                    <span className={`avatar ${colors[players.findIndex((item) => item.id === player.id)]}`}>{player.name.charAt(0)}</span>
                    <strong>{player.name}</strong>
                    <small>{player.status === "busted" ? "BUST — 0 POINTS" : player.flip7 ? "FLIP 7! +15" : "BANKED"}</small>
                    <b>+{scoreHand(player)}</b>
                    <em>{player.total} total</em>
                  </div>
                  <div className="summary-hand player-card-line" aria-label={`${player.name}'s final round hand`}>
                    {player.hand.map((card) => (
                      <PlayingCard card={card} key={card.id} highlighted={bustCards[player.id] === card.id} />
                    ))}
                  </div>
                  {player.status === "busted" && <span className="bust-stamp">BUSTED!</span>}
                </div>
              ))}
            </div>
            <button className="start-game" onClick={nextRound}>{players.some((player) => player.total >= targetScore) ? "See winner" : "Next round"}<span>→</span></button>
          </div>
        </div>
      )}

      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
    </main>
  );
}

function PlayingCard({ card, large = false, highlighted = false }: { card: Card; large?: boolean; highlighted?: boolean }) {
  return (
    <div className={`playing-card ${cardClass(card)} ${large ? "large" : ""} ${highlighted ? "bust-cause" : ""}`}>
      <span className="corner top">{cardLabel(card)}</span>
      <strong>{cardLabel(card)}</strong>
      {card.kind === "action" && <small>{card.action === "flip3" ? "DRAW 3" : card.action === "freeze" ? "BANK NOW" : "SAVE A BUST"}</small>}
      {card.kind === "modifier" && <small>BONUS</small>}
      {card.kind === "double" && <small>NUMBER TOTAL</small>}
      <span className="corner bottom">{cardLabel(card)}</span>
      {highlighted && <span className="bust-label">DUPLICATE</span>}
    </div>
  );
}

function RulesModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="rules-title">
      <div className="rules-modal">
        <div className="rules-head"><div><p className="eyebrow">QUICK RULES</p><h2 id="rules-title">How to play</h2></div><button onClick={onClose} aria-label="Close rules">×</button></div>
        <div className="rules-grid">
          <article><span>01</span><h3>Flip or stay</h3><p>On your turn, take a card or stay and bank your round value. Everyone plays from the same 94-card deck.</p></article>
          <article><span>02</span><h3>Avoid a pair</h3><p>Flip the same number twice and you bust, scoring zero for the round—unless a Second Chance saves you.</p></article>
          <article><span>03</span><h3>Flip seven</h3><p>Collect seven different number cards to end the round immediately and add a 15-point bonus.</p></article>
          <article><span>04</span><h3>Reach the target</h3><p>Choose 50, 100, 150, or 200 before the game. ×2 doubles number cards, then + modifiers and the Flip 7 bonus are added.</p></article>
        </div>
        <div className="special-rules">
          <h3>Special cards</h3>
          <div><b>FREEZE</b><p>Choose an active player. They immediately stay and bank.</p></div>
          <div><b>FLIP THREE</b><p>Choose an active player. They must take the next three cards.</p></div>
          <div><b>SECOND CHANCE</b><p>Automatically discards one duplicate number instead of busting.</p></div>
          <div><b>+ / ×2</b><p>Add bonuses; ×2 doubles only the number-card total.</p></div>
        </div>
        <button className="start-game" onClick={onClose}>Got it <span>✓</span></button>
      </div>
    </div>
  );
}
