export interface GeocodingResult {
  placeId: number;
  displayName: string;
  name: string;
  lat: number;
  lon: number;
  type: string;
  importance: number;
  boundingBox: [number, number, number, number]; // [south, north, west, east]
}

export async function searchNominatim(query: string): Promise<GeocodingResult[]> {
  if (!query || query.trim().length < 2) return [];

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
      query.trim()
    )}&limit=5&addressdetails=1`;

    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      console.warn(`Nominatim geocoding failed with status ${res.status}`);
      return [];
    }

    const data = await res.json();
    if (!Array.isArray(data)) return [];

    return data.map((item: any) => {
      const lat = parseFloat(item.lat);
      const lon = parseFloat(item.lon);
      const bb = item.boundingbox ? item.boundingbox.map(parseFloat) : [lat - 0.005, lat + 0.005, lon - 0.005, lon + 0.005];
      
      const displayName = item.display_name || item.name || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
      const shortName = item.name || displayName.split(',')[0];

      return {
        placeId: item.place_id,
        displayName,
        name: shortName,
        lat,
        lon,
        type: item.type || 'place',
        importance: item.importance || 0,
        boundingBox: [bb[0], bb[1], bb[2], bb[3]], // [south, north, west, east]
      };
    });
  } catch (err) {
    console.error('Nominatim query error:', err);
    return [];
  }
}
