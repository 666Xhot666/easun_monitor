import { useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import axios from '../lib/apiClient';
import { extractErrorMessage } from '../lib/errors';
import type { PanelType } from './pvArray';
import { Button } from '../ui';
import { Dialog } from '../ui/Dialog';

interface PanelTypesProps {
  panelTypes: PanelType[];
  onSaved: () => void;
  /** Readers: the list only, no changes. */
  readOnly?: boolean;
}

type FormValues = {
  name: string;
  maxPowerW: string;
  vmpV: string;
  impA: string;
  vocV: string;
  iscA: string;
};

const blankValues = (): FormValues => ({
  name: '',
  maxPowerW: '',
  vmpV: '',
  impA: '',
  vocV: '',
  iscA: '',
});

/** The user's panel types from their datasheets, with add, edit and delete. */
export default function PanelTypes({ panelTypes, onSaved, readOnly = false }: PanelTypesProps) {
  const [editing, setEditing] = useState<PanelType | 'new' | null>(null);
  const [values, setValues] = useState<FormValues>(blankValues());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<PanelType | null>(null);

  const openNew = () => {
    setEditing('new');
    setValues(blankValues());
    setError(null);
  };

  const openEdit = (panelType: PanelType) => {
    setEditing(panelType);
    setValues({
      name: panelType.name,
      maxPowerW: String(panelType.maxPowerW),
      vmpV: String(panelType.vmpV),
      impA: String(panelType.impA),
      vocV: String(panelType.vocV),
      iscA: String(panelType.iscA),
    });
    setError(null);
  };

  const cancel = () => {
    setEditing(null);
    setValues(blankValues());
    setError(null);
  };

  const setField = (field: keyof FormValues) => (event: ChangeEvent<HTMLInputElement>) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || editing === null) return;

    const payload = {
      name: values.name,
      maxPowerW: Number(values.maxPowerW),
      vmpV: Number(values.vmpV),
      impA: Number(values.impA),
      vocV: Number(values.vocV),
      iscA: Number(values.iscA),
    };

    setSaving(true);
    setError(null);

    try {
      if (editing === 'new') {
        await axios.post('/api/panel-types', payload);
      } else {
        await axios.patch(`/api/panel-types/${editing.id}`, payload);
      }

      setEditing(null);
      setValues(blankValues());
      setError(null);
      onSaved();
    } catch (err) {
      setError(extractErrorMessage(err, "Couldn't save the panel type."));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (panelType: PanelType) => {

    try {
      await axios.delete(`/api/panel-types/${panelType.id}`);
      setError(null);
      onSaved();
    } catch (err) {
      setError(extractErrorMessage(err, "Couldn't delete the panel type."));
    }
  };

  return (
    <div className="space-y-4">
      {error ? (
        <p role="alert" className="rounded-lg bg-crit-bg px-3 py-2 text-sm text-crit-ink">
          {error}
        </p>
      ) : null}

      {panelTypes.length === 0 ? (
        <p className="text-sm text-muted">No panel types yet. Add the one on your roof from its datasheet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-line text-left">
            <thead>
              <tr className="bg-surface-2">
                <th scope="col" className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted">Name</th>
                <th scope="col" className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted">Pmax</th>
                <th scope="col" className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted">Vmp</th>
                <th scope="col" className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted">Imp</th>
                <th scope="col" className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted">Voc</th>
                <th scope="col" className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted">Isc</th>
                <th scope="col" className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {panelTypes.map((panelType) => (
                <tr key={panelType.id} className="bg-surface-2">
                  <td className="px-3 py-2 text-sm text-ink">{panelType.name}</td>
                  <td className="px-3 py-2 text-sm text-ink">{`${panelType.maxPowerW} W`}</td>
                  <td className="px-3 py-2 text-sm text-ink">{`${panelType.vmpV} V`}</td>
                  <td className="px-3 py-2 text-sm text-ink">{`${panelType.impA} A`}</td>
                  <td className="px-3 py-2 text-sm text-ink">{`${panelType.vocV} V`}</td>
                  <td className="px-3 py-2 text-sm text-ink">{`${panelType.iscA} A`}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-sm">
                    {!readOnly && (
                      <div className="flex gap-2">
                        <button type="button" aria-label={`Edit ${panelType.name}`} onClick={() => openEdit(panelType)} className="h-8 rounded-lg border border-line-strong px-2.5 text-[13px] font-medium hover:bg-surface-2">Edit</button>
                        <button type="button" aria-label={`Delete ${panelType.name}`} onClick={() => setDeleting(panelType)} className="h-8 rounded-lg px-2.5 text-[13px] font-medium text-crit-ink hover:bg-crit-bg">Delete</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing === null && !readOnly ? (
        <button type="button" onClick={openNew} className="rounded-lg bg-ink px-3 py-2 text-sm font-medium text-page transition hover:opacity-90">Add panel type</button>
      ) : null}

      {editing !== null ? (
        <form onSubmit={(event) => void handleSubmit(event)} className="space-y-3 rounded border border-line bg-surface-2 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-ink">
              Name
              <input type="text" value={values.name} onChange={setField('name')} className="mt-1 w-full rounded border border-line-strong bg-surface-2 px-2 py-1 text-sm text-ink" />
            </label>
            <label className="block text-sm text-ink">
              Pmax (W)
              <input type="number" step="any" min="0" value={values.maxPowerW} onChange={setField('maxPowerW')} className="mt-1 w-full rounded border border-line-strong bg-surface-2 px-2 py-1 text-sm text-ink" />
            </label>
            <label className="block text-sm text-ink">
              Vmp (V)
              <input type="number" step="any" min="0" value={values.vmpV} onChange={setField('vmpV')} className="mt-1 w-full rounded border border-line-strong bg-surface-2 px-2 py-1 text-sm text-ink" />
            </label>
            <label className="block text-sm text-ink">
              Imp (A)
              <input type="number" step="any" min="0" value={values.impA} onChange={setField('impA')} className="mt-1 w-full rounded border border-line-strong bg-surface-2 px-2 py-1 text-sm text-ink" />
            </label>
            <label className="block text-sm text-ink">
              Voc (V)
              <input type="number" step="any" min="0" value={values.vocV} onChange={setField('vocV')} className="mt-1 w-full rounded border border-line-strong bg-surface-2 px-2 py-1 text-sm text-ink" />
            </label>
            <label className="block text-sm text-ink">
              Isc (A)
              <input type="number" step="any" min="0" value={values.iscA} onChange={setField('iscA')} className="mt-1 w-full rounded border border-line-strong bg-surface-2 px-2 py-1 text-sm text-ink" />
            </label>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="rounded-lg bg-ink px-3 py-2 text-sm font-medium text-page transition hover:opacity-90 disabled:opacity-50">Save</button>
            <button type="button" onClick={cancel} className="rounded bg-surface-2 px-3 py-2 text-sm font-medium text-ink hover:bg-surface-2">Cancel</button>
          </div>
        </form>
      ) : null}
      <Dialog
        open={deleting !== null}
        title={`Delete the panel type “${deleting?.name}”?`}
        onClose={() => setDeleting(null)}
        actions={
          <>
            <Button onClick={() => setDeleting(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                const panelType = deleting;
                setDeleting(null);
                if (panelType) void handleDelete(panelType);
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        Panel types an inverter still uses can’t be deleted.
      </Dialog>
    </div>
  );
}
