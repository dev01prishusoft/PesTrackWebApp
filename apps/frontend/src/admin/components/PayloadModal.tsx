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

// Shown instead of the new-value JSON when the server flagged the update as a
// no-op. Repeating a payload identical to the old side just invites the reader
// to hunt for a difference that isn't there.
function NoChangesPanel() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-1.5 p-6 text-center">
      <span className="text-sm font-semibold text-foreground">No changes</span>
      <span className="text-xs text-muted-foreground max-w-[220px]">
        This update saved the record without modifying any field.
      </span>
    </div>
  );
}

// `changed` / `changedFields` are audit metadata stamped on by the server, not
// part of the record — surfaced in the header instead of the JSON body.
function stripMeta(values: Values): Values {
  if (!values) return values;
  const { changed: _changed, changedFields: _changedFields, ...rest } = values;
  return rest;
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
  const changed = typeof newValues?.changed === 'boolean' ? newValues.changed : null;
  const changedFields = Array.isArray(newValues?.changedFields)
    ? (newValues.changedFields as unknown[]).map(String)
    : [];

  const oldBody = stripMeta(oldValues);
  const newBody = stripMeta(newValues);
  const oldJson = JSON.stringify(oldBody ?? {}, null, 2);
  const newJson = JSON.stringify(newBody ?? {}, null, 2);

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
            <JsonPanel values={oldBody} />
          </div>
          {/* NEW */}
          <div className="bg-card flex flex-col min-h-0">
            <div className="flex items-center gap-2 justify-between px-3 py-2 border-b border-border bg-muted/30">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground truncate">
                New value
                {changedFields.length > 0 && (
                  <span className="ml-2 normal-case font-medium text-foreground/70">
                    {changedFields.join(', ')}
                  </span>
                )}
              </span>
              <CopyButton text={newJson} />
            </div>
            {changed === false ? <NoChangesPanel /> : <JsonPanel values={newBody} />}
          </div>
        </div>
      </div>
    </div>
  );
}
