import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search, X } from 'lucide-react';

interface MultiSelectProps {
  options: { id: number; name: string }[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  placeholder?: string;
  openDirection?: 'up' | 'down';
}

export function MultiSelect({
  options,
  selectedIds,
  onChange,
  placeholder = 'Select sites...',
  openDirection = 'down',
}: MultiSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
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

  const filteredOptions = options.filter((opt) =>
    opt.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const selectedOptions = options.filter((opt) => selectedIds.includes(opt.id));

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
          {selectedOptions.length === 0 ? (
            <span className="text-muted-foreground">{placeholder}</span>
          ) : (
            selectedOptions.map((opt) => (
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
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search..."
              className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              autoFocus
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
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

          <div className="overflow-y-auto flex-1 py-1 max-h-[160px]">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm text-muted-foreground">No options found</div>
            ) : (
              filteredOptions.map((opt) => {
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
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
