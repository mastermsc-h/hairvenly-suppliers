"use client";

// Symbol-Skulpturen: Jeder Bereich hat ein eigenes, sofort erkennbares Zeichen
// aus Metall und Licht in seiner Bereichsfarbe — Globus, Kartons, Papierflieger,
// Einkaufstasche, Megafon, Play-Taste, Sprechblase, Personen, Schere, Münzen.

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Edges, RoundedBox } from "@react-three/drei";
import * as THREE from "three";

type V3 = [number, number, number];
type Teil = { farbe: string };

const hell = (farbe: string, faktor: number) => new THREE.Color(farbe).multiplyScalar(faktor);

function Metall({ farbe }: Teil) {
  return <meshStandardMaterial color={farbe} metalness={0.85} roughness={0.3} emissive={farbe} emissiveIntensity={0.22} />;
}

function Licht({ farbe, kraft = 2.2 }: Teil & { kraft?: number }) {
  return <meshBasicMaterial color={hell(farbe, kraft)} toneMapped={false} />;
}

function Kanten({ farbe }: Teil) {
  return <Edges threshold={20} color={hell(farbe, 2.4)} toneMapped={false} />;
}

/** Dreht das Symbol langsam wie auf einem Drehteller. Flache Symbole pendeln nur,
 *  damit man sie nie von der Kante sieht. */
function Dreh({ children, pendeln = false, y = 0 }: { children: React.ReactNode; pendeln?: boolean; y?: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    ref.current.rotation.y = pendeln ? Math.sin(clock.elapsedTime * 0.5) * 0.45 : clock.elapsedTime * 0.3;
    ref.current.position.y = y + Math.sin(clock.elapsedTime * 0.9) * 0.05;
  });
  return <group ref={ref}>{children}</group>;
}

/* --- Einkauf: Globus mit Umlaufbahn -------------------------------- */
function Globus({ farbe }: Teil) {
  const bahn = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (bahn.current) bahn.current.rotation.z = clock.elapsedTime * 0.9;
  });
  return (
    <Dreh y={1.45}>
      <mesh>
        <sphereGeometry args={[0.92, 48, 32]} />
        <meshStandardMaterial color="#14131a" metalness={0.9} roughness={0.35} />
      </mesh>
      {/* Breitengrade */}
      {[-0.55, 0, 0.55].map((h) => (
        <mesh key={h} position={[0, h, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[Math.sqrt(0.94 * 0.94 - h * h), 0.014, 8, 72]} />
          <Licht farbe={farbe} />
        </mesh>
      ))}
      {/* Längengrade */}
      {[0, Math.PI / 3, (2 * Math.PI) / 3].map((w) => (
        <mesh key={w} rotation={[0, w, 0]}>
          <torusGeometry args={[0.94, 0.014, 8, 72]} />
          <Licht farbe={farbe} />
        </mesh>
      ))}
      {/* Lieferung auf dem Weg um die Welt */}
      <group rotation={[Math.PI / 2.6, 0.3, 0]}>
        <mesh>
          <torusGeometry args={[1.3, 0.008, 6, 96]} />
          <meshBasicMaterial color={farbe} transparent opacity={0.45} />
        </mesh>
        <group ref={bahn}>
          <mesh position={[1.3, 0, 0]}>
            <sphereGeometry args={[0.09, 16, 16]} />
            <Licht farbe={farbe} kraft={3.2} />
          </mesh>
        </group>
      </group>
    </Dreh>
  );
}

/* --- Lager: gestapelte Kartons -------------------------------------- */
function Kartons({ farbe }: Teil) {
  const kisten: V3[] = [
    [-0.66, 0.31, 0],
    [0, 0.31, 0],
    [0.66, 0.31, 0],
    [-0.33, 0.95, 0],
    [0.33, 0.95, 0],
    [0, 1.59, 0],
  ];
  return (
    <Dreh>
      {kisten.map((p, i) => (
        <mesh key={i} position={p}>
          <boxGeometry args={[0.6, 0.6, 0.6]} />
          <Metall farbe={farbe} />
          <Kanten farbe={farbe} />
        </mesh>
      ))}
    </Dreh>
  );
}

/* --- Versand: Papierflieger mit Lichtspur --------------------------- */
function Papierflieger({ farbe }: Teil) {
  const geometrie = useMemo(() => {
    const g = new THREE.BufferGeometry();
    // Nase, linke/rechte Flügelspitze, hintere Mitte oben, Kiel unten
    const N = [0, 0, 1.3], L = [-0.95, 0.12, -0.9], R = [0.95, 0.12, -0.9], C = [0, 0.12, -0.9], K = [0, -0.4, -0.9];
    g.setAttribute("position", new THREE.Float32BufferAttribute([...N, ...L, ...C, ...N, ...C, ...R, ...N, ...C, ...K], 3));
    g.computeVertexNormals();
    return g;
  }, []);
  const spur = useMemo(
    () =>
      [-0.5, 0.5].map(
        (x) =>
          new THREE.QuadraticBezierCurve3(
            new THREE.Vector3(x, 0.05, -1),
            new THREE.Vector3(x * 1.4, -0.25, -1.9),
            new THREE.Vector3(x * 1.1, -0.75, -2.7),
          ),
      ),
    [],
  );
  return (
    <Dreh y={1.5}>
      <group rotation={[-0.35, 0, 0.12]}>
        <mesh geometry={geometrie}>
          <meshStandardMaterial color={farbe} metalness={0.7} roughness={0.35} emissive={farbe} emissiveIntensity={0.3} side={THREE.DoubleSide} flatShading />
          <Kanten farbe={farbe} />
        </mesh>
        {spur.map((k, i) => (
          <mesh key={i}>
            <tubeGeometry args={[k, 24, 0.012, 5, false]} />
            <meshBasicMaterial color={hell(farbe, 1.6)} toneMapped={false} transparent opacity={0.6} />
          </mesh>
        ))}
      </group>
    </Dreh>
  );
}

/* --- Online-Shop: Einkaufstasche ------------------------------------ */
function Tasche({ farbe }: Teil) {
  return (
    <Dreh>
      <mesh position={[0, 0.78, 0]}>
        <boxGeometry args={[1.25, 1.5, 0.55]} />
        <Metall farbe={farbe} />
        <Kanten farbe={farbe} />
      </mesh>
      {[-0.2, 0.2].map((z) => (
        <mesh key={z} position={[0, 1.53, z]}>
          <torusGeometry args={[0.34, 0.03, 10, 40, Math.PI]} />
          <Licht farbe={farbe} />
        </mesh>
      ))}
    </Dreh>
  );
}

/* --- Marketing: Megafon mit Schallwellen ---------------------------- */
function Megafon({ farbe }: Teil) {
  const wellen = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    wellen.current?.children.forEach((welle, i) => {
      const phase = (clock.elapsedTime * 0.5 + i / 3) % 1;
      welle.position.x = 0.85 + phase * 0.9;
      welle.scale.setScalar(0.55 + phase * 0.75);
      ((welle as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = Math.sin(phase * Math.PI);
    });
  });
  return (
    <Dreh y={1.25}>
      <group rotation={[0, 0, 0.3]}>
        {/* Trichter: schmal hinten, weit vorne */}
        <mesh rotation={[0, 0, -Math.PI / 2]}>
          <cylinderGeometry args={[0.72, 0.16, 1.4, 40, 1, true]} />
          <meshStandardMaterial color={farbe} metalness={0.85} roughness={0.3} emissive={farbe} emissiveIntensity={0.22} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0.7, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
          <torusGeometry args={[0.72, 0.025, 10, 64]} />
          <Licht farbe={farbe} />
        </mesh>
        <mesh position={[-0.85, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
          <cylinderGeometry args={[0.16, 0.16, 0.35, 24]} />
          <Metall farbe={farbe} />
        </mesh>
        <mesh position={[-0.55, -0.42, 0]}>
          <boxGeometry args={[0.14, 0.6, 0.14]} />
          <Metall farbe={farbe} />
        </mesh>
        <group ref={wellen}>
          {[0, 1, 2].map((i) => (
            <mesh key={i} rotation={[0, Math.PI / 2, 0]}>
              <torusGeometry args={[0.8, 0.018, 8, 48, Math.PI * 0.7]} />
              <meshBasicMaterial color={hell(farbe, 2.2)} toneMapped={false} transparent />
            </mesh>
          ))}
        </group>
      </group>
    </Dreh>
  );
}

/* --- Content: Play-Taste im Bildrahmen ------------------------------ */
function PlayTaste({ farbe }: Teil) {
  return (
    <Dreh pendeln y={1.25}>
      <RoundedBox args={[2.1, 1.4, 0.16]} radius={0.16} smoothness={6}>
        <meshStandardMaterial color="#14131a" metalness={0.9} roughness={0.3} />
      </RoundedBox>
      {/* leuchtender Rahmen */}
      <RoundedBox args={[2.22, 1.52, 0.06]} radius={0.2} smoothness={6}>
        <meshBasicMaterial color={hell(farbe, 1.5)} toneMapped={false} />
      </RoundedBox>
      {[1, -1].map((seite) => (
        <mesh key={seite} position={[0.06, 0, seite * 0.1]} rotation={[Math.PI / 2, Math.PI / 2, 0]}>
          <cylinderGeometry args={[0.36, 0.36, 0.04, 3]} />
          <Licht farbe={farbe} kraft={2.8} />
        </mesh>
      ))}
    </Dreh>
  );
}

/* --- Kundenservice: Sprechblase mit drei Punkten -------------------- */
function Sprechblase({ farbe }: Teil) {
  const punkte = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    punkte.current?.children.forEach((punkt, i) => {
      punkt.position.y = Math.max(0, Math.sin(clock.elapsedTime * 3 - i * 0.7)) * 0.12;
    });
  });
  return (
    <Dreh pendeln y={1.45}>
      <RoundedBox args={[2, 1.3, 0.3]} radius={0.3} smoothness={8}>
        <Metall farbe={farbe} />
      </RoundedBox>
      {/* Zipfel der Sprechblase */}
      <mesh position={[-0.5, -0.8, 0]} rotation={[0, 0, Math.PI - 0.35]} scale={[1, 1, 0.5]}>
        <coneGeometry args={[0.26, 0.55, 4]} />
        <Metall farbe={farbe} />
      </mesh>
      <group ref={punkte}>
        {[-0.5, 0, 0.5].map((x) => (
          <group key={x}>
            {[0.17, -0.17].map((z) => (
              <mesh key={z} position={[x, 0, z]}>
                <sphereGeometry args={[0.12, 20, 20]} />
                <meshBasicMaterial color={hell("#ffffff", 2.4)} toneMapped={false} />
              </mesh>
            ))}
          </group>
        ))}
      </group>
    </Dreh>
  );
}

/* --- Team: drei Personen -------------------------------------------- */
function Personen({ farbe }: Teil) {
  const leute: { x: number; z: number; g: number }[] = [
    { x: -0.75, z: -0.15, g: 0.8 },
    { x: 0.75, z: -0.15, g: 0.8 },
    { x: 0, z: 0.2, g: 1 },
  ];
  return (
    <Dreh pendeln>
      {leute.map((p) => (
        <group key={p.x} position={[p.x, 0, p.z]} scale={p.g}>
          <mesh position={[0, 0.62, 0]}>
            <cylinderGeometry args={[0.2, 0.48, 1.2, 32]} />
            <Metall farbe={farbe} />
          </mesh>
          <mesh position={[0, 1.2, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.21, 0.02, 8, 32]} />
            <Licht farbe={farbe} />
          </mesh>
          <mesh position={[0, 1.62, 0]}>
            <sphereGeometry args={[0.3, 32, 24]} />
            <Metall farbe={farbe} />
          </mesh>
        </group>
      ))}
    </Dreh>
  );
}

/* --- Salon: Schere --------------------------------------------------- */
function Schere({ farbe }: Teil) {
  const a = useRef<THREE.Group>(null);
  const b = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    // schneidet ganz langsam auf und zu
    const auf = 0.3 + Math.sin(clock.elapsedTime * 1.4) * 0.12;
    if (a.current) a.current.rotation.z = auf;
    if (b.current) b.current.rotation.z = -auf;
  });
  const haelfte = (seite: number) => (
    <>
      {/* Klinge */}
      <mesh position={[0, 0.85, seite * 0.03]} scale={[1, 1, 0.25]}>
        <coneGeometry args={[0.17, 1.7, 4]} />
        <meshStandardMaterial color="#e9e6f0" metalness={0.8} roughness={0.25} emissive={farbe} emissiveIntensity={0.45} />
        <Kanten farbe={farbe} />
      </mesh>
      {/* Griff */}
      <mesh position={[seite * 0.12, -0.3, seite * 0.03]}>
        <boxGeometry args={[0.08, 0.5, 0.06]} />
        <Metall farbe={farbe} />
      </mesh>
      <mesh position={[seite * 0.2, -0.82, seite * 0.03]}>
        <torusGeometry args={[0.3, 0.055, 12, 40]} />
        <Metall farbe={farbe} />
      </mesh>
    </>
  );
  return (
    <Dreh pendeln y={1.35}>
      <group ref={a}>{haelfte(1)}</group>
      <group ref={b}>{haelfte(-1)}</group>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.07, 0.07, 0.16, 20]} />
        <Licht farbe={farbe} kraft={2.8} />
      </mesh>
    </Dreh>
  );
}

/* --- Finanzen: Münzstapel -------------------------------------------- */
function Muenzen({ farbe }: Teil) {
  const stapel: { x: number; z: number; n: number }[] = [
    { x: -0.72, z: 0.1, n: 4 },
    { x: 0, z: -0.15, n: 7 },
    { x: 0.72, z: 0.1, n: 11 },
  ];
  return (
    <Dreh>
      {stapel.map((s) => (
        <group key={s.x} position={[s.x, 0, s.z]}>
          {Array.from({ length: s.n }, (_, i) => (
            <mesh key={i} position={[0, 0.07 + i * 0.16, 0]}>
              <cylinderGeometry args={[0.36, 0.36, 0.11, 40]} />
              <Metall farbe={farbe} />
            </mesh>
          ))}
          <mesh position={[0, s.n * 0.16 - 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.2, 0.3, 40]} />
            <Licht farbe={farbe} />
          </mesh>
        </group>
      ))}
    </Dreh>
  );
}

export function BereichSymbol({ id, farbe }: { id: string; farbe: string }) {
  switch (id) {
    case "einkauf":
      return <Globus farbe={farbe} />;
    case "lager":
      return <Kartons farbe={farbe} />;
    case "versand":
      return <Papierflieger farbe={farbe} />;
    case "shop":
      return <Tasche farbe={farbe} />;
    case "marketing":
      return <Megafon farbe={farbe} />;
    case "content":
      return <PlayTaste farbe={farbe} />;
    case "service":
      return <Sprechblase farbe={farbe} />;
    case "team":
      return <Personen farbe={farbe} />;
    case "salon":
      return <Schere farbe={farbe} />;
    case "finanzen":
      return <Muenzen farbe={farbe} />;
    default:
      return null;
  }
}
