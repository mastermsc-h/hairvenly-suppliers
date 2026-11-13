"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer, MeshReflectorMaterial, OrbitControls, Sparkles } from "@react-three/drei";
import { Bloom, EffectComposer, Noise, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";
import {
  ArrowRight,
  Check,
  Coins,
  Globe,
  LayoutGrid,
  Megaphone,
  MessageCircle,
  Package,
  Play,
  Scissors,
  Send,
  ShoppingBag,
  Sparkles as SparklesIcon,
  Square,
  Users,
  Video,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  AKZENT,
  ALLE_INSELN,
  FLUESSE,
  FLUSS_ARTEN,
  INSELN,
  STATUS_FARBE,
  inselNachId,
  type Fluss,
  type FlussArt,
  type Insel,
} from "./welt-data";
import { BereichSymbol } from "./welt-skulptur";

/** Dasselbe Zeichen wie die 3D-Skulptur, für Beschriftung, Karte und Leiste. */
const ICONS: Record<string, LucideIcon> = {
  zentrale: SparklesIcon,
  einkauf: Globe,
  lager: Package,
  versand: Send,
  shop: ShoppingBag,
  marketing: Megaphone,
  content: Video,
  service: MessageCircle,
  team: Users,
  salon: Scissors,
  finanzen: Coins,
};

const HINTERGRUND = "#08070b";

/* ------------------------------------------------------------------ */
/* Bühne: dunkler Raum mit spiegelndem Boden                           */
/* ------------------------------------------------------------------ */

function Buehne({ spiegel }: { spiegel: boolean }) {
  return (
    <>
      <color attach="background" args={[HINTERGRUND]} />
      <fog attach="fog" args={[HINTERGRUND, 34, 92]} />

      {/* Lichtflächen nur für die Spiegelungen auf Metall und Glas */}
      <Environment resolution={256}>
        <Lightformer form="rect" intensity={3} position={[0, 12, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[14, 14, 1]} color="#fff1dc" />
        <Lightformer form="rect" intensity={1.4} position={[-16, 5, -6]} rotation={[0, Math.PI / 2, 0]} scale={[18, 5, 1]} color="#f3cfa6" />
        <Lightformer form="rect" intensity={1} position={[16, 4, 8]} rotation={[0, -Math.PI / 2, 0]} scale={[18, 4, 1]} color="#bcc9ff" />
      </Environment>

      <ambientLight intensity={0.25} />
      <spotLight position={[0, 30, 0]} angle={0.75} penumbra={1} intensity={2600} color="#ffe9cf" distance={80} />
      <directionalLight position={[-12, 10, 14]} intensity={0.5} color="#cfd6ff" />

      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[95, 72]} />
        {spiegel ? (
          <MeshReflectorMaterial
            resolution={512}
            blur={[320, 110]}
            mixBlur={1}
            mixStrength={28}
            roughness={0.9}
            depthScale={1.1}
            minDepthThreshold={0.4}
            maxDepthThreshold={1.4}
            color="#0d0c11"
            metalness={0.55}
            mirror={0.6}
          />
        ) : (
          <meshStandardMaterial color="#0d0c11" metalness={0.6} roughness={0.5} />
        )}
      </mesh>

      <Sparkles count={70} scale={[46, 12, 46]} position={[0, 7, 0]} size={2} speed={0.15} color={AKZENT} opacity={0.35} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Zentrale: ein Fall aus feinen Lichtsträhnen                         */
/* ------------------------------------------------------------------ */

const STRAEHNEN = 420;
const STRAEHNEN_TEILE = 56;

const HAAR_VERTEX = /* glsl */ `
  attribute float aSeed;
  attribute float aT;
  uniform float uTime;
  varying float vT;
  varying float vSeed;
  void main() {
    float t = aT;
    float lage = fract(aSeed * 13.7);
    float winkel = aSeed * 43.98 + t * 1.5 + sin(uTime * 0.22 + aSeed * 9.0) * 0.3 * t;
    float weite = 0.1 + lage * 0.22 + pow(t, 1.8) * (1.1 + lage * 1.9);
    float welle = sin(t * 5.5 - uTime * 0.7 + aSeed * 21.0) * 0.2 * t;
    vec3 p = vec3(cos(winkel) * (weite + welle), mix(9.0, 0.05, t), sin(winkel) * (weite + welle));
    p.x += sin(uTime * 0.35 + p.y * 0.4) * 0.3 * t;
    p.z += cos(uTime * 0.28 + p.y * 0.33) * 0.2 * t;
    vT = t;
    vSeed = aSeed;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const HAAR_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform vec3 uOben;
  uniform vec3 uUnten;
  uniform float uKraft;
  varying float vT;
  varying float vSeed;
  void main() {
    float blende = smoothstep(0.0, 0.06, vT) * (1.0 - smoothstep(0.7, 1.0, vT));
    // Ein Lichtschimmer läuft an jeder Strähne nach unten.
    float schimmer = 0.55 + 0.45 * sin(vT * 26.0 + vSeed * 60.0 - uTime * 1.8);
    vec3 farbe = mix(uOben, uUnten, vT) * schimmer * uKraft;
    gl_FragColor = vec4(farbe, blende * 0.5);
  }
`;

function Haarfall({ aktiv, onWahl }: { aktiv: boolean; onWahl: () => void }) {
  const material = useRef<THREE.ShaderMaterial>(null);
  const ring = useRef<THREE.Mesh>(null);
  const [hover, setHover] = useState(false);

  const geometrie = useMemo(() => {
    const anzahl = STRAEHNEN * (STRAEHNEN_TEILE - 1) * 2;
    const seed = new Float32Array(anzahl);
    const t = new Float32Array(anzahl);
    let o = 0;
    for (let s = 0; s < STRAEHNEN; s++) {
      for (let k = 0; k < STRAEHNEN_TEILE - 1; k++) {
        seed[o] = seed[o + 1] = (s + 0.5) / STRAEHNEN;
        t[o] = k / (STRAEHNEN_TEILE - 1);
        t[o + 1] = (k + 1) / (STRAEHNEN_TEILE - 1);
        o += 2;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(anzahl * 3), 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    g.setAttribute("aT", new THREE.BufferAttribute(t, 1));
    return g;
  }, []);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uKraft: { value: 1.5 },
      uOben: { value: new THREE.Color("#fff3df") },
      uUnten: { value: new THREE.Color("#d79a62") },
    }),
    [],
  );

  useFrame(({ clock }, dt) => {
    const m = material.current;
    if (m) {
      m.uniforms.uTime.value = clock.elapsedTime;
      m.uniforms.uKraft.value = THREE.MathUtils.damp(m.uniforms.uKraft.value, aktiv || hover ? 2.3 : 1.5, 4, dt);
    }
    if (ring.current) ring.current.rotation.z += dt * 0.2;
  });

  useEffect(() => {
    document.body.style.cursor = hover ? "pointer" : "";
    return () => {
      document.body.style.cursor = "";
    };
  }, [hover]);

  return (
    <group>
      <lineSegments geometry={geometrie} frustumCulled={false}>
        <shaderMaterial
          ref={material}
          uniforms={uniforms}
          vertexShader={HAAR_VERTEX}
          fragmentShader={HAAR_FRAGMENT}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </lineSegments>
      {/* Der Ring, der die Strähnen oben fasst */}
      <mesh ref={ring} position={[0, 9, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.42, 0.035, 12, 64]} />
        <meshStandardMaterial color={AKZENT} metalness={1} roughness={0.2} emissive={AKZENT} emissiveIntensity={0.6} />
      </mesh>
      <pointLight position={[0, 4, 0]} color="#ffd9ae" intensity={120} distance={26} />
      {/* Unsichtbare Klickfläche */}
      <mesh
        position={[0, 4.5, 0]}
        onClick={(e) => {
          e.stopPropagation();
          onWahl();
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHover(true);
        }}
        onPointerOut={() => setHover(false)}
      >
        <cylinderGeometry args={[1.8, 2.6, 9, 16]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Sockel mit Daten-Skulptur                                           */
/* ------------------------------------------------------------------ */

const SOCKEL_RADIUS = 1.9;

function Sockel({ insel, aktiv, onWahl }: { insel: Insel; aktiv: boolean; onWahl: () => void }) {
  const [hover, setHover] = useState(false);
  const warnring = useRef<THREE.Mesh>(null);
  const kante = useRef<THREE.MeshBasicMaterial>(null);
  const kraft = useRef(1);
  const statusFarbe = STATUS_FARBE[insel.status];

  useFrame(({ clock }, dt) => {
    if (kante.current) {
      kraft.current = THREE.MathUtils.damp(kraft.current, aktiv ? 2.6 : hover ? 1.9 : 1, 6, dt);
      kante.current.color.set(insel.farbe).multiplyScalar(kraft.current);
    }
    const w = warnring.current;
    if (w) {
      const phase = (clock.elapsedTime * (insel.status === "alarm" ? 0.55 : 0.35)) % 1;
      w.scale.setScalar(1 + phase * 0.6);
      (w.material as THREE.MeshBasicMaterial).opacity = (1 - phase) * 0.7;
    }
  });

  useEffect(() => {
    document.body.style.cursor = hover ? "pointer" : "";
    return () => {
      document.body.style.cursor = "";
    };
  }, [hover]);

  // Die Skulptur zeigt mit ihrer Vorderseite nach außen, weg von der Zentrale.
  const drehung = Math.atan2(insel.pos[0], insel.pos[2]);
  const bogen = Math.max(0.02, insel.fuellung) * Math.PI * 2;
  const bereichLicht = useMemo(() => new THREE.Color(insel.farbe).multiplyScalar(1.9), [insel.farbe]);
  const statusLicht = useMemo(() => new THREE.Color(statusFarbe).multiplyScalar(1.9), [statusFarbe]);

  return (
    <group
      position={insel.pos}
      onClick={(e) => {
        e.stopPropagation();
        onWahl();
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHover(true);
      }}
      onPointerOut={() => setHover(false)}
    >
      {/* Sockel */}
      <mesh position={[0, insel.hoehe / 2, 0]}>
        <cylinderGeometry args={[SOCKEL_RADIUS, SOCKEL_RADIUS, insel.hoehe, 96]} />
        <meshStandardMaterial color="#17151c" metalness={0.9} roughness={0.32} />
      </mesh>
      {/* feine Lichtkante oben */}
      <mesh position={[0, insel.hoehe + 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[SOCKEL_RADIUS - 0.035, SOCKEL_RADIUS, 96]} />
        <meshBasicMaterial ref={kante} color={insel.farbe} toneMapped={false} />
      </mesh>

      {/* Füllstands-Ring: zeigt die Kennzahl auf einen Blick */}
      <group position={[0, insel.hoehe + 0.35, 0]} rotation={[Math.PI / 2, 0, Math.PI / 2 - drehung]}>
        <mesh>
          <torusGeometry args={[SOCKEL_RADIUS + 0.3, 0.008, 6, 120]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.12} />
        </mesh>
        <mesh>
          <torusGeometry args={[SOCKEL_RADIUS + 0.3, 0.022, 8, 120, bogen]} />
          <meshBasicMaterial color={bereichLicht} toneMapped={false} />
        </mesh>
      </group>

      <group position={[0, insel.hoehe, 0]} rotation={[0, drehung, 0]}>
        <BereichSymbol id={insel.id} farbe={insel.farbe} />
      </group>

      {/* Wo etwas zu tun ist, läuft ein Lichtring über den Boden */}
      {insel.status !== "ok" && (
        <mesh ref={warnring} position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[SOCKEL_RADIUS + 0.5, SOCKEL_RADIUS + 0.56, 96]} />
          <meshBasicMaterial color={statusLicht} transparent toneMapped={false} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Flüsse: feine Lichtbögen mit wandernden Impulsen                    */
/* ------------------------------------------------------------------ */

function FlussLinie({ fluss, sichtbar, betont }: { fluss: Fluss; sichtbar: boolean; betont: boolean }) {
  const impulse = useRef<THREE.InstancedMesh>(null);
  const farbe = FLUSS_ARTEN[fluss.art].farbe;

  const kurve = useMemo(() => {
    const von = inselNachId(fluss.von)!;
    const nach = inselNachId(fluss.nach)!;
    const a = new THREE.Vector3(von.pos[0], von.hoehe + 0.5, von.pos[2]);
    const b = new THREE.Vector3(nach.pos[0], nach.hoehe + 0.5, nach.pos[2]);
    const mitte = a.clone().add(b).multiplyScalar(0.5);
    const abstand = a.distanceTo(b);
    mitte.y += 2.2 + abstand * 0.16;
    // Bögen, die quer durch den Raum gehen, weichen der Zentrale seitlich aus.
    if (Math.hypot(mitte.x, mitte.z) < 7) {
      const seite = new THREE.Vector3(-(b.z - a.z), 0, b.x - a.x).normalize();
      mitte.addScaledVector(seite, 9);
    }
    return new THREE.QuadraticBezierCurve3(a, mitte, b);
  }, [fluss]);

  const hilfs = useMemo(() => ({ objekt: new THREE.Object3D(), punkt: new THREE.Vector3() }), []);

  useFrame(({ clock }) => {
    const m = impulse.current;
    if (!m) return;
    const t = clock.elapsedTime * fluss.tempo;
    for (let i = 0; i < fluss.menge; i++) {
      const u = (t + i / fluss.menge) % 1;
      kurve.getPoint(u, hilfs.punkt);
      hilfs.objekt.position.copy(hilfs.punkt);
      // Impulse blenden an den Enden weich ein und aus.
      hilfs.objekt.scale.setScalar(Math.sin(u * Math.PI));
      hilfs.objekt.updateMatrix();
      m.setMatrixAt(i, hilfs.objekt.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });

  const leuchtFarbe = useMemo(() => new THREE.Color(farbe).multiplyScalar(2.6), [farbe]);

  return (
    <group visible={sichtbar}>
      <mesh>
        <tubeGeometry args={[kurve, 72, 0.009, 5, false]} />
        <meshBasicMaterial color={farbe} transparent opacity={betont ? 0.75 : 0.3} depthWrite={false} toneMapped={false} />
      </mesh>
      <instancedMesh ref={impulse} args={[undefined, undefined, fluss.menge]} frustumCulled={false}>
        <sphereGeometry args={[0.055, 10, 10]} />
        <meshBasicMaterial color={leuchtFarbe} toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Kamera                                                              */
/* ------------------------------------------------------------------ */

const UEBERSICHT_POS = new THREE.Vector3(0, 15, 38);
const UEBERSICHT_BLICK = new THREE.Vector3(0, 3.2, 0);

function Kamerafahrt({ ziel }: { ziel: Insel | null }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const flug = useRef(true);
  const zielPos = useRef(UEBERSICHT_POS.clone());
  const zielBlick = useRef(UEBERSICHT_BLICK.clone());
  // Auf schmalen Bildschirmen (Handy hochkant) weiter weg, damit alles ins Bild passt.
  const format = useThree((s) => s.size.width / s.size.height);
  const abstand = format > 0 ? Math.min(1.8, Math.max(1, 1.05 / format)) : 1;

  useEffect(() => {
    if (!ziel) {
      zielPos.current.copy(UEBERSICHT_POS).multiplyScalar(abstand);
      zielBlick.current.copy(UEBERSICHT_BLICK);
    } else if (ziel.id === "zentrale") {
      zielPos.current.set(0, 6.5, 17 * Math.sqrt(abstand));
      zielBlick.current.set(0, 4.6, 0);
    } else {
      const [x, , z] = ziel.pos;
      const nachAussen = new THREE.Vector3(x, 0, z).normalize();
      zielPos.current
        .set(x, ziel.hoehe, z)
        .addScaledVector(nachAussen, 12.5 * Math.sqrt(abstand))
        .add(new THREE.Vector3(0, 4.8, 0));
      zielBlick.current.set(x, ziel.hoehe + 1.1, z);
    }
    // Auf breiten Bildschirmen liegt rechts die Detail-Karte — das Motiv rückt
    // deshalb etwas nach links, damit es nicht verdeckt wird.
    if (ziel && format > 1.3) {
      const blick = zielBlick.current.clone().sub(zielPos.current).setY(0).normalize();
      const seitlich = new THREE.Vector3(-blick.z, 0, blick.x).multiplyScalar(2.4);
      zielPos.current.add(seitlich);
      zielBlick.current.add(seitlich);
    }
    flug.current = true;
  }, [ziel, abstand, format]);

  useFrame((state, dt) => {
    const c = controls.current;
    if (!c) return;
    if (flug.current) {
      const k = 1 - Math.exp(-2.6 * dt);
      state.camera.position.lerp(zielPos.current, k);
      c.target.lerp(zielBlick.current, k);
      if (state.camera.position.distanceTo(zielPos.current) < 0.08) flug.current = false;
    }
    c.update();
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan={false}
      enableDamping
      dampingFactor={0.07}
      minDistance={6}
      maxDistance={48 * abstand}
      minPolarAngle={0.5}
      maxPolarAngle={1.5}
      autoRotate={!ziel}
      autoRotateSpeed={0.22}
      // Sobald der Nutzer selbst dreht oder zoomt, endet die automatische Fahrt.
      onStart={() => {
        flug.current = false;
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Beschriftung: normales HTML, das der 3D-Position folgt              */
/* ------------------------------------------------------------------ */

type EtikettSetzer = (id: string, sichtbar: boolean, x: number, y: number, tiefe: number) => void;
type EtikettMelder = (id: string, el: HTMLButtonElement | null) => void;

function Etikett({
  insel,
  versteckt,
  melde,
  onWahl,
}: {
  insel: Insel;
  versteckt: boolean;
  melde: EtikettMelder;
  onWahl: () => void;
}) {
  const Icon = ICONS[insel.id];
  return (
    <button
      type="button"
      ref={(el) => melde(insel.id, el)}
      onClick={onWahl}
      className={`group invisible absolute left-0 top-0 flex flex-col items-center whitespace-nowrap text-center transition-opacity duration-300 [text-shadow:0_1px_12px_rgba(0,0,0,0.9)] ${
        versteckt ? "pointer-events-none opacity-0" : "pointer-events-auto opacity-100"
      }`}
    >
      <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-white/70 transition-colors group-hover:text-white">
        <Icon size={13} strokeWidth={1.75} style={{ color: insel.farbe }} />
        {insel.name}
        {insel.status !== "ok" && (
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: STATUS_FARBE[insel.status], boxShadow: `0 0 8px ${STATUS_FARBE[insel.status]}` }}
          />
        )}
      </span>
      {/* Kennzahl nur auf breiten Bildschirmen — am Handy würden sich die Schilder überdecken. */}
      <span className="mt-0.5 hidden text-xl font-light tabular-nums tracking-tight text-white md:block">
        {insel.kopf.wert}
      </span>
      <span className="hidden text-[10px] text-white/40 md:block">{insel.kopf.label}</span>
    </button>
  );
}

function EtikettTracker({ setze }: { setze: EtikettSetzer }) {
  const punkt = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    for (const insel of ALLE_INSELN) {
      const y = insel.id === "zentrale" ? insel.hoehe + 1.3 : insel.hoehe + 3.6;
      punkt.set(insel.pos[0], y, insel.pos[2]).project(camera);
      setze(insel.id, punkt.z < 1, (punkt.x * 0.5 + 0.5) * size.width, (-punkt.y * 0.5 + 0.5) * size.height, punkt.z);
    }
  });
  return null;
}

/* ------------------------------------------------------------------ */
/* Seite: 3D-Bühne + Bedienoberfläche                                  */
/* ------------------------------------------------------------------ */

const ART_STIL: Record<"alarm" | "warn" | "idee", { name: string; farbe: string }> = {
  alarm: { name: "Dringend", farbe: STATUS_FARBE.alarm },
  warn: { name: "Achtung", farbe: STATUS_FARBE.warn },
  idee: { name: "Vorschlag", farbe: "rgba(255,255,255,0.45)" },
};

const KARTE = "border border-white/10 bg-[#0e0d12]/80 backdrop-blur-2xl";
const UEBERSCHRIFT = "text-[10px] font-medium uppercase tracking-[0.18em] text-white/40";

const LEISTE: { id: string | null; name: string; status: Insel["status"]; farbe: string }[] = [
  { id: null, name: "Überblick", status: "ok", farbe: "#ffffff" },
  ...ALLE_INSELN,
];

function LeistenIcon({ id, farbe }: { id: string | null; farbe: string }) {
  const Icon = id ? ICONS[id] : LayoutGrid;
  return <Icon size={13} strokeWidth={1.75} style={{ color: farbe }} />;
}

export default function WeltScene({ start }: { start?: string }) {
  // `start` kommt aus der Adresse (/welt?bereich=lager) und öffnet direkt einen Bereich.
  const [gewaehlt, setGewaehlt] = useState<string | null>(start && inselNachId(start) ? start : null);
  const [rundflug, setRundflug] = useState(false);
  const [erledigt, setErledigt] = useState<Set<string>>(new Set());
  const [sichtbar, setSichtbar] = useState<Record<FlussArt, boolean>>({
    ware: true,
    geld: true,
    besucher: true,
    signale: true,
  });
  // Der spiegelnde Boden kostet Leistung — auf kleinen Bildschirmen (Handy) weglassen.
  const [spiegel] = useState(() => typeof window !== "undefined" && window.innerWidth >= 768);

  const etikettRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const meldeEtikett = useCallback<EtikettMelder>((id, el) => {
    etikettRefs.current[id] = el;
  }, []);

  const setzeEtikett = useCallback<EtikettSetzer>((id, zuSehen, x, y, tiefe) => {
    const el = etikettRefs.current[id];
    if (!el) return;
    el.style.visibility = zuSehen ? "visible" : "hidden";
    el.style.transform = `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    // Nähere Schilder liegen über weiter entfernten.
    el.style.zIndex = String(Math.round((1 - tiefe) * 100000));
  }, []);

  const insel = gewaehlt ? (inselNachId(gewaehlt) ?? null) : null;

  const waehle = (id: string | null) => {
    setRundflug(false);
    setGewaehlt(id);
  };

  // Rundflug: alle paar Sekunden zum nächsten Bereich.
  useEffect(() => {
    if (!rundflug) return;
    const timer = setInterval(() => {
      setGewaehlt((aktuell) => {
        const i = ALLE_INSELN.findIndex((x) => x.id === aktuell);
        return ALLE_INSELN[(i + 1) % ALLE_INSELN.length].id;
      });
    }, 6500);
    return () => clearInterval(timer);
  }, [rundflug]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setRundflug(false);
        setGewaehlt(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Die Zentrale sammelt alles ein, was in den Bereichen gerade brennt.
  const wichtig = useMemo(
    () =>
      INSELN.flatMap((i) =>
        i.vorschlaege.filter((v) => v.art !== "idee").map((v) => ({ ...v, insel: i })),
      ).sort((a, b) => (a.art === b.art ? 0 : a.art === "alarm" ? -1 : 1)),
    [],
  );

  const verbindungen = insel ? FLUESSE.filter((f) => f.von === insel.id || f.nach === insel.id) : [];

  return (
    <div className="relative h-[calc(100dvh-3.5rem)] w-full overflow-hidden md:h-dvh" style={{ background: HINTERGRUND }}>
      <Canvas
        camera={{ position: [0, 26, 70], fov: 34, near: 0.1, far: 400 }}
        dpr={[1, 1.75]}
        gl={{ antialias: true }}
        onPointerMissed={() => waehle(null)}
        fallback={
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-white/70">
            Dieser Browser kann die 3D-Ansicht nicht darstellen.
          </div>
        }
      >
        <Buehne spiegel={spiegel} />
        <Haarfall aktiv={gewaehlt === "zentrale"} onWahl={() => waehle("zentrale")} />
        {INSELN.map((i) => (
          <Sockel key={i.id} insel={i} aktiv={gewaehlt === i.id} onWahl={() => waehle(i.id)} />
        ))}
        {FLUESSE.map((f) => (
          <FlussLinie
            key={f.id}
            fluss={f}
            sichtbar={sichtbar[f.art]}
            betont={!!gewaehlt && (f.von === gewaehlt || f.nach === gewaehlt)}
          />
        ))}

        <Kamerafahrt ziel={insel} />
        <EtikettTracker setze={setzeEtikett} />

        <EffectComposer multisampling={4}>
          <Bloom mipmapBlur intensity={0.75} luminanceThreshold={1} luminanceSmoothing={0.3} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          <Noise opacity={0.03} />
          <Vignette darkness={0.7} offset={0.2} />
        </EffectComposer>
      </Canvas>

      {/* Beschriftung der Bereiche */}
      <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
        {ALLE_INSELN.map((i) => (
          <Etikett key={i.id} insel={i} versteckt={!!gewaehlt} melde={meldeEtikett} onWahl={() => waehle(i.id)} />
        ))}
      </div>

      {/* Titel */}
      <div className="pointer-events-none absolute left-5 top-5 z-30">
        <div className="text-[11px] font-medium uppercase tracking-[0.32em] text-white/90">Hairvenly</div>
        <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-white/35">Prototyp · Beispielzahlen</div>
      </div>

      {/* Legende + Rundflug */}
      <div className="absolute right-5 top-14 z-30 flex max-w-[calc(100%-2.5rem)] flex-wrap items-center justify-end gap-x-4 gap-y-2 md:top-5">
        {(Object.keys(FLUSS_ARTEN) as FlussArt[]).map((art) => (
          <button
            key={art}
            type="button"
            onClick={() => setSichtbar((s) => ({ ...s, [art]: !s[art] }))}
            className={`flex items-center gap-1.5 text-[11px] tracking-wide transition ${
              sichtbar[art] ? "text-white/75 hover:text-white" : "text-white/25 line-through"
            }`}
          >
            <span className="h-px w-4" style={{ background: FLUSS_ARTEN[art].farbe, opacity: sichtbar[art] ? 1 : 0.3 }} />
            {FLUSS_ARTEN[art].name}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            if (!rundflug && !gewaehlt) setGewaehlt("zentrale");
            setRundflug((r) => !r);
          }}
          className="flex items-center gap-1.5 rounded-full border border-white/20 px-3 py-1.5 text-[11px] tracking-wide text-white transition hover:border-white/50 hover:bg-white/5"
        >
          {rundflug ? <Square size={11} /> : <Play size={11} />}
          {rundflug ? "Rundflug stoppen" : "Rundflug"}
        </button>
      </div>

      {/* Detail-Karte */}
      {insel && (
        <aside
          className={`absolute inset-x-3 bottom-16 z-30 max-h-[54%] overflow-y-auto rounded-2xl p-5 text-white shadow-2xl md:inset-x-auto md:bottom-20 md:right-5 md:top-16 md:max-h-none md:w-[380px] ${KARTE}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className={UEBERSCHRIFT}>
                {insel.id === "zentrale" ? "Überblick" : insel.href ? "Bereich" : "Neuer Bereich · noch nicht gebaut"}
              </div>
              <h2 className="mt-1 flex items-center gap-2.5 text-2xl font-light tracking-tight">
                <span style={{ color: insel.farbe }}>
                  <LeistenIcon id={insel.id} farbe={insel.farbe} />
                </span>
                {insel.name}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => waehle(null)}
              aria-label="Schließen"
              className="rounded-full p-1.5 text-white/50 transition hover:bg-white/10 hover:text-white"
            >
              <X size={16} />
            </button>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-x-5 gap-y-4 border-y border-white/10 py-4">
            {insel.kpis.map((k) => (
              <div key={k.label}>
                <div className="text-[11px] text-white/45">{k.label}</div>
                <div className="mt-0.5 flex items-baseline gap-1.5">
                  <span className="text-xl font-light tabular-nums tracking-tight">{k.wert}</span>
                  {k.trend && (
                    <span className="text-[11px]" style={{ color: k.gut === false ? STATUS_FARBE.alarm : "#a9e5c9" }}>
                      {k.trend}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {insel.id === "zentrale" ? (
            <>
              <h3 className={`mt-5 ${UEBERSCHRIFT}`}>Heute wichtig</h3>
              <ul className="mt-2 divide-y divide-white/10">
                {wichtig.map((w) => (
                  <li key={w.id}>
                    <button
                      type="button"
                      onClick={() => waehle(w.insel.id)}
                      className="group flex w-full items-center gap-3 py-2.5 text-left"
                    >
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: ART_STIL[w.art].farbe }} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-white/90 group-hover:text-white">{w.titel}</span>
                        <span className="block text-[11px] text-white/40">{w.insel.name}</span>
                      </span>
                      <ArrowRight size={14} className="shrink-0 text-white/30 transition group-hover:translate-x-0.5 group-hover:text-white/80" />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <h3 className={`mt-5 ${UEBERSCHRIFT}`}>Vorbereitet für dich</h3>
              <ul className="mt-2 divide-y divide-white/10">
                {insel.vorschlaege.map((v) => {
                  const fertig = erledigt.has(v.id);
                  return (
                    <li key={v.id} className={`py-3 transition ${fertig ? "opacity-45" : ""}`}>
                      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em]" style={{ color: ART_STIL[v.art].farbe }}>
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: ART_STIL[v.art].farbe }} />
                        {ART_STIL[v.art].name}
                      </div>
                      <div className="mt-1.5 text-sm text-white/95">{v.titel}</div>
                      <div className="mt-1 text-xs leading-relaxed text-white/50">{v.detail}</div>
                      <div className="mt-2.5">
                        {fertig ? (
                          <span className="inline-flex items-center gap-1 text-xs text-white/60">
                            <Check size={13} /> Erledigt (nur Demo, nichts wurde ausgelöst)
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setErledigt((s) => new Set(s).add(v.id))}
                            className="rounded-full px-3.5 py-1.5 text-xs font-medium text-[#1a1510] transition hover:brightness-110"
                            style={{ background: AKZENT }}
                          >
                            {v.aktion}
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {verbindungen.length > 0 && (
            <>
              <h3 className={`mt-4 ${UEBERSCHRIFT}`}>Was hier fließt</h3>
              <ul className="mt-2 space-y-1.5">
                {verbindungen.map((f) => {
                  const rein = f.nach === insel.id;
                  const andere = inselNachId(rein ? f.von : f.nach)!;
                  return (
                    <li key={f.id} className="flex items-center gap-2.5 text-xs text-white/70">
                      <span className="h-px w-3 shrink-0" style={{ background: FLUSS_ARTEN[f.art].farbe }} />
                      <span className="min-w-0 flex-1">{f.text}</span>
                      <button
                        type="button"
                        onClick={() => waehle(andere.id)}
                        className="shrink-0 text-white/40 underline-offset-2 hover:text-white hover:underline"
                      >
                        {rein ? "von" : "an"} {andere.name}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {insel.href && (
            <Link
              href={insel.href}
              className="mt-5 flex items-center justify-center gap-1.5 rounded-full border border-white/20 px-3 py-2 text-xs tracking-wide transition hover:border-white/50 hover:bg-white/5"
            >
              Bereich öffnen <ArrowRight size={13} />
            </Link>
          )}
        </aside>
      )}

      {/* Leiste unten: Sprung zu jedem Bereich */}
      <nav className="absolute inset-x-0 bottom-4 z-30 flex justify-center px-3">
        <div className={`flex max-w-full gap-0.5 overflow-x-auto rounded-full p-1 ${KARTE}`}>
          {LEISTE.map((i) => (
            <button
              key={i.id ?? "ueberblick"}
              type="button"
              onClick={() => waehle(i.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] tracking-wide transition ${
                gewaehlt === i.id ? "bg-white/15 text-white" : "text-white/50 hover:text-white"
              }`}
            >
              <LeistenIcon id={i.id} farbe={i.farbe} />
              {i.name}
              {i.status !== "ok" && (
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_FARBE[i.status] }} />
              )}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
