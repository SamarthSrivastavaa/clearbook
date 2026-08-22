import { ImageResponse } from 'next/og';

/**
 * The favicon: the provenance rail, reduced to two marks.
 *
 * At 32px there is room for exactly one idea. The rail is the product's motif —
 * one thing causing the next — so it is the mark: a verified node above, a
 * breach node below, joined by the rule between them.
 */
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#14130f',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div style={{ width: 9, height: 9, background: '#5f9d97' }} />
          <div style={{ width: 2, height: 7, background: '#4a4638' }} />
          <div style={{ width: 9, height: 9, background: '#e0836f' }} />
        </div>
      </div>
    ),
    size,
  );
}
