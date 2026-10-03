import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface BlockDriftProps {
  speed?: number;
  density?: number;
  centerClearRadius?: number;
}

export const BlockDriftBackground: React.FC<BlockDriftProps> = ({
  speed = 0.85,
  centerClearRadius = 22.0,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let animationFrameId: number;
    let isTabVisible = true;

    // Scene & Camera
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x080b10, 0.012);

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    const camera = new THREE.PerspectiveCamera(55, width / height, 0.5, 300);
    camera.position.set(0, 0, 75);

    // Renderer
    const renderer = new THREE.WebGLRenderer({
      powerPreference: 'high-performance',
      antialias: false,
      alpha: true,
      stencil: false,
      depth: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(width, height);
    renderer.setClearColor(0x080b10, 0); // Transparent so radial css gradient shows
    container.appendChild(renderer.domElement);

    // Cube Geometry
    const cubeSize = 1.35;
    const geometry = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);

    // Procedural grid setup
    const depthMin = -120;
    const depthMax = 60;
    const depthRange = depthMax - depthMin;

    const xSpan = 80;
    const ySpan = 50;
    const gridStep = 4.2;

    const positions: THREE.Vector3[] = [];
    const scales: number[] = [];

    // Simple pseudo-random generator
    function pseudoHash(x: number, y: number, z: number): number {
      const dot = x * 12.9898 + y * 78.233 + z * 37.719;
      const sinVal = Math.sin(dot) * 43758.5453;
      return sinVal - Math.floor(sinVal);
    }

    for (let x = -xSpan; x <= xSpan; x += gridStep) {
      for (let y = -ySpan; y <= ySpan; y += gridStep) {
        for (let z = depthMin; z <= depthMax; z += 12.0) {
          const jitterX = (pseudoHash(x, y, z) - 0.5) * 2.2;
          const jitterY = (pseudoHash(y, z, x) - 0.5) * 2.2;
          const jitterZ = (pseudoHash(z, x, y) - 0.5) * 3.0;

          const posX = x + jitterX;
          const posY = y + jitterY;
          const posZ = z + jitterZ;

          // Radial distance from center in XY plane
          const distFromCenter = Math.sqrt(posX * posX + posY * posY);

          // Clear center region
          if (distFromCenter < centerClearRadius * 0.7) {
            continue;
          }

          // Density threshold
          const densityProb = pseudoHash(posX, posY, posZ);
          const edgeBias = Math.min(1.0, distFromCenter / 45.0);
          if (densityProb > 0.38 + (1.0 - edgeBias) * 0.25) {
            continue;
          }

          positions.push(new THREE.Vector3(posX, posY, posZ));
          // Center clearing scale factor
          const scaleFactor = Math.min(1.0, Math.max(0.2, (distFromCenter - centerClearRadius * 0.6) / 18.0));
          scales.push(scaleFactor);
        }
      }
    }

    const instanceCount = positions.length;

    // Custom Shader Material for seamless depth drift and color transitions
    const vertexShader = `
      attribute vec3 aInitialPos;
      attribute float aScale;
      varying vec3 vNormal;
      varying float vDepthFactor;
      varying float vCenterFade;

      uniform float uTime;
      uniform float uSpeed;
      uniform float uDepthMin;
      uniform float uDepthMax;
      uniform float uDepthRange;

      void main() {
        vNormal = normal;

        // Calculate continuous looping Z position
        float rawZ = aInitialPos.z + uTime * uSpeed;
        float loopedZ = mod(rawZ - uDepthMin, uDepthRange) + uDepthMin;

        // Smooth normalized depth factor: 0.0 (near) to 1.0 (far)
        vDepthFactor = clamp((uDepthMax - loopedZ) / uDepthRange, 0.0, 1.0);

        // Center clearing fade
        float distCenter = length(aInitialPos.xy);
        vCenterFade = aScale * smoothstep(14.0, 32.0, distCenter);

        vec3 transformed = position * aScale;
        vec3 worldPos = transformed + vec3(aInitialPos.x, aInitialPos.y, loopedZ);

        gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
      }
    `;

    const fragmentShader = `
      varying vec3 vNormal;
      varying float vDepthFactor;
      varying float vCenterFade;

      uniform vec3 uColorNear;
      uniform vec3 uColorFar;
      uniform vec3 uColorAccent;

      void main() {
        // Subtle directional lighting on cube faces
        vec3 lightDir = normalize(vec3(0.4, 0.8, 0.9));
        float diff = max(dot(vNormal, lightDir), 0.0) * 0.45 + 0.55;

        // Depth coloring: darker near, emerald green far
        vec3 col = mix(uColorNear, uColorFar, pow(vDepthFactor, 1.25));
        
        // Edge tinting
        if (abs(vNormal.z) < 0.2) {
          col = mix(col, uColorAccent, 0.15);
        }

        col *= diff;

        // Fading at loop boundary to eliminate popping
        float loopFade = smoothstep(0.0, 0.12, vDepthFactor) * (1.0 - smoothstep(0.88, 1.0, vDepthFactor));
        float alpha = loopFade * vCenterFade * 0.48;

        gl_FragColor = vec4(col, alpha);
      }
    `;

    const customMaterial = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      uniforms: {
        uTime: { value: 0 },
        uSpeed: { value: speed * 3.8 },
        uDepthMin: { value: depthMin },
        uDepthMax: { value: depthMax },
        uDepthRange: { value: depthRange },
        uColorNear: { value: new THREE.Color(0x06090f) }, // Dark slate/black near
        uColorFar: { value: new THREE.Color(0x10b981) },  // Quorum emerald green far
        uColorAccent: { value: new THREE.Color(0x34d399) },
      },
    });

    // Create Instanced Mesh
    const instancedMesh = new THREE.InstancedMesh(geometry, customMaterial, instanceCount);

    // Initial position attributes
    const initialPosArray = new Float32Array(instanceCount * 3);
    const scaleArray = new Float32Array(instanceCount);

    const dummyMatrix = new THREE.Matrix4();
    for (let i = 0; i < instanceCount; i++) {
      const p = positions[i];
      initialPosArray[i * 3 + 0] = p.x;
      initialPosArray[i * 3 + 1] = p.y;
      initialPosArray[i * 3 + 2] = p.z;
      scaleArray[i] = scales[i];

      dummyMatrix.setPosition(0, 0, 0);
      instancedMesh.setMatrixAt(i, dummyMatrix);
    }

    geometry.setAttribute(
      'aInitialPos',
      new THREE.InstancedBufferAttribute(initialPosArray, 3)
    );
    geometry.setAttribute(
      'aScale',
      new THREE.InstancedBufferAttribute(scaleArray, 1)
    );

    scene.add(instancedMesh);

    // Animation Loop
    const clock = new THREE.Clock();

    const animate = () => {
      if (isTabVisible) {
        const elapsedTime = clock.getElapsedTime();
        customMaterial.uniforms.uTime.value = elapsedTime;

        // Subtle camera swaying for organic depth feel
        camera.position.x = Math.sin(elapsedTime * 0.15) * 1.5;
        camera.position.y = Math.cos(elapsedTime * 0.12) * 1.0;
        camera.lookAt(0, 0, 0);

        renderer.render(scene, camera);
      }
      animationFrameId = requestAnimationFrame(animate);
    };

    animate();

    // Resize Handler
    const handleResize = () => {
      if (!container) return;
      const newWidth = container.clientWidth || window.innerWidth;
      const newHeight = container.clientHeight || window.innerHeight;

      camera.aspect = newWidth / newHeight;
      camera.updateProjectionMatrix();

      renderer.setSize(newWidth, newHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    };

    window.addEventListener('resize', handleResize);

    // Visibility Change Handler (Pause RAF when tab hidden)
    const handleVisibilityChange = () => {
      isTabVisible = !document.hidden;
      if (isTabVisible) {
        clock.start();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Cleanup
    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('visibilitychange', handleVisibilityChange);

      geometry.dispose();
      customMaterial.dispose();
      renderer.dispose();

      if (container && renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [speed, centerClearRadius]);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 pointer-events-none z-0 overflow-hidden"
      aria-hidden="true"
    >
      {/* Dark gradient overlay to soften background and protect readability */}
      <div className="absolute inset-0 bg-gradient-to-b from-brand-bg/85 via-brand-bg/75 to-brand-bg/95" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(16,185,129,0.08),rgba(255,255,255,0))]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.05),transparent_40%)]" />
    </div>
  );
};
