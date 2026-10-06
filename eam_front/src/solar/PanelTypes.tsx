import { useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import axios from '../lib/apiClient';
import { extractErrorMessage } from '../lib/errors';
import type { PanelType } from './pvArray';

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
    if (!window.confirm(`Delete the panel type "${panelType.name}"?`)) return;

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
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-900/30 dark:text-red-300">
          {error}
        </p>
      ) : null}

      {panelTypes.length === 0 ? (
        <p className="text-sm text-gray-600 dark:text-gray-300">No panel types yet. Add the one on your roof from its datasheet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-left dark:divide-gray-700">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800">
                <th scope="col" className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Name</th>
                <th scope="col" className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Pmax</th>
                <th scope="col" className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Vmp</th>
                <th scope="col" className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Imp</th>
                <th scope="col" className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Voc</th>
                <th scope="col" className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Isc</th>
                <th scope="col" className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {panelTypes.map((panelType) => (
                <tr key={panelType.id} className="bg-gray-50 dark:bg-gray-900">
                  <td className="px-3 py-2 text-sm text-gray-900 dark:text-gray-100">{panelType.name}</td>
                  <td className="px-3 py-2 text-sm text-gray-900 dark:text-gray-100">{`${panelType.maxPowerW} W`}</td>
                  <td className="px-3 py-2 text-sm text-gray-900 dark:text-gray-100">{`${panelType.vmpV} V`}</td>
                  <td className="px-3 py-2 text-sm text-gray-900 dark:text-gray-100">{`${panelType.impA} A`}</td>
                  <td className="px-3 py-2 text-sm text-gray-900 dark:text-gray-100">{`${panelType.vocV} V`}</td>
                  <td className="px-3 py-2 text-sm text-gray-900 dark:text-gray-100">{`${panelType.iscA} A`}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-sm">
                    {!readOnly && (
                      <div className="flex gap-2">
                        <button type="button" aria-label={`Edit ${panelType.name}`} onClick={() => openEdit(panelType)} className="font-medium text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100">Edit</button>
                        <button type="button" aria-label={`Delete ${panelType.name}`} onClick={() => void handleDelete(panelType)} className="font-medium text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100">Delete</button>
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
        <button type="button" onClick={openNew} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-700">Add panel type</button>
      ) : null}

      {editing !== null ? (
        <form onSubmit={(event) => void handleSubmit(event)} className="space-y-3 rounded border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-gray-700 dark:text-gray-300">
              Name
              <input type="text" value={values.name} onChange={setField('name')} className="mt-1 w-full rounded border border-gray-300 bg-gray-50 px-2 py-1 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100" />
            </label>
            <label className="block text-sm text-gray-700 dark:text-gray-300">
              Pmax (W)
              <input type="number" step="any" min="0" value={values.maxPowerW} onChange={setField('maxPowerW')} className="mt-1 w-full rounded border border-gray-300 bg-gray-50 px-2 py-1 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100" />
            </label>
            <label className="block text-sm text-gray-700 dark:text-gray-300">
              Vmp (V)
              <input type="number" step="any" min="0" value={values.vmpV} onChange={setField('vmpV')} className="mt-1 w-full rounded border border-gray-300 bg-gray-50 px-2 py-1 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100" />
            </label>
            <label className="block text-sm text-gray-700 dark:text-gray-300">
              Imp (A)
              <input type="number" step="any" min="0" value={values.impA} onChange={setField('impA')} className="mt-1 w-full rounded border border-gray-300 bg-gray-50 px-2 py-1 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100" />
            </label>
            <label className="block text-sm text-gray-700 dark:text-gray-300">
              Voc (V)
              <input type="number" step="any" min="0" value={values.vocV} onChange={setField('vocV')} className="mt-1 w-full rounded border border-gray-300 bg-gray-50 px-2 py-1 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100" />
            </label>
            <label className="block text-sm text-gray-700 dark:text-gray-300">
              Isc (A)
              <input type="number" step="any" min="0" value={values.iscA} onChange={setField('iscA')} className="mt-1 w-full rounded border border-gray-300 bg-gray-50 px-2 py-1 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100" />
            </label>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50">Save</button>
            <button type="button" onClick={cancel} className="rounded bg-gray-100 px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600">Cancel</button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
