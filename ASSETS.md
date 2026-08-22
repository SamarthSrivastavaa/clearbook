# Clearbook — asset generation briefs

Production briefs for every generated asset the site expects. Each one ships
behind a graceful fallback, so they can land one at a time.

---

## The direction, and the one rule

Clearbook's visual world is **precision instruments and financial records**:
engraved steel, intaglio printing, archive stacks, ruled ledger paper.

It is chosen because it is the only register that is simultaneously

- **on-theme** — this is a book of evidence about money,
- **premium and warm**, which the typography cannot supply alone,
- **absent from this entire category.** Everyone else ships glowing nodes,
  floating cubes and neon gradients.

**The rule that matters most:** never generate an interface. No screens, no
dashboards, no UI, no charts, no numbers, no letterforms. AI-generated text is
reliably broken, and a garbled figure on a page arguing for verifiable records
is the single most damaging detail this product could ship. Every real number in
this app is rendered by the app.

---

## A1 — The scroll sequence (highest value)

**What it is.** A 60-frame sequence the reader scrubs by scrolling. The section
pins for 300vh; scroll distance maps to frame index. Implemented in
`components/ScrollSequence.tsx`, already wired into the landing page.

**Subject.** A machined steel **intaglio engraving die** — the kind used to print
banknotes and share certificates — rotating slowly under a single raking light,
so the engraved guilloche lines catch the light and travel across the surface as
it turns.

**Why this subject.** It is a physical object whose entire purpose is
authentication. It is precise, industrial and expensive-looking without being
futuristic. The specular highlight travelling across engraved metal gives the
sequence real motion to scrub through — which is what makes scroll-driven frames
worth doing at all. And it contains no text, so it cannot fail the way generated
interfaces fail.

### Generate as VIDEO, then extract frames

Do **not** generate 60 separate images — they will not be consistent with one
another and the sequence will strobe. Generate one continuous shot and cut it up.

**Two constraints that decide whether this works**

1. **Under a quarter turn across the whole shot.** Scroll-scrubbing runs both
   directions, so the motion must be unmistakably monotonic. A full rotation of a
   near-symmetric disc looks identical at many frames and will visibly loop.
2. **Leave the left third empty and dark.** A scrim and the headline sit there.
   Compose the subject right of centre.

### The prompt

```
Extreme macro cinematography of a circular disc of polished tool steel lying
flat, its entire face densely covered with hair-fine engraved concentric
guilloche line-work — the precise interlaced geometric pattern found on banknotes
and share certificates, cut directly into the metal.

The disc rotates slowly and continuously, turning less than a quarter turn across
the entire shot: one smooth, unbroken, deliberate movement.

A single hard key light rakes across the surface from the upper left at a very
low angle. As the disc turns, a bright specular highlight sweeps slowly across
the engraved lines, lighting the pattern band by band and revealing the depth cut
into each groove. Everything outside the highlight falls into deep shadow. The
background is empty, unlit, near-black.

The disc sits slightly right of centre, leaving the left third of the frame in
empty shadow.

Materials: brushed and polished tool steel with faint concentric machining marks
and micro-scratches catching the light, a whisper of warm brass in the highlight.
Palette near-black, gunmetal, bone-white specular, faint warm cast — almost
monochrome.

Locked-off camera, no camera movement whatsoever, subject motion only. 100mm
macro lens at f/5.6, shallow depth of field with the disc centre sharpest, fine
natural film grain. Studio product cinematography in the style of high-end watch
and precision-instrument advertising. Slow, weighty, deliberate, silent.
```

**Negative prompt**

```
no text, no letters, no numbers, no numerals, no engraved words, no logos,
no watermarks, no UI, no screens, no interfaces, no charts, no graphs,
no people, no hands, no cryptocurrency, no coins, no bitcoin, no blockchain,
no circuit boards, no network graphics, no glowing lines, no neon, no lasers,
no holograms, no sci-fi, no cyberpunk, no purple, no blue tint, no rainbow
iridescence, no lens flare, no fast motion, no camera shake, no camera movement,
no cuts, no zoom, no full rotation, no spinning, no CGI plastic look,
no floating objects, no fantasy, no depth-of-field pulsing
```

**Settings**

| | |
|---|---|
| Duration | 6–8 seconds, one continuous take |
| Resolution | 1920 × 1080 minimum |
| Aspect | 16:9 |
| Camera | Locked off. Subject motion only. |

**Reject and regenerate if**

- It reads as a **coin** rather than an engraved plate — add "not a coin, not
  currency, a flat industrial engraving plate" to the prompt
- The pattern looks **printed on** rather than **cut into** the metal — push
  "deeply engraved grooves, visible relief, raking light"
- The camera moves, or it completes more than a quarter turn
- Any letterform, numeral or marking appears anywhere
- It goes iridescent, blue, or glossy-plastic

**Fallback subjects**, if the plate will not render convincingly — same lighting,
same motion, same palette:

1. A **steel banknote printing cylinder** rotating slowly under a raking light
2. A **flat engraved steel plate** with the light source travelling across it
   instead of the plate turning

**Extract the frames** (from the repo root):

```bash
# For a 7-second source. Adjust the numerator so 60 ÷ duration = the fps value.
ffmpeg -i die.mp4 \
  -vf "fps=60/7,scale=1920:-1" \
  -frames:v 60 \
  -c:v libwebp -quality 82 \
  frontend/public/sequence/evidence-%04d.webp

# Verify you got exactly 60
ls frontend/public/sequence/ | wc -l
```

If you end up with 59 or 61, nudge the fps fraction — the component tolerates a
missing frame (it holds the previous one) but the count should match `frameCount`
in `app/page.tsx`.

**Acceptance criteria**

- Exactly 60 files, `evidence-0001.webp` … `evidence-0060.webp`
- Total sequence weight under ~4 MB — drop `-quality` if not
- Scrubbing forwards and backwards looks continuous, no strobing
- The left third stays dark: a scrim sits there and copy sits over it
- No text anywhere in any frame

Nothing needs changing in code once these land — the component detects them.

---

## A2 — `ledger.jpg`

**Purpose.** The full-bleed rest point between the analytical sections.
**Placement.** `LedgerBand`, behind a left-to-right dark scrim
(`from-deep/92 via-deep/70 to-deep/25`) — **compose the interest on the right**.
**Dimensions.** 3000 × 1286 (21:9), JPEG q82, < 400 KB.
**File.** `frontend/public/plates/ledger.jpg`

```
Extreme macro photograph of aged accounting ledger paper, shot at a shallow
oblique angle. Fine horizontal ruling lines in faded grey-brown run across the
sheet and recede toward the upper right. The paper is warm ivory, slightly foxed
with age, with visible cotton fibre texture, a soft fold crease, and one gently
lifted edge catching the light. Raking low-angle daylight from the right grazes
the surface so the ruling lines and paper grain cast micro-shadows. Shallow
depth of field: the right-hand third is tack sharp, falling softly out of focus
toward the left. Muted warm neutral palette — ivory, bone, warm grey, deep umber
shadows. Still life, editorial, archival. Shot on a 100mm macro lens at f/4,
natural window light. Quiet, precise, restrained.
```

Plus the universal negative prompt below.

---

## A3 — `archive.jpg`

**Purpose.** Institutional weight behind the enforcement band, where the product
talks about slashing a bond.
**Placement.** Rendered at **25% opacity** under a gradient — **strong geometry
matters far more than fine detail.** Squint: the aisle must still read.
**Dimensions.** 2560 × 1440 (16:9), JPEG q80, < 350 KB.
**File.** `frontend/public/plates/archive.jpg`

```
Architectural photograph looking down a long aisle between tall archive shelves
filled with uniform bound ledger volumes and grey document boxes. Strict
one-point perspective, the aisle receding to a small pool of light at the far
end. A single shaft of hard daylight enters high on the left and rakes across
the spines, leaving most of the frame in deep shadow. Matte materials: cloth
binding, board, aged paper, dull steel shelving. Palette warm near-black, umber
and bone, almost monochrome. Deep true blacks in the foreground. Still, empty,
silent. Shot on a 35mm tilt-corrected lens, long exposure, natural light, fine
grain. Institutional, austere, permanent.
```

---

## A4 — `seal.jpg`

**Purpose.** Verification made physical, in the "Nothing here is a server's
word" column.
**Placement.** 4:3 at **max-width 300px** — the subject must survive at ~300 ×
225.
**Dimensions.** 1600 × 1200 (4:3), JPEG q85, < 250 KB.
**File.** `frontend/public/plates/seal.jpg`

**Not a wax seal** — wax reads medieval and kitsch. Intaglio guilloche is
precise, financial, and rhymes with the site's own fine-rule motif.

```
Extreme macro photograph of an intaglio-engraved guilloche rosette impressed
into heavy cotton certificate paper, of the kind used on share certificates and
banknotes. Hundreds of hair-fine engraved lines interlace into a precise
concentric geometric pattern. The engraving is physically embossed: ink sits
slightly raised and the paper is debossed around it, so raking light from the
upper left throws delicate relief shadows across every line. Ink is deep
near-black with the faintest cool-green undertone. Paper is warm ivory with
visible cotton fibre. Centred, filling the frame, very shallow depth of field
with the rosette centre tack sharp. Shot on a 100mm macro lens at f/5.6, single
diffused light source. Precise, technical, quietly beautiful.
```

---

## Universal negative prompt

Append to every still image:

```
no text, no letters, no numbers, no numerals, no handwriting, no typography,
no logos, no watermarks, no signatures, no UI, no screens, no monitors,
no people, no hands, no faces, no cryptocurrency, no coins, no blockchain,
no circuit boards, no network diagrams, no glowing nodes, no neon, no glow,
no lens flare, no bokeh balls, no holograms, no sci-fi, no cyberpunk,
no 3D render look, no CGI, no plastic surfaces, no purple, no blue tint,
no magenta, no oversaturation, no HDR halos, no vignette, no tilt-shift,
no fantasy, no medieval wax seals, no surrealism, no floating objects
```

---

## Installing

| Asset | Path | Then |
|---|---|---|
| A1 sequence | `frontend/public/sequence/evidence-0001…0060.webp` | nothing — auto-detected |
| A2 ledger | `frontend/public/plates/ledger.jpg` | set `ready: true` in `Plate.tsx` |
| A3 archive | `frontend/public/plates/archive.jpg` | set `ready: true` |
| A4 seal | `frontend/public/plates/seal.jpg` | set `ready: true` |

Until a flag is flipped, that plate renders a ruled-paper field drawn in CSS. The
sequence renders nothing at all if absent.

## Priority

**A1 first.** It is the piece that changes how the site feels, it occupies a full
viewport, and it is the one a judge will remember. A2–A4 are pacing.

## Deliberately not generated

- **Any interface, screen or dashboard.** The app renders its own.
- **Hero visual.** `ProvenanceChain` is real breach data and is the strongest
  element on the page; an image there would compete and lose.
- **People, offices, handshakes.** Clearbook has no consumer story, and stock
  humans would read as borrowed credibility.
- **Social card and favicon.** Rendered in code, so they cannot drift.
