'use client';

import { useId, useMemo, useState } from 'react';
import { Autocomplete } from '@base-ui/react/autocomplete';
import { ChevronDown } from 'lucide-react';
import { classificationNameKey, classificationSuggestions } from '@/features/imports/domain/import-classifications';

export function ImportClassificationInput({ label, value, names, onChange, disabled = false }: {
  label: string; value: string; names: string[]; onChange: (value: string) => void; disabled?: boolean;
}) {
  const id = useId();
  const [showAll, setShowAll] = useState(false);
  const matches = useMemo(() => classificationSuggestions(names, showAll ? '' : value), [names, value, showAll]);
  const existing = names.some(name => classificationNameKey(name) === classificationNameKey(value));
  return <div className="iw-classification-field">
    <label htmlFor={id}>{label}</label>
    <Autocomplete.Root items={matches} filter={null} value={value} disabled={disabled} autoHighlight={false}
      onValueChange={(next, details) => { if (details.reason === 'escape-key') { details.cancel(); return; } setShowAll(false); onChange(next); }}
      onOpenChange={(open, details) => { if (open) setShowAll(details.reason === 'trigger-press'); }}>
      <Autocomplete.InputGroup className="iw-classification-control">
        <Autocomplete.Input id={id} dir="auto" placeholder={`Search or type a new ${label.toLowerCase()}`} aria-describedby={`${id}-hint`} />
        <Autocomplete.Trigger aria-label={`Show ${label.toLowerCase()} suggestions`}><ChevronDown size={16} /></Autocomplete.Trigger>
      </Autocomplete.InputGroup>
      <Autocomplete.Portal>
        <Autocomplete.Positioner className="iw-classification-positioner" sideOffset={5} align="start">
          <Autocomplete.Popup className="iw-classification-popup">
            <p className="iw-classification-caption">Suggestions · choose one or keep your own text</p>
            <Autocomplete.Empty className="iw-classification-empty">No matching {label.toLowerCase()}. Keep typing to use a new name.</Autocomplete.Empty>
            <Autocomplete.List className="iw-classification-list">{(name: string) => <Autocomplete.Item key={name} value={name} className="iw-classification-option"><span dir="auto">{name}</span></Autocomplete.Item>}</Autocomplete.List>
            {matches.length === 12 && <p className="iw-classification-caption">Type more to narrow the suggestions.</p>}
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal>
    </Autocomplete.Root>
    <p id={`${id}-hint`} className="iw-classification-hint">{value.trim() && !existing ? 'New name · kept as typed' : 'Choose a suggestion or type any new name.'}</p>
  </div>;
}
