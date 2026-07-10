import * as THREE from 'three';
import { createNoise3D } from 'simplex-noise';
import { RippleEffect } from './RippleEffect';

const noise3D = createNoise3D();

const FISH_COUNT = 3;
let boundary = new THREE.Vector3(12, 7, 2);
const FISH_MAX_SPEED = 0.025; // Slower, natural
const FISH_MAX_FORCE = 0.0006; // Smooth adjustment
const PANIC_SPEED_MULT = 1.3; // Gentle panic

class Boid {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  acceleration: THREE.Vector3;
  panicCooldown = 0;
  baseColor: THREE.Color;
  quaternion = new THREE.Quaternion();
  noiseOffset: number; // For distinct random walk pattern

  constructor(x: number, y: number, z: number) {
    this.noiseOffset = Math.random() * 10000;
    this.position = new THREE.Vector3(x, y, z);
    this.velocity = new THREE.Vector3(
      (Math.random() - 0.5) * 2,
      (Math.random() - 0.5) * 2,
      (Math.random() - 0.5) * 2
    ).normalize().multiplyScalar(FISH_MAX_SPEED * 0.5);
    this.acceleration = new THREE.Vector3();
    
    const hue = 0.05 + Math.random() * 0.04; // distinct orange
    this.baseColor = new THREE.Color(0xffffff); // Display image normally
  }

  applyForce(force: THREE.Vector3) {
    this.acceleration.add(force);
  }

  update(delta: number, time: number) {
    let speedMult = 1.0;
    if (this.panicCooldown > 0) {
      this.panicCooldown -= delta;
      speedMult = PANIC_SPEED_MULT;
    }

    // Rhythm: slow down and speed up periodically to simulate biological heartbeat/stroke
    const rhythm = 1.0 + Math.sin(time * 1.5 + this.noiseOffset) * 0.3; // 0.7 to 1.3
    const currentMaxSpeed = FISH_MAX_SPEED * speedMult * rhythm;

    // Apply inertia and damping
    this.velocity.add(this.acceleration);
    this.velocity.multiplyScalar(0.98); // Velocity damping for smoothness
    
    // Enforce smooth limits
    const speed = this.velocity.length();
    if (speed < 0.002 && speedMult === 1.0) {
      this.velocity.setLength(0.002); // minimum glide
    } else if (speed > currentMaxSpeed) {
      this.velocity.setLength(currentMaxSpeed);
    }
    
    this.position.add(this.velocity);
    
    // Clear acceleration for next frame
    this.acceleration.set(0, 0, 0);

    // Soft bounds check with inertia
    const margin = 2.5;
    const turnFactor = 0.0008;
    if (this.position.x > boundary.x - margin) this.acceleration.x -= turnFactor;
    if (this.position.x < -boundary.x + margin) this.acceleration.x += turnFactor;
    if (this.position.y > boundary.y - margin) this.acceleration.y -= turnFactor;
    if (this.position.y < -boundary.y + margin) this.acceleration.y += turnFactor;
    if (this.position.z > boundary.z - margin) this.acceleration.z -= turnFactor;
    if (this.position.z < -boundary.z + margin) this.acceleration.z += turnFactor;
  }
}

export class Aquarium {
  canvas: HTMLCanvasElement;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  
  boids: Boid[] = [];
  fishMesh!: THREE.InstancedMesh;
  dummy = new THREE.Object3D();
  quaternions: THREE.Quaternion[] = [];
  
  bubblesMesh!: THREE.InstancedMesh;
  bubbleCount = 150;
  bubbleData: { pos: THREE.Vector3; speed: number; phase: number }[] = [];

  ripples: RippleEffect[] = [];

  pointer = new THREE.Vector2(-9999, -9999);
  pointerVelocity = new THREE.Vector2();
  lastPointer = new THREE.Vector2(-9999, -9999);
  pointerWorld = new THREE.Vector3();
  isPointerDown = false;
  raycaster = new THREE.Raycaster();
  interactionPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  onFishTouched?: () => void;

  animationFrameId = 0;
  clock = new THREE.Clock();

  bgMesh?: THREE.Mesh;
  textureAspect: number = 1.0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    
    // Camera
    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
    this.camera.position.set(0, 0, 25);
    
    // Renderer
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.initEnvironment();
    this.initFish();
    this.initBubbles();

    this.animate = this.animate.bind(this);
    this.clock.start();
    this.animate();
  }

  async loadTextureSafely(url: string): Promise<THREE.Texture | null> {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const loader = new THREE.TextureLoader();
      return await new Promise((resolve) => {
        loader.load(
          objectUrl,
          (texture) => resolve(texture),
          undefined,
          (err) => {
            console.error('ThreeJS Texture Load error:', err);
            resolve(null);
          }
        );
      });
    } catch (e) {
      console.error('Failed to fetch texture:', e);
      return null;
    }
  }

  async loadFishTextureWithoutWhite(url: string): Promise<THREE.Texture | null> {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      
      return await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) { resolve(null); return; }
          ctx.drawImage(img, 0, 0);
          
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imageData.data;
          
          // First pass: Calculate average color of the fish body
          let totalR = 0, totalG = 0, totalB = 0, count = 0;
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const a = data[i + 3];
            if (a > 10 && !(r > 230 && g > 230 && b > 230)) {
              // It's part of the fish
              totalR += r;
              totalG += g;
              totalB += b;
              count++;
            }
          }
          
          const avgR = count > 0 ? totalR / count : 255;
          const avgG = count > 0 ? totalG / count : 255;
          const avgB = count > 0 ? totalB / count : 255;

          // Second pass: Remove white background and make body color uniform
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const a = data[i + 3];
            
            // If the pixel is very light (close to white), make it transparent
            if (r > 200 && g > 200 && b > 200) {
              data[i + 3] = 0; // alpha = 0
            } else if (a > 10) {
              // Blend original color with the average color to make it more uniform
              // Especially for the darker/uneven parts
              // Add a cool tone by reducing red and boosting green/blue
              const blendedR = (r * 0.2 + avgR * 0.8);
              const blendedG = (g * 0.2 + avgG * 0.8);
              const blendedB = (b * 0.2 + avgB * 0.8);
              
              data[i] = Math.min(255, blendedR * 0.85); // Reduce red
              data[i + 1] = Math.min(255, blendedG * 1.1); // Boost green slightly
              data[i + 2] = Math.min(255, blendedB * 1.3); // Boost blue for cool tone
              
              // Smooth out alpha for edge pixels if needed
              if (r > 180 && g > 180 && b > 180) {
                 data[i + 3] = Math.min(a, 150); // semi-transparent edges
              }
            }
          }
          
          ctx.putImageData(imageData, 0, 0);
          
          const texture = new THREE.CanvasTexture(canvas);
          resolve(texture);
        };
        img.onerror = () => {
          console.error('Failed to load image for canvas processing');
          resolve(null);
        };
        img.src = objectUrl;
      });
    } catch (e) {
      console.error('Failed to fetch texture:', e);
      return null;
    }
  }

  initEnvironment() {
    this.scene.fog = new THREE.FogExp2(0x0a1e3f, 0.02);
    
    // Lights
    const ambientLight = new THREE.AmbientLight(0x406080, 2.0);
    this.scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xaaccff, 2.5);
    dirLight.position.set(0, 20, 10);
    this.scene.add(dirLight);

    // Background Image mapping onto a plane to create depth
    this.loadTextureSafely('https://raw.githubusercontent.com/shiy92928-sketch/picture/main/f65f1451-65d4-405b-96de-f087f64927c2.png').then((texture) => {
      if (!texture) return;
      texture.colorSpace = THREE.SRGBColorSpace;
      const image = texture.image as HTMLImageElement;
      this.textureAspect = image.width / image.height;
      
      const bgGeo = new THREE.PlaneGeometry(1, 1);
      const bgMat = new THREE.MeshBasicMaterial({ 
        map: texture, 
        depthWrite: false, 
        fog: true 
      });
      this.bgMesh = new THREE.Mesh(bgGeo, bgMat);
      this.bgMesh.position.z = -25;
      this.scene.add(this.bgMesh);
      
      this.resize(window.innerWidth, window.innerHeight); // Update scaling
    });
  }

  initFish() {
    const geometry = new THREE.PlaneGeometry(5.25, 3.5);
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      alphaTest: 0.1,
      side: THREE.DoubleSide,
      depthWrite: false,
      color: 0xffffff
    });
    
    this.loadFishTextureWithoutWhite('https://raw.githubusercontent.com/shiy92928-sketch/picture/main/%E9%B1%BC%E7%A9%BA%E7%99%BD.png').then((texture) => {
      if (texture) {
        texture.colorSpace = THREE.SRGBColorSpace;
        material.map = texture;
        material.needsUpdate = true;
      }
    });

    this.fishMesh = new THREE.InstancedMesh(geometry, material, FISH_COUNT);
    this.fishMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    
    // Add custom color attribute
    const colors = new Float32Array(FISH_COUNT * 3);
    
    for (let i = 0; i < FISH_COUNT; i++) {
      const boid = new Boid(
        (Math.random() - 0.5) * boundary.x * 2,
        (Math.random() - 0.5) * boundary.y * 2,
        (Math.random() - 0.5) * boundary.z * 2
      );
      this.boids.push(boid);
      
      colors[i * 3 + 0] = boid.baseColor.r;
      colors[i * 3 + 1] = boid.baseColor.g;
      colors[i * 3 + 2] = boid.baseColor.b;
    }
    
    this.fishMesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    this.scene.add(this.fishMesh);
  }

  initBubbles() {
    const geo = new THREE.SphereGeometry(0.1, 8, 8);
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transmission: 0.9,
      opacity: 1,
      transparent: true,
      roughness: 0
    });
    this.bubblesMesh = new THREE.InstancedMesh(geo, mat, this.bubbleCount);
    
    for (let i = 0; i < this.bubbleCount; i++) {
      this.bubbleData.push({
        pos: new THREE.Vector3(
          (Math.random() - 0.5) * boundary.x * 2,
          -boundary.y + Math.random() * boundary.y * 2,
          (Math.random() - 0.5) * boundary.z * 2
        ),
        speed: 1 + Math.random() * 2,
        phase: Math.random() * Math.PI * 2
      });
    }
    this.scene.add(this.bubblesMesh);
  }

  updatePointer(nx: number, ny: number, isDown: boolean) {
    const wasDown = this.isPointerDown;
    this.lastPointer.copy(this.pointer);
    this.pointer.set(nx, ny);
    this.pointerVelocity.subVectors(this.pointer, this.lastPointer);
    this.isPointerDown = isDown;

    this.raycaster.setFromCamera(this.pointer, this.camera);
    this.raycaster.ray.intersectPlane(this.interactionPlane, this.pointerWorld);
    
    // Spawn ripple on touch down or occasionally when dragging fast
    if (isDown) {
      const isNewTouch = !wasDown;
      const isFastDrag = this.pointerVelocity.lengthSq() > 0.001 && Math.random() < 0.1;
      
      if (isNewTouch || isFastDrag) {
        this.ripples.push(new RippleEffect(this.pointerWorld.clone(), this.scene));
      }
    }
  }

  flock(time: number) {
    const separationDistance = 1.5;
    const neighborDistance = 4.0;
    
    // Global Flow Field (Environmental Drift)
    const timeScale = 0.1;
    const flowX = noise3D(time * timeScale, 0, 0);
    const flowY = noise3D(0, time * timeScale, 0);
    const globalFlow = new THREE.Vector3(flowX, flowY, 0).multiplyScalar(0.0001);
    
    const interactRadius = this.isPointerDown ? 8.0 : 4.0;
    const interactForce = this.isPointerDown ? 0.05 + this.pointerVelocity.length() : 0.01;

    for (let i = 0; i < FISH_COUNT; i++) {
      const boid = this.boids[i];
      let sep = new THREE.Vector3();
      let ali = new THREE.Vector3();
      let coh = new THREE.Vector3();
      let count = 0;

      // Pointer interaction (Repulsion)
      const dPointer = boid.position.distanceTo(this.pointerWorld);
      if (dPointer < interactRadius) {
        const repulsion = new THREE.Vector3().subVectors(boid.position, this.pointerWorld);
        repulsion.normalize();
        repulsion.multiplyScalar(interactForce * (1 - dPointer / interactRadius) * 0.5);
        boid.applyForce(repulsion);
        if (dPointer < interactRadius * 0.5 && boid.panicCooldown <= 0) {
          boid.panicCooldown = 1.0; // Panic for 1 second
          
          // Trigger fish touched event
          this.onFishTouched?.();

          // Instant boost
          boid.velocity.add(repulsion.clone().normalize().multiplyScalar(FISH_MAX_SPEED * 1.5));
        }
      }

      for (let j = 0; j < FISH_COUNT; j++) {
        if (i === j) continue;
        const other = this.boids[j];
        const d = boid.position.distanceTo(other.position);

        if (d > 0 && d < separationDistance) {
          const diff = new THREE.Vector3().subVectors(boid.position, other.position);
          diff.normalize();
          diff.divideScalar(d);
          sep.add(diff);
        }

        if (d > 0 && d < neighborDistance) {
          ali.add(other.velocity);
          coh.add(other.position);
          count++;
          
          // Cascade panic
          if (other.panicCooldown > 0 && d < separationDistance * 2 && boid.panicCooldown <= 0) {
            if (Math.random() < 0.1) boid.panicCooldown = 0.5;
          }
        }
      }

      if (count > 0) {
        ali.divideScalar(count);
        ali.normalize();
        ali.multiplyScalar(FISH_MAX_SPEED);
        ali.sub(boid.velocity);
        ali.clampLength(0, FISH_MAX_FORCE);

        coh.divideScalar(count);
        coh.sub(boid.position);
        coh.normalize();
        coh.multiplyScalar(FISH_MAX_SPEED);
        coh.sub(boid.velocity);
        coh.clampLength(0, FISH_MAX_FORCE);
      }

      sep.multiplyScalar(2.0);
      ali.multiplyScalar(0.1); // Much less alignment for independence
      coh.multiplyScalar(0.1); // Much less cohesion

      // Smooth Random Walk (Perlin/Simplex Noise based)
      const wanderScale = 0.3; // Low frequency spatial
      const wanderTimeScale = 0.15; // Slow variation over time
      const wx = noise3D(boid.position.x * wanderScale, boid.position.y * wanderScale, time * wanderTimeScale + boid.noiseOffset);
      const wy = noise3D(boid.position.y * wanderScale, boid.position.z * wanderScale, time * wanderTimeScale + boid.noiseOffset + 100);
      const wz = noise3D(boid.position.z * wanderScale, boid.position.x * wanderScale, time * wanderTimeScale + boid.noiseOffset + 200);

      const wander = new THREE.Vector3(wx, wy, wz).multiplyScalar(0.0008); // stronger wander

      boid.applyForce(sep);
      boid.applyForce(ali);
      boid.applyForce(coh);
      boid.applyForce(wander);
      boid.applyForce(globalFlow);
    }
  }

  animate() {
    this.animationFrameId = requestAnimationFrame(this.animate);
    const delta = this.clock.getDelta();
    const elapsedTime = this.clock.getElapsedTime();

    this.flock(elapsedTime);

    // Update ripples
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const isDead = this.ripples[i].update(delta);
      if (isDead) {
        this.ripples[i].destroy(this.scene);
        this.ripples.splice(i, 1);
      }
    }

    // Update fish meshes
    for (let i = 0; i < FISH_COUNT; i++) {
      const boid = this.boids[i];
      boid.update(delta, elapsedTime);

      this.dummy.position.copy(boid.position);
      
      // Calculate target rotation based on velocity (2D rotation around Z)
      const targetQuat = new THREE.Quaternion();
      if (boid.velocity.lengthSq() > 0.0001) {
        // We use Math.atan2 to find the angle in the XY plane.
        // Adjust the offset (-Math.PI / 2) depending on which way the image points.
        // Assuming the top-down fish image points upwards (+Y) by default.
        const angle = Math.atan2(boid.velocity.y, boid.velocity.x) - Math.PI / 2;
        targetQuat.setFromEuler(new THREE.Euler(0, 0, angle));
      }
      
      // Smooth interpolation
      boid.quaternion.slerp(targetQuat, delta * 5.0);
      
      this.dummy.quaternion.copy(boid.quaternion);
      
      // Wobble effect: slight scale pulsation to simulate swimming
      const speed = boid.velocity.length();
      const wobble = Math.sin(elapsedTime * 15 + i) * 0.05 * (speed / FISH_MAX_SPEED);
      this.dummy.scale.setScalar(1 + wobble);
      
      this.dummy.updateMatrix();
      this.fishMesh.setMatrixAt(i, this.dummy.matrix);
      
      // Update color based on panic
      if (boid.panicCooldown > 0) {
        const intensity = boid.panicCooldown;
        const tempColor = boid.baseColor.clone().lerp(new THREE.Color(0x00ffff), intensity);
        this.fishMesh.setColorAt(i, tempColor);
      } else {
        this.fishMesh.setColorAt(i, boid.baseColor);
      }
    }
    
    if (this.fishMesh.instanceColor) this.fishMesh.instanceColor.needsUpdate = true;
    this.fishMesh.instanceMatrix.needsUpdate = true;

    // Update bubbles
    for (let i = 0; i < this.bubbleCount; i++) {
      const b = this.bubbleData[i];
      b.pos.y += b.speed * delta;
      b.pos.x += Math.sin(b.phase + elapsedTime * 2) * 0.02;
      
      if (b.pos.y > boundary.y) {
        b.pos.y = -boundary.y;
        b.pos.x = (Math.random() - 0.5) * boundary.x * 2;
      }
      
      this.dummy.position.copy(b.pos);
      this.dummy.scale.setScalar(1 + Math.sin(b.phase + elapsedTime * 5) * 0.2);
      this.dummy.updateMatrix();
      this.bubblesMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.bubblesMesh.instanceMatrix.needsUpdate = true;

    // Static camera look
    this.camera.lookAt(0, 0, 0);

    this.renderer.render(this.scene, this.camera);
  }

  resize(width: number, height: number) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);

    // Update boundaries for the fish based on frustum at z=0 (camera is at z=25)
    // fov is 45. height = 2 * 25 * tan(45/2)
    const viewHeightAtZero = 2 * 25 * Math.tan(THREE.MathUtils.degToRad(45 / 2));
    const viewWidthAtZero = viewHeightAtZero * this.camera.aspect;
    boundary.set(viewWidthAtZero / 2, viewHeightAtZero / 2, 2);

    // Update background plane size to cover the screen at z=-25 (distance = 50)
    if (this.bgMesh) {
      const H = 2 * 50 * Math.tan(THREE.MathUtils.degToRad(45 / 2));
      const W = H * this.camera.aspect;
      
      const windowAspect = this.camera.aspect;
      let scaleW, scaleH;
      if (windowAspect > this.textureAspect) {
        scaleW = W;
        scaleH = W / this.textureAspect;
      } else {
        scaleH = H;
        scaleW = H * this.textureAspect;
      }
      this.bgMesh.scale.set(scaleW, scaleH, 1);
    }
  }

  destroy() {
    cancelAnimationFrame(this.animationFrameId);
    
    // Clean up ripples
    for (const ripple of this.ripples) {
      ripple.destroy(this.scene);
    }
    this.ripples = [];

    this.renderer.dispose();
  }
}
