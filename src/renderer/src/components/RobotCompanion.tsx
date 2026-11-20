import { Component, useMemo, useRef, type ReactNode } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Float, RoundedBox } from '@react-three/drei'
import * as THREE from 'three'
import type { QualityLevel } from '@shared/types'
import clsx from 'clsx'

export type RobotState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'executing'
  | 'approval'
  | 'error'

export const ROBOT_STATE_META: Record<
  RobotState,
  { label: string; color: string; secondary: string; caption: string }
> = {
  idle: {
    label: 'STANDBY',
    color: '#67e8f9',
    secondary: '#22d3ee',
    caption: 'All systems nominal. Awaiting instruction.'
  },
  listening: {
    label: 'LISTENING',
    color: '#5eead4',
    secondary: '#2dd4bf',
    caption: 'Input channel open.'
  },
  thinking: {
    label: 'PROCESSING',
    color: '#a5b4fc',
    secondary: '#818cf8',
    caption: 'Reasoning over available context.'
  },
  executing: {
    label: 'EXECUTING',
    color: '#38bdf8',
    secondary: '#0ea5e9',
    caption: 'Running a permissioned action.'
  },
  approval: {
    label: 'APPROVAL',
    color: '#fbbf24',
    secondary: '#f59e0b',
    caption: 'A sensitive action is waiting for you.'
  },
  error: {
    label: 'FAULT',
    color: '#fb7185',
    secondary: '#f43f5e',
    caption: 'A task failed. Review the output.'
  }
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

class RobotErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

function RobotScene({
  state,
  color,
  secondary,
  reducedMotion
}: {
  state: RobotState
  color: string
  secondary: string
  reducedMotion: boolean
}) {
  const root = useRef<THREE.Group>(null)
  const head = useRef<THREE.Group>(null)
  const eyes = useRef<THREE.Group>(null)
  const core = useRef<THREE.Mesh>(null)
  const ring = useRef<THREE.Group>(null)
  const leftArm = useRef<THREE.Group>(null)
  const rightArm = useRef<THREE.Group>(null)

  useFrame((scene, delta) => {
    const time = scene.clock.elapsedTime
    if (root.current) {
      const turn = reducedMotion ? 0 : scene.pointer.x * 0.22
      root.current.rotation.y = THREE.MathUtils.damp(root.current.rotation.y, turn, 2.4, delta)
    }
    if (head.current) {
      const tiltX = reducedMotion ? 0 : scene.pointer.y * -0.12
      const tiltY = reducedMotion ? 0 : scene.pointer.x * 0.28
      const wobble = state === 'thinking' && !reducedMotion ? Math.sin(time * 1.8) * 0.08 : 0
      head.current.rotation.x = THREE.MathUtils.damp(head.current.rotation.x, tiltX, 3, delta)
      head.current.rotation.y = THREE.MathUtils.damp(head.current.rotation.y, tiltY + wobble, 3, delta)
      head.current.rotation.z = THREE.MathUtils.damp(
        head.current.rotation.z,
        state === 'error' ? Math.sin(time * 22) * 0.03 : 0,
        4,
        delta
      )
    }
    if (eyes.current) {
      const cycle = (time + 1.4) % 4.6
      const blink = cycle > 4.38 && cycle < 4.5 ? 0.12 : 1
      eyes.current.scale.y = THREE.MathUtils.damp(eyes.current.scale.y, blink, 18, delta)
    }
    if (core.current) {
      const material = core.current.material as THREE.MeshStandardMaterial
      const base =
        state === 'approval' ? 1.8 + Math.sin(time * 4) * 0.7 : state === 'thinking' ? 1.4 : 1
      material.emissiveIntensity = reducedMotion ? 1 : base
    }
    if (ring.current) {
      ring.current.rotation.z += delta * (reducedMotion ? 0.02 : state === 'executing' ? 0.9 : 0.28)
    }
    if (!reducedMotion) {
      const sway =
        state === 'executing'
          ? Math.sin(time * 4.2) * 0.32
          : state === 'listening'
            ? Math.sin(time * 1.4) * 0.08
            : Math.sin(time * 1.1) * 0.03
      if (leftArm.current) leftArm.current.rotation.z = 0.16 + sway
      if (rightArm.current) rightArm.current.rotation.z = -0.16 - sway
    }
  })

  return (
    <>
      <ambientLight intensity={1.15} />
      <directionalLight position={[3, 4, 4]} intensity={2.8} color="#e7f7ff" />
      <directionalLight position={[-3.5, 1.5, 2.5]} intensity={0.9} color="#67e8f9" />
      <pointLight position={[-2.4, 1, 2.4]} intensity={12} color={secondary} distance={8} />
      <pointLight position={[2.2, -1.4, 1.6]} intensity={8} color={color} distance={7} />

      <Float
        speed={reducedMotion ? 0 : 1.5}
        rotationIntensity={reducedMotion ? 0 : 0.08}
        floatIntensity={reducedMotion ? 0 : 0.24}
      >
        <group ref={root} position={[0, -0.05, 0]}>
          {/* head */}
          <group ref={head} position={[0, 0.96, 0]}>
            <RoundedBox args={[0.96, 0.62, 0.62]} radius={0.16} smoothness={4} castShadow>
              <meshStandardMaterial color="#13232e" metalness={0.72} roughness={0.32} />
            </RoundedBox>
            <mesh position={[0, 0, 0.318]}>
              <boxGeometry args={[0.76, 0.4, 0.03]} />
              <meshStandardMaterial color="#02070c" metalness={0.2} roughness={0.45} />
            </mesh>
            <group ref={eyes} position={[0, 0.045, 0.338]}>
              <mesh position={[-0.18, 0, 0]}>
                <boxGeometry args={[0.15, 0.055, 0.012]} />
                <meshStandardMaterial
                  color={color}
                  emissive={color}
                  emissiveIntensity={2.4}
                  toneMapped={false}
                />
              </mesh>
              <mesh position={[0.18, 0, 0]}>
                <boxGeometry args={[0.15, 0.055, 0.012]} />
                <meshStandardMaterial
                  color={color}
                  emissive={color}
                  emissiveIntensity={2.4}
                  toneMapped={false}
                />
              </mesh>
            </group>
            <mesh position={[0, -0.12, 0.338]}>
              <boxGeometry args={[0.18, 0.014, 0.012]} />
              <meshStandardMaterial color={secondary} emissive={secondary} emissiveIntensity={0.9} />
            </mesh>
            <mesh position={[-0.51, 0, 0]}>
              <boxGeometry args={[0.08, 0.26, 0.24]} />
              <meshStandardMaterial color="#16242f" metalness={0.9} roughness={0.28} />
            </mesh>
            <mesh position={[0.51, 0, 0]}>
              <boxGeometry args={[0.08, 0.26, 0.24]} />
              <meshStandardMaterial color="#16242f" metalness={0.9} roughness={0.28} />
            </mesh>
            <mesh position={[0, 0.45, 0]}>
              <cylinderGeometry args={[0.012, 0.012, 0.24, 8]} />
              <meshStandardMaterial color="#3a4c5c" metalness={0.9} roughness={0.3} />
            </mesh>
            <mesh position={[0, 0.59, 0]}>
              <sphereGeometry args={[0.055, 16, 16]} />
              <meshStandardMaterial
                color={color}
                emissive={color}
                emissiveIntensity={state === 'error' ? 3 : 1.8}
                toneMapped={false}
              />
            </mesh>
          </group>

          {/* torso */}
          <RoundedBox args={[1.02, 0.86, 0.64]} radius={0.2} smoothness={4} position={[0, 0.08, 0]}>
            <meshStandardMaterial color="#0e1c26" metalness={0.78} roughness={0.3} />
          </RoundedBox>
          <mesh position={[0, 0.14, 0.33]}>
            <boxGeometry args={[0.46, 0.28, 0.02]} />
            <meshStandardMaterial color="#050b11" metalness={0.6} roughness={0.35} />
          </mesh>
          <mesh ref={core} position={[0, 0.14, 0.355]}>
            <sphereGeometry args={[0.085, 20, 20]} />
            <meshStandardMaterial
              color={color}
              emissive={color}
              emissiveIntensity={1.2}
              toneMapped={false}
            />
          </mesh>
          <mesh position={[0, -0.18, 0.335]}>
            <boxGeometry args={[0.5, 0.04, 0.015]} />
            <meshStandardMaterial color="#22323f" metalness={0.7} roughness={0.4} />
          </mesh>

          {/* arms */}
          <group ref={leftArm} position={[-0.58, 0.26, 0]}>
            <mesh position={[0, -0.2, 0]}>
              <cylinderGeometry args={[0.062, 0.05, 0.42, 12]} />
              <meshStandardMaterial color="#122029" metalness={0.85} roughness={0.3} />
            </mesh>
            <mesh position={[0, -0.44, 0]}>
              <sphereGeometry args={[0.075, 14, 14]} />
              <meshStandardMaterial color="#1a2c38" metalness={0.85} roughness={0.3} />
            </mesh>
          </group>
          <group ref={rightArm} position={[0.58, 0.26, 0]}>
            <mesh position={[0, -0.2, 0]}>
              <cylinderGeometry args={[0.062, 0.05, 0.42, 12]} />
              <meshStandardMaterial color="#122029" metalness={0.85} roughness={0.3} />
            </mesh>
            <mesh position={[0, -0.44, 0]}>
              <sphereGeometry args={[0.075, 14, 14]} />
              <meshStandardMaterial color="#1a2c38" metalness={0.85} roughness={0.3} />
            </mesh>
          </group>

          {/* legs */}
          <mesh position={[-0.24, -0.58, 0]}>
            <boxGeometry args={[0.22, 0.34, 0.26]} />
            <meshStandardMaterial color="#101c26" metalness={0.7} roughness={0.36} />
          </mesh>
          <mesh position={[0.24, -0.58, 0]}>
            <boxGeometry args={[0.22, 0.34, 0.26]} />
            <meshStandardMaterial color="#101c26" metalness={0.7} roughness={0.36} />
          </mesh>
          <mesh position={[-0.24, -0.78, 0.04]}>
            <boxGeometry args={[0.28, 0.12, 0.34]} />
            <meshStandardMaterial color="#172733" metalness={0.75} roughness={0.34} />
          </mesh>
          <mesh position={[0.24, -0.78, 0.04]}>
            <boxGeometry args={[0.28, 0.12, 0.34]} />
            <meshStandardMaterial color="#172733" metalness={0.75} roughness={0.34} />
          </mesh>

          <mesh position={[0, -0.24, -0.36]}>
            <boxGeometry args={[0.46, 0.4, 0.14]} />
            <meshStandardMaterial color="#0a141d" metalness={0.8} roughness={0.32} />
          </mesh>
        </group>
      </Float>

      <group ref={ring} position={[0, -0.94, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <mesh>
          <torusGeometry args={[0.62, 0.008, 8, 80]} />
          <meshBasicMaterial color={color} transparent opacity={0.42} toneMapped={false} />
        </mesh>
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <torusGeometry args={[0.8, 0.004, 6, 80]} />
          <meshBasicMaterial color={secondary} transparent opacity={0.24} toneMapped={false} />
        </mesh>
      </group>
    </>
  )
}

export function RobotCompanion({
  state = 'idle',
  quality = 'medium',
  reducedMotion = false,
  enabled = true,
  className
}: {
  state?: RobotState
  quality?: QualityLevel
  reducedMotion?: boolean
  enabled?: boolean
  className?: string
}) {
  const meta = ROBOT_STATE_META[state]
  const canRender = useMemo(() => enabled && webglAvailable(), [enabled])

  const fallback = (
    <div className="robot-fallback" aria-hidden>
      <span className="robot-fallback-ring" />
      <div className="robot-fallback-unit is-head">
        <span className="robot-fallback-eye" />
        <span className="robot-fallback-eye" />
      </div>
      <div className="robot-fallback-unit is-body">
        <span className="robot-fallback-core" />
      </div>
      <span className="robot-fallback-shadow" />
    </div>
  )

  return (
    <div
      className={clsx('robot-stage', className)}
      role="img"
      aria-label={`IGRIS companion: ${meta.label}`}
    >
      {canRender ? (
        <RobotErrorBoundary fallback={fallback}>
          <Canvas
            className="robot-canvas"
            dpr={[1, quality === 'high' ? 2 : quality === 'medium' ? 1.5 : 1]}
            camera={{ position: [0, 0.65, 4.4], fov: 36 }}
            gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
          >
            <RobotScene
              state={state}
              color={meta.color}
              secondary={meta.secondary}
              reducedMotion={reducedMotion}
            />
          </Canvas>
        </RobotErrorBoundary>
      ) : (
        fallback
      )}
      <span className="robot-scanline" aria-hidden />
    </div>
  )
}
