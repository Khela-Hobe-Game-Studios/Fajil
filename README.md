# FAJIL — ফাজিল

**A bluffing trivia party game about Bangladesh and its diaspora.**

Everyone sees the same fill-in-the-blank question and secretly writes a **lie**. All
the lies are shuffled in with the real answer, and the room votes on which one is
true.

- **+1000** for finding the truth
- **+500** for every player your lie fools
- Final round pays double

The shared screen runs on a TV or a laptop. Players join on their phones with a
four-letter room code. 2–8 players.

> *ফাজিল* — cheeky, mischievous, a bit of a troublemaker. In this game, you are the fajil.

---

## Play locally

```bash
npm run install:all
npm run dev
```

Open `http://localhost:5273` on the shared screen. Phones on the same wifi open the
same port on your machine's LAN IP, or scan the QR the lobby shows.

```bash
npm run verify     # lint, build, socket tests, browser tests
npm run dev:stop
```

## How it is put together

Node + Socket.io on the server, React + Vite on the client, and one rule that
everything else follows: **the correct answer never leaves the server before the
reveal.** The server owns all state, all timers and all scoring; the clients are
terminals.

See [CLAUDE.md](CLAUDE.md) for the architecture and [AGENTS.md](AGENTS.md) for how to
work on it. [docs/original-brief.md](docs/original-brief.md) is the original design
brief, kept as the design record.

## Deploying

- **Client** → GitHub Pages via `.github/workflows/deploy.yml`. Set a repository
  secret `VITE_SERVER_URL` to the deployed backend, or the build refuses to ship.
- **Server** → Render (`render.yaml`). It is stateful, so it must be a persistent
  process — serverless will not work. Free tier sleeps when idle; the first
  connection of the evening takes about 30 seconds.

## Adding questions

`questions/questions.json`, or set `QUESTIONS_SHEET_URL` on the server to a Google
Sheet published as CSV. Either way it must pass:

```bash
npm run questions:lint
```

The bank ships with 74 questions across three tiers — `desh` (Bangladesh), `probash`
(the diaspora) and `shared`. A shippable game wants a few hundred; this is a seed.

---

Made by Khela Hobe Game Studios.
