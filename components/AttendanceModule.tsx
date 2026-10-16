'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import QRCode from 'qrcode';
import { DatabaseSchema, Staff, User, ShiftConfig } from '../lib/types';
import { loadBiometricModels, extractFaceDescriptorFromUrl, extractFaceDescriptor } from '../lib/faceBiometrics';
import { getLocalDateStr } from '../lib/dateUtils';
import {
  DEFAULT_SHIFTS,
  getShiftForStaff,
  format24To12,
  calculatePunctuality,
  calculateDeparture,
} from '../lib/shiftConfig';

interface AttendanceModuleProps {
  db: DatabaseSchema;
  currentUser: User;
  onVerifyAttendance: (staffId: string, confidence: number, livenessPassed: boolean) => Promise<any>;
  onManagerOverride: (staffId: string, checkInTime: string, reason: string, checkOutTime?: string) => Promise<void>;
  onApproveLeave: (leaveId: string) => Promise<void>;
  onUpdateDb?: (updatedDb: DatabaseSchema) => void;
}

// ─── REAL-TIME FACE RECOGNITION TERMINAL ──────────────────────────────────────
interface FaceTerminalProps {
  db: DatabaseSchema;
  currentUser: User;
  onVerifyAttendance: (staffId: string, confidence: number, livenessPassed: boolean) => Promise<any>;
  isAdminView?: boolean;
  matchThreshold?: number;
  isScanModalOpen?: boolean;
  onOpenScanModal?: () => void;
  onCloseScanModal?: () => void;
  showTabView?: boolean;
}

type ModelStatus = 'unloaded' | 'loading' | 'ready' | 'error';

interface EnrolledDescriptor {
  staff: Staff;
  descriptor: Float32Array;
  photoSource: string;
}

const FaceTerminal: React.FC<FaceTerminalProps> = ({
  db,
  currentUser,
  onVerifyAttendance,
  isAdminView = false,
  matchThreshold = 0.58,
  isScanModalOpen,
  onOpenScanModal,
  onCloseScanModal,
  showTabView = true,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasOverlayRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionLoopRef = useRef<number | null>(null);
  const isLoopRunningRef = useRef<boolean>(false);
  const faceApiRef = useRef<any>(null);

  // Status states
  const [modelStatus, setModelStatus] = useState<ModelStatus>('unloaded');
  const [modelLoadingMsg, setModelLoadingMsg] = useState<string>('Initializing AI biometric models...');
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [cameraStarting, setCameraStarting] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string>('');
  const [cameraFacing, setCameraFacing] = useState<'user' | 'environment'>('user');

  // Real-time detection feedback
  const [enrolledDescriptors, setEnrolledDescriptors] = useState<EnrolledDescriptor[]>([]);
  const enrolledDescriptorsRef = useRef<EnrolledDescriptor[]>([]);
  const enrolledMapRef = useRef<Map<string, EnrolledDescriptor>>(new Map());
  const [enrolledCount, setEnrolledCount] = useState<number>(0);
  const [detectedFaceCount, setDetectedFaceCount] = useState<number>(0);
  const [liveMatchedStaff, setLiveMatchedStaff] = useState<Staff | null>(null);
  const [liveConfidence, setLiveConfidence] = useState<number>(0);
  const [faceDistance, setFaceDistance] = useState<number>(1.0);
  const [livenessStage, setLivenessStage] = useState<'idle' | 'detecting' | 'verifying' | 'completed'>('idle');

  // Attendance feedback toasts & cooldown
  const [verifiedSuccess, setVerifiedSuccess] = useState<{
    staff: Staff;
    time: string;
    confidence: number;
    action: 'checkin' | 'checkout';
    duration?: string;
  } | null>(null);
  const [alreadyMarkedNotice, setAlreadyMarkedNotice] = useState<{
    staff: Staff;
    time?: string;
    message: string;
  } | null>(null);
  const [postingAttendance, setPostingAttendance] = useState<boolean>(false);
  const recentAttendanceCooldownRef = useRef<{ [staffId: string]: number }>({});

  // Manual Frame Scan Diagnostics
  const [manualScanning, setManualScanning] = useState<boolean>(false);
  const [manualScanResult, setManualScanResult] = useState<{
    status: 'matched' | 'already_marked' | 'no_match' | 'no_face';
    staff?: Staff;
    distance?: number;
    confidence?: number;
    message: string;
  } | null>(null);

  // 1. DYNAMICALLY LOAD AI MODELS ONCE ON MOUNT (NEVER TIED TO DB POLLING)
  useEffect(() => {
    let isMounted = true;

    async function initModels() {
      try {
        setModelStatus('loading');
        setModelLoadingMsg('Loading AI Biometrics & Face Recognition Neural Nets...');
        const faceapi = await loadBiometricModels();
        if (!isMounted) return;
        faceApiRef.current = faceapi;
        setModelStatus('ready');
      } catch (err: any) {
        console.error('Failed to load biometric models:', err);
        if (isMounted) {
          setModelStatus('error');
          setModelLoadingMsg(err?.message || 'Failed to initialize biometric AI engine.');
        }
      }
    }

    initModels();

    return () => {
      isMounted = false;
    };
  }, []);

  // 2. ENROLL BIOMETRIC DESCRIPTORS FROM db.staff (BACKGROUND NON-BLOCKING SYNC)
  useEffect(() => {
    if (modelStatus !== 'ready' || !faceApiRef.current) return;
    let isCancelled = false;

    async function syncDescriptors() {
      const staffList = db.staff.filter((s) => s.isActive && (s.hasFaceEnrolled || s.photoUrl || s.faceDescriptor));
      const currentMap = enrolledMapRef.current;
      let hasChanges = false;

      for (const staff of staffList) {
        if (isCancelled) break;

        // If staff already has pre-computed faceDescriptor array (instant 0ms load)
        if (staff.faceDescriptor && Array.isArray(staff.faceDescriptor) && staff.faceDescriptor.length > 0) {
          if (!currentMap.has(staff.id) || currentMap.get(staff.id)?.staff !== staff) {
            currentMap.set(staff.id, {
              staff,
              descriptor: new Float32Array(staff.faceDescriptor),
              photoSource: staff.photoUrl || `/staff_photos/${staff.id}.jpg`,
            });
            hasChanges = true;
          }
          continue;
        }

        // If already computed in memory map, keep it
        if (currentMap.has(staff.id)) continue;

        // Fallback: extract once from photo URL / local cache
        const candidateUrls = [staff.photoUrl, `/staff_photos/${staff.id}.jpg`].filter(Boolean) as string[];
        for (const testUrl of candidateUrls) {
          if (isCancelled || currentMap.has(staff.id)) break;
          try {
            const res = await extractFaceDescriptorFromUrl(testUrl);
            if (res.success && res.descriptor) {
              const floatArr = new Float32Array(res.descriptor);
              currentMap.set(staff.id, {
                staff,
                descriptor: floatArr,
                photoSource: testUrl,
              });
              hasChanges = true;
              break;
            }
          } catch {
            // Next candidate URL
          }
        }
      }

      if (!isCancelled && (hasChanges || currentMap.size !== enrolledDescriptorsRef.current.length)) {
        const list = Array.from(currentMap.values());
        enrolledDescriptorsRef.current = list;
        setEnrolledDescriptors(list);
        setEnrolledCount(list.length);
      }
    }

    syncDescriptors();

    return () => {
      isCancelled = true;
    };
  }, [db.staff, modelStatus]);

  // 3. CAMERA CONTROLS (INDEPENDENT OF POLLING - STAYS ACTIVE CONTINUOUSLY)
  const startCamera = async (facingOverride?: 'user' | 'environment') => {
    setCameraError('');
    setCameraStarting(true);
    setManualScanResult(null);

    const targetFacing = facingOverride || cameraFacing;

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Webcam media API is not supported in this browser or context.');
      }

      // Stop previous tracks if switching camera
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }

      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: targetFacing,
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
          audio: false,
        });
      } catch (firstErr) {
        console.warn('Initial facingMode constraint failed, falling back to simple video: true', firstErr);
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
      }

      if (!stream) {
        throw new Error('Unable to acquire media stream from camera.');
      }

      streamRef.current = stream;
      if (facingOverride) setCameraFacing(facingOverride);

      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;

        await new Promise<void>((resolve) => {
          if (video.readyState >= 2) {
            resolve();
          } else {
            video.onloadedmetadata = () => resolve();
          }
        });

        await video.play();
        setCameraActive(true);
      }
    } catch (err: any) {
      console.error('Camera access error:', err);
      const isPermission =
        err.name === 'NotAllowedError' ||
        err.name === 'PermissionDeniedError' ||
        err.name === 'SecurityError';
      const isNotFound = err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError';
      const isBusy = err.name === 'NotReadableError' || err.name === 'TrackStartError';

      if (isPermission) {
        setCameraError('Camera permission was denied. Please allow camera access in your browser settings (look for camera icon in address bar) and try again.');
      } else if (isNotFound) {
        setCameraError('No webcam or camera device detected on this system.');
      } else if (isBusy) {
        setCameraError('Camera is already in use by another application. Please close other apps and try again.');
      } else {
        setCameraError(`Camera error: ${err.message || 'Cannot access webcam device.'}`);
      }
      setCameraActive(false);
    } finally {
      setCameraStarting(false);
    }
  };

  const stopCamera = useCallback(() => {
    if (recognitionLoopRef.current) {
      cancelAnimationFrame(recognitionLoopRef.current);
      recognitionLoopRef.current = null;
    }
    isLoopRunningRef.current = false;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setLiveMatchedStaff(null);
    setDetectedFaceCount(0);
    setLivenessStage('idle');
  }, []);

  // Cleanup camera ONLY on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  const [internalScanModalOpen, setInternalScanModalOpen] = useState<boolean>(false);
  const isModalActive = isScanModalOpen !== undefined ? isScanModalOpen : internalScanModalOpen;

  const handleOpenScanModal = useCallback(() => {
    setInternalScanModalOpen(true);
    onOpenScanModal?.();
    startCamera();
  }, [onOpenScanModal]);

  const handleCloseScanModal = useCallback(() => {
    stopCamera();
    setInternalScanModalOpen(false);
    onCloseScanModal?.();
    setManualScanResult(null);
  }, [onCloseScanModal, stopCamera]);

  // Sync camera whenever modal becomes active / inactive
  useEffect(() => {
    if (isModalActive && !cameraActive && !cameraStarting) {
      startCamera();
    } else if (!isModalActive && cameraActive) {
      stopCamera();
    }
  }, [isModalActive, cameraActive, cameraStarting, stopCamera]);

  // 4. POST VERIFIED ATTENDANCE (HANDLES BOTH PUNCH-IN AND PUNCH-OUT)
  const postVerifiedAttendance = async (staff: Staff, confidence: number) => {
    if (postingAttendance) return;
    setPostingAttendance(true);

    try {
      const res = await onVerifyAttendance(staff.id, confidence, true);

      if (res?.action === 'checkout') {
        const timeStr = res.log?.checkOutTime || new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
        setVerifiedSuccess({
          staff,
          time: timeStr,
          confidence,
          action: 'checkout',
          duration: res.log?.hoursWorked ? `${res.log.hoursWorked} hrs worked` : undefined,
        });
        setTimeout(() => {
          setVerifiedSuccess(null);
          handleCloseScanModal();
        }, 3000);
      } else if (res?.action === 'checkin' || (!res?.alreadyMarked && res?.success)) {
        const timeStr = res.log?.checkInTime || new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
        setVerifiedSuccess({
          staff,
          time: timeStr,
          confidence,
          action: 'checkin',
        });
        setTimeout(() => {
          setVerifiedSuccess(null);
          handleCloseScanModal();
        }, 3000);
      } else if (res?.action === 'already_completed') {
        const timeStr = res.log?.checkOutTime || 'earlier today';
        setAlreadyMarkedNotice({
          staff,
          time: timeStr,
          message: res.message || `${staff.fullName} has already completed shift today (Punched out at ${timeStr}).`,
        });
        setTimeout(() => {
          setAlreadyMarkedNotice(null);
        }, 7000);
      } else if (res?.alreadyMarked) {
        const timeStr = res.log?.checkInTime || 'earlier today';
        setAlreadyMarkedNotice({
          staff,
          time: timeStr,
          message: res.message || `${staff.fullName} already has attendance recorded today at ${timeStr}.`,
        });
        setTimeout(() => {
          setAlreadyMarkedNotice(null);
        }, 7000);
      }
      setLivenessStage('completed');
    } catch (e) {
      console.error('Error posting verified face attendance:', e);
    } finally {
      setPostingAttendance(false);
    }
  };

  // 5. CONTINUOUS REAL-TIME BIOMETRIC RECOGNITION LOOP
  const runRecognitionFrame = useCallback(async () => {
    if (!videoRef.current || !canvasOverlayRef.current || !faceApiRef.current || !isLoopRunningRef.current) {
      return;
    }

    const video = videoRef.current;
    const canvas = canvasOverlayRef.current;
    const faceapi = faceApiRef.current;

    if (video.paused || video.ended || video.readyState < 2) {
      recognitionLoopRef.current = requestAnimationFrame(runRecognitionFrame);
      return;
    }

    const displaySize = { width: video.videoWidth || 640, height: video.videoHeight || 480 };
    if (canvas.width !== displaySize.width || canvas.height !== displaySize.height) {
      canvas.width = displaySize.width;
      canvas.height = displaySize.height;
    }

    try {
      // Real-time detection with lightweight TinyFaceDetector
      const detection = await faceapi
        .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.35 }))
        .withFaceLandmarks(true)
        .withFaceDescriptor();

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }

      if (detection) {
        setDetectedFaceCount(1);
        const resized = faceapi.resizeResults(detection, displaySize);
        const box = resized.detection.box;

        // Euclidean distance comparison against enrolled staff
        let bestStaff: Staff | null = null;
        let minDistance = 1.0;

        const currentEnrolled = enrolledDescriptorsRef.current;
        for (const enrolled of currentEnrolled) {
          const dist = faceapi.euclideanDistance(detection.descriptor, enrolled.descriptor);
          if (dist < minDistance) {
            minDistance = dist;
            bestStaff = enrolled.staff;
          }
        }

        setFaceDistance(parseFloat(minDistance.toFixed(3)));

        // Match decision: distance < matchThreshold indicates positive identity
        const isMatched = minDistance < matchThreshold && bestStaff !== null;
        const confidenceScore = Math.max(75, Math.min(99.9, parseFloat(((1 - minDistance) * 100).toFixed(1))));

        if (ctx) {
          // Draw HUD bounding box
          ctx.lineWidth = 3;
          ctx.strokeStyle = isMatched ? '#10b981' : '#f59e0b'; // Emerald for match, Amber for unverified
          ctx.strokeRect(box.x, box.y, box.width, box.height);

          // Top label banner
          const labelText = isMatched
            ? `✓ ${bestStaff!.fullName} (${confidenceScore}%)`
            : `Scanning Face... (dist: ${minDistance.toFixed(2)})`;

          ctx.font = 'bold 14px Inter, system-ui, sans-serif';
          const textWidth = ctx.measureText(labelText).width;
          ctx.fillStyle = isMatched ? 'rgba(16, 185, 129, 0.95)' : 'rgba(245, 158, 11, 0.95)';
          ctx.fillRect(box.x, box.y - 30, textWidth + 20, 26);

          ctx.fillStyle = '#ffffff';
          ctx.fillText(labelText, box.x + 8, box.y - 11);

          // Landmarks dots (facial keypoints)
          ctx.fillStyle = isMatched ? '#34d399' : '#fde047';
          resized.landmarks.positions.forEach((pt: any) => {
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 1.8, 0, 2 * Math.PI);
            ctx.fill();
          });
        }

        if (isMatched && bestStaff) {
          setLiveMatchedStaff(bestStaff);
          setLiveConfidence(confidenceScore);
          setLivenessStage('verifying');

          // Check cooldown (15s per staff member)
          const now = Date.now();
          const lastLogged = recentAttendanceCooldownRef.current[bestStaff.id] || 0;

          if (now - lastLogged > 15000 && !postingAttendance) {
            recentAttendanceCooldownRef.current[bestStaff.id] = now;
            postVerifiedAttendance(bestStaff, confidenceScore);
          }
        } else {
          setLiveMatchedStaff(null);
          setLiveConfidence(0);
          setLivenessStage('detecting');
        }
      } else {
        setDetectedFaceCount(0);
        setLiveMatchedStaff(null);
        setLivenessStage('idle');
      }
    } catch (loopErr) {
      console.warn('Frame detection tick exception:', loopErr);
    }

    if (isLoopRunningRef.current) {
      setTimeout(() => {
        recognitionLoopRef.current = requestAnimationFrame(runRecognitionFrame);
      }, 40);
    }
  }, [matchThreshold, postingAttendance]);

  // Start / stop loop when camera changes
  useEffect(() => {
    if (cameraActive && modelStatus === 'ready') {
      isLoopRunningRef.current = true;
      recognitionLoopRef.current = requestAnimationFrame(runRecognitionFrame);
    } else {
      isLoopRunningRef.current = false;
      if (recognitionLoopRef.current) {
        cancelAnimationFrame(recognitionLoopRef.current);
        recognitionLoopRef.current = null;
      }
    }

    return () => {
      isLoopRunningRef.current = false;
      if (recognitionLoopRef.current) {
        cancelAnimationFrame(recognitionLoopRef.current);
      }
    };
  }, [cameraActive, modelStatus, runRecognitionFrame]);

  // 6. MANUAL SCAN & SNAPSHOT DIAGNOSTIC
  const handleManualScanFrame = async () => {
    if (!videoRef.current || !faceApiRef.current || manualScanning) return;
    setManualScanning(true);
    setManualScanResult(null);

    try {
      const video = videoRef.current;
      const faceapi = faceApiRef.current;

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      }

      const detection = await faceapi
        .detectSingleFace(canvas, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.35 }))
        .withFaceLandmarks(true)
        .withFaceDescriptor();

      if (!detection) {
        setManualScanResult({
          status: 'no_face',
          message: 'No clear face detected in this frame. Look straight at the camera with good lighting and retry.',
        });
        return;
      }

      let bestStaff: Staff | null = null;
      let minDistance = 1.0;

      for (const enrolled of enrolledDescriptorsRef.current) {
        const dist = faceapi.euclideanDistance(detection.descriptor, enrolled.descriptor);
        if (dist < minDistance) {
          minDistance = dist;
          bestStaff = enrolled.staff;
        }
      }

      const conf = Math.max(75, Math.min(99.9, parseFloat(((1 - minDistance) * 100).toFixed(1))));

      if (minDistance < matchThreshold && bestStaff) {
        const todayStr = getLocalDateStr();
        const existing = db.attendance.find((a) => a.staffId === bestStaff!.id && a.date === todayStr);

        if (existing && existing.checkOutTime) {
          setManualScanResult({
            status: 'already_marked',
            staff: bestStaff,
            distance: parseFloat(minDistance.toFixed(3)),
            confidence: conf,
            message: `${bestStaff.fullName} has already completed their shift today (Punched In: ${existing.checkInTime || 'earlier'} • Punched Out: ${existing.checkOutTime} • ${existing.hoursWorked || 0} hrs worked).`,
          });
        } else {
          await postVerifiedAttendance(bestStaff, conf);
          if (existing) {
            setManualScanResult({
              status: 'matched',
              staff: bestStaff,
              distance: parseFloat(minDistance.toFixed(3)),
              confidence: conf,
              message: `Matched ${bestStaff.fullName} (${conf}% confidence). Punch-Out shift completed!`,
            });
          } else {
            setManualScanResult({
              status: 'matched',
              staff: bestStaff,
              distance: parseFloat(minDistance.toFixed(3)),
              confidence: conf,
              message: `Matched ${bestStaff.fullName} (${conf}% confidence). Punch-In recorded as PRESENT!`,
            });
          }
        }
      } else {
        setManualScanResult({
          status: 'no_match',
          distance: parseFloat(minDistance.toFixed(3)),
          confidence: conf,
          message: `Unidentified face. Closest match distance is ${minDistance.toFixed(3)} (threshold is < ${matchThreshold.toFixed(2)}). Not in staff database.`,
        });
      }
    } catch (err: any) {
      setManualScanResult({
        status: 'no_face',
        message: `Scan error: ${err.message}`,
      });
    } finally {
      setManualScanning(false);
    }
  };

  return (
    <>
      {showTabView && (
        <div className="bg-white/90 backdrop-blur-xl rounded-apple-xl shadow-apple-subtle border border-black/[0.06] overflow-hidden">
      {/* 1. Terminal Top Bar */}
      <div className="bg-gradient-to-r from-forest-950 via-forest-900 to-forest-950 text-white p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3 border-b border-gold-500/20">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-apple bg-forest-900 border border-gold-500/40 text-gold-400 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-gold-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7V5a2 2 0 0 1 2-2h2" />
              <path d="M17 3h2a2 2 0 0 1 2 2v2" />
              <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
              <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
              <circle cx="12" cy="10" r="3" />
              <path d="M7 20v-1a5 5 0 0 1 10 0v1" />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-sm sm:text-base tracking-tight text-white">
                Live Biometric Face Recognition (FRS)
              </h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-gold-500/20 text-gold-300 border border-gold-500/40">
                AI Vision
              </span>
            </div>
            <p className="text-[11px] text-slate-300 mt-0.5">
              Real-time facial vector matching against {enrolledCount} active staff profiles in DB
            </p>
          </div>
        </div>

        {/* Engine status indicator */}
        <div className="flex items-center gap-2">
          {modelStatus === 'loading' && (
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
              {modelLoadingMsg}
            </span>
          )}
          {modelStatus === 'ready' && (
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold bg-forest-900 text-gold-300 border border-gold-500/40">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              AI Model Online ({enrolledCount} Staff Enrolled)
            </span>
          )}
          {modelStatus === 'error' && (
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
              <span className="material-symbols-outlined text-xs">error</span>
              AI Initialization Error
            </span>
          )}
        </div>
      </div>

      {/* 2. Main Terminal Content */}
      <div className="p-4 sm:p-6 flex flex-col gap-5">
        
        {/* Success Banner on Main Page */}
        {verifiedSuccess && (
          <div className={`text-white rounded-2xl p-4 sm:p-5 shadow-lg flex flex-wrap items-center justify-between gap-4 animate-in fade-in slide-in-from-top-2 duration-300 ${
            verifiedSuccess.action === 'checkout'
              ? 'bg-gradient-to-r from-amber-600 via-rose-600 to-rose-700 shadow-rose-600/20'
              : 'bg-gradient-to-r from-emerald-600 to-teal-700 shadow-emerald-600/20'
          }`}>
            <div className="flex items-center gap-3.5">
              <div className="relative">
                <img
                  src={verifiedSuccess.staff.photoUrl || `/staff_photos/${verifiedSuccess.staff.id}.jpg`}
                  alt={verifiedSuccess.staff.fullName}
                  className="w-14 h-14 rounded-full object-cover ring-4 ring-white/30 shadow-md"
                />
                <div className={`absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-white flex items-center justify-center font-black text-xs shadow ${
                  verifiedSuccess.action === 'checkout' ? 'text-rose-700' : 'text-emerald-700'
                }`}>
                  ✓
                </div>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black uppercase tracking-wider bg-white/20 px-2 py-0.5 rounded-full">
                    {verifiedSuccess.action === 'checkout' ? 'Punched Out' : 'Punched In'}
                  </span>
                  <span className={`text-xs font-semibold ${verifiedSuccess.action === 'checkout' ? 'text-rose-200' : 'text-emerald-200'}`}>
                    {verifiedSuccess.time}
                  </span>
                </div>
                <h4 className="text-base sm:text-lg font-black mt-0.5">{verifiedSuccess.staff.fullName}</h4>
                <p className="text-xs text-white/90 font-medium">
                  {verifiedSuccess.staff.role} • {verifiedSuccess.staff.department} • Confidence: <strong>{verifiedSuccess.confidence}%</strong>
                  {verifiedSuccess.duration && ` • ${verifiedSuccess.duration}`}
                </p>
              </div>
            </div>
            <button
              onClick={() => setVerifiedSuccess(null)}
              className="text-xs font-bold px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-xl transition-all"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Already Marked Notice Banner */}
        {alreadyMarkedNotice && (
          <div className="bg-gradient-to-r from-amber-600 to-amber-700 text-white rounded-2xl p-4 sm:p-5 shadow-lg shadow-amber-600/20 flex flex-wrap items-center justify-between gap-4 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-2xl bg-white/15 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-3xl">info</span>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black uppercase tracking-wider bg-white/20 px-2 py-0.5 rounded-full">
                    Already Marked For Today
                  </span>
                  {alreadyMarkedNotice.time && (
                    <span className="text-xs text-amber-200 font-semibold">{alreadyMarkedNotice.time}</span>
                  )}
                </div>
                <h4 className="text-base font-extrabold mt-0.5">{alreadyMarkedNotice.staff.fullName}</h4>
                <p className="text-xs text-amber-100 font-medium">{alreadyMarkedNotice.message}</p>
              </div>
            </div>
            <button
              onClick={() => setAlreadyMarkedNotice(null)}
              className="text-xs font-bold px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-xl transition-all"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* 3. Sleek Quick Launcher Bar for Terminal Popup */}
        <div className="ios27-glass-card rounded-[22px] p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3 border border-gold-500/20">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-apple bg-forest-900 border border-gold-500/40 text-gold-400 flex items-center justify-center shrink-0 shadow-apple-subtle">
              <span className="material-symbols-outlined text-2xl">photo_camera</span>
            </div>
            <div>
              <h4 className="text-sm sm:text-base font-bold text-slate-900 tracking-tight">
                Biometric Attendance Terminal
              </h4>
              <p className="text-xs text-slate-500 mt-0.5">
                Look into the camera to mark attendance.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleOpenScanModal}
            disabled={modelStatus === 'loading'}
            className="ios27-btn-medium px-4 py-2 rounded-apple bg-gradient-to-r from-gold-500 via-gold-400 to-gold-500 hover:brightness-110 text-forest-950 font-bold text-xs shadow-apple-subtle border border-gold-400/80 transition-all flex items-center gap-2 active:scale-95 disabled:opacity-50 shrink-0"
          >
            <span className="material-symbols-outlined text-base">photo_camera</span>
            <span>Open Terminal Popup</span>
          </button>
        </div>

        {/* 4. Enrolled Staff Biometric Reference Gallery */}
        <div className="ios27-glass-card rounded-[22px] p-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-extrabold text-slate-800 flex items-center gap-1.5 uppercase tracking-wider">
              <span className="material-symbols-outlined text-slate-600 text-base">badge</span>
              Enrolled Staff Biometric Database ({enrolledDescriptors.length} Active in DB)
            </h4>
            <span className="text-[11px] text-slate-500 font-medium">Ready for instant face recognition</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5">
            {enrolledDescriptors.map(({ staff }) => {
              const isCurrentlyDetected = liveMatchedStaff?.id === staff.id;
              return (
                <div
                  key={staff.id}
                  className={`flex items-center gap-2.5 p-2 rounded-xl border transition-all ${
                    isCurrentlyDetected
                      ? 'bg-emerald-100/80 border-emerald-400 shadow-sm ring-2 ring-emerald-400'
                      : 'bg-white border-slate-200/70 hover:border-slate-300'
                  }`}
                >
                  <img
                    src={staff.photoUrl || `/staff_photos/${staff.id}.jpg`}
                    alt={staff.fullName}
                    className="w-8 h-8 rounded-full object-cover shrink-0 border border-slate-200"
                    onError={(e) => {
                      (e.target as HTMLElement).setAttribute('src', `/staff_photos/${staff.id}.jpg`);
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <span className="text-[11px] font-bold text-slate-900 block truncate">
                      {staff.fullName}
                    </span>
                    <span className="text-[10px] text-slate-500 block truncate capitalize">
                      {staff.role}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  )}

  {/* ── 5. CAMERA SCANNER POPUP MODAL (CENTERED VIEWPORT WITH OVAL GUIDE) ── */}
  {isModalActive && (
    <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-200">
      <div className="bg-[#031d16] border border-gold-500/40 rounded-3xl max-w-lg w-full text-white shadow-2xl overflow-hidden flex flex-col my-auto max-h-[95vh]">
        
        {/* Modal Top Bar */}
        <div className="p-3.5 sm:p-4 border-b border-gold-500/20 flex items-center justify-between bg-forest-950">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-forest-900 text-gold-400 flex items-center justify-center border border-gold-500/40 shrink-0 shadow-apple-subtle">
              <span className="material-symbols-outlined text-base">photo_camera</span>
            </div>
            <p className="text-xs text-slate-200 font-medium max-w-sm leading-relaxed">
              Look into the camera to mark attendance.
            </p>
          </div>

              <div className="flex items-center gap-2">
                {/* Camera Flip button for Tablets and Mobile Phones */}
                <button
                  type="button"
                  onClick={() => startCamera(cameraFacing === 'user' ? 'environment' : 'user')}
                  className="px-2.5 py-1.5 rounded-xl bg-forest-900 border border-gold-500/30 text-gold-300 text-xs font-bold flex items-center gap-1 hover:bg-forest-800 transition-all active:scale-95"
                  title="Flip Camera (Front / Rear)"
                >
                  <span className="material-symbols-outlined text-sm">flip_camera_ios</span>
                  <span className="hidden sm:inline">{cameraFacing === 'user' ? 'Front' : 'Rear'}</span>
                </button>

                {liveMatchedStaff ? (
                  <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-gold-500/20 text-gold-300 border border-gold-500/40 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                    Matched
                  </span>
                ) : (
                  <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-forest-900 text-slate-300 border border-forest-800">
                    {detectedFaceCount > 0 ? 'Face in View' : 'Scanning...'}
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleCloseScanModal}
                  className="w-8 h-8 rounded-xl bg-forest-900 hover:bg-forest-800 text-gold-300 flex items-center justify-center border border-gold-500/30 transition-all ml-1"
                >
                  <span className="material-symbols-outlined text-sm">close</span>
                </button>
              </div>
            </div>

            {/* In-Modal Feedback Alerts */}
            {verifiedSuccess && (
              <div className={`m-4 p-4 rounded-2xl text-white flex items-center justify-between gap-3 shadow-lg animate-in fade-in ${
                verifiedSuccess.action === 'checkout'
                  ? 'bg-gradient-to-r from-amber-600 via-rose-600 to-rose-700'
                  : 'bg-gradient-to-r from-emerald-600 to-teal-700'
              }`}>
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full bg-white flex items-center justify-center font-black text-lg shrink-0 ${
                    verifiedSuccess.action === 'checkout' ? 'text-rose-700' : 'text-emerald-700'
                  }`}>
                    ✓
                  </div>
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider bg-white/20 px-2 py-0.5 rounded-full block w-fit mb-0.5">
                      {verifiedSuccess.action === 'checkout' ? 'Punched Out' : 'Punched In'}
                    </span>
                    <strong className="text-sm block">{verifiedSuccess.staff.fullName}</strong>
                    <span className="text-xs text-white/90">
                      {verifiedSuccess.time} • {verifiedSuccess.confidence}% confidence
                      {verifiedSuccess.duration && ` • ${verifiedSuccess.duration}`}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCloseScanModal}
                  className="px-3 py-1.5 rounded-xl bg-white text-slate-800 font-extrabold text-xs shrink-0 shadow-sm hover:bg-slate-100"
                >
                  Done
                </button>
              </div>
            )}

            {alreadyMarkedNotice && (
              <div className="m-4 p-4 rounded-2xl bg-gradient-to-r from-amber-600 to-amber-700 text-white flex items-center justify-between gap-3 shadow-lg animate-in fade-in">
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-3xl shrink-0">info</span>
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider bg-white/20 px-2 py-0.5 rounded-full block w-fit mb-0.5">
                      Already Marked Today
                    </span>
                    <strong className="text-sm block">{alreadyMarkedNotice.staff.fullName}</strong>
                    <span className="text-xs text-amber-100">{alreadyMarkedNotice.time ? `Checked in at ${alreadyMarkedNotice.time}` : '1 scan per day rule enforced'}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCloseScanModal}
                  className="px-3 py-1.5 rounded-xl bg-white text-amber-900 font-extrabold text-xs shrink-0 shadow-sm hover:bg-amber-50"
                >
                  Close
                </button>
              </div>
            )}

            {manualScanResult && (
              <div
                className={`m-4 p-3.5 rounded-2xl text-xs border flex items-start justify-between gap-3 animate-in fade-in ${
                  manualScanResult.status === 'matched'
                    ? 'bg-emerald-950/80 border-emerald-700 text-emerald-200'
                    : manualScanResult.status === 'already_marked'
                    ? 'bg-amber-950/80 border-amber-700 text-amber-200'
                    : manualScanResult.status === 'no_match'
                    ? 'bg-orange-950/80 border-orange-700 text-orange-200'
                    : 'bg-rose-950/80 border-rose-700 text-rose-200'
                }`}
              >
                <div>
                  <strong className="block font-bold">
                    {manualScanResult.status === 'matched'
                      ? '✓ Matched & Marked'
                      : manualScanResult.status === 'already_marked'
                      ? 'ℹ️ Already Marked Today'
                      : manualScanResult.status === 'no_match'
                      ? '⚠️ Unregistered Face'
                      : '⚠️ No Face Detected'}
                  </strong>
                  <p className="mt-0.5 text-[11px] opacity-90">{manualScanResult.message}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setManualScanResult(null)}
                  className="text-xs px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 font-bold shrink-0"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Modal Body: CENTERED VIEWFINDER */}
            <div className="p-4 sm:p-6 flex flex-col items-center justify-center gap-4 overflow-y-auto">
              {/* Centered Camera Viewport */}
              <div className="relative w-64 h-64 sm:w-80 sm:h-80 rounded-3xl sm:rounded-[36px] overflow-hidden bg-black border-2 border-emerald-500/50 shadow-[0_0_35px_rgba(16,185,129,0.25)] flex items-center justify-center shrink-0">
                {/* Live Video */}
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`w-full h-full object-cover ${cameraActive ? 'block' : 'hidden'}`}
                />

                {/* HUD Canvas for landmark dots and box */}
                <canvas
                  ref={canvasOverlayRef}
                  className={`absolute inset-0 pointer-events-none w-full h-full object-cover ${cameraActive ? 'block' : 'hidden'}`}
                />

                {/* Centered Biometric Oval Guide with Animated Laser Sweep */}
                {cameraActive && (
                  <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                    <div className="relative w-40 h-52 sm:w-48 sm:h-64 rounded-[50%] border-2 border-dashed border-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.35)] flex items-center justify-center overflow-hidden">
                      {/* Laser scanning sweep line */}
                      <div className="absolute inset-x-0 h-1 bg-gradient-to-r from-transparent via-emerald-300 to-transparent shadow-[0_0_10px_#34d399] animate-pulse" />
                    </div>
                  </div>
                )}

                {/* Camera Starting State */}
                {cameraStarting && (
                  <div className="absolute inset-0 bg-slate-950/90 flex flex-col items-center justify-center gap-2 text-emerald-300">
                    <span className="material-symbols-outlined text-3xl animate-spin">refresh</span>
                    <span className="text-xs font-bold">Connecting camera...</span>
                  </div>
                )}

                {/* Camera Error State */}
                {cameraError && (
                  <div className="absolute inset-4 bg-rose-950/95 text-rose-200 p-4 rounded-2xl flex flex-col items-center justify-center text-center gap-2">
                    <span className="material-symbols-outlined text-3xl text-rose-400">error</span>
                    <span className="text-xs font-bold">{cameraError}</span>
                    <button
                      type="button"
                      onClick={() => startCamera()}
                      className="px-3 py-1.5 rounded-xl bg-rose-800 text-white font-bold text-xs mt-1"
                    >
                      Retry Camera
                    </button>
                  </div>
                )}
              </div>

              {/* Status and Evaluation Pill */}
              <div className="w-full max-w-sm bg-slate-950/70 border border-slate-800 rounded-2xl p-3 flex flex-col gap-1 text-center">
                <div className="flex items-center justify-center gap-2 text-xs">
                  <span className={`w-2 h-2 rounded-full ${detectedFaceCount > 0 ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
                  <span className="font-bold text-slate-200">
                    {liveMatchedStaff
                      ? `✓ Matched: ${liveMatchedStaff.fullName} (${liveConfidence}%)`
                      : detectedFaceCount > 0
                      ? 'Face Detected — Comparing Vector...'
                      : 'Look directly at camera in good light'}
                  </span>
                </div>
                <div className="flex items-center justify-center gap-4 text-[10px] text-slate-400 font-mono mt-0.5">
                  <span>Dist: <strong className={faceDistance < matchThreshold ? 'text-emerald-400' : 'text-amber-400'}>{faceDistance}</strong></span>
                  <span>Cutoff: <strong className="text-emerald-400">&lt; {matchThreshold.toFixed(2)}</strong></span>
                </div>
              </div>
            </div>

            {/* Modal Bottom Controls */}
            <div className="p-4 sm:p-5 border-t border-slate-800/80 bg-slate-950/70 flex flex-wrap items-center justify-between gap-2.5">
              <button
                type="button"
                onClick={handleCloseScanModal}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition-all"
              >
                Cancel / Close
              </button>

              <button
                type="button"
                onClick={handleManualScanFrame}
                disabled={manualScanning || !cameraActive}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs shadow-md transition-all active:scale-95 flex items-center gap-2 disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-base">
                  {manualScanning ? 'hourglass_top' : 'photo_camera'}
                </span>
                <span>{manualScanning ? 'Scanning...' : '📸 Scan Frame Now'}</span>
              </button>
            </div>

          </div>
        </div>
      )}
    </>
  );
};

// ─── MAIN ATTENDANCE MODULE COMPONENT ─────────────────────────────────────────
export const AttendanceModule: React.FC<AttendanceModuleProps> = ({
  db,
  currentUser,
  onVerifyAttendance,
  onManagerOverride,
  onApproveLeave,
  onUpdateDb,
}) => {
  const isAdminOrManager = currentUser.role === 'admin' || currentUser.role === 'manager';

  // Sub-tabs for Admin / Manager
  const [activeSubTab, setActiveSubTab] = useState<'terminal' | 'roster' | 'test_console' | 'leaves'>('terminal');

  // Test console threshold controls
  const [matchThreshold, setMatchThreshold] = useState<number>(0.55);
  const [resettingToday, setResettingToday] = useState<boolean>(false);

  // Manual Override Modal
  const [showOverrideModal, setShowOverrideModal] = useState<boolean>(false);
  const [overrideStaffId, setOverrideStaffId] = useState<string>(db.staff[0]?.id || '');
  const [overrideTime, setOverrideTime] = useState<string>('09:00');
  const [overrideOutTime, setOverrideOutTime] = useState<string>('');
  const [overrideReason, setOverrideReason] = useState<string>('');
  const [overrideLoading, setOverrideLoading] = useState<boolean>(false);

  // Shift Settings & Staff Assignment Modal
  const [showShiftSettingsModal, setShowShiftSettingsModal] = useState<boolean>(false);
  const [shiftModalTab, setShiftModalTab] = useState<'shifts' | 'assignments'>('shifts');
  const [shiftsList, setShiftsList] = useState<ShiftConfig[]>(
    db.shifts && db.shifts.length > 0 ? db.shifts : DEFAULT_SHIFTS
  );
  const [editingShift, setEditingShift] = useState<Partial<ShiftConfig> | null>(null);
  const [staffShiftMap, setStaffShiftMap] = useState<{ [staffId: string]: string }>({});
  const [bulkDepartment, setBulkDepartment] = useState<string>('All');
  const [bulkShiftId, setBulkShiftId] = useState<string>(
    (db.shifts && db.shifts[0]?.id) || DEFAULT_SHIFTS[0].id
  );
  const [staffSearchQuery, setStaffSearchQuery] = useState<string>('');
  const [isSavingShifts, setIsSavingShifts] = useState<boolean>(false);
  const [shiftSaveMsg, setShiftSaveMsg] = useState<string>('');

  // Sync shifts list from db when updated
  useEffect(() => {
    if (db.shifts && db.shifts.length > 0) {
      setShiftsList(db.shifts);
      if (!bulkShiftId && db.shifts[0]) {
        setBulkShiftId(db.shifts[0].id);
      }
    }
  }, [db.shifts]);

  // Sync staffShiftMap from db.staff only when shift settings modal is NOT open, to avoid resetting active selections
  useEffect(() => {
    if (!showShiftSettingsModal) {
      const map: { [staffId: string]: string } = {};
      db.staff.forEach((s) => {
        map[s.id] = s.assignedShiftId || getShiftForStaff(s, shiftsList).id;
      });
      setStaffShiftMap(map);
    }
  }, [db.staff, shiftsList, showShiftSettingsModal]);

  const handleSaveShiftConfig = async (shiftToSave: ShiftConfig) => {
    setIsSavingShifts(true);
    try {
      const existingIdx = shiftsList.findIndex((s) => s.id === shiftToSave.id);
      let updated: ShiftConfig[];
      if (existingIdx >= 0) {
        updated = [...shiftsList];
        updated[existingIdx] = shiftToSave;
      } else {
        updated = [...shiftsList, shiftToSave];
      }

      const res = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'SAVE_SHIFTS',
          shifts: updated,
          userName: currentUser.name,
          userRole: currentUser.role,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setShiftsList(updated);
        setEditingShift(null);
        if (json.data && onUpdateDb) {
          onUpdateDb(json.data);
        }
        setShiftSaveMsg(`Shift "${shiftToSave.name}" saved successfully!`);
        setTimeout(() => setShiftSaveMsg(''), 3000);
      } else {
        alert(json.message || 'Failed to save shift');
      }
    } catch (err) {
      console.error(err);
      alert('Error saving shift');
    } finally {
      setIsSavingShifts(false);
    }
  };

  const handleDeleteShift = async (shiftId: string) => {
    if (shiftsList.length <= 1) {
      alert('At least one shift configuration is required.');
      return;
    }
    const target = shiftsList.find((s) => s.id === shiftId);
    if (!confirm(`Are you sure you want to delete "${target?.name}"?`)) return;

    setIsSavingShifts(true);
    try {
      const updated = shiftsList.filter((s) => s.id !== shiftId);
      const res = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'SAVE_SHIFTS',
          shifts: updated,
          userName: currentUser.name,
          userRole: currentUser.role,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setShiftsList(updated);
        if (json.data && onUpdateDb) {
          onUpdateDb(json.data);
        }
        setShiftSaveMsg(`Shift "${target?.name}" deleted.`);
        setTimeout(() => setShiftSaveMsg(''), 3000);
      }
    } catch (err) {
      console.error(err);
      alert('Error deleting shift');
    } finally {
      setIsSavingShifts(false);
    }
  };

  const handleSaveStaffAssignments = async () => {
    setIsSavingShifts(true);
    try {
      const assignments = Object.entries(staffShiftMap).map(([staffId, shiftId]) => ({
        staffId,
        shiftId,
      }));
      const res = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'ASSIGN_STAFF_SHIFTS',
          assignments,
          userName: currentUser.name,
          userRole: currentUser.role,
        }),
      });
      const json = await res.json();
      if (json.success) {
        if (json.data && onUpdateDb) {
          onUpdateDb(json.data);
        }
        setShiftSaveMsg(`Staff shift roster saved successfully! (${assignments.length} assigned)`);
        setTimeout(() => setShiftSaveMsg(''), 3500);
      } else {
        alert(json.message || 'Failed to save staff assignments');
      }
    } catch (err) {
      console.error(err);
      alert('Error saving staff assignments');
    } finally {
      setIsSavingShifts(false);
    }
  };

  const handleApplyBulkDepartment = (dept: string, shiftId: string) => {
    const newMap = { ...staffShiftMap };
    let count = 0;
    db.staff.forEach((s) => {
      if (dept === 'All' || s.department === dept) {
        newMap[s.id] = shiftId;
        count++;
      }
    });
    setStaffShiftMap(newMap);
    setShiftSaveMsg(`Assigned ${count} staff members to shift. Click "Save Staff Shift Assignments" to persist.`);
    setTimeout(() => setShiftSaveMsg(''), 4000);
  };

  // QR Standee / Poster Modal & Generation
  const [showQrStandeeModal, setShowQrStandeeModal] = useState<boolean>(false);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  const [scanEndpointUrl, setScanEndpointUrl] = useState<string>('');
  const [copiedLink, setCopiedLink] = useState<boolean>(false);

  // Biometric Terminal Scanner Popup Modal
  const [isScanModalOpen, setIsScanModalOpen] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const defaultUrl = `${window.location.origin}/attendance/scan`;
      setScanEndpointUrl(defaultUrl);
      QRCode.toDataURL(defaultUrl, {
        width: 600,
        margin: 2,
        color: {
          dark: '#031d16',
          light: '#ffffff',
        },
        errorCorrectionLevel: 'H',
      }).then(setQrCodeDataUrl).catch(console.error);
    }
  }, []);

  const handleUpdateScanUrl = async (newUrl: string) => {
    setScanEndpointUrl(newUrl);
    try {
      const dataUrl = await QRCode.toDataURL(newUrl, {
        width: 600,
        margin: 2,
        color: {
          dark: '#031d16',
          light: '#ffffff',
        },
        errorCorrectionLevel: 'H',
      });
      setQrCodeDataUrl(dataUrl);
    } catch (e) {
      console.error('Failed to regenerate QR code', e);
    }
  };

  const handleCopyScanUrl = async () => {
    try {
      await navigator.clipboard.writeText(scanEndpointUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    } catch (err) {
      console.error('Failed to copy scan link', err);
    }
  };

  const todayStr = getLocalDateStr();
  const todayLogs = db.attendance.filter((a) => a.date === todayStr);

  const presentCount = todayLogs.filter((a) => a.status === 'present' || a.status === 'late' || a.status === 'override').length;
  const leaveCount = todayLogs.filter((a) => a.status === 'on_leave').length;
  const absentCount = Math.max(0, db.staff.length - presentCount - leaveCount);

  const handleExecuteOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!overrideReason.trim()) return alert('Please enter reason for manual override.');
    setOverrideLoading(true);
    try {
      await onManagerOverride(overrideStaffId, overrideTime, overrideReason, overrideOutTime.trim() || undefined);
      setShowOverrideModal(false);
      setOverrideReason('');
      setOverrideOutTime('');
    } finally {
      setOverrideLoading(false);
    }
  };

  const handlePrintPoster = () => {
    const posterElem = document.getElementById('attendance-qr-poster');
    if (!posterElem) {
      window.print();
      return;
    }

    let printFrame = document.getElementById('attendance-print-frame') as HTMLIFrameElement;
    if (printFrame) {
      printFrame.remove();
    }
    printFrame = document.createElement('iframe');
    printFrame.id = 'attendance-print-frame';
    printFrame.style.position = 'fixed';
    printFrame.style.right = '0';
    printFrame.style.bottom = '0';
    printFrame.style.width = '0';
    printFrame.style.height = '0';
    printFrame.style.border = '0';
    document.body.appendChild(printFrame);

    const frameDoc = printFrame.contentWindow?.document;
    if (frameDoc) {
      frameDoc.open();
      const headStyles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
        .map((el) => el.outerHTML)
        .join('\n');

      frameDoc.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Attendance QR Standee - ${db.settings?.restaurantName || 'The Grand Imperial'}</title>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            ${headStyles}
            <style>
              @page {
                size: A4 portrait;
                margin: 10mm;
              }
              html, body {
                margin: 0 !important;
                padding: 0 !important;
                width: 100% !important;
                height: 100% !important;
                background: #ffffff !important;
                color: #000000 !important;
                overflow: hidden !important;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              }
              .print-page-wrapper {
                width: 100%;
                display: flex;
                justify-content: center;
                align-items: flex-start;
                padding-top: 10mm;
                page-break-inside: avoid;
                break-inside: avoid;
              }
              #attendance-qr-poster {
                width: 100% !important;
                max-width: 370px !important;
                margin: 0 auto !important;
                border: 3px solid #031d16 !important;
                border-radius: 20px !important;
                box-shadow: none !important;
                page-break-inside: avoid !important;
                break-inside: avoid !important;
                page-break-after: avoid !important;
                break-after: avoid !important;
                background: #ffffff !important;
                color: #000000 !important;
              }
            </style>
          </head>
          <body>
            <div class="print-page-wrapper">
              ${posterElem.outerHTML}
            </div>
            <script>
              window.onload = function() {
                setTimeout(function() {
                  window.focus();
                  window.print();
                }, 250);
              };
            </script>
          </body>
        </html>
      `);
      frameDoc.close();
    }
  };

  const renderQrStandeeModal = () => {
    if (!showQrStandeeModal) return null;

    return (
      <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-200">
        <div className="bg-white rounded-[24px] max-w-xl w-full text-slate-900 shadow-2xl overflow-hidden flex flex-col my-auto max-h-[92vh] border border-slate-200">
          {/* Modal Header (Hidden during print) */}
          <div className="p-3.5 sm:p-4 border-b border-slate-200/80 bg-slate-50 flex items-center justify-between no-print">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center border border-emerald-200">
                <span className="material-symbols-outlined text-xl">qr_code_2</span>
              </div>
              <div>
                <h3 className="font-extrabold text-sm sm:text-base text-slate-900">Attendance QR Standee &amp; Poster</h3>
                <p className="text-[11px] text-slate-500 font-medium">
                  Fits 100% on a single A4 page for restaurant walls &amp; table counters
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowQrStandeeModal(false)}
              className="w-8 h-8 rounded-lg hover:bg-slate-200 text-slate-500 flex items-center justify-center transition-colors"
            >
              <span className="material-symbols-outlined text-base">close</span>
            </button>
          </div>

          {/* Quick URL Config & Action Toolbar (Hidden during print) */}
          <div className="p-3 bg-slate-100/70 border-b border-slate-200 flex flex-col gap-2.5 no-print">
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <label className="text-[11px] font-bold text-slate-700 flex items-center gap-1">
                <span className="material-symbols-outlined text-xs text-slate-500">link</span>
                Scanner Destination URL:
              </label>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    if (typeof window !== 'undefined') {
                      handleUpdateScanUrl(`${window.location.origin}/attendance/scan`);
                    }
                  }}
                  className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-white border border-slate-300 text-slate-700 hover:bg-slate-50"
                >
                  Local / Origin
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleUpdateScanUrl('https://furnishings-stayed-faster-recommend.trycloudflare.com/attendance/scan');
                  }}
                  className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-50 border border-emerald-300 text-emerald-700 hover:bg-emerald-100"
                >
                  Cloudflare Live Tunnel
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={scanEndpointUrl}
                onChange={(e) => handleUpdateScanUrl(e.target.value)}
                placeholder="https://..."
                className="flex-1 px-3 py-1.5 text-xs font-mono bg-white rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-800"
              />
              <button
                type="button"
                onClick={handleCopyScanUrl}
                className="px-2.5 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold flex items-center gap-1 transition-all shrink-0"
              >
                <span className="material-symbols-outlined text-sm">
                  {copiedLink ? 'check' : 'content_copy'}
                </span>
                <span>{copiedLink ? 'Copied' : 'Copy'}</span>
              </button>
              <a
                href={scanEndpointUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold flex items-center gap-1 transition-all shrink-0"
              >
                <span className="material-symbols-outlined text-sm">open_in_new</span>
                <span>Open</span>
              </a>
            </div>
          </div>

          {/* Standee Preview (Centered & Compact) */}
          <div className="p-3 sm:p-4 overflow-y-auto max-h-[68vh] flex justify-center bg-slate-100">
            {/* THE ACTUAL PRINTABLE POSTER CONTAINER */}
            <div
              id="attendance-qr-poster"
              className="w-full max-w-[370px] bg-white rounded-2xl p-4 sm:p-5 shadow-md border-2 border-[#031d16] flex flex-col items-center text-center relative overflow-hidden"
            >
              {/* Decorative Gold Header Bar */}
              <div className="w-full bg-[#031d16] text-[#e2b755] py-1.5 px-3 rounded-xl mb-2.5 flex items-center justify-between border border-[#e2b755]/30">
                <div className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-sm">hotel</span>
                  <span className="text-[10px] font-black uppercase tracking-widest text-[#e2b755]">
                    {db.settings?.restaurantName || 'The Grand Imperial'}
                  </span>
                </div>
                <span className="text-[9px] font-bold uppercase tracking-wider bg-[#e2b755]/20 text-[#e2b755] px-2 py-0.5 rounded-full border border-[#e2b755]/40">
                  Official Standee
                </span>
              </div>

              {/* Main Heading */}
              <h1 className="text-xl font-black text-[#031d16] tracking-tight">
                STAFF ATTENDANCE
              </h1>
              <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 mt-0.5">
                Touchless Biometric Face Recognition (FRS)
              </p>

              {/* Subtitle */}
              <div className="my-1.5 inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-[10px] font-extrabold">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span>Scan QR Code To Punch In / Punch Out</span>
              </div>

              {/* QR Code Frame */}
              <div className="my-2 p-2 rounded-2xl bg-gradient-to-b from-[#f9fafb] to-white border border-[#e2b755] shadow-sm flex flex-col items-center relative">
                {/* Decorative Corner Accents */}
                <div className="absolute top-1.5 left-1.5 w-3 h-3 border-t-2 border-l-2 border-[#031d16]" />
                <div className="absolute top-1.5 right-1.5 w-3 h-3 border-t-2 border-r-2 border-[#031d16]" />
                <div className="absolute bottom-1.5 left-1.5 w-3 h-3 border-b-2 border-l-2 border-[#031d16]" />
                <div className="absolute bottom-1.5 right-1.5 w-3 h-3 border-b-2 border-r-2 border-[#031d16]" />

                {qrCodeDataUrl ? (
                  <img
                    src={qrCodeDataUrl}
                    alt="Attendance QR Code"
                    className="w-40 h-40 sm:w-44 sm:h-44 object-contain rounded-lg"
                  />
                ) : (
                  <div className="w-40 h-40 sm:w-44 sm:h-44 flex items-center justify-center text-slate-400 text-xs">
                    Generating QR Code...
                  </div>
                )}

                <div className="mt-1.5 px-2.5 py-0.5 rounded-full bg-[#031d16] text-[#e2b755] text-[9px] font-bold uppercase tracking-wider flex items-center gap-1">
                  <span className="material-symbols-outlined text-xs">center_focus_strong</span>
                  <span>Point Phone Camera Here</span>
                </div>
              </div>

              {/* 3 Step Visual Guide */}
              <div className="w-full grid grid-cols-3 gap-2 my-2 text-left">
                <div className="p-2 rounded-xl bg-slate-50 border border-slate-200 flex flex-col">
                  <div className="w-5 h-5 rounded-md bg-emerald-100 text-emerald-700 font-bold text-[10px] flex items-center justify-center mb-1">
                    1
                  </div>
                  <strong className="text-[10px] font-extrabold text-slate-900 leading-tight">
                    Scan Code
                  </strong>
                  <span className="text-[8px] text-slate-500 font-medium leading-tight mt-0.5">
                    Open phone camera &amp; tap link
                  </span>
                </div>

                <div className="p-2 rounded-xl bg-slate-50 border border-slate-200 flex flex-col">
                  <div className="w-5 h-5 rounded-md bg-amber-100 text-amber-700 font-bold text-[10px] flex items-center justify-center mb-1">
                    2
                  </div>
                  <strong className="text-[10px] font-extrabold text-slate-900 leading-tight">
                    Look At Screen
                  </strong>
                  <span className="text-[8px] text-slate-500 font-medium leading-tight mt-0.5">
                    AI verifies face in 1-2 sec
                  </span>
                </div>

                <div className="p-2 rounded-xl bg-slate-50 border border-slate-200 flex flex-col">
                  <div className="w-5 h-5 rounded-md bg-blue-100 text-blue-700 font-bold text-[10px] flex items-center justify-center mb-1">
                    3
                  </div>
                  <strong className="text-[10px] font-extrabold text-slate-900 leading-tight">
                    Auto Logged
                  </strong>
                  <span className="text-[8px] text-slate-500 font-medium leading-tight mt-0.5">
                    Punched In / Out recorded
                  </span>
                </div>
              </div>

              {/* Footer Fine Print */}
              <div className="w-full pt-2 mt-0.5 border-t border-slate-200 flex items-center justify-between text-[9px] text-slate-500 font-medium">
                <span className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-xs text-emerald-600">verified_user</span>
                  AI Face Verification Guard
                </span>
                <span>100% Touchless &amp; Secure</span>
              </div>
            </div>
          </div>

          {/* Modal Bottom Actions (Hidden during print) */}
          <div className="p-3.5 sm:p-4 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2.5 no-print">
            <div className="text-[11px] text-slate-500 font-medium">
              Prints strictly on <strong>1 single A4 page</strong> without splitting.
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowQrStandeeModal(false)}
                className="px-3.5 py-2 rounded-xl hover:bg-slate-200 text-slate-700 font-bold text-xs transition-colors"
              >
                Close
              </button>
              <button
                type="button"
                onClick={handlePrintPoster}
                className="px-5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-700 hover:to-teal-800 text-white font-extrabold text-xs shadow-md transition-all flex items-center gap-2 active:scale-95"
              >
                <span className="material-symbols-outlined text-base">print</span>
                <span>Print Poster / Standee</span>
              </button>
            </div>
          </div>
        </div>

        {/* Print Stylesheet */}
        <style jsx global>{`
          @media print {
            @page {
              size: A4 portrait;
              margin: 10mm;
            }
            html, body {
              width: 100% !important;
              height: 100% !important;
              max-height: 100vh !important;
              overflow: hidden !important;
              margin: 0 !important;
              padding: 0 !important;
              background: #ffffff !important;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            body * {
              visibility: hidden !important;
            }
            #attendance-qr-poster,
            #attendance-qr-poster * {
              visibility: visible !important;
            }
            #attendance-qr-poster {
              position: fixed !important;
              left: 0 !important;
              right: 0 !important;
              top: 15mm !important;
              margin: 0 auto !important;
              transform: none !important;
              width: 100% !important;
              max-width: 370px !important;
              box-shadow: none !important;
              border: 3px solid #031d16 !important;
              border-radius: 20px !important;
              page-break-inside: avoid !important;
              break-inside: avoid !important;
              page-break-after: avoid !important;
              break-after: avoid !important;
              background: white !important;
              color: black !important;
            }
            .no-print {
              display: none !important;
            }
          }
        `}</style>
      </div>
    );
  };

  const renderShiftSettingsModal = () => {
    if (!showShiftSettingsModal) return null;

    const activeShifts = shiftsList.length > 0 ? shiftsList : DEFAULT_SHIFTS;
    const departments = ['All', ...Array.from(new Set(db.staff.map((s) => s.department || 'General')))];

    const filteredStaff = db.staff.filter((s) => {
      if (!staffSearchQuery.trim()) return true;
      const q = staffSearchQuery.toLowerCase();
      return (
        s.fullName.toLowerCase().includes(q) ||
        s.employeeCode.toLowerCase().includes(q) ||
        s.role.toLowerCase().includes(q) ||
        s.department.toLowerCase().includes(q)
      );
    });

    const colorPillClasses: Record<string, { bg: string; text: string; border: string; dot: string }> = {
      emerald: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500' },
      amber: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', dot: 'bg-amber-500' },
      blue: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', dot: 'bg-blue-500' },
      purple: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200', dot: 'bg-purple-500' },
      rose: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200', dot: 'bg-rose-500' },
      indigo: { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200', dot: 'bg-indigo-500' },
      cyan: { bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-200', dot: 'bg-cyan-500' },
    };

    return (
      <div className="fixed inset-0 bg-slate-950/75 backdrop-blur-md z-50 flex items-center justify-center p-3 sm:p-5 overflow-y-auto animate-in fade-in duration-200">
        <div className="bg-white rounded-[24px] max-w-4xl w-full text-slate-900 shadow-2xl overflow-hidden flex flex-col my-auto max-h-[92vh] border border-slate-200">
          {/* Modal Header */}
          <div className="p-4 sm:p-5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-teal-100 text-teal-700 flex items-center justify-center border border-teal-200 shadow-sm">
                <span className="material-symbols-outlined text-2xl">schedule</span>
              </div>
              <div>
                <h3 className="font-extrabold text-base sm:text-lg text-slate-900">
                  Shift Configuration &amp; Staff Roster
                </h3>
                <p className="text-xs text-slate-500 font-medium">
                  Define working hours, punctuality grace periods &amp; assign shifts to staff
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                setShowShiftSettingsModal(false);
                setEditingShift(null);
              }}
              className="w-8 h-8 rounded-xl hover:bg-slate-200 text-slate-500 flex items-center justify-center transition-colors"
            >
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
          </div>

          {/* Toast Notification Banner */}
          {shiftSaveMsg && (
            <div className="px-5 py-2.5 bg-emerald-500 text-white font-semibold text-xs flex items-center gap-2 transition-all">
              <span className="material-symbols-outlined text-sm">check_circle</span>
              <span>{shiftSaveMsg}</span>
            </div>
          )}

          {/* Modal Sub-Tabs */}
          <div className="px-5 pt-3 border-b border-slate-200 flex items-center justify-between bg-white">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setShiftModalTab('shifts');
                  setEditingShift(null);
                }}
                className={`pb-3 px-3 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 ${
                  shiftModalTab === 'shifts'
                    ? 'border-emerald-600 text-emerald-700'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <span className="material-symbols-outlined text-base">timer</span>
                <span>Work Shifts ({activeShifts.length})</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setShiftModalTab('assignments');
                  setEditingShift(null);
                }}
                className={`pb-3 px-3 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 ${
                  shiftModalTab === 'assignments'
                    ? 'border-emerald-600 text-emerald-700'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <span className="material-symbols-outlined text-base">badge</span>
                <span>Staff Shift Assignment ({db.staff.length})</span>
              </button>
            </div>

            {shiftModalTab === 'shifts' && !editingShift && (
              <button
                type="button"
                onClick={() => {
                  setEditingShift({
                    id: `shift-${Date.now()}`,
                    name: 'New Shift',
                    startTime: '09:00',
                    endTime: '18:00',
                    gracePeriodMinutes: 15,
                    halfDayHours: 4.0,
                    color: 'blue',
                    description: '',
                  });
                }}
                className="mb-2 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1 shadow-sm transition-all"
              >
                <span className="material-symbols-outlined text-sm">add</span>
                <span>Create Shift</span>
              </button>
            )}
          </div>

          {/* Modal Body */}
          <div className="p-4 sm:p-5 overflow-y-auto flex-1 max-h-[calc(92vh-170px)] bg-slate-50/60">
            {/* TAB 1: WORK SHIFTS */}
            {shiftModalTab === 'shifts' && (
              <div className="flex flex-col gap-4">
                {/* Edit / Create Shift Form */}
                {editingShift ? (
                  <div className="p-4 sm:p-5 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col gap-4">
                    <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-emerald-600">tune</span>
                        <h4 className="font-extrabold text-sm text-slate-900">
                          {shiftsList.some((s) => s.id === editingShift.id)
                            ? `Edit Shift: ${editingShift.name}`
                            : 'Create New Shift'}
                        </h4>
                      </div>
                      <button
                        type="button"
                        onClick={() => setEditingShift(null)}
                        className="text-xs text-slate-500 hover:text-slate-800 font-bold"
                      >
                        Cancel
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                      <div>
                        <label className="font-bold text-slate-700 block mb-1">Shift Name *</label>
                        <input
                          type="text"
                          required
                          value={editingShift.name || ''}
                          onChange={(e) => setEditingShift({ ...editingShift, name: e.target.value })}
                          placeholder="e.g. Morning Shift"
                          className="w-full px-3 py-2 rounded-xl border border-slate-300 font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>

                      <div>
                        <label className="font-bold text-slate-700 block mb-1">Color Theme *</label>
                        <div className="flex items-center gap-2 pt-0.5">
                          {(['emerald', 'amber', 'blue', 'purple', 'rose', 'indigo', 'cyan'] as const).map(
                            (c) => (
                              <button
                                key={c}
                                type="button"
                                onClick={() => setEditingShift({ ...editingShift, color: c })}
                                className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                                  editingShift.color === c
                                    ? 'ring-2 ring-offset-2 ring-slate-900 scale-110'
                                    : 'opacity-70 hover:opacity-100'
                                }`}
                                style={{
                                  backgroundColor:
                                    c === 'emerald'
                                      ? '#10b981'
                                      : c === 'amber'
                                      ? '#f59e0b'
                                      : c === 'blue'
                                      ? '#3b82f6'
                                      : c === 'purple'
                                      ? '#a855f7'
                                      : c === 'rose'
                                      ? '#f43f5e'
                                      : c === 'indigo'
                                      ? '#6366f1'
                                      : '#06b6d4',
                                }}
                              >
                                {editingShift.color === c && (
                                  <span className="material-symbols-outlined text-white text-xs">check</span>
                                )}
                              </button>
                            )
                          )}
                        </div>
                      </div>

                      <div>
                        <label className="font-bold text-slate-700 block mb-1">Start Time (Punch In) *</label>
                        <input
                          type="time"
                          required
                          value={editingShift.startTime || '09:00'}
                          onChange={(e) => setEditingShift({ ...editingShift, startTime: e.target.value })}
                          className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>

                      <div>
                        <label className="font-bold text-slate-700 block mb-1">End Time (Punch Out) *</label>
                        <input
                          type="time"
                          required
                          value={editingShift.endTime || '18:00'}
                          onChange={(e) => setEditingShift({ ...editingShift, endTime: e.target.value })}
                          className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>

                      <div>
                        <label className="font-bold text-slate-700 block mb-1">
                          Grace Period (Minutes) *
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={120}
                          value={editingShift.gracePeriodMinutes ?? 15}
                          onChange={(e) =>
                            setEditingShift({
                              ...editingShift,
                              gracePeriodMinutes: Number(e.target.value),
                            })
                          }
                          className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                        <span className="text-[10px] text-slate-500 mt-1 block">
                          Staff arriving within this allowance is marked <strong>On Time</strong>. After this, marked <strong>Late</strong>.
                        </span>
                      </div>

                      <div>
                        <label className="font-bold text-slate-700 block mb-1">
                          Half-Day Hours Threshold *
                        </label>
                        <input
                          type="number"
                          step={0.5}
                          min={1}
                          max={12}
                          value={editingShift.halfDayHours ?? 4.0}
                          onChange={(e) =>
                            setEditingShift({ ...editingShift, halfDayHours: Number(e.target.value) })
                          }
                          className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                        <span className="text-[10px] text-slate-500 mt-1 block">
                          Minimum shift hours required to count as half-day rather than absent.
                        </span>
                      </div>

                      <div className="sm:col-span-2">
                        <label className="font-bold text-slate-700 block mb-1">Description / Notes</label>
                        <input
                          type="text"
                          value={editingShift.description || ''}
                          onChange={(e) =>
                            setEditingShift({ ...editingShift, description: e.target.value })
                          }
                          placeholder="e.g. Kitchen prep, lunch rush & dining service"
                          className="w-full px-3 py-2 rounded-xl border border-slate-300 text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={() => setEditingShift(null)}
                        className="px-4 py-2 rounded-xl hover:bg-slate-100 text-slate-600 font-bold text-xs"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={isSavingShifts}
                        onClick={() => {
                          if (!editingShift.name || !editingShift.startTime || !editingShift.endTime) {
                            alert('Please fill shift name and times.');
                            return;
                          }
                          handleSaveShiftConfig(editingShift as ShiftConfig);
                        }}
                        className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-md disabled:opacity-50"
                      >
                        {isSavingShifts ? (
                          <>
                            <span className="material-symbols-outlined text-sm animate-spin">refresh</span>
                            Saving...
                          </>
                        ) : (
                          <>
                            <span className="material-symbols-outlined text-sm">check</span>
                            Save Shift Schedule
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                ) : null}

                {/* Shifts Cards Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {activeShifts.map((shift) => {
                    const style = colorPillClasses[shift.color] || colorPillClasses.emerald;
                    const assignedStaffCount = db.staff.filter((s) => {
                      const assigned = s.assignedShiftId || getShiftForStaff(s, activeShifts).id;
                      return assigned === shift.id;
                    }).length;

                    return (
                      <div
                        key={shift.id}
                        className="p-4 bg-white rounded-2xl border border-slate-200/90 shadow-sm hover:shadow-md transition-all flex flex-col justify-between gap-3 relative overflow-hidden"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2.5">
                            <span className={`w-3 h-3 rounded-full ${style.dot}`} />
                            <div>
                              <h4 className="font-extrabold text-sm text-slate-900 flex items-center gap-2">
                                {shift.name}
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border ${style.bg} ${style.text} ${style.border}`}
                                >
                                  {format24To12(shift.startTime)} – {format24To12(shift.endTime)}
                                </span>
                              </h4>
                              {shift.description && (
                                <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                                  {shift.description}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-2 py-2 border-y border-slate-100 text-[11px]">
                          <div className="flex flex-col">
                            <span className="text-slate-400 font-bold uppercase text-[9px]">Grace Period</span>
                            <span className="font-extrabold text-slate-800">
                              {shift.gracePeriodMinutes || 15} mins
                            </span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-slate-400 font-bold uppercase text-[9px]">Half Day Min</span>
                            <span className="font-extrabold text-slate-800">
                              {shift.halfDayHours || 4} hours
                            </span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-slate-400 font-bold uppercase text-[9px]">Assigned Staff</span>
                            <span className="font-extrabold text-emerald-700">
                              {assignedStaffCount} Staff
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2 pt-1">
                          <span className="text-[11px] text-slate-500 font-medium">
                            Hours: {shift.startTime} to {shift.endTime} (24h)
                          </span>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setEditingShift(shift)}
                              className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs flex items-center gap-1 transition-colors"
                            >
                              <span className="material-symbols-outlined text-xs">edit</span>
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteShift(shift.id)}
                              className="w-7 h-7 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600 flex items-center justify-center transition-colors"
                              title="Delete shift"
                            >
                              <span className="material-symbols-outlined text-sm">delete</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* TAB 2: STAFF SHIFT ASSIGNMENT */}
            {shiftModalTab === 'assignments' && (
              <div className="flex flex-col gap-4">
                {/* Bulk Department Assignment Toolbar */}
                <div className="p-3.5 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-extrabold text-slate-800 flex items-center gap-1">
                      <span className="material-symbols-outlined text-sm text-emerald-600">groups</span>
                      Quick Bulk Assign:
                    </span>
                    <select
                      value={bulkDepartment}
                      onChange={(e) => setBulkDepartment(e.target.value)}
                      className="h-8 px-2.5 rounded-lg border border-slate-300 font-bold text-slate-700 bg-slate-50"
                    >
                      {departments.map((d) => (
                        <option key={d} value={d}>
                          Dept: {d}
                        </option>
                      ))}
                    </select>

                    <span className="text-slate-400 font-bold">➔</span>

                    <select
                      value={bulkShiftId}
                      onChange={(e) => setBulkShiftId(e.target.value)}
                      className="h-8 px-2.5 rounded-lg border border-slate-300 font-bold text-slate-700 bg-slate-50"
                    >
                      {activeShifts.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.startTime} - {s.endTime})
                        </option>
                      ))}
                    </select>

                    <button
                      type="button"
                      onClick={() => handleApplyBulkDepartment(bulkDepartment, bulkShiftId)}
                      className="px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-bold transition-all shadow-sm flex items-center gap-1"
                    >
                      <span className="material-symbols-outlined text-xs">done_all</span>
                      Apply to {bulkDepartment === 'All' ? 'All Staff' : `${bulkDepartment}`}
                    </button>
                  </div>

                  {/* Search Filter */}
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-2.5 top-1.5 text-sm text-slate-400">
                      search
                    </span>
                    <input
                      type="text"
                      placeholder="Search staff name..."
                      value={staffSearchQuery}
                      onChange={(e) => setStaffSearchQuery(e.target.value)}
                      className="pl-8 pr-3 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-800 bg-slate-50 focus:outline-none focus:ring-1 focus:ring-emerald-500 w-44"
                    />
                  </div>
                </div>

                {/* Staff Roster List */}
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-50 text-slate-500 uppercase font-bold text-[10px] border-b border-slate-200">
                      <tr>
                        <th className="p-3">Staff Profile</th>
                        <th className="p-3">Role &amp; Dept</th>
                        <th className="p-3">Assigned Shift</th>
                        <th className="p-3">Timing &amp; Grace</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredStaff.map((staff) => {
                        const currentShiftId =
                          staffShiftMap[staff.id] ||
                          staff.assignedShiftId ||
                          getShiftForStaff(staff, activeShifts).id;
                        const currentShift =
                          activeShifts.find((s) => s.id === currentShiftId) || activeShifts[0];
                        const style = colorPillClasses[currentShift.color] || colorPillClasses.emerald;

                        return (
                          <tr key={staff.id} className="hover:bg-slate-50/80 transition-colors">
                            <td className="p-3">
                              <div className="flex items-center gap-2.5">
                                <img
                                  src={staff.photoUrl}
                                  alt=""
                                  className="w-8 h-8 rounded-full object-cover border border-slate-200"
                                  onError={(e) => {
                                    (e.target as HTMLElement).setAttribute(
                                      'src',
                                      `/staff_photos/${staff.id}.jpg`
                                    );
                                  }}
                                />
                                <div>
                                  <span className="font-extrabold text-slate-900 block">
                                    {staff.fullName}
                                  </span>
                                  <span className="text-[10px] font-mono text-slate-400 font-bold">
                                    {staff.employeeCode}
                                  </span>
                                </div>
                              </div>
                            </td>

                            <td className="p-3">
                              <span className="font-bold text-slate-800 block capitalize">
                                {staff.role}
                              </span>
                              <span className="text-[10px] text-slate-500 font-semibold">
                                {staff.department}
                              </span>
                            </td>

                            <td className="p-3">
                              <select
                                value={currentShiftId}
                                onChange={(e) =>
                                  setStaffShiftMap({
                                    ...staffShiftMap,
                                    [staff.id]: e.target.value,
                                  })
                                }
                                className="h-8 px-2.5 rounded-lg border border-slate-300 font-bold text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                              >
                                {activeShifts.map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.name} ({format24To12(s.startTime)} - {format24To12(s.endTime)})
                                  </option>
                                ))}
                              </select>
                            </td>

                            <td className="p-3">
                              <span
                                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-extrabold border ${style.bg} ${style.text} ${style.border}`}
                              >
                                <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
                                {currentShift.name}: {currentShift.startTime} - {currentShift.endTime} (Grace: {currentShift.gracePeriodMinutes || 15}m)
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Action Save Bar */}
                <div className="flex items-center justify-between p-3.5 bg-white rounded-2xl border border-slate-200 shadow-sm">
                  <div className="text-xs text-slate-500 font-medium">
                    Total: <strong>{db.staff.length}</strong> staff configured across{' '}
                    <strong>{activeShifts.length}</strong> work shifts.
                  </div>

                  <button
                    type="button"
                    disabled={isSavingShifts}
                    onClick={handleSaveStaffAssignments}
                    className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:brightness-110 text-white font-extrabold text-xs shadow-md transition-all active:scale-95 flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {isSavingShifts ? (
                      <>
                        <span className="material-symbols-outlined text-sm animate-spin">refresh</span>
                        Saving Roster...
                      </>
                    ) : (
                      <>
                        <span className="material-symbols-outlined text-sm">save</span>
                        Save Staff Shift Assignments
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ── 1. STAFF VIEW: ONLY Face Terminal ───────────────────────────────────────
  if (!isAdminOrManager) {
    return (
      <div className="p-3.5 sm:p-6 lg:p-8 max-w-4xl mx-auto flex flex-col gap-4 sm:gap-6">
        <div className="bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-slate-200/80 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <span className="material-symbols-outlined text-2xl">center_focus_strong</span>
            </div>
            <div>
              <h2 className="text-base font-extrabold text-slate-900">Attendance Terminal</h2>
              <p className="text-xs text-slate-500 font-medium mt-0.5">
                Welcome, <strong>{currentUser.name}</strong> ({currentUser.role}). Look into camera to record check-in / check-out.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowQrStandeeModal(true)}
              className="px-3 py-1.5 rounded-apple text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5 shadow-sm transition-all"
            >
              <span className="material-symbols-outlined text-sm">qr_code_scanner</span>
              <span>QR Poster</span>
            </button>
            <button
              onClick={() => setIsScanModalOpen(true)}
              className="px-3.5 py-1.5 rounded-apple text-xs font-bold bg-gradient-to-r from-gold-500 to-gold-400 hover:brightness-110 text-forest-950 flex items-center gap-1.5 shadow-sm transition-all active:scale-95"
            >
              <span className="material-symbols-outlined text-sm">photo_camera</span>
              <span>Biometric Attendance Terminal</span>
            </button>
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
              Staff Portal
            </span>
          </div>
        </div>

        <FaceTerminal
          db={db}
          currentUser={currentUser}
          onVerifyAttendance={onVerifyAttendance}
          isAdminView={false}
          matchThreshold={matchThreshold}
          isScanModalOpen={isScanModalOpen}
          onOpenScanModal={() => setIsScanModalOpen(true)}
          onCloseScanModal={() => setIsScanModalOpen(false)}
        />
        {renderQrStandeeModal()}
      </div>
    );
  }

  // ── 2. ADMIN / MANAGER VIEW: Full Dashboard + Face Terminal ─────────────────
  return (
    <div className="p-3.5 sm:p-6 lg:p-8 flex flex-col gap-5 sm:gap-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="ios27-glass-card p-4 sm:p-5 rounded-[24px] flex flex-col gap-3.5">
        {/* Top Line: Title & Badge on Left, Print QR Standee & Biometric Attendance Terminal on Right */}
        <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base sm:text-lg font-bold tracking-tight text-slate-900 flex items-center gap-2">
              <span className="material-symbols-outlined text-emerald-600">center_focus_strong</span>
              Biometric Attendance Management
            </h2>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] bg-emerald-500/[0.1] text-emerald-700 font-semibold border border-emerald-500/20">
              Live AI Recognition
            </span>
          </div>

          {/* Action Buttons: Print QR Standee to the left of Biometric Attendance Terminal */}
          <div className="flex items-center gap-2 shrink-0 ml-auto sm:ml-0 flex-wrap sm:flex-nowrap">
            <button
              type="button"
              onClick={() => setShowQrStandeeModal(true)}
              className="ios27-btn-small px-3.5 py-2 rounded-apple bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 hover:brightness-110 text-xs font-bold text-white transition-all shadow-apple-subtle flex items-center gap-1.5 shrink-0 active:scale-95"
              title="Generate and print printable Attendance QR Poster for restaurant walls"
            >
              <span className="material-symbols-outlined text-sm">qr_code_scanner</span>
              <span className="hidden sm:inline">Print QR Standee</span>
              <span className="sm:hidden">QR Standee</span>
            </button>

            <button
              type="button"
              onClick={() => setIsScanModalOpen(true)}
              className="ios27-btn-small px-4 py-2 rounded-apple bg-gradient-to-r from-gold-500 via-gold-400 to-gold-500 hover:brightness-110 text-xs font-bold text-forest-950 transition-all shadow-apple-subtle flex items-center gap-1.5 shrink-0 border border-gold-400/80 active:scale-95"
              title="Open Biometric Attendance Terminal face scanner popup"
            >
              <span className="material-symbols-outlined text-base">photo_camera</span>
              <span>Biometric Attendance Terminal</span>
            </button>
          </div>
        </div>

        {/* Second Line: Subtitle on Left, Sub Tabs & Override on Right */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-black/[0.04]">
          <p className="text-xs text-slate-500 font-medium">
            Real-time biometric facial recognition • Liveness verification • Automated shift roster
          </p>

          <div className="flex items-center gap-2.5 flex-wrap md:flex-nowrap overflow-x-auto scrollbar-none">
            {/* Sub Tab Buttons - Apple Segmented Control */}
            <div className="flex bg-black/[0.05] p-1 rounded-apple text-xs font-semibold overflow-x-auto scrollbar-none shrink-0">
              {(['terminal', 'roster', 'test_console', 'leaves'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveSubTab(tab)}
                  className={`px-3 py-1.5 rounded-apple-sm transition-all whitespace-nowrap text-xs active:scale-[0.98] ${
                    activeSubTab === tab
                      ? 'bg-[#05271f] text-gold-300 font-semibold shadow-apple-subtle'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab === 'terminal'
                    ? 'Face Terminal'
                    : tab === 'roster'
                    ? 'Daily Roster'
                    : tab === 'test_console'
                    ? 'Accuracy Test'
                    : 'Leaves'}
                </button>
              ))}
            </div>

            <button
              onClick={() => {
                setOverrideStaffId(db.staff[0]?.id || '');
                setShowOverrideModal(true);
              }}
              className="ios27-btn-small px-3.5 rounded-apple bg-black/[0.04] hover:bg-black/[0.07] text-xs font-semibold text-slate-800 transition-all border border-black/[0.06] flex items-center gap-1.5 shrink-0"
            >
              <span className="material-symbols-outlined text-sm text-slate-600">edit_note</span>
              <span className="hidden sm:inline">Manual Override</span>
              <span className="sm:hidden">Override</span>
            </button>

            <button
              onClick={() => {
                setEditingShift(null);
                setShowShiftSettingsModal(true);
              }}
              className="w-[34px] h-[34px] rounded-apple bg-black/[0.04] hover:bg-black/[0.07] text-slate-800 transition-all border border-black/[0.06] flex items-center justify-center shrink-0 active:scale-95"
              title="Shift Settings — Configure Shifts & Staff Assignment"
              aria-label="Shift Settings"
            >
              <span className="material-symbols-outlined text-base text-slate-600">settings</span>
            </button>
          </div>
        </div>
      </div>

      {/* Metric Cards (Admin & Manager Only) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        {[
          { label: 'Total Strength', value: `${db.staff.length} Staff`, icon: 'group', color: 'slate' },
          { label: 'Present On Duty', value: presentCount, icon: 'check_circle', color: 'emerald' },
          { label: 'Approved Leave', value: leaveCount, icon: 'event_busy', color: 'amber' },
          { label: 'Absent / Delay', value: absentCount, icon: 'warning', color: 'rose' },
        ].map((card) => (
          <div
            key={card.label}
            className="p-4 ios27-glass-card rounded-[22px] flex items-center justify-between"
          >
            <div>
              <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider block">
                {card.label}
              </span>
              <span
                className={`text-2xl font-bold tracking-tight tabular-nums block mt-1 ${
                  card.color === 'emerald'
                    ? 'text-emerald-600'
                    : card.color === 'amber'
                    ? 'text-amber-600'
                    : card.color === 'rose'
                    ? 'text-rose-600'
                    : 'text-slate-900'
                }`}
              >
                {card.value}
              </span>
            </div>
            <div
              className={`w-10 h-10 rounded-apple flex items-center justify-center ${
                card.color === 'emerald'
                  ? 'bg-emerald-50 text-emerald-600'
                  : card.color === 'amber'
                  ? 'bg-amber-50 text-amber-600'
                  : card.color === 'rose'
                  ? 'bg-rose-50 text-rose-600'
                  : 'bg-slate-100 text-slate-600'
              }`}
            >
              <span className="material-symbols-outlined">{card.icon}</span>
            </div>
          </div>
        ))}
      </div>

      {/* SUB-TAB 1: Face Terminal (kept mounted so neural net models stay ready & popup opens instantly from any tab) */}
      <div className={activeSubTab === 'terminal' ? 'block' : isScanModalOpen ? 'block' : 'hidden'}>
        <FaceTerminal
          db={db}
          currentUser={currentUser}
          onVerifyAttendance={onVerifyAttendance}
          isAdminView={true}
          matchThreshold={matchThreshold}
          isScanModalOpen={isScanModalOpen}
          onOpenScanModal={() => setIsScanModalOpen(true)}
          onCloseScanModal={() => setIsScanModalOpen(false)}
          showTabView={activeSubTab === 'terminal'}
        />
      </div>

      {/* SUB-TAB 2: Today's Roster */}
      {activeSubTab === 'roster' && (
        <div className="bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-slate-200/80 flex flex-col gap-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
              <span className="material-symbols-outlined text-slate-600 text-base">receipt_long</span>
              Shift Attendance Log
            </h3>
            <span className="text-xs text-slate-500 font-medium">
              {todayLogs.length} Records • {todayStr}
            </span>
          </div>

          {todayLogs.length === 0 ? (
            <div className="py-16 text-center flex flex-col items-center gap-3 text-slate-400">
              <span className="material-symbols-outlined text-4xl">table_rows</span>
              <span className="font-semibold text-sm text-slate-600">No attendance logs for today</span>
              <p className="text-xs max-w-xs">
                Staff can check in using the Face Terminal. Records will appear here in real-time.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-xs text-left min-w-[760px]">
                <thead className="bg-slate-50 text-slate-500 uppercase font-bold text-[10px] border-y border-slate-200">
                  <tr>
                    <th className="p-2.5">Staff Member</th>
                    <th className="p-2.5">Role &amp; Dept</th>
                    <th className="p-2.5">Assigned Shift</th>
                    <th className="p-2.5">Check In (Punctuality)</th>
                    <th className="p-2.5">Check Out (Departure)</th>
                    <th className="p-2.5">Hours</th>
                    <th className="p-2.5">Status</th>
                    <th className="p-2.5">Verification</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {todayLogs.map((log) => {
                    const staffMember = db.staff.find((s) => s.id === log.staffId);
                    const shiftObj = staffMember
                      ? getShiftForStaff(staffMember, shiftsList)
                      : shiftsList[0] || DEFAULT_SHIFTS[0];

                    const shiftColor = shiftObj.color || 'emerald';
                    const shiftBadgeClasses =
                      shiftColor === 'amber'
                        ? 'bg-amber-50 text-amber-700 border-amber-200'
                        : shiftColor === 'blue'
                        ? 'bg-blue-50 text-blue-700 border-blue-200'
                        : shiftColor === 'purple'
                        ? 'bg-purple-50 text-purple-700 border-purple-200'
                        : shiftColor === 'rose'
                        ? 'bg-rose-50 text-rose-700 border-rose-200'
                        : 'bg-emerald-50 text-emerald-700 border-emerald-200';

                    return (
                      <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                        <td className="p-2.5 font-bold text-slate-900">
                          <div className="flex items-center gap-2">
                            <img
                              src={log.staffPhotoUrl}
                              alt=""
                              className="w-7 h-7 rounded-full object-cover shrink-0 border border-slate-200"
                              onError={(e) => {
                                (e.target as HTMLElement).setAttribute('src', `/staff_photos/${log.staffId}.jpg`);
                              }}
                            />
                            <div>
                              <span className="truncate max-w-[130px] block">{log.staffName}</span>
                              <span className="text-[10px] text-slate-400 font-mono font-medium block">
                                {staffMember?.employeeCode || '—'}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="p-2.5">
                          <span className="font-semibold text-slate-800 capitalize block">
                            {log.staffRole}
                          </span>
                          <span className="text-[10px] text-slate-500 font-medium block">
                            {staffMember?.department || 'Staff'}
                          </span>
                        </td>
                        <td className="p-2.5">
                          <div className="flex flex-col gap-0.5">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold border inline-flex items-center gap-1 w-fit ${shiftBadgeClasses}`}
                            >
                              <span className="w-1.5 h-1.5 rounded-full bg-current" />
                              {log.shiftName || shiftObj.name}
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono">
                              {log.shiftTiming || `${shiftObj.startTime} - ${shiftObj.endTime}`}
                            </span>
                          </div>
                        </td>
                        <td className="p-2.5">
                          <div className="flex flex-col gap-1">
                            <span className="font-mono font-bold text-slate-900">
                              {log.checkInTime || '—'}
                            </span>
                            {log.checkInTime && (
                              <div>
                                {log.isLate || log.status === 'late' ? (
                                  <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[9px] font-black border border-amber-300 inline-flex items-center gap-0.5">
                                    <span className="material-symbols-outlined text-[10px]">warning</span>
                                    Late (+{log.lateMinutes || 0}m)
                                  </span>
                                ) : (
                                  <span className="px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[9px] font-black border border-emerald-300 inline-flex items-center gap-0.5">
                                    <span className="material-symbols-outlined text-[10px]">check</span>
                                    On Time
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="p-2.5">
                          <div className="flex flex-col gap-1">
                            {log.checkOutTime ? (
                              <>
                                <span className="font-mono font-bold text-slate-900">
                                  {log.checkOutTime}
                                </span>
                                <div>
                                  {log.leftEarly ? (
                                    <span className="px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-800 text-[9px] font-black border border-rose-300 inline-flex items-center gap-0.5">
                                      <span className="material-symbols-outlined text-[10px]">arrow_back</span>
                                      Left early (-{log.leftEarlyMinutes || 0}m)
                                    </span>
                                  ) : log.isOvertime ? (
                                    <span className="px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-800 text-[9px] font-black border border-blue-300 inline-flex items-center gap-0.5">
                                      <span className="material-symbols-outlined text-[10px]">more_time</span>
                                      Overtime (+{log.overtimeMinutes || 0}m)
                                    </span>
                                  ) : (
                                    <span className="px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[9px] font-black border border-emerald-300 inline-flex items-center gap-0.5">
                                      <span className="material-symbols-outlined text-[10px]">check_circle</span>
                                      Shift Done
                                    </span>
                                  )}
                                </div>
                              </>
                            ) : (
                              <span className="text-emerald-700 font-bold flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                                On Duty
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-2.5 font-bold font-mono text-slate-800">
                          {log.hoursWorked > 0 ? `${log.hoursWorked}h` : '—'}
                        </td>
                        <td className="p-2.5">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                              log.status === 'present'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : log.status === 'late'
                                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                : log.status === 'override'
                                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                : log.status === 'on_leave'
                                ? 'bg-slate-100 text-slate-600 border border-slate-200'
                                : 'bg-rose-50 text-rose-700 border border-rose-200'
                            }`}
                          >
                            {log.status === 'late' ? 'Late Arrival' : log.status}
                          </span>
                        </td>
                        <td className="p-2.5 font-medium text-slate-600">
                          {log.verificationMethod === 'manager_override' ? (
                            <span className="text-amber-800 font-bold flex items-center gap-1" title={log.overrideReason}>
                              <span className="material-symbols-outlined text-xs">edit_note</span>
                              Manual Override
                            </span>
                          ) : (
                            <div className="flex flex-col">
                              <span className="flex items-center gap-1 text-emerald-700 font-bold">
                                <span className="material-symbols-outlined text-xs">center_focus_strong</span>
                                AI Face Scan
                              </span>
                              <span className="text-[10px] text-slate-400 font-mono">
                                Match: {log.faceConfidence ? `${log.faceConfidence}%` : '99.4%'}
                              </span>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 3: Test Console & Recognition Details */}
      {activeSubTab === 'test_console' && (
        <div className="flex flex-col gap-5">
          {/* Controls & Configuration Box */}
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200/80 flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
                  <span className="material-symbols-outlined text-lg">tune</span>
                </div>
                <div>
                  <h3 className="font-extrabold text-sm text-slate-900">Recognition Diagnostics &amp; Tuning Console</h3>
                  <p className="text-[11px] text-slate-500">Live decision boundaries, similarity scores &amp; database reset</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <span className="px-3 py-1 rounded-full text-xs font-black bg-slate-100 text-slate-700 border border-slate-200 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-slate-400" />
                  Liveness: OFF (Phase 3 Planned)
                </span>

                <button
                  type="button"
                  disabled={resettingToday}
                  onClick={async () => {
                    if (!confirm("Are you sure you want to reset all of today's attendance records to test scanning again?")) return;
                    setResettingToday(true);
                    try {
                      const res = await fetch('/api/attendance', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'DEV_RESET_TODAY' }),
                      });
                      const json = await res.json();
                      if (json.success) {
                        alert("Today's attendance records have been reset. You can now test face recognition again!");
                        window.location.reload();
                      }
                    } catch (e: any) {
                      alert(`Reset failed: ${e.message}`);
                    } finally {
                      setResettingToday(false);
                    }
                  }}
                  className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs shadow-sm transition-all active:scale-95 flex items-center gap-1.5 disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-sm">restart_alt</span>
                  {resettingToday ? 'Resetting...' : "Reset Today's Attendance"}
                </button>
              </div>
            </div>

            {/* Threshold Slider and Settings Breakdown */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1">
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200/80 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-extrabold text-slate-800">Match Distance Threshold</span>
                    <span className="text-xs font-mono font-black text-emerald-700">&lt; {matchThreshold.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min="0.30"
                    max="0.75"
                    step="0.01"
                    value={matchThreshold}
                    onChange={(e) => setMatchThreshold(parseFloat(e.target.value))}
                    className="w-full accent-emerald-600 cursor-pointer"
                  />
                </div>
                <p className="text-[10px] text-slate-500 mt-2">
                  Euclidean distance cutoff. Lower is stricter (0.45 = very strict, 0.58 = standard balanced).
                </p>
              </div>

              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200/80 flex flex-col justify-between">
                <div>
                  <span className="text-xs font-extrabold text-slate-800 block mb-1">Strict One Scan Per Day</span>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="material-symbols-outlined text-emerald-600 text-lg">check_circle</span>
                    <span className="text-xs font-bold text-slate-700">Enforced at API &amp; DB Level</span>
                  </div>
                </div>
                <p className="text-[10px] text-slate-500 mt-2">
                  Scanning twice in a single day returns &quot;Already Marked&quot; and preserves original timestamp.
                </p>
              </div>

              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200/80 flex flex-col justify-between">
                <div>
                  <span className="text-xs font-extrabold text-slate-800 block mb-1">Backend Database Cloud</span>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="material-symbols-outlined text-emerald-600 text-lg">cloud_done</span>
                    <span className="text-xs font-bold text-slate-700">Cloud Sync Connected</span>
                  </div>
                </div>
                <p className="text-[10px] text-slate-500 mt-2">
                  All staff records, photos, and attendance logs synchronize securely in real-time.
                </p>
              </div>
            </div>
          </div>

          {/* Real-time Evaluation Details Table */}
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200/80 flex flex-col gap-3">
            <h4 className="text-xs font-extrabold text-slate-900 flex items-center gap-1.5 uppercase tracking-wider">
              <span className="material-symbols-outlined text-slate-600 text-base">analytics</span>
              Today&apos;s Face Recognition Audit Log &amp; Confidence Breakdown
            </h4>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left min-w-[640px]">
                <thead className="bg-slate-50 text-slate-500 uppercase font-bold text-[10px] border-y border-slate-200">
                  <tr>
                    <th className="p-2.5">Staff</th>
                    <th className="p-2.5">Recorded Time</th>
                    <th className="p-2.5">FRS Confidence</th>
                    <th className="p-2.5">Estimated Distance</th>
                    <th className="p-2.5">Decision Rules</th>
                    <th className="p-2.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {todayLogs.map((log) => {
                    const estDist = log.faceConfidence ? ((100 - log.faceConfidence) / 100).toFixed(3) : '0.000';
                    return (
                      <tr key={log.id} className="hover:bg-slate-50">
                        <td className="p-2.5 font-bold text-slate-900 flex items-center gap-2">
                          <img
                            src={log.staffPhotoUrl}
                            alt=""
                            className="w-7 h-7 rounded-full object-cover border border-slate-200"
                            onError={(e) => {
                              (e.target as HTMLElement).setAttribute('src', `/staff_photos/${log.staffId}.jpg`);
                            }}
                          />
                          <span>{log.staffName}</span>
                        </td>
                        <td className="p-2.5 font-mono text-slate-600">{log.checkInTime || '—'}</td>
                        <td className="p-2.5 font-mono font-extrabold text-emerald-700">
                          {log.faceConfidence ? `${log.faceConfidence}%` : '100%'}
                        </td>
                        <td className="p-2.5 font-mono text-slate-500">{estDist}</td>
                        <td className="p-2.5">
                          <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 text-[10px] font-bold border border-emerald-200">
                            Distance &lt; {matchThreshold.toFixed(2)} (PASSED)
                          </span>
                        </td>
                        <td className="p-2.5 font-bold uppercase text-emerald-700">{log.status}</td>
                      </tr>
                    );
                  })}
                  {todayLogs.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-400 text-xs">
                        No recognition logs recorded today yet. Use the Face Terminal tab to scan and verify.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 4: Leave Requests */}
      {activeSubTab === 'leaves' && (
        <div className="bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-slate-200/80 flex flex-col gap-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
              <span className="material-symbols-outlined text-slate-600 text-base">event_note</span>
              Leave Requests & Approvals
            </h3>
            <span className="text-xs text-slate-500 font-medium">{db.leaveRequests.length} Requests</span>
          </div>

          {db.leaveRequests.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-xs font-medium">No leave requests pending.</div>
          ) : (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-xs text-left min-w-[560px]">
                <thead className="bg-slate-50 text-slate-500 uppercase font-bold text-[10px] border-y border-slate-200">
                  <tr>
                    <th className="p-2.5">Staff Name</th>
                    <th className="p-2.5">Dates</th>
                    <th className="p-2.5">Leave Type</th>
                    <th className="p-2.5">Reason</th>
                    <th className="p-2.5">Status</th>
                    <th className="p-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {db.leaveRequests.map((lr) => (
                    <tr key={lr.id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-2.5 font-bold text-slate-900">{lr.staffName}</td>
                      <td className="p-2.5 font-mono text-slate-600">
                        {lr.startDate} → {lr.endDate}
                      </td>
                      <td className="p-2.5 capitalize font-bold text-slate-700">{lr.leaveType} Leave</td>
                      <td className="p-2.5 text-slate-600 max-w-[160px] truncate">{lr.reason}</td>
                      <td className="p-2.5">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                            lr.status === 'approved'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : lr.status === 'rejected'
                              ? 'bg-rose-50 text-rose-700 border border-rose-200'
                              : 'bg-amber-50 text-amber-700 border border-amber-200'
                          }`}
                        >
                          {lr.status}
                        </span>
                      </td>
                      <td className="p-2.5 text-right">
                        {lr.status === 'pending' && (
                          <button
                            onClick={() => onApproveLeave(lr.id)}
                            className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs transition-all active:scale-95"
                          >
                            Approve
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Manual Override Modal */}
      {showOverrideModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white max-w-md w-full rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center text-amber-700">
                  <span className="material-symbols-outlined text-lg">edit_note</span>
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">Manual Attendance Override</h3>
                  <p className="text-[11px] text-slate-500">Record check-in when face scan is unavailable</p>
                </div>
              </div>
              <button
                onClick={() => setShowOverrideModal(false)}
                className="w-7 h-7 rounded-lg hover:bg-slate-200 flex items-center justify-center text-slate-400"
              >
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            </div>

            <form onSubmit={handleExecuteOverride} className="p-5 flex flex-col gap-3.5 text-xs">
              <div className="flex flex-col gap-1">
                <label className="font-bold text-slate-700">Select Staff *</label>
                <select
                  value={overrideStaffId}
                  onChange={(e) => setOverrideStaffId(e.target.value)}
                  className="h-10 px-3 rounded-xl border border-slate-300 bg-slate-50 font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  {db.staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.fullName} ({s.role})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="font-bold text-slate-700">Check-In Time *</label>
                  <input
                    type="time"
                    required
                    value={overrideTime}
                    onChange={(e) => setOverrideTime(e.target.value)}
                    className="h-10 px-3 rounded-xl border border-slate-300 bg-slate-50 font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="font-bold text-slate-700">Check-Out Time (Optional)</label>
                  <input
                    type="time"
                    value={overrideOutTime}
                    onChange={(e) => setOverrideOutTime(e.target.value)}
                    className="h-10 px-3 rounded-xl border border-slate-300 bg-slate-50 font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="font-bold text-slate-700">Written Reason (Audit Log) *</label>
                <textarea
                  required
                  rows={3}
                  placeholder="e.g. Device camera repair, verified by supervisor..."
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  className="p-3 rounded-xl border border-slate-300 bg-slate-50 resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-1 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowOverrideModal(false)}
                  className="px-4 py-2 rounded-xl hover:bg-slate-100 font-semibold text-slate-600 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={overrideLoading}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold transition-all shadow-md disabled:opacity-50 flex items-center gap-1.5"
                >
                  {overrideLoading ? (
                    <>
                      <span className="material-symbols-outlined text-sm animate-spin">refresh</span>
                      Saving...
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-sm">check</span>
                      Confirm & Log
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* QR Standee & Poster Modal */}
      {renderQrStandeeModal()}

      {/* Shift Configuration & Staff Assignment Modal */}
      {renderShiftSettingsModal()}
    </div>
  );
};
