import { useState } from 'react';
import { X, Copy, Check } from 'lucide-react';

type Values = Record<string, unknown> | null;

// A copy-to-clipboard icon button that flips to a check for a moment.
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch { /* clipboard unavailable */ }
      }}
      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
      title="Copy JSON"
    >
      {copied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

// Pretty-print an object one key per line, highlighting the lines whose key
// Pretty-print the object as JSON. No highlighting — plain readable output.
function JsonPanel({ values }: { values: Values }) {
  return (
    <pre className="text-xs leading-relaxed font-mono text-foreground overflow-y-auto flex-1 p-3 m-0 whitespace-pre">
      {JSON.stringify(values ?? {}, null, 2)}
    </pre>
  );
}

export function PayloadModal({
  title,
  oldValues,
  newValues,
  onClose,
}: {
  title: string;
  oldValues: Values;
  newValues: Values;
  onClose: () => void;
}) {
  const oldJson = JSON.stringify(oldValues ?? {}, null, 2);
  const newJson = JSON.stringify(newValues ?? {}, null, 2);

  return (
    <div className="fixed inset-0 bg-black/45 backdrop-blur-[2px] flex items-center justify-center z-[60] px-4">
      <div className="bg-card border border-border rounded-2xl shadow-xl w-[820px] max-w-full h-[600px] max-h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <h3 className="text-base font-bold m-0">{title}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-muted cursor-pointer">
            <X size={18} />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-border flex-1 min-h-0 overflow-hidden">
          {/* OLD */}
          <div className="bg-card flex flex-col min-h-0">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Old value</span>
              <CopyButton text={oldJson} />
            </div>
            <JsonPanel values={oldValues} />
          </div>
          {/* NEW */}
          <div className="bg-card flex flex-col min-h-0">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">New value</span>
              <CopyButton text={newJson} />
            </div>
            <JsonPanel values={newValues} />
          </div>
        </div>
      </div>
    </div>
  );
}
