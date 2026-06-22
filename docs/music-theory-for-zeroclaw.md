# Music Theory for ZeroClaw — a generation-oriented reference

**Audience:** the ZeroClaw music agent ("Riff") and the people building it.
**Purpose:** turn a plain-language community request into a defensible *musical spec*,
then into **Strudel** code. This is the deep reference; the agent's `SOUL.md` carries a
condensed copy it can use without reading this file. Every statistic is cited inline with
a `[S#]` tag resolved in [Sources](#sources).

> **How the agent uses this doc:** request → fill a `MusicSpec` from the defaults in §0 →
> pick a progression (§2), key/mode (§3), tempo (§5), groove (§6) → render the genre recipe
> (§9) as Strudel → explain the choice in one line. Modifications are transforms, not re-rolls.

---

## 0. The 30-second defaults (most actionable table)

When a user names *only* a genre or a mood, fill the rest from here and just make something. Ask at most one question.

| If they say… | BPM | Key / mode | Progression | Groove | Core instruments |
|---|---|---|---|---|---|
| "lofi" / "chill" / "study" | 75 | A minor (Aeolian/Dorian) | i–IV or ii–V–I (7ths) | swung 16ths, backbeat | Rhodes, soft kick, vinyl crackle, upright/sub bass |
| "pop" / "upbeat" / "happy" | 120 | C or G major | **I–V–vi–IV** | straight, backbeat | piano/synth, drums, bass, vocal-ish lead |
| "sad" / "emotional" | 80 | A minor | vi–IV–I–V or i–VII–VI | sparse | pad, piano, light drums |
| "funky" / "disco" | 118 | C minor / Dorian | i–IV vamp, dom7 stabs | four-on-floor + octave bass | 909/live kit, sawtooth/clav bass, strings, brass stabs |
| "house" | 124 | A minor | 3–4 chord pad loop | four-on-floor, off-beat hats | 909 kick, clap on 2&4, pad, sub bass |
| "techno" | 135 | minor (1–2 chords) | hypnotic, minimal | four-on-floor, dense perc | 909 kick, acid 303 bass, metallic stabs |
| "trance" | 138 | minor | i–VI–III–VII | four-on-floor, off-beat hats | supersaw lead, arps, big pads |
| "hype" / "epic" | 128 | minor → major lift | build + drop | rising | big drums, supersaw, risers |
| "dark" / "tense" | varies | Phrygian / minor | Andalusian i–VII–VI–V | — | low drones, dissonance |
| "dreamy" / "ambient" | 70 (or free) | Lydian / major | slow pad changes | minimal/no pulse | pads, reverb wash, sparse bells |

Sources for these defaults: BPM §5 [S20–S24]; progressions §2 [S1,S4,S5]; modes §3 [S8,S26,S28]; genre recipes §9 [S36–S40].

---

## 1. Why Strudel is the right output

Strudel (<https://strudel.cc>, a JS port of TidalCycles) renders **code**, which means the
agent's output is deterministic, diffable, editable, teachable, and royalty-free (synth-only).
A request becomes a pattern; a modification becomes a one-line edit. Tempo in Strudel:
`setcpm(bpm/4)` makes one cycle = one 4/4 bar at the target BPM. Layers go in `stack(...)`;
arrangement over time uses `.cat()` / `.arrange()` / `.every()`.

---

## 2. Chords & progressions

### 2.1 The chords that actually get used
Hooktheory's analysis of 1,300+ popular songs (DB now >75,000 analyses), all transposed to a common key [S1]:

| Rank | Degree | In C | Share |
|---|---|---|---|
| 1 | I | C | 18.9% |
| 2 | IV | F | 17.2% |
| 3 | V | G | 15.7% |
| 4 | vi | Am | 14.7% |
| 5 | ii | Dm | ~10% |
| 6 | iii | Em | ~5% |
| 7 | ♭VII | B♭ | ~4% |

**I, IV, V, vi ≈ two-thirds of all chord usage.** Unlike classical practice, **IV→I is about as common as V→I** in pop [S2]. Takeaway for generation: you can make something idiomatic with just these four chords.

### 2.2 Canonical progressions → Strudel
Roman numerals, example in C, the vibe, and a Strudel rendering. (Use `.scale()` for note-based or `note(...)` for explicit chords.)

| Progression | In C | Feels like [S5] | Strudel sketch |
|---|---|---|---|
| **I–V–vi–IV** ("four chords"/Axis) — #1 in DB [S4] | C–G–Am–F | uplifting, universal pop | `note("<c4 g4 a4 f4>").voicings()` over a beat |
| **vi–IV–I–V** | Am–F–C–G | emotional/anthemic | `note("<a4 f4 c4 g4>").voicings()` |
| **I–vi–IV–V** (50s/doo-wop) | C–Am–F–G | nostalgic, romantic | `note("<c4 a4 f4 g4>").voicings()` |
| **ii–V–I** (jazz) | Dm7–G7–Cmaj7 | sophisticated tension→home | `note("<dm7 g7 cmaj7>").voicings()` |
| **I–IV–V** | C–F–G | folk/rock/blues, direct | `note("<c4 f4 g4>").voicings()` |
| **12-bar blues** | I·I·I·I IV·IV·I·I V·IV·I·V | blues, rock'n'roll | `note("<c c c c f f c c g f c g>").voicings()` |
| **i–♭VII–♭VI–♭VII** | Am–G–F–G | dark, driving (minor) | `note("<a3 g3 f3 g3>").voicings()` |
| **Andalusian i–♭VII–♭VI–V** [S9] | Am–G–F–E | flamenco/dramatic; the V is major → Phrygian-dominant pull | `note("<a3 g3 f3 e3>").voicings()` |
| **Pachelbel/Canon** [S15] | C–G–Am–Em–F–C–F–G | elegant, descending, meditative | `note("<c g a e f c f g>").voicings()` |

> Note: `.voicings()` auto-voices chord symbols; if your Strudel build lacks it, spell triads explicitly, e.g. `note("c4 e4 g4")`.

---

## 3. Keys & modes

### 3.1 Most common keys [S3, S18, S19]
| Rank | Key | ~Share | Why |
|---|---|---|---|
| 1 | **G major** | 10.7% | guitar + piano friendly |
| 2 | **C major** | 10.2% | piano-native, no accidentals |
| 3 | **D major** | ~9–10% | open guitar strings |
| 4 | **A major** | ~8–9% | guitar-centric |
| 5 | E major | ~7% | guitar's home |
| 7 | **A minor** | ~5–6% | most common minor; relative of C |
| 8 | E minor | ~4–5% | relative of G; rock staple |
| 9 | B minor | ~3–4% | relative of D |

**Major dominates;** minor keys are ~20–30% of songs and, apart from A/E/B minor, rarely exceed 4% each [S19]. The common minors are exactly the **relative minors** of the top majors (Am↔C, Em↔G, Bm↔D) — share the same notes, swap the tonal center. **Default key:** C major / A minor (piano-native) or G/D (guitar-native).

### 3.2 The 7 modes and their mood [S8, S26, S28, S29]
All share C-major's notes; the tonal center (and the resulting interval pattern) changes the feel. Strudel: `.scale("C:dorian")` etc.

| Mode | 3rd | Mood | Use for | Strudel token |
|---|---|---|---|---|
| **Ionian** (major) | maj | bright, happy, resolved | pop, folk | `C:major` / `C:ionian` |
| **Dorian** | min | minor-but-hopeful, funky, soulful (♮6) | lofi, funk, jazz, Celtic | `C:dorian` |
| **Phrygian** | min | dark, tense, "Spanish" (♭2) | metal, flamenco, cinematic | `C:phrygian` |
| **Lydian** | maj | dreamy, floating (♯4) | film, ambient, prog | `C:lydian` |
| **Mixolydian** | maj | bluesy, groovy, rootsy (♭7) | rock, blues, reggae | `C:mixolydian` |
| **Aeolian** (nat. minor) | min | sad, serious, emotional | ballads, dark pop, metal | `C:minor` / `C:aeolian` |
| **Locrian** | min | unstable, sinister (♭2,♭5) | rare, tension only | `C:locrian` |

Lydian/Ionian/Mixolydian are major-quality; Dorian/Phrygian/Aeolian/Locrian minor-quality. Modes are best as **color over a genre default**, not wholesale swaps [S28].

---

## 4. Song anatomy

### 4.1 Section roles [S6, S16, S17]
| Section | Function | Character |
|---|---|---|
| **Intro** | set mood/tempo/key | instrumental, 4–16 bars |
| **Verse** | advance the story; same melody, new lyrics | lower energy, sparse, specific lyrics, 8–16 bars |
| **Pre-chorus** | build tension into the chorus | starts off-tonic (IV/ii), rising, 4–8 bars |
| **Chorus** | the emotional peak + the hook + the title line | highest register, fullest arrangement, repeated lyrics, universal sentiment, 8–16 bars |
| **Hook** | the most memorable fragment (usually in the chorus) | short, 2–4 bars |
| **Bridge** ("middle eight") | contrast before the last chorus | new material, often a key change, once, ~8 bars |
| **Drop** (EDM) | max-energy payoff after a build | full kick+bass+lead together, rhythm-forward |
| **Outro/Coda** | wind down | chorus-loop fade or resolving tag |

### 4.2 The most common form [S6, S7]
Modern pop is **verse–chorus form (ABABCB)**:

> Intro → Verse → Pre-chorus → **Chorus** → Verse → Pre-chorus → **Chorus** → **Bridge** → **Chorus** → Outro

Historic **AABA / 32-bar form** (four 8-bar sections, B = bridge) ruled Tin Pan Alley/jazz ~1925–1960 before verse-chorus overtook it [S7].

### 4.3 What makes a chorus a chorus [S6]
Simultaneously: **same lyrics every time**, **fullest arrangement / highest energy**, **highest melodic register**, **contains the hook**, **title line present (~90% of pop)**, and **universal** sentiment vs the verse's specifics. The **pre-chorus strays from the tonic to build tension** the chorus resolves [S17]; the **bridge breaks the cycle** (often a half/whole-step key change) so the final chorus hits harder [S6].

### 4.4 Building this in Strudel
Loops are the default; for arrangement, sequence sections with `.arrange()`/`.cat()` and lift energy by adding stack layers, raising the filter, and increasing density:
```javascript
arrange(
  [4, intro],         // 4 cycles (bars)
  [8, verse],
  [4, prechorus],
  [8, chorus],        // fuller stack, higher .lpf(), louder .gain()
)
```

---

## 5. Tempo (BPM) by genre [S20–S24]
Ranges ≈ the 10th–90th percentile from Spotify-API tempo data [S21]. Strudel: `setcpm(bpm/4)`.

| Genre | BPM range | Typical |
|---|---|---|
| Ballad | 60–80 | 70 |
| Lofi hip-hop | 70–90 | 80 |
| Hip-hop | 80–115 | 90 (trap 130–145, half-time) |
| Pop | 100–130 | 120 |
| Disco / funk | 110–130 | 120 |
| House | 120–130 | 125 |
| Techno | 125–150 | 138 |
| Trance | 128–145 | 138 |
| Dubstep | 138–142 | 140 (feels like ~70) |
| Drum & bass | 160–180 | 174 |
| Reggaeton | 85–100 | 92 |
| Rock | 110–140 | 120 (punk 160+) |
| Ambient | 60–90 / free | 75 |

---

## 6. Rhythm & meter

**4/4 dominates** — >90% of commercial recordings [S33-meter ref / S? see toby rush]. Others: 3/4 (waltz), 6/8 & 12/8 (shuffle/blues triplet feel), 5/4 & 7/8 (prog/Balkan).

Core grooves (Strudel on the right):
| Concept | What | Strudel |
|---|---|---|
| **Backbeat** [S11] | snare/clap on 2 & 4 — the foundation of rock/pop | `sound("~ sd ~ sd")` or `sound("~ cp ~ cp")` |
| **Four-on-the-floor** [S10] | kick on every beat — disco/house/techno | `sound("bd*4")` |
| **Off-beat hats** | house/trance lift | `sound("~ hh ~ hh")` |
| **Swing / shuffle** | uneven 8ths (long–short, triplet feel); ~66% = full swing | `.swingBy(1/3)` (or `.swing()`) |
| **Tresillo / habanera** [S34,S35] | 3 onsets over 8 pulses (positions 1,4,7) — "Shape of You", "Cheap Thrills" | `.euclid(3,8)` |
| **Clave / Euclidean** | even distribution of k onsets over n pulses | `.euclid(k, n)` e.g. `(5,8)`, `(3,8)` |

The two most important pop syncopations are the **backbeat** and the **tresillo** [S11]; combined they give the habanera feel.

---

## 7. Harmony for generation

### 7.1 Function & tension [S32, S41]
| Degree | Name | Function | Tension |
|---|---|---|---|
| I | tonic | home / rest | resolved |
| ii | supertonic | pre-dominant | mild |
| iii | mediant | tonic-prolong / weak pre-dom | stable |
| IV | subdominant | pre-dominant (gentle departure) | mild |
| **V** | **dominant** | **pulls hard to I** | **high** |
| vi | submediant | tonic substitute (relative minor) | mild |
| vii° | leading tone | one semitone below I, wants up | very high |

**Tension→release is the engine:** V builds tension, I resolves it; the leading tone strains upward to the tonic.

### 7.2 The tritone [S31, S33]
The **tritone** (6 semitones) is the most unstable interval ("diabolus in musica"). In a **V7** it sits between scale degrees 4 and 7 (in C: F & B of G7): B→C up, F→E down — the double pull that makes **V7→I the most common cadence in Western music** [S32].

### 7.3 Cadences [S30]
| Cadence | Motion | Character | Use |
|---|---|---|---|
| Perfect authentic | V(7)→I, melody ends on tonic | strongest, final | song/phrase ends |
| Imperfect authentic | V→I, melody not on tonic | softer resolution | mid-phrase |
| Half | →V | incomplete, expectant | "comma", sets up next |
| Plagal ("amen") | IV→I | gentle | codas, outro tags |
| Deceptive | V→vi | surprise non-resolution | drama, avoid rest |

---

## 8. Theory → MusicSpec → Strudel (the bridge)

```
request ─► MusicSpec { genre, bpm, key, scale/mode, mood{energy,valence}, duration_s, instrumentation[], structure }
            │
   energy ──┼─► tempo (§5) + layer density + .gain()/.lpf()
  valence ──┼─► major/bright vs minor/dark mode (§3)
    genre ──┼─► recipe (§9): instruments + groove (§6) + default progression (§2)
            └─► Strudel: setcpm(bpm/4) + stack(layers) ; arrange() for structure (§4)
```
Modifications map to single transforms (`.fast/.slow`, `.lpf/.hpf`, `.bank()`, `.scale()` swap, `.euclid()`, `.room()`, edit the `stack`). See the soul's transform table.

---

## 9. Genre recipes (spec defaults + Strudel skeleton)

Each recipe = the defaults to assume + a starting pattern to mutate.

### Lofi hip-hop [S36, S39]
75–85 BPM · A minor (Dorian/Aeolian) · jazzy 7th/9th chords · swung hats · Rhodes + soft kick + vinyl + sub bass.
```javascript
setcpm(80/4)
stack(
  sound("bd ~ ~ bd ~ ~ sd ~").bank("RolandTR808").gain(0.8),
  sound("hh*8").gain(0.3).swingBy(1/3),
  note("<am7 dm7 g7 cmaj7>").voicings().sound("rhodes").gain(0.5).room(0.4),
  note("<a1 d2 g1 c2>").sound("sine").gain(0.7),    // sub bass roots
  sound("vinyl").gain(0.3)                            // crackle texture
)
```

### House [S37, S14]
124 BPM · four-on-floor · clap on 2&4 · off-beat open hats · pad loop · sub bass.
```javascript
setcpm(124/4)
stack(
  sound("bd*4").bank("RolandTR909"),
  sound("~ cp ~ cp"),
  sound("~ oh ~ oh").gain(0.4),
  note("<am7 fmaj7 cmaj7 g7>").voicings().sound("sawtooth").lpf(1200).gain(0.5),
  note("a1*8").sound("sine").gain(0.7)
)
```

### Techno
135 BPM · 1–2 chords, hypnotic · dense perc · acid 303 bass.
```javascript
setcpm(135/4)
stack(
  sound("bd*4").bank("RolandTR909").gain(1),
  sound("[~ hh]*4").gain(0.35),
  sound("~ ~ rim ~").gain(0.5),
  note("a1 a1 c2 a1").sound("sawtooth").lpf(sine.range(300,1800).slow(8)).gain(0.6) // acid sweep
)
```

### Trance [S27]
138 BPM · minor · i–VI–III–VII · supersaw lead + arps + big pads · off-beat hats.
```javascript
setcpm(138/4)
stack(
  sound("bd*4"),
  sound("~ oh ~ oh").gain(0.4),
  note("<a3 f3 c4 g3>").voicings().sound("sawtooth").gain(0.4).room(0.5),   // pad
  n("0 2 4 7 4 2").scale("A:minor").sound("supersaw").fast(2).gain(0.4).delay(0.3) // arp
)
```

### Disco / funk [S38, S12]
118 BPM · four-on-floor + octave bass · funk-chopped guitar · strings · brass stabs.
```javascript
setcpm(118/4)
stack(
  sound("bd*4"),
  sound("~ cp ~ cp"),
  sound("hh*8").gain(0.4).swingBy(0.1),
  note("c2 c3 c2 c3").sound("sawtooth").lpf(900).gain(0.7),   // octave disco bass
  n("0 2 4").scale("C:dorian").sound("piano").struct("~ x ~ x ~ x x ~").gain(0.4) // clav/guitar stabs
)
```

### Rock [S13, S40]
120 BPM · I–IV–V or I–V–vi–IV · power chords · backbeat kit · bass locks kick.
```javascript
setcpm(120/4)
stack(
  sound("bd ~ bd ~"),
  sound("~ sd ~ sd"),
  sound("hh*8").gain(0.4),
  note("<c2 f2 g2 c2>").sound("sawtooth").distort(0.4).gain(0.6),  // power-chord roots
  note("<c4 f4 g4 c4>").voicings().sound("sawtooth").distort(0.3).gain(0.4)
)
```

> Strudel function names (`.voicings`, `.distort`, `.swingBy`, `.bank`, `.euclid`, `.room`, `.delay`, `.lpf/.hpf`) should be **validated against the current strudel.cc build** before shipping — the validation gate catches drift. When in doubt, prefer note-spelled chords and the core verbs from the workshop: <https://strudel.cc/workshop/first-sounds/>.

---

## Sources

| Tag | Source | URL |
|---|---|---|
| S1 | Hooktheory — I Analyzed the Chords of 1300 Popular Songs | https://www.hooktheory.com/blog/i-analyzed-the-chords-of-1300-popular-songs-for-patterns-this-is-what-i-found/ |
| S2 | Hooktheory — 1300 Songs, Part 2 | https://www.hooktheory.com/blog/music-theory-analysis-1300-songs-for-songwriting-part2/ |
| S3 | Hooktheory — Song Keys Ranked by Popularity | https://www.hooktheory.com/cheat-sheet/key-popularity |
| S4 | Hooktheory — Popular Chord Progressions | https://www.hooktheory.com/theorytab/popular-chord-progressions |
| S5 | Wikipedia — Chord progression | https://en.wikipedia.org/wiki/Chord_progression |
| S6 | Wikipedia — Song structure | https://en.wikipedia.org/wiki/Song_structure |
| S7 | Wikipedia — Thirty-two-bar form | https://en.wikipedia.org/wiki/Thirty-two_bar_form |
| S8 | Wikipedia — Mode (music) | https://en.wikipedia.org/wiki/Mode_(music) |
| S9 | Wikipedia — Andalusian cadence | https://en.wikipedia.org/wiki/Andalusian_cadence |
| S10 | Wikipedia — Four on the floor | https://en.wikipedia.org/wiki/Four_on_the_floor_(music) |
| S11 | Wikipedia — Syncopation | https://en.wikipedia.org/wiki/Syncopation |
| S12 | Wikipedia — Disco | https://en.wikipedia.org/wiki/Disco |
| S13 | Wikipedia — Rock music | https://en.wikipedia.org/wiki/Rock_music |
| S14 | Wikipedia — House music | https://en.wikipedia.org/wiki/House_music |
| S15 | Wikipedia — Pachelbel's Canon | https://en.wikipedia.org/wiki/Pachelbel%27s_Canon |
| S16 | MasterClass — Songwriting 101 / song structures | https://www.masterclass.com/articles/songwriting-101-learn-common-song-structures |
| S17 | iZotope — The Power of the Pre-Chorus | https://www.izotope.com/en/learn/the-power-of-the-pre-chorus |
| S18 | Digital Trends / Spotify — most popular key | https://www.digitaltrends.com/music/whats-the-most-popular-music-key-spotify/ |
| S19 | How Music Really Works — major/minor key popularity | https://www.howmusicreallyworks.com/chapter-five-keys-modes/minor-major-key-mode-songs.html |
| S20 | Orphiq — BPM Tempo Guide by genre | https://orphiq.com/resources/bpm-tempo-guide |
| S21 | BPMCalc — BPM by genre (Spotify data) | https://bpmcalc.com/genres/ |
| S22 | Vibes DJ — EDM genre BPM chart | https://vibesdj.io/dj-tools/edm-genre-chart |
| S23 | Mixgraph — Reggaeton BPM | https://www.mixgraph.io/bpm-for/reggaeton |
| S24 | SampleFocus — Tempo & BPM guide | https://blog.samplefocus.com/blog/ultimate-guide-to-tempo-and-bpm-the-best-bpms-for-hip-hop-trap-dnb-and-more/ |
| S25 | Sessionville — Structure of popular songs (phrases) | https://sessionville.com/articles/the-structure-of-popular-songs-part1-parts-and-phrases |
| S26 | LANDR — Music modes | https://blog.landr.com/music-modes/ |
| S27 | LANDR — Trance production | https://blog.landr.com/trance-music-production/ |
| S28 | Musical-U — Moods of musical modes | https://www.musical-u.com/learn/the-many-moods-of-musical-modes/ |
| S29 | Orphiq — Music modes explained | https://orphiq.com/resources/music-modes-explained |
| S30 | muted.io — Cadence in music | https://muted.io/cadence/ |
| S31 | Beyond Music Theory — The tritone | https://www.beyondmusictheory.org/the-tritone/ |
| S32 | musictheory.education — Tonic/Subdominant/Dominant | https://www.musictheory.education/music-theory-level-2/ch-2-14-degrees-i-iv-and-v-tonic-subdominant-and-dominant |
| S33 | Wikibooks — Consonance and dissonance | https://en.wikibooks.org/wiki/Music_Theory/Consonance_and_Dissonance |
| S34 | ArXiv — Tresillo rhythm in popular music | https://arxiv.org/pdf/2109.10256 |
| S35 | Frontiers in Psychology — Syncopation as structure | https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2024.1304485/full |
| S36 | Native Instruments — Lo-fi hip-hop beats | https://blog.native-instruments.com/lo-fi-hip-hop-beats/ |
| S37 | Native Instruments — House music 101 | https://blog.native-instruments.com/house-music-101/ |
| S38 | Native Instruments — How to write a disco song | https://blog.native-instruments.com/disco/ |
| S39 | EDMProd — Lo-fi hip-hop | https://www.edmprod.com/lofi-hip-hop/ |
| S40 | Musician Wave — Instruments in a rock band | https://www.musicianwave.com/instruments-in-a-rock-band/ |
| S41 | Learn Jazz Standards — Scale degrees | https://www.learnjazzstandards.com/blog/scale-degrees/ |
| S42 | Music Theory 21c (Toby Rush) — Meters / 4-4 dominance | https://tobyrush.com/book/text/beg/beg01.html |

*4/4 >90% dominance figure: [S42]. Phrase/bar grid (§ throughout): [S25].*
