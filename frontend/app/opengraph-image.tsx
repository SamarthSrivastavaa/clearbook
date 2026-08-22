import { ImageResponse } from 'next/og';

/**
 * The social preview card.
 *
 * Rendered by the application rather than commissioned as an image, for the
 * same reason the landing page quotes real components instead of screenshots:
 * it cannot drift from the product, and it carries the actual design language
 * — deep ground, the provenance rail, one accent.
 *
 * Deliberately not an illustration. A link to this project should preview as a
 * record, not as artwork.
 */
export const alt = 'Clearbook — evidence-bound covenant compliance on Creditcoin';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const DEEP = '#14130f';
const ON_DEEP = '#f2f0ea';
const ON_DEEP_MUTED = '#9b978c';
const RULE = '#2e2c25';
const VERIFIED = '#5f9d97';
const BREACH = '#e0836f';

/** One node on the rail, with its label. */
function Step({ label, tone }: { label: string; tone: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
      <div style={{ width: 12, height: 12, background: tone }} />
      <div style={{ fontSize: 24, color: ON_DEEP_MUTED, letterSpacing: -0.2 }}>{label}</div>
    </div>
  );
}

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: DEEP,
          padding: '64px 72px',
        }}
      >
        {/* wordmark */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ width: 4, height: 14, background: VERIFIED }} />
            <div style={{ width: 4, height: 14, background: RULE }} />
          </div>
          <div style={{ fontSize: 30, color: ON_DEEP, fontWeight: 600, letterSpacing: -0.6 }}>
            Clearbook
          </div>
          <div
            style={{
              fontSize: 18,
              color: ON_DEEP_MUTED,
              letterSpacing: 3,
              textTransform: 'uppercase',
              marginLeft: 8,
            }}
          >
            Evidence-bound credit
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexDirection: 'column', maxWidth: 660 }}>
            <div
              style={{
                fontSize: 68,
                lineHeight: 1.04,
                color: ON_DEEP,
                fontWeight: 600,
                letterSpacing: -2.4,
              }}
            >
              A loan book that can be proven wrong.
            </div>
            <div style={{ fontSize: 26, color: ON_DEEP_MUTED, marginTop: 26, lineHeight: 1.4 }}>
              Every claim cites a cryptographically verified transfer on another chain. Anyone can
              prove a covenant breach — and be paid for it.
            </div>
          </div>

          {/* the rail: the product's whole sequence, in five marks */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22, paddingBottom: 8 }}>
            <Step label="Source-chain transfer" tone={VERIFIED} />
            <Step label="Attested block" tone={VERIFIED} />
            <Step label="Precompile verifies" tone={VERIFIED} />
            <Step label="Covenant evaluated" tone={BREACH} />
            <Step label="Bond slashed" tone={BREACH} />
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            borderTop: `1px solid ${RULE}`,
            paddingTop: 24,
            fontSize: 20,
            color: ON_DEEP_MUTED,
          }}
        >
          <div>Creditcoin CC3 · Block Prover precompile 0x…0FD2</div>
          <div>Deployed on Ethereum: nothing</div>
        </div>
      </div>
    ),
    size,
  );
}
