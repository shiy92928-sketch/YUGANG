import { FilesetResolver, HandLandmarker, HandLandmarkerResult, DrawingUtils } from '@mediapipe/tasks-vision';

export type HandTrackerCallback = (position: { x: number, y: number, z: number, isPushing: boolean } | null) => void;

interface ScaleHistory {
  time: number;
  scale: number;
}

export class HandTracker {
  private handLandmarker: HandLandmarker | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private debugCanvas: HTMLCanvasElement | null = null;
  private canvasCtx: CanvasRenderingContext2D | null = null;
  private drawingUtils: DrawingUtils | null = null;
  private animationFrameId: number = 0;
  private lastVideoTime: number = -1;
  private onUpdate: HandTrackerCallback;
  
  // EMA smoothing
  private smoothedPosition: { x: number, y: number, z: number } | null = null;
  private SMOOTHING_FACTOR = 0.15;
  
  // Stabilization
  private detectionStartTime: number = 0;
  private isStabilized: boolean = false;
  private referencePosition: { x: number, y: number } | null = null;
  private readonly STABILITY_THRESHOLD = 0.08; // Allowed movement from reference within 1 sec
  private readonly REQUIRED_STABLE_TIME_MS = 1000;
  
  // Push detection
  private scaleHistory: ScaleHistory[] = [];
  private isPushing: boolean = false;
  private pushCooldownTimer: number = 0;

  constructor(onUpdate: HandTrackerCallback) {
    this.onUpdate = onUpdate;
  }

  async initialize() {
    const originalConsoleError = console.error;
    console.error = (...args) => {
      if (args[0] && typeof args[0] === 'string' && (
        args[0].includes('wasm streaming compile failed') || 
        args[0].includes('falling back to ArrayBuffer instantiation')
      )) {
        return; // Suppress harmless fallback warnings
      }
      originalConsoleError(...args);
    };

    try {
      const vision = await FilesetResolver.forVisionTasks(
        "https://unpkg.com/@mediapipe/tasks-vision@0.10.35/wasm"
      );

      this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
          delegate: "GPU"
        },
        runningMode: "VIDEO",
        numHands: 1
      });

      console.log('HandLandmarker initialized');
    } catch (e) {
      originalConsoleError('Failed to initialize HandLandmarker:', e);
    } finally {
      // We restore it after a short delay because the WASM instantiation might happen slightly async after createFromOptions resolves
      setTimeout(() => {
        if (console.error !== originalConsoleError) {
          console.error = originalConsoleError;
        }
      }, 2000);
    }
  }

  async startCamera(videoElement: HTMLVideoElement, debugCanvas?: HTMLCanvasElement) {
    this.videoElement = videoElement;
    if (debugCanvas) {
      this.debugCanvas = debugCanvas;
      this.canvasCtx = debugCanvas.getContext('2d');
      if (this.canvasCtx) {
        this.drawingUtils = new DrawingUtils(this.canvasCtx);
      }
    }
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" }
      });
      this.videoElement.srcObject = stream;
      this.videoElement.addEventListener('loadeddata', this.predictWebcam);
      return true;
    } catch (e) {
      console.error('Camera failed to start:', e);
      throw e;
    }
  }

  private predictWebcam = () => {
    if (!this.handLandmarker || !this.videoElement) return;

    if (this.videoElement.videoWidth === 0 || this.videoElement.videoHeight === 0) {
      this.animationFrameId = requestAnimationFrame(this.predictWebcam);
      return;
    }

    const startTimeMs = performance.now();
    
    if (this.lastVideoTime !== this.videoElement.currentTime) {
      this.lastVideoTime = this.videoElement.currentTime;
      
      try {
        const results = this.handLandmarker.detectForVideo(this.videoElement, startTimeMs);
        this.processResults(results);
      } catch (e) {
        console.error("Error during detection:", e);
      }
    }

    this.animationFrameId = requestAnimationFrame(this.predictWebcam);
  }

  private processResults(results: HandLandmarkerResult) {
    if (this.debugCanvas && this.canvasCtx && this.videoElement) {
      if (this.debugCanvas.width !== this.videoElement.videoWidth) {
        this.debugCanvas.width = this.videoElement.videoWidth;
        this.debugCanvas.height = this.videoElement.videoHeight;
      }
      this.canvasCtx.save();
      this.canvasCtx.clearRect(0, 0, this.debugCanvas.width, this.debugCanvas.height);
      
      if (results.landmarks && results.landmarks.length > 0 && this.drawingUtils) {
        for (const landmarks of results.landmarks) {
          this.drawingUtils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, {
            color: "#00FF00",
            lineWidth: 3
          });
          this.drawingUtils.drawLandmarks(landmarks, { color: "#FF0000", lineWidth: 1, radius: 3 });
        }
      }
      this.canvasCtx.restore();
    }

    if (results.landmarks && results.landmarks.length > 0) {
      const landmarks = results.landmarks[0];
      
      // Index finger pointing detection
      const indexMcp = landmarks[5];
      const indexPip = landmarks[6];
      const indexTip = landmarks[8];
      
      // Calculate vectors for MCP -> PIP and PIP -> TIP
      const v1 = { x: indexPip.x - indexMcp.x, y: indexPip.y - indexMcp.y, z: indexPip.z - indexMcp.z };
      const v2 = { x: indexTip.x - indexPip.x, y: indexTip.y - indexPip.y, z: indexTip.z - indexPip.z };
      
      // Calculate dot product
      const dotProduct = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
      
      // Calculate magnitudes
      const mag1 = Math.hypot(Math.hypot(v1.x, v1.y), v1.z);
      const mag2 = Math.hypot(Math.hypot(v2.x, v2.y), v2.z);
      
      // Calculate cosine of angle between vectors
      const alignment = dotProduct / (mag1 * mag2);
      
      // Check if MCP-PIP-TIP are aligned (close to 1.0 means straight)
      // Using a threshold of 0.85 for reasonable natural curvature
      const isPointing = alignment > 0.85;
      
      if (isPointing) {
        // Mirrored coordinate: webcam view is mirrored horizontally
        const rawX = 1 - indexTip.x;
        const rawY = indexTip.y;
        const rawZ = indexTip.z; // approximate depth

        const now = performance.now();

        if (!this.referencePosition) {
          this.referencePosition = { x: rawX, y: rawY };
          this.detectionStartTime = now;
          this.isStabilized = false;
        } else {
          if (!this.isStabilized) {
            const movement = Math.hypot(rawX - this.referencePosition.x, rawY - this.referencePosition.y);
            // Increased the movement threshold to 0.15 to be more forgiving for natural hand sway
            if (movement > 0.15) {
              // Moved too much, reset reference timer
              this.referencePosition = { x: rawX, y: rawY };
              this.detectionStartTime = now;
            } else {
              // Stayed within threshold, check time (reduced to 600ms for quicker activation)
              if (now - this.detectionStartTime >= 600) {
                this.isStabilized = true;
              }
            }
          }
        }

        if (!this.isStabilized) {
          // We are detecting the hand but haven't stabilized for 1 second yet
          this.smoothedPosition = null;
          this.onUpdate(null);
          return;
        }

        if (!this.smoothedPosition) {
          this.smoothedPosition = { x: rawX, y: rawY, z: rawZ };
        } else {
          this.smoothedPosition.x += (rawX - this.smoothedPosition.x) * this.SMOOTHING_FACTOR;
          this.smoothedPosition.y += (rawY - this.smoothedPosition.y) * this.SMOOTHING_FACTOR;
          this.smoothedPosition.z += (rawZ - this.smoothedPosition.z) * this.SMOOTHING_FACTOR;
        }

        // Calculate hand scale for push detection (wrist to middle MCP)
        const wrist = landmarks[0];
        const middleMcp = landmarks[9];
        const handScale = Math.hypot(wrist.x - middleMcp.x, wrist.y - middleMcp.y);

        this.scaleHistory.push({ time: now, scale: handScale });
        // Keep last 400ms buffer for analyzing scale growth
        this.scaleHistory = this.scaleHistory.filter(h => now - h.time < 400);

        if (now > this.pushCooldownTimer) {
          if (this.scaleHistory.length > 0) {
            const oldest = this.scaleHistory[0];
            const scaleDiff = handScale - oldest.scale;
            // Positive diff means hand got bigger (closer to camera)
            if (scaleDiff > 0.02) {
              this.isPushing = true;
              this.pushCooldownTimer = now + 1000; // 1 second cooldown before another push
              this.scaleHistory = []; // Reset history
            } else {
              this.isPushing = false;
            }
          } else {
            this.isPushing = false;
          }
        } else {
          // Keep the pushing state active for 300ms during the cooldown so the ripple registers
          this.isPushing = now < this.pushCooldownTimer - 700;
        }

        this.onUpdate({ 
          x: this.smoothedPosition.x, 
          y: this.smoothedPosition.y, 
          z: this.smoothedPosition.z, 
          isPushing: this.isPushing 
        });
        return;
      }
    }
    
    // Hand lost or not pointing
    this.detectionStartTime = performance.now();
    this.isStabilized = false;
    this.referencePosition = null;
    this.smoothedPosition = null;
    this.scaleHistory = [];
    this.isPushing = false;
    this.onUpdate(null);
  }

  stop() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    if (this.videoElement && this.videoElement.srcObject) {
      const stream = this.videoElement.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
    }
  }
}
