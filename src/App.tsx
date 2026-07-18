/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { Aquarium } from './Aquarium';
import { HandTracker } from './HandTracker';
import { AudioSystem } from './AudioSystem';
import { motion, AnimatePresence } from 'motion/react';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const debugCanvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const aquariumRef = useRef<Aquarium | null>(null);
  const handTrackerRef = useRef<HandTracker | null>(null);
  const audioSystemRef = useRef<AudioSystem | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [isAudioEnabled, setIsAudioEnabled] = useState(false);
  
  // Custom cursor state
  const [pointerPos, setPointerPos] = useState({ x: -100, y: -100 });
  const [isInteracting, setIsInteracting] = useState(false);
  const [isPushing, setIsPushing] = useState(false);

  // Layout Settings
  const cardW = 800;
  const cardH = 527;
  const cardX = 0;
  const cardY = 0;

  const titleScale = 0.9;
  const titleX = -25;
  const titleY = -8;

  const btnScale = 1.10;
  const btnX = -13;
  const btnY = 0;

  useEffect(() => {
    if (!canvasRef.current) return;

    const aquarium = new Aquarium(canvasRef.current);
    aquarium.onFishTouched = () => {
      if (audioSystemRef.current) {
        audioSystemRef.current.playBubble();
      }
    };
    aquariumRef.current = aquarium;
    
    // Simulate short loading
    const t = setTimeout(() => setIsReady(true), 800);

    const handleResize = () => {
      aquarium.resize(window.innerWidth, window.innerHeight);
    };
    
    window.addEventListener('resize', handleResize);

    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', handleResize);
      aquarium.destroy();
    };
  }, []);

  useEffect(() => {
    let active = true;
    const initHandTracking = async () => {
      if (!videoRef.current) return;
      const tracker = new HandTracker((pos) => {
        if (!active) return;
        if (pos) {
          // Map mediapipe coordinates (0,1) to screen pixels for the custom cursor
          const screenX = pos.x * window.innerWidth;
          const screenY = pos.y * window.innerHeight;
          setPointerPos({ x: screenX, y: screenY });
          // isInteracting determines if the cursor is visible and tracking
          setIsInteracting(true);
          setIsPushing(pos.isPushing);

          if (aquariumRef.current) {
            const nx = pos.x * 2 - 1;
            const ny = -(pos.y * 2) + 1;
            // Only trigger the "down/push" state in Aquarium when actually pushing forward
            aquariumRef.current.updatePointer(nx, ny, pos.isPushing);
          }
        } else {
          setIsInteracting(false);
          setIsPushing(false);
          if (aquariumRef.current) {
            aquariumRef.current.updatePointer(-9999, -9999, false);
          }
        }
      });
      
      await tracker.initialize();
      if (active && videoRef.current) {
        try {
          await tracker.startCamera(videoRef.current, debugCanvasRef.current || undefined);
          setIsCameraReady(true);
        } catch (e) {
          console.error("Failed to start camera in App", e);
        }
      }
      handTrackerRef.current = tracker;
    };

    initHandTracking();

    return () => {
      active = false;
      if (handTrackerRef.current) {
        handTrackerRef.current.stop();
        handTrackerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    audioSystemRef.current = new AudioSystem();
    return () => {
      if (audioSystemRef.current) {
        audioSystemRef.current.stop();
      }
    };
  }, []);

  const enableAudio = () => {
    if (!isAudioEnabled && audioSystemRef.current) {
      audioSystemRef.current.init();
      audioSystemRef.current.resume();
      setIsAudioEnabled(true);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    enableAudio();
    // If hand is actively tracking, ignore mouse movements to prevent conflict
    if (isInteracting && handTrackerRef.current) return;

    setPointerPos({ x: e.clientX, y: e.clientY });
    
    if (aquariumRef.current) {
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = -(e.clientY / window.innerHeight) * 2 + 1;
      aquariumRef.current.updatePointer(nx, ny, isInteracting);
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    enableAudio();
    if (isInteracting && handTrackerRef.current) return;
    setIsInteracting(true);
    setIsPushing(true);
    if (aquariumRef.current) {
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = -(e.clientY / window.innerHeight) * 2 + 1;
      aquariumRef.current.updatePointer(nx, ny, true);
    }
  };

  const handlePointerUp = () => {
    if (isInteracting && handTrackerRef.current) return;
    setIsInteracting(false);
    setIsPushing(false);
    if (aquariumRef.current) {
      aquariumRef.current.updatePointer(-9999, -9999, false); // move pointer out
    }
  };

  return (
    <div 
      className="relative w-full h-screen overflow-hidden bg-[#050C16] cursor-none touch-none"
      onPointerMove={handlePointerMove}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      <canvas 
        ref={canvasRef} 
        className="absolute top-0 left-0 w-full h-full block touch-none" 
      />
      
      {/* Video and Debug Canvas Overlay */}
      <motion.div 
        className={`absolute bottom-4 right-4 w-64 h-48 rounded-2xl overflow-hidden border border-teal-500/30 shadow-[0_0_20px_rgba(20,184,166,0.1)] pointer-events-none z-40 transition-all duration-300 ${isInteracting ? 'shadow-[0_0_30px_rgba(20,184,166,0.3)] border-teal-400' : 'opacity-70'}`}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: isCameraReady ? (isInteracting ? 1 : 0.7) : 0, scale: isCameraReady ? 1 : 0.9 }}
      >
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover scale-x-[-1]"
          autoPlay
          playsInline
        />
        <canvas
          ref={debugCanvasRef}
          className="absolute inset-0 w-full h-full object-cover scale-x-[-1]"
        />
      </motion.div>

      {/* Custom Cursor Overlay */}
      <motion.div 
        className="pointer-events-none absolute z-50 rounded-full mix-blend-screen"
        animate={{
          x: pointerPos.x - (isPushing ? 32 : (isInteracting ? 24 : 12)),
          y: pointerPos.y - (isPushing ? 32 : (isInteracting ? 24 : 12)),
          width: isPushing ? 64 : (isInteracting ? 48 : 24),
          height: isPushing ? 64 : (isInteracting ? 48 : 24),
          backgroundColor: isPushing ? 'rgba(0, 255, 200, 0.6)' : (isInteracting ? 'rgba(100, 255, 255, 0.4)' : 'rgba(255, 255, 255, 0.2)'),
          boxShadow: isPushing ? '0 0 60px 20px rgba(0, 255, 200, 0.5)' : (isInteracting ? '0 0 40px 10px rgba(100, 255, 255, 0.3)' : '0 0 20px 5px rgba(255, 255, 255, 0.1)'),
          scale: isPushing ? 0.8 : 1,
        }}
        transition={{
          type: "spring",
          damping: 25,
          stiffness: 300,
          mass: 0.5
        }}
        style={{
          border: '1px solid rgba(255,255,255,0.4)',
        }}
      >
        {isInteracting && !isPushing && (
          <motion.div 
            initial={{ scale: 0, opacity: 1 }}
            animate={{ scale: 2, opacity: 0 }}
            transition={{ duration: 0.8, repeat: Infinity }}
            className="absolute inset-0 rounded-full border border-teal-300"
          />
        )}
        {isPushing && (
          <motion.div 
            initial={{ scale: 1, opacity: 1 }}
            animate={{ scale: 2.5, opacity: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="absolute inset-0 rounded-full border-[3px] border-teal-200"
          />
        )}
      </motion.div>

      {/* Intro Page Overlay */}
      <AnimatePresence>
        {!hasStarted && isReady && (
          <motion.div 
            className="absolute inset-0 z-50 flex items-center justify-center bg-teal-900/10 backdrop-blur-md"
            exit={{ opacity: 0, transition: { duration: 1 } }}
          >
            <div 
              className="relative p-8 md:p-12 w-[90%] rounded-3xl text-center flex flex-col justify-center items-center overflow-hidden"
              style={{
                backgroundImage: "url('https://raw.githubusercontent.com/shiy92928-sketch/picture/main/%E7%95%8C%E9%9D%A22.png')",
                backgroundSize: '100% 100%',
                backgroundPosition: 'center',
                backgroundRepeat: 'no-repeat',
                aspectRatio: '2531 / 1656',
                width: `${cardW}px`,
                height: `${cardH}px`,
                transform: `translate(${cardX}px, ${cardY}px)`,
                maxWidth: '90vw',
                maxHeight: '90vh'
              }}
            >
               <h1 
                 className="text-3xl md:text-4xl font-serif text-white tracking-wide mb-6 font-light drop-shadow-sm transition-transform duration-200"
                 style={{ transform: `translate(${titleX}px, ${titleY}px) scale(${titleScale})` }}
               >
                 The Wandering Fish
               </h1>
               
               <div className="space-y-4 text-teal-50/90 font-sans font-light tracking-wide text-sm md:text-base text-left mb-10 w-full flex flex-col items-center">
                 <div>
                   <p className="flex items-center gap-2"><span className="text-xl">🐟</span> Touch the fish</p>
                   <p className="opacity-80">Move your finger close to the fish.</p>
                   <p className="opacity-80">The fish will sense your movement and swim away.</p>
                   <br/>
                   <p className="opacity-80">Explore this quiet underwater memory space.</p>
                 </div>
               </div>

               <button 
                 onClick={() => { setHasStarted(true); enableAudio(); }}
                 className="px-8 py-3 rounded-full bg-white/20 hover:bg-white/30 border border-white/40 text-white tracking-[0.2em] font-sans text-sm transition-all duration-300 hover:shadow-[0_0_15px_rgba(255,255,255,0.4)] relative overflow-hidden group"
                 style={{ transform: `translate(${btnX}px, ${btnY}px) scale(${btnScale})` }}
               >
                 <span className="relative z-10">START EXPERIENCE</span>
                 <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-[200%] transition-transform duration-1000 ease-in-out" />
               </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Loading Overlay */}
      <AnimatePresence>
        {!isReady && (
          <motion.div 
            className="absolute inset-0 z-40 flex items-center justify-center bg-[#050C16]"
            exit={{ opacity: 0, filter: "blur(10px)" }}
            transition={{ duration: 1.5, ease: "easeOut" }}
          >
            <div className="flex flex-col items-center gap-4 text-teal-100">
              <div className="w-12 h-12 border-4 border-teal-900 border-t-teal-400 rounded-full animate-spin" />
              <p className="font-sans text-sm tracking-[0.2em] font-light opacity-80">
                DESCENDING
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
