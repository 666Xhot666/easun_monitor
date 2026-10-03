import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface GroundTruthSnapshot {
  id: string;
  /** When the reference reading was taken (ISO 8601 with offset). */
  capturedAt: string;
  source?: string;
  /** Field name -> value as shown by the reference (e.g. the vendor cloud app). */
  fields: Record<string, number | string>;
  notes?: string[];
}

export interface GroundTruthSummary { id: string; capturedAt: string; source?: string }

const ID = /^[\w-]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reference readings ("ground truth") transcribed by hand from the vendor's cloud app, as JSON files in the capture folder's ground-truth/ subfolder; nothing writes them automatically; used to suggest names for unknown addresses found by a serial capture.
 */
export class GroundTruthStore {
  constructor(private readonly captureDir: string) {}

  list(): GroundTruthSummary[] {
    const dir = this.folder();
    if (!existsSync(dir)) {
      return [];
    }

    return readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => this.read(name.slice(0, -'.json'.length)))
      .filter((snapshot): snapshot is GroundTruthSnapshot => snapshot !== null)
      .map((snapshot) => ({
        id: snapshot.id,
        capturedAt: snapshot.capturedAt,
        ...(snapshot.source ? { source: snapshot.source } : {}),
      }))
      .sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt));
  }

  read(id: string): GroundTruthSnapshot | null {
    if (!ID.test(id)) {
      return null;
    }

    const file = join(this.folder(), `${id}.json`);
    if (!existsSync(file)) {
      return null;
    }

    try {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (!isRecord(parsed)) {
        return null;
      }

      const capturedAt = parsed.capturedAt;
      if (typeof capturedAt !== 'string' || Number.isNaN(Date.parse(capturedAt))) {
        return null;
      }

      const fields = parsed.fields;
      if (!isRecord(fields)) {
        return null;
      }

      const source = parsed.source;
      const notes = parsed.notes;

      return {
        id,
        capturedAt,
        ...(typeof source === 'string' ? { source } : {}),
        fields: fields as Record<string, number | string>,
        ...(Array.isArray(notes) ? { notes: notes as string[] } : {}),
      };
    } catch {
      return null;
    }
  }

  private folder(): string {
    return join(this.captureDir, 'ground-truth');
  }
}
