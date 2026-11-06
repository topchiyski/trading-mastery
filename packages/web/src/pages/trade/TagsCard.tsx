import { useState } from 'react';
import { useCreateTag, useSetTradeTags, useTags, useUpdateJournal } from '../../api/hooks';
import type { TagKind, TradeDetail } from '../../api/types';
import { ErrorBox, Field, TagChip } from '../../components/ui';

/** Mistake/custom tags on the trade; creating a SETUP tag here sets it as the trade's setup. */
export function TagsCard({ trade }: { trade: TradeDetail }) {
  const tags = useTags();
  const setTags = useSetTradeTags(trade.id);
  const setSetup = useUpdateJournal(trade.id);
  const createTag = useCreateTag();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<TagKind>('MISTAKE');
  const current = trade.tags.map((t) => t.id);
  const available = (tags.data ?? []).filter((t) => t.kind !== 'SETUP' && !current.includes(t.id));

  async function addByName() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const existing = tags.data?.find((t) => t.name.toLowerCase() === trimmed.toLowerCase());
    try {
      const tag = existing ?? (await createTag.mutateAsync({ name: trimmed, kind }));
      if (tag.kind === 'SETUP') await setSetup.mutateAsync({ setupTagId: tag.id });
      else if (!current.includes(tag.id)) await setTags.mutateAsync([...current, tag.id]);
      setName('');
    } catch {
      // Shown from the mutation errors below; keep the name so the user can fix it.
    }
  }

  const error = setTags.error ?? createTag.error ?? setSetup.error;
  const busy = setTags.isPending || createTag.isPending || setSetup.isPending;

  return (
    <section className="card" aria-label="Tags">
      <h2>Tags</h2>
      {trade.tags.length === 0 ? (
        <p className="muted">No mistake or custom tags.</p>
      ) : (
        <ul className="chips">
          {trade.tags.map((t) => (
            <TagChip
              key={t.id}
              tag={t}
              onRemove={() => setTags.mutate(current.filter((x) => x !== t.id))}
            />
          ))}
        </ul>
      )}
      <div className="fields" style={{ marginTop: 12 }}>
        {available.length > 0 && (
          <Field label="Existing tag">
            {(p) => (
              <select
                {...p}
                value=""
                onChange={(e) =>
                  e.target.value && setTags.mutate([...current, Number(e.target.value)])
                }
              >
                <option value="">Add…</option>
                {available.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.kind.toLowerCase()})
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        <Field label="New tag">
          {(p) => (
            <input
              {...p}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void addByName();
                }
              }}
            />
          )}
        </Field>
        <Field label="Kind">
          {(p) => (
            <select {...p} value={kind} onChange={(e) => setKind(e.target.value as TagKind)}>
              <option value="MISTAKE">Mistake</option>
              <option value="CUSTOM">Custom</option>
              <option value="SETUP">Setup</option>
            </select>
          )}
        </Field>
        <div className="actions">
          <button type="button" onClick={() => void addByName()} disabled={busy || !name.trim()}>
            Add tag
          </button>
        </div>
      </div>
      {error && <ErrorBox error={error} />}
    </section>
  );
}
