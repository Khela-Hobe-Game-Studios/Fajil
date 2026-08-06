# Prompt for generating Fajil questions

## How many, and why

A game is at most 7 rounds, and the deck is redrawn fresh each game with **no memory
across games** — so repeats are random, not exhaustive. Twelve 7-round games is 84
draws, and for it not to *feel* repetitive the pool wants to be several times that. A
single-tier deck (`desh` alone) also has to carry 7 rounds by itself.

**Target ~320: 140 `desh`, 130 `probash`, 50 `shared`.**

**Status: all fifteen batches below have been run.** The bank went from 74 to 554 —
317 `desh`, 178 `probash`, 59 `shared`, comfortably past the target. Five of the
`probash` batches came in under their row's aim (East London 22, UK-beyond-London 25,
USA 30, Canada/Australia/Europe 20, Gulf & Asia 24) because the territory ran out of
facts worth being confident about; the shortfall went to `questions/NEEDS-CHECKING.md`
rather than into filler. The prompt below stays here for topping up a territory later.

## Do it in batches, on separate territories

Do **not** ask one session for 250 questions. Quality falls off, facts get shakier,
and it will repeat itself. Worse, six sessions each asked for "40 probash questions"
will each hand you Brick Lane, Jackson Heights and chicken tikka masala.

So each batch gets **one assigned territory** and a digest of what already exists.

```bash
node questions/digest.js            # paste this into the session
node questions/digest.js probash    # or just one tier
```

### Batch plan

| # | Tier | Territory | Aim |
|---|---|---|---|
| 1 | desh | **Food & drink** — dishes, regional sweets, street food, tea, fish, fruit, cooking method | 45 |
| 2 | desh | **Land & nature** — rivers, districts, forests, islands, wildlife, weather, chars | 40 |
| 3 | desh | **History & heritage before 1947** — Pala/Buddhist, Sultanate, Mughal, British Bengal, muslin, indigo, archaeology | 40 |
| 4 | desh | **Language, literature, music, film** — Bangla itself, poets, Baul, folk forms, jatra, cinema, songs | 35 |
| 5 | desh | **Craft & material culture** — jamdani, kantha, pottery, boats, rickshaw art, brass, bamboo, dress | 30 |
| 6 | desh | **Beyond Dhaka** — Sylhet, Chittagong & the Hill Tracts, Barishal, Khulna, Rajshahi, Rangpur, Mymensingh; Chakma, Marma, Mro, Garo, Santal; Bengali Hindu, Buddhist and Christian life | 45 |
| 7 | desh | **Modern life & institutions** — cricket and sport, the garments industry, universities, transport, science, NGOs, everyday urban Dhaka | 35 |
| 8 | probash | **UK, East London** — Sylheti settlement, Tower Hamlets, Brick Lane, mosques, schools, local politics, housing | 35 |
| 9 | probash | **UK beyond London** — Birmingham, Manchester, Bradford, Luton, Oldham, Newcastle, Cardiff, Glasgow; the curry trade nationally | 35 |
| 10 | probash | **USA** — New York, Michigan, Chicago, Los Angeles, New Jersey, Texas, Florida, Atlanta; civic life, ballots, street names | 40 |
| 11 | probash | **Canada, Australia & Europe** — Toronto, Montreal, Sydney, Melbourne; Italy, Spain, Portugal, France, Germany, Sweden, Greece | 35 |
| 12 | probash | **Gulf & Asia** — Saudi, UAE, Qatar, Kuwait, Oman, Bahrain, Malaysia, Singapore, Japan, Korea, Maldives; labour migration, remittances, recruitment | 35 |
| 13 | probash | **Second-generation life** — language loss, Bangla school, weddings abroad, food adaptation, identity and slang, diaspora media, associations, sport | 40 |
| 14 | shared | **Eid, Ramadan & festivals** across Muslim, Hindu, Buddhist and Christian Bangladeshi life | 25 |
| 15 | shared | **Home & family** — weddings, kinship terms, manners, superstition, idiom, household objects, everyday food habits | 30 |

Run them in any order. After each batch:

```bash
node questions/merge.js questions/batch-N.json      # dry run, refuses duplicates
node questions/merge.js questions/batch-N.json --write
node questions/lint.js
```

## Accuracy is the real risk at this volume

250 questions is 250 chances to enshrine a wrong fact, and a wrong fact survives every
playtest because nobody in the room knows either. The prompt below tells the model to
put anything it is unsure of under **NEEDS CHECKING** instead of in the JSON — hold it
to that, and treat a batch that returns an empty NEEDS CHECKING list with suspicion
rather than relief.

---

Paste everything below into a fresh session, filling in the **ORDER** block at the end.

---

You are writing the question bank for **FAJIL** (ফাজিল), a bluffing trivia party game
about Bangladesh and its diaspora, played by 2–8 friends in a room.

## How the game works, and why it constrains the questions

Every player sees the same fill-in-the-blank prompt. Each **secretly writes a lie** — a
fake answer meant to fool everyone else. All the lies are shuffled together with the
real answer, and the room votes on which one is true. You score **+1000** for finding
the truth and **+500** for every player your lie fools.

Three consequences you must design for:

1. **A player who knows nothing must still be able to write a plausible lie.** The
   prompt has to suggest a *shape* of answer — a city, a fish, a fabric, a year — so
   somebody with no idea can still bluff. A prompt whose answer could be literally
   anything produces lies nobody would ever believe, and the round dies.
2. **A player who knows everything must not win automatically.** If the answer is the
   only conceivable option, everyone finds it and nobody scores for lying.
3. **The lies and the truth sit in one list, in the same typeface, and must be
   indistinguishable in register.** So the real answer has to *look like* something a
   player would invent: short, concrete, confident. If the truth is visibly longer,
   more technical or more hedged than the lies, the game is over.

## The single most important quality bar

> **Could a clever person who doesn't know the answer write something that fools the
> table? And could a person who does know the answer still get fooled by somebody
> else's lie?**

If both are yes, it is a good question. If either is no, cut it.

## Schema

Output a **JSON array**. Every object:

```jsonc
{
  "id": "bd-natl-fruit",         // unique, kebab-case; bd-* for desh, pr-* for probash
  "q": "Bangladesh's national fruit is the ___.",
  "a": "jackfruit",              // the canonical answer, lowercase, for matching
  "show": "Jackfruit (কাঁঠাল)",   // how it is DISPLAYED at the reveal
  "alt": ["kathal", "kanthal"],  // other spellings that count as "you wrote the truth"
  "decoys": ["Mango", "Lychee", "Guava"],      // >=3, house lies for a small room
  "filler": ["Mango", "Papaya"],               // >=2, used for players who go AFK
  "why": "Mango gets the poetry and the summer headlines, but kathal gets the title. It is enormous, it smells like a decision, and every part of it gets eaten.",
  "tier": "desh",                // desh | probash | shared
  "region": "national",          // national | dhaka | sylhet | chittagong | khulna | rajshahi | uk | usa | europe | global
  "era": "modern"                // modern | colonial | precolonial
}
```

### Field notes

- **`q`** — must contain `___` exactly where the answer goes. Put the blank **at or
  near the end** where possible; a blank in the middle is harder to read aloud from
  across a room. Max 160 characters. Write it as a *statement with a hole*, not a
  question — "Bangladesh's national fruit is the ___." not "What is…?"
- **`a`** — lowercase, no punctuation, the plainest form. Used only for matching.
- **`show`** — the display form, properly capitalised. Add Bengali script in
  parentheses where it adds something: `"Jackfruit (কাঁঠাল)"`. The game ships a
  Bengali font, so script is welcome and looks good.
- **`alt`** — **this field prevents a broken round.** If a player types the real
  answer into the lie box the game catches it and asks for a lie instead. Miss a
  spelling and the truth appears on the board twice. Include: transliteration
  variants (kathal / kanthal / kathol), the Bengali script form, with and without
  articles ("the meghna" / "meghna"), and the `show` string itself if it differs
  from `a`.
- **`decoys`** — house lies used to pad the board when fewer than four people are
  playing. Must be **the same kind of thing as the answer** and genuinely plausible.
- **`filler`** — assigned to a player who ran out of time. Shown at the reveal as
  "the house wrote this", never blamed on the player. Can overlap with `decoys`.
- **`why`** — read out at the reveal, after the answer. **This is the payoff of the
  entire round.** 1–3 sentences. It should tell the room something they did not
  know, or reframe something they did. Dry, specific, a little wry. Never a
  dictionary definition. This is the field most worth spending effort on.

## Hard rules — the linter fails on these

1. `id` unique across the whole bank; `q` unique.
2. `q` contains `___` and is ≤160 characters.
3. `a` is non-empty; `why` is ≥40 characters.
4. `tier` is exactly one of `desh`, `probash`, `shared`.
5. **At least 3 `decoys` and at least 2 `filler`.**
6. **No decoy or filler may be the real answer**, in any spelling. Comparison is
   case-insensitive with punctuation and spaces stripped. This is the rule that
   breaks games: a house lie that is secretly true puts two correct options on the
   board.
7. No duplicate decoys, no duplicate fillers, within a single question.
8. No decoy or filler longer than 60 characters (a player could not type it).
9. `era` must not be `"1971"`.
10. **These words must not appear anywhere in `q`, `a`, `why`, `decoys` or `filler`:**
    liberation war, genocide, massacre, martyr(s), Rohingya, Awami, BNP, Jamaat,
    coup, assassinat(ion/ed). The check is a plain text match, so avoid them even in
    passing in the `why`.

## Content policy — why rule 9 and 10 exist

**Players write the lies.** A prompt about the Liberation War, the 2024 protests, the
Rohingya, or party politics invites somebody to invent something tasteless, which is
then displayed on a shared screen with their name attached at the reveal. There is no
way to moderate that live, in a living room, in front of somebody's parents.

These remain entirely legitimate subjects of trivia. They are not safe as **bluffing
fodder**. Do not write around the rule by using synonyms — the point is the subject,
not the words.

The 1952 Language Movement is permitted where the framing is celebratory rather than
about the deaths — International Mother Language Day is fine; the shootings are not.

Also avoid: living private individuals, anything requiring a precise recent statistic
(it will be wrong within a year and the room cannot check it), and religious rulings.

**The overriding test is that this is a fun, lighthearted game**, and it is stricter
than the linter. If the answer is a place, the question is neutral and the `why` is
carefully flat, a subject can still be wrong for a living room — because the reveal
reads it out to everyone, including somebody's parents and somebody's children.
Deaths, disasters, drownings and racist violence are all in that category however
respectfully they are handled. Do not write the question and then justify it. Cut it,
and note the subject under NEEDS CHECKING so the omission is visible. No single
question is load-bearing; the bank is deep.

## The three tiers

The whole design rests on this. The `mixed` deck alternates `desh` and `probash`
round by round, so that **someone raised in Dhaka and someone raised in Michigan each
get rounds where they are the expert.** Their uneven knowledge is the engine, not a
problem to be smoothed out.

| tier | What it is | Test |
|---|---|---|
| `desh` | Bangladesh itself — geography, food, history, language, craft, sport, the built environment | Someone who grew up there has the edge |
| `probash` | The diaspora — Brick Lane, Tower Hamlets, Jackson Heights, Devon Avenue, Hamtramck, Rome, Gulf labour migration, Sunday Bangla school, curry-house economics, second-generation life | Someone who grew up abroad has the edge |
| `shared` | Things any Bangladeshi household has, anywhere — Eid, weddings, kinship terms, food habits, monsoon reflexes | Nobody has the edge |

**Under-serve `probash` at your peril.** It is the harder tier to write and the one
banks always run short of. The linter warns if desh:probash exceeds 2.5:1.

Within `desh`, deliberately reach past Dhaka: Sylhet, Chittagong, Barishal, Khulna,
Rajshahi, the Hill Tracts, Indigenous peoples (Chakma, Marma, Mro, Garo, Santal), and
Bengali Hindu, Buddhist and Christian life. A bank that is only Dhaka middle-class is
a worse game as well as a narrower one.

## What makes a good question — worked examples

**Good.** `"Bangladesh's national fish is the ___."` → *hilsa (ilish)*
The shape is obvious (a fish), so anyone can bluff — rui, koi, pangash all sound
right. The answer is knowable but not certain. Lies are easy and dangerous.

**Good.** `"For decades, the large majority of Britain's 'Indian' restaurants were actually owned and run by ___."` → *Bangladeshis (mostly Sylhetis)*
Surprising, verifiable, and the lies write themselves — Punjabis, Gujaratis,
Pakistanis. A desh-raised player may well not know this; a British Bangladeshi
certainly does. Exactly the asymmetry the game runs on.

**Good.** `"The sweet that made the town of Muktagacha famous is ___."` → *monda*
Regional and specific. Anyone can bluff with any Bengali sweet, and several will
sound perfect.

**Bad — no shape.** `"The most surprising thing about the Sundarbans is ___."`
Answers could be anything. Lies cannot be plausible because there is nothing to be
plausible *against*.

**Bad — only one conceivable answer.** `"The capital of Bangladesh is ___."`
Everybody finds it. Nobody scores for lying. Dead round.

**Bad — numeric.** `"Bangladesh has roughly ___ rivers."`
Numbers are a different game entirely. Avoid quantities as answers.

**Bad — the truth is obviously the truth.** If the real answer is a five-word
technical phrase and every plausible lie is one word, the truth stands out in the
list regardless of what anyone knows.

**Bad — the answer is a sentence.** Answers should be a short noun phrase, ideally
1–4 words. Players must be able to type a competing one on a phone in under a minute.

## Accuracy

This is a trivia game; a wrong fact is a defect that survives every playtest because
nobody in the room knows either.

- Only include facts you are **confident** about. Prefer things that are long-settled
  and well documented over anything recent, contested or statistical.
- If a fact is genuinely contested (the country's highest peak, for instance),
  **skip it** rather than pick a side.
- Do not invent a precise year, figure or superlative to make a question tidier.
- After each question, sanity-check the `why` separately — it is prose and therefore
  the easiest place for an unchecked claim to slip in.
- If you are unsure about an item but think it is worth having, **list it separately
  at the end under "NEEDS CHECKING" rather than putting it in the JSON.**

## Output

- A single JSON array, valid JSON, no trailing commas, no comments.
- No prose before or after it except the optional NEEDS CHECKING list.
- Vary the `region` and `era` fields genuinely; do not label everything
  `national` / `modern`.
- Do not reuse any `id` or repeat any question already in `questions/questions.json`
  if that file was provided to you.

Before you output, check each entry against this list:

- [ ] `q` has `___`, is a statement, ≤160 chars
- [ ] Could a clueless player bluff this? Could a knowledgeable one be fooled?
- [ ] Is the answer 1–4 words and the same register as the lies?
- [ ] ≥3 decoys, ≥2 filler, **none of them secretly true**
- [ ] `alt` covers every spelling someone might type, including Bengali script
- [ ] `why` earns the round — tells them something, ≥40 chars
- [ ] No banned word anywhere in the entry, `era` is not `1971`
- [ ] Am I actually confident this is true?

---

## ORDER

Write **45** new questions, all on the assigned territory below and nothing outside it.

**TERRITORY:** _(paste one row from the batch plan here)_

**ALREADY COVERED:** _(paste the output of `node questions/digest.js` here)_

Do not repeat any subject in that list. If an obvious question on your territory is
already taken, go one level more specific rather than rephrasing it.
