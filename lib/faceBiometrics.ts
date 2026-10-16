import type * as FaceApiType from 'face-api.js';

let faceApiInstance: typeof FaceApiType | null = null;
let modelsPromise: Promise<boolean> | null = null;

/**
 * Loads face-api.js and neural network models once (Singleton Promise).
 * Loads SSD MobileNet V1, Tiny Face Detector, Landmark Net, and Face Recognition Net.
 */
export async function loadBiometricModels(): Promise<typeof FaceApiType> {
  if (typeof window === 'undefined') {
    throw new Error('Face recognition can only run client-side in the browser.');
  }

  if (faceApiInstance && modelsPromise) {
    await modelsPromise;
    return faceApiInstance;
  }

  const faceapi = await import('face-api.js');
  faceApiInstance = faceapi;

  modelsPromise = (async () => {
    const MODEL_URL = '/models';
    try {
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
        faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
      ]);
      return true;
    } catch (err) {
      console.warn('Full model load warning, trying tiny models fallback:', err);
      // Fallback: at least tiny detector, landmark and recognition
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ]);
      return true;
    }
  })();

  await modelsPromise;
  return faceapi;
}

export interface FaceExtractionResult {
  success: boolean;
  descriptor?: number[];
  confidence?: number;
  reason?: string;
  box?: { x: number; y: number; width: number; height: number };
}

/**
 * Extract 128-d face descriptor from an HTMLImageElement, HTMLVideoElement, or HTMLCanvasElement.
 */
export async function extractFaceDescriptor(
  input: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement
): Promise<FaceExtractionResult> {
  try {
    const faceapi = await loadBiometricModels();

    // First attempt: SSD MobileNet (highest accuracy for enrolment photos)
    let detection: any = null;
    try {
      detection = await faceapi
        .detectSingleFace(input, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.45 }))
        .withFaceLandmarks()
        .withFaceDescriptor();
    } catch {
      // Fallback to TinyFaceDetector
    }

    if (!detection) {
      // Second attempt: TinyFaceDetector
      detection = await faceapi
        .detectSingleFace(input, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.35 }))
        .withFaceLandmarks(true)
        .withFaceDescriptor();
    }

    if (!detection) {
      return {
        success: false,
        reason: 'No face detected. Please ensure your face is clearly visible, well-lit, and facing the camera.',
      };
    }

    const confidence = Math.round(detection.detection.score * 100);
    const box = {
      x: Math.round(detection.detection.box.x),
      y: Math.round(detection.detection.box.y),
      width: Math.round(detection.detection.box.width),
      height: Math.round(detection.detection.box.height),
    };

    return {
      success: true,
      descriptor: Array.from(detection.descriptor),
      confidence,
      box,
    };
  } catch (err: any) {
    return {
      success: false,
      reason: `Biometric extraction error: ${err.message || 'Unknown error'}`,
    };
  }
}

/**
 * Extract face descriptor from an image URL or base64 data URL.
 */
export async function extractFaceDescriptorFromUrl(url: string): Promise<FaceExtractionResult> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = async () => {
      try {
        const result = await extractFaceDescriptor(img);
        resolve(result);
      } catch (e: any) {
        resolve({ success: false, reason: e.message });
      }
    };
    img.onerror = () => {
      resolve({
        success: false,
        reason: 'Could not load image source (network or CORS limitation).',
      });
    };
    img.src = url;
  });
}

/**
 * Euclidean distance calculation between two 128-d face descriptors.
 * Lower distance = closer match.
 * Typically:
 * < 0.50 : Extreme high-confidence identity match (same person)
 * 0.50 - 0.58 : High-confidence identity match (same person with different light/angle)
 * > 0.60 : Different persons
 */
export function computeEuclideanDistance(desc1: number[] | Float32Array, desc2: number[] | Float32Array): number {
  if (desc1.length !== desc2.length) return 1.0;
  let sum = 0;
  for (let i = 0; i < desc1.length; i++) {
    const diff = desc1[i] - desc2[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

/**
 * Generates a normalized 128-d vector deterministically from a seed string (e.g. employee code).
 * Used as fallback biometric enrollment when raw photo embeddings are not yet extracted.
 */
export function generateDeterministicFaceDescriptor(seed: string): number[] {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const vec: number[] = [];
  let norm = 0;
  for (let i = 0; i < 128; i++) {
    h = Math.imul(h ^ (i * 0x5bd1e995), 0x01000193);
    const val = ((h & 0xffff) / 0x8000) - 1;
    vec.push(val);
    norm += val * val;
  }
  norm = Math.sqrt(norm) || 1;
  return vec.map((v) => Number((v / norm).toFixed(6)));
}
