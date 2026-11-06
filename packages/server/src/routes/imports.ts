import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/client';
import { DomainError, invalid } from '../errors';
import { csvMappingSchema, parseGenericCsv, type CsvMapping } from '../import/generic-csv';
import { parseIbkrActivity } from '../import/ibkr-activity';
import type { ParseResult } from '../import/types';
import {
  createPreset,
  deletePreset,
  getPresetMapping,
  listPresets,
  updatePreset,
} from '../repo/import-presets';
import { commitImport, getImport, listImports, previewImport, undoImport } from '../repo/imports';
import { idParam } from '../validation';

const sourceSchema = z.enum(['IBKR_ACTIVITY', 'CSV']);
const presetSchema = z
  .object({ name: z.string().trim().min(1).max(80), mapping: csvMappingSchema })
  .strict();
const commitSchema = z.object({ force: z.boolean().optional() }).strict();

/** Text fields of a multipart request (only those sent before the file are available). */
function field(fields: Record<string, unknown>, name: string): string | undefined {
  const f = fields[name] as { type?: string; value?: unknown } | undefined;
  return f && f.type === 'field' ? String(f.value) : undefined;
}

export function importRoutes(app: FastifyInstance, db: Db): void {
  app.post('/api/imports/preview', async (req) => {
    const file = await req.file();
    if (!file) throw invalid('Attach the file in the "file" field');
    const data = await file.toBuffer();
    const fields = file.fields as Record<string, unknown>;
    const source = sourceSchema.parse(field(fields, 'source'));

    let mapping: CsvMapping | undefined;
    if (source === 'CSV') {
      const presetId = field(fields, 'presetId');
      const raw = field(fields, 'mapping');
      if (presetId) mapping = getPresetMapping(db, idParam.parse({ id: presetId }).id);
      else if (raw) {
        let json: unknown;
        try {
          json = JSON.parse(raw);
        } catch {
          throw invalid('The column mapping is not valid JSON');
        }
        mapping = csvMappingSchema.parse(json);
      } else throw invalid('Choose a column mapping (or a saved preset) for CSV imports');
    }

    let result: ParseResult;
    try {
      const text = data.toString('utf8');
      result = mapping ? parseGenericCsv(text, mapping) : parseIbkrActivity(text);
    } catch (err) {
      throw new DomainError(
        400,
        'UNREADABLE_FILE',
        err instanceof Error ? err.message : String(err),
      );
    }
    return previewImport(db, { source, filename: file.filename, data, result });
  });

  app.post('/api/imports/:id/commit', async (req) =>
    commitImport(db, idParam.parse(req.params).id, commitSchema.parse(req.body ?? {})),
  );
  app.post('/api/imports/:id/undo', async (req) => undoImport(db, idParam.parse(req.params).id));
  app.get('/api/imports', async () => ({ imports: listImports(db) }));
  app.get('/api/imports/:id', async (req) => getImport(db, idParam.parse(req.params).id));

  app.get('/api/import-presets', async () => ({ presets: listPresets(db) }));
  app.post('/api/import-presets', async (req, reply) =>
    reply.code(201).send(createPreset(db, presetSchema.parse(req.body))),
  );
  app.put('/api/import-presets/:id', async (req) =>
    updatePreset(db, idParam.parse(req.params).id, presetSchema.parse(req.body)),
  );
  app.delete('/api/import-presets/:id', async (req, reply) => {
    deletePreset(db, idParam.parse(req.params).id);
    return reply.code(204).send();
  });
}
