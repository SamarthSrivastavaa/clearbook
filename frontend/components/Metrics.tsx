import { Eyebrow } from '@/components/ui';

/**
 * A band of live figures.
 *
 * Deliberately a band and not a loose row. Free-floating figures with optional
 * sub-labels produced a ragged baseline — some columns two lines tall, some one
 * — and column widths that varied with the length of the value, which read as
 * numbers scattered on a page rather than an instrument panel.
 *
 * So: equal columns on a rule above and below, every figure on one baseline.
 * Any qualifier belongs in the label rather than underneath it, because a
 * second line under some cells and not others is exactly what broke the
 * alignment. Structure comes from the rules and the grid, not from dividers
 * between cells — those misplace themselves the moment the grid wraps.
 */

export interface Metric {
  label: string;
  value: string;
  /** Semantic state only — never decoration, and never a ranking. */
  tone?: 'breach' | 'pending';
}

/**
 * Written out rather than interpolated: Tailwind scans source for literal class
 * names, and a template string would not survive the build.
 */
const COLUMNS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-2 sm:grid-cols-3',
  4: 'grid-cols-2 sm:grid-cols-4',
  5: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5',
  6: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6',
};

export function MetricBand({ metrics }: { metrics: Metric[] }) {
  const cols = COLUMNS[metrics.length] ?? 'grid-cols-2 sm:grid-cols-3';

  return (
    <dl className={`mt-8 grid gap-y-6 border-y border-rule py-5 ${cols}`}>
      {metrics.map((m) => (
        <div key={m.label} className="min-w-0 pr-6">
          <dt>
            <Eyebrow>{m.label}</Eyebrow>
          </dt>
          <dd
            className={`tnum mt-2 truncate text-[27px] font-semibold leading-none tracking-tight ${
              m.tone === 'breach' ? 'text-breach' : m.tone === 'pending' ? 'text-pending' : ''
            }`}
          >
            {m.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
