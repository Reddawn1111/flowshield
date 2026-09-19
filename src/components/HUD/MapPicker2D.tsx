import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';

interface MapPicker2DProps {
  lat: number;
  lon: number;
  boxSizeMeters: number;
  onSelectCoords: (lat: number, lon: number) => void;
}

const CARTO_API_KEY = (import.meta as any).env?.VITE_CARTO_API_KEY || 'cb1_3qpu_1_175ab61e2e6c39ded466ba7d';

export const MapPicker2D: React.FC<MapPicker2DProps> = ({
  lat,
  lon,
  boxSizeMeters,
  onSelectCoords,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const bboxRectRef = useRef<L.Rectangle | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const [basemap, setBasemap] = useState<'esri' | 'carto'>('carto');

  // Compute bounding box corners for Leaflet
  const getBBoxBounds = (centerLat: number, centerLon: number, sizeMeters: number): L.LatLngBoundsExpression => {
    const halfM = sizeMeters / 2;
    const dLat = halfM / 111320.0;
    const latRad = (centerLat * Math.PI) / 180.0;
    const dLon = halfM / (111320.0 * Math.max(0.1, Math.cos(latRad)));

    return [
      [centerLat - dLat, centerLon - dLon],
      [centerLat + dLat, centerLon + dLon],
    ];
  };

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    // Create Map
    const map = L.map(mapContainerRef.current, {
      center: [lat, lon],
      zoom: 15,
      zoomControl: false,
      attributionControl: false,
    });

    // Add Base Tile Layer
    const tileUrl =
      basemap === 'esri'
        ? 'https://services.arcgisonline.com/arcgis/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'
        : `https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png?key=${CARTO_API_KEY}`;

    const layer = L.tileLayer(tileUrl, {
      maxZoom: 18,
      subdomains: 'abcd',
    }).addTo(map);
    tileLayerRef.current = layer;

    // Custom Glowing Marker Icon
    const customIcon = L.divIcon({
      className: 'flowshield-map-pin',
      html: `
        <div class="relative flex items-center justify-center -translate-x-1/2 -translate-y-1/2">
          <div class="absolute w-8 h-8 rounded-full bg-cyan-400/30 animate-ping"></div>
          <div class="relative w-4 h-4 rounded-full bg-cyan-400 border-2 border-slate-950 shadow-[0_0_12px_#00f0ff]"></div>
        </div>
      `,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });

    // Marker
    const marker = L.marker([lat, lon], { icon: customIcon }).addTo(map);
    markerRef.current = marker;

    // Bounding Box Rectangle
    const bounds = getBBoxBounds(lat, lon, boxSizeMeters);
    const rect = L.rectangle(bounds, {
      color: '#00e5ff',
      weight: 1.5,
      fillColor: '#00e5ff',
      fillOpacity: 0.12,
      dashArray: '5, 5',
    }).addTo(map);
    bboxRectRef.current = rect;

    // Map Click Listener
    map.on('click', (e: L.LeafletMouseEvent) => {
      onSelectCoords(e.latlng.lat, e.latlng.lng);
    });

    mapInstanceRef.current = map;

    // Invalidate size after initial render animation
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 250);

    return () => {
      clearTimeout(timer);
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Update center, marker, and bounding box when props change
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    map.flyTo([lat, lon], map.getZoom(), { duration: 0.8 });

    if (markerRef.current) {
      markerRef.current.setLatLng([lat, lon]);
    }

    if (bboxRectRef.current) {
      const newBounds = getBBoxBounds(lat, lon, boxSizeMeters);
      bboxRectRef.current.setBounds(newBounds);
    }
  }, [lat, lon, boxSizeMeters]);

  // Switch tile layer when basemap state changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }

    const tileUrl =
      basemap === 'esri'
        ? 'https://services.arcgisonline.com/arcgis/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'
        : `https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png?key=${CARTO_API_KEY}`;

    const layer = L.tileLayer(tileUrl, {
      maxZoom: 18,
      subdomains: 'abcd',
    }).addTo(map);
    tileLayerRef.current = layer;
  }, [basemap]);

  return (
    <div className="relative w-full h-full rounded-2xl overflow-hidden border border-slate-700/80 shadow-inner">
      <div ref={mapContainerRef} className="w-full h-full z-0 cursor-crosshair" />

      {/* Crosshair Overlay in Center */}
      <div className="absolute top-3 left-3 z-10 pointer-events-none bg-slate-950/80 backdrop-blur-md px-3 py-1.5 rounded-xl border border-slate-700/80 text-[11px] font-mono text-cyan-400 flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
        <span>CLICK ANYWHERE TO PIN TARGET BBOX</span>
      </div>

      {/* Bottom Right Basemap Switcher */}
      <div className="absolute bottom-3 right-3 z-10 flex items-center gap-1.5 bg-slate-950/90 backdrop-blur-md px-2 py-1 rounded-lg border border-slate-800 text-[10px] font-mono text-slate-400 pointer-events-auto">
        <span>Basemap:</span>
        <button
          type="button"
          onClick={() => setBasemap('esri')}
          className={`px-1.5 py-0.5 rounded transition-colors ${
            basemap === 'esri' ? 'bg-cyan-500/20 text-cyan-400 font-bold border border-cyan-500/40' : 'hover:text-white'
          }`}
        >
          ESRI Dark
        </button>
        <span>|</span>
        <button
          type="button"
          onClick={() => setBasemap('carto')}
          className={`px-1.5 py-0.5 rounded transition-colors ${
            basemap === 'carto' ? 'bg-cyan-500/20 text-cyan-400 font-bold border border-cyan-500/40' : 'hover:text-white'
          }`}
        >
          CARTO Dark
        </button>
      </div>
    </div>
  );
};
