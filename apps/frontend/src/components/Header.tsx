import { LOGO_PESTRACK } from '../lib/constants';
import type { Site } from '../lib/types';
import { HeaderButtons, type HeaderButtonsProps } from './HeaderButtons';

export interface HeaderProps extends HeaderButtonsProps {
  sites: Site[];
  loadingSites: boolean;
  onSelectSite: (site: Site) => void;
}

// The #hdr bar: logo, site subtitle, site selector, and the header button cluster.
export function Header(props: HeaderProps) {
  const { sites, loadingSites, selectedSite, onSelectSite, ...buttonProps } = props;

  return (
    <div id="hdr">
      <img id="hdr-logo" src={LOGO_PESTRACK} alt="PesTrack" />
      <div className="vdiv"></div>
      <span id="hdr-sub" className="inline-flex items-center">
        <span className="flex items-center gap-2 ml-3 mr-1">
          {loadingSites ? (
            <span className="text-xs text-slate-400">Loading sites...</span>
          ) : (
            <select
              value={selectedSite?.id || ''}
              onChange={(e) => {
                const s = sites.find((x) => String(x.id) === e.target.value);
                if (s) onSelectSite(s);
              }}
              className="bg-white border border-slate-300 rounded-md px-2.5 py-1 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-400 cursor-pointer"
            >
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </span>
        — Site Findings
      </span>

      {/* Site Selector dropdown matches light theme */}
     

      <HeaderButtons selectedSite={selectedSite} {...buttonProps} />
    </div>
  );
}
