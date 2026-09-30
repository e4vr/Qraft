'use client';

export function QuestionSourceFields({ sourceFile, sourcePage, onChange }: {
  sourceFile: string;
  sourcePage: string;
  onChange: (source: { sourceFile: string; sourcePage: string }) => void;
}) {
  return <div className="grid gap-3 sm:grid-cols-2">
    <label className="block text-sm font-semibold">Source file name · required
      <input required maxLength={240} value={sourceFile} onChange={event => onChange({ sourceFile: event.target.value, sourcePage })} placeholder="Original file or lecture name" className="mt-2 h-11 w-full rounded-xl border bg-card px-3 font-normal" />
    </label>
    <label className="block text-sm font-semibold">Source page · optional
      <input type="number" min={1} max={100000} step={1} value={sourcePage} onChange={event => onChange({ sourceFile, sourcePage: event.target.value })} placeholder="Leave empty if unknown" className="mt-2 h-11 w-full rounded-xl border bg-card px-3 font-normal" />
    </label>
  </div>;
}
