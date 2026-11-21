/**
 * Weather station: the five-day outlook per site (every forecast the desk has), logging a forecast, importing a CSV
 * from the forecast service, and the site register. Site leads write for their own sites; the duty manager for all.
 */
import { useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CloudSnow, Download, FileUp, MapPin, Pencil, Plus, Upload } from 'lucide-react';

import { useApp } from '@x10/shared/runtime';
import { downloadText, toCsv, useAction, useAsync, usePolling } from '@x10/shared/lib';
import type { Person } from '@x10/shared/identity';
import {
  Button,
  Callout,
  cx,
  DataState,
  Dialog,
  EmptyState,
  Field,
  Input,
  PageHeader,
  SegmentedControl,
  Select,
  Skeleton,
  Table,
  TableWrap,
  Tabs,
  Td,
  TextArea,
  Th,
  Toast,
  Tr,
} from '@x10/shared/ui';

import { EXPOSURE_LABEL, ICE_LABEL, ROAD_LABEL } from '../config';
import {
  canReport,
  CSV_HEADERS,
  importForecasts,
  logForecast,
  parseForecastCsv,
  saveSite,
  validateForecast,
  validateSite,
  type ForecastErrors,
  type ForecastInput,
  type SiteInput,
} from '../domain/actions';
import { loadDesk } from '../domain/actions';
import { type Desk } from '../domain/desk';
import { addDaysKey, dayLong, dayRelative, dayShort, dayWeekday, type DayKey } from '../domain/time';
import { limits, EXPOSURES, ICE_RISKS, ROAD_CLASSES, type IceRisk, type Schema, type Site } from '../model';

type Tab = 'outlook' | 'import' | 'sites';
const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const ICE_TOKEN: Record<IceRisk, string> = { low: '--jade-8', medium: '--amber-9', high: '--crimson-9' };

export function StationPage() {
  const { store } = useApp<Schema>();
  const desk = useAsync(() => loadDesk(store, new Date()), [store]);
  usePolling(desk.reload, 5000);
  return (
    <DataState
      state={desk}
      skeleton={
        <div>
          <Skeleton height={36} width={260} />
          <Skeleton height={40} className="mt-6" />
          <Skeleton height={440} className="mt-4" />
        </div>
      }
    >
      {(d) => <Station desk={d} reload={desk.reload} />}
    </DataState>
  );
}

function Station({ desk, reload }: { desk: Desk; reload: () => Promise<void> }) {
  const { me, isAdmin } = useApp<Schema>();
  const [params, setParams] = useSearchParams();
  const tab = (['outlook', 'import', 'sites'].includes(params.get('tab') ?? '') ? params.get('tab') : 'outlook') as Tab;
  const [editing, setEditing] = useState<{ siteId: string; day: DayKey } | null>(() => {
    const site = params.get('site');
    const day = params.get('day');
    return site && desk.sites.some((s) => s.id === site) ? { siteId: site, day: day ?? desk.deskDay } : null;
  });
  const [toast, setToast] = useState<string | null>(null);
  const mine = desk.sites.filter((s) => canReport(me, s));
  const missing = desk.sites.reduce((n, s) => n + desk.days.filter((d) => !desk.cell(s.id, d).forecast).length, 0);
  const setTab = (t: Tab) => {
    const p = new URLSearchParams(params);
    p.set('tab', t);
    p.delete('site');
    p.delete('day');
    setParams(p, { replace: true });
  };

  return (
    <>
      <PageHeader
        title="Weather station"
        meta={
          <span className="text-ui text-muted num">
            Five days from {dayLong(desk.deskDay)} · {missing ? `${missing} forecast${missing === 1 ? '' : 's'} missing` : 'every site forecast'}
          </span>
        }
        actions={
          mine.length ? (
            <Button variant="primary" icon={<Plus />} onClick={() => setEditing({ siteId: mine[0].id, day: desk.deskDay })}>
              Log forecast
            </Button>
          ) : undefined
        }
      />
      <Tabs
        label="Weather station"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'outlook', label: 'Outlook' },
          { value: 'import', label: 'Import CSV' },
          { value: 'sites', label: 'Sites', count: desk.sites.length },
        ]}
        className="mb-5"
      />
      {tab === 'outlook' && <Outlook desk={desk} me={me} onEdit={setEditing} />}
      {tab === 'import' && <Importer desk={desk} onDone={async (msg) => { setToast(msg); await reload(); }} />}
      {tab === 'sites' && <Sites desk={desk} isAdmin={isAdmin} onSaved={async (msg) => { setToast(msg); await reload(); }} />}
      {editing && (
        <ForecastDialog
          desk={desk}
          sites={mine}
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={async (msg) => {
            setEditing(null);
            setToast(msg);
            await reload();
          }}
        />
      )}
      <Toast message={toast} tone="ok" onDone={() => setToast(null)} />
    </>
  );
}

/* ------------------------------------------------------------------ outlook */

function Outlook({ desk, me, onEdit }: { desk: Desk; me: Person; onEdit(v: { siteId: string; day: DayKey }): void }) {
  if (!desk.sites.length)
    return (
      <EmptyState icon={<MapPin />} title="No sites yet">
        Add sites on the Sites tab, then log their forecasts here.
      </EmptyState>
    );
  const maxSnow = Math.max(10, ...desk.sites.flatMap((s) => desk.days.map((d) => desk.cell(s.id, d).forecast?.snowCm ?? 0)));
  return (
    <>
    <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted" aria-hidden="true">
      <span>Snow in cm, then minimum temperature and wind.</span>
      {ICE_RISKS.map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: `var(${ICE_TOKEN[k]})` }} />
          {ICE_LABEL[k]} ice
        </span>
      ))}
    </div>
    <TableWrap label="Five-day outlook">
      <Table density="compact" stickyHeader className="min-w-[760px]" data-testid="outlook">
        <thead>
          <tr>
            <Th className="w-[210px]">Site</Th>
            {desk.days.map((d) => (
              <Th key={d} className="text-left">
                <span className="block text-fg">{dayRelative(d, desk.today) === 'Today' || dayRelative(d, desk.today) === 'Tomorrow' ? dayRelative(d, desk.today) : dayWeekday(d)}</span>
                <span className="font-mono text-[11px] font-normal text-muted">{dayShort(d)}</span>
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {desk.regions.map((region) => (
            <RegionRows key={region} desk={desk} region={region} me={me} maxSnow={maxSnow} onEdit={onEdit} />
          ))}
        </tbody>
      </Table>
    </TableWrap>
    </>
  );
}

function RegionRows({ desk, region, me, maxSnow, onEdit }: { desk: Desk; region: string; me: Person; maxSnow: number; onEdit(v: { siteId: string; day: DayKey }): void }) {
  const sites = desk.sites.filter((s) => s.region === region);
  return (
    <>
      <tr>
        <td colSpan={desk.days.length + 1} className="bg-surface-sunken px-3 py-1.5">
          <span className="x-legend-label text-[10.5px] text-muted">{region}</span>
        </td>
      </tr>
      {sites.map((s) => {
        const can = canReport(me, s);
        return (
          <Tr key={s.id} data-testid="outlook-row" data-site={s.name}>
            <Td>
              <span className="block font-medium">{s.name}</span>
              <span className="text-xs text-muted">{s.leadName ?? 'No lead'}</span>
            </Td>
            {desk.days.map((d) => {
              const f = desk.cell(s.id, d).forecast;
              const label = `${s.name}, ${dayLong(d)}: ${f ? `${fmt(f.snowCm)} cm, ${fmt(f.tempMinC)} °C, ${fmt(f.windKmh)} km/h, ${f.iceRisk} ice` : 'no forecast'}`;
              const inner = f ? (
                <span className="grid gap-1">
                  <span className="flex items-baseline gap-1">
                    <span className="font-mono text-base font-semibold num">{fmt(f.snowCm)}</span>
                    <span className="text-[11px] text-muted">cm</span>
                    <span className="ml-auto inline-block size-2 rounded-full" style={{ background: `var(${ICE_TOKEN[f.iceRisk]})` }} title={`${ICE_LABEL[f.iceRisk]} ice risk`} />
                  </span>
                  <span className="block h-1 overflow-hidden rounded-full bg-gray-3">
                    <span className="block h-full rounded-full bg-[var(--sky-9)]" style={{ width: `${Math.max(f.snowCm > 0 ? 4 : 0, (f.snowCm / maxSnow) * 100)}%` }} />
                  </span>
                  <span className="text-left font-mono text-[11px] text-muted">
                    {fmt(f.tempMinC)}° · {fmt(f.windKmh)} km/h
                  </span>
                </span>
              ) : (
                <span className="flex h-[52px] flex-col justify-center text-ui font-medium text-warn-text">
                  No forecast
                  {can && <span className="text-xs font-normal text-muted">Log it</span>}
                </span>
              );
              return (
                <Td key={d} className="p-1!">
                  {can ? (
                    <button
                      type="button"
                      aria-label={`${label}. ${f ? 'Update' : 'Log'} forecast`}
                      onClick={() => onEdit({ siteId: s.id, day: d })}
                      className={cx('x-tap block w-full min-w-[104px] cursor-pointer rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--row-hover)]', !f && 'border border-dashed border-[var(--warn-line)]')}
                    >
                      {inner}
                    </button>
                  ) : (
                    <span aria-label={label} className={cx('block min-w-[104px] rounded-lg px-2 py-1.5', !f && 'border border-dashed border-line')}>
                      {inner}
                    </span>
                  )}
                </Td>
              );
            })}
          </Tr>
        );
      })}
    </>
  );
}

/* ------------------------------------------------------------------ log a forecast */

function ForecastDialog({ desk, sites, initial, onClose, onSaved }: { desk: Desk; sites: Site[]; initial: { siteId: string; day: DayKey }; onClose(): void; onSaved(msg: string): void }) {
  const { store, me } = useApp<Schema>();
  const startSite = sites.some((s) => s.id === initial.siteId) ? initial.siteId : (sites[0]?.id ?? '');
  const existing = desk.cell(startSite, initial.day).forecast;
  const [v, setV] = useState({
    siteId: startSite,
    day: initial.day,
    snowCm: existing ? String(existing.snowCm) : '',
    tempMinC: existing ? String(existing.tempMinC) : '',
    windKmh: existing ? String(existing.windKmh) : '',
    iceRisk: (existing?.iceRisk ?? 'low') as IceRisk,
    source: existing?.source ?? '',
  });
  const [errors, setErrors] = useState<ForecastErrors>({});
  const action = useAction(logForecast);
  const dayChoices = [addDaysKey(desk.deskDay, -1), ...desk.days];
  const toInput = (): ForecastInput => ({
    siteId: v.siteId,
    day: v.day,
    snowCm: v.snowCm.trim() === '' ? Number.NaN : Number(v.snowCm),
    tempMinC: v.tempMinC.trim() === '' ? Number.NaN : Number(v.tempMinC),
    windKmh: v.windKmh.trim() === '' ? Number.NaN : Number(v.windKmh),
    iceRisk: v.iceRisk,
    source: v.source,
  });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const input = toInput();
    const errs = validateForecast(input, desk.today);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const r = await action.run(store, me, input, new Date());
    if (r) onSaved(`Forecast logged for ${sites.find((s) => s.id === v.siteId)?.name}, ${dayRelative(v.day, desk.today).toLowerCase()}.`);
  };
  if (!sites.length) return null;
  const site = sites.find((s) => s.id === v.siteId);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Log forecast"
      description={site ? `${site.name} · ${dayLong(v.day)}` : undefined}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="forecast-form" busy={action.pending} icon={<CloudSnow />}>
            Log forecast
          </Button>
        </>
      }
    >
      <form id="forecast-form" onSubmit={(e) => void submit(e)} noValidate>
        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field label="Site" htmlFor="f-site" error={errors.siteId}>
            <Select id="f-site" value={v.siteId} onChange={(e) => setV({ ...v, siteId: e.target.value })}>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Day" htmlFor="f-day" error={errors.day}>
            <Select id="f-day" value={v.day} onChange={(e) => setV({ ...v, day: e.target.value })}>
              {dayChoices.map((d) => (
                <option key={d} value={d}>
                  {dayRelative(d, desk.today)} · {dayShort(d)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Snow (cm)" htmlFor="f-snow" error={errors.snowCm}>
            <Input id="f-snow" inputMode="decimal" type="number" step="0.5" min={0} max={limits.snowCm.max} value={v.snowCm} onChange={(e) => setV({ ...v, snowCm: e.target.value })} invalid={!!errors.snowCm} className="font-mono" />
          </Field>
          <Field label="Minimum temperature (°C)" htmlFor="f-temp" error={errors.tempMinC}>
            <Input id="f-temp" inputMode="decimal" type="number" step="0.5" value={v.tempMinC} onChange={(e) => setV({ ...v, tempMinC: e.target.value })} invalid={!!errors.tempMinC} className="font-mono" />
          </Field>
          <Field label="Wind (km/h)" htmlFor="f-wind" error={errors.windKmh}>
            <Input id="f-wind" inputMode="decimal" type="number" step="1" min={0} value={v.windKmh} onChange={(e) => setV({ ...v, windKmh: e.target.value })} invalid={!!errors.windKmh} className="font-mono" />
          </Field>
          <Field label="Source" htmlFor="f-source" error={errors.source} counter={{ value: v.source.trim().length, max: limits.source.max }}>
            <Input id="f-source" value={v.source} onChange={(e) => setV({ ...v, source: e.target.value })} placeholder="Met service 04:00 run" invalid={!!errors.source} />
          </Field>
        </div>
        <div className="mb-4">
          <div className="mb-1.5 text-ui font-medium" id="f-ice-label">
            Ice risk
          </div>
          <SegmentedControl label="Ice risk" value={v.iceRisk} onChange={(x) => setV({ ...v, iceRisk: x })} options={ICE_RISKS.map((k) => ({ value: k, label: ICE_LABEL[k] }))} />
        </div>
        {action.error && <p role="alert" className="m-0 text-ui font-medium text-bad">{action.error.message}</p>}
      </form>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ CSV import */

function Importer({ desk, onDone }: { desk: Desk; onDone(msg: string): Promise<void> }) {
  const { store, me } = useApp<Schema>();
  const [text, setText] = useState('');
  const action = useAction(importForecasts);
  const parsed = useMemo(() => (text.trim() ? parseForecastCsv(text, desk.sites, desk.today, (s) => canReport(me, s)) : null), [text, desk, me]);
  const good = parsed?.rows.filter((r) => r.input).length ?? 0;
  const template = () =>
    downloadText(
      'snow-day-forecasts.csv',
      toCsv(
        [...CSV_HEADERS],
        desk.sites.filter((s) => canReport(me, s)).flatMap((s) => desk.days.slice(0, 2).map((d) => [s.name, d, '', '', '', 'low', 'Met service'])),
      ),
    );
  const onFile = async (file: File | undefined) => {
    if (file) setText(await file.text());
  };
  const run = async () => {
    const r = await action.run(store, me, text, new Date());
    if (!r) return;
    setText('');
    await onDone(`Imported ${r.imported} forecast${r.imported === 1 ? '' : 's'}${r.skipped.length ? `; ${r.skipped.length} row${r.skipped.length === 1 ? '' : 's'} skipped` : ''}.`);
  };
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <div>
        <Field label="Paste the CSV" htmlFor="csv-text" hint={
            <>
              Columns: {CSV_HEADERS.join(', ')}. Sites by name; days as YYYY-MM-DD, from{' '}
              <span className="font-mono" data-testid="import-day-hint" data-day={desk.deskDay}>
                {desk.deskDay}
              </span>
              .
            </>
          }>
          <TextArea id="csv-text" rows={10} value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-xs!" placeholder={`${CSV_HEADERS.join(',')}\nSummit Primary,${desk.deskDay},12,-6.5,44,medium,Met service`} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <label className="x-tap inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-line-strong px-3 text-ui hover:bg-[var(--row-hover)]">
            <FileUp className="size-4" aria-hidden="true" />
            Choose a file
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
          </label>
          <Button variant="ghost" icon={<Download />} onClick={template}>
            Template
          </Button>
        </div>
      </div>
      <div>
        {!parsed ? (
          <EmptyState icon={<Upload />} title="Nothing to import yet" bordered>
            Paste rows from the forecast service or choose a file; every row is checked before anything is saved.
          </EmptyState>
        ) : parsed.headerError ? (
          <Callout tone="bad" title="The file cannot be read">
            {parsed.headerError}
          </Callout>
        ) : (
          <>
            <TableWrap label="Import preview" maxHeight={420}>
              <Table density="compact" stickyHeader data-testid="import-preview">
                <thead>
                  <tr>
                    <Th numeric>Line</Th>
                    <Th>Site</Th>
                    <Th>Day</Th>
                    <Th numeric>Snow</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.rows.map((r) => (
                    <Tr key={r.line} data-testid="import-row" data-ok={r.input ? 'true' : 'false'}>
                      <Td numeric>{r.line}</Td>
                      <Td>{r.siteName || '—'}</Td>
                      <Td className="font-mono text-xs">{r.input?.day ?? '—'}</Td>
                      <Td numeric>{r.input ? fmt(r.input.snowCm) : '—'}</Td>
                      <Td>
                        <span className={cx('inline-flex items-start gap-1.5 text-ui', r.input ? 'text-ok-text' : 'text-bad-text')}>
                          <span aria-hidden="true" className={cx('mt-1.5 size-2 shrink-0 rounded-full', r.input ? 'bg-ok-solid' : 'bg-bad-solid')} />
                          {r.input ? 'Ready' : r.error}
                        </span>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
            {action.error && <p role="alert" className="m-0 mt-2 text-ui font-medium text-bad">{action.error.message}</p>}
            <div className="mt-3 flex items-center justify-end gap-3">
              <span className="text-ui text-muted num">
                {good} of {parsed.rows.length} ready
              </span>
              <Button variant="primary" icon={<Upload />} disabled={!good} busy={action.pending} onClick={() => void run()}>
                Import {good} row{good === 1 ? '' : 's'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ sites */

function Sites({ desk, isAdmin, onSaved }: { desk: Desk; isAdmin: boolean; onSaved(msg: string): Promise<void> }) {
  const [editing, setEditing] = useState<Site | 'new' | null>(null);
  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-ui text-muted">{isAdmin ? 'Only the duty manager adds or edits sites.' : 'Read only: the duty manager keeps the site register.'}</span>
        {isAdmin && (
          <Button icon={<Plus />} onClick={() => setEditing('new')}>
            Add site
          </Button>
        )}
      </div>
      {desk.sites.length === 0 ? (
        <EmptyState icon={<MapPin />} title="No sites yet" action={isAdmin ? <Button variant="primary" icon={<Plus />} onClick={() => setEditing('new')}>Add site</Button> : undefined}>
          Each site becomes a building in the globe.
        </EmptyState>
      ) : (
        <TableWrap label="Sites">
          <Table density="compact" data-testid="sites-table">
            <thead>
              <tr>
                <Th>Site</Th>
                <Th>Region</Th>
                <Th numeric>Elevation m</Th>
                <Th className="max-md:hidden">Exposure</Th>
                <Th className="max-md:hidden">Road</Th>
                <Th className="max-md:hidden">Lead</Th>
                <Th className="max-lg:hidden">Time zone</Th>
                {isAdmin && <Th className="w-12"><span className="sr-only">Edit</span></Th>}
              </tr>
            </thead>
            <tbody>
              {desk.sites.map((s) => (
                <Tr key={s.id}>
                  <Td className="font-medium">{s.name}</Td>
                  <Td muted>{s.region}</Td>
                  <Td numeric>{s.elevation}</Td>
                  <Td className="max-md:hidden">{EXPOSURE_LABEL[s.exposure]}</Td>
                  <Td className="max-md:hidden">{ROAD_LABEL[s.roadClass]}</Td>
                  <Td className="max-md:hidden">{s.leadName ?? <span className="text-muted">—</span>}</Td>
                  <Td className="font-mono text-xs max-lg:hidden">{s.timeZone ?? <span className="text-muted">Desk ({desk.tz})</span>}</Td>
                  {isAdmin && (
                    <Td>
                      <Button size="sm" variant="ghost" icon={<Pencil />} aria-label={`Edit ${s.name}`} onClick={() => setEditing(s)} />
                    </Td>
                  )}
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
      {editing && (
        <SiteDialog
          desk={desk}
          site={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async (msg) => {
            setEditing(null);
            await onSaved(msg);
          }}
        />
      )}
    </>
  );
}

function SiteDialog({ desk, site, onClose, onSaved }: { desk: Desk; site: Site | null; onClose(): void; onSaved(msg: string): Promise<void> }) {
  const { store, me } = useApp<Schema>();
  const [v, setV] = useState({
    name: site?.name ?? '',
    region: site?.region ?? desk.regions[0] ?? '',
    elevation: site ? String(site.elevation) : '',
    exposure: site?.exposure ?? 'normal',
    roadClass: site?.roadClass ?? 'main',
    leadSub: site?.leadSub ?? '',
    timeZone: site?.timeZone ?? '',
  });
  const [errors, setErrors] = useState<Partial<Record<keyof SiteInput, string>>>({});
  const action = useAction(saveSite);
  const input = (): SiteInput => ({
    name: v.name,
    region: v.region,
    elevation: v.elevation.trim() === '' ? Number.NaN : Number(v.elevation),
    exposure: v.exposure,
    roadClass: v.roadClass,
    leadSub: v.leadSub || null,
    timeZone: v.timeZone,
  });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const i = input();
    const errs = validateSite(i, desk.sites.filter((s) => s.id !== site?.id));
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const r = await action.run(store, me, i, site?.id);
    if (r) await onSaved(site ? `${r.name} saved.` : `${r.name} added to the globe.`);
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={site ? `Edit ${site.name}` : 'Add site'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="site-form" busy={action.pending}>
            {site ? 'Save site' : 'Add site'}
          </Button>
        </>
      }
    >
      <form id="site-form" onSubmit={(e) => void submit(e)} noValidate className="grid gap-x-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="s-name" error={errors.name} counter={{ value: v.name.trim().length, max: limits.siteName.max }}>
          <Input id="s-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} invalid={!!errors.name} />
        </Field>
        <Field label="Region" htmlFor="s-region" error={errors.region}>
          <Input id="s-region" list="s-regions" value={v.region} onChange={(e) => setV({ ...v, region: e.target.value })} invalid={!!errors.region} />
          <datalist id="s-regions">
            {desk.regions.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </Field>
        <Field label="Elevation (m)" htmlFor="s-elev" error={errors.elevation}>
          <Input id="s-elev" type="number" step="1" value={v.elevation} onChange={(e) => setV({ ...v, elevation: e.target.value })} invalid={!!errors.elevation} className="font-mono" />
        </Field>
        <Field label="Lead" htmlFor="s-lead">
          <Select id="s-lead" value={v.leadSub} onChange={(e) => setV({ ...v, leadSub: e.target.value })}>
            <option value="">No lead</option>
            {desk.people.map((p) => (
              <option key={p.sub} value={p.sub}>
                {p.displayName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Exposure" htmlFor="s-expo">
          <Select id="s-expo" value={v.exposure} onChange={(e) => setV({ ...v, exposure: e.target.value as Site['exposure'] })}>
            {EXPOSURES.map((x) => (
              <option key={x} value={x}>
                {EXPOSURE_LABEL[x]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Road" htmlFor="s-road">
          <Select id="s-road" value={v.roadClass} onChange={(e) => setV({ ...v, roadClass: e.target.value as Site['roadClass'] })}>
            {ROAD_CLASSES.map((x) => (
              <option key={x} value={x}>
                {ROAD_LABEL[x]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Time zone" htmlFor="s-tz" error={errors.timeZone} hint={`Empty: the desk's own (${desk.tz}).`} className="sm:col-span-2">
          <Input id="s-tz" value={v.timeZone} onChange={(e) => setV({ ...v, timeZone: e.target.value })} placeholder="Europe/Oslo" invalid={!!errors.timeZone} className="font-mono" />
        </Field>
        {action.error && <p role="alert" className="m-0 text-ui font-medium text-bad sm:col-span-2">{action.error.message}</p>}
      </form>
    </Dialog>
  );
}

