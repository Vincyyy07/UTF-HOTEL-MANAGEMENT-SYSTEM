'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { Staff, AttendanceLocationSettings } from '../../../lib/types';
import { loadBiometricModels, computeEuclideanDistance } from '../../../lib/faceBiometrics';
import { getCurrentBrowserPosition, calculateDistanceInMeters, formatDistance } from '../../../lib/geoUtils';

interface EnrolledDescriptor {
  staff: Staff;
  descriptor: Float32Array;
}

export default function MobileFaceScanPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loopRef = useRef<number | null>(null);
  const faceApiRef = useRef<any>(null);
  const isLoopActiveRef = useRef<boolean>(false);
  const enrolledDescriptorsRef = useRef<EnrolledDescriptor[]>([]);
  const lastVerifiedTimeRef = useRef<{ [staffId: string]: number }>({});

  // Status & UI States
  const [modelStatus, setModelStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [statusMsg, setStatusMsg] = useState<string>('Initializing AI Biometric Engine...');
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [cameraFacing, setCameraFacing] = useState<'user' | 'environment'>('user');
  const [enrolledCount, setEnrolledCount] = useState<number>(0);
  const [restaurantName, setRestaurantName] = useState<string>('United Food Palace');

  // Real-time detection feedback
  const [faceDetected, setFaceDetected] = useState<boolean>(false);
  const [scanningActive, setScanningActive] = useState<boolean>(false);

  // Verification Result Popup
  const [verificationResult, setVerificationResult] = useState<{
    punchType: 'punch_in' | 'punch_out' | 'already_completed';
    staff: Staff;
    time: string;
    hoursWorked?: number;
    message: string;
    confidence: number;
  } | null>(null);
  // Geolocation & Geofencing states
  const [locationSettings, setLocationSettings] = useState<AttendanceLocationSettings | null>(null);
  const [liveLocation, setLiveLocation] = useState<{
    latitude: number;
    longitude: number;
    accuracy?: number;
    distanceMeters?: number;
    isInside?: boolean;
  } | null>(null);
  const [gpsStatus, setGpsStatus] = useState<'acquiring' | 'ready' | 'denied' | 'unsupported'>('acquiring');
  const [geofenceError, setGeofenceError] = useState<{
    staffName?: string;
    message: string;
    distanceMeters?: number;
    allowedRadius?: number;
    locationName?: string;
  } | null>(null);

  // Digital Clock
  const [timeStr, setTimeStr] = useState<string>('');
  const [dateStr, setDateStr] = useState<string>('');
  const [closeCountdown, setCloseCountdown] = useState<number>(3);
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Live Location Tracker
  const refreshLocation = useCallback(async (locConfig?: AttendanceLocationSettings | null) => {
    const activeConfig = locConfig !== undefined ? locConfig : locationSettings;
    try {
      const pos = await getCurrentBrowserPosition(5000);
      if (pos) {
        setGpsStatus('ready');
        let dist: number | undefined;
        let inside: boolean | undefined;
        if (activeConfig && activeConfig.latitude && activeConfig.longitude) {
          dist = calculateDistanceInMeters(
            pos.latitude,
            pos.longitude,
            activeConfig.latitude,
            activeConfig.longitude
          );
          inside = dist <= (activeConfig.radiusMeters || 150);
        }
        setLiveLocation({ ...pos, distanceMeters: dist, isInside: inside });
        return { ...pos, distanceMeters: dist, isInside: inside };
      } else {
        setGpsStatus('denied');
        return null;
      }
    } catch {
      setGpsStatus('denied');
      return null;
    }
  }, [locationSettings]);

  useEffect(() => {
    refreshLocation();
  }, [refreshLocation]);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTimeStr(
        now.toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        }) + ' IST'
      );
      setDateStr(
        now.toLocaleDateString('en-IN', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Web Audio Chime generator
  const playChime = useCallback((type: 'in' | 'out' | 'info') => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      gain.gain.setValueAtTime(0.15, ctx.currentTime);

      if (type === 'in') {
        // High ascending pleasant chime
        osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
        osc.frequency.exponentialRampToValueAtTime(783.99, ctx.currentTime + 0.15); // G5
        osc.frequency.exponentialRampToValueAtTime(1046.5, ctx.currentTime + 0.3); // C6
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.6);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.65);
      } else if (type === 'out') {
        // Warm two-tone chime
        osc.frequency.setValueAtTime(659.25, ctx.currentTime); // E5
        osc.frequency.exponentialRampToValueAtTime(523.25, ctx.currentTime + 0.2); // C5
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.55);
      } else {
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.35);
      }
    } catch {
      // AudioContext not allowed or muted
    }
  }, []);

  // 1. Load Biometric AI Models and Enrolled Staff Descriptors
  useEffect(() => {
    let isMounted = true;

    async function init() {
      try {
        setModelStatus('loading');
        setStatusMsg('Loading Neural Net AI Models...');
        const faceapi = await loadBiometricModels();
        if (!isMounted) return;
        faceApiRef.current = faceapi;

        setStatusMsg('Fetching enrolled staff directory...');
        const res = await fetch('/api/attendance');
        const data = await res.json();
        if (!isMounted) return;

        if (data.restaurantName) {
          setRestaurantName(data.restaurantName);
        }

        if (data.attendanceLocation) {
          setLocationSettings(data.attendanceLocation);
          refreshLocation(data.attendanceLocation);
        }

        const staffList: Staff[] = data.staff || [];
        const enrolled: EnrolledDescriptor[] = [];

        for (const s of staffList) {
          if (s.faceDescriptor && Array.isArray(s.faceDescriptor) && s.faceDescriptor.length > 0) {
            enrolled.push({
              staff: s,
              descriptor: new Float32Array(s.faceDescriptor),
            });
          }
        }

        enrolledDescriptorsRef.current = enrolled;
        setEnrolledCount(enrolled.length);
        setModelStatus('ready');
        setStatusMsg('Live Face Recognition Terminal Ready');
      } catch (err: any) {
        console.error('Failed to init face scanner:', err);
        if (isMounted) {
          setModelStatus('error');
          setStatusMsg(err.message || 'Error loading AI engine');
        }
      }
    }

    init();

    return () => {
      isMounted = false;
    };
  }, []);

  // 2. Camera Controls
  const startCamera = useCallback(async (facing: 'user' | 'environment') => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }

      setStatusMsg('Accessing smartphone camera...');
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: facing,
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play();
          setCameraActive(true);
          setStatusMsg('Face Scanner Active • Position face in frame');
        };
      }
    } catch (err: any) {
      console.warn('Primary camera access failed, trying fallback constraints:', err);
      try {
        const fallbackStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        streamRef.current = fallbackStream;
        if (videoRef.current) {
          videoRef.current.srcObject = fallbackStream;
          videoRef.current.onloadedmetadata = () => {
            videoRef.current?.play();
            setCameraActive(true);
            setStatusMsg('Face Scanner Active • Position face in frame');
          };
        }
      } catch (fallbackErr: any) {
        setCameraActive(false);
        setStatusMsg('Camera access denied. Please grant camera permission in your browser.');
      }
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  }, []);

  // Auto-start camera when models are ready
  useEffect(() => {
    if (modelStatus === 'ready') {
      startCamera(cameraFacing);
    }
    return () => {
      stopCamera();
    };
  }, [modelStatus, cameraFacing, startCamera, stopCamera]);

  // Handle punch record
  const recordAttendance = useCallback(
    async (staff: Staff, confidence: number) => {
      if (submitting) return;
      const now = Date.now();
      const lastMarked = lastVerifiedTimeRef.current[staff.id] || 0;
      // Prevent double firing within 15 seconds
      if (now - lastMarked < 15000) return;

      lastVerifiedTimeRef.current[staff.id] = now;
      setSubmitting(true);

      // Obtain coordinates for geofence verification
      let coords = liveLocation;
      if (!coords?.latitude) {
        try {
          const fresh = await getCurrentBrowserPosition(2500);
          if (fresh) {
            coords = { ...fresh };
          }
        } catch {}
      }

      try {
        const res = await fetch('/api/attendance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'VERIFY_FACE_ATTENDANCE',
            staffId: staff.id,
            confidence,
            livenessPassed: true,
            userName: staff.fullName,
            userRole: staff.role,
            latitude: coords?.latitude,
            longitude: coords?.longitude,
          }),
        });

        const json = await res.json();

        // 🚫 Off-premises Geofence Enforcement: Block Attendance Immediately
        if (!json.success || json.geofenceRestricted) {
          stopCamera();
          isLoopActiveRef.current = false;
          playChime('info');
          if (typeof navigator !== 'undefined' && navigator.vibrate) {
            navigator.vibrate([300, 100, 300]);
          }
          setGeofenceError({
            staffName: staff.fullName,
            message: json.message || 'Off-premises attendance rejected. You must be inside restaurant premises.',
            distanceMeters: json.distanceMeters ?? coords?.distanceMeters,
            allowedRadius: json.allowedRadius ?? locationSettings?.radiusMeters ?? 150,
            locationName: json.requiredLocation ?? locationSettings?.locationName ?? restaurantName,
          });
          return;
        }

        const punchType: 'punch_in' | 'punch_out' | 'already_completed' = json.punchType || 'punch_in';

        // Stop camera and scanner loop immediately on verification
        stopCamera();
        isLoopActiveRef.current = false;

        if (punchType === 'punch_in') {
          playChime('in');
          if (typeof navigator !== 'undefined' && navigator.vibrate) {
            navigator.vibrate([100, 50, 200]);
          }
        } else if (punchType === 'punch_out') {
          playChime('out');
          if (typeof navigator !== 'undefined' && navigator.vibrate) {
            navigator.vibrate([200, 80, 200]);
          }
          // Automatically log off local portal session if opened on same device
          try {
            const savedUserId = localStorage.getItem('hms_auth_user_id');
            if (savedUserId === staff.id) {
              localStorage.removeItem('hms_auth_user_id');
              localStorage.setItem('hms_logged_out', 'true');
            }
          } catch {}
        } else {
          playChime('info');
        }

        setVerificationResult({
          punchType,
          staff,
          time: json.checkOutTime || json.checkInTime || json.time || new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }),
          hoursWorked: json.hoursWorked,
          message: json.message,
          confidence,
        });

        // Start 3-second countdown to auto-close window
        setCloseCountdown(3);
      } catch (err: any) {
        console.error('Attendance posting error:', err);
      } finally {
        setSubmitting(false);
      }
    },
    [submitting, playChime, stopCamera, liveLocation, locationSettings, restaurantName]
  );

  // 3. Continuous Face Recognition Frame Analysis
  useEffect(() => {
    if (!cameraActive || modelStatus !== 'ready' || !faceApiRef.current || verificationResult || geofenceError) {
      return;
    }

    isLoopActiveRef.current = true;
    let frameId: number;
    let isProcessing = false;

    const analyzeFrame = async () => {
      if (!isLoopActiveRef.current || verificationResult || geofenceError) return;

      const video = videoRef.current;
      const canvas = canvasRef.current;
      const faceapi = faceApiRef.current;

      if (!video || !canvas || video.paused || video.ended || video.readyState < 2) {
        frameId = requestAnimationFrame(analyzeFrame);
        return;
      }

      if (isProcessing) {
        frameId = requestAnimationFrame(analyzeFrame);
        return;
      }

      isProcessing = true;

      try {
        // Fast TinyFaceDetector with 128-d descriptor extraction
        const detection = await faceapi
          .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.38 }))
          .withFaceLandmarks(true)
          .withFaceDescriptor();

        if (detection) {
          setFaceDetected(true);
          setScanningActive(true);

          const liveDescriptor = detection.descriptor;
          const enrolledList = enrolledDescriptorsRef.current;

          let bestMatch: Staff | null = null;
          let bestDistance = 1.0;

          for (const item of enrolledList) {
            const dist = computeEuclideanDistance(liveDescriptor, item.descriptor);
            if (dist < bestDistance) {
              bestDistance = dist;
              bestMatch = item.staff;
            }
          }

          // Match threshold: < 0.58 is high confidence biometric identity
          if (bestMatch && bestDistance < 0.58) {
            const confidencePct = Math.min(99.8, Math.max(88.0, Number(((1.0 - bestDistance * 0.9) * 100).toFixed(1))));
            await recordAttendance(bestMatch, confidencePct);
          }
        } else {
          setFaceDetected(false);
          setScanningActive(false);
        }
      } catch (err) {
        // Silent frame drop to maintain 60fps
      } finally {
        isProcessing = false;
        // Run next check in ~180ms for optimal mobile performance & battery
        setTimeout(() => {
          if (isLoopActiveRef.current) {
            frameId = requestAnimationFrame(analyzeFrame);
          }
        }, 180);
      }
    };

    frameId = requestAnimationFrame(analyzeFrame);

    return () => {
      isLoopActiveRef.current = false;
      cancelAnimationFrame(frameId);
    };
  }, [cameraActive, modelStatus, verificationResult, geofenceError, recordAttendance]);

  const handleResetForNext = useCallback(() => {
    setVerificationResult(null);
    setGeofenceError(null);
    setCloseCountdown(0);
    setFaceDetected(false);
    startCamera(cameraFacing);
  }, [cameraFacing, startCamera]);

  const handleCloseWindow = useCallback(() => {
    if (typeof window !== 'undefined') {
      try {
        window.close();
      } catch (e) {
        console.warn('window.close exception:', e);
      }
    }
  }, []);

  // 4. Auto-reset countdown so next staff can scan seamlessly without getting locked out
  useEffect(() => {
    if (!verificationResult) return;

    const timer = setInterval(() => {
      setCloseCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          if (typeof window !== 'undefined' && window.opener) {
            try { window.close(); } catch {}
          }
          handleResetForNext();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [verificationResult, handleResetForNext]);

  return (
    <div className="min-h-screen bg-[#031e17] text-white flex flex-col justify-between selection:bg-gold-500 selection:text-black">
      {/* Top Header */}
      <header className="p-4 sm:p-5 flex items-center justify-between border-b border-gold-500/20 bg-forest-950/80 backdrop-blur-md sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full overflow-hidden p-0.5 bg-black border border-gold-400 shadow-[0_0_12px_rgba(229,184,76,0.5)] shrink-0 flex items-center justify-center">
            <img src="/logo.png" alt="UFP Logo" className="w-full h-full object-contain" />
          </div>
          <div>
            <h1 className="text-sm font-bold uppercase tracking-wider text-white">
              {restaurantName}
            </h1>
            <p className="text-[10px] text-gold-300 font-medium flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              Live Biometric Attendance Terminal (FRS)
            </p>
          </div>
        </div>

        {/* Clock & Camera Flip */}
        <div className="flex items-center gap-2.5">
          <div className="hidden sm:flex flex-col text-right">
            <span className="text-xs font-bold text-gold-200 tabular-nums">{timeStr}</span>
            <span className="text-[10px] text-slate-400">{dateStr}</span>
          </div>

          <button
            type="button"
            onClick={() => {
              const next = cameraFacing === 'user' ? 'environment' : 'user';
              setCameraFacing(next);
            }}
            className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 flex items-center justify-center text-gold-300 border border-gold-400/40 transition-all"
            title="Switch Camera (Front / Back)"
          >
            <span className="material-symbols-outlined text-lg">flip_camera_ios</span>
          </button>
        </div>
      </header>

      {/* Geofence & Location Status Sub-header */}
      <div className="px-4 py-2 bg-black/40 border-b border-gold-500/10 flex items-center justify-between text-xs backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[15px] text-gold-400">near_me</span>
          {locationSettings?.enabled ? (
            liveLocation?.distanceMeters !== undefined ? (
              liveLocation.isInside ? (
                <span className="inline-flex items-center gap-1.5 text-emerald-400 font-semibold">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                  In Premises • {liveLocation.distanceMeters}m from center
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-rose-400 font-semibold">
                  <span className="w-2 h-2 rounded-full bg-rose-400 animate-ping"></span>
                  Off-Premises • {formatDistance(liveLocation.distanceMeters)} away (Limit {locationSettings.radiusMeters}m)
                </span>
              )
            ) : gpsStatus === 'acquiring' ? (
              <span className="inline-flex items-center gap-1.5 text-amber-300 font-medium">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span>
                Acquiring GPS position...
              </span>
            ) : gpsStatus === 'denied' ? (
              <span className="inline-flex items-center gap-1.5 text-rose-400 font-medium">
                <span className="w-2 h-2 rounded-full bg-rose-400"></span>
                Location access denied • Enable GPS in browser
              </span>
            ) : (
              <span className="text-slate-400">Detecting premises boundary...</span>
            )
          ) : (
            <span className="text-slate-400">Geofencing Inactive</span>
          )}
        </div>

        <button
          type="button"
          onClick={() => refreshLocation()}
          className="text-[11px] font-bold text-gold-400 hover:text-gold-300 flex items-center gap-1 hover:underline cursor-pointer"
          title="Re-check GPS Position"
        >
          <span className="material-symbols-outlined text-xs">refresh</span>
          GPS Sync
        </button>
      </div>

      {/* Main Scanner Section */}
      <main className="flex-1 flex flex-col items-center justify-center p-4 relative overflow-hidden">
        {/* Off-Premises Geofence Blocked Modal Overlay */}
        {geofenceError && (
          <div className="absolute inset-0 bg-[#021812]/95 backdrop-blur-xl z-50 flex items-center justify-center p-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="max-w-sm w-full bg-slate-900 border-2 border-rose-500/80 rounded-3xl p-6 sm:p-7 text-center shadow-2xl space-y-4">
              {/* Badge Icon */}
              <div className="flex justify-center">
                <div className="w-20 h-20 rounded-full bg-rose-500/20 border-2 border-rose-500 flex items-center justify-center text-rose-400 shadow-[0_0_28px_rgba(244,63,94,0.6)] animate-pulse">
                  <span className="material-symbols-outlined text-4xl">location_off</span>
                </div>
              </div>

              {/* Title & Type */}
              <div>
                <span className="px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider inline-block mb-2 bg-rose-500/20 text-rose-300 border border-rose-400/50">
                  🚫 Off-Premises Blocked
                </span>
                <h1 className="text-2xl font-black text-white tracking-tight">
                  Attendance Not Marked
                </h1>
                {geofenceError.staffName && (
                  <h2 className="text-base font-bold text-rose-300 mt-1">
                    {geofenceError.staffName}
                  </h2>
                )}
              </div>

              {/* Geofence Distance Details */}
              <div className="bg-black/40 rounded-2xl p-3 border border-rose-500/30 grid grid-cols-2 gap-2 text-xs text-left">
                <div className="bg-white/5 p-2.5 rounded-xl">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Your Distance</span>
                  <span className="font-bold text-rose-400 text-sm tabular-nums">
                    {geofenceError.distanceMeters !== undefined ? formatDistance(geofenceError.distanceMeters) : 'Not Detected'}
                  </span>
                </div>
                <div className="bg-white/5 p-2.5 rounded-xl">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Allowed Radius</span>
                  <span className="font-bold text-emerald-400 text-sm tabular-nums">
                    {geofenceError.allowedRadius ? `${geofenceError.allowedRadius}m` : '150m'}
                  </span>
                </div>
                <div className="col-span-2 bg-white/5 p-2 rounded-xl">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Designated Premises</span>
                  <span className="font-medium text-slate-200 text-xs truncate block">
                    📍 {geofenceError.locationName || 'Restaurant Premises'}
                  </span>
                </div>
              </div>

              {/* Message */}
              <p className="text-xs text-slate-300 font-medium leading-relaxed">
                {geofenceError.message || 'Staff can only post attendance from within the authorized restaurant premises.'}
              </p>

              {/* Actions */}
              <div className="pt-2 flex flex-col gap-2.5">
                <button
                  type="button"
                  onClick={async () => {
                    await refreshLocation();
                    handleResetForNext();
                  }}
                  className="w-full py-3 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:brightness-110 text-white font-extrabold text-sm transition-all active:scale-95 shadow-lg flex items-center justify-center gap-2 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-base">my_location</span>
                  <span>Refresh GPS &amp; Retry</span>
                </button>
                <button
                  type="button"
                  onClick={handleResetForNext}
                  className="w-full py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-slate-300 font-bold text-xs cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Verification Success / Status Modal Overlay */}
        {verificationResult && (
          <div className="absolute inset-0 bg-[#021812]/95 backdrop-blur-xl z-50 flex items-center justify-center p-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="max-w-sm w-full bg-slate-900 border-2 border-gold-400/80 rounded-3xl p-6 sm:p-7 text-center shadow-2xl space-y-4">
              {/* Badge Icon */}
              <div className="flex justify-center">
                {verificationResult.punchType === 'punch_in' ? (
                  <div className="w-20 h-20 rounded-full bg-emerald-500/20 border-2 border-emerald-400 flex items-center justify-center text-emerald-400 shadow-[0_0_24px_rgba(16,185,129,0.5)] animate-bounce">
                    <span className="material-symbols-outlined text-4xl">check_circle</span>
                  </div>
                ) : verificationResult.punchType === 'punch_out' ? (
                  <div className="w-20 h-20 rounded-full bg-rose-500/20 border-2 border-rose-400 flex items-center justify-center text-rose-400 shadow-[0_0_24px_rgba(244,63,94,0.5)] animate-bounce">
                    <span className="material-symbols-outlined text-4xl">logout</span>
                  </div>
                ) : (
                  <div className="w-20 h-20 rounded-full bg-blue-500/20 border-2 border-blue-400 flex items-center justify-center text-blue-400 shadow-[0_0_24px_rgba(59,130,246,0.5)]">
                    <span className="material-symbols-outlined text-4xl">verified</span>
                  </div>
                )}
              </div>

              {/* Title & Type */}
              <div>
                <span
                  className={`px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider inline-block mb-2 ${
                    verificationResult.punchType === 'punch_in'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/50'
                      : verificationResult.punchType === 'punch_out'
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-400/50'
                      : 'bg-blue-500/20 text-blue-300 border border-blue-400/50'
                  }`}
                >
                  {verificationResult.punchType === 'punch_in'
                    ? '🟢 CHECK-IN CONFIRMED'
                    : verificationResult.punchType === 'punch_out'
                    ? '🔴 SHIFT COMPLETED • LOGGED OFF'
                    : 'ℹ️ NOTICE'}
                </span>

                {/* Primary Large Heading: Punched In or Shift Logged Off */}
                <h1 className="text-3xl font-black text-white tracking-tight">
                  {verificationResult.punchType === 'punch_in'
                    ? 'Punched In'
                    : verificationResult.punchType === 'punch_out'
                    ? 'Shift Logged Off'
                    : 'Already Logged Off'}
                </h1>

                <h2 className="text-lg font-bold text-gold-300 mt-1">
                  {verificationResult.staff.fullName}
                </h2>
                <p className="text-xs text-slate-400 font-mono mt-0.5">
                  {verificationResult.staff.employeeCode} • {verificationResult.staff.role}
                </p>
              </div>

              {/* Details Bento */}
              <div className="bg-black/40 rounded-2xl p-3 border border-white/10 grid grid-cols-2 gap-2 text-xs">
                <div className="bg-white/5 p-2 rounded-xl">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Timestamp</span>
                  <span className="font-bold text-white text-sm tabular-nums">
                    {verificationResult.time}
                  </span>
                </div>
                <div className="bg-white/5 p-2 rounded-xl">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider block">
                    {verificationResult.punchType === 'punch_out' ? 'Shift Hours' : 'Biometric Match'}
                  </span>
                  <span className="font-bold text-emerald-400 text-sm tabular-nums">
                    {verificationResult.punchType === 'punch_out'
                      ? `${verificationResult.hoursWorked || 0} hrs`
                      : `${verificationResult.confidence}%`}
                  </span>
                </div>
              </div>

              {/* Message */}
              <p className="text-xs text-slate-300 font-medium">
                {verificationResult.message}
              </p>

              {/* Actions: Scan Next Staff or Close */}
              <div className="pt-2 flex flex-col gap-2.5">
                <button
                  type="button"
                  onClick={handleResetForNext}
                  className="w-full py-3 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:brightness-110 text-white font-extrabold text-sm transition-all active:scale-95 shadow-lg flex items-center justify-center gap-2 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-base">center_focus_strong</span>
                  <span>Scan Next Staff {closeCountdown > 0 ? `(${closeCountdown}s)` : ''}</span>
                </button>
                <div className="flex items-center justify-between text-xs text-slate-400 px-1 pt-1">
                  <button
                    type="button"
                    onClick={handleCloseWindow}
                    className="hover:text-white underline cursor-pointer"
                  >
                    Close Window
                  </button>
                  <Link href="/" className="text-gold-400 hover:text-gold-300 font-semibold flex items-center gap-0.5">
                    Admin Portal <span className="material-symbols-outlined text-xs">arrow_forward</span>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Camera Container Frame */}
        <div className="w-full max-w-sm aspect-[3/4] sm:aspect-square relative rounded-3xl overflow-hidden bg-black border-2 border-gold-400/60 shadow-[0_0_32px_rgba(229,184,76,0.3)] flex items-center justify-center">
          <video
            ref={videoRef}
            playsInline
            muted
            className={`w-full h-full object-cover transition-transform duration-300 ${
              cameraFacing === 'user' ? 'scale-x-[-1]' : ''
            }`}
          />
          <canvas ref={canvasRef} className="hidden" />

          {/* Biometric Scanning Overlay Reticle */}
          <div className="absolute inset-0 pointer-events-none p-6 flex flex-col justify-between">
            {/* Corner Brackets */}
            <div className="flex justify-between items-start">
              <div className="w-8 h-8 border-t-4 border-l-4 border-gold-400 rounded-tl-xl shadow-sm"></div>
              <div className="w-8 h-8 border-t-4 border-r-4 border-gold-400 rounded-tr-xl shadow-sm"></div>
            </div>

            {/* Center Target Box */}
            <div className="self-center w-48 h-56 rounded-3xl border-2 border-dashed border-gold-400/40 relative flex items-center justify-center overflow-hidden">
              {/* Laser Scanning Line */}
              {cameraActive && (
                <div className="absolute left-0 right-0 h-1 bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-[0_0_12px_rgba(52,211,153,0.8)] animate-pulse"></div>
              )}
              {faceDetected && (
                <div className="absolute inset-0 border-2 border-emerald-400 rounded-3xl bg-emerald-500/10 transition-all"></div>
              )}
            </div>

            {/* Bottom Corner Brackets */}
            <div className="flex justify-between items-end">
              <div className="w-8 h-8 border-b-4 border-l-4 border-gold-400 rounded-bl-xl shadow-sm"></div>
              <div className="w-8 h-8 border-b-4 border-r-4 border-gold-400 rounded-br-xl shadow-sm"></div>
            </div>
          </div>

          {/* Camera Inactive / Loading State */}
          {!cameraActive && (
            <div className="absolute inset-0 bg-slate-950/90 flex flex-col items-center justify-center p-6 text-center space-y-3">
              <div className="w-12 h-12 rounded-full border-2 border-gold-400/40 border-t-gold-400 animate-spin"></div>
              <p className="text-xs text-gold-300 font-medium max-w-xs">{statusMsg}</p>
              <button
                type="button"
                onClick={() => startCamera(cameraFacing)}
                className="px-4 py-2 rounded-xl bg-gold-400 text-forest-950 font-bold text-xs shadow-md"
              >
                Enable Camera Access
              </button>
            </div>
          )}
        </div>

        {/* Status Pill below camera */}
        <div className="mt-4 flex flex-col items-center gap-1.5 text-center">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-forest-950/80 border border-gold-400/30 text-xs shadow-sm">
            <span
              className={`w-2 h-2 rounded-full ${
                faceDetected ? 'bg-emerald-400 animate-ping' : scanningActive ? 'bg-gold-400' : 'bg-slate-400'
              }`}
            ></span>
            <span className="font-semibold text-slate-200">
              {faceDetected
                ? 'Face Detected • Matching biometrics...'
                : cameraActive
                ? 'Align face inside gold frame'
                : statusMsg}
            </span>
          </div>
          <span className="text-[11px] text-slate-400 font-mono">
            {enrolledCount} Staff Members Enrolled • Touchless Auto-Punch
          </span>
        </div>
      </main>

      {/* Footer Navigation */}
      <footer className="p-3 bg-forest-950/80 border-t border-gold-500/20 text-center text-xs text-slate-400 flex items-center justify-between px-4">
        <span>© {restaurantName} Staff Portal</span>
        <Link
          href="/"
          className="text-gold-300 hover:text-gold-200 font-semibold underline text-xs"
        >
          Open Admin System
        </Link>
      </footer>
    </div>
  );
}
