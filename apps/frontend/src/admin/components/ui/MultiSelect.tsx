import { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search, X } from 'lucide-react';

interface Option { id: number; name: string }

interface MultiSelectProps {
  options: Option[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  // Names for already-selected ids that `options` may not contain yet — an
  // assignment sitting on a later page, or one the active search filters out.
  // Without these, such a selection has no label to render on first paint.
  selectedOptions?: Option[];
  placeholder?: string;
  openDirection?: 'up' | 'down';
  onSearchChange?: (search: string) => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoading?: boolean;
}

export function MultiSelect({
  options,
  selectedIds,
  onChange,
  selectedOptions,
  placeholder = 'Select sites...',
  openDirection = 'down',
  onSearchChange,
  onLoadMore,
  hasMore,
  isLoading,
}: MultiSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  // One source of truth for the search box, whether filtering happens here or
  // on the server. Previously the input was left uncontrolled in server-search
  // mode, so its text and the clear button were unbound from any state.
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Fixed-position coords so the menu escapes any overflow-clipping ancestor
  // (e.g. a scrollable modal body). Recomputed while open.
  const [menuPos, setMenuPos] = useState<{ left: number; top: number; width: number } | null>(null);

  // Position the portal menu against the trigger. Chooses up/down based on the
  // preferred direction but flips if there isn't room on that side.
  useLayoutEffect(() => {
    if (!isOpen) return;
    function place() {
      const trigger = containerRef.current;
      if (!trigger) return;
      const r = trigger.getBoundingClientRect();
      const menuH = menuRef.current?.offsetHeight ?? 260;
      const gap = 6;
      const spaceBelow = window.innerHeight - r.bottom;
      const spaceAbove = r.top;
      const openUp = openDirection === 'up'
        ? spaceAbove > menuH + gap || spaceAbove > spaceBelow
        : spaceBelow < menuH + gap && spaceAbove > spaceBelow;
      const top = openUp ? r.top - menuH - gap : r.bottom + gap;
      setMenuPos({ left: r.left, top, width: r.width });
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [isOpen, openDirection, selectedIds.length]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const t = event.target as Node;
      if (
        containerRef.current && !containerRef.current.contains(t) &&
        menuRef.current && !menuRef.current.contains(t)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const filteredOptions = useMemo(() => {
    if (onSearchChange) return options; // If server-side search is provided, options are already filtered
    if (!search) return options;
    const lower = search.toLowerCase();
    return options.filter((opt) => opt.name.toLowerCase().includes(lower));
  }, [options, search, onSearchChange]);

  function updateSearch(value: string) {
    setSearch(value);
    onSearchChange?.(value);
  }

  // Every name seen so far, kept across renders. `options` is a moving window —
  // it holds one page of a paginated list and shrinks to the matches while a
  // server-side search is active — so deriving the chips from it alone made a
  // selected site's chip vanish as soon as it dropped out of that window, even
  // though the selection itself was still held in `selectedIds`.
  const labelCache = useRef(new Map<number, string>());
  useMemo(() => {
    for (const opt of selectedOptions ?? []) labelCache.current.set(opt.id, opt.name);
    for (const opt of options) labelCache.current.set(opt.id, opt.name);
  }, [options, selectedOptions]);

  const selectedChips = useMemo(
    () => selectedIds.map((id) => ({ id, name: labelCache.current.get(id) ?? String(id) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the cache is filled
    // from options/selectedOptions above, so both belong in this dependency list.
    [selectedIds, options, selectedOptions]
  );

  function toggleOption(id: number) {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  }

  function removeSelected(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    onChange(selectedIds.filter((x) => x !== id));
  }

  function selectAllFiltered() {
    const filteredIds = filteredOptions.map((o) => o.id);
    const newSelected = Array.from(new Set([...selectedIds, ...filteredIds]));
    onChange(newSelected);
  }

  function clearAllFiltered() {
    const filteredIds = filteredOptions.map((o) => o.id);
    onChange(selectedIds.filter((id) => !filteredIds.includes(id)));
  }

  return (
    <div className="relative w-full" ref={containerRef}>
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="flex min-h-[40px] w-full items-center justify-between rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground shadow-sm cursor-pointer hover:border-ring/50 focus:outline-none focus:ring-2 focus:ring-ring/40 transition-all duration-150"
      >
        <div className="flex flex-wrap gap-1 pr-4">
          {selectedChips.length === 0 ? (
            <span className="text-muted-foreground">{placeholder}</span>
          ) : (
            selectedChips.map((opt) => (
              <span
                key={opt.id}
                className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-xs font-semibold text-accent-foreground border border-primary/10 transition-all hover:bg-accent/80"
              >
                {opt.name}
                <button
                  type="button"
                  onClick={(e) => removeSelected(opt.id, e)}
                  className="rounded-full hover:bg-primary/20 p-0.5 text-accent-foreground/75 hover:text-accent-foreground"
                >
                  <X size={10} />
                </button>
              </span>
            ))
          )}
        </div>
        <ChevronDown
          size={16}
          className={`text-muted-foreground transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </div>

      {isOpen && createPortal(
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            left: menuPos?.left ?? 0,
            top: menuPos?.top ?? 0,
            width: menuPos?.width ?? 'auto',
            visibility: menuPos ? 'visible' : 'hidden',
          }}
          className="z-[60] overflow-hidden rounded-xl border border-border bg-card shadow-lg flex flex-col"
        >
          <div className="flex items-center gap-2 border-b border-border px-3 py-2 bg-muted/40">
            <Search size={14} className="text-muted-foreground shrink-0" />
            <input
              type="text"
              value={search}
              onChange={(e) => updateSearch(e.target.value)}
              placeholder="Search..."
              className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              autoFocus
            />
            {search && (
              <button
                type="button"
                onClick={() => updateSearch('')}
                className="text-muted-foreground hover:text-foreground"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="flex items-center justify-between px-3 py-1.5 text-xs border-b border-border bg-muted/20 text-muted-foreground select-none">
            <span>Showing {filteredOptions.length} of {options.length}</span>
            <div className="flex gap-2">
              <button type="button" onClick={selectAllFiltered} className="font-medium text-primary hover:underline cursor-pointer">
                Select All
              </button>
              <span className="text-border">|</span>
              <button type="button" onClick={clearAllFiltered} className="font-medium text-destructive hover:underline cursor-pointer">
                Clear All
              </button>
            </div>
          </div>

          <div 
            className="overflow-y-auto flex-1 py-1 max-h-[350px]"
            onScroll={(e) => {
              const target = e.target as HTMLDivElement;
              if (target.scrollHeight - target.scrollTop <= target.clientHeight + 10) {
                if (hasMore && !isLoading && onLoadMore) onLoadMore();
              }
            }}
          >
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm text-muted-foreground">No options found</div>
            ) : (
              filteredOptions.map((opt: { id: number, name: string }) => {
                const isSelected = selectedIds.includes(opt.id);
                return (
                  <div
                    key={opt.id}
                    onClick={() => toggleOption(opt.id)}
                    className={`flex items-center justify-between px-3 py-2 text-sm cursor-pointer select-none transition-colors hover:bg-muted ${
                      isSelected ? 'bg-primary/5 text-primary font-medium' : 'text-foreground'
                    }`}
                  >
                    <span>{opt.name}</span>
                    <div
                      className={`flex h-4 w-4 items-center justify-center rounded border transition-colors ${
                        isSelected
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-input bg-card'
                      }`}
                    >
                      {isSelected && <Check size={12} className="stroke-[3px]" />}
                    </div>
                  </div>
                );
              })
            )}
            {isLoading && <div className="px-3 py-2 text-center text-xs text-muted-foreground">Loading more...</div>}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
