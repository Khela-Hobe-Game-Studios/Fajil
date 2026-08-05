# BHUA — Project Brief

**Studio:** Khela Hobe Game Studios
**Game:** BHUA (ভুয়া, "fake") — a bluffing trivia party game about Bangladesh
**Audience:** Bangladeshi diaspora and anyone with Bangladeshi cultural knowledge
**Status:** Working single-device prototype exists (`bhua.html`). This document specifies the multiplayer build.

---

## 1. The game

Fibbage mechanics. Each round:

1. Everyone sees the same fill-in-the-blank prompt: *"Bangladesh's national fruit is the ___."*
2. Each player secretly writes a **lie** — a plausible wrong answer.
3. All lies plus the real answer are shuffled and shown to everyone.
4. Each player picks the one they think is true. You can't pick your own lie.
5. **Scoring:** +1000 for finding the truth, +500 for every player your lie fooled.
6. Reveal shows who wrote what, then a short "why it matters" blurb explaining the real answer.

The design insight worth protecting: the diaspora's *uneven* cultural knowledge is the engine, not an obstacle. Someone raised in Dhaka and someone raised in Michigan fool each other in opposite directions. Everything below should preserve that.

---

## 2. Architecture

**Node + WebSockets. One authoritative server. Phones are dumb terminals.**

```
┌─────────────┐         ┌──────────────┐         ┌─────────────┐
│  Big screen │◄───ws──►│    Server    │◄──ws───►│   Phones    │
│  (room host)│         │ (game state) │         │(controllers)│
└─────────────┘         └──────────────┘         └─────────────┘
```

- **Big screen** — laptop/TV in the room. Joins a room as `role: "screen"`. Shows prompt, options, reveal, scoreboard. Renders the rickshaw-panel design.
- **Phones** — join by room code at a short URL. Show only what that player needs to do right now: a text box, or a list of options to tap.
- **Server** — holds all state. Runs all timers. Decides all transitions.

Do **not** use WebRTC or peer-to-peer. Do **not** put game logic in the client.

### The single most important rule

**The correct answer never leaves the server until the reveal phase.** Not in the initial round payload, not flagged in the options array, not as an index. If the truth ships to clients early, someone reads it out of the WebSocket frames in devtools on round one and the game is dead. Options go to clients as `[{id, text}]` with no truth marker; the server knows which id is true.

Same applies to lie authorship — clients get authorship only at reveal.

### Suggested stack

- `ws` or Socket.IO for transport (Socket.IO buys you reconnection handling; worth it here)
- Plain TypeScript on the server, no framework needed
- Vite + vanilla TS or React for both clients
- In-memory room store, `Map<roomCode, Room>`. No database for v1. Rooms expire 30 min after last activity.
- Deploy: Fly.io or Railway. Needs sticky sessions if you scale past one instance — for v1, don't.

---

## 3. State machine

Server-owned. Every transition is server-driven, either by timer expiry or by all players having acted.

```
LOBBY ──start──► PROMPT ──(3s)──► COLLECTING ──all in / timeout──► VOTING
                                                                      │
                        ┌─────────────────────────────────────────────┘
                        ▼
                    REVEAL ──(host advances)──► SCOREBOARD
                                                    │
                          ┌─────────────────────────┤
                          ▼                         ▼
                    (rounds left)              (last round)
                        PROMPT                    FINAL
```

**Timers matter.** The pass-and-play prototype has none and doesn't need them. The phone version does, or one distracted player stalls the room.

| Phase | Duration | On expiry |
|---|---|---|
| `PROMPT` | 3s | auto-advance |
| `COLLECTING` | 60s | non-submitters get an auto-lie from a filler pool |
| `VOTING` | 20s | non-voters score nothing that round |
| `REVEAL` | manual | screen advances one option at a time |
| `SCOREBOARD` | manual | host taps continue |

Auto-lie filler pool: a small set of generic plausible-sounding answers per question, marked so the reveal can say "the house wrote this" rather than blaming an AFK player.

---

## 4. Message protocol

Client → server:

```ts
{ t: "join",       code: "MITH", name: "Rumi", role: "player" | "screen" }
{ t: "rejoin",     token: "..." }
{ t: "start",      rounds: 3 | 5 | 7, deck: "mixed" | "desh" | "probash" }
{ t: "lie",        text: "Mango" }
{ t: "vote",       optionId: "o3" }
{ t: "advance" }              // screen/host only
```

Server → client:

```ts
{ t: "joined",     token, playerId, room: {...} }
{ t: "roster",     players: [{id, name, score, connected}] }
{ t: "phase",      phase, round, of, endsAt }   // endsAt = server epoch ms
{ t: "prompt",     text: "Bangladesh's national fruit is the ___." }
{ t: "options",    options: [{id, text}] }      // NO truth flag
{ t: "waiting",    stillOut: ["Ayesha", "Tanvir"] }
{ t: "reveal",     step, option: {id, text, truth, authors, voters, points} }
{ t: "scores",     players: [{id, name, score, gained}] }
{ t: "final",      standings: [...] }
{ t: "error",      code, message }
```

Clients render `endsAt` against their own clock with a drift correction on join. Don't send countdown ticks over the socket.

---

## 5. Data model

```ts
type Room = {
  code: string;              // 4 letters, ambiguity-free alphabet
  hostId: string;
  phase: Phase;
  round: number;
  totalRounds: number;
  deck: DeckFilter;
  questions: Question[];     // pre-drawn at start, no repeats
  players: Map<string, Player>;
  screens: Set<WebSocket>;
  current: RoundState | null;
  lastActivity: number;
};

type Player = {
  id: string;
  token: string;             // for reconnect
  name: string;
  score: number;
  connected: boolean;
  socket: WebSocket | null;
};

type RoundState = {
  question: Question;
  lies: Map<playerId, string>;
  options: Option[];         // built after collection closes
  votes: Map<playerId, optionId>;
  revealStep: number;
  gains: Map<playerId, number>;
};

type Option = {
  id: string;
  text: string;
  truth: boolean;
  authors: string[];         // [] for house decoy and for truth
};
```

**Room code alphabet:** exclude I, O, 0, 1, L. Use `ABCDEFGHJKMNPQRSTUVWXYZ`. People read these aloud across a room.

---

## 6. Question bank

Ships as JSON, not hardcoded. Schema:

```jsonc
{
  "id": "bd-natl-fruit",
  "q": "Bangladesh's national fruit is the ___.",
  "a": "jackfruit",
  "alt": ["kathal", "jackfruit (kathal)"],   // accepted as truth-collisions
  "show": "Jackfruit (kathal)",              // display form at reveal
  "decoy": "Mango",                          // house lie, used when <5 players
  "why": "Mango gets the poetry, but kathal gets the title...",
  "tier": "desh",                            // desh | probash | shared
  "region": "national",                      // national | sylhet | dhaka | chittagong | ...
  "era": "modern"                            // modern | 1971 | colonial | precolonial
}
```

The `tier` field is the important one. 26 questions exist in `bhua.html` and they skew hard toward `desh` — someone raised in Dhaka will sweep. You need a second bank of `probash` (diaspora) questions so the advantage flips round to round: Brick Lane and the Sylheti chain migration, Devon Avenue and Jackson Heights, the UK curry-house economy, Bangla school on Sundays, ABCD-vs-FOB vocabulary, what happens at a Bangladeshi wedding in New Jersey.

Deck filters: `mixed` alternates tiers round to round. `desh` and `probash` are single-tier decks.

**Content policy, encoded in the bank:** the Liberation War, the 2024 protests, Rohingya, and party politics are fine as *trivia* and must never appear as *joke fodder*. Since players write the lies, a war prompt invites a tasteless lie. Keep `era: "1971"` questions factual and few, and consider excluding them from the deck entirely on first release until you've watched real tables play.

Also needed: Sylheti, Chittagonian, Barishali, Indigenous/Chakma, and Bengali Hindu content, so the bank isn't just Dhaka middle class talking to itself.

---

## 7. Design system

Lift these from `bhua.html` verbatim — palette, type, and the panel component all transfer to the phone controller.

```css
--midnight:  #0E1A2B;   /* base */
--panel:     #15263D;   /* card */
--vermilion: #E63329;   /* primary action */
--chrome:    #F5C518;   /* keyline, numerals, emphasis */
--rose:      #E8377D;   /* focus, accents */
--jade:      #0E8F6E;   /* truth, positive */
--cream:     #F6E9CE;   /* text */
```

Display face **Baloo Da 2**, body face **Hind Siliguri**. Both cover Bengali and Latin — non-negotiable, since prompts will eventually carry Bangla script alongside transliteration.

**Direction:** rickshaw art, not the flag. Hand-painted tin panels — scalloped chrome edge along the top, thick keyline border, corner rosettes, saturated signage color. The prototype's `.panel` component with its `::before` scallop strip is the signature; carry it to both screens.

**Screen vs phone:** the big screen is where the design lives — large type, the panel frame, the reveal animation. Phones stay deliberately plain: a name, a prompt, one input, one button. Phone UI competing with the screen splits attention in the room.

Every prompt eventually needs Bangla script + transliteration + English gloss. Build the schema for it now (`q_bn`, `q_translit`) even if you populate it later.

---

## 8. Build order

Do these in sequence. Do not skip ahead — step 1 is the genuinely hard part and everything else assumes it works.

1. **Lobby only.** Room creation, four-letter code, phones join by code, names appear live on the big screen, players can leave and rejoin. No game logic at all. Get four real phones in a room showing four names before writing anything else.
2. **Reconnect.** Lock a phone, unlock it, confirm the player is still in the room with their score. Phones sleep constantly during play; if this is broken the game is unplayable and you'll wrongly blame it on game logic later.
3. **One full round, no timers.** Prompt → collect lies → build options → vote → reveal → score. Advance manually.
4. **Timers and auto-advance.** Server-authoritative, `endsAt` timestamps, filler lies for AFK players.
5. **Full game loop.** Multiple rounds, no question repeats, final standings.
6. **The reveal sequence.** This is where the fun actually lives — one option at a time, authors named, laughter beat between each. Give it real design attention.
7. **Deck filters and the probash bank.**

---

## 9. Known pitfalls

- **Truth leakage.** Covered above. Audit every payload leaving the server during `VOTING`.
- **Duplicate lies.** Two players write "Mango." Merge into one option; both authors score when someone falls for it. Normalize by lowercasing and stripping non-alphanumerics, but preserve Bengali codepoints (`\u0980-\u09FF`) — the prototype's `norm()` does this.
- **Truth collisions.** A player writes the actual answer. Reject at submission with "That's the real answer — now write a lie." Check against `a` and every entry in `alt`. This lands as a delightful moment, not an error.
- **Duplicate player names.** Two Rumis in one room breaks the reveal copy. Reject on join, or auto-suffix.
- **Phone keyboards.** The lie input is the whole game on mobile. Test the keyboard covering the submit button on a small iPhone before you ship anything else.
- **Screen-only rooms.** Someone will open the screen URL on their phone. Handle it or block it.
- **Empty rooms.** Host disconnects mid-game. Promote the next player or hold the room open for a reconnect window.

---

## 10. Open decisions

- **Studio name.** *Khela Hobe* carries specific party associations in both Bangladesh and West Bengal. Many people hear only sporting bravado; a real share of the audience won't. Worth deciding on purpose rather than by default, before it's on a storefront.
- **Question sourcing.** The 26 in the prototype are a seed, not a bank. A shippable game wants 200+. Consider community submission with editorial review — it doubles as your pre-launch audience.
- **Answer-audience mismatch.** Watch a real table play before tuning the scoring. If desh-raised players sweep every game, the fix is deck balance first, then possibly team play, and only then scoring changes.
