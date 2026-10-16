'use client';

import React, { useState, useRef, useEffect } from 'react';
import { DatabaseSchema, Staff, User, UserRole } from '../lib/types';
import { extractFaceDescriptor, extractFaceDescriptorFromUrl } from '../lib/faceBiometrics';
import { DEFAULT_SHIFTS } from '../lib/shiftConfig';
import { getLocalDateStr } from '../lib/dateUtils';

interface StaffDirectoryModuleProps {
  db: DatabaseSchema;
  currentUser: User;
  onAddStaff: (staffData: any) => Promise<void>;
  onUpdateStaff: (staffId: string, updates: any) => Promise<void>;
  onDeleteStaff?: (staffId: string) => Promise<any>;
  onAddUser?: (userData: any) => Promise<any>;
}

// ─── BIOMETRIC FACE ENROLLMENT MODAL (WEBCAM & FILE UPLOAD) ───────────────────
interface FaceCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  staffName: string;
  currentPhotoUrl?: string;
  onSave: (photoUrl: string, descriptor?: number[]) => Promise<void> | void;
}

const FaceCaptureModal: React.FC<FaceCaptureModalProps> = ({
  isOpen,
  onClose,
  staffName,
  currentPhotoUrl,
  onSave,
}) => {
  const [activeTab, setActiveTab] = useState<'camera' | 'upload'>('camera');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [cameraStarting, setCameraStarting] = useState(false);

  // Captured snapshot preview & analysis
  const [capturedPreview, setCapturedPreview] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<{
    success: boolean;
    confidence?: number;
    descriptor?: number[];
    reason?: string;
  } | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Start webcam
  const startCamera = async () => {
    setCameraError('');
    setCameraStarting(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Webcam media access not supported in this browser.');
      }
      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }

      if (!stream) throw new Error('Could not acquire webcam stream.');
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await new Promise<void>((resolve) => {
          if (videoRef.current!.readyState >= 2) resolve();
          else videoRef.current!.onloadedmetadata = () => resolve();
        });
        await videoRef.current.play();
        setCameraActive(true);
      }
    } catch (err: any) {
      setCameraError(err.message || 'Unable to access camera.');
      setCameraActive(false);
    } finally {
      setCameraStarting(false);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    if (isOpen && activeTab === 'camera') {
      startCamera();
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [isOpen, activeTab]);

  const handleCaptureSnapshot = async () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    setCapturedPreview(dataUrl);
    setAnalyzing(true);
    setAnalysisResult(null);

    try {
      const res = await extractFaceDescriptor(canvas);
      setAnalysisResult(res);
    } catch (err: any) {
      setAnalysisResult({ success: false, reason: err.message });
    } finally {
      setAnalyzing(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAnalyzing(true);
    setAnalysisResult(null);

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      setCapturedPreview(dataUrl);

      const img = new Image();
      img.onload = async () => {
        try {
          const res = await extractFaceDescriptor(img);
          setAnalysisResult(res);
        } catch (err: any) {
          setAnalysisResult({ success: false, reason: err.message });
        } finally {
          setAnalyzing(false);
        }
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const handleConfirmAndSave = async () => {
    if (!capturedPreview) return;
    await onSave(capturedPreview, analysisResult?.descriptor);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white max-w-lg w-full rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in zoom-in-95 duration-200">
        {/* Modal Header */}
        <div className="p-4 sm:p-5 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7V5a2 2 0 0 1 2-2h2" />
                <path d="M17 3h2a2 2 0 0 1 2 2v2" />
                <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
                <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
                <circle cx="12" cy="10" r="3" />
                <path d="M7 20v-1a5 5 0 0 1 10 0v1" />
              </svg>
            </div>
            <div>
              <h3 className="font-bold text-sm sm:text-base text-white">Biometric Face Enrollment</h3>
              <p className="text-[11px] text-slate-400">Enrolling face profile for: {staffName || 'New Staff'}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-slate-800 flex items-center justify-center text-slate-400 hover:text-white"
          >
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        </div>

        {/* Tab switch */}
        <div className="flex border-b border-slate-200 bg-slate-50 p-2 gap-2 text-xs font-bold">
          <button
            type="button"
            onClick={() => {
              setActiveTab('camera');
              setCapturedPreview(null);
              setAnalysisResult(null);
            }}
            className={`flex-1 py-2 rounded-xl transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'camera' ? 'bg-white shadow text-slate-900' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span className="material-symbols-outlined text-base text-emerald-600">videocam</span>
            <span>📸 Live Camera (Capture)</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('upload');
              stopCamera();
              setCapturedPreview(null);
              setAnalysisResult(null);
            }}
            className={`flex-1 py-2 rounded-xl transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'upload' ? 'bg-white shadow text-slate-900' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span className="material-symbols-outlined text-base text-blue-600">upload_file</span>
            <span>📁 Upload Photo File</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-5 overflow-y-auto flex flex-col gap-4 text-xs">
          {activeTab === 'camera' && (
            <div className="flex flex-col gap-3">
              {/* Camera Frame */}
              {!capturedPreview ? (
                <div className="relative w-full rounded-2xl overflow-hidden bg-slate-950 aspect-[4/3] flex items-center justify-center border border-slate-800">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                  />
                  {/* Face positioning oval outline */}
                  <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                    <div className="w-48 h-60 rounded-[50%] border-2 border-dashed border-emerald-400/80 shadow-[0_0_20px_rgba(16,185,129,0.3)] flex items-center justify-center">
                      <span className="text-[10px] text-emerald-300 font-bold bg-slate-900/80 px-2 py-0.5 rounded-full">
                        Align Face Here
                      </span>
                    </div>
                  </div>

                  {cameraStarting && (
                    <div className="absolute inset-0 bg-slate-950/80 flex flex-col items-center justify-center text-white gap-2">
                      <span className="material-symbols-outlined text-2xl animate-spin">refresh</span>
                      <span className="text-xs">Initializing webcam...</span>
                    </div>
                  )}

                  {cameraError && (
                    <div className="absolute inset-4 bg-rose-950/90 text-rose-200 p-4 rounded-xl flex flex-col items-center justify-center text-center gap-2">
                      <span className="material-symbols-outlined text-3xl text-rose-400">error</span>
                      <span className="font-bold">{cameraError}</span>
                      <button
                        onClick={startCamera}
                        className="px-3 py-1.5 rounded-lg bg-rose-700 text-white font-bold text-xs"
                      >
                        Retry Camera
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                /* Snapshot Preview */
                <div className="relative w-full rounded-2xl overflow-hidden bg-slate-950 aspect-[4/3] flex items-center justify-center border border-slate-800">
                  <img src={capturedPreview} alt="Captured Snapshot" className="w-full h-full object-cover" />
                  {analyzing && (
                    <div className="absolute inset-0 bg-slate-950/70 flex flex-col items-center justify-center text-white gap-2">
                      <span className="material-symbols-outlined text-3xl animate-spin text-emerald-400">
                        biometrics
                      </span>
                      <span className="text-xs font-bold">Analyzing Facial Landmarks & Vectors...</span>
                    </div>
                  )}
                </div>
              )}

              {/* Action buttons under camera */}
              <div className="flex items-center justify-between gap-2">
                {!capturedPreview ? (
                  <button
                    type="button"
                    onClick={handleCaptureSnapshot}
                    disabled={!cameraActive}
                    className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold shadow-md transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50 text-xs sm:text-sm"
                  >
                    <span className="material-symbols-outlined text-lg">photo_camera</span>
                    <span>Capture Face Snapshot</span>
                  </button>
                ) : (
                  <div className="w-full flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setCapturedPreview(null);
                        setAnalysisResult(null);
                      }}
                      className="flex-1 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold transition-all text-xs"
                    >
                      ↺ Retake Photo
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmAndSave}
                      disabled={analyzing || !analysisResult?.success}
                      className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-md transition-all active:scale-95 text-xs disabled:opacity-50"
                    >
                      ✓ Save &amp; Enrol Face
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'upload' && (
            <div className="flex flex-col gap-3">
              <div className="border-2 border-dashed border-slate-300 hover:border-emerald-500 rounded-2xl p-6 flex flex-col items-center justify-center text-center gap-2 transition-colors cursor-pointer relative bg-slate-50/50">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleFileUpload}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                />
                <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
                  <span className="material-symbols-outlined text-2xl">add_photo_alternate</span>
                </div>
                <div>
                  <strong className="block text-slate-900 font-bold">Choose a face photo or drag &amp; drop</strong>
                  <span className="text-[11px] text-slate-500">Supports JPG, PNG, WEBP with clear front-facing lighting</span>
                </div>
              </div>

              {capturedPreview && (
                <div className="flex flex-col gap-3">
                  <div className="relative w-full rounded-2xl overflow-hidden bg-slate-950 aspect-[4/3] flex items-center justify-center border border-slate-800">
                    <img src={capturedPreview} alt="Uploaded Photo" className="w-full h-full object-cover" />
                    {analyzing && (
                      <div className="absolute inset-0 bg-slate-950/70 flex flex-col items-center justify-center text-white gap-2">
                        <span className="material-symbols-outlined text-3xl animate-spin text-emerald-400">
                          biometrics
                        </span>
                        <span className="text-xs font-bold">Extracting Neural Biometrics...</span>
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={handleConfirmAndSave}
                    disabled={analyzing || !analysisResult?.success}
                    className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-md transition-all active:scale-95 text-xs disabled:opacity-50"
                  >
                    ✓ Save &amp; Enrol Face
                  </button>
                </div>
              )}
            </div>
          )}

          {/* AI Analysis Feedback Box */}
          {analysisResult && (
            <div
              className={`p-3.5 rounded-xl border flex items-start gap-2.5 animate-in fade-in ${
                analysisResult.success
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-rose-50 border-rose-200 text-rose-900'
              }`}
            >
              <span className="material-symbols-outlined text-xl shrink-0 mt-0.5">
                {analysisResult.success ? 'verified' : 'error'}
              </span>
              <div>
                <strong className="block font-bold">
                  {analysisResult.success
                    ? `✓ Biometric Enrolment Verified (${analysisResult.confidence}% confidence)`
                    : '⚠️ Face Quality Check Failed'}
                </strong>
                <p className="text-[11px] mt-0.5 opacity-90">
                  {analysisResult.success
                    ? '128-dimensional facial embeddings generated successfully. This face is ready for live FRS verification in the Attendance module.'
                    : analysisResult.reason || 'No face detected. Please ensure you look straight at the camera with clear lighting.'}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── MAIN STAFF DIRECTORY MODULE COMPONENT ────────────────────────────────────
export const StaffDirectoryModule: React.FC<StaffDirectoryModuleProps> = ({
  db,
  currentUser,
  onAddStaff,
  onUpdateStaff,
  onDeleteStaff,
  onAddUser,
}) => {
  const [selectedDept, setSelectedDept] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStaff, setSelectedStaff] = useState<Staff | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  // Dedicated Face Capture modal state
  const [faceModalOpen, setFaceModalOpen] = useState(false);
  const [faceModalTarget, setFaceModalTarget] = useState<'create' | 'update'>('create');

  // Edit Staff mode state
  const [isEditingStaff, setIsEditingStaff] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editSuccessMsg, setEditSuccessMsg] = useState('');
  const [editFormData, setEditFormData] = useState({
    fullName: '',
    employeeCode: '',
    role: 'waiter' as string,
    department: 'Service' as Staff['department'],
    phone: '',
    email: '',
    aadhaarNumber: '',
    familyDetails: '',
    currentAddress: '',
    permanentAddress: '',
    dateOfJoining: '',
    salaryType: 'monthly' as 'monthly' | 'daily',
    baseSalaryPaise: 2500000,
    bankAccountNumber: '',
    bankIfsc: '',
    bankName: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    assignedShiftId: 'shift-morning',
    isActive: true,
  });

  const openStaffProfile = (st: Staff, startInEdit = false) => {
    setSelectedStaff(st);
    setEditFormData({
      fullName: st.fullName || '',
      employeeCode: st.employeeCode || '',
      role: st.role || 'waiter',
      department: st.department || 'Service',
      phone: st.phone || '',
      email: st.email || '',
      aadhaarNumber: st.aadhaarNumber || '',
      familyDetails: st.familyDetails || '',
      currentAddress: st.currentAddress || '',
      permanentAddress: st.permanentAddress || '',
      dateOfJoining: st.dateOfJoining || getLocalDateStr(),
      salaryType: st.salaryType || 'monthly',
      baseSalaryPaise: st.baseSalaryPaise || 2500000,
      bankAccountNumber: st.bankAccountNumber || '',
      bankIfsc: st.bankIfsc || '',
      bankName: st.bankName || '',
      emergencyContactName: st.emergencyContactName || '',
      emergencyContactPhone: st.emergencyContactPhone || '',
      assignedShiftId: st.assignedShiftId || 'shift-morning',
      isActive: st.isActive !== undefined ? st.isActive : true,
    });
    setIsEditingStaff(startInEdit);
    setEditSuccessMsg('');
  };

  const handleSaveEditStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStaff) return;
    setIsSavingEdit(true);
    try {
      const updates: Partial<Staff> = {
        fullName: editFormData.fullName.trim(),
        employeeCode: editFormData.employeeCode.trim() || selectedStaff.employeeCode,
        role: editFormData.role,
        department: editFormData.department,
        assignedShiftId: editFormData.assignedShiftId,
        phone: editFormData.phone.trim(),
        email: editFormData.email.trim(),
        emergencyContactName: editFormData.emergencyContactName.trim(),
        emergencyContactPhone: editFormData.emergencyContactPhone.trim(),
        dateOfJoining: editFormData.dateOfJoining,
        currentAddress: editFormData.currentAddress.trim(),
        permanentAddress: editFormData.permanentAddress.trim(),
        familyDetails: editFormData.familyDetails.trim(),
        isActive: editFormData.isActive,
      };

      if (isAdmin) {
        updates.aadhaarNumber = editFormData.aadhaarNumber.trim();
        updates.salaryType = editFormData.salaryType;
        updates.baseSalaryPaise = Number(editFormData.baseSalaryPaise) || 0;
        updates.bankName = editFormData.bankName.trim();
        updates.bankAccountNumber = editFormData.bankAccountNumber.trim();
        updates.bankIfsc = editFormData.bankIfsc.trim();
      }

      await onUpdateStaff(selectedStaff.id, updates);
      const updatedStaffObj: Staff = { ...selectedStaff, ...updates };
      setSelectedStaff(updatedStaffObj);
      setIsEditingStaff(false);
      setEditSuccessMsg(`Profile for ${updatedStaffObj.fullName} updated successfully!`);
    } finally {
      setIsSavingEdit(false);
    }
  };

  // New staff form state
  const [formData, setFormData] = useState({
    fullName: '',
    role: 'waiter' as UserRole | string,
    department: 'Service' as const,
    phone: '+91 ',
    email: '',
    aadhaarNumber: 'XXXX-XXXX-',
    familyDetails: '',
    currentAddress: '',
    permanentAddress: '',
    dateOfJoining: new Date().toISOString().split('T')[0],
    salaryType: 'monthly' as const,
    baseSalaryPaise: 2500000,
    bankAccountNumber: 'XXXX-XXXX-',
    bankIfsc: 'HDFC0001824',
    bankName: 'HDFC Bank',
    emergencyContactName: '',
    emergencyContactPhone: '',
    assignedShiftId: 'shift-morning',
    photoUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80',
    faceDescriptor: undefined as number[] | undefined,
    // Operator login account creation
    createLoginAccount: true,
    loginUsername: '',
    loginPin: '1234',
  });

  const isAdmin = currentUser.role === 'admin';
  const departments = ['All', 'Management', 'Service', 'Kitchen', 'Inventory / Accounts'];

  const filteredStaff = db.staff.filter((s) => {
    if (selectedDept !== 'All' && s.department !== selectedDept) return false;
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase();
      return (
        s.fullName.toLowerCase().includes(q) ||
        s.employeeCode.toLowerCase().includes(q) ||
        s.role.toLowerCase().includes(q) ||
        s.phone.includes(q)
      );
    }
    return true;
  });

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    await onAddStaff(formData);

    // If admin checked create login account, add new operator with the same name, username, and role
    if (formData.createLoginAccount && onAddUser && formData.fullName.trim()) {
      const generatedUsername = formData.loginUsername.trim()
        ? formData.loginUsername.trim().toLowerCase()
        : formData.fullName.trim().toLowerCase().replace(/[^a-z0-9]/g, '');

      // Normalize role to valid UserRole
      const validRoles: UserRole[] = ['admin', 'manager', 'cashier', 'waiter', 'kitchen', 'staff'];
      const assignedRole: UserRole = validRoles.includes(formData.role as UserRole)
        ? (formData.role as UserRole)
        : 'staff';

      await onAddUser({
        name: formData.fullName.trim(),
        username: generatedUsername,
        role: assignedRole,
        pin: formData.loginPin.trim() || '1234',
      });
    }

    setShowAddModal(false);
    setFormData({
      fullName: '',
      role: 'waiter',
      department: 'Service',
      phone: '+91 ',
      email: '',
      aadhaarNumber: 'XXXX-XXXX-',
      familyDetails: '',
      currentAddress: '',
      permanentAddress: '',
      dateOfJoining: new Date().toISOString().split('T')[0],
      salaryType: 'monthly',
      baseSalaryPaise: 2500000,
      bankAccountNumber: 'XXXX-XXXX-',
      bankIfsc: 'HDFC0001824',
      bankName: 'HDFC Bank',
      emergencyContactName: '',
      emergencyContactPhone: '',
      assignedShiftId: 'shift-morning',
      photoUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80',
      faceDescriptor: undefined,
      createLoginAccount: true,
      loginUsername: '',
      loginPin: '1234',
    });
  };

  const handleFaceModalSave = async (photoUrl: string, descriptor?: number[]) => {
    if (faceModalTarget === 'create') {
      setFormData((prev) => ({
        ...prev,
        photoUrl,
        faceDescriptor: descriptor,
      }));
    } else if (faceModalTarget === 'update' && selectedStaff) {
      await onUpdateStaff(selectedStaff.id, {
        photoUrl,
        faceDescriptor: descriptor,
        hasFaceEnrolled: true,
      });
      setSelectedStaff((prev) =>
        prev ? { ...prev, photoUrl, faceDescriptor: descriptor, hasFaceEnrolled: true } : null
      );
      alert(`Face photo and biometrics updated successfully for ${selectedStaff.fullName}! You can now scan in the Attendance module.`);
    }
  };

  return (
    <div className="p-3.5 sm:p-6 lg:p-8 flex flex-col gap-4 sm:gap-6 max-w-7xl mx-auto">
      {/* 1. Header & Actions */}
      <div className="ios27-glass-card p-5 rounded-[24px] flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold tracking-tight text-slate-900 flex items-center gap-2">
              <span className="material-symbols-outlined text-emerald-600">badge</span>
              Staff Directory &amp; Biometrics
            </h2>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] bg-slate-100 text-slate-700 font-semibold border border-slate-200">
              {db.staff.length} Active Personnel
            </span>
          </div>
          <p className="text-xs mt-1 font-medium text-slate-500">
            {isAdmin ? (
              <span className="text-emerald-700 font-semibold">
                🛡️ Admin Mode: Full access to biometrics enrollment, Aadhaar, and salary details.
              </span>
            ) : (
              <span className="text-amber-800 font-semibold">
                🔒 Non-Admin View: Sensitive financial &amp; Aadhaar fields are protected under DPDP Act.
              </span>
            )}
          </p>
        </div>

        {isAdmin && (
          <button
            onClick={() => setShowAddModal(true)}
            className="ios27-btn-small px-4 py-2 rounded-apple bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-apple-subtle transition-all flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-base">add</span>
            <span className="pl-0.5">Onboard New Staff</span>
          </button>
        )}
      </div>

      {/* 2. Filter & Search Bar */}
      <div className="ios27-glass-card p-3 rounded-[20px] flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-1 bg-black/[0.04] p-1 rounded-apple overflow-x-auto">
          {departments.map((dept) => (
            <button
              key={dept}
              onClick={() => setSelectedDept(dept)}
              className={`px-3 py-1.5 rounded-apple-sm font-semibold whitespace-nowrap transition-all active:scale-[0.97] ${
                selectedDept === dept
                  ? 'bg-[#05271f] text-gold-300 shadow-apple-subtle'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {dept}
            </button>
          ))}
        </div>

        <div className="relative w-72">
          <span className="material-symbols-outlined absolute left-3 top-2.5 text-slate-400 text-sm">search</span>
          <input
            type="text"
            placeholder="Search name, code, role, phone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-9 pl-9 pr-3 text-xs rounded-apple bg-black/[0.04] border border-black/[0.06] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#05271f]/10 font-medium transition-all"
          />
        </div>
      </div>

      {/* 3. Staff Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filteredStaff.map((st) => (
          <div
            key={st.id}
            onClick={() => openStaffProfile(st, false)}
            className="ios27-glass-card-interactive p-5 rounded-[22px] flex flex-col justify-between cursor-pointer group"
          >
            <div className="flex items-start gap-3.5">
              <div className="w-14 h-14 rounded-2xl bg-slate-100 overflow-hidden flex-shrink-0 relative border border-slate-200">
                <img src={st.photoUrl} alt={st.fullName} className="w-full h-full object-cover" />
                {st.hasFaceEnrolled && (
                  <span
                    className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-emerald-500 rounded-full border-2 border-white"
                    title="Biometric Face Enrolled"
                  ></span>
                )}
              </div>
              <div className="flex flex-col min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] text-slate-400 font-bold">{st.employeeCode}</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] bg-slate-100 text-slate-700 font-bold border border-slate-200">
                    {st.department}
                  </span>
                </div>
                <h3 className="text-sm font-bold text-slate-900 group-hover:text-emerald-700 transition-colors truncate mt-0.5">
                  {st.fullName}
                </h3>
                <span className="text-xs text-slate-500 font-medium truncate">{st.role}</span>
                <span className="text-[11px] text-slate-400 mt-1">{st.phone}</span>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5">
                {st.hasFaceEnrolled ? (
                  <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                    <span className="material-symbols-outlined text-[12px]">verified</span>
                    Face Enrolled
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                    <span className="material-symbols-outlined text-[12px]">warning</span>
                    Photo Needed
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openStaffProfile(st, true);
                  }}
                  className="px-2 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[11px] font-bold border border-emerald-200 transition-all flex items-center gap-1"
                  title={`Edit ${st.fullName}`}
                >
                  <span className="material-symbols-outlined text-[14px]">edit</span>
                  Edit
                </button>
                {isAdmin && onDeleteStaff && (
                  <button
                    type="button"
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (confirm(`Are you sure you want to delete staff member "${st.fullName}" (${st.employeeCode})? This action cannot be undone.`)) {
                        await onDeleteStaff(st.id);
                      }
                    }}
                    className="p-1 rounded-lg text-rose-600 hover:bg-rose-50 hover:text-rose-700 font-bold transition-all flex items-center"
                    title={`Delete ${st.fullName}`}
                  >
                    <span className="material-symbols-outlined text-base">delete</span>
                  </button>
                )}
                <span className="text-[11px] text-emerald-600 font-bold group-hover:translate-x-0.5 transition-transform ml-0.5">
                  Profile →
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Staff Details & Edit Drawer */}
      {selectedStaff && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex justify-end">
          <div className="bg-white w-full max-w-lg h-full shadow-2xl flex flex-col justify-between overflow-hidden animate-in slide-in-from-right duration-200">
            {/* Drawer Header */}
            <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-12 h-12 rounded-2xl overflow-hidden border border-slate-300 shrink-0">
                  <img src={selectedStaff.photoUrl} alt="" className="w-full h-full object-cover" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-slate-900 truncate">{selectedStaff.fullName}</h3>
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-slate-200/80 text-slate-700">
                      {selectedStaff.employeeCode}
                    </span>
                  </div>
                  <span className="text-xs text-slate-500 block truncate">
                    {selectedStaff.role} • {selectedStaff.department}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    if (!isEditingStaff) {
                      openStaffProfile(selectedStaff, true);
                    } else {
                      setIsEditingStaff(false);
                    }
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 transition-all border ${
                    isEditingStaff
                      ? 'bg-slate-200 text-slate-700 border-slate-300 hover:bg-slate-300'
                      : 'bg-emerald-600 text-white border-emerald-700 hover:bg-emerald-700 shadow-xs'
                  }`}
                >
                  <span className="material-symbols-outlined text-sm">
                    {isEditingStaff ? 'visibility' : 'edit_square'}
                  </span>
                  {isEditingStaff ? 'View Mode' : 'Edit Staff'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedStaff(null);
                    setIsEditingStaff(false);
                    setEditSuccessMsg('');
                  }}
                  className="w-8 h-8 rounded-lg hover:bg-slate-200 flex items-center justify-center text-slate-500"
                >
                  <span className="material-symbols-outlined text-sm">close</span>
                </button>
              </div>
            </div>

            {isEditingStaff ? (
              /* ─── EDIT STAFF FORM ─── */
              <form onSubmit={handleSaveEditStaff} className="flex-1 min-h-0 flex flex-col justify-between overflow-hidden">
                <div className="p-5 overflow-y-auto space-y-4 text-xs flex-1">
                  <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-xl flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-emerald-700 text-base">edit_note</span>
                      <span className="font-bold text-emerald-950 text-xs">
                        Editing Staff Record ({selectedStaff.employeeCode})
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setFaceModalTarget('update');
                        setFaceModalOpen(true);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] flex items-center gap-1"
                    >
                      <span className="material-symbols-outlined text-xs">add_a_photo</span>
                      Change Photo
                    </button>
                  </div>

                  {/* Section 1: Basic & Role Info */}
                  <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                    <span className="font-bold text-slate-900 block text-[11px] uppercase tracking-wider">
                      Basic &amp; Role Information
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1">
                        <label className="font-bold text-slate-700">Full Name *</label>
                        <input
                          type="text"
                          required
                          value={editFormData.fullName}
                          onChange={(e) => setEditFormData({ ...editFormData, fullName: e.target.value })}
                          className="h-9 px-3 rounded-xl border border-slate-300 bg-white font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="font-bold text-slate-700">Employee Code</label>
                        <input
                          type="text"
                          value={editFormData.employeeCode}
                          onChange={(e) => setEditFormData({ ...editFormData, employeeCode: e.target.value })}
                          className="h-9 px-3 rounded-xl border border-slate-300 bg-white font-mono font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1">
                        <label className="font-bold text-slate-700">Role / Designation *</label>
                        <input
                          type="text"
                          required
                          list="staff-role-suggestions"
                          value={editFormData.role}
                          onChange={(e) => setEditFormData({ ...editFormData, role: e.target.value })}
                          placeholder="e.g. Senior Steward, Executive Chef, waiter..."
                          className="h-9 px-3 rounded-xl border border-slate-300 bg-white font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                        />
                        <datalist id="staff-role-suggestions">
                          <option value="admin">Admin (Executive Owner)</option>
                          <option value="manager">Manager (General Manager)</option>
                          <option value="cashier">Cashier (Billing &amp; Cashier)</option>
                          <option value="waiter">Waiter (Floor Steward / Waiter)</option>
                          <option value="kitchen">Kitchen (Kitchen Station KDS)</option>
                          <option value="staff">Staff (Staff Member)</option>
                          <option value="Restaurant Manager" />
                          <option value="Executive Chef" />
                          <option value="Sous Chef" />
                          <option value="Senior Steward" />
                          <option value="Head Cashier" />
                          <option value="Storekeeper" />
                        </datalist>
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="font-bold text-slate-700">Department *</label>
                        <select
                          value={editFormData.department}
                          onChange={(e) => setEditFormData({ ...editFormData, department: e.target.value as Staff['department'] })}
                          className="h-9 px-3 rounded-xl border border-slate-300 bg-white font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                        >
                          <option value="Service">Service</option>
                          <option value="Kitchen">Kitchen</option>
                          <option value="Management">Management</option>
                          <option value="Inventory / Accounts">Inventory / Accounts</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="flex flex-col gap-1">
                        <label className="font-bold text-slate-700">Assigned Shift</label>
                        <select
                          value={editFormData.assignedShiftId}
                          onChange={(e) => setEditFormData({ ...editFormData, assignedShiftId: e.target.value })}
                          className="h-9 px-3 rounded-xl border border-slate-300 bg-white font-medium text-slate-900"
                        >
                          {(db.shifts && db.shifts.length > 0 ? db.shifts : DEFAULT_SHIFTS).map((sh) => (
                            <option key={sh.id} value={sh.id}>
                              {sh.name} ({sh.startTime}-{sh.endTime})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="font-bold text-slate-700">Joined Date</label>
                        <input
                          type="date"
                          value={editFormData.dateOfJoining}
                          onChange={(e) => setEditFormData({ ...editFormData, dateOfJoining: e.target.value })}
                          className="h-9 px-3 rounded-xl border border-slate-300 bg-white font-medium text-slate-900"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="font-bold text-slate-700">Employment Status</label>
                        <select
                          value={editFormData.isActive ? 'active' : 'inactive'}
                          onChange={(e) => setEditFormData({ ...editFormData, isActive: e.target.value === 'active' })}
                          className="h-9 px-3 rounded-xl border border-slate-300 bg-white font-bold text-slate-900"
                        >
                          <option value="active">Active Duty</option>
                          <option value="inactive">Inactive / On Hold</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Section 2: Contact & Emergency Details */}
                  <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                    <span className="font-bold text-slate-900 block text-[11px] uppercase tracking-wider">
                      Contact &amp; Emergency Details
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1">
                        <label className="font-bold text-slate-700">Phone Number *</label>
                        <input
                          type="text"
                          required
                          value={editFormData.phone}
                          onChange={(e) => setEditFormData({ ...editFormData, phone: e.target.value })}
                          className="h-9 px-3 rounded-xl border border-slate-300 bg-white font-semibold text-slate-900"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="font-bold text-slate-700">Email Address</label>
                        <input
                          type="email"
                          value={editFormData.email}
                          onChange={(e) => setEditFormData({ ...editFormData, email: e.target.value })}
                          className="h-9 px-3 rounded-xl border border-slate-300 bg-white text-slate-900"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1">
                        <label className="font-bold text-slate-700">Emergency Contact Name</label>
                        <input
                          type="text"
                          value={editFormData.emergencyContactName}
                          onChange={(e) => setEditFormData({ ...editFormData, emergencyContactName: e.target.value })}
                          className="h-9 px-3 rounded-xl border border-slate-300 bg-white text-slate-900"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="font-bold text-slate-700">Emergency Contact Phone</label>
                        <input
                          type="text"
                          value={editFormData.emergencyContactPhone}
                          onChange={(e) => setEditFormData({ ...editFormData, emergencyContactPhone: e.target.value })}
                          className="h-9 px-3 rounded-xl border border-slate-300 bg-white text-slate-900"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Section 3: Protected Sensitive Records (Admin Only) */}
                  {isAdmin ? (
                    <div className="p-3.5 bg-emerald-50/60 rounded-xl border border-emerald-200 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900 text-[11px] uppercase tracking-wider flex items-center gap-1">
                          <span className="material-symbols-outlined text-xs text-emerald-700">lock_open</span>
                          Payroll, Bank &amp; UIDAI Records (Admin)
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="flex flex-col gap-1">
                          <label className="font-bold text-slate-700">Aadhaar UIDAI</label>
                          <input
                            type="text"
                            value={editFormData.aadhaarNumber}
                            onChange={(e) => setEditFormData({ ...editFormData, aadhaarNumber: e.target.value })}
                            className="h-9 px-3 rounded-xl border border-slate-300 bg-white font-mono text-slate-900"
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="font-bold text-slate-700">Salary Type</label>
                          <select
                            value={editFormData.salaryType}
                            onChange={(e) => setEditFormData({ ...editFormData, salaryType: e.target.value as 'monthly' | 'daily' })}
                            className="h-9 px-3 rounded-xl border border-slate-300 bg-white font-medium text-slate-900"
                          >
                            <option value="monthly">Monthly</option>
                            <option value="daily">Daily Wage</option>
                          </select>
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="font-bold text-slate-700">Base Salary (₹)</label>
                          <input
                            type="number"
                            value={editFormData.baseSalaryPaise / 100}
                            onChange={(e) => setEditFormData({ ...editFormData, baseSalaryPaise: Number(e.target.value) * 100 })}
                            className="h-9 px-3 rounded-xl border border-slate-300 bg-white font-extrabold text-emerald-800"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="flex flex-col gap-1">
                          <label className="font-bold text-slate-700">Bank Name</label>
                          <input
                            type="text"
                            value={editFormData.bankName}
                            onChange={(e) => setEditFormData({ ...editFormData, bankName: e.target.value })}
                            className="h-9 px-3 rounded-xl border border-slate-300 bg-white text-slate-900"
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="font-bold text-slate-700">Account Number</label>
                          <input
                            type="text"
                            value={editFormData.bankAccountNumber}
                            onChange={(e) => setEditFormData({ ...editFormData, bankAccountNumber: e.target.value })}
                            className="h-9 px-3 rounded-xl border border-slate-300 bg-white font-mono text-slate-900"
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="font-bold text-slate-700">IFSC Code</label>
                          <input
                            type="text"
                            value={editFormData.bankIfsc}
                            onChange={(e) => setEditFormData({ ...editFormData, bankIfsc: e.target.value })}
                            className="h-9 px-3 rounded-xl border border-slate-300 bg-white font-mono uppercase text-slate-900"
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="p-3 bg-slate-100 rounded-xl border border-slate-200 text-slate-500 text-[11px] flex items-center gap-2">
                      <span className="material-symbols-outlined text-sm">lock</span>
                      Aadhaar, Bank, and Base Salary fields can only be modified by an Administrator.
                    </div>
                  )}

                  {/* Section 4: Address & Family Details */}
                  <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                    <span className="font-bold text-slate-900 block text-[11px] uppercase tracking-wider">
                      Address &amp; Family Details
                    </span>
                    <div className="flex flex-col gap-1">
                      <label className="font-bold text-slate-700">Current Address</label>
                      <input
                        type="text"
                        value={editFormData.currentAddress}
                        onChange={(e) => setEditFormData({ ...editFormData, currentAddress: e.target.value })}
                        className="h-9 px-3 rounded-xl border border-slate-300 bg-white text-slate-900"
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1">
                        <label className="font-bold text-slate-700">Permanent Address</label>
                        <input
                          type="text"
                          value={editFormData.permanentAddress}
                          onChange={(e) => setEditFormData({ ...editFormData, permanentAddress: e.target.value })}
                          className="h-9 px-3 rounded-xl border border-slate-300 bg-white text-slate-900"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="font-bold text-slate-700">Family Details</label>
                        <input
                          type="text"
                          value={editFormData.familyDetails}
                          onChange={(e) => setEditFormData({ ...editFormData, familyDetails: e.target.value })}
                          className="h-9 px-3 rounded-xl border border-slate-300 bg-white text-slate-900"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Edit Form Footer */}
                <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
                  <button
                    type="button"
                    onClick={() => setIsEditingStaff(false)}
                    className="px-4 py-2 rounded-xl bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold border border-slate-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingEdit}
                    className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold shadow-sm flex items-center gap-1.5 transition-all"
                  >
                    <span className="material-symbols-outlined text-sm">save</span>
                    {isSavingEdit ? 'Saving Changes...' : 'Save Staff Changes'}
                  </button>
                </div>
              </form>
            ) : (
              /* ─── VIEW STAFF DETAILS MODE ─── */
              <>
                <div className="p-5 overflow-y-auto space-y-4 text-xs flex-1">
                  {editSuccessMsg && (
                    <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-emerald-600 text-base">check_circle</span>
                        <span>{editSuccessMsg}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setEditSuccessMsg('')}
                        className="text-emerald-600 hover:text-emerald-800"
                      >
                        <span className="material-symbols-outlined text-sm">close</span>
                      </button>
                    </div>
                  )}

                  {/* Biometrics Enrolment Section */}
                  <div className="p-3.5 bg-gradient-to-r from-emerald-50 to-teal-50 rounded-xl space-y-2.5 border border-emerald-200">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900 text-[11px] uppercase tracking-wider flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-sm text-emerald-700">face</span>
                        Biometric Face ID
                      </span>
                      <span
                        className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                          selectedStaff.hasFaceEnrolled
                            ? 'bg-emerald-600 text-white'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {selectedStaff.hasFaceEnrolled ? '✓ Enrolled for FRS' : 'Pending Enrollment'}
                      </span>
                    </div>

                    <p className="text-[11px] text-slate-600">
                      {selectedStaff.hasFaceEnrolled
                        ? 'Staff face vector is active. They can look at the Attendance camera to check in.'
                        : 'No biometric vector found. Use webcam or upload a photo to enroll this staff member.'}
                    </p>

                    <button
                      type="button"
                      onClick={() => {
                        setFaceModalTarget('update');
                        setFaceModalOpen(true);
                      }}
                      className="w-full py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs shadow-sm transition-all flex items-center justify-center gap-1.5"
                    >
                      <span className="material-symbols-outlined text-sm">add_a_photo</span>
                      <span>Update Photo / Enroll Face</span>
                    </button>
                  </div>

                  <div className="p-3 bg-slate-50 rounded-xl space-y-1.5 border border-slate-200">
                    <span className="font-bold text-slate-900 block text-[11px] uppercase tracking-wider">
                      Contact Information
                    </span>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Phone:</span>
                      <span className="font-bold text-slate-900">{selectedStaff.phone}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Email:</span>
                      <span className="font-medium text-slate-900">{selectedStaff.email}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Emergency Contact:</span>
                      <span className="font-medium text-slate-900">
                        {selectedStaff.emergencyContactName} ({selectedStaff.emergencyContactPhone})
                      </span>
                    </div>
                  </div>

                  {/* Protected sensitive fields */}
                  <div
                    className={`p-3.5 rounded-xl space-y-2 border ${
                      isAdmin ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900 text-[11px] uppercase tracking-wider flex items-center gap-1">
                        <span className="material-symbols-outlined text-xs text-emerald-700">lock</span>
                        Protected Sensitive Records (DPDP Act)
                      </span>
                      <span className="text-[10px] text-slate-500 font-semibold">
                        {isAdmin ? 'Decrypted (Admin Access)' : 'Encrypted & Restricted'}
                      </span>
                    </div>

                    <div className="flex justify-between pt-1">
                      <span className="text-slate-500">Aadhaar UIDAI:</span>
                      <span className="font-mono font-bold text-slate-900">
                        {isAdmin ? selectedStaff.aadhaarNumber : '•••• •••• •••• [Protected]'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Bank Account:</span>
                      <span className="font-mono font-bold text-slate-900">
                        {isAdmin
                          ? `${selectedStaff.bankName} - ${selectedStaff.bankAccountNumber} (${selectedStaff.bankIfsc})`
                          : '•••• •••• [Protected]'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Base Salary:</span>
                      <span className="font-extrabold text-emerald-700">
                        {isAdmin
                          ? `₹${(selectedStaff.baseSalaryPaise / 100).toLocaleString('en-IN')} / ${selectedStaff.salaryType}`
                          : '•••••• [Protected]'}
                      </span>
                    </div>
                  </div>

                  {/* System Login Account Status / Creation */}
                  {isAdmin && (
                    <div className="p-3 bg-slate-50 rounded-xl space-y-2 border border-slate-200">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900 block text-[11px] uppercase tracking-wider flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-sm text-emerald-700">key</span>
                          System Login &amp; Role Access
                        </span>
                        {(() => {
                          const existingUser = db.users.find(
                            (u) =>
                              u.name.toLowerCase() === selectedStaff.fullName.toLowerCase() ||
                              u.username.toLowerCase() === selectedStaff.employeeCode.toLowerCase()
                          );
                          return existingUser ? (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                              Active Login: @{existingUser.username} ({existingUser.role})
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700">
                              No Login Account
                            </span>
                          );
                        })()}
                      </div>

                      {(() => {
                        const existingUser = db.users.find(
                          (u) =>
                            u.name.toLowerCase() === selectedStaff.fullName.toLowerCase() ||
                            u.username.toLowerCase() === selectedStaff.employeeCode.toLowerCase()
                        );
                        if (existingUser) {
                          return (
                            <div className="text-[11px] text-slate-600 space-y-1">
                              <div className="flex justify-between">
                                <span>Username:</span>
                                <span className="font-mono font-bold text-slate-800">@{existingUser.username}</span>
                              </div>
                              <div className="flex justify-between">
                                <span>Assigned Role:</span>
                                <span className="font-semibold text-slate-800 uppercase text-[10px]">{existingUser.role}</span>
                              </div>
                              <div className="flex justify-between">
                                <span>Security PIN:</span>
                                <span className="font-mono font-bold text-slate-800">{existingUser.pin || '1234'}</span>
                              </div>
                            </div>
                          );
                        }
                        return (
                          <div className="space-y-2">
                            <p className="text-[11px] text-slate-600">
                              This staff member has no system login yet. Admin can generate one below.
                            </p>
                            <button
                              type="button"
                              onClick={async () => {
                                if (!onAddUser) return;
                                const defaultUsername = selectedStaff.employeeCode.toLowerCase().replace(/[^a-z0-9]/g, '');
                                const validRoles: UserRole[] = ['admin', 'manager', 'cashier', 'waiter', 'kitchen', 'staff'];
                                const roleSuggestion = validRoles.find(r => selectedStaff.role.toLowerCase().includes(r)) || 'staff';
                                const enteredUsername = prompt(`Enter login username for ${selectedStaff.fullName}:`, defaultUsername);
                                if (!enteredUsername) return;
                                const enteredPin = prompt('Enter 4-digit PIN / Password:', '1234') || '1234';
                                await onAddUser({
                                  name: selectedStaff.fullName,
                                  username: enteredUsername.trim().toLowerCase(),
                                  role: roleSuggestion,
                                  pin: enteredPin.trim(),
                                });
                                alert(`Login account @${enteredUsername.trim().toLowerCase()} created successfully!`);
                              }}
                              className="w-full py-1.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                            >
                              <span className="material-symbols-outlined text-sm">person_add</span>
                              <span>Create Login Account for {selectedStaff.fullName}</span>
                            </button>
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  <div className="p-3 bg-slate-50 rounded-xl space-y-1.5 border border-slate-200">
                    <span className="font-bold text-slate-900 block text-[11px] uppercase tracking-wider">
                      Employment Details
                    </span>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Status:</span>
                      <span className={`font-bold ${selectedStaff.isActive !== false ? 'text-emerald-700' : 'text-amber-700'}`}>
                        {selectedStaff.isActive !== false ? 'Active Duty' : 'Inactive / On Hold'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Joined Date:</span>
                      <span className="font-medium text-slate-900">{selectedStaff.dateOfJoining}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Current Address:</span>
                      <span className="font-medium text-slate-900 text-right">{selectedStaff.currentAddress}</span>
                    </div>
                    {selectedStaff.permanentAddress && (
                      <div className="flex justify-between">
                        <span className="text-slate-500">Permanent Address:</span>
                        <span className="font-medium text-slate-900 text-right">{selectedStaff.permanentAddress}</span>
                      </div>
                    )}
                    {selectedStaff.familyDetails && (
                      <div className="flex justify-between">
                        <span className="text-slate-500">Family Details:</span>
                        <span className="font-medium text-slate-900 text-right">{selectedStaff.familyDetails}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-2 shrink-0">
                  {isAdmin && onDeleteStaff ? (
                    <button
                      type="button"
                      onClick={async () => {
                        if (confirm(`Are you sure you want to permanently delete staff member "${selectedStaff.fullName}" (${selectedStaff.employeeCode})? This action cannot be undone.`)) {
                          const staffId = selectedStaff.id;
                          setSelectedStaff(null);
                          await onDeleteStaff(staffId);
                        }
                      }}
                      className="px-3.5 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold border border-rose-200 flex items-center gap-1.5 transition-colors"
                    >
                      <span className="material-symbols-outlined text-sm">delete</span>
                      Delete
                    </button>
                  ) : <div />}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openStaffProfile(selectedStaff, true)}
                      className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs transition-all"
                    >
                      <span className="material-symbols-outlined text-sm">edit</span>
                      Edit Profile
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedStaff(null);
                        setIsEditingStaff(false);
                        setEditSuccessMsg('');
                      }}
                      className="px-4 py-2 rounded-xl bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold border border-slate-200"
                    >
                      Close
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Onboarding Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white max-w-lg w-full rounded-2xl shadow-2xl border border-slate-200 overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-emerald-600">person_add</span>
                Onboard New Staff Member
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="w-7 h-7 rounded hover:bg-slate-200 flex items-center justify-center text-slate-500"
              >
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            </div>

            <form onSubmit={handleCreateStaff} className="p-5 overflow-y-auto space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="font-bold text-slate-700">Full Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Ramesh Kumar"
                    value={formData.fullName}
                    onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                    className="h-9 px-3 rounded-xl border border-slate-300 bg-slate-50"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="font-bold text-slate-700">Assigned System Role *</label>
                  <select
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                    className="h-9 px-3 rounded-xl border border-slate-300 bg-slate-50 font-medium text-slate-900"
                  >
                    <option value="admin">Admin (Executive Owner)</option>
                    <option value="manager">Manager (General Manager)</option>
                    <option value="cashier">Cashier (Billing &amp; Cashier)</option>
                    <option value="waiter">Waiter (Floor Steward / Waiter)</option>
                    <option value="kitchen">Kitchen (Kitchen Station KDS)</option>
                    <option value="staff">Staff (Staff Member / Biometrics)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="font-bold text-slate-700">Department</label>
                  <select
                    value={formData.department}
                    onChange={(e) => setFormData({ ...formData, department: e.target.value as any })}
                    className="h-9 px-3 rounded-xl border border-slate-300 bg-slate-50"
                  >
                    <option value="Service">Service</option>
                    <option value="Kitchen">Kitchen</option>
                    <option value="Management">Management</option>
                    <option value="Inventory / Accounts">Inventory / Accounts</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="font-bold text-slate-700">Assigned Shift *</label>
                  <select
                    value={formData.assignedShiftId}
                    onChange={(e) => setFormData({ ...formData, assignedShiftId: e.target.value })}
                    className="h-9 px-3 rounded-xl border border-slate-300 bg-slate-50 font-medium text-slate-900"
                  >
                    {(db.shifts && db.shifts.length > 0 ? db.shifts : DEFAULT_SHIFTS).map((sh) => (
                      <option key={sh.id} value={sh.id}>
                        {sh.name} ({sh.startTime} - {sh.endTime})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="font-bold text-slate-700">Phone Number *</label>
                  <input
                    type="text"
                    required
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="h-9 px-3 rounded-xl border border-slate-300 bg-slate-50"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="font-bold text-slate-700">Official Email</label>
                  <input
                    type="email"
                    placeholder="staff@hotel.com"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="h-9 px-3 rounded-xl border border-slate-300 bg-slate-50"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="font-bold text-slate-700">Aadhaar (Protected) *</label>
                  <input
                    type="text"
                    required
                    placeholder="XXXX-XXXX-1234"
                    value={formData.aadhaarNumber}
                    onChange={(e) => setFormData({ ...formData, aadhaarNumber: e.target.value })}
                    className="h-9 px-3 rounded-xl border border-slate-300 bg-slate-50 font-mono"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="font-bold text-slate-700">Base Salary (₹ / month) *</label>
                  <input
                    type="number"
                    required
                    value={formData.baseSalaryPaise / 100}
                    onChange={(e) => setFormData({ ...formData, baseSalaryPaise: Number(e.target.value) * 100 })}
                    className="h-9 px-3 rounded-xl border border-slate-300 bg-slate-50 font-bold"
                  />
                </div>
              </div>

              {/* Biometrics & Photo Enrollment in Add Staff */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-slate-800 flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-sm text-emerald-600">face</span>
                    <span>Face Photo &amp; Biometrics</span>
                  </label>
                  {formData.faceDescriptor ? (
                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                      ✓ Biometrics Enrolled
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                      Pending Face Capture
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <img
                    src={formData.photoUrl}
                    alt="Preview"
                    className="w-12 h-12 rounded-xl object-cover border border-slate-300 shrink-0"
                  />
                  <div className="flex-1 flex flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setFaceModalTarget('create');
                        setFaceModalOpen(true);
                      }}
                      className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center justify-center gap-1.5 shadow-sm text-xs"
                    >
                      <span className="material-symbols-outlined text-sm">photo_camera</span>
                      <span>Capture / Upload Face Photo</span>
                    </button>
                    <span className="text-[10px] text-slate-500">
                      Take webcam photo or upload file to generate 128-d AI vector.
                    </span>
                  </div>
                </div>
              </div>

              {/* Operator Account & Login Provisioning */}
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-slate-800 flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.createLoginAccount}
                      onChange={(e) => setFormData({ ...formData, createLoginAccount: e.target.checked })}
                      className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 border-slate-300"
                    />
                    <span className="material-symbols-outlined text-sm text-emerald-600">badge</span>
                    <span>Provision System Operator Login</span>
                  </label>
                  <span className="text-[10px] text-slate-500 font-medium">Synced with Settings &gt; Users</span>
                </div>

                {formData.createLoginAccount && (
                  <div className="grid grid-cols-2 gap-3 pt-1 border-t border-slate-200">
                    <div className="flex flex-col gap-1">
                      <label className="font-bold text-slate-700">Login Username</label>
                      <input
                        type="text"
                        placeholder={formData.fullName ? formData.fullName.toLowerCase().replace(/[^a-z0-9]/g, '') : 'e.g. ramesh'}
                        value={formData.loginUsername}
                        onChange={(e) => setFormData({ ...formData, loginUsername: e.target.value })}
                        className="h-8 px-2.5 rounded-lg border border-slate-300 bg-white font-mono text-xs"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="font-bold text-slate-700">4-Digit Security PIN</label>
                      <input
                        type="text"
                        maxLength={6}
                        placeholder="1234"
                        value={formData.loginPin}
                        onChange={(e) => setFormData({ ...formData, loginPin: e.target.value })}
                        className="h-8 px-2.5 rounded-lg border border-slate-300 bg-white font-mono font-bold text-xs"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3 py-1.5 rounded-xl hover:bg-slate-100 font-semibold text-slate-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-bold"
                >
                  Confirm &amp; Enrol Staff
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reusable Biometric Capture Modal */}
      <FaceCaptureModal
        isOpen={faceModalOpen}
        onClose={() => setFaceModalOpen(false)}
        staffName={faceModalTarget === 'create' ? formData.fullName : selectedStaff?.fullName || ''}
        currentPhotoUrl={faceModalTarget === 'create' ? formData.photoUrl : selectedStaff?.photoUrl}
        onSave={handleFaceModalSave}
      />
    </div>
  );
};
