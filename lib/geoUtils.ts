/**
 * Geolocation & Geofencing utility functions for staff attendance.
 * Handles distance calculation (Haversine formula), Google Maps URL & coordinate parsing,
 * and geofence boundary verification.
 */

export interface ParsedLocation {
  latitude: number;
  longitude: number;
  name?: string;
  source: 'coords' | 'gmaps_url' | 'place_url';
}

/**
 * Calculates straight-line distance in meters between two GPS coordinates using the Haversine formula.
 */
export function calculateDistanceInMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  if (isNaN(lat1) || isNaN(lon1) || isNaN(lat2) || isNaN(lon2)) return Infinity;

  const R = 6371e3; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const deltaPhi = toRad(lat2 - lat1);
  const deltaLambda = toRad(lon2 - lon1);

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
}

/**
 * Formats distance in meters or kilometers with user-friendly label.
 */
export function formatDistance(meters: number): string {
  if (meters === Infinity || isNaN(meters)) return 'Unknown distance';
  if (meters < 1000) {
    return `${meters}m`;
  }
  return `${(meters / 1000).toFixed(2)} km`;
}

/**
 * Parses user input which can be:
 * 1. Plain coordinates: "16.506174, 80.648015" or "16.506174 80.648015"
 * 2. Google Maps place URL: "https://www.google.com/maps/place/Benz+Circle/@16.506174,80.648015,17z/..."
 * 3. Google Maps query URL: "https://maps.google.com/?q=16.506174,80.648015"
 * 4. Google Maps search URL: "https://www.google.com/maps/search/?api=1&query=16.506174,80.648015"
 * 5. Short link with query or any URL containing lat/long numbers.
 */
export function parseGoogleMapsUrlOrCoords(input: string): ParsedLocation | null {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();

  // Pattern 1: URL with /@lat,long,
  const atMatch = trimmed.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (atMatch) {
    const lat = parseFloat(atMatch[1]);
    const lng = parseFloat(atMatch[2]);
    let name: string | undefined;
    const placeMatch = trimmed.match(/\/place\/([^/@?]+)/);
    if (placeMatch) {
      name = decodeURIComponent(placeMatch[1].replace(/\+/g, ' '));
    }
    if (isValidLatLng(lat, lng)) {
      return { latitude: lat, longitude: lng, name, source: 'place_url' };
    }
  }

  // Pattern 2: URL with q=lat,long or query=lat,long or ll=lat,long
  const queryMatch = trimmed.match(/[?&](?:q|query|ll)=(-?\d+\.\d+)(?:%2C|,|\+)(-?\d+\.\d+)/i);
  if (queryMatch) {
    const lat = parseFloat(queryMatch[1]);
    const lng = parseFloat(queryMatch[2]);
    if (isValidLatLng(lat, lng)) {
      return { latitude: lat, longitude: lng, source: 'gmaps_url' };
    }
  }

  // Pattern 3: URL with !3d<lat>!4d<lng> (protobuf map data)
  const protoMatch = trimmed.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (protoMatch) {
    const lat = parseFloat(protoMatch[1]);
    const lng = parseFloat(protoMatch[2]);
    if (isValidLatLng(lat, lng)) {
      return { latitude: lat, longitude: lng, source: 'place_url' };
    }
  }

  // Pattern 4: Raw coordinates string "16.506174, 80.648015" or "16.506174,80.648015"
  const rawCoordsMatch = trimmed.match(/^(-?\d+\.\d+)[,\s]+(-?\d+\.\d+)$/);
  if (rawCoordsMatch) {
    const lat = parseFloat(rawCoordsMatch[1]);
    const lng = parseFloat(rawCoordsMatch[2]);
    if (isValidLatLng(lat, lng)) {
      return { latitude: lat, longitude: lng, source: 'coords' };
    }
  }

  // Pattern 5: Deg/Min/Sec or degrees with N/S, E/W
  const degreeMatch = trimmed.match(/(\d+\.?\d*)\s*°?\s*([NS])[,\s]+(\d+\.?\d*)\s*°?\s*([EW])/i);
  if (degreeMatch) {
    let lat = parseFloat(degreeMatch[1]);
    let lng = parseFloat(degreeMatch[3]);
    if (degreeMatch[2].toUpperCase() === 'S') lat = -lat;
    if (degreeMatch[4].toUpperCase() === 'W') lng = -lng;
    if (isValidLatLng(lat, lng)) {
      return { latitude: lat, longitude: lng, source: 'coords' };
    }
  }

  return null;
}

function isValidLatLng(lat: number, lng: number): boolean {
  return !isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

/**
 * Safely fetches current browser coordinates via Geolocation API with a timeout fallback.
 */
export function getCurrentBrowserPosition(
  timeoutMs = 6000
): Promise<{ latitude: number; longitude: number; accuracy: number } | null> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      resolve(null);
      return;
    }

    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(null);
      }
    }, timeoutMs);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          });
        }
      },
      () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve(null);
        }
      },
      {
        enableHighAccuracy: true,
        timeout: timeoutMs,
        maximumAge: 30000,
      }
    );
  });
}

