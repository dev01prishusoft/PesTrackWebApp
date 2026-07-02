import { useState } from 'react';
import { Menu, X, LogOut } from 'lucide-react';
import type { AuthUser, Site } from '../lib/types';

type Tool = 'none' | 'finding' | 'zone';

export interface HeaderButtonsProps {
  user: AuthUser | null;
  activeTool: Tool;
  hideResolved: boolean;
  hideConstr: boolean;
  onlyConstr: boolean;
  selectedSite: Site | null;
  onToggleTool: (tool: 'finding' | 'zone') => void;
  onToggleHideResolved: () => void;
  onToggleHideConstr: () => void;
  onToggleOnlyConstr: () => void;
  onExportJson: () => void;
  onImportJson: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onOpenPdf: () => void;
  onImportParcels: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onLogout: () => void;
}

// The header action cluster. On desktop the buttons sit inline; on small screens
// they collapse into a hamburger-toggled drawer. Legacy classNames/emoji preserved.
export function HeaderButtons(props: HeaderButtonsProps) {
  const {
    user,
    activeTool,
    hideResolved,
    hideConstr,
    onlyConstr,
    onToggleTool,
    onToggleHideResolved,
    onToggleHideConstr,
    onToggleOnlyConstr,
    onExportJson,
    onImportJson,
    onOpenPdf,
    onImportParcels,
    onLogout,
  } = props;

  const [menuOpen, setMenuOpen] = useState(false);
  const canWrite = user?.role !== 'client_viewer';
  const isAdmin = user?.role === 'admin';

  // Close the mobile drawer after an action is chosen.
  const withClose = (fn: () => void) => () => {
    setMenuOpen(false);
    fn();
  };

  // The action buttons — reused inline (desktop) and inside the drawer (mobile).
  const actions = (
    <>
      {canWrite && (
        <>
          <button
            id="btn-fi"
            className={`hbtn ${activeTool === 'finding' ? 'on' : ''}`}
            onClick={withClose(() => onToggleTool('finding'))}
            title="Add a finding — click the map to place it"
          >
            🔍 Add Finding
          </button>
          <button
            id="btn-cz"
            className={`hbtn ${activeTool === 'zone' ? 'on' : ''}`}
            onClick={withClose(() => onToggleTool('zone'))}
            title="Drop a construction zone marker"
          >
            🏗 Constr. Zone
          </button>
        </>
      )}

      <button
        id="btn-hide-resolved"
        className={`hbtn ${hideResolved ? 'on' : ''}`}
        onClick={withClose(onToggleHideResolved)}
        title="Show or hide resolved (green) findings"
      >
        🟢 Hide Resolved
      </button>
      <button
        id="btn-hide-constr"
        className={`hbtn ${hideConstr ? 'on' : ''}`}
        onClick={withClose(onToggleHideConstr)}
        title="Show or hide construction zone icons"
      >
        🚜 Hide Constr.
      </button>
      <button
        id="btn-only-constr"
        className={`hbtn ${onlyConstr ? 'on' : ''}`}
        onClick={withClose(onToggleOnlyConstr)}
        title="Show only construction zones — hide findings"
      >
        👁 Only Constr.
      </button>

      {isAdmin && (
        <>
          <button
            id="btn-export"
            className="hbtn blue"
            onClick={withClose(onExportJson)}
            title="Export all findings with photos — use this to back up and share"
          >
            📤 Export JSON
          </button>

          <label
            className="hbtn blue text-center flex items-center justify-center cursor-pointer select-none"
            title="Import findings from a previously exported JSON"
          >
            📥 Import JSON
            <input
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                setMenuOpen(false);
                onImportJson(e);
              }}
            />
          </label>
        </>
      )}

      <button
        className="hbtn"
        style={{ background: '#7C3AED', color: '#fff', borderColor: '#7C3AED' }}
        onClick={withClose(onOpenPdf)}
        title="Generate a PDF findings report"
      >
        📋 PDF Report
      </button>

      {canWrite && (
        <label
          className="hbtn text-center flex items-center justify-center cursor-pointer select-none"
          style={{ background: '#0F766E', color: '#fff', borderColor: '#0F766E' }}
          title="Upload updated parcels XLSX to refresh the parcel list"
        >
          📂 Update Parcels
          <input
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              setMenuOpen(false);
              onImportParcels(e);
            }}
          />
        </label>
      )}
    </>
  );

  return (
    <div className="hdr-right">
      {/* Desktop: inline actions */}
      <div className="hdr-actions">{actions}</div>

      {/* Mobile: hamburger toggle + drawer */}
      <button
        className="hbtn hdr-burger"
        aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((o) => !o)}
      >
        {menuOpen ? <X size={18} /> : <Menu size={18} />}
      </button>
      {menuOpen && (
        <>
          <div className="hdr-drawer-overlay" onClick={() => setMenuOpen(false)} />
          <div className="hdr-drawer">{actions}</div>
        </>
      )}

      <div className="hdr-divider w-px h-6 bg-slate-200"></div>

      <button
        onClick={onLogout}
        className="hbtn font-bold text-red-650 border border-red-200 hover:bg-red-50 hover:border-red-300 flex items-center justify-center"
        title="Log out"
        aria-label="Log out"
      >
        <LogOut size={18} />
      </button>
    </div>
  );
}
