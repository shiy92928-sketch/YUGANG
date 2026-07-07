import * as THREE from 'three';

const rippleVertexShader = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const rippleFragmentShader = `
uniform float uTime;
uniform vec3 uColor;
varying vec2 vUv;

void main() {
  vec2 center = vec2(0.5, 0.5);
  float dist = distance(vUv, center);
  
  // Normalize time 0-1
  float progress = clamp(uTime, 0.0, 1.0);
  
  // Radial expansion
  float radius = progress * 0.4;
  
  // Width decreases over time to simulate dissipation
  float width = 0.03 * (1.0 - progress + 0.1);
  
  // Fluid ripple effect using sine waves
  float wave = sin((dist - radius) * 40.0 - uTime * 10.0);
  
  // Core ring
  float ring = smoothstep(radius - width, radius, dist) - smoothstep(radius, radius + width, dist);
  
  // Enhance refractive fluid look
  float fluid = ring * (0.8 + 0.5 * wave);
  
  float alpha = fluid * (1.0 - progress);
  
  gl_FragColor = vec4(uColor + vec3(fluid * 0.2), clamp(alpha, 0.0, 1.0));
}
`;

export class RippleEffect {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  life: number = 0;
  maxLife: number = 1.5;

  constructor(position: THREE.Vector3, scene: THREE.Scene) {
    const geometry = new THREE.PlaneGeometry(6, 6);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0x40c0ff) }
      },
      vertexShader: rippleVertexShader,
      fragmentShader: rippleFragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.position.copy(position);
    this.mesh.position.z += 0.5; // Slightly in front to avoid clipping
    scene.add(this.mesh);
  }

  update(delta: number): boolean {
    this.life += delta;
    const progress = this.life / this.maxLife;
    this.material.uniforms.uTime.value = progress;
    
    return progress >= 1.0;
  }

  destroy(scene: THREE.Scene) {
    scene.remove(this.mesh);
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}
