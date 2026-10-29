import { Component, useMemo, useRef, type ReactNode } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Float } from '@react-three/drei'
import * as THREE from 'three'
import type { AccentName, AnimationIntensity, QualityLevel } from '@shared/types'
import clsx from 'clsx'

const CORE_COLORS: Record<AccentName, { accent: string; secondary: string }> = {
  azure: { accent: '#57b0ff', secondary: '#7c7cff' },
  violet: { accent: '#a78bfa', secondary: '#6fa8ff' },
  silver: { accent: '#d4deea', secondary: '#8fa8c7' }
}

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(
      canvas.getContext('webgl2') ??
        canvas.getContext('webgl') ??
        canvas.getContext('experimental-webgl')
    )
  } catch {
    return false
  }
}

class CoreErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(): void {
    // The CSS core remains usable when GPU acceleration is unavailable.
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

function Dust({
  count,
  color,
  radius = 2.9
}: {
  count: number
  color: string
  radius?: number
}) {
  const positions = useMemo(() => {
    const array = new Float32Array(count * 3)
    let seed = 1847
    const random = (): number => {
      seed = (seed * 16807) % 2147483647
      return (seed - 1) / 2147483646
    }
    for (let index = 0; index < count; index += 1) {
      const theta = random() * Math.PI * 2
      const phi = Math.acos(2 * random() - 1)
      const distance = radius * (0.55 + random() * 0.5)
      array[index * 3] = distance * Math.sin(phi) * Math.cos(theta)
      array[index * 3 + 1] = distance * Math.sin(phi) * Math.sin(theta) * 0.72
      array[index * 3 + 2] = distance * Math.cos(phi)
    }
    return array
  }, [count, radius])

  const points = useRef<THREE.Points>(null)
  useFrame((_state, delta) => {
    if (points.current) points.current.rotation.y += delta * 0.018
  })

  return (
    <points ref={points}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.025}
        color={color}
        transparent
        opacity={0.52}
        sizeAttenuation
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  )
}

function CoreScene({
  accent,
  secondary,
  quality,
  intensity,
  reducedMotion
}: {
  accent: string
  secondary: string
  quality: QualityLevel
  intensity: AnimationIntensity
  reducedMotion: boolean
}) {
  const core = useRef<THREE.Group>(null)
  const orbit = useRef<THREE.Group>(null)
  const halo = useRef<THREE.Group>(null)
  const baseSpeed = intensity === 'calm' ? 0.06 : intensity === 'lively' ? 0.2 : 0.11
  const speed = reducedMotion ? 0.008 : baseSpeed
  const particles = quality === 'high' ? 320 : quality === 'medium' ? 190 : 110

  useFrame((state, delta) => {
    const group = core.current
    if (group) {
      group.rotation.y += delta * speed
      group.rotation.x = THREE.MathUtils.damp(
        group.rotation.x,
        state.pointer.y * 0.18,
        2.6,
        delta
      )
      group.rotation.z = THREE.MathUtils.damp(
        group.rotation.z,
        state.pointer.x * -0.08,
        2.6,
        delta
      )
    }
    if (orbit.current) {
      orbit.current.rotation.x += delta * speed * 0.62
      orbit.current.rotation.y -= delta * speed * 0.44
    }
    if (halo.current) {
      halo.current.rotation.z += delta * speed * 0.3
    }
  })

  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[4, 5, 5]} intensity={2.2} color="#dceaff" />
      <pointLight position={[-4, -2, 3]} intensity={22} color={secondary} distance={12} />
      <pointLight position={[3, -3, -2]} intensity={16} color={accent} distance={10} />

      <Float
        speed={reducedMotion ? 0 : intensity === 'lively' ? 2 : 1.1}
        rotationIntensity={reducedMotion ? 0 : 0.16}
        floatIntensity={reducedMotion ? 0 : 0.38}
      >
        <group ref={core}>
          <mesh>
            <icosahedronGeometry args={[1.28, 1]} />
            <meshPhysicalMaterial
              color="#101720"
              metalness={0.96}
              roughness={0.22}
              clearcoat={1}
              clearcoatRoughness={0.18}
              emissive={accent}
              emissiveIntensity={0.08}
              flatShading
            />
          </mesh>
          <mesh scale={0.72}>
            <icosahedronGeometry args={[1, 2]} />
            <meshBasicMaterial color={accent} transparent opacity={0.9} />
          </mesh>
          <mesh scale={0.98}>
            <sphereGeometry args={[1, 32, 32]} />
            <meshBasicMaterial
              color={accent}
              transparent
              opacity={0.08}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
          <mesh scale={1.34}>
            <icosahedronGeometry args={[1.28, 1]} />
            <meshBasicMaterial color={accent} wireframe transparent opacity={0.28} />
          </mesh>
          <mesh rotation={[0.4, 0.2, 0.1]}>
            <torusGeometry args={[1.62, 0.008, 8, 160]} />
            <meshBasicMaterial color="#b9d8f5" transparent opacity={0.34} />
          </mesh>
        </group>
      </Float>

      <group ref={orbit} rotation={[0.5, 0.25, 0.1]}>
        <mesh rotation={[Math.PI / 2.3, 0.2, 0]}>
          <torusGeometry args={[2.05, 0.018, 12, 180]} />
          <meshPhysicalMaterial
            color="#1a2430"
            metalness={0.98}
            roughness={0.28}
            clearcoat={0.8}
          />
        </mesh>
        <mesh rotation={[1.15, -0.4, 0.6]}>
          <torusGeometry args={[2.34, 0.006, 8, 180]} />
          <meshBasicMaterial color={accent} transparent opacity={0.44} />
        </mesh>
        <mesh position={[2.05, 0.15, 0]} rotation={[Math.PI / 2.3, 0.2, 0]}>
          <sphereGeometry args={[0.035, 16, 16]} />
          <meshBasicMaterial color="#e8f5ff" />
        </mesh>
      </group>

      <group ref={halo} rotation={[1.15, -0.4, 0.6]}>
        <mesh position={[-2.34, 0, 0]}>
          <sphereGeometry args={[0.024, 12, 12]} />
          <meshBasicMaterial color={secondary} />
        </mesh>
      </group>

      <Dust count={particles} color={accent} />
    </>
  )
}

export interface IgrisCoreProps {
  accent?: AccentName
  quality?: QualityLevel
  intensity?: AnimationIntensity
  reducedMotion?: boolean
  enabled?: boolean
  compact?: boolean
  className?: string
}

export function IgrisCore({
  accent = 'azure',
  quality = 'high',
  intensity = 'balanced',
  reducedMotion = false,
  enabled = true,
  compact = false,
  className
}: IgrisCoreProps) {
  const colors = CORE_COLORS[accent] ?? CORE_COLORS.azure
  const canRender = useMemo(() => enabled && webglAvailable(), [enabled])

  const fallback = (
    <div className={clsx('core-fallback', compact && 'is-compact')} aria-hidden>
      <div className="core-fallback-halo" />
      <div className="core-fallback-ring ring-a" />
      <div className="core-fallback-ring ring-b" />
      <div className="core-fallback-ring ring-c" />
      <div className="core-orb">
        <span className="core-orb-surface" />
        <span className="core-orb-glint" />
      </div>
    </div>
  )

  if (!canRender) {
    return (
      <div className={clsx('core-stage', compact && 'is-compact', className)}>
        {fallback}
      </div>
    )
  }

  return (
    <div
      className={clsx('core-stage', compact && 'is-compact', className)}
      role="img"
      aria-label="IGRIS luminous core"
    >
      {fallback}
      <CoreErrorBoundary fallback={null}>
        <Canvas
          className="core-canvas"
          dpr={[1, quality === 'high' ? 2 : quality === 'medium' ? 1.5 : 1]}
          camera={{ position: [0, 0, 5.8], fov: 38 }}
          gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        >
          <CoreScene
            accent={colors.accent}
            secondary={colors.secondary}
            quality={quality}
            intensity={intensity}
            reducedMotion={reducedMotion}
          />
        </Canvas>
      </CoreErrorBoundary>
      <div className="core-scanline" aria-hidden />
    </div>
  )
}
