# Berth — dock scheduling for Harborview Marine Research Center

Berth replaces a hand-kept spreadsheet grid with a system where **a double-booking
is not something the UI discourages — it is something the database refuses to
store.** Same for putting a 170 ft vessel on a 90 ft float.

**Live URL:** _(see “Deploying” below — the app runs locally against Postgres today)_

| Screen | What it is for |
|---|---|
| **Timeline** | Berths as rows, days as columns; blue vessels, green events, red flagged history. Search runs across all 23 years, not just the month on screen |
| **New booking** | Vessel or event, dates, and a ranked list of berths with “Best fit” first |
| **Find a slot** | The reverse question: fixed vessel and length of stay, negotiable dates — *when is the soonest you could take us?* |
| **Audit** | What 23 years of the old schedule looks like once every rule is applied, with a one-click Fix for each flagged booking |
| **Berths & vessels** | Reference data; adding a missing vessel length turns the fit rule on for its whole history |
| **Vessel history** | Every stay one vessel ever made, with the physically impossible days marked |
| **Stats** | Occupancy per berth and per month, plus a heatmap of all 23 years at once |

---

## The headline finding

Importing the 23-year workbook (1997–2019) read **2,737 schedule cells** and built
**2,088 bookings**. Then every one of them was offered to the database:

| Finding | Count |
|---|---|
| Bookings loaded clean | 2,059 |
| **Vessels assigned to a berth too short for them** | **29** |
| **The same vessel recorded at two berths on the same day** | **9** |
| Entries whose berth was lost by the grid's layout | 379 |
| Vessels appearing in the schedule with no length on file | 410 of 430 |
| Operational notes mixed in with bookings | 58 |
| Defects in the source itself — undated cells, stale weekday headers, wrong years | 200 |

Those 200 source defects break down as 112 entries sitting in a column outside
their month, 84 weekday headers that disagree with the real calendar, 2 month blocks
labelled with the wrong year, and 2 cells outside any month block at all.

The worst misfit is **S/Y Clear Beacon (170 ft) on South Float East (90 ft)** — 80 ft
of boat with nowhere to be. The impossible moves are just as concrete: *R/V Long
Anchor* is recorded at both North Pier West and North Pier Face on 29 June 2002.

### Zero double-bookings, and why that number is the most interesting one

The audit finds **no** two bookings fighting over one berth — and that is a finding
about the *format*, not a clean bill of health.

The old grid has exactly one cell per berth per day. A second occupant physically
cannot be written there. So when two vessels needed the same berth, staff wrote the
second one **on the line underneath**, outside the berth rows. That is what those
**379 entries with no berth** are. The double-bookings are in the data; the
spreadsheet destroyed the one thing needed to prove it — which berth they belonged
to.

A system that stores a booking as a range against a berth cannot lose that
information, which is the whole argument for replacing the grid.

---

## Beyond the brief

Three additions that the data argued for:

- **Find a slot.** The PRD's suggester answers *“is this berth free on these dates”*. The
  question a coordinator actually gets on the phone is the other way round — the vessel and
  the length of stay are fixed, the dates are not. This walks the gaps between existing
  bookings and returns the earliest window per berth, soonest first with best-fit breaking
  ties, so it can never contradict the berth suggester. A test asserts exactly that: every
  window it offers is then inserted successfully against the live constraints.
- **A 23-year heatmap.** The point of this dataset is its span, and a month-at-a-time grid
  cannot show it. One year×month cell per month, one sequential blue hue (magnitude is the
  job), grey for months with nothing booked so an empty month cannot read as a quiet one.
- **Vessel history.** The audit can say *“this vessel was at two berths on one day”*, but
  that is only actionable next to the rest of its record. `R/V Wild Kestrel` is at North Pier
  West and North Pier Face on 4 June 2002 — the page marks the day so a human can decide
  which entry is the transcription error.

## How to run it

```bash
# 0. all tests: 86 unit + 125 end-to-end
npm run test:all

# 1. a Postgres with btree_gist (any Postgres 14+ will do)
docker run -d --name berth-pg -e POSTGRES_PASSWORD=berth -e POSTGRES_USER=berth \
  -e POSTGRES_DB=berth -p 55432:5432 postgres:16-alpine

# 2. configure and install
cp .env.example .env
npm install

# 3. schema, then the 23-year import
npm run db:migrate
npm run import

# 4. go
npm run dev        # http://localhost:3000
npm test           # 86 unit tests
npm run e2e        # 125 end-to-end checks (resets its own database, runs its own server)
npm run replay     # re-runs 23 years under best-fit and prints the comparison
```

## How to use it

- **Book a vessel.** Click any empty cell on the timeline, or press *New booking*.
  Pick a vessel and dates; the berth list re-ranks itself as you type, best fit first.
- **Try to break it.** Book the same berth over the same days — the save is refused
  with the name and dates of the booking in the way. Put *R/V Iron Skua* (72 ft) in
  the Inner Channel (55 ft) and it is refused with both lengths.
- **Read the audit.** Every tab is a different way the old schedule was wrong.
  *Misfits* and *Impossible moves* are the substantive ones; *No length on file* is
  the reason the other two are undercounts.

---

## Key decisions

### 1. The rules live in the database, not the application

```sql
ALTER TABLE reservations ADD CONSTRAINT no_double_booking
  EXCLUDE USING gist (berth_id WITH =, during WITH &&)
  WHERE (status = 'active');
```

A check in application code is a promise that every future code path remembers to
call it. A Postgres exclusion constraint is a guarantee that holds against the API,
a migration, a background job, or someone typing `INSERT` into psql at 2 a.m. The
API's job is not to enforce the rule but to **explain** it: error `23P01` becomes a
409 naming the conflicting booking, and the fit trigger's error becomes a 422
reading *“R/V Iron Skua is 72 ft; Inner Channel is 55 ft.”*

The fit rule spans two tables (`vessels.length_ft` vs `berths.length_ft`), which no
single constraint can express, so it is a `BEFORE INSERT OR UPDATE` trigger. Both
rules are re-checked on **edit**, not just insert — the tests cover exactly that,
because moving a booking is the easiest way to sneak past a create-time check.

### 2. Vessels and events share one table

An event occupies a berth exactly the way a vessel does, so they are one
`reservations` table with a `kind` column. One overlap rule then covers both cases
and there is no way for a sail day and a research vessel to be booked into the same
water. A `CHECK` constraint keeps each shape honest: a vessel booking needs a
vessel, an event needs a title.

### 3. Half-open date ranges internally, inclusive dates in the UI

Staff say “in on the 1st, out on the 5th” and mean both days. Overlap arithmetic on
inclusive dates is full of off-by-ones, so a booking is stored as `[start, end+1)`.
Back-to-back stays (1st–5th, then 6th–10th) do not collide; same-day turnover
(1st–5th, then 5th–9th) does, which is the safer default for a dock (A7).

### 4. Best-fit berth suggestion — and the replay that checks it

Of the berths that fit and are free, offer the **smallest**. Putting a 40 ft boat on
the 410 ft pier is legal and quietly terrible, because that pier is the only berth a
400 ft research vessel could ever use. Ties break on berth name so the list never
reshuffles between identical queries. It is one indexed query — the same GiST index
that enforces the no-overlap rule answers “is it free?”.

When nothing is available the answer distinguishes the two cases that matter:
*“No berth is long enough for R/V Enormous (500 ft)”* is a permanent no;
*“All 2 berths that fit are booked for those dates”* comes with nearby dates and
berths that free up partway through.

Rather than assert that best-fit is better, `npm run replay` re-runs all 23 years
and compares. It is deliberately conservative: a stay is only re-assigned when the
vessel's length is on record, because that is the only case where *does it fit* can
be answered. Every other stay keeps its recorded berth **and still occupies it**, so
the replay competes for real space rather than an empty harbour.

| Outcome over the 54 fit-checkable stays | As recorded | Best-fit |
|---|---:|---:|
| Vessels on a berth too short for them | **29** | **0** |
| Stays that could not be placed at all | 0 | 0 |
| Berth-days used on the 410 ft pier | 10 | 4 |

Best-fit moved 49 of the 54: **30 onto a larger berth** — those are the misfits being
corrected — and **19 onto a smaller one**, handing capacity back. On the longest pier
it took 10 berth-days off and put 4 back where nothing smaller was free, a net **60%
returned**. That is the argument for the heuristic in one line: it cannot create a
misfit, because it will not choose a berth the vessel does not fit, and it stops the
410 ft pier being spent on boats that fit a 55 ft one.

The honest caveat is the same one that runs through this project: 54 stays is 2.6% of
the record, because the other 97.4% have no vessel length to check.

### 5. Vessel names were **not** fuzzy-matched — deliberately

Only 20 of the 430 vessels in the schedule appear in the workbook's reference tabs.
It is tempting to match on the name body and ignore the prefix, which would lift
that to 65. The data says not to: the reference tabs list both **R/V Iron Ketch
(46 ft)** and **F/V Iron Ketch (65 ft)** — different boats, 19 ft apart. Matching on
the body alone would assign a wrong length, and it would do so in the dangerous
direction: it can declare that a vessel *fits* a berth it does not.

So matching folds case, spacing and the `OSV`/`OS/V` spelling, and stops there. The
consequence is stated plainly in the audit: the fit rule could only be applied to 54
of 2,088 bookings, and **the missing vessel lengths are the facility's single
biggest data problem.** Filling them in on the Vessels page turns the rule on for
the rest, and re-flags any booking that no longer fits.

### 6. Nothing is dropped, ever

Every non-empty cell lands in exactly one bucket, and the totals reconcile:
`2,244 bookings + 379 berth-less + 112 undated + 2 unreadable = 2,737 read`.
Legacy rows that break a rule are loaded as `status = 'flagged'` — history is
preserved, the constraint only applies to `active` rows, and each problem gets a row
in `import_issues` pointing back to the source cell (`2006!P70`).

---

## Data cleaning: what the workbook actually threw at us

The sample file is a 23-year hand-kept workbook, and it earns every bit of that
description.

| What was wrong | What the importer does |
|---|---|
| **The layout changes mid-history.** 1997–2013 use `AUGUST 1997` headers; 2014–2019 use a bare `January` and shift the grid one column right. | No year is special-cased. Each month block finds its own day-number row and derives its own column→date mapping. |
| **Day numbers are sometimes absent.** The 1997 sheets write only `1` and leave the other 30 columns implied by position. | Explicit numbers win; gaps are filled positionally. |
| **So the mapping is cross-checked against the calendar.** | Every block's weekday header is verified against the real weekday for that date. This caught the next two problems. |
| **`DECEMBER 2001` sits at the top of the 2002 sheet** — and so do carry-over blocks on 2003 and 2004. | Honoured, not overridden. Its contents match the 2001 sheet's December; forcing it to 2002 would have dropped it on top of the real December 2002 block and manufactured 26 conflicts. Its weekday header is stale — a genuine defect, reported, not silently obeyed. |
| **`NOVEMBER 2018` and `DECEMBER 2018` appear inside the 2010 sheet**, in month order after October 2010. | Treated as typos, read as 2010, and reported. The rule: a header year is trusted only when it is a plausible carry-over, otherwise the sheet wins. |
| **The same vessel is typed five ways** — `Barge SALT DORY`, `Barge Salt Dory`, `OSV`/`OS/V`. | Folded to one key on case, spacing and designation. Every spelling seen is kept in `vessels.aliases`. |
| **Lengths contradict themselves.** `M/Y Western Strand 52'` is listed beside `LOA: 65'`. | The **larger** value wins and the disagreement is reported. Understating a length is the error that puts a 65 ft boat on a 55 ft berth. |
| **Notes share cells with bookings** — `ETA 1200`, `Fueling @0800`, `Holiday`, a bare `1030`. | Classified as annotations, *not* occupancy. Booking them would have invented 58 conflicts that never happened. They are recorded in the audit. |
| **Maintenance blocks a berth but is not a boat** — `Float rebuild - no usage permitted`. | Loaded as events, because the berth genuinely is unavailable. |
| **Two sections carry no length** — `North Finger Piers`, `Small craft slips`. | Loaded with `length_ft NULL`. Fit cannot be checked there and the app says so rather than assuming. |
| **Entries spill outside the grid** — below the berth rows, or into a column left of day 1. | Kept as `unknown_berth` (date known) or `parse_error` (undated), never guessed onto a berth. |

Re-running the import on the same file changes nothing: stays are keyed on
`berth|occupant|start|end` and issues on their source cell, so a second run inserts
zero rows and preserves any *resolved* ticks staff have made.

---

## Assumptions

| # | Assumption | Configurable? |
|---|---|---|
| A1 | Bookings are whole days; start and end are both inclusive in the UI | No |
| A2 | Stored internally as half-open `[start, end + 1)` | No |
| A3 | A vessel fits if `vessel.length_ft + margin_ft <= berth.length_ft` | Yes — `settings.margin_ft`, default 0 |
| A4 | Events occupy the whole berth and have no length | No |
| A5 | One booking occupies exactly one berth (no rafting) | Future work |
| A6 | All lengths in feet; metres converted on import | Display unit could be toggled |
| A7 | Same-day turnover counts as a conflict | Could relax |
| A8 | Legacy data is imported as-is even when it breaks rules, and flagged | Flagged rows are fixable in-app |
| A9 | Single facility, single time zone (America/New_York) | No |
| A10 | No authentication for the demo | Future work |

Two assumptions were **added** while reading the real file:

- **A11 — An operational note is not an occupancy.** `ETA 1200` in a berth-day cell
  records something about a visit, not a visit. Treating these as bookings would
  have produced 58 false conflicts.
- **A12 — Where a vessel's length is unknown, the fit rule is skipped, not guessed.**
  The booking is allowed and the gap is reported. The alternative — assuming a
  length — risks approving a berth that cannot hold the boat.

---

## Testing

Two layers, **211 checks** in total, and no mocks for the rules: they run against a
real Postgres, because the rules *are* the database.

`npm test` — **86 unit tests** over the rules, the suggester, the availability
search and the parser.
`npm run e2e` — **125 end-to-end checks** over real HTTP. It resets its own
database, imports the workbook, starts its own server and tears it down, so it is
repeatable and each check names the requirement it covers.

### The end-to-end tests earned their keep immediately

They caught a bug the unit tests structurally could not. The fit filter read
`berth.length_ft IS NULL OR berth.length_ft >= vessel.length_ft` — treating an
unknown berth length as “can't rule it out”. Every unit-test berth had a length, so
the clause never fired. The real facility has **two berths with no recorded length**,
so those were offered for *any* vessel: a 999 ft boat got suggestions, and
“no berth is long enough” could never be reached.

The fix keeps them but stops pretending they were checked: `suggestions` are berths
that provably fit, `unverified` are free berths whose length is unknown, shown
separately and labelled *Fit unknown*. Four regression tests now pin the behaviour at
the unit level too.

| Area | What is covered |
|---|---|
| Overlap rule (11) | identical dates; overlap at the start, at the end, and fully contained; back-to-back allowed; same-day turnover rejected; other berths unaffected; cancelling frees the slot; flagged rows may overlap; **an overlap created by editing** |
| Fit rule (7) | exact-length allowed at margin 0; one foot over rejected with the exact message; the margin setting applied; unknown vessel length and unknown berth length both skip the check; **a misfit created by editing**; flagged rows exempt |
| Events (5) | an event blocks a vessel and a vessel blocks an event; no title rejected; a vessel booking with no vessel rejected; events fit any berth |
| Suggester (17) | smallest fitting berth first; oversized berths excluded; deterministic ordering; booked berths dropped; a booking ending the day before does not block; cancelled ignored; the two empty-result reasons distinguished; alternatives offered; the edited booking excluded from its own check; margin respected; **berths of unknown length kept out of the verified fits, offered separately, and never used to pad alternatives** |
| Availability (15) | earliest window per berth; gaps between bookings used when long enough and skipped when not; flagged and cancelled rows do not occupy; unknown-length berths excluded; margin honoured; **every window it offers is then proved insertable against the live constraints** |
| Parsing (30) | name variants fold; different prefixes stay apart; LOA vs name-suffix; metres; runs collapse into one stay; gaps split stays; the 2014 column shift; **weekday cross-check catches a bad mapping**; carry-over December honoured; typo year reported; spill-over and undated cells preserved; notes not booked; source keys stable |

The end-to-end suite walks FR1–FR15 in order: creating vessel and event bookings,
the 409 and 422 bodies, back-to-back and same-day turnover, best-fit ranking and
determinism, edits that create a conflict or a misfit, cancelling freeing a berth,
creating berths and vessels, the shorten-a-berth warning and its confirm path,
audit filters, the Fix flow resolving an issue, search by vessel/berth/event/date,
utilisation arithmetic, both CSV exports, the availability search, vessel history,
the heatmap grid, and every page including deep links.

---

## Time spent

Roughly in proportion — the shape matters more than the totals:

| Phase | Share | Notes |
|---|---|---|
| Reading the workbook | ~30% | By far the biggest cost, and the least visible. Four layout eras, two date defects that look identical and must be handled oppositely, and the vessel-matching question |
| Schema and the two rules | ~10% | Small, and the part everything else leans on |
| Import and audit | ~15% | Including making it idempotent and making the totals reconcile |
| API and suggester | ~10% | |
| The five screens | ~20% | Timeline lane-packing took the most of it |
| Tests | ~10% | Paid for itself: the end-to-end layer found a real bug in the suggester |
| This README | ~5% | |

The single largest surprise was that the reference tabs describe a mostly *different*
set of vessels from the schedule grid. That one fact reshaped the audit, the honest
framing of the fit rule, and what the replay above is able to claim.

## Trade-offs, and what is not here

**Known limits**

- **`suggestions` vs `unverified`.** Berths with no recorded length are never presented
  as fit-checked. That is deliberate, but it means the two un-lengthed sections are
  effectively unusable for vessel bookings until someone records their length.

- **Fit is only checked for 2.5% of history**, because 410 of 430 vessels have no
  length anywhere in the workbook. This is reported rather than papered over, and
  the Vessels page is the fix. The 29 misfits are a floor, not a total.
- **The 379 berth-less entries are not assigned to berths.** They are listed for a
  human, because the source genuinely does not say which berth they belong to.
- **No authentication**, per A10. Every visitor can edit. A real deployment needs
  staff login before anything else.
- **Mobile is view-only**; the timeline expects a laptop.
- Keyboard: `←`/`→` move month, `N` opens a new booking, `T` jumps to today, `Esc` closes,
  `⌘↵`/`Ctrl+↵` saves the booking form.
- **No in-browser upload of a new workbook** (`POST /api/import`, a P1). The import makes
  ~2,000 round trips and takes several seconds — comfortable as a CLI step against any
  `DATABASE_URL`, but a poor fit for a serverless request that has to return in seconds.
  Re-importing is `npm run import`, and it is idempotent, so this is a deliberate omission
  rather than a missing feature.
- The timeline fetches one month at a time. A year loads in well under a second, but
  a whole-history view would need windowing.

**Future work**

- Staff login with roles, and an audit log of who changed what
- A captain-facing request portal with approve/decline
- Beam, draft and tide constraints alongside length
- Rafting — several small vessels sharing one berth (A5)
- Global re-optimisation: propose moving existing bookings to fit a large arrival
- iCal feeds per berth, and email reminders

---

## Architecture

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js 15 App Router, React 19, Tailwind 4 | One repo for UI and API |
| Timeline | Hand-built CSS grid | Needed lane-packing to show flagged bookings overlapping active ones, which no off-the-shelf timeline does |
| API | Next.js route handlers | No second service to deploy |
| Database | Postgres 16 + `btree_gist` | `daterange` + `EXCLUDE` is the strongest available proof that double-booking is impossible |
| Queries | `postgres.js`, raw SQL | The interesting parts (`&&`, exclusion constraints, GiST) are things ORMs get in the way of |
| Import | `tsx scripts/import.ts` with SheetJS | Run locally against any `DATABASE_URL` |
| Tests | Vitest against a real Postgres | Mocking the rules would test the mock |

```
lib/parse/    normalize · classify · grid · build   ← pure, heavily tested
lib/          db · errors · suggest · availability · validate · dates
app/api/      reservations · suggest · availability · berths · vessels · audit · stats · export
components/   Timeline · BookingPanel · Audit · FixPanel · Reference · Availability · VesselDetail · Stats
sql/          001_schema.sql   ← the two rules live here
scripts/      db · import · e2e
tests/        rules · suggest · availability · parse
```

### API

| Method | Path | Does |
|---|---|---|
| GET | `/api/reservations?from=&to=&berth=&vessel=&q=` | Reservations in a window |
| POST | `/api/reservations` | Create — **409** on overlap, **422** on misfit, 400 on bad dates |
| PATCH/DELETE | `/api/reservations/:id` | Edit or cancel; both re-run the rules |
| GET | `/api/suggest?vessel=&start=&end=&exclude=` | Ranked berths, or the reason there are none plus alternatives |
| GET/POST/PATCH | `/api/berths`, `/api/vessels` | Reference data; 409 + `affected` when a change would break bookings |
| GET | `/api/audit?year=&kind=&berth=` | Import issues, with summary counts |
| GET | `/api/stats?year=` | Utilisation |
| GET | `/api/availability?vessel=&days=&from=` | Earliest workable windows, soonest first |
| GET | `/api/vessels/:id` | One vessel's whole history, berths used, and its audit issues |
| GET | `/api/stats?span=all` | Year × month occupancy grid for the heatmap |
| GET | `/api/export?what=reservations\|issues` | CSV |

## Deploying

The app reads a single `DATABASE_URL` and needs `btree_gist`, which
[Neon](https://neon.tech) supports. To put it on Vercel:

```bash
# create a Neon project, copy its connection string, then:
export DATABASE_URL='postgres://…@ep-….neon.tech/berth?sslmode=require'
npm run db:migrate && npm run import      # seed production from the workbook
npx vercel --prod                          # set DATABASE_URL in the Vercel dashboard
```

SSL is enabled automatically for any non-localhost URL.
