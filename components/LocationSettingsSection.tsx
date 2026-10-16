'use client';

import React, { useState, useEffect } from 'react';
import { BusinessSettings, User } from '../lib/types';
import { parseGoogleMapsUrlOrCoords, calculateDistanceInMeters, formatDistance } from '../lib/geoUtils';

interface LocationSettingsSectionProps {
  settings: BusinessSettings;
  currentUser: User;
  onUpdateSettings: (settings: Partial<BusinessSettings>) => Promise<void>;
}

export const LocationSettingsSection: React.FC<LocationSettingsSectionProps> = ({
  settings,
  currentUser,
  onUpdateSettings,
}) => {
  const currentLoc = settings.attendanceLocation || {
    enabled: true,
    latitude: 16.506174,
    longitude: 80.648015,
    radiusMeters: 150,
    locationName: settings.restaurantName ? `${settings.restaurantName}, Benz Circle` : 'United Food Palace, Benz Circle',
    googleMapsUrl: 'https://maps.google.com/?q=16.506174,80.648015',
    enforceForLogin: false,
  };

  const [enabled, setEnabled] = useState<boolean>(currentLoc.enabled ?? true);
  const [pastedInput, setPastedInput] = useState<string>(currentLoc.googleMapsUrl || `${currentLoc.latitude}, ${currentLoc.longitude}`);
  const [latitude, setLatitude] = useState<number>(currentLoc.latitude || 16.506174);
  const [longitude, setLongitude] = useState<number>(currentLoc.longitude || 80.648015);
  const [radiusMeters, setRadiusMeters] = useState<number>(currentLoc.radiusMeters || 150);
  const [locationName, setLocationName] = useState<string>(currentLoc.locationName || settings.restaurantName || 'United Food Palace');
  const [enforceForLogin, setEnforceForLogin] = useState<boolean>(currentLoc.enforceForLogin ?? false);

  // Status & live detection feedback
  const [parsedStatus, setParsedStatus] = useState<{
    valid: boolean;
    message: string;
    source?: string;
  }>({ valid: true, message: 'Valid coordinates' });
  const [detectingGps, setDetectingGps] = useState<boolean>(false);
  const [gpsError, setGpsError] = useState<string>('');
  const [testCoords, setTestCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [testDistance, setTestDistance] = useState<number | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);

  // Real-time parser when superadmin pastes a URL or coordinates
  useEffect(() => {
    if (!pastedInput.trim()) {
      setParsedStatus({ valid: false, message: 'Paste a Google Maps link or latitude, longitude coordinates' });
      return;
    }

    const parsed = parseGoogleMapsUrlOrCoords(pastedInput);
    if (parsed) {
      setLatitude(parsed.latitude);
      setLongitude(parsed.longitude);
      if (parsed.name && !locationName) {
        setLocationName(parsed.name);
      }
      setParsedStatus({
        valid: true,
        message: `Extracted coordinates: ${parsed.latitude.toFixed(6)}, ${parsed.longitude.toFixed(6)}`,
        source: parsed.source === 'coords' ? 'Raw GPS Coordinates' : 'Google Maps Location Link',
      });
    } else {
      setParsedStatus({
        valid: false,
        message: 'Could not extract latitude & longitude. Ensure link or coordinates match: 16.506174, 80.648015',
      });
    }
  }, [pastedInput]);

  // Recalculate test distance whenever testCoords change
  useEffect(() => {
    if (testCoords) {
      const dist = calculateDistanceInMeters(latitude, longitude, testCoords.lat, testCoords.lng);
      setTestDistance(dist);
    }
  }, [latitude, longitude, testCoords]);

  // Detect live GPS location of the device currently in superadmin's hand
  const handleDetectCurrentLocation = () => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      setGpsError('Geolocation is not supported by your browser.');
      return;
    }

    setDetectingGps(true);
    setGpsError('');

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = parseFloat(pos.coords.latitude.toFixed(6));
        const lng = parseFloat(pos.coords.longitude.toFixed(6));
        setLatitude(lat);
        setLongitude(lng);
        setPastedInput(`https://maps.google.com/?q=${lat},${lng}`);
        setTestCoords({ lat, lng });
        setDetectingGps(false);
      },
      (err) => {
        console.warn('Geolocation error:', err);
        setGpsError(err.message || 'GPS location permission was denied or timed out.');
        setDetectingGps(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  };

  // Test current device against configured geofence
  const handleTestDistanceNow = () => {
    if (typeof window === 'undefined' || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setTestCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      (err) => {
        setGpsError(`Test GPS error: ${err.message}`);
      },
      { enableHighAccuracy: true }
    );
  };

  // Save to Settings
  const handleSaveLocation = async () => {
    if (!parsedStatus.valid) {
      alert('Please provide valid latitude and longitude coordinates before saving.');
      return;
    }

    setSaving(true);
    setSavedSuccess(false);

    try {
      const updatedLocation = {
        enabled,
        latitude,
        longitude,
        radiusMeters,
        locationName: locationName.trim() || settings.restaurantName || 'Restaurant Premises',
        googleMapsUrl: pastedInput.trim(),
        enforceForLogin,
      };

      await onUpdateSettings({
        attendanceLocation: updatedLocation,
      });

      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3500);
    } catch (err: any) {
      console.error(err);
      alert('Failed to save location settings: ' + (err.message || 'Server error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-4 sm:p-6 lg:p-7 flex flex-col gap-6">
      {/* ── SECTION HEADER ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-slate-100">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-forest-950 via-forest-900 to-forest-950 text-gold-400 flex items-center justify-center shadow-md border border-gold-500/30">
            <span className="material-symbols-outlined text-2xl text-gold-300">pin_drop</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base sm:text-lg font-black text-slate-900 tracking-tight">
                Attendance Geolocation &amp; Geo-fencing
              </h3>
              <span
                className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border ${
                  enabled
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                    : 'bg-slate-100 text-slate-500 border-slate-200'
                }`}
              >
                {enabled ? '🟢 Enforced Active' : '⚪ Geofencing Disabled'}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Paste your Google Maps location to lock attendance. Staff outside these coordinates will be strictly blocked.
            </p>
          </div>
        </div>

        {/* Master Geofence Toggle Switch */}
        <label className="flex items-center gap-3 cursor-pointer bg-slate-50 px-3.5 py-2 rounded-xl border border-slate-200 hover:bg-slate-100 transition-all">
          <span className="text-xs font-bold text-slate-700">Enforce Geofence</span>
          <div className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
          </div>
        </label>
      </div>

      {/* ── PASTE GOOGLE MAPS LOCATION URL / COORDINATES ────────────────────── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
            <span className="material-symbols-outlined text-base text-rose-600">add_location_alt</span>
            <span>Paste Google Maps Link or GPS Coordinates</span>
          </label>
          <button
            type="button"
            onClick={handleDetectCurrentLocation}
            disabled={detectingGps}
            className="text-xs font-bold text-emerald-700 hover:text-emerald-800 bg-emerald-50 hover:bg-emerald-100 px-3 py-1 rounded-lg border border-emerald-200 flex items-center gap-1 transition-all active:scale-95 disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-sm">
              {detectingGps ? 'hourglass_top' : 'my_location'}
            </span>
            <span>{detectingGps ? 'Detecting GPS...' : 'Auto-Detect My Location'}</span>
          </button>
        </div>

        <div className="relative">
          <input
            type="text"
            value={pastedInput}
            onChange={(e) => setPastedInput(e.target.value)}
            placeholder="Paste Google Maps URL (e.g. https://maps.google.com/?q=16.506174,80.648015) or 16.506174, 80.648015"
            className="w-full h-11 px-3.5 pr-24 rounded-xl border border-slate-300 bg-slate-50 text-xs text-slate-900 font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white transition-all"
          />
          <button
            type="button"
            onClick={() => {
              if (navigator.clipboard) {
                navigator.clipboard.readText().then((txt) => {
                  if (txt) setPastedInput(txt);
                }).catch(() => {});
              }
            }}
            className="absolute right-2 top-2 px-2.5 py-1 rounded-lg bg-slate-200 hover:bg-slate-300 text-[11px] font-bold text-slate-700 transition-all"
          >
            📋 Paste
          </button>
        </div>

        {/* Live Parsing Feedback Pill */}
        <div className="flex items-center justify-between text-xs pt-1">
          <div className="flex items-center gap-2">
            {parsedStatus.valid ? (
              <span className="flex items-center gap-1 text-emerald-700 font-bold bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200 text-[11px]">
                <span className="material-symbols-outlined text-sm">check_circle</span>
                {parsedStatus.message}
              </span>
            ) : (
              <span className="flex items-center gap-1 text-rose-700 font-bold bg-rose-50 px-2.5 py-0.5 rounded-full border border-rose-200 text-[11px]">
                <span className="material-symbols-outlined text-sm">error</span>
                {parsedStatus.message}
              </span>
            )}
            {parsedStatus.source && (
              <span className="text-[10px] text-slate-400 font-mono">
                Source: {parsedStatus.source}
              </span>
            )}
          </div>
          {gpsError && (
            <span className="text-xs text-rose-600 font-medium">⚠️ {gpsError}</span>
          )}
        </div>
      </div>

      {/* ── COORDINATES & RESTAURANT NAME GRID ─────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 bg-slate-50/80 p-4 rounded-xl border border-slate-200 text-xs">
        <div>
          <label className="block text-slate-500 font-bold uppercase text-[10px] mb-1">
            Latitude (N)
          </label>
          <input
            type="number"
            step="0.000001"
            value={latitude}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              setLatitude(val);
              setPastedInput(`${val}, ${longitude}`);
            }}
            className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white font-mono font-bold text-slate-800"
          />
        </div>

        <div>
          <label className="block text-slate-500 font-bold uppercase text-[10px] mb-1">
            Longitude (E)
          </label>
          <input
            type="number"
            step="0.000001"
            value={longitude}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              setLongitude(val);
              setPastedInput(`${latitude}, ${val}`);
            }}
            className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white font-mono font-bold text-slate-800"
          />
        </div>

        <div>
          <label className="block text-slate-500 font-bold uppercase text-[10px] mb-1">
            Premises Name / Landmark
          </label>
          <input
            type="text"
            value={locationName}
            onChange={(e) => setLocationName(e.target.value)}
            placeholder="e.g. United Food Palace, Benz Circle"
            className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white font-bold text-slate-800"
          />
        </div>
      </div>

      {/* ── GEOFENCE RADIUS CONFIGURATION ──────────────────────────────────── */}
      <div className="flex flex-col gap-3 bg-slate-50/80 p-4 rounded-xl border border-slate-200">
        <div className="flex items-center justify-between">
          <div>
            <label className="text-xs font-black text-slate-800 uppercase tracking-wider">
              Geofence Radius (Tolerance Zone)
            </label>
            <p className="text-[11px] text-slate-500">
              Staff must be within this circle from the pinned location to punch in.
            </p>
          </div>
          <div className="flex items-center gap-1.5 bg-emerald-100/90 text-emerald-900 font-black px-3 py-1 rounded-xl text-sm border border-emerald-300">
            <span>{radiusMeters}</span>
            <span className="text-xs font-semibold">meters</span>
          </div>
        </div>

        {/* Range Slider */}
        <input
          type="range"
          min="25"
          max="500"
          step="25"
          value={radiusMeters}
          onChange={(e) => setRadiusMeters(parseInt(e.target.value, 10))}
          className="w-full accent-emerald-600 cursor-pointer"
        />

        {/* Preset Buttons */}
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="text-[10px] font-bold text-slate-400 uppercase">Presets:</span>
          {[
            { meters: 50, label: '50m (Store Only)' },
            { meters: 100, label: '100m (Standard)' },
            { meters: 150, label: '150m (Premises + Parking)' },
            { meters: 250, label: '250m (Complex)' },
            { meters: 500, label: '500m (Wide)' },
          ].map((preset) => (
            <button
              key={preset.meters}
              type="button"
              onClick={() => setRadiusMeters(preset.meters)}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all ${
                radiusMeters === preset.meters
                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── GOOGLE MAPS PREVIEW & GEOFENCE TEST ─────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 overflow-hidden bg-slate-950 flex flex-col">
        <div className="p-3 bg-slate-900 text-white flex items-center justify-between text-xs border-b border-slate-800">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
            <span className="font-extrabold text-slate-200">
              Interactive Google Maps Satellite / Street Preview
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleTestDistanceNow}
              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-300 font-bold text-[11px] border border-slate-700 flex items-center gap-1 transition-all"
            >
              <span className="material-symbols-outlined text-xs">radar</span>
              <span>Test My Distance</span>
            </button>

            <a
              href={`https://www.google.com/maps?q=${latitude},${longitude}`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] flex items-center gap-1 transition-all"
            >
              <span>Open in Maps</span>
              <span className="material-symbols-outlined text-xs">open_in_new</span>
            </a>
          </div>
        </div>

        {/* Embedded Google Maps Frame */}
        <div className="relative w-full h-64 sm:h-72 bg-slate-900">
          <iframe
            title="Google Maps Geofence Preview"
            src={`https://maps.google.com/maps?q=${latitude},${longitude}&z=17&output=embed`}
            className="w-full h-full border-0"
            loading="lazy"
          />

          {/* Test Distance Overlay Pill */}
          {testDistance !== null && (
            <div className="absolute top-3 left-3 bg-slate-950/90 text-white px-3 py-1.5 rounded-xl border border-white/20 shadow-lg text-xs flex items-center gap-2 backdrop-blur-md">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  testDistance <= radiusMeters ? 'bg-emerald-400' : 'bg-rose-500'
                }`}
              />
              <span className="font-bold">
                Your device is {formatDistance(testDistance)} away
              </span>
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-black uppercase ${
                  testDistance <= radiusMeters
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400'
                    : 'bg-rose-500/20 text-rose-300 border border-rose-400'
                }`}
              >
                {testDistance <= radiusMeters ? '✓ Inside Geofence' : '✕ Outside Geofence'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── SAVE ACTION FOOTER ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-slate-100">
        <div className="flex items-center gap-2 text-xs">
          {savedSuccess && (
            <span className="flex items-center gap-1.5 text-emerald-700 font-bold bg-emerald-50 px-3 py-1.5 rounded-xl border border-emerald-200 animate-in fade-in">
              <span className="material-symbols-outlined text-base text-emerald-600">check_circle</span>
              <span>Location &amp; Geofence settings saved successfully!</span>
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={handleSaveLocation}
          disabled={saving || !parsedStatus.valid}
          className="px-6 py-2.5 rounded-xl bg-forest-950 hover:bg-forest-900 text-gold-300 border border-gold-500/40 font-extrabold text-xs shadow-md transition-all active:scale-95 disabled:opacity-50 flex items-center gap-2 ml-auto"
        >
          {saving ? (
            <>
              <span className="material-symbols-outlined text-sm animate-spin">refresh</span>
              <span>Saving Location...</span>
            </>
          ) : (
            <>
              <span className="material-symbols-outlined text-sm text-gold-400">save</span>
              <span>Save Geofence Location</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
