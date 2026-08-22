import Image from 'next/image';

/**
 * A photographic plate.
 *
 * Clearbook's imagery is the material world of records: ledger paper, archives,
 * engraved seals, index cards. That is the one visual register that is both
 * genuinely on-theme (this product is a *book* of *evidence*) and completely
 * absent from every other project in this space — nobody photographs paper.
 *
 * Plates are atmosphere and pacing. They never carry information: no text is
 * rendered inside them, and removing one loses nothing but rhythm. That is why
 * they can be absent without the page breaking.
 *
 * Until the real files exist, `ready: false` makes a plate render as a fine
 * ruled-paper field drawn in CSS — deliberate rather than broken. Flip the flag
 * in `PLATES` once the asset is committed to `public/plates/`.
 */

export type PlateName = 'ledger' | 'archive' | 'seal';

interface PlateSpec {
  /** Set true once the file exists at public/plates/<file>. */
  ready: boolean;
  file: string;
  /** Described for screen readers; plates are decorative but not meaningless. */
  alt: string;
}

export const PLATES: Record<PlateName, PlateSpec> = {
  ledger: {
    ready: false,
    file: 'ledger.jpg',
    alt: 'Macro photograph of ruled ledger paper in raking light.',
  },
  archive: {
    ready: false,
    file: 'archive.jpg',
    alt: 'Archive stacks receding into shadow.',
  },
  seal: {
    ready: false,
    file: 'seal.jpg',
    alt: 'Macro photograph of an intaglio-engraved seal impressed into paper.',
  },
};

export function Plate({
  name,
  className = '',
  priority = false,
  tone = 'light',
}: {
  name: PlateName;
  className?: string;
  priority?: boolean;
  /** Which ground the plate sits on, so the fallback matches its surroundings. */
  tone?: 'light' | 'deep';
}) {
  const spec = PLATES[name];

  if (!spec.ready) {
    return (
      <div
        aria-hidden
        className={`plate-fallback ${tone === 'deep' ? 'plate-fallback-deep' : ''} ${className}`}
      />
    );
  }

  return (
    <div className={`relative overflow-hidden ${className}`}>
      <Image
        src={`/plates/${spec.file}`}
        alt={spec.alt}
        fill
        priority={priority}
        sizes="(max-width: 1024px) 100vw, 50vw"
        className="object-cover"
      />
    </div>
  );
}
