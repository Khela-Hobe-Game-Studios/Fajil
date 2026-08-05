# FAJIL (ফাজিল) — architecture

> **New here? Read [AGENTS.md](AGENTS.md) first** — commands, the verify gate, and
> the traps that are expensive to rediscover. This file is the architecture reference.
> [docs/original-brief.md](docs/original-brief.md) is the original design brief, kept
> as the design record; where it and this file disagree, this file is what was built.

A bluffing trivia party game about Bangladesh and its diaspora. Everyone sees one
fill-in-the-blank question and secretly writes a **lie**. The lies are shuffled in
with the real answer and the room votes. **+1000** for finding the truth, **+500**
for every player your lie fools. The shared screen runs on a TV or laptop; players
join on their phones with a four-letter room code.

The design premise worth protecting: the diaspora's *uneven* cultural knowledge is
the engine, not an obstacle. Someone raised in Dhaka and someone raised in Michigan
fool each other in opposite directions. The `mixed` deck alternates `desh` and
`probash` tiers round by round specifically to keep that true.

---

## Architecture

```
client/     React 19 + Vite     → GitHub Pages
server/     Node + Express + Socket.io → Render (free tier)
questions/  questions.json + lint.js, or a published Google Sheet CSV
```

The backend is **stateful** — rooms are an in-memory `Map`. Serverless will not work.
One instance only; scaling past one needs sticky sessions *and* a shared room store.

---

## The rule the whole game rests on

**The correct answer must not leave the server before the reveal.**

If it ships early, one player reads it out of a WebSocket frame on round one and the
game is over. Three specific defences, all in `server/src/lies.js`:

1. `toClientOptions()` is the **only** shape allowed out during `VOTING`, and it
   *builds a fresh `{id, text}`* rather than deleting secrets from the internal
   object. A delete-pass is the version that leaks the day somebody adds a field.
2. **Option ids are assigned after the shuffle**, so the id sequence carries no
   signal. Assigning before would make "the truth is always o1" true.
3. **Authorship is withheld on the same reasoning** — knowing who wrote what is
   knowing what is not true. Authors and voters appear for the first time in
   `round:reveal`.

`test-reliability.js` records every frame each client is ever sent and re-reads the
transcript the way a player with devtools would. Note that the answer's *text* is
necessarily present during voting — it is one of the options — so the assertion is
that nothing identifies **which** one.

---

## Game state machine

```
LOBBY
  └─ PROMPT (3s) → COLLECTING (45/60/90s) → VOTING (25s) → REVEAL (scheduled) → SCOREBOARD (6s)
       ↑                                                                              │
       └──────────────────────── advanceRound() ──────────────────────────────────────┘
                                        │ (rounds exhausted)
                                    GAME_OVER
```

`advanceRound()` in `gameManager.js` is **the one place** a round ends and the next
begins — the scoreboard timer, the host's skip and the resume-after-pause path all
funnel through it. Three copies is how a new phase ends up missing from one of them.

Timers are `setTimeout`s on `room._timers`, cleared when a phase is cut short.
`COLLECTING` and `VOTING` also end early the moment everyone connected has acted.

---

## Scoring

| | |
|---|---|
| Vote for the truth | **+1000** |
| Each player your lie fools | **+500** (every author of a merged lie is paid in full) |
| Final round | **×2** |
| Typing the real answer into the lie box | **0 points**, a private notice, a badge |

The truth-collision reward is deliberately zero. Paying for it would make typing the
real answer the dominant strategy for anyone who knows it, which empties the lie pool
— the one thing the game cannot survive. It is worth a **Knew it ×N** badge on the
final standings instead.

The final-round doubling is one line and is most of what keeps a table playing to the
end rather than watching a leader coast from round four.

---

## Player cap: 8

Not arbitrary. Reading N lies is O(N) attention, unlike guessing a number — at 15
players the vote screen is 16 options in 25 seconds, which makes voting random and
means half the room never hears its own lie read out. Below 4 players, house decoys
pad the board to a floor of 5 options (`MIN_OPTIONS`).

---

## Message protocol

Client → server: `time:ping`, `host:create_room`, `host:update_settings`,
`host:rejoin`, `host:start_game`, `host:skip`, `host:end_game`, `host:play_again`,
`player:join`, `player:rejoin`, `player:submit_lie`, `player:submit_vote`.

Server → client: `room:created`, `player:joined`, `room:updated`, `room:settings`,
`room:reset`, `round:prompt`, `round:collecting`, `round:lie_count`, `lie:accepted`,
`lie:knew_it`, `round:options`, `vote:accepted`, `round:vote_count`, `round:reveal`,
`round:scoreboard`, `game:over`, `game:paused`, `game:resumed`, `error`.

**Every phase event carries the server's clock:** `{ phase, serverNow, startedAt,
endsAt, durationMs }`. Clients measure their offset once per connect (`time:ping`)
and derive the remainder from `endsAt`. Nobody counts down from a number they were
handed once. See `client/src/game/clock.js`.

**`round:options` is per-recipient**, not a broadcast — each player must learn which
option is their own (so they cannot vote for it) without learning anyone else's. See
`emitPerPlayer()`.

---

## Reconnection

This is load-bearing. Phones sleep, tabs get backgrounded, wifi drops.

- **Identity is a durable client-generated `pid`** in `localStorage`, never the
  socket id. Socket ids change on every reconnect; keying game state off them silently
  resets a returning player's score to zero.
- **Host control is a separate minted `hostToken`**, sent only to the socket that
  created the room and required back on `host:rejoin`. Room codes are 48 dictionary
  words, so granting host control on the code alone means anyone who guesses one
  seizes the game — and demotes the real host.
- **The client re-announces on every `connect`, not the first.** `socket.once` looks
  correct and silently kills every player who reconnects.
- **`socket.js` also reconnects on `visibilitychange` / `online` / `pageshow`**, because
  iOS does not always fire a clean disconnect when a suspended tab resumes.
- **Seat holds:** 20s in the lobby, **120s mid-game**, 30s for the host. A mid-game
  drop is **never removed from the roster** — after the hold it is marked `dropped`
  but keeps its row and score, so a phone that dies in round 3 is still on the final
  standings.
- **`syncPlayerState()` replays the live phase with real elapsed time**, including the
  reveal, which would otherwise restart its whole choreography for a phone that
  rejoined eight seconds in.
- **The host dropping pauses the room** rather than running the clock down — the
  prompt and the options live on the shared screen, so without it the room is blind.

---

## UI

`client/src/press/` is the design system. Plain React, plain CSS, no component
library. Do not introduce Tailwind, CSS modules, styled-components or MUI.

**The premise is a tabloid front page.** Each player's lie is a competing headline;
the truth is printed afterwards as a correction. Two colours of ink on paper, as a
cheap press would run: **red** for the masthead and the correction stamp, **blue**
for attribution. Everything else is black ink at four strengths.

**Fluid, not scaled.** A newspaper reflows — that is why this metaphor was chosen
over a fixed board. Every size is a `clamp()` token in `tokens.css` and the ballot is
an `auto-fit` grid, so eight options are four columns on a television and one column
in a hand with no breakpoint. There are three media queries in the whole client and
all are about column count. Consequence: the host page opened on a phone is usable
rather than blocked, and no rotate-guard is needed.

**The page is a strict viewport box** (`height: 100dvh; overflow: hidden`). Neither
side may scroll the page. Regions that can genuinely outgrow their space carry
`.pr-scroll`. Because that turns overflow into silent clipping, `test-browser.js`
asserts both no-scroll *and* nothing-clipped.

**Night edition.** `data-edition="night"` (and `prefers-color-scheme`) swaps paper to
charcoal. A white page on a television in a dark room is the most common way this
gets played and is genuinely unpleasant.

**Typography:** Anton for headlines, Oswald for labels and every numeral, Lora for
the article voice, Hind Siliguri for Bengali. The bank already carries Bangla script
in its `show` fields, so the Bengali subset is not optional.

| File | What it is |
|---|---|
| `press/tokens.css` | Colour, type scale, spacing, night edition, the 8 player inks |
| `press/press.css` | Primitives, the reset, halftone, keyframes |
| `press/Page.jsx` | Page, Masthead, Nameplate, Kicker, Rule, Prompt |
| `press/Bits.jsx` | Btn, Stamp, Chip, Num, Score, Clock, Meter |
| `press/Ballot.jsx` | The options list — one component for both roles |

---

## Question bank

`questions/questions.json`, linted by `questions/lint.js`. 74 questions:
36 `desh`, 28 `probash`, 10 `shared`.

```jsonc
{
  "id": "bd-natl-fruit",
  "q": "Bangladesh's national fruit is the ___.",   // must contain ___
  "a": "jackfruit",
  "show": "Jackfruit (কাঁঠাল)",                     // display form at reveal
  "alt": ["kathal"],                                // also counts as truth-collision
  "decoys": ["Mango", "Lychee", "Guava"],           // ≥3, pad a thin room
  "filler": ["Mango", "Papaya"],                    // ≥2, for AFK players
  "why": "…",                                       // the payoff of the round
  "tier": "desh",                                   // desh | probash | shared
  "region": "national",
  "era": "modern"
}
```

**Content policy is enforced by the linter, not merely documented.** `era: "1971"`
and party-political / atrocity keywords are refused. Players author the lies here — a
war prompt manufactures something tasteless which then appears on a shared screen
with a name attached, and there is no way to moderate it live. These remain
legitimate trivia subjects; they are not safe as bluffing fodder.

The linter also fails a decoy or filler that **collides with the real answer**, which
would put two correct options on the board, and warns when the desh:probash ratio
passes 2.5:1, at which point the mixed deck can no longer alternate.

---

## Key files

```
server/src/
  index.js          Socket handlers, validation, rate limits, seat holds
  gameManager.js    State machine, timers, scoring, reveal schedule
  roomManager.js    Rooms Map, codes, players, settings, reaping
  lies.js           Normalisation, dedupe, option building, truth secrecy
  sanitize.js       The one sanitizePlayers()
  questionsLoader.js  Sheet CSV or JSON fallback

client/src/
  App.jsx           The router: host branch, player branch, device guess
  socket.js         Socket.io singleton + wake-on-visibility
  session.js        Durable pid, session persistence, ?join= deep link
  game/
    useGameSocket.js  One reducer owning every socket event
    clock.js          Server-time offset, phase remaining
    revealBeats.js    Plays the server's beat schedule
  press/            The design system
  views/host/       Landing, Lobby, Round, Reveal, Standings
  views/player/     Join, Lobby, Round, Result

scripts/dev.js      Detached dev servers, stale-listener detection
scripts/verify.js   The gate
test-reliability.js Sockets: truth secrecy, reconnect, scoring, full game
test-browser.js     Real browser: shared screen + 3 phones, layout assertions
```

---

## Known limitations

- **No profanity filter.** Player-authored text appears on a shared screen. Bounded
  to 60 characters and stripped of control characters, nothing more. Fine for a
  living room, not for strangers.
- All state is in memory — a server restart drops every live room, and Render's free
  tier spins down when idle (~30s cold start, surfaced as "Waking the press…").
- No accounts, no history, no persistence between games.
- Questions load once at startup unless `QUESTIONS_SHEET_URL` is set.
- No audio. The reveal is silent, which costs it something.
- 8 players max by design; 2 minimum to start.
