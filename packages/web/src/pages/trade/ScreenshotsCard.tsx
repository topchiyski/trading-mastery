import { useEffect, useRef, useState } from 'react';
import { useDeleteScreenshot, useUpdateScreenshot, useUploadScreenshot } from '../../api/hooks';
import type { Screenshot, TradeDetail } from '../../api/types';
import { ConfirmButton, ErrorBox, Field } from '../../components/ui';

function Lightbox({
  shots,
  index,
  onClose,
  onIndex,
}: {
  shots: Screenshot[];
  index: number;
  onClose: () => void;
  onIndex: (i: number) => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const shot = shots[index];
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') onIndex((index + 1) % shots.length);
      if (e.key === 'ArrowLeft') onIndex((index - 1 + shots.length) % shots.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, shots.length, onClose, onIndex]);
  if (!shot) return null;
  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="Screenshot"
      onClick={onClose}
    >
      <img src={shot.url} alt={shot.caption ?? 'Screenshot'} onClick={(e) => e.stopPropagation()} />
      {shot.caption && <div className="caption">{shot.caption}</div>}
      <div className="nav" onClick={(e) => e.stopPropagation()}>
        {shots.length > 1 && (
          <button type="button" onClick={() => onIndex((index - 1 + shots.length) % shots.length)}>
            ← Prev
          </button>
        )}
        <button type="button" ref={closeRef} onClick={onClose}>
          Close
        </button>
        {shots.length > 1 && (
          <button type="button" onClick={() => onIndex((index + 1) % shots.length)}>
            Next →
          </button>
        )}
      </div>
    </div>
  );
}

function Thumb({
  shot,
  tradeId,
  onOpen,
}: {
  shot: Screenshot;
  tradeId: number;
  onOpen: () => void;
}) {
  const update = useUpdateScreenshot(tradeId);
  const del = useDeleteScreenshot(tradeId);
  const [editing, setEditing] = useState(false);
  const [caption, setCaption] = useState(shot.caption ?? '');
  return (
    <figure>
      <button
        type="button"
        className="thumb"
        aria-label={`Open screenshot: ${shot.caption ?? 'untitled'}`}
        onClick={onOpen}
      >
        <img src={shot.url} alt={shot.caption ?? ''} loading="lazy" />
      </button>
      <figcaption>
        {editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              update.mutate(
                { id: shot.id, caption: caption.trim() || null },
                { onSuccess: () => setEditing(false) },
              );
            }}
          >
            <input
              aria-label="Rename screenshot"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              autoFocus
            />
          </form>
        ) : (
          <span>{shot.caption ?? <span className="muted">No caption</span>}</span>
        )}
        <span>
          {!editing && (
            <button type="button" className="small" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
          <ConfirmButton
            ariaLabel={`Delete screenshot ${shot.id}`}
            onConfirm={() => del.mutate(shot.id)}
          />
        </span>
      </figcaption>
    </figure>
  );
}

export function ScreenshotsCard({ trade }: { trade: TradeDetail }) {
  const upload = useUploadScreenshot(trade.id);
  const [caption, setCaption] = useState('');
  const [over, setOver] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function uploadFiles(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      await upload.mutateAsync({ file, caption: caption.trim() });
    }
    setCaption('');
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <section className="card" aria-label="Screenshots">
      <h2>Screenshots</h2>
      <div className="fields">
        <Field label="Caption" hint="Applied to the next upload">
          {(p) => <input {...p} value={caption} onChange={(e) => setCaption(e.target.value)} />}
        </Field>
      </div>
      <div
        className={`dropzone${over ? ' over' : ''}`}
        style={{ marginTop: 10 }}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void uploadFiles(e.dataTransfer.files);
        }}
      >
        <label htmlFor={`upload-${trade.id}`}>Upload screenshot</label> — drop images here or{' '}
        <input
          id={`upload-${trade.id}`}
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          onChange={(e) => e.target.files && void uploadFiles(e.target.files)}
        />
        {upload.isPending && <div>Uploading…</div>}
      </div>
      {upload.error && <ErrorBox error={upload.error} />}
      {trade.screenshots.length > 0 && (
        <div className="gallery">
          {trade.screenshots.map((s, i) => (
            <Thumb key={s.id} shot={s} tradeId={trade.id} onOpen={() => setOpen(i)} />
          ))}
        </div>
      )}
      {open !== null && (
        <Lightbox
          shots={trade.screenshots}
          index={open}
          onClose={() => setOpen(null)}
          onIndex={setOpen}
        />
      )}
    </section>
  );
}
