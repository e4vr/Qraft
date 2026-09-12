'use client';

import { useId, useMemo } from 'react';
import type { QBankSpecialty, QBankTopic } from '@/lib/medguard-types';

export function ClassificationFields({
  specialties,
  topics,
  specialty,
  topic,
  onChange,
  disabled = false,
}: {
  specialties: QBankSpecialty[];
  topics: QBankTopic[];
  specialty: string;
  topic: string;
  onChange: (value: { specialty: string; topic: string }) => void;
  disabled?: boolean;
}) {
  const id = useId().replace(/:/g, '');
  const matchingSpecialties = useMemo(
    () => specialties.filter((item) => item.name.toLocaleLowerCase() === specialty.trim().toLocaleLowerCase()),
    [specialties, specialty],
  );
  const matchingIds = new Set(matchingSpecialties.map((item) => item.id));
  const availableTopics = matchingIds.size
    ? topics.filter((item) => matchingIds.has(item.specialtyId))
    : topics;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block">
        <span className="mb-1.5 block text-sm font-bold">Specialty</span>
        <input
          required
          disabled={disabled}
          list={`${id}-specialties`}
          value={specialty}
          onChange={(event) => onChange({ specialty: event.target.value, topic })}
          placeholder="Search or type a new specialty"
          className="h-11 w-full rounded-xl border bg-card px-3"
        />
        <datalist id={`${id}-specialties`}>
          {specialties.map((item) => <option key={item.id} value={item.name} aria-label={item.name} />)}
        </datalist>
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm font-bold">Topic</span>
        <input
          required
          disabled={disabled}
          list={`${id}-topics`}
          value={topic}
          onChange={(event) => onChange({ specialty, topic: event.target.value })}
          placeholder="Search or type a new topic"
          className="h-11 w-full rounded-xl border bg-card px-3"
        />
        <datalist id={`${id}-topics`}>
          {availableTopics.map((item) => <option key={item.id} value={item.name} aria-label={item.name} />)}
        </datalist>
      </label>
      <p className="text-xs text-muted-foreground sm:col-span-2">New names are created only when you save. Typing and searching do not contact the server.</p>
    </div>
  );
}
