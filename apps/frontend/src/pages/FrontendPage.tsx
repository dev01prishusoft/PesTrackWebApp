import React, { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { api, qs, getToken } from "../lib/api";
import * as findingsApi from "../lib/findingsApi";
import {
  makeZoneIcon,
  makeFindingIcon,
  buildFindingPopupHtml,
} from "../components/mapIcons";
import { Header } from "../components/Header";
import { useConfirm } from "../components/ConfirmDialog";
import {
  LOGO_PESTRACK,
  CONSTR_LEGEND_ICON_DATA,
  CATS,
  STAT_COLORS,
  STAT_LABELS,
  _BUILTIN_PARCELS,
} from "../lib/constants";
import type {
  Site,
  Finding,
  Visit,
  ConstructionZone,
  Parcel,
  Category,
  Status,
  EscalationOption,
} from "../lib/types";
import L from "leaflet";
import { jsPDF } from "jspdf";
import * as htmlToImage from "html-to-image";

// Coordinates parser matches decimal degrees, Google Maps DDM, and Full DMS
function parseCoords(str: string) {
  if (!str) return null;
  str = str.trim();
  // 0. Key-value format: "lat: 27.415891 lng: 33.666401"
  const kv = str.match(
    /(?:lat|latitude)[\s:=]*(-?\d+\.?\d*)[\s,]+(?:lng|lon|longitude)[\s:=]*(-?\d+\.?\d*)/i,
  );
  if (kv) {
    const lat = parseFloat(kv[1]);
    const lng = parseFloat(kv[2]);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)
      return { lat, lng };
  }
  // 1. Decimal degrees: "29.9612, 30.9874"
  const dec = str.match(/(-?\d+\.?\d*)[,\s\t]+(-?\d+\.?\d*)/);
  if (dec) {
    const lat = parseFloat(dec[1]);
    const lng = parseFloat(dec[2]);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)
      return { lat, lng };
  }
  // 2. Degrees decimal-minutes: "29°57.6102'N 30°58.9498'E"
  const ddm = str.match(
    /(\d+)[°]\s*(\d+\.?\d*)['^\u2019]?\s*([NS])[,\s]+(\d+)[°]\s*(\d+\.?\d*)['^\u2019]?\s*([EW])/i,
  );
  if (ddm) {
    let lat = +ddm[1] + +ddm[2] / 60;
    let lng = +ddm[4] + +ddm[5] / 60;
    if (/S/i.test(ddm[3])) lat = -lat;
    if (/W/i.test(ddm[6])) lng = -lng;
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)
      return { lat, lng };
  }
  // 3. Full DMS: "29°57'40N 30°59'14E"
  const dms = str.match(
    /(\d+)[°d](\d+)['^m](\d+\.?\d*)["s]?\s*([NS])[,\s]+(\d+)[°d](\d+)['^m](\d+\.?\d*)["s]?\s*([EW])/i,
  );
  if (dms) {
    let lat = +dms[1] + +dms[2] / 60 + +dms[3] / 3600;
    let lng = +dms[5] + +dms[6] / 60 + +dms[7] / 3600;
    if (/S/i.test(dms[4])) lat = -lat;
    if (/W/i.test(dms[8])) lng = -lng;
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)
      return { lat, lng };
  }
  return null;
}

// Normalize a Visit into the payload the findings API expects (fills required fields).
function toVisitPayload(v: Visit): findingsApi.VisitPayload {
  return {
    id: v.id,
    visitDate: v.visitDate,
    categoryId: v.categoryId,
    label: v.label || "",
    notes: v.notes || "",
    escalatedToId: v.escalatedToId || "",
    statusId: v.statusId,
    photos: v.photos || [],
  };
}

// Convert a base64 data URL (e.g. from canvas.toDataURL) into a Blob for upload.
function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(",");
  const mime = header.match(/data:([^;]+)/)?.[1] || "image/jpeg";
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function FrontendPage() {
  const { user, logout } = useAuth();
  const confirm = useConfirm();
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSite, setSelectedSite] = useState<Site | null>(null);
  const [loadingSites, setLoadingSites] = useState(true);

  // Core map state variables
  const [findings, setFindings] = useState<Finding[]>([]);
  const [constructionZones, setConstructionZones] = useState<
    ConstructionZone[]
  >([]);
  const [parcels, setParcels] = useState<Parcel[]>([]);
  const [apiCategories, setApiCategories] = useState<Category[]>([]);
  const [apiStatuses, setApiStatuses] = useState<Status[]>([]);
  const [apiEscalations, setApiEscalations] = useState<EscalationOption[]>([]);

  // Filtering states (legacy toggle buttons in header)
  const [hideResolved, setHideResolved] = useState(false);
  const [hideConstr, setHideConstr] = useState(false);
  const [onlyConstr, setOnlyConstr] = useState(false);

  // Drawing state
  const [activeTool, setActiveTool] = useState<"none" | "finding" | "zone">(
    "none",
  );

  // Bumped each time the Leaflet map (re)initializes, so the overlay-render effect
  // re-runs and draws markers even if findings arrived before the map was ready.
  const [mapReady, setMapReady] = useState(0);

  // Notification overlays
  const [notifText, setNotifText] = useState<string | null>(null);

  // Modal overlay details
  const [modalOpen, setModalOpen] = useState(false);

  const refsFetched = useRef(false);
  useEffect(() => {
    if (!refsFetched.current) {
      refsFetched.current = true;
      findingsApi
        .getReferences()
        .then((refs) => {
          if (refs.categories?.length) setApiCategories(refs.categories);
          if (refs.statuses?.length) setApiStatuses(refs.statuses);
          if (refs.escalations?.length) setApiEscalations(refs.escalations);
        })
        .catch(console.error);
    }
  }, [modalOpen]);

  const [modalTitle, setModalTitle] = useState("🔍 Add Finding");
  const [editLocId, setEditLocId] = useState<string | null>(null);
  const [editVisitId, setEditVisitId] = useState<string | null>(null);

  // Form inputs inside modal
  const [inputCoords, setInputCoords] = useState("");
  const [inputParcel, setInputParcel] = useState("");
  const [inputRefNum, setInputRefNum] = useState("");
  const [inputDate, setInputDate] = useState("");
  const [inputLabel, setInputLabel] = useState("");
  const [inputNotes, setInputNotes] = useState("");
  const [inputEscalated, setInputEscalated] = useState("");
  const [selectedCat, setSelectedCat] = useState("");
  const [selectedStat, setSelectedStat] = useState<string>("");
  const [pendingPhotos, setPendingPhotos] = useState<string[]>([]);

  // Lightbox & PDF settings
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [pdfModalOpen, setPdfModalOpen] = useState(false);
  const [pdfSort, setPdfSort] = useState<
    "number" | "category" | "escalated" | "quadrant"
  >("number");

  // Map references
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const findingsLayerRef = useRef<L.FeatureGroup | null>(null);
  const constrLayerRef = useRef<L.FeatureGroup | null>(null);

  // Temporary container for clicked lat/lng
  const pendingClickRef = useRef<L.LatLng | null>(null);

  // Live refs for data the map's click handler reads, so the map effect does not
  // need to re-initialize (which would tear down and rebuild the whole map) when
  // findings/parcels change.
  const parcelsRef = useRef<Parcel[]>([]);
  const findingsRef = useRef<Finding[]>([]);
  useEffect(() => {
    parcelsRef.current = parcels;
  }, [parcels]);
  useEffect(() => {
    findingsRef.current = findings;
  }, [findings]);

  // Notification helper
  function showNotif(msg: string) {
    setNotifText(msg);
    setTimeout(() => {
      setNotifText((prev) => (prev === msg ? null : prev));
    }, 3000);
  }

  // Load sites on mount
  useEffect(() => {
    setLoadingSites(true);
    api<{ data: Site[] }>("/api/sites")
      .then((res) => {
        // Show only the sites assigned to the logged-in user. The server already
        // scopes non-admins; this also restricts admins to their own assignments.
        // If the user has no assignments, fall back to the full list so they aren't
        // locked out entirely.
        const assigned = user?.siteIds || [];
        const scoped = assigned.length
          ? res.data.filter((s) => assigned.includes(s.id))
          : res.data;
        const visible = scoped.length ? scoped : res.data;

        setSites(visible);
        const lastSiteId = localStorage.getItem("_pt_last_site_id");
        const found = visible.find((s) => String(s.id) === lastSiteId);
        setSelectedSite(found || visible[0] || null);
      })
      .catch(() => showNotif("❌ Failed to load sites list"))
      .finally(() => setLoadingSites(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.siteIds?.join(",")]);

  // Reload findings + zones for a site from the server. Parcels come from the
  // backend too, falling back to the built-in list when a site has none uploaded.
  const reloadData = useCallback(async (site: Site) => {
    try {
      const [finds, zones] = await Promise.all([
        findingsApi.listFindings(site.id),
        findingsApi.listZones(site.id),
      ]);
      setFindings(finds);
      setConstructionZones(zones);
    } catch (e) {
      showNotif("❌ Failed to load findings");
    }

    // Parcels are non-critical: fall back to the built-in list on failure/empty.
    try {
      const res = await api<{
        parcels: Array<{
          id: string;
          parcel_name: string;
          lat: number;
          lng: number;
          quadrant: string;
        }>;
      }>(`/api/parcels${qs({ siteId: site.id })}`);
      const mapped: Parcel[] = (res.parcels || [])
        .filter((p) => p.lat != null && p.lng != null)
        .map((p) => ({
          id: p.id,
          name: p.parcel_name,
          lat: Number(p.lat),
          lng: Number(p.lng),
          quad: p.quadrant || "",
        }));
      setParcels(mapped.length ? mapped : _BUILTIN_PARCELS);
    } catch (e) {
      setParcels(_BUILTIN_PARCELS);
    }
  }, []);

  // Sync state data on selected site changes
  useEffect(() => {
    if (!selectedSite) return;
    localStorage.setItem("_pt_last_site_id", String(selectedSite.id));
    reloadData(selectedSite);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSite?.id, reloadData]);

  // Leaflet Map initialization
  useEffect(() => {
    if (!mapContainerRef.current || !selectedSite) return;

    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }

    const map = L.map(mapContainerRef.current, {
      center: [
        selectedSite.map_center_lat || 27.3949,
        selectedSite.map_center_lng || 33.6782,
      ],
      zoom: selectedSite.default_zoom || 14,
      zoomControl: true,
    });
    mapRef.current = map;

    const osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 20,
    });
    const voyager = L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
      {
        attribution: "© CARTO",
        subdomains: "abcd",
        maxZoom: 20,
      },
    );
    const satellite = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      {
        attribution: "© Esri",
        maxZoom: 20,
      },
    );

    osm.addTo(map);

    L.control
      .layers(
        {
          "🌍 OpenStreetMap": osm,
          "🗺 Voyager (CARTO)": voyager,
          "🛰 Satellite (Esri)": satellite,
        },
        {},
        { position: "topright", collapsed: true },
      )
      .addTo(map);

    findingsLayerRef.current = L.featureGroup().addTo(map);
    constrLayerRef.current = L.featureGroup().addTo(map);

    // Map drawing click listeners
    map.on("click", (e: L.LeafletMouseEvent) => {
      setActiveTool((tool) => {
        if (tool === "finding") {
          pendingClickRef.current = e.latlng;
          const lat = parseFloat(e.latlng.lat.toFixed(6));
          const lng = parseFloat(e.latlng.lng.toFixed(6));

          // Auto detect nearest parcel
          let matched = "";
          let minDist = Infinity;
          parcelsRef.current.forEach((p) => {
            const dist = Math.hypot(p.lat - lat, p.lng - lng);
            if (dist < minDist) {
              minDist = dist;
              matched = p.id || "";
            }
          });

          // Prefill form fields
          setInputCoords(`${lat}, ${lng}`);
          setInputParcel(matched);
          const maxRef = findingsRef.current.reduce(
            (mx, f) => Math.max(mx, parseInt(f.ref_num) || 0),
            0,
          );
          setInputRefNum(String(maxRef + 1).padStart(3, "0"));
          setInputDate(new Date().toISOString().slice(0, 10));
          setInputLabel("");
          setInputNotes("");
          setInputEscalated("");
          setSelectedCat(apiCategories[0]?.id || "");
          setSelectedStat(apiStatuses[0]?.id || "");
          setPendingPhotos([]);
          setEditLocId(null);
          setEditVisitId(null);

          setModalTitle("🔍 Add Finding");
          setModalOpen(true);
        } else if (tool === "zone") {
          if (!selectedSite) return "none";
          const lat = parseFloat(e.latlng.lat.toFixed(6));
          const lng = parseFloat(e.latlng.lng.toFixed(6));
          findingsApi
            .createZone(selectedSite.id, { lat, lng })
            .then((res) => {
              const newCz: ConstructionZone = {
                id: res.id,
                lat,
                lng,
                createdAt: new Date().toISOString(),
              };
              setConstructionZones((prev) => [...prev, newCz]);
              showNotif("🏗 Construction zone added");
            })
            .catch(() => showNotif("❌ Failed to add construction zone"));
        }
        return "none";
      });
    });

    setTimeout(() => mapRef.current!.invalidateSize(), 150);

    // Signal that the map + its layer groups are ready so overlays render even if
    // findings loaded before this effect ran.
    setMapReady((n) => n + 1);

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // Initialize the map once per site. Data (findings/parcels) is read via refs
    // inside the click handler and drawn by the separate overlay-render effect.
  }, [selectedSite]);

  // Bind edit and delete click handlers inside Leaflet Popups
  useEffect(() => {
    const handlePopupClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        !target.classList.contains("fi-del-btn") &&
        !target.classList.contains("fi-add-btn") &&
        !target.classList.contains("fi-popup-photo")
      )
        return;

      const locId = target.getAttribute("data-locid");
      const visitId = target.getAttribute("data-visitid");

      if (target.classList.contains("fi-popup-photo")) {
        const src = target.getAttribute("src");
        if (src) setLightboxSrc(src);
        return;
      }

      if (target.textContent?.includes("delete")) {
        if (locId && visitId && selectedSite) {
          confirm({
            title: "Delete visit?",
            message: "Delete this visit from the inspection history?",
            confirmLabel: "Delete",
            danger: true,
          }).then((ok) => {
            if (!ok) return;
            findingsApi
              .deleteVisit(selectedSite.id, locId, visitId)
              .then(() => {
                setFindings((prev) => {
                  let next = prev.map((loc) => {
                    if (loc.id !== locId) return loc;
                    return {
                      ...loc,
                      visits: loc.visits.filter((v) => v.id !== visitId),
                    };
                  });
                  // Remove findings with empty visits timeline (backend cascades separately if last).
                  next = next.filter((loc) => loc.visits.length > 0);
                  return next;
                });
                showNotif("🗑 Visit deleted");
                mapRef.current?.closePopup();
              })
              .catch(() => showNotif("❌ Failed to delete visit"));
          });
        }
      } else if (target.textContent?.includes("edit")) {
        if (locId && visitId) {
          const loc = findings.find((f) => f.id === locId);
          const visit = loc?.visits.find((v) => v.id === visitId);
          if (loc && visit) {
            setEditLocId(locId);
            setEditVisitId(visitId);
            setInputCoords(`${loc.lat}, ${loc.lng}`);
            setInputParcel(loc.parcel_id || "");
            setInputRefNum(loc.ref_num);
            setInputDate(visit.visitDate);
            setInputLabel(visit.label);
            setInputNotes(visit.notes);
            setInputEscalated(visit.escalatedToId);
            setSelectedCat(visit.categoryId);
            setSelectedStat(visit.statusId);
            setPendingPhotos(visit.photos || []);

            setModalTitle("✏️ Edit Visit Details");
            setModalOpen(true);
            mapRef.current?.closePopup();
          }
        }
      } else if (target.classList.contains("fi-add-btn")) {
        if (locId) {
          const loc = findings.find((f) => f.id === locId);
          if (loc) {
            setEditLocId(locId);
            setEditVisitId(null);
            setInputCoords(`${loc.lat}, ${loc.lng}`);
            setInputParcel(loc.parcel_id || "");
            setInputRefNum(loc.ref_num);
            const date = new Date();
            setInputDate(
              `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
            );
            setInputLabel("");
            setInputNotes("");
            setInputEscalated("");
            setSelectedCat(
              loc.visits[0]?.categoryId || apiCategories[0]?.id || "",
            );
            setSelectedStat(apiStatuses[0]?.id || "");
            setPendingPhotos([]);

            setModalTitle("✏️ Record Inspect Visit");
            setModalOpen(true);
            mapRef.current?.closePopup();
          }
        }
      }
    };

    document.addEventListener("click", handlePopupClick);
    return () => {
      document.removeEventListener("click", handlePopupClick);
    };
  }, [findings, selectedSite]);

  // Render map overlays on change
  useEffect(() => {
    const map = mapRef.current;
    const fLayer = findingsLayerRef.current;
    const cLayer = constrLayerRef.current;
    if (!map || !fLayer || !cLayer) return;

    fLayer.clearLayers();
    cLayer.clearLayers();

    // Render Construction Zones — shown whenever they aren't explicitly hidden.
    // "Only Constr." hides findings (below), it does not hide the zones themselves.
    if (!hideConstr) {
      constructionZones.forEach((cz) => {
        const marker = L.marker([cz.lat, cz.lng], { icon: makeZoneIcon() });
        marker.on("click", () => {
          if (user?.role === "client_viewer" || !selectedSite) return;
          confirm({
            title: "Remove construction zone?",
            message: "This construction zone marker will be removed.",
            confirmLabel: "Remove",
            danger: true,
          }).then((ok) => {
            if (!ok) return;
            findingsApi
              .deleteZone(selectedSite.id, cz.id)
              .then(() => {
                setConstructionZones((prev) =>
                  prev.filter((c) => c.id !== cz.id),
                );
                showNotif("🗑 Construction zone removed");
              })
              .catch(() => showNotif("❌ Failed to remove construction zone"));
          });
        });
        cLayer.addLayer(marker);
      });
    }

    // Render Findings
    if (!onlyConstr) {
      const visible = findings.filter((f) => {
        const latest = f.visits[0];
        if (!latest) return false;
        if (hideResolved && latest.statusId === "resolved") return false;
        return true;
      });

      // Cluster displacement
      const zoom = mapRef.current!.getZoom();
      const TS = Math.max(2.2, Math.min(5.0, 2.2 + (zoom - 14) * 0.45));
      const CLUSTER_THRESH = TS * 0.003;
      const DISP_R = TS * 0.0022;

      const assigned = new Array(visible.length).fill(-1);
      const clusters: number[][] = [];
      for (let i = 0; i < visible.length; i++) {
        if (assigned[i] >= 0) continue;
        const cl = [i];
        assigned[i] = clusters.length;
        for (let j = i + 1; j < visible.length; j++) {
          if (assigned[j] >= 0) continue;
          const dx = visible[i].lat - visible[j].lat;
          const dy = visible[i].lng - visible[j].lng;
          if (Math.hypot(dx, dy) < CLUSTER_THRESH) {
            cl.push(j);
            assigned[j] = clusters.length;
          }
        }
        clusters.push(cl);
      }

      const displayPoints = visible.map((f) => ({ lat: f.lat, lng: f.lng }));
      clusters.forEach((cl) => {
        if (cl.length === 1) return;
        const clat =
          cl.reduce((sum, idx) => sum + visible[idx].lat, 0) / cl.length;
        const clng =
          cl.reduce((sum, idx) => sum + visible[idx].lng, 0) / cl.length;
        cl.forEach((idx, i) => {
          const angle = (2 * Math.PI * i) / cl.length - Math.PI / 2;
          displayPoints[idx].lat = clat + DISP_R * Math.cos(angle);
          displayPoints[idx].lng = clng + DISP_R * Math.sin(angle);
        });
      });

      const isClientViewer = user?.role === "client_viewer";
      const refs = {
        categories: apiCategories,
        statuses: apiStatuses,
        escalations: apiEscalations,
      };
      visible.forEach((f, idx) => {
        if (!f.visits[0]) return;
        const marker = L.marker(
          [displayPoints[idx].lat, displayPoints[idx].lng],
          {
            icon: makeFindingIcon(f, refs),
          },
        );
        marker.bindPopup(buildFindingPopupHtml(f, isClientViewer, refs), {
          className: "leaflet-popup-legacy p-0 overflow-hidden",
        });
        fLayer.addLayer(marker);
      });
    }
  }, [
    findings,
    constructionZones,
    hideResolved,
    hideConstr,
    onlyConstr,
    user,
    mapReady,
    apiCategories,
    apiStatuses,
    apiEscalations,
  ]);

  // Photo compressor
  function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const maxDim = 500;
          let w = img.width;
          let h = img.height;
          if (w > maxDim || h > maxDim) {
            if (w > h) {
              h = Math.round((h * maxDim) / w);
              w = maxDim;
            } else {
              w = Math.round((w * maxDim) / h);
              h = maxDim;
            }
          }
          canvas.width = w;
          canvas.height = h;
          canvas.getContext("2d")?.drawImage(img, 0, 0, w, h);
          const compressed = canvas.toDataURL("image/jpeg", 0.7);
          setPendingPhotos((prev) => [...prev, compressed]);
        };
        img.src = event.target?.result as string;
      };
      reader.readAsDataURL(file);
    });
  }

  // Upload any base64 data-URL photos to S3, returning the final list of URLs
  // Returns displayable photo URLs: existing presigned URLs pass through, and any
  // new base64 photos are uploaded to S3 (bucket is private, so we use the presigned
  // URLs the upload returns). The backend normalizes these back to S3 keys on save.
  async function resolvePhotoUrls(
    site: Site,
    photos: string[],
  ): Promise<string[]> {
    const existing = photos.filter((p) => /^https?:\/\//.test(p));
    const dataUrls = photos.filter((p) => p.startsWith("data:"));
    if (!dataUrls.length) return existing;
    const blobs = dataUrls.map((d) => dataUrlToBlob(d));
    const { urls } = await findingsApi.uploadPhotos(site.id, blobs);
    return [...existing, ...urls];
  }

  // Save finding handler handles: create, add visit, and edit visit
  async function handleSaveFinding() {
    if (!selectedSite) return;
    const site = selectedSite;

    // Validate create-mode inputs up front (before any async work).
    let createLL: { lat: number; lng: number } | null = null;
    if (!editLocId) {
      const parsedLL = inputCoords ? parseCoords(inputCoords) : null;
      createLL =
        parsedLL ||
        (pendingClickRef.current
          ? {
              lat: pendingClickRef.current.lat,
              lng: pendingClickRef.current.lng,
            }
          : null);
      if (!createLL) {
        showNotif("⚠️ Enter valid GPS coordinates or click the map first");
        return;
      }
      if (!inputParcel) {
        showNotif("⚠️ Please select a parcel location");
        return;
      }
    }

    try {
      const photoUrls = await resolvePhotoUrls(site, pendingPhotos);

      if (!editLocId && createLL) {
        // 1. Create Mode
        const newV: Omit<Visit, "id"> = {
          visitDate: inputDate || new Date().toISOString().slice(0, 10),
          categoryId: String(selectedCat),
          label: inputLabel.trim(),
          notes: inputNotes.trim(),
          escalatedToId: inputEscalated,
          statusId: String(selectedStat),
          photos: photoUrls,
        };
        const res = await findingsApi.createFinding({
          siteId: site.id,
          lat: createLL.lat,
          lng: createLL.lng,
          parcel_id: inputParcel,
          ref_num: inputRefNum || "001",
          visit: { ...newV, photos: photoUrls },
        });

        const createdFinding = res.finding;

        const updatedFindings = await findingsApi.listFindings(site.id);
        setFindings(updatedFindings);
        showNotif("✅ Finding saved");
      } else if (editLocId && editVisitId) {
        // 2. Edit Visit Mode
        const payload: findingsApi.VisitPayload = {
          id: editVisitId,
          visitDate: inputDate,
          categoryId: String(selectedCat),
          label: inputLabel.trim(),
          notes: inputNotes.trim(),
          escalatedToId: inputEscalated,
          statusId: String(selectedStat),
          photos: photoUrls,
        };
        await findingsApi.editVisit(site.id, editLocId, editVisitId, payload);
        const updatedFindings = await findingsApi.listFindings(site.id);
        setFindings(updatedFindings);
        showNotif("✅ Inspection visit updated");
      } else if (editLocId) {
        // 3. Add Visit Mode
        const newV: Omit<Visit, "id"> = {
          visitDate: inputDate || new Date().toISOString().slice(0, 10),
          categoryId: String(selectedCat),
          label: inputLabel.trim(),
          notes: inputNotes.trim(),
          escalatedToId: inputEscalated,
          statusId: String(selectedStat),
          photos: photoUrls,
        };
        const res = await findingsApi.addVisit(site.id, editLocId, {
          ...newV,
          photos: photoUrls,
        });
        const updatedFindings = await findingsApi.listFindings(site.id);
        setFindings(updatedFindings);
        showNotif("✅ Visit recorded");
      }
    } catch (e) {
      showNotif(`❌ ${(e as Error).message || "Failed to save"}`);
      return;
    }

    setModalOpen(false);
    setEditLocId(null);
    setEditVisitId(null);
    pendingClickRef.current = null;
  }

  // PDF report builder matches the layout specifications exactly
  async function generatePdfReport(
    sortBy: "number" | "category" | "escalated" | "quadrant" = "number",
  ) {
    const site = selectedSite;
    const map = mapRef.current;
    if (!map) return;
    if (!findings || findings.length === 0) {
      showNotif("⚠️ No findings to export", true, 3000);
      return;
    }
    showNotif("⏳ Initialising…", false, 0);

    // Yield to let UI update, then run async
    await new Promise((r) => setTimeout(r, 50));

    // Ensure CDN libs are ready (they should be in <head> but add fallback)
    if (!window.jspdf) {
      try {
        await new Promise((res, rej) => {
          const s = document.createElement("script");
          s.src =
            "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
          s.onload = res;
          s.onerror = () => rej(new Error("Failed to load jsPDF"));
          document.head.appendChild(s);
        });
      } catch (e) {
        showNotif(
          "❌ No internet connection — PDF requires online access",
          true,
          5000,
        );
        return;
      }
    }
    if (!window.html2canvas) {
      try {
        await new Promise((res, rej) => {
          const s = document.createElement("script");
          s.src =
            "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
          s.onload = res;
          s.onerror = () => rej(new Error("Failed to load html2canvas"));
          document.head.appendChild(s);
        });
      } catch (e) {
        showNotif(
          "❌ No internet connection — PDF requires online access",
          true,
          5000,
        );
        return;
      }
    }

    try {
      const { jsPDF } = window.jspdf;

      // ── Page dimensions ───────────────────────────────────────────
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });
      // Map pages are now PORTRAIT — taller map area lets the site fill the
      // page at a higher zoom. Variable names kept from the landscape version.
      const LW = 210,
        LH = 297; // map-page dims (portrait)
      const PW = 210,
        PH = 297; // portrait dims
      const ML = 14,
        MR = 14,
        MB = 10;
      const HDR = 12; // header height

      const STAT_COLORS = {
        open: "#FB923C",
        repeat: "#EF4444",
        resolved: "#22C55E",
      };
      const STAT_LABELS = {
        open: "1st Offense",
        repeat: "Repeat",
        resolved: "Resolved",
      };
      // Built from the dashboard's CATS so PDF labels always match exactly
      const CAT_LABELS = Object.fromEntries(
        (apiCategories || []).map((c) => [c.id, c.label]),
      );
      const CLIENT = site?.name || "El Gouna";

      function hexToRgb(h) {
        h = h.replace("#", "");
        return [
          parseInt(h.slice(0, 2), 16),
          parseInt(h.slice(2, 4), 16),
          parseInt(h.slice(4, 6), 16),
        ];
      }
      function pdfText(str: any) {
        if (str == null) return "";
        return String(str)
          .replace(/[\u{1F300}-\u{1FFFF}\u{2600}-\u{27BF}]/gu, "")
          .replace(/[^\x00-\xFF]/g, "")
          .trim();
      }
      function stripZeros(ref) {
        return ref ? String(parseInt(ref, 10) || ref) : "?";
      }

      showNotif("⏳ Step 1/4: Loading logo…", false, 0);
      const logoCanvas = document.createElement("canvas");
      const li = new Image();
      await new Promise((r) => {
        li.onload = r;
        li.onerror = r;
        li.src = LOGO_PESTRACK;
      });
      logoCanvas.width = li.naturalWidth || 400;
      logoCanvas.height = li.naturalHeight || 120;
      logoCanvas.getContext("2d").drawImage(li, 0, 0);

      // Preload construction icons (cons.png composite for map markers; single excavator for legend)
      let constrMapImgData = null,
        constrMapAspect = 1.207;
      let constrLegendImgData = null;
      try {
        const _ciMap = new Image();
        await new Promise((r) => {
          _ciMap.onload = r;
          _ciMap.onerror = r;
          _ciMap.src = CONSTR_MAP_ICON_DATA;
        });
        const _cMapCv = document.createElement("canvas");
        _cMapCv.width = _ciMap.naturalWidth || 309;
        _cMapCv.height = _ciMap.naturalHeight || 256;
        _cMapCv.getContext("2d").drawImage(_ciMap, 0, 0);
        constrMapImgData = _cMapCv.toDataURL("image/png");
        constrMapAspect = _cMapCv.width / _cMapCv.height;

        const _ciLeg = new Image();
        await new Promise((r) => {
          _ciLeg.onload = r;
          _ciLeg.onerror = r;
          _ciLeg.src = CONSTR_LEGEND_ICON_DATA;
        });
        const _cLegCv = document.createElement("canvas");
        _cLegCv.width = _ciLeg.naturalWidth || 168;
        _cLegCv.height = _ciLeg.naturalHeight || 168;
        _cLegCv.getContext("2d").drawImage(_ciLeg, 0, 0);
        constrLegendImgData = _cLegCv.toDataURL("image/png");
      } catch (e) {
        console.warn("Construction icon preload failed:", e);
      }

      function drawHeader(w, title, sub) {
        pdf.setFillColor(255, 255, 255);
        pdf.rect(0, 0, w, HDR, "F");
        pdf.setDrawColor(220, 225, 236);
        pdf.setLineWidth(0.3);
        pdf.line(0, HDR, w, HDR);
        const lh = 8,
          lw = lh * (logoCanvas.width / logoCanvas.height);
        pdf.addImage(logoCanvas.toDataURL("image/png"), "PNG", ML, 2, lw, lh);
        pdf.setTextColor(28, 35, 51);
        pdf.setFontSize(8.5);
        pdf.setFont("helvetica", "bold");
        pdf.text(title, w / 2, 6, { align: "center" });
        pdf.setFontSize(6);
        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(100, 110, 130);
        pdf.text(sub, w / 2, 10.5, { align: "center" });
      }

      // ── PAGE 1: Portrait map — resize map to A4 portrait ratio first ──
      const mapEl = mapContainerRef.current;
      const mapPxW = mapEl.offsetWidth;

      // Target height for A4 portrait ratio (no bottom margin — legend overlays map)
      const mapAreaH = LH - HDR; // 285mm (portrait)
      const a4ratio = LW / mapAreaH; // 210/285 ≈ 0.74 (tall)
      const targetPxH = Math.round(mapPxW / a4ratio);
      const origStyle = mapEl.style.height;

      showNotif("⏳ Step 2/4: Capturing map…", false, 0);

      // Snapshot toggle state at PDF generation time (needed now to know what to zoom to)
      const PDF_HIDE_CONSTR = !!window._hideConstr;
      const PDF_HIDE_FINDINGS = !!window._hideFindings;
      const PDF_HIDE_RESOLVED = !!window._hideResolved;
      // Filter findings by hide-resolved toggle for marker generation, counts, and detail pages
      const visibleFindings = PDF_HIDE_RESOLVED
        ? findings.filter((loc) => {
            const latest = loc.visits && loc.visits[0];
            return !(
              latest &&
              apiStatuses
                .find((s) => s.id === latest.statusId)
                ?.name?.toLowerCase() === "resolved"
            );
          })
        : findings;

      // Remember the user's current view so we can restore it after capture
      const origCenter = mapRef.current!.getCenter();
      const origZoom = mapRef.current!.getZoom();

      // Temporarily resize map to A4 portrait proportions
      mapEl.style.height = targetPxH + "px";
      mapRef.current!.invalidateSize();

      // ── AUTO-ZOOM: fit the tall viewport tightly around the actual data ──
      // This is the point of portrait — the site fills the page at the highest
      // zoom that still contains every finding (+ construction zones).
      const fitBounds = L.latLngBounds([]);
      if (!PDF_HIDE_FINDINGS)
        visibleFindings.forEach((l) => fitBounds.extend([l.lat, l.lng]));
      if (!PDF_HIDE_CONSTR)
        (constructionZones || []).forEach((cz) =>
          fitBounds.extend([cz.lat, cz.lng]),
        );
      if (fitBounds.isValid()) {
        mapRef.current!.fitBounds(fitBounds, {
          padding: [40, 40],
          maxZoom: 17,
          animate: false,
        });
      }
      await new Promise((r) => setTimeout(r, 900)); // let tiles settle (taller portrait capture)
      const captureZoom = mapRef.current!.getZoom(); // zoom used for marker-size scaling

      // Hide finding markers, construction icons, AND layer control during capture
      // (construction icons would otherwise be double-drawn — captured by html2canvas
      //  AND drawn explicitly via pdf.addImage below)
      const fiMarkers = mapEl.querySelectorAll(".fi-marker-wrap");
      fiMarkers.forEach((el) => (el.style.visibility = "hidden"));
      const czMarkers = mapEl.querySelectorAll(".cz-divicon");
      czMarkers.forEach((el) => (el.style.visibility = "hidden"));
      const layerCtrl = mapEl.closest("#map")
        ? document.querySelector(".leaflet-control-layers")
        : null;
      const layerCtrlEl = document.querySelector(".leaflet-control-layers");
      if (layerCtrlEl) layerCtrlEl.style.display = "none";
      await new Promise((r) => setTimeout(r, 200));

      const mapCanvas = await html2canvas(mapEl, {
        scale: 1.5,
        useCORS: true,
        backgroundColor: "#e8e0d8",
        logging: false,
        width: mapPxW,
        height: targetPxH,
      });
      const mapImg = mapCanvas.toDataURL("image/jpeg", 0.88);

      // ── Capture container points BEFORE restoring map size ────────
      // latLngToContainerPoint must be called while map is still at targetPxH,
      // otherwise pt.y is against a different height than the scaling math uses.
      showNotif("⏳ Step 3/4: Drawing markers…", false, 0);
      const drawX = 0,
        drawY = HDR,
        drawW = LW,
        drawH = mapAreaH;

      const markers = visibleFindings.map((loc) => {
        const pt = mapRef.current!.latLngToContainerPoint([loc.lat, loc.lng]);
        const px = drawX + (pt.x / mapPxW) * drawW;
        const py = drawY + (pt.y / targetPxH) * drawH;
        return { loc, px, py, ax: px, ay: py };
      });

      // Capture construction-zone container points BEFORE map restore — same reason as findings
      const _czRaw = constructionZones || [];
      const czPoints = _czRaw.map((cz) => {
        const pt = mapRef.current!.latLngToContainerPoint([cz.lat, cz.lng]);
        const cx = drawX + (pt.x / mapPxW) * drawW;
        const cy = drawY + (pt.y / targetPxH) * drawH;
        return { cx, cy };
      });

      // Measure the page-mm length of 1 km BEFORE map restore.
      // Offset the map centre by 1000 m of longitude and project both points.
      const _sc = mapRef.current!.getCenter();
      const _dLng = 1000 / (111320 * Math.cos((_sc.lat * Math.PI) / 180));
      const _p0 = mapRef.current!.latLngToContainerPoint([_sc.lat, _sc.lng]);
      const _p1 = mapRef.current!.latLngToContainerPoint([
        _sc.lat,
        _sc.lng + _dLng,
      ]);
      const KM_MM = (Math.abs(_p1.x - _p0.x) / mapPxW) * drawW; // mm per 1 km

      // Restore map to original size AND view AFTER coordinate capture
      fiMarkers.forEach((el) => (el.style.visibility = ""));
      czMarkers.forEach((el) => (el.style.visibility = ""));
      if (layerCtrlEl) layerCtrlEl.style.display = "";
      mapEl.style.height = origStyle || "";
      mapRef.current!.invalidateSize();
      mapRef.current!.setView(origCenter, origZoom, { animate: false });

      // Draw header on page 1
      drawHeader(
        LW,
        `SITE FINDINGS REPORT — ${site?.name}`,
        `${visibleFindings.length} location${visibleFindings.length !== 1 ? "s" : ""}  ·  ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`,
      );

      // Map fills from below header to bottom of page
      pdf.addImage(mapImg, "JPEG", 0, HDR, LW, mapAreaH);

      // ── Cluster detection & radial displacement ───────────────────
      // Scale marker size with the zoom the map was CAPTURED at
      const zoom = captureZoom;
      const TS = Math.max(2.2, Math.min(5.0, 2.2 + (zoom - 14) * 0.45)); // mm half-width
      const dotR = Math.max(1.0, TS * 0.38);
      const lblFont = Math.max(3.2, TS * 0.82);
      const numFont = Math.max(3.0, TS * 0.75);
      const CLUSTER_THRESH = TS * 3;
      const DISP_R = TS * 3.2;

      const assigned = new Array(markers.length).fill(-1);
      const clusters = [];
      for (let i = 0; i < markers.length; i++) {
        if (assigned[i] >= 0) continue;
        const cl = [i];
        assigned[i] = clusters.length;
        for (let j = i + 1; j < markers.length; j++) {
          if (assigned[j] >= 0) continue;
          const dx = markers[i].px - markers[j].px,
            dy = markers[i].py - markers[j].py;
          if (Math.sqrt(dx * dx + dy * dy) < CLUSTER_THRESH) {
            cl.push(j);
            assigned[j] = clusters.length;
          }
        }
        clusters.push(cl);
      }

      clusters.forEach((cl) => {
        if (cl.length === 1) return;
        const cx = cl.reduce((s, i) => s + markers[i].px, 0) / cl.length;
        const cy = cl.reduce((s, i) => s + markers[i].py, 0) / cl.length;
        cl.forEach((mi, idx) => {
          const angle = (2 * Math.PI * idx) / cl.length - Math.PI / 2;
          markers[mi].px = cx + DISP_R * Math.cos(angle);
          markers[mi].py = cy + DISP_R * Math.sin(angle);
        });
      });

      // ── Build photo thumbnails — FIRST photo ever uploaded per location ──
      // Visits are sorted newest-first, so scan from the END (oldest visit).
      const THW = Math.max(13, TS * 3.6); // thumbnail edge length, mm
      const CR = Math.max(2.4, TS * 1.1); // status circle radius, mm
      const thumbs = {}; // locId → square JPEG dataURL

      function _firstPhotoB64(loc) {
        for (let i = loc.visits.length - 1; i >= 0; i--) {
          const ph = loc.visits[i] && loc.visits[i].photos;
          if (ph && ph.length) return ph[0];
        }
        return null;
      }
      function _makeThumb(b64) {
        return new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            try {
              const S = 220; // px — crisp at print size, tiny file weight
              const side = Math.min(img.width, img.height);
              const sx = (img.width - side) / 2,
                sy = (img.height - side) / 2;
              const c = document.createElement("canvas");
              c.width = S;
              c.height = S;
              c.getContext("2d").drawImage(img, sx, sy, side, side, 0, 0, S, S);
              resolve(c.toDataURL("image/jpeg", 0.72));
            } catch (e) {
              resolve(null);
            }
          };
          img.onerror = () => resolve(null);
          img.src = b64;
        });
      }
      if (!PDF_HIDE_FINDINGS) {
        for (const m of markers) {
          const b64 = _firstPhotoB64(m.loc);
          if (b64) {
            const t = await _makeThumb(b64);
            if (t) thumbs[m.loc.locId] = t;
          }
        }
      }

      // ── Place thumbnails — choose a ray direction per marker that ──
      //    keeps the photo on the page, off the legend, and clear of
      //    already-placed thumbnails and other markers.
      const placedBoxes = [];
      const legendKeepout = { x: 0, y: LH - 14, w: 120, h: 14 };
      const scaleKeepout = {
        x: LW - 12 - KM_MM,
        y: LH - 13,
        w: KM_MM + 12,
        h: 13,
      };
      function _boxesOverlap(a, b, gap) {
        return !(
          a.x + a.w + gap < b.x ||
          b.x + b.w + gap < a.x ||
          a.y + a.h + gap < b.y ||
          b.y + b.h + gap < a.y
        );
      }
      const RAY_LEN = THW * 0.85 + TS * 2.2;
      const RAY_ANGLES = [
        -60, -120, -30, -150, 30, 150, 60, 120, 0, 180, -90, 90,
      ].map((d) => (d * Math.PI) / 180);

      if (!PDF_HIDE_FINDINGS)
        markers.forEach((m) => {
          if (!thumbs[m.loc.locId]) return;
          let best = null,
            bestScore = Infinity;
          for (const ang of RAY_ANGLES) {
            const tcx = m.ax + RAY_LEN * Math.cos(ang);
            const tcy = m.ay + RAY_LEN * Math.sin(ang);
            const box = { x: tcx - THW / 2, y: tcy - THW / 2, w: THW, h: THW };
            if (
              box.x < 1 ||
              box.x + box.w > LW - 1 ||
              box.y < HDR + 4 ||
              box.y + box.h > LH - 2
            )
              continue;
            let score = 0;
            if (_boxesOverlap(box, legendKeepout, 0)) score += 4;
            if (_boxesOverlap(box, scaleKeepout, 0)) score += 4;
            placedBoxes.forEach((pb) => {
              if (_boxesOverlap(box, pb, 1)) score += 3;
            });
            markers.forEach((o) => {
              if (o === m) return;
              if (
                o.ax > box.x - CR - 1 &&
                o.ax < box.x + box.w + CR + 1 &&
                o.ay > box.y - CR - 1 &&
                o.ay < box.y + box.h + CR + 1
              )
                score += 1;
            });
            if (score < bestScore) {
              bestScore = score;
              best = box;
              if (score === 0) break;
            }
          }
          if (!best) {
            // Marker hugging the page edge — clamp a box inside bounds
            const tcx = Math.min(
              Math.max(m.ax + RAY_LEN * 0.7, 1 + THW / 2),
              LW - 1 - THW / 2,
            );
            const tcy = Math.min(
              Math.max(m.ay - RAY_LEN * 0.7, HDR + 4 + THW / 2),
              LH - 2 - THW / 2,
            );
            best = { x: tcx - THW / 2, y: tcy - THW / 2, w: THW, h: THW };
          }
          m.thumbBox = best;
          placedBoxes.push(best);
        });

      // ── Draw markers on PDF map — three passes: rays under photos,
      //    photos (with drop shadow), then plain black numbers on top ──
      if (!PDF_HIDE_FINDINGS) {
        // Pass 1: one ray per finding — true GPS point → thumbnail centre
        markers.forEach((m) => {
          const { loc, ax, ay } = m;
          const latest = loc.visits[0];
          const sc = latest
            ? STAT_COLORS[
                apiStatuses
                  .find((s) => s.id === latest.statusId)
                  ?.name?.toLowerCase()
              ] || "#FB923C"
            : "#FB923C";
          const [r, g, b] = hexToRgb(sc);
          if (m.thumbBox && thumbs[loc.locId]) {
            const tcx = m.thumbBox.x + m.thumbBox.w / 2;
            const tcy = m.thumbBox.y + m.thumbBox.h / 2;
            pdf.setDrawColor(r, g, b);
            pdf.setLineWidth(0.45);
            pdf.line(ax, ay, tcx, tcy);
          }
        });

        // Pass 2: photo thumbnails — drop shadow, white underlay, status frame
        markers.forEach((m) => {
          const tb = m.thumbBox,
            thumb = thumbs[m.loc.locId];
          if (!tb || !thumb) return;
          const latest = m.loc.visits[0];
          const sc = latest
            ? STAT_COLORS[
                apiStatuses
                  .find((s) => s.id === latest.statusId)
                  ?.name?.toLowerCase()
              ] || "#FB923C"
            : "#FB923C";
          const [r, g, b] = hexToRgb(sc);
          // Slight drop shadow below/right of the photo
          try {
            pdf.saveGraphicsState();
            pdf.setGState(new pdf.GState({ opacity: 0.25 }));
            pdf.setFillColor(35, 40, 50);
            pdf.rect(tb.x + 0.8, tb.y + 1.1, tb.w + 0.6, tb.h + 0.6, "F");
            pdf.restoreGraphicsState();
          } catch (e) {
            pdf.setFillColor(205, 208, 214);
            pdf.rect(tb.x + 0.8, tb.y + 1.1, tb.w + 0.6, tb.h + 0.6, "F");
          }
          pdf.setFillColor(255, 255, 255);
          pdf.rect(tb.x - 0.5, tb.y - 0.5, tb.w + 1, tb.h + 1, "F");
          try {
            pdf.addImage(thumb, "JPEG", tb.x, tb.y, tb.w, tb.h);
          } catch (e) {}
          pdf.setDrawColor(r, g, b);
          pdf.setLineWidth(0.55);
          pdf.rect(tb.x, tb.y, tb.w, tb.h, "S");
        });

        // Pass 3: GPS dots + plain black ref numbers above each photo
        markers.forEach((m) => {
          const { loc, ax, ay } = m;
          const latest = loc.visits[0];
          const sc = latest
            ? STAT_COLORS[
                apiStatuses
                  .find((s) => s.id === latest.statusId)
                  ?.name?.toLowerCase()
              ] || "#FB923C"
            : "#FB923C";
          const [r, g, b] = hexToRgb(sc);

          // Status-coloured dot at the exact GPS point (drawn over the ray end)
          pdf.setFillColor(r, g, b);
          pdf.setDrawColor(255, 255, 255);
          pdf.setLineWidth(0.3);
          pdf.circle(ax, ay, dotR, "FD");

          const numStr = stripZeros(loc.refNum);
          const numPt = Math.max(7, CR * 2.4);
          pdf.setFontSize(numPt);
          pdf.setFont("helvetica", "bold");
          const tb = m.thumbBox;
          let nx, ny;
          if (tb && thumbs[loc.locId]) {
            nx = tb.x + tb.w / 2;
            ny = tb.y - 1.4; // sitting above the photo
            if (ny - numPt * 0.35 < HDR + 2) ny = tb.y + tb.h + 3.4; // no room → below
          } else {
            nx = ax;
            ny = ay - dotR - 1.2; // no photo: number above the dot
            if (ny - numPt * 0.35 < HDR + 2) ny = ay + dotR + 3.4;
          }
          // thin white halo so the number stays readable over map detail
          pdf.setDrawColor(255, 255, 255);
          pdf.setLineWidth(0.5);
          pdf.setTextColor(15, 18, 24);
          try {
            pdf.text(numStr, nx, ny, {
              align: "center",
              renderingMode: "stroke",
            });
          } catch (e) {}
          pdf.text(numStr, nx, ny, { align: "center" });
        });
      }

      // ── Draw construction zones on PDF map ────────────────────────
      // Uses czPoints captured BEFORE map restore (same approach as finding markers)
      if (czPoints.length && !PDF_HIDE_CONSTR && constrMapImgData) {
        const czIconH = Math.max(10, TS * 3.5); // mm  (halved)
        const czIconW = czIconH * constrMapAspect; // mm
        czPoints.forEach(({ cx, cy }) => {
          try {
            pdf.addImage(
              constrMapImgData,
              "PNG",
              cx - czIconW / 2,
              cy - czIconH / 2,
              czIconW,
              czIconH,
            );
          } catch (e) {}
        });
      }

      showNotif("⏳ Step 4/4: Building details…", false, 0);
      // ── Legend overlaid on map — bottom-left, tight fit ───────────
      const LEG_H = 8.5;
      const LEG_INNER_PAD = 4; // padding between items
      const LEG_EDGE = 2; // padding at left and right edges
      const LEG_X = ML;
      const LEG_Y = LH - 4 - LEG_H;

      // Build legend items conditional on toggles
      const items = [];
      if (!PDF_HIDE_FINDINGS) {
        items.push({ color: "#FB923C", label: "1st Offense", shape: "cir" });
        items.push({ color: "#EF4444", label: "Repeat", shape: "cir" });
        if (!PDF_HIDE_RESOLVED) {
          items.push({ color: "#22C55E", label: "Resolved", shape: "cir" });
        }
      }
      if (!PDF_HIDE_CONSTR && constrLegendImgData) {
        items.push({ color: null, label: "Construction", shape: "excavator" });
      }

      function drawScaleBar() {
        // 1 km scale bar — bottom-right corner, away from the legend
        if (!isFinite(KM_MM) || KM_MM <= 0) return;
        const bx2 = LW - 6; // right end
        const bx1 = bx2 - KM_MM; // left end (1 km away)
        const by = LH - 7; // bar baseline
        // white plaque behind for legibility
        pdf.setFillColor(255, 255, 255);
        pdf.setDrawColor(180, 188, 200);
        pdf.setLineWidth(0.2);
        pdf.roundedRect(bx1 - 3, by - 5, KM_MM + 6, 8.5, 1, 1, "FD");
        // bar with end ticks
        pdf.setDrawColor(28, 35, 51);
        pdf.setLineWidth(0.5);
        pdf.line(bx1, by, bx2, by);
        pdf.line(bx1, by - 1.6, bx1, by + 1.6);
        pdf.line(bx2, by - 1.6, bx2, by + 1.6);
        // halfway tick (500 m)
        pdf.setLineWidth(0.3);
        pdf.line((bx1 + bx2) / 2, by - 1, (bx1 + bx2) / 2, by + 1);
        pdf.setFontSize(5.5);
        pdf.setFont("helvetica", "bold");
        pdf.setTextColor(28, 35, 51);
        pdf.text("1 km", (bx1 + bx2) / 2, by - 2, { align: "center" });
      }

      function drawMapLegend() {
        drawScaleBar();
        if (items.length === 0) return;
        const ts = 2.8;
        // Measure content width exactly
        pdf.setFontSize(5);
        pdf.setFont("helvetica", "normal");
        let contentW = 0;
        items.forEach((item, idx) => {
          contentW += ts * 2 + 1.5 + pdf.getTextWidth(item.label);
          if (idx < items.length - 1) contentW += LEG_INNER_PAD;
        });
        const legendW = contentW + LEG_EDGE * 2;

        pdf.setFillColor(255, 255, 255);
        pdf.setDrawColor(210, 215, 225);
        pdf.setLineWidth(0.3);
        pdf.roundedRect(LEG_X, LEG_Y, legendW, LEG_H, 1.5, 1.5, "FD");

        let lx = LEG_X + LEG_EDGE + ts;
        items.forEach((item, idx) => {
          pdf.setFontSize(5);
          pdf.setFont("helvetica", "normal");
          pdf.setTextColor(40, 50, 60);
          if (item.shape === "excavator") {
            // Single excavator legend icon
            const cy = LEG_Y + LEG_H / 2;
            const iconSize = ts * 2.4;
            try {
              pdf.addImage(
                constrLegendImgData,
                "PNG",
                lx - iconSize / 2,
                cy - iconSize / 2,
                iconSize,
                iconSize,
              );
            } catch (e) {}
          } else {
            const [r, g, b] = hexToRgb(item.color);
            pdf.setFillColor(r, g, b);
            pdf.setDrawColor(255, 255, 255);
            pdf.setLineWidth(0.3);
            pdf.circle(lx, LEG_Y + LEG_H / 2, ts * 0.85, "FD");
          }
          const tw = pdf.getTextWidth(item.label);
          pdf.text(item.label, lx + ts + 1.5, LEG_Y + LEG_H / 2 + 1.3);
          lx +=
            ts * 2 + 1.5 + tw + (idx < items.length - 1 ? LEG_INNER_PAD : 0);
        });
      }
      drawMapLegend();

      // ── PAGE 2: Compact overview map — tiny dot at GPS point, short
      //    ray, small numbered status circle. Same data, more map visible ──
      if (!PDF_HIDE_FINDINGS && markers.length) {
        pdf.addPage([LW, LH], "portrait");
        drawHeader(
          LW,
          `SITE FINDINGS REPORT — ${site?.name}`,
          `Compact overview  ·  ${visibleFindings.length} location${visibleFindings.length !== 1 ? "s" : ""}  ·  ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`,
        );
        pdf.addImage(mapImg, "JPEG", 0, HDR, LW, mapAreaH);

        // Construction zones — same icons as page 1
        if (czPoints.length && !PDF_HIDE_CONSTR && constrMapImgData) {
          const czIconH2 = Math.max(10, TS * 3.5); // halved
          const czIconW2 = czIconH2 * constrMapAspect;
          czPoints.forEach(({ cx, cy }) => {
            try {
              pdf.addImage(
                constrMapImgData,
                "PNG",
                cx - czIconW2 / 2,
                cy - czIconH2 / 2,
                czIconW2,
                czIconH2,
              );
            } catch (e) {}
          });
        }

        const CR2 = Math.max(1.6, CR * 0.6); // small circle radius, mm
        const DOT2 = Math.max(0.6, dotR * 0.6); // tiny dot at exact GPS point
        const RAY2 = CR2 * 2.6; // short ray length
        const placed2 = [];
        const ANG2 = [
          -60, -120, -30, -150, 30, 150, 60, 120, -90, 90, 0, 180,
        ].map((d) => (d * Math.PI) / 180);

        // Pick a circle position per marker, avoiding other circles, dots,
        // page edges and the legend corner. Uses the ORIGINAL GPS point
        // (ax/ay), not the page-1 displaced position.
        markers.forEach((m) => {
          let best = null,
            bestScore = Infinity;
          for (const ang of ANG2) {
            const cx = m.ax + RAY2 * Math.cos(ang);
            const cy = m.ay + RAY2 * Math.sin(ang);
            if (
              cx - CR2 < 1 ||
              cx + CR2 > LW - 1 ||
              cy - CR2 < HDR + 1 ||
              cy + CR2 > LH - 2
            )
              continue;
            let score = 0;
            if (cx - CR2 < 120 && cy + CR2 > LH - 14) score += 4; // legend keep-out
            if (cx + CR2 > LW - 12 - KM_MM && cy + CR2 > LH - 13) score += 4; // scale-bar keep-out
            placed2.forEach((p) => {
              if (Math.hypot(cx - p.x, cy - p.y) < CR2 * 2 + 0.6) score += 3;
            });
            markers.forEach((o) => {
              if (o === m) return;
              if (Math.hypot(cx - o.ax, cy - o.ay) < CR2 + DOT2 + 0.5)
                score += 1;
            });
            if (score < bestScore) {
              bestScore = score;
              best = { x: cx, y: cy };
              if (score === 0) break;
            }
          }
          if (!best) {
            best = {
              x: Math.min(Math.max(m.ax + RAY2, 1 + CR2), LW - 1 - CR2),
              y: Math.min(Math.max(m.ay - RAY2, HDR + 1 + CR2), LH - 2 - CR2),
            };
          }
          m.miniPos = best;
          placed2.push(best);
        });

        // Pass A: rays (bottom layer)
        markers.forEach((m) => {
          const latest = m.loc.visits[0];
          const sc = latest
            ? STAT_COLORS[
                apiStatuses
                  .find((s) => s.id === latest.statusId)
                  ?.name?.toLowerCase()
              ] || "#FB923C"
            : "#FB923C";
          const [r, g, b] = hexToRgb(sc);
          pdf.setDrawColor(r, g, b);
          pdf.setLineWidth(0.3);
          pdf.line(m.ax, m.ay, m.miniPos.x, m.miniPos.y);
        });

        // Pass B: GPS dots + numbered circles (top layer)
        markers.forEach((m) => {
          const latest = m.loc.visits[0];
          const sc = latest
            ? STAT_COLORS[
                apiStatuses
                  .find((s) => s.id === latest.statusId)
                  ?.name?.toLowerCase()
              ] || "#FB923C"
            : "#FB923C";
          const [r, g, b] = hexToRgb(sc);

          pdf.setFillColor(r, g, b);
          pdf.setDrawColor(255, 255, 255);
          pdf.setLineWidth(0.25);
          pdf.circle(m.ax, m.ay, DOT2, "FD");

          pdf.setFillColor(r, g, b);
          pdf.setDrawColor(255, 255, 255);
          pdf.setLineWidth(0.3);
          pdf.circle(m.miniPos.x, m.miniPos.y, CR2, "FD");

          const numStr = stripZeros(m.loc.refNum);
          pdf.setFontSize(Math.max(4.5, CR2 * 2.2));
          pdf.setFont("helvetica", "bold");
          pdf.setTextColor(255, 255, 255);
          pdf.text(numStr, m.miniPos.x, m.miniPos.y + 0.15, {
            align: "center",
            baseline: "middle",
          });
        });

        drawMapLegend();
      }

      // ── PAGES 2+: Portrait detail pages ───────────────────────────
      // Skip detail pages entirely when "Only Construction" is on
      const _renderDetailPages = !PDF_HIDE_FINDINGS;

      const CW = PW - ML - MR;
      let y = HDR + 4;

      function ensurePage(needed) {
        if (y + needed > PH - MB) {
          pdf.addPage([PW, PH], "portrait");
          pdf.setFillColor(255, 255, 255);
          pdf.rect(0, 0, PW, HDR, "F");
          pdf.setDrawColor(220, 225, 236);
          pdf.line(0, HDR, PW, HDR);
          pdf.setTextColor(28, 35, 51);
          pdf.setFontSize(6);
          pdf.setFont("helvetica", "bold");
          pdf.text(
            `SITE FINDINGS REPORT — ${site?.name} (cont.)`,
            PW / 2,
            8.5,
            { align: "center" },
          );
          y = HDR + 4;
        }
      }

      const CAT_ORDER = (apiCategories || []).map((c) => c.id);
      const ESCALATED_ORDER = [
        "SOTAICO",
        "Client QA",
        "Client FM",
        "Client Subcontractor RS",
        "Client Subcontractor OC",
        "Client Subcontractor Other",
        "Client Senior Management",
        "Other",
        "",
      ];

      function lastEscalated(loc) {
        for (const v of loc.visits) {
          if (v.escalatedToId) return v.escalatedToId;
        }
        return "";
      }

      let sorted;
      if (sortBy === "category") {
        sorted = [...visibleFindings].sort((a, b) => {
          const ca = CAT_ORDER.indexOf((a.visits[0] && a.visits[0].cat) || "");
          const cb = CAT_ORDER.indexOf((b.visits[0] && b.visits[0].cat) || "");
          if (ca !== cb) return (ca < 0 ? 99 : ca) - (cb < 0 ? 99 : cb);
          return (a.refNum || "999") > (b.refNum || "999") ? 1 : -1;
        });
      } else if (sortBy === "escalated") {
        sorted = [...visibleFindings].sort((a, b) => {
          const ea = ESCALATED_ORDER.indexOf(lastEscalated(a));
          const eb = ESCALATED_ORDER.indexOf(lastEscalated(b));
          const ra = ea < 0 ? 99 : ea,
            rb = eb < 0 ? 99 : eb;
          if (ra !== rb) return ra - rb;
          return (a.refNum || "999") > (b.refNum || "999") ? 1 : -1;
        });
      } else if (sortBy === "quadrant") {
        // Canonical quadrant order: NW → NE → SW → SE
        const QUAD_ORDER = ["NW", "NE", "SW", "SE"];
        // Build a lookup: parcel name → {quad, position in parcel list}
        const parcelList = parcels.map((p) => p.name) || [];
        const parcelIdx = {};
        parcelList.forEach((p, i) => {
          parcelIdx[p.name] = i;
        });
        sorted = [...visibleFindings].sort((a, b) => {
          // Determine each finding's quad from its assigned parcel
          const pA = parcelList.find((p) => p.name === a.parcel);
          const pB = parcelList.find((p) => p.name === b.parcel);
          const qA = QUAD_ORDER.indexOf(pA ? pA.quad : "");
          const qB = QUAD_ORDER.indexOf(pB ? pB.quad : "");
          const qAi = qA < 0 ? 99 : qA;
          const qBi = qB < 0 ? 99 : qB;
          if (qAi !== qBi) return qAi - qBi;
          // Same quadrant — sort by parcel order within the parcel list
          const piA =
            parcelIdx[a.parcel] !== undefined ? parcelIdx[a.parcel] : 999;
          const piB =
            parcelIdx[b.parcel] !== undefined ? parcelIdx[b.parcel] : 999;
          if (piA !== piB) return piA - piB;
          // Same parcel — fall back to finding number
          return (a.refNum || "999") > (b.refNum || "999") ? 1 : -1;
        });
      } else {
        sorted = [...visibleFindings].sort((a, b) =>
          (a.refNum || "999") > (b.refNum || "999") ? 1 : -1,
        );
      }

      const sortLabel =
        sortBy === "number"
          ? "By Number"
          : sortBy === "category"
            ? "By Category"
            : sortBy === "escalated"
              ? "By Assigned To"
              : "By Parcel";

      if (_renderDetailPages) {
        pdf.addPage([PW, PH], "portrait");
        drawHeader(
          PW,
          `SITE FINDINGS REPORT — ${site?.name}`,
          `Finding Details  ·  ${visibleFindings.length} location${visibleFindings.length !== 1 ? "s" : ""}  ·  ${sortLabel}  ·  Prepared ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`,
        );
        y = HDR + 4;

        for (const loc of sorted) {
          ensurePage(28);
          const latest = loc.visits[0];
          if (!latest) continue;
          const statColor = hexToRgb(
            STAT_COLORS[
              apiStatuses
                .find((s) => s.id === latest.statusId)
                ?.name?.toLowerCase()
            ] || "#FB923C",
          );
          const catLabel =
            apiCategories.find((c: any) => c.id === latest.categoryId)
              ?.label ||
            latest.categoryId ||
            latest.categoryId ||
            latest.categoryId;
          const totalVisits = loc.visits.length;
          const repeats = loc.visits.filter(
            (v) =>
              apiStatuses
                .find((s) => s.id === v.statusId)
                ?.name?.toLowerCase() === "repeat",
          ).length;

          // Finding header bar — #ref, PARCEL and Label, all bold and equally prominent
          pdf.setFillColor(...statColor);
          pdf.rect(ML, y, CW, 7, "F");
          pdf.setTextColor(255, 255, 255);
          pdf.setFontSize(8);
          pdf.setFont("helvetica", "bold");
          const bandParts = [`#${stripZeros(loc.refNum || "?")}`];
          if (loc.parcel) bandParts.push(pdfText(loc.parcel));
          if (latest.label) bandParts.push(pdfText(latest.label));
          pdf.text(bandParts.join("  ·  "), ML + 3, y + 5);
          y += 8;

          // Summary line — status/visits/category/coords, all one row, one font
          pdf.setFillColor(245, 247, 250);
          pdf.rect(ML, y, CW, 7, "F");
          pdf.setTextColor(60, 70, 90);
          pdf.setFontSize(6.5);
          pdf.setFont("helvetica", "normal");
          const sumTxt = `${STAT_LABELS[apiStatuses.find((s) => s.id === latest.statusId)?.name?.toLowerCase()] || "Open"}  |  ${totalVisits} visit${totalVisits > 1 ? "s" : ""}  |  ${repeats} repeat${repeats !== 1 ? "s" : ""}  |  CAT: ${pdfText(catLabel)}  |  Coords: ${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`;
          pdf.text(sumTxt, ML + 3, y + 4.5);
          y += 9;

          for (const visit of loc.visits) {
            const statusObj = apiStatuses.find((s) => s.id === visit.statusId);
            const statusName = statusObj?.name?.toLowerCase() || "open";
            const vColor = hexToRgb(STAT_COLORS[statusName] || "#FB923C");
            
            const catObj = apiCategories.find((c) => c.id === visit.categoryId);
            const vCat = catObj ? catObj.label : visit.categoryId || "—";
            
            const photoCount = (visit.photos || []).length;
            const noteLines = visit.notes
              ? pdf.splitTextToSize(pdfText(visit.notes), CW - 12).length
              : 0;
            const photoRows = Math.ceil(photoCount / 3); // conservative: ~3 portrait per row
            ensurePage(8 + noteLines * 3.5 + 3 + 3.5); // reserve space for visit header + notes only; photos paginate per-row

            // Visit row — date + status + category
            pdf.setFillColor(250, 251, 253);
            pdf.rect(ML + 3, y, CW - 3, 6, "F");
            pdf.setFillColor(...vColor);
            pdf.rect(ML + 3, y, 2, 6, "F");
            pdf.setTextColor(40, 50, 70);
            pdf.setFontSize(6.5);
            pdf.setFont("helvetica", "bold");
            pdf.text(visit.visitDate || "", ML + 7, y + 4.2);
            pdf.setFont("helvetica", "normal");
            pdf.text(
              `${STAT_LABELS[statusName] || ""}  ·  ${pdfText(vCat)}`,
              ML + 30,
              y + 4.2,
            );
            y += 7;

            // Assigned / Escalated To — always printed
            pdf.setFontSize(6);
            pdf.setFont("helvetica", "normal");
            if (visit.escalatedToId) {
              const escObj = apiEscalations.find((e) => e.id === visit.escalatedToId);
              const escName = escObj ? escObj.label : visit.escalatedToId;
              pdf.setTextColor(90, 50, 160);
              pdf.text(
                `Assigned / Escalated to: ${pdfText(escName)}`,
                ML + 6,
                y + 3,
              );
            } else {
              pdf.setTextColor(170, 175, 185);
              pdf.text("Assigned / Escalated to: —", ML + 6, y + 3);
            }
            pdf.setTextColor(80, 90, 100);
            y += 4;

            if (visit.notes) {
              const lines = pdf.splitTextToSize(pdfText(visit.notes), CW - 12);
              pdf.setFontSize(6);
              pdf.setTextColor(80, 90, 100);
              lines.forEach((l) => {
                ensurePage(4);
                pdf.text(l, ML + 6, y + 3);
                y += 3.5;
              });
              y += 1;
            }

            if (photoCount > 0) {
              // ── Aspect-ratio-aware photo layout ──────────────────────
              // Each photo is rendered preserving its natural aspect ratio
              // within a fixed bounding box.  Portrait images (h>w) are
              // placed in a box MAX_H tall; landscape images (w>=h) are
              // placed in a box MAX_W wide.  Because portrait images are
              // narrower, more of them fit per row; landscape images are
              // wider so fewer fit per row.
              const MAX_W = 30,
                MAX_H = 40,
                gap = 3;
              // helper: decode a data-URI into a natural {w,h} via an Image element
              function getImgDims(dataUri) {
                return new Promise(function (resolve) {
                  const img = new Image();
                  img.onload = function () {
                    resolve({ w: img.naturalWidth, h: img.naturalHeight });
                  };
                  img.onerror = function () {
                    resolve({ w: 1, h: 1 });
                  };
                  img.src = dataUri;
                });
              }
              // Resolve all photo dimensions, then render
              const dimPromises = visit.photos.map((p) => getImgDims(p));
              const dims = await Promise.all(dimPromises);

              // Build rows: each photo has its own pW/pH; pack into rows
              // that fit within the column width CW-6.
              const rowItems = [];
              let curRow = [];
              let curRowW = 0;
              for (let pi = 0; pi < visit.photos.length; pi++) {
                const { w, h } = dims[pi];
                const ar = w / Math.max(h, 1);
                let itemW, itemH;
                if (ar >= 1) {
                  // landscape: fix width to MAX_W
                  itemW = MAX_W;
                  itemH = Math.min(MAX_H, Math.round(MAX_W / ar));
                } else {
                  // portrait: fix height to MAX_H
                  itemH = MAX_H;
                  itemW = Math.min(MAX_W, Math.round(MAX_H * ar));
                }
                // does it fit on current row?
                const needed = curRow.length === 0 ? itemW : itemW + gap;
                if (curRow.length > 0 && curRowW + needed > CW - 6) {
                  rowItems.push(curRow);
                  curRow = [];
                  curRowW = 0;
                }
                curRow.push({ pi, itemW, itemH, data: visit.photos[pi] });
                curRowW += curRow.length === 1 ? itemW : itemW + gap;
              }
              if (curRow.length) rowItems.push(curRow);

              // Render rows
              for (const row of rowItems) {
                const rowH = Math.max(...row.map((r) => r.itemH));
                ensurePage(rowH + 4);
                let ppx = ML + 3;
                for (const item of row) {
                  try {
                    pdf.addImage(
                      item.data,
                      "JPEG",
                      ppx,
                      y,
                      item.itemW,
                      item.itemH,
                    );
                    pdf.setDrawColor(200, 210, 220);
                    pdf.setLineWidth(0.2);
                    pdf.rect(ppx, y, item.itemW, item.itemH);
                  } catch (e) {}
                  ppx += item.itemW + gap;
                }
                y += rowH + gap;
              }
              y += 1;
            }
            y += 2;
          }
          y += 5;
        }
      } // end if(_renderDetailPages)

      // ════════════════════════════════════════════════════════════════
      // RECAP / SUMMARY PAGE — totals by category, status, and region
      // ════════════════════════════════════════════════════════════════
      (function drawRecap() {
        // Each finding's "current" classification = its latest visit
        const recap = visibleFindings.map((loc) => {
          const latest = loc.visits[0] || {};
          const quad = window._quadOfLoc ? window._quadOfLoc(loc) : null;
          const lastEsc =
            (loc.visits.find((v) => v.escalatedToId) || {}).escalatedToId || null;
          return {
            cat: latest.categoryId || "other",
            status:
              apiStatuses
                .find((s) => s.id === latest.statusId)
                ?.name?.toLowerCase() || "open",
            parcel: loc.parcel || "Unassigned",
            quad: quad || "Unassigned",
            escalated: lastEsc,
            repeats: loc.visits.filter(
              (v) =>
                apiStatuses
                  .find((s) => s.id === v.statusId)
                  ?.name?.toLowerCase() === "repeat",
            ).length,
            visits: loc.visits.length,
          };
        });
        const total = recap.length;

        pdf.addPage([PW, PH], "portrait");
        drawHeader(
          PW,
          `SITE FINDINGS REPORT — ${site?.name}`,
          `Recap & Totals  ·  ${total} location${total !== 1 ? "s" : ""}  ·  Prepared ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`,
        );
        y = HDR + 8;

        function sectionTitle(txt) {
          ensurePage(12);
          pdf.setTextColor(28, 35, 51);
          pdf.setFontSize(10);
          pdf.setFont("helvetica", "bold");
          pdf.text(txt, ML, y);
          y += 2;
          pdf.setDrawColor(45, 138, 78);
          pdf.setLineWidth(0.5);
          pdf.line(ML, y, ML + CW, y);
          y += 5;
        }

        // Generic 2-column table: [{label, count, color?}]
        function drawTable(rows, totalCount) {
          const rowH = 6.2;
          const barMax = CW - 70; // width available for the count bar
          const labelX = ML + 2;
          const countX = ML + CW - 2; // right-aligned count
          const maxCount = Math.max(1, ...rows.map((r) => r.count));
          rows.forEach((r, i) => {
            ensurePage(rowH + 1);
            if (i % 2 === 0) {
              pdf.setFillColor(247, 249, 251);
              pdf.rect(ML, y - 0.5, CW, rowH, "F");
            }
            // colour swatch
            if (r.color) {
              const c = hexToRgb(r.color);
              pdf.setFillColor(...c);
              pdf.rect(ML + 2, y + 0.8, 3, 3, "F");
            }
            const tx = r.color ? ML + 7 : ML + 2;
            pdf.setTextColor(40, 50, 70);
            pdf.setFontSize(8);
            pdf.setFont("helvetica", "normal");
            pdf.text(pdfText(String(r.label)), tx, y + 4);
            // bar
            const bw = (r.count / maxCount) * barMax;
            const bc = r.color ? hexToRgb(r.color) : [148, 163, 184];
            pdf.setFillColor(...bc);
            pdf.rect(ML + CW - 22 - barMax, y + 1, bw, rowH - 2.5, "F");
            // count + pct
            const pct = totalCount
              ? Math.round((r.count / totalCount) * 100)
              : 0;
            pdf.setFont("helvetica", "bold");
            pdf.setTextColor(28, 35, 51);
            pdf.text(`${r.count}  (${pct}%)`, countX, y + 4, {
              align: "right",
            });
            y += rowH;
          });
          // total row
          ensurePage(rowH + 2);
          pdf.setDrawColor(200, 208, 220);
          pdf.setLineWidth(0.3);
          pdf.line(ML, y, ML + CW, y);
          y += 0.5;
          pdf.setFont("helvetica", "bold");
          pdf.setFontSize(8);
          pdf.setTextColor(28, 35, 51);
          pdf.text("Total", ML + 2, y + 4);
          pdf.text(String(totalCount), countX, y + 4, { align: "right" });
          y += rowH + 6;
        }

        // ── 1) By Category ──────────────────────────────────────────
        sectionTitle("Totals by Category");
        {
          const order = (apiCategories || []).map((c) => c.id);
          const colorOf = Object.fromEntries(
            (apiCategories || []).map((c) => [c.id, c.color]),
          );
          const counts = {};
          recap.forEach((r) => {
            counts[r.cat] = (counts[r.cat] || 0) + 1;
          });
          const rows = Object.keys(counts)
            .sort((a, b) => order.indexOf(a) - order.indexOf(b))
            .map((id) => ({
              label:
                apiCategories.find((c: any) => c.id === id)?.label || id || id,
              count: counts[id],
              color: colorOf[id],
            }));
          drawTable(rows, total);
        }

        // ── 2) By Status (1st offense / repeat / resolved) ──────────
        sectionTitle("Totals by Status");
        {
          const statOrder = ["open", "repeat", "resolved"];
          const counts = {};
          recap.forEach((r) => {
            counts[r.status] = (counts[r.status] || 0) + 1;
          });
          const rows = statOrder
            .filter((s) => counts[s])
            .map((s) => ({
              label:
                apiStatuses.find(
                  (x: any) =>
                    x.name?.toLowerCase() === s.toLowerCase() || x.id === s,
                )?.label ||
                s ||
                s,
              count: counts[s],
              color:
                apiStatuses.find(
                  (x: any) =>
                    x.name?.toLowerCase() === s.toLowerCase() || x.id === s,
                )?.color || "#94a3b8",
            }));
          drawTable(rows, total);
          // extra note: total repeat visits across all findings
          const totalRepeatVisits = recap.reduce((s, r) => s + r.repeats, 0);
          ensurePage(6);
          pdf.setFont("helvetica", "normal");
          pdf.setFontSize(6.5);
          pdf.setTextColor(100, 110, 130);
          pdf.text(
            `Note: status reflects each location's most recent visit. Total repeat visits recorded across all locations: ${totalRepeatVisits}.`,
            ML + 2,
            y,
          );
          y += 8;
        }

        // ── 3) By Region (Parcel) ───────────────────────────────────
        sectionTitle("Totals by Region (Parcel)");
        {
          const quadName =
            parcels.reduce((acc, p) => ({ ...acc, [p.name]: p.name }), {}) ||
            {};
          const quadOrder = parcels.map((p) => p.name) || [
            "NW",
            "NE",
            "SW",
            "SE",
          ];
          // group parcels under their quadrant
          const byQuad = {};
          recap.forEach((r) => {
            const q = r.quad || "Unassigned";
            byQuad[q] = byQuad[q] || {};
            byQuad[q][r.parcel] = (byQuad[q][r.parcel] || 0) + 1;
          });
          const quads = Object.keys(byQuad).sort((a, b) => {
            const ia = quadOrder.indexOf(a),
              ib = quadOrder.indexOf(b);
            return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
          });
          quads.forEach((q) => {
            const parcels = byQuad[q];
            const quadTotal = Object.values(parcels).reduce((s, n) => s + n, 0);
            ensurePage(10);
            pdf.setFillColor(28, 35, 51);
            pdf.rect(ML, y, CW, 6, "F");
            pdf.setTextColor(255, 255, 255);
            pdf.setFontSize(8);
            pdf.setFont("helvetica", "bold");
            pdf.text(`${pdfText(quadName[q] || q)}`, ML + 2, y + 4);
            pdf.text(
              `${quadTotal} finding${quadTotal !== 1 ? "s" : ""}`,
              ML + CW - 2,
              y + 4,
              { align: "right" },
            );
            y += 8;
            const rows = Object.keys(parcels)
              .sort((a, b) => parcels[b] - parcels[a])
              .map((p) => ({ label: p, count: parcels[p] }));
            drawTable(rows, quadTotal);
          });
        }

        // ── 4) By Assigned / Escalated To ──────────────────────────
        sectionTitle("Totals by Assigned / Escalated To");
        {
          const escOrder = apiEscalations.length
            ? apiEscalations.map(e => e.label)
            : [
                "SOTAICO",
                "Client QA",
                "Client FM",
                "Client Subcontractor RS",
                "Client Subcontractor OC",
                "Client Subcontractor Other",
                "Client Senior Management",
                "Other",
              ];
          const counts = {};
          let unassigned = 0;
          recap.forEach((r) => {
            const escTargetId = r.escalatedToId;
            const escLabel = apiEscalations.find(e => e.id === escTargetId)?.label || escTargetId;
            
            if (escLabel && escLabel !== "—") {
              counts[escLabel] = (counts[escLabel] || 0) + 1;
            } else {
              unassigned++;
            }
          });
          const rows = escOrder
            .filter((e) => counts[e])
            .map((e) => ({ label: e, count: counts[e] }));
          if (unassigned > 0)
            rows.push({ label: "Not Assigned", count: unassigned });
          if (rows.length === 0) {
            ensurePage(8);
            pdf.setFont("helvetica", "normal");
            pdf.setFontSize(8);
            pdf.setTextColor(120, 130, 150);
            pdf.text("No assignments recorded.", ML + 2, y);
            y += 8;
          } else {
            drawTable(rows, total);
          }
        }
      })();

      // ── FINDING RECAP TABLE (per Excel template) ─────────────────
      // Columns: Finding # | Category | Assigned to | Date First Opened |
      //          # Repeats | Date Resolved | Date Reopened | Days Outstanding
      // Sort order matches the detail pages (sortBy variable already set above)
      (function drawRecapTable() {
        if (!_renderDetailPages) return; // skip if "Only Constr." is on

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Helper: days between two date strings (YYYY-MM-DD)
        function daysBetween(d1str, d2) {
          const d1 = new Date(d1str + "T00:00:00");
          return Math.round((d2 - d1) / 86400000);
        }

        // Build one row per location (same sorted order as detail pages)
        const rows = sorted.map((loc) => {
          const visitsChron = [...loc.visits].sort((a, b) =>
            a.visitDate < b.visitDate ? -1 : 1,
          ); // oldest first
          const latest = loc.visits[0] || {};
          const cat = apiCategories.find(
            (c) => c.id === latest.categoryId,
          );
          const catLabel = cat ? cat.label : latest.categoryId || "—";
          const lastEscId =
            (loc.visits.find((v) => v.escalatedToId) || {}).escalatedToId;
          const lastEsc = lastEscId ? (apiEscalations.find(e => e.id === lastEscId)?.label || lastEscId) : "—";
          const firstDate = visitsChron[0] ? visitsChron[0].visitDate : "";
          const repeats = loc.visits.filter(
            (v) =>
              apiStatuses
                .find((s) => s.id === v.statusId)
                ?.name?.toLowerCase() === "repeat",
          ).length;

          // Resolved: most-recent visit that is "resolved"
          const resolvedVisit = loc.visits.find(
            (v) =>
              apiStatuses
                .find((s) => s.id === v.statusId)
                ?.name?.toLowerCase() === "resolved",
          );
          const resolvedDate = resolvedVisit ? resolvedVisit.visitDate : "";

          // Reopened: any visit (open/repeat) that is NEWER than the most-recent resolved visit
          let reopenedDate = "";
          if (resolvedVisit) {
            const reopenVisit = loc.visits.find(
              (v) =>
                apiStatuses
                  .find((s) => s.id === v.statusId)
                  ?.name?.toLowerCase() !== "resolved" &&
                v.visitDate > resolvedVisit.visitDate,
            );
            reopenedDate = reopenVisit ? reopenVisit.visitDate : "";
          }

          // Days outstanding:
          //   - If current status is resolved AND not reopened → first opened → resolved date
          //   - Otherwise (open, repeat, or resolved+reopened) → first opened → today
          let daysOut = "";
          if (firstDate) {
            const isResolved =
              apiStatuses
                .find((s) => s.id === latest.statusId)
                ?.name?.toLowerCase() === "resolved" && !reopenedDate;
            const endDate = isResolved
              ? new Date(resolvedDate + "T00:00:00")
              : today;
            daysOut = daysBetween(firstDate, endDate);
          }

          return {
            refNum: loc.refNum || "?",
            label: latest.label || "—",
            catLabel,
            parcel: loc.parcel || "Unassigned",
            lastEsc,
            firstDate,
            repeats,
            resolvedDate,
            reopenedDate,
            daysOut,
            status:
              apiStatuses
                .find((s) => s.id === latest.statusId)
                ?.name?.toLowerCase() || "open",
          };
        });

        // All-findings average: start from rows (already computed correctly), then
        // supplement with any resolved findings that were hidden by the toggle.
        // This guarantees the same computation logic and same data as the table rows.
        const _rowDays = rows
          .filter((r) => r.daysOut !== "")
          .map((r) => r.daysOut);
        const _resolvedHiddenDays = PDF_HIDE_RESOLVED
          ? findings
              .filter((loc) => {
                const lat = loc.visits[0];
                return lat && lat.status === "resolved";
              })
              .map((loc) => {
                const vc = [...loc.visits].sort((a, b) =>
                  a.visitDate < b.visitDate ? -1 : 1,
                );
                const fd = vc[0] ? vc[0].visitDate : "";
                if (!fd) return null;
                const rv = loc.visits.find(
                  (v) =>
                    apiStatuses
                      .find((s) => s.id === v.statusId)
                      ?.name?.toLowerCase() === "resolved",
                );
                if (!rv) return null;
                const rd = rv.visitDate;
                const rv2 = loc.visits.find(
                  (v) =>
                    apiStatuses
                      .find((s) => s.id === v.statusId)
                      ?.name?.toLowerCase() !== "resolved" && v.visitDate > rv.visitDate,
                );
                const rod = rv2 ? rv2.visitDate : "";
                // Only count as truly resolved (not reopened)
                if (rod) return daysBetween(fd, today);
                return daysBetween(fd, new Date(rd + "T00:00:00"));
              })
              .filter((d) => d !== null)
          : [];
        const _allDaysForAvg = [..._rowDays, ..._resolvedHiddenDays];
        const _avgAllDays =
          _allDaysForAvg.length > 0
            ? Math.round(
                _allDaysForAvg.reduce((s, d) => s + d, 0) /
                  _allDaysForAvg.length,
              )
            : null;

        // ── Page setup ─────────────────────────────────────────────
        pdf.addPage([PW, PH], "portrait");
        drawHeader(
          PW,
          `SITE FINDINGS REPORT — ${site?.name}`,
          `Finding Recap  ·  ${rows.length} finding${rows.length !== 1 ? "s" : ""}  ·  ${sortLabel}  ·  Prepared ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`,
        );

        // Section heading bar
        const CWT = PW - ML - MR;
        let yt = HDR + 6;
        pdf.setFillColor(28, 35, 51);
        pdf.rect(ML, yt, CWT, 6.5, "F");
        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(7);
        pdf.setFont("helvetica", "bold");
        pdf.text("FINDING RECAP TABLE", ML + 3, yt + 4.5);
        yt += 8;

        // ── Column definitions (widths must sum to CWT=182mm) ──────
        // Finding# | Label | Category | Parcel/Area | Assigned To | Date 1st | Repeats | Resolved | Reopened | Days
        const cols = [
          { label: "#", w: 9 },
          { label: "Label", w: 30 },
          { label: "Category", w: 22 },
          { label: "Parcel / Area", w: 22 },
          { label: "Assigned / Esc.", w: 22 },
          { label: "First Opened", w: 17 },
          { label: "Repeats", w: 10 },
          { label: "Resolved", w: 17 },
          { label: "Reopened", w: 17 },
          { label: "Days Outstanding", w: 16 },
        ];

        const ROW_H = 5.8;
        const FONT_SZ = 5.8;

        // Draw column headers
        function drawColHeaders(yy) {
          pdf.setFillColor(45, 55, 72);
          pdf.rect(ML, yy, CWT, ROW_H + 0.5, "F");
          pdf.setTextColor(255, 255, 255);
          pdf.setFontSize(FONT_SZ - 0.5);
          pdf.setFont("helvetica", "bold");
          let cx = ML;
          cols.forEach((c) => {
            pdf.text(c.label, cx + 1.5, yy + ROW_H - 1.2);
            cx += c.w;
          });
          return yy + ROW_H + 0.5;
        }

        yt = drawColHeaders(yt);

        // Draw one data row
        function drawRow(row, idx, yy) {
          const even = idx % 2 === 0;
          pdf.setFillColor(
            even ? 247 : 255,
            even ? 249 : 255,
            even ? 251 : 255,
          );
          pdf.rect(ML, yy, CWT, ROW_H, "F");

          // Status colour stripe on left
          const sc =
            apiStatuses.find(
              (x: any) =>
                x.name?.toLowerCase() === row.status.toLowerCase() ||
                x.id === row.status,
            )?.color ||
            "#94a3b8" ||
            "#FB923C";
          const [sr, sg, sb] = hexToRgb(sc);
          pdf.setFillColor(sr, sg, sb);
          pdf.rect(ML, yy, 1.5, ROW_H, "F");

          pdf.setTextColor(40, 50, 70);
          pdf.setFontSize(FONT_SZ);
          pdf.setFont("helvetica", "normal");
          const vals = [
            "#" + stripZeros(row.refNum),
            row.label,
            row.catLabel,
            row.parcel,
            row.lastEsc,
            row.firstDate || "—",
            row.repeats > 0 ? String(row.repeats) : "0",
            row.resolvedDate || "—",
            row.reopenedDate || "—",
            row.daysOut !== "" ? String(row.daysOut) + "d" : "—",
          ];

          let cx = ML;
          vals.forEach((val, vi) => {
            const colW = cols[vi].w;
            // Right-align numeric columns (repeats, days)
            const rightAlign = vi === 6 || vi === 9;
            const txt = pdf.splitTextToSize(pdfText(val), colW - 3)[0] || "";
            if (rightAlign) {
              pdf.text(txt, cx + colW - 2, yy + ROW_H - 1.4, {
                align: "right",
              });
            } else {
              pdf.text(txt, cx + 1.8, yy + ROW_H - 1.4);
            }
            cx += colW;
          });

          // Light grid line under row
          pdf.setDrawColor(220, 228, 240);
          pdf.setLineWidth(0.1);
          pdf.line(ML, yy + ROW_H, ML + CWT, yy + ROW_H);

          return yy + ROW_H;
        }

        // Vertical column dividers (drawn once per page as reference lines)
        function drawColDividers(yTop, yBot) {
          pdf.setDrawColor(200, 210, 225);
          pdf.setLineWidth(0.15);
          let cx = ML;
          cols.forEach((c, i) => {
            cx += c.w;
            if (i < cols.length - 1) pdf.line(cx, yTop, cx, yBot);
          });
        }

        // Render all rows with auto-page-break
        let rowIdx = 0;
        let pageTopY = yt;
        rows.forEach((row) => {
          if (yt + ROW_H > PH - MB) {
            drawColDividers(pageTopY, yt);
            pdf.addPage([PW, PH], "portrait");
            pdf.setFillColor(255, 255, 255);
            pdf.rect(0, 0, PW, HDR, "F");
            pdf.setDrawColor(220, 225, 236);
            pdf.line(0, HDR, PW, HDR);
            pdf.setTextColor(28, 35, 51);
            pdf.setFontSize(6);
            pdf.setFont("helvetica", "bold");
            pdf.text(
              `SITE FINDINGS REPORT — ${site?.name} (cont.)`,
              PW / 2,
              8.5,
              { align: "center" },
            );
            yt = HDR + 4;
            pageTopY = yt;
            yt = drawColHeaders(yt);
          }
          yt = drawRow(row, rowIdx, yt);
          rowIdx++;
        });

        // Totals row
        if (yt + ROW_H + 1 > PH - MB) {
          drawColDividers(pageTopY, yt);
          pdf.addPage([PW, PH], "portrait");
          yt = HDR + 4;
          pageTopY = yt;
        }
        pdf.setDrawColor(45, 55, 72);
        pdf.setLineWidth(0.4);
        pdf.line(ML, yt, ML + CWT, yt);
        pdf.setFillColor(240, 243, 248);
        pdf.rect(ML, yt, CWT, ROW_H + 0.5, "F");
        pdf.setTextColor(28, 35, 51);
        pdf.setFontSize(FONT_SZ);
        pdf.setFont("helvetica", "bold");
        // Average is always computed from ALL findings (unfiltered) so it remains
        // meaningful even when "Hide Resolved" is active in the main UI.
        const avgDays = _avgAllDays !== null ? String(_avgAllDays) + "d" : "—";
        const avgLabel = "Avg. Days Outstanding (incl. resolved):";
        pdf.text(avgLabel, ML + 2, yt + ROW_H - 0.8);
        const daysColX = cols.slice(0, -1).reduce((s, c) => s + c.w, ML);
        const daysColW = cols[cols.length - 1].w;
        pdf.text(avgDays, daysColX + daysColW - 2, yt + ROW_H - 0.8, {
          align: "right",
        });
        yt += ROW_H + 1;

        drawColDividers(pageTopY, yt);
      })();

      const date = new Date().toISOString().slice(0, 10);
      const cid = site?.name || "ElGouna";
      pdf.save(`PesTrack Pest Pressure Sources - El Gouna ${date}.pdf`);
      showNotif("✅ Report saved");
    } catch (err: any) {
      console.error("PDF error:", err);
      showNotif("❌ " + (err.message || err), true, 8000);
      // Restore markers if error during capture
      Array.from(
        mapContainerRef.current?.querySelectorAll(".fi-marker-wrap") || [],
      ).forEach((el) => (el.style.visibility = ""));
      Array.from(
        mapContainerRef.current?.querySelectorAll(".cz-divicon") || [],
      ).forEach((el) => (el.style.visibility = ""));
      const _lce = mapContainerRef.current?.querySelector(
        ".leaflet-control-layers",
      ) as HTMLElement;
      if (_lce) _lce.style.display = "";
    }
  }

  // XLSX parcels uploader — sends the raw sheet to the backend (POST /api/parcels/upload),
  // which parses + persists it, then reloads the site's parcels from the server.
  async function handleImportParcelsXlsx(
    e: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file || !selectedSite) return;
    const site = selectedSite;
    try {
      showNotif("⏳ Uploading parcels...");
      const form = new FormData();
      form.append("file", file);
      form.append("siteId", String(site.id));

      const token = getToken();
      const res = await fetch("/api/parcels/upload", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error((data as { error?: string }).error || "Upload failed");

      await reloadData(site);
      showNotif(
        `✅ ${(data as { message?: string }).message || "Parcels updated"}`,
      );
    } catch (err) {
      showNotif(`❌ ${(err as Error).message || "Failed to upload parcels"}`);
    }
  }

  // Import JSON backup uploader
  function handleImportJson(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        const incoming = Array.isArray(parsed) ? parsed : parsed.findings || [];
        if (!Array.isArray(incoming) || incoming.length === 0) {
          showNotif("⚠️ Invalid JSON file backup structure.");
          return;
        }

        if (!selectedSite) return;
        const site = selectedSite;

        const replacing = findings.length > 0;
        const ok = await confirm({
          title: replacing ? "Replace all findings?" : "Import findings?",
          message: replacing
            ? `Replace all ${findings.length} current findings with ${incoming.length} from the backup? This cannot be undone.`
            : `Import ${incoming.length} findings from the backup?`,
          confirmLabel: replacing ? "Replace" : "Import",
          danger: replacing,
        });
        if (!ok) return;

        const czArr: ConstructionZone[] = parsed.constructionZones || [];

        showNotif("⏳ Importing backup to server...");
        // Replace server state: clear, then recreate each finding (+ its visits) and zone.
        await findingsApi.clearFindings(site.id);

        for (const loc of incoming as Finding[]) {
          const visits = [...(loc.visits || [])];
          if (!visits.length) continue;
          const [first, ...rest] = visits;
          const firstPhotos = await resolvePhotoUrls(site, first.photos || []);
          await findingsApi.createFinding({
            siteId: site.id,
            id: loc.id,
            lat: loc.lat,
            lng: loc.lng,
            parcel_id: loc.parcel_id || "",
            ref_num: loc.ref_num || "001",
            visit: { ...toVisitPayload(first), photos: firstPhotos },
          });
          for (const v of rest) {
            const photos = await resolvePhotoUrls(site, v.photos || []);
            await findingsApi.addVisit(site.id, loc.id, {
              ...toVisitPayload(v),
              photos,
            });
          }
        }

        for (const cz of czArr) {
          await findingsApi.createZone(site.id, { lat: cz.lat, lng: cz.lng });
        }

        await reloadData(site);
        showNotif(`✅ Imported ${incoming.length} finding(s)`);
      } catch (err) {
        showNotif(`❌ ${(err as Error).message || "Invalid JSON backup file"}`);
      }
    };
    reader.readAsText(file);
  }

  // Export JSON backup downloder
  async function handleExportJson() {
    try {
      showNotif("⏳ Exporting backup JSON...");
      const exportFinds = [];
      for (const loc of findings) {
        const visits = [];
        for (const v of loc.visits) {
          visits.push(v);
        }
        exportFinds.push({ ...loc, visits });
      }

      const date = new Date().toISOString().slice(0, 10);
      const payload = {
        source: "PesTrack_SiteManager",
        client: selectedSite?.slug || "ElGouna",
        exportDate: date,
        includesPhotos: true,
        findings: exportFinds,
        constructionZones,
      };

      const json = JSON.stringify(payload);
      const blob = new Blob([json], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${selectedSite?.slug || "ElGouna"}_Findings_${date}.json`;
      a.click();
      showNotif(`✅ Exported ${findings.length} finding(s)`);
    } catch (e: any) {
      showNotif("❌ Export failed: " + e.message);
    }
  }

  return (
    <div className="h-full w-full relative select-none">
      {/* ── Legacy Header ── */}
      <Header
        sites={sites}
        loadingSites={loadingSites}
        selectedSite={selectedSite}
        onSelectSite={setSelectedSite}
        user={user}
        activeTool={activeTool}
        hideResolved={hideResolved}
        hideConstr={hideConstr}
        onlyConstr={onlyConstr}
        onToggleTool={(tool) => {
          setActiveTool((cur) => (cur === tool ? "none" : tool));
          const turningOff = activeTool === tool;
          if (tool === "finding") {
            showNotif(
              turningOff
                ? "Deactivated Add Finding tool"
                : "🔍 Add Finding: Click anywhere on the map to place a finding",
            );
          } else {
            showNotif(
              turningOff
                ? "Deactivated Construction Zone tool"
                : "🏗 Constr. Zone: Click anywhere on the map to add construction zone",
            );
          }
        }}
        onToggleHideResolved={() => setHideResolved(!hideResolved)}
        onToggleHideConstr={() => setHideConstr(!hideConstr)}
        onToggleOnlyConstr={() => setOnlyConstr(!onlyConstr)}
        onExportJson={handleExportJson}
        onImportJson={handleImportJson}
        onOpenPdf={() => setPdfModalOpen(true)}
        onImportParcels={handleImportParcelsXlsx}
        onLogout={async () => {
          const ok = await confirm({
            title: "Log out?",
            message: "You will be signed out of PesTrack.",
            confirmLabel: "Log out",
          });
          if (ok) logout();
        }}
      />

      {/* ── Legacy Map ── */}
      <div id="map" ref={mapContainerRef} />

      {/* ── Finding Modal (m-fi) — field order matches legacy exactly ── */}
      {modalOpen && (
        <div className="mov">
          <div
            className="mod"
            style={{ maxWidth: "420px", maxHeight: "90vh", overflowY: "auto" }}
          >
            <h3>{modalTitle}</h3>

            {/* 1. Category grid — always shown */}
            <label
              style={{
                fontSize: ".62rem",
                color: "#888",
                textTransform: "uppercase",
                letterSpacing: ".06em",
                fontWeight: 700,
              }}
            >
              Category
            </label>
            <div className="cat-grid" id="fi-cat-grid">
              {(apiCategories.length
                ? apiCategories
                : CATS.map((c) => ({
                    id: c.id,
                    label: c.label,
                    color: c.color,
                    sort_order: 0,
                  }))
              ).map((c) => {
                const isSel =
                  String(selectedCat).trim() === String(c.id).trim();
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelectedCat(c.id)}
                    className={`cat-btn ${isSel ? "sel" : ""}`}
                    style={
                      isSel && c.color
                        ? {
                            backgroundColor: c.color,
                            color: "#fff",
                            borderColor: c.color,
                          }
                        : {}
                    }
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>

            {/* 2. Status row — always shown */}
            <label
              style={{
                fontSize: ".62rem",
                color: "#888",
                textTransform: "uppercase",
                letterSpacing: ".06em",
                fontWeight: 700,
              }}
            >
              Status
            </label>
            <div className="status-row">
              {(apiStatuses.length
                ? apiStatuses
                : ([
                    {
                      id: "open",
                      label: "1st Offense",
                      emoji: "🟠",
                      color: "#FB923C",
                      sort_order: 1,
                    },
                    {
                      id: "repeat",
                      label: "Repeat",
                      emoji: "🔴",
                      color: "#EF4444",
                      sort_order: 2,
                    },
                    {
                      id: "resolved",
                      label: "Resolved",
                      emoji: "🟢",
                      color: "#22C55E",
                      sort_order: 3,
                    },
                  ] as Status[])
              ).map((s) => {
                const isSel =
                  String(selectedStat).trim() === String(s.id).trim();
                return (
                  <button
                    key={s.id}
                    onClick={() => setSelectedStat(String(s.id))}
                    className={`stat-btn ${String(s.id).trim()} ${isSel ? "sel" : ""}`}
                    style={
                      s.color
                        ? {
                            borderColor: s.color,
                            color: isSel ? "#fff" : s.color,
                            backgroundColor: isSel ? s.color : "#fff",
                          }
                        : {}
                    }
                  >
                    {s.emoji} {s.label}
                  </button>
                );
              })}
            </div>

            {/* 3. Label — always shown */}
            <label>Label (short)</label>
            <input
              id="fi-lbl"
              type="text"
              placeholder="e.g. Blocked drain NE corner…"
              value={inputLabel}
              onChange={(e) => setInputLabel(e.target.value)}
            />

            {/* 4. Date — always shown */}
            <label>Date of inspection</label>
            <input
              id="fi-date"
              type="date"
              value={inputDate}
              onChange={(e) => setInputDate(e.target.value)}
            />

            {/* 5. Notes textarea — always shown */}
            <label>Observations, Recommendations & Action</label>
            <textarea
              id="fi-notes"
              rows={3}
              value={inputNotes}
              onChange={(e) => setInputNotes(e.target.value)}
              placeholder="Describe the finding, recommended corrective action, and any action taken or assigned…"
            />

            {/* 6. Assigned/Escalated — always shown */}
            <label>
              Assigned / Escalated to{" "}
              <span style={{ fontWeight: 400, color: "#94A3B8" }}>
                (optional)
              </span>
            </label>
            <select
              id="fi-escalated"
              value={inputEscalated}
              onChange={(e) => setInputEscalated(e.target.value)}
              style={{
                width: "100%",
                padding: "6px 8px",
                borderRadius: "4px",
                border: "1px solid #D0D5DD",
                fontSize: "0.9rem",
                fontFamily: "inherit",
              }}
            >
              <option value="">— Not assigned —</option>
              {apiEscalations.length ? (
                apiEscalations.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                  </option>
                ))
              ) : (
                <>
                  <option value="SOTAICO">SOTAICO</option>
                  <option value="Client QA">Client QA</option>
                  <option value="Client FM">Client FM</option>
                  <option value="Client Subcontractor RS">
                    Client Subcontractor RS
                  </option>
                  <option value="Client Subcontractor OC">
                    Client Subcontractor OC
                  </option>
                  <option value="Client Subcontractor Other">
                    Client Subcontractor Other
                  </option>
                  <option value="Client Senior Management">
                    Client Senior Management
                  </option>
                  <option value="Other">Other</option>
                </>
              )}
            </select>

            {/* 7. Parcel / GPS — always shown */}
            <label>Parcel / Area</label>
            <select
              id="fi-parcel"
              value={inputParcel}
              onChange={(e) => setInputParcel(e.target.value)}
              style={{
                width: "100%",
                padding: "6px 8px",
                borderRadius: "4px",
                border: "1px solid #D0D5DD",
                fontSize: "0.9rem",
                fontFamily: "inherit",
              }}
            >
              <option value="">-- Choose Parcel --</option>
              {parcels.map((p) => (
                <option key={p.id || p.name} value={p.id}>
                  [{p.quad}] {p.name}
                </option>
              ))}
            </select>

            <label>
              GPS Coordinates{" "}
              <span style={{ fontWeight: 400, color: "#94A3B8" }}>
                (optional — paste from Google Maps)
              </span>
            </label>
            <input
              id="fi-coords"
              type="text"
              placeholder="e.g. 27.3949, 33.6782"
              value={inputCoords}
              onChange={(e) => {
                setInputCoords(e.target.value);
                const parsed = parseCoords(e.target.value);
                if (parsed) setInputCoords(`${parsed.lat}, ${parsed.lng}`);
              }}
              autoComplete="off"
              style={{ fontFamily: "monospace" }}
            />

            {/* 8. Photos — always shown */}
            <label>Photos</label>
            <input
              type="file"
              id="fi-photo-in"
              multiple
              accept="image/*"
              style={{ display: "none" }}
              onChange={handlePhotoUpload}
            />
            <button
              className="sbbtn s"
              onClick={() => document.getElementById("fi-photo-in")?.click()}
              style={{ margin: "0 0 5px" }}
            >
              📷 Add Photos
            </button>
            <div
              id="fi-photo-preview"
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "4px",
                marginTop: "5px",
              }}
            >
              {pendingPhotos.map((src, pIdx) => (
                <div key={pIdx} className="photo-wrap">
                  <img
                    src={src}
                    alt="preview"
                    style={{
                      width: "54px",
                      height: "40px",
                      objectFit: "cover",
                      borderRadius: "3px",
                      border: "1px solid #ddd",
                      cursor: "pointer",
                    }}
                  />
                  <button
                    onClick={() =>
                      setPendingPhotos((prev) =>
                        prev.filter((_, i) => i !== pIdx),
                      )
                    }
                    className="fi-photo-del"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

            {/* 9. Action buttons */}
            <div className="mbtns" style={{ marginTop: "10px" }}>
              <button
                className="bcancel"
                onClick={() => {
                  setModalOpen(false);
                  setEditLocId(null);
                  setEditVisitId(null);
                  pendingClickRef.current = null;
                }}
              >
                Cancel
              </button>
              <button className="bok" onClick={handleSaveFinding}>
                Save Finding
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── PDF Sort Modal ── */}
      {pdfModalOpen && (
        <div className="mov">
          <div className="mod" style={{ maxWidth: "360px" }}>
            <h3>📋 PDF Report — Sort Order</h3>
            <p
              style={{
                fontSize: "11px",
                color: "#64748B",
                marginBottom: "14px",
                marginTop: "-4px",
              }}
            >
              Choose how findings are ordered in the report:
            </p>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "10px",
                marginBottom: "18px",
              }}
            >
              {/* Option 1 */}
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  cursor: "pointer",
                  padding: "8px 10px",
                  borderRadius: "6px",
                  border: `1.5px solid ${pdfSort === "number" ? "#7C3AED" : "#E2E8F0"}`,
                  background: pdfSort === "number" ? "#F5F3FF" : "#fff",
                  transition: "all .15s",
                }}
              >
                <input
                  type="radio"
                  name="pdf-sort"
                  checked={pdfSort === "number"}
                  onChange={() => setPdfSort("number")}
                  style={{
                    width: "15px",
                    height: "15px",
                    flexShrink: 0,
                    accentColor: "#7C3AED",
                    cursor: "pointer",
                  }}
                />
                <span
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    lineHeight: 1.3,
                  }}
                >
                  <strong style={{ fontSize: "12px", color: "#1C2333" }}>
                    Finding #
                  </strong>
                  <span style={{ fontSize: "10px", color: "#94A3B8" }}>
                    Default — sequential order
                  </span>
                </span>
              </label>

              {/* Option 2 */}
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  cursor: "pointer",
                  padding: "8px 10px",
                  borderRadius: "6px",
                  border: `1.5px solid ${pdfSort === "category" ? "#7C3AED" : "#E2E8F0"}`,
                  background: pdfSort === "category" ? "#F5F3FF" : "#fff",
                  transition: "all .15s",
                }}
              >
                <input
                  type="radio"
                  name="pdf-sort"
                  checked={pdfSort === "category"}
                  onChange={() => setPdfSort("category")}
                  style={{
                    width: "15px",
                    height: "15px",
                    flexShrink: 0,
                    accentColor: "#7C3AED",
                    cursor: "pointer",
                  }}
                />
                <span
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    lineHeight: 1.3,
                  }}
                >
                  <strong style={{ fontSize: "12px", color: "#1C2333" }}>
                    By Category
                  </strong>
                  <span style={{ fontSize: "10px", color: "#94A3B8" }}>
                    Grouped by category type
                  </span>
                </span>
              </label>

              {/* Option 3 */}
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  cursor: "pointer",
                  padding: "8px 10px",
                  borderRadius: "6px",
                  border: `1.5px solid ${pdfSort === "escalated" ? "#7C3AED" : "#E2E8F0"}`,
                  background: pdfSort === "escalated" ? "#F5F3FF" : "#fff",
                  transition: "all .15s",
                }}
              >
                <input
                  type="radio"
                  name="pdf-sort"
                  checked={pdfSort === "escalated"}
                  onChange={() => setPdfSort("escalated")}
                  style={{
                    width: "15px",
                    height: "15px",
                    flexShrink: 0,
                    accentColor: "#7C3AED",
                    cursor: "pointer",
                  }}
                />
                <span
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    lineHeight: 1.3,
                  }}
                >
                  <strong style={{ fontSize: "12px", color: "#1C2333" }}>
                    By Assigned / Escalated To
                  </strong>
                  <span style={{ fontSize: "10px", color: "#94A3B8" }}>
                    Based on latest visit
                  </span>
                </span>
              </label>

              {/* Option 4 */}
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  cursor: "pointer",
                  padding: "8px 10px",
                  borderRadius: "6px",
                  border: `1.5px solid ${pdfSort === "quadrant" ? "#7C3AED" : "#E2E8F0"}`,
                  background: pdfSort === "quadrant" ? "#F5F3FF" : "#fff",
                  transition: "all .15s",
                }}
              >
                <input
                  type="radio"
                  name="pdf-sort"
                  checked={pdfSort === "quadrant"}
                  onChange={() => setPdfSort("quadrant")}
                  style={{
                    width: "15px",
                    height: "15px",
                    flexShrink: 0,
                    accentColor: "#7C3AED",
                    cursor: "pointer",
                  }}
                />
                <span
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    lineHeight: 1.3,
                  }}
                >
                  <strong style={{ fontSize: "12px", color: "#1C2333" }}>
                    By Quadrant &amp; Parcel
                  </strong>
                  <span style={{ fontSize: "10px", color: "#94A3B8" }}>
                    NW → NE → SW → SE, then by parcel
                  </span>
                </span>
              </label>
            </div>

            <div className="mbtns">
              <button
                className="bcancel"
                onClick={() => setPdfModalOpen(false)}
              >
                Cancel
              </button>
              <button
                className="bok"
                style={{ background: "#7C3AED" }}
                onClick={generatePdfReport}
              >
                Generate PDF
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Legacy Lightbox Overlay (fi-lightbox) ── */}
      {lightboxSrc && (
        <div id="fi-lightbox" onClick={() => setLightboxSrc(null)}>
          <img src={lightboxSrc} alt="Full inspection size" />
        </div>
      )}

      {/* ── Legacy Notification Bar ── */}
      {notifText && (
        <div
          id="notif"
          style={{
            display: "block",
            position: "fixed",
            top: "74px",
            left: "50%",
            transform: "translateX(-50%)",
            background: "#1C2333",
            color: "#fff",
            padding: "8px 18px",
            borderRadius: "20px",
            fontSize: ".78rem",
            fontWeight: 600,
            zIndex: 5000,
            boxShadow: "0 4px 16px rgba(0,0,0,.3)",
            whiteSpace: "nowrap",
          }}
        >
          {notifText}
        </div>
      )}
    </div>
  );
}
