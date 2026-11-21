/** The list view: the decision table for the selected day, the accessible twin of the globe. */
import { Link } from 'react-router-dom';

import { Table, TableWrap, Td, Th, Tr } from '@x10/shared/ui';

import { CallMark, ProbText } from '../components/bits';
import { ICE_LABEL } from '../config';
import { nameOf, type SiteDay } from '../domain/desk';
import { dayLong } from '../domain/time';
import type { Person } from '@x10/shared/identity';

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

export function GlobeList({ cells, day, meanSnow, people, selectedId, dimmed }: { cells: SiteDay[]; day: string; meanSnow: number; people: Person[]; selectedId: string | null; dimmed: Set<string> }) {
  return (
    <section data-testid="globe-list" data-day={day} data-snow-cm={meanSnow.toFixed(1)}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0 text-base font-semibold">{dayLong(day)}</h2>
        <span className="font-mono text-xs text-muted num" data-testid="list-mean-snow">
          Mean forecast snow {fmt(Math.round(meanSnow * 10) / 10)} cm
        </span>
      </div>
      <TableWrap label={`Decisions for ${dayLong(day)}`}>
        <Table density="compact" stickyHeader>
          <thead>
            <tr>
              <Th>Site</Th>
              <Th className="max-md:hidden">Region</Th>
              <Th numeric>Snow cm</Th>
              <Th numeric className="max-md:hidden">Min °C</Th>
              <Th numeric className="max-md:hidden">Wind km/h</Th>
              <Th className="max-md:hidden">Ice</Th>
              <Th numeric>Closure</Th>
              <Th>Call</Th>
              <Th className="max-lg:hidden">Reason</Th>
            </tr>
          </thead>
          <tbody>
            {cells.map((c) => (
              <Tr key={c.site.id} selected={c.site.id === selectedId} className={dimmed.has(c.site.id) ? 'opacity-55' : undefined} data-testid="list-row" data-site={c.site.name}>
                <Td>
                  <Link to={`/call?site=${c.site.id}&day=${day}`} className="font-medium text-fg hover:underline">
                    {c.site.name}
                  </Link>
                  <span className="block text-xs text-muted md:hidden">{c.site.region}</span>
                </Td>
                <Td muted className="max-md:hidden">
                  {c.site.region}
                </Td>
                <Td numeric data-testid="list-snow">
                  {c.forecast ? fmt(c.forecast.snowCm) : <span className="text-warn-text">none</span>}
                </Td>
                <Td numeric className="max-md:hidden">
                  {c.forecast ? fmt(c.forecast.tempMinC) : '—'}
                </Td>
                <Td numeric className="max-md:hidden">
                  {c.forecast ? fmt(c.forecast.windKmh) : '—'}
                </Td>
                <Td className="max-md:hidden">{c.forecast ? ICE_LABEL[c.forecast.iceRisk] : '—'}</Td>
                <Td numeric>
                  <ProbText p={c.probability} />
                </Td>
                <Td>
                  <CallMark call={c.decision?.call ?? null} muted={!c.decision} />
                  {c.against && <span className="mt-0.5 block text-xs font-medium text-[var(--magenta-11)]">Against the model</span>}
                </Td>
                <Td className="max-w-[340px] max-lg:hidden">
                  {c.decision ? (
                    <>
                      <span className="line-clamp-2 text-ui">{c.decision.reason}</span>
                      <span className="text-xs text-muted">{nameOf(people, c.decision.decidedBy)}</span>
                    </>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>
    </section>
  );
}
