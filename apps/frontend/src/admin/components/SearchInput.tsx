import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';

// Debounced search box.
export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [local, setLocal] = useState(value);
  // Random, non-guessable field name so Chrome has no known field to autofill.
  const searchName = useRef(`search-${Math.random().toString(36).slice(2)}`).current;

  useEffect(() => setLocal(value), [value]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (local !== value) onChange(local);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local]);

  return (
    <div className="relative flex-1 w-full sm:max-w-sm">
      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
      <input
        type="text"
        value={local}
        placeholder={placeholder}
        onChange={(e) => setLocal(e.target.value)}
        // Chrome ignores autoComplete="off" on search fields, but it will not
        // autofill a field whose name it doesn't recognize. A random name +
        // a non-standard autoComplete token reliably suppresses the dropdown.
        autoComplete="off-search"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        name={searchName}
        className="w-full pl-9 pr-9 py-2 text-sm rounded-lg border border-input bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
      />
      {local && (
        <button
          onClick={() => setLocal('')}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-destructive"
          aria-label="Clear search"
          type="button"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
