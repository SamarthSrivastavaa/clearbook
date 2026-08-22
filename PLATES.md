# Clearbook — photographic plates

Production briefs for the three generated assets the landing page expects.

## The visual direction, and why

Clearbook's imagery is **the material world of financial records**: ruled ledger
paper, archive stacks, intaglio security engraving.

This is chosen, not defaulted into. It is the one register that is

- **literally on-theme** — the product is a *book* of *evidence*, and its whole
  argument is about records that can be checked;
- **warm and human**, which the interface needs and its typography cannot supply
  on its own;
- **completely absent from this category.** Every other project in this space
  ships glowing nodes, floating cubes and neon gradients. Nobody photographs
  paper. That alone makes it memorable.

Plates are **atmosphere and pacing only**. They never carry information, they
contain no text, and removing one costs nothing but rhythm. That is deliberate:
the page must never depend on an image to be understood.

## Palette to match

| Token | Hex | Role in the image |
|---|---|---|
| paper | `#fbfaf8` | warm highlight |
| sunken | `#f4f2ee` | mid tone |
| rule | `#e4e1d9` | fine line |
| ink | `#17160f` | near-black shadow |
| deep | `#14130f` | ground on dark bands |
| accent | `#0e4b4b` | deep teal — at most a trace |

**Warm neutrals only.** No blue cast, no magenta, no teal wash — the accent is a
UI colour, not a lighting gel. If the render looks cool-toned, it is wrong.

## Universal negative prompt

Append to every generation:

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

The "no text / no numerals" exclusion is not stylistic. Generated letterforms
are reliably broken, and broken letterforms on a page about verifiable records
would be the single most damaging detail in the product.

---

# Plate 1 — `ledger.jpg`

**Purpose.** The page's rest point. It sits between the three-registers section
and the covenant, breaking a long analytical run with one full-bleed image and a
single sentence.

**Placement.** Full-bleed band, `LedgerBand` in `app/page.tsx`. A left-to-right
dark scrim is applied in CSS (`from-deep/92 via-deep/70 to-deep/25`), so **the
left third will be almost black** and the right third nearly clean. Compose the
interest on the **right and centre-right**.

**Dimensions.** 3000 × 1286 (21:9). Export JPEG q82, target < 400 KB.

**Prompt**

```
Extreme macro photograph of aged accounting ledger paper, shot at a shallow
oblique angle. Fine horizontal ruling lines in faded grey-brown run across the
sheet and recede toward the upper right. The paper is warm ivory, slightly
foxed with age, with visible cotton fibre texture, a soft fold crease, and one
gently lifted edge catching the light. Raking low-angle daylight from the right
grazes the surface, so the ruling lines and paper grain cast micro-shadows and
the tooth of the sheet is clearly readable. Shallow depth of field: the
right-hand third is tack sharp, falling softly out of focus toward the left.
Muted warm neutral palette — ivory, bone, warm grey, deep umber shadows. Still
life, editorial, archival. Shot on a 100mm macro lens at f/4, natural window
light, no artificial lighting. Quiet, precise, restrained.
```

**Acceptance criteria**

- No legible writing anywhere — ruling lines only
- Warm, not grey-blue; the highlight should read close to `#fbfaf8`
- Detail concentrated right-of-centre; left third can be near-empty
- Reads as photographed paper, not as a texture pack or a 3D render

---

# Plate 2 — `archive.jpg`

**Purpose.** Institutional weight behind the enforcement band. This is the
moment the product talks about slashing a bond, and the ground beneath it should
feel permanent.

**Placement.** Absolute background of the `Enforcement` dark band, rendered at
**25% opacity** under a `deep` gradient. It will read as structure and shadow,
not as a picture — so **strong geometry and high contrast matter far more than
fine detail.**

**Dimensions.** 2560 × 1440 (16:9). Export JPEG q80, target < 350 KB.

**Prompt**

```
Architectural photograph looking down a long aisle between tall archive shelves
filled with uniform bound ledger volumes and grey document boxes. Strict
one-point perspective, the aisle receding to a small pool of light at the far
end. A single shaft of hard daylight enters from high on the left and rakes
across the spines, leaving most of the frame in deep shadow. Materials are
matte: cloth binding, board, aged paper, dull steel shelving. Palette is warm
near-black, umber and bone — almost monochrome. Deep pools of black in the
foreground. Still, empty, silent. Shot on a 35mm tilt-corrected lens, long
exposure, natural light only, fine grain. Institutional, austere, permanent.
```

**Acceptance criteria**

- Legible structure at 25% opacity — squint: the aisle must still read
- Deep true blacks, not lifted grey
- Absolutely no people
- Not a modern open-plan office and not a library reading room

---

# Plate 3 — `seal.jpg`

**Purpose.** Verification made physical. It sits in the "Nothing here is a
server's word" section — the passage about proof rather than assertion — and
fills that column's dead space.

**Placement.** `Foundation` left column, 4:3, max-width 300px. It renders
**small**, so the subject must survive at roughly 300 × 225.

**Dimensions.** 1600 × 1200 (4:3). Export JPEG q85, target < 250 KB.

**Note on subject.** This is **intaglio guilloché** — the fine interlaced
line-work engraved on banknotes and share certificates — *not* a wax seal. Wax
reads medieval and kitsch. Guilloché is precise, financial, security-coded, and
it rhymes with Clearbook's own fine-rule visual motif.

**Prompt**

```
Extreme macro photograph of an intaglio-engraved guilloche rosette impressed
into heavy cotton certificate paper, of the kind used on share certificates and
banknotes. Hundreds of hair-fine engraved lines interlace into a precise
concentric geometric pattern. The engraving is physically embossed: the ink
sits slightly raised and the paper is debossed around it, so raking light from
the upper left throws delicate relief shadows across every line. Ink is deep
near-black with the faintest cool-green undertone. Paper is warm ivory with
visible cotton fibre. Centred composition, filling the frame, very shallow
depth of field with the centre of the rosette tack sharp. Shot on a 100mm
macro lens at f/5.6, single diffused light source, natural. Precise, technical,
quietly beautiful.
```

**Acceptance criteria**

- Pattern still legible when scaled to 300px wide
- Physical relief visible — must read as pressed into paper, not printed flat
- Ink near-black; at most a *trace* of `#0e4b4b` green, never a teal wash
- Geometric and mechanical, never organic, floral or hand-drawn

---

# Installing them

1. Save as `frontend/public/plates/ledger.jpg`, `archive.jpg`, `seal.jpg`
2. In `frontend/components/Plate.tsx`, flip `ready: false` → `ready: true` for
   each plate that now has a file

That is the whole integration. Until a flag is flipped, that plate renders a
ruled-paper field drawn in CSS — deliberate rather than broken — so the page is
never in a bad state mid-production, and you can land them one at a time.

## Deliberately not generated

- **Hero visual.** The `ProvenanceChain` is real breach data and is the
  strongest element on the page. An image there would compete with it and lose.
- **Social card and favicon.** Rendered in code by `opengraph-image.tsx` and
  `icon.tsx`, so they carry the real design language and cannot drift.
- **Claim / evidence / condition panels.** Real components. Screenshots or
  illustrations would go stale the moment the app changed.
- **People and offices.** Clearbook has no consumer story. Stock-feeling
  lifestyle photography would read as borrowed credibility, which is the exact
  opposite of what this product argues for.

Three plates is the right number. A fourth would start decorating.
