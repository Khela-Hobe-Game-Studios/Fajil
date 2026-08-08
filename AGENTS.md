# Working on FAJIL — agent guide

`CLAUDE.md` describes **what the system is**. This file describes **how to work on
it**: the commands, the checks, and the traps that are expensive to rediscover.

Read this first, then `CLAUDE.md`.

---

## Start here

```bash
npm run install:all    # root, server and client
npm run dev            # both servers, detached, returns when they genuinely answer
npm run dev:status     # what is actually listening, and whether it is ours
npm run verify         # the gate — run before you commit
npm run dev:stop
```

The shared screen is `http://localhost:5273`. Phones on the same wifi use your LAN
IP on the same port — `host: true` is already set in `vite.config.js`.

**Ports are 3101 (server) and 5273 (client)**, deliberately not the 5173/3001
defaults. The studio's other game holds those, and this collision already happened
once while building this.

---

## The verify gate

```bash
npm run verify              # ~75s
npm run verify -- --fast    # skips the browser step
```

Cheapest-first, so the most common failure is also the quickest to find:

| Step | What it protects |
|---|---|
| `questions/lint.js` | The bank meets the quality and content rules |
| `vite build` | No import or syntax errors in any view |
| `test-reliability.js` | Truth secrecy, reconnect, scoring, a full game over real sockets |
| `test-browser.js` | The real UI: shared screen + 3 phones, layout, tap targets, cues |

**A green verify is the bar for committing.** It is not a substitute for looking at
the screen — `test-browser.js` writes every phase to `.screens/` (gitignored) at both
a television width and two phone widths. Look at them when you touch layout.

---

## Rules the tests cannot enforce

**The truth never leaves the server before the reveal.** The single rule this game
lives or dies by. `toClientOptions()` in `server/src/lies.js` is a whitelist that
builds a fresh object — if you find yourself adding a field to the options payload,
stop and ask whether it narrows down which option is true. Authorship counts.

**8 players is the design target, not 3.** Layouts that look fine with three
fixtures fall apart at eight — the reveal is nine cards and the ballot is nine
options. The reveal list scrolls and follows the beat for exactly this reason.

**Everyone must be able to find themselves.** No "+N more players" on a shared
screen, ever.

**Player screens are glanced at, not read.** A phone, one hand, about two seconds of
attention between conversations.

**The reveal is the point.** It is where the fun actually lives. If you are trading
away reveal quality for something else, you are trading the wrong thing.

---

## Traps

**The stale server trap.** Starting a second server on a bound port fails with
`EADDRINUSE` and *exits silently* — the original keeps serving and you debug against
code that is not running. `scripts/dev.js` now refuses to start in that case, and
`npm run dev:status` shows the real listener PIDs and flags when they are not ours.

**Never key game state by socket id.** Socket ids change on every reconnect. Scores,
lies and votes are keyed by the durable client-generated `pid`. Payloads still emit
it as `id`, so client code matching on `id` keeps working.

**Re-announce on every `connect`, not the first.** `socket.once('connect', …)` looks
correct and silently kills every player who reconnects — the new socket is not in the
room, so the player stops receiving the game while appearing fine to themselves.

**socket.io serialises with JSON**, so `Infinity` and `NaN` arrive as `null`. Any
coercion of client input must reject non-values explicitly rather than leaning on
`Number()`.

**`sanitizePlayers()` before any emit of a player array.** The raw objects carry a
Node `Timeout` whose circular internals blow the stack inside socket.io's
`hasBinary()`.

**The page cannot scroll, so overflow becomes clipping.** `.pr-page` is a strict
`100dvh` box. Anything that can outgrow its space needs `.pr-scroll`, and
`test-browser.js` asserts both no-scroll *and* nothing-clipped — the second exists
because the first alone would pass while content vanished off the bottom.

**`steps(N)` defaults to `jump-end`**, which holds the FROM value for the whole
duration — an element animated that way finishes still invisible. Every keyframe in
`press.css` uses `jump-none`.

**A CSS reset must not out-specify its own components.** `press.css` wraps its reset
in `:where()`: a bare `button { background: none }` beats `.pr-btn` and silently
strips every button's fill.

**React StrictMode is on.** Effects run twice in dev; every `socket.on` needs a
matching `socket.off` in cleanup.

**`ctx.state === 'running'` is the wrong gate for playing a cue.** `resume()` is
asynchronous, so for tens of milliseconds after the unlocking click the state still
reads `suspended` and everything fired in that window is dropped without a trace.
`cues.js` gates on `armed` — has a gesture ever happened — which a resuming context
honours. The same applies to a beat that is barely past due: a strict
`at < elapsed` looks right and silently eats the beat the reveal opens on, because
`elapsed` is never 0 by the time the frame has crossed a socket and rendered.

**A limit that lives on `socket.data` is not a limit.** Sockets are free to open, so
anything keyed to one resets by reconnecting. Every abuse ceiling started out this
way and one laptop took all 432 room codes in under a minute — a worldwide outage,
since every host anywhere then gets "No rooms available". Anything gating a caller
who is *not yet in a room* (creating, joining) belongs in `limits.js`, keyed by IP.
Per-socket is still right for in-room actions like submitting a lie, because the
spammer already holds a seat there.

**`TRUST_PROXY` is wrong in both directions by default.** Behind a proxy, unset means
every player in the world shares one rate-limit bucket. With no proxy, set means
`X-Forwarded-For` is client-controlled and every ceiling is opt-out. The startup log
prints which mode is live; read it after a deploy rather than assuming.

**Writing `\uXXXX` escapes into source files is unreliable through some tooling** —
they can arrive as literal control characters and produce a regex that silently
matches the wrong thing. Both regexes in `lies.js` and `roomManager.js` were bitten
by this. If you touch a character-class regex, `node -e` it and check the behaviour,
not the source.

---

## Changing the question bank

```bash
node questions/lint.js                          # the local bank
node questions/lint.js --url "<sheet csv url>"  # a published Google Sheet
```

Rules that matter most:

- A **decoy or filler that collides with the real answer** puts two correct options
  on the board and makes the round's scoring incoherent. The linter fails it.
- `alt` must catch every reasonable spelling of the answer, or a player who types the
  real thing is not caught and the truth appears twice.
- `why` is the payoff — it is the one moment in the round where somebody is being
  told something true. A weak `why` wastes the round.
- **1971, party politics and atrocity content are refused by the linter.** Players
  write the lies; those prompts manufacture something tasteless with a name attached.
- Keep desh:probash under 2.5:1 or the mixed deck cannot alternate tiers.

---

## Definition of done

1. `npm run verify` is green.
2. If you touched layout, you looked at `.screens/` — including a phone width.
3. If you touched the options payload, you can say why it does not narrow down the
   truth.
4. If you touched the bank, it lints.
5. The commit message says what changed **and why**. The history is the design
   record. No Claude/Anthropic attribution, ever.
6. Don't push unless asked.
