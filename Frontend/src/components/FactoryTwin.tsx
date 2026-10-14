"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { ReactorState } from "../lib/executiveDemo";

type Props = {
  reactors: ReactorState[];
  raw: number;
  fg: number;
  producing: number;
  selected: string;
  view: "plant" | "top";
  reset: number;
  atmosphere?: "day" | "night";
  orbit?: boolean;
  onSelect: (id: string) => void;
};
const STATUS_COLORS = {
  Producing: 0x43c6a4,
  Cleaning: 0xf0bd62,
  Standby: 0x869c99,
  "Material hold": 0xf08971,
};
export default function FactoryTwin(input: Props) {
  const props = { ...input, atmosphere: input.atmosphere ?? 'day', orbit: input.orbit ?? false };
  const host = useRef<HTMLDivElement>(null);
  const state = useRef(props);
  state.current = props;
  const api = useRef<{ update: () => void; camera: () => void }>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
      });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.setAttribute(
      "aria-label",
      "Illustrative 3D factory state",
    );
    renderer.domElement.setAttribute("role", "img");
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const environment = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const reflections = pmrem.fromScene(environment, 0.04);
    scene.environment = reflections.texture;
    scene.environmentIntensity = 0.55;
    environment.dispose();
    pmrem.dispose();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 70);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 12;
    controls.maxDistance = 40;
    controls.maxPolarAngle = Math.PI / 2.2;
    controls.target.set(0, 0.8, 0);
    controls.autoRotateSpeed = 0.45;
    let fitFactor = 1;
    let cameraDestination: THREE.Vector3 | null = null;
    const resetCamera = (instant = false) => {
      const destination = new THREE.Vector3(
        ...((state.current.view === "top" ? [0.1, 19, 0.1] : [12, 10, 14]) as [
          number,
          number,
          number,
        ]),
      );
      fitFactor = Math.max(1, 1.15 / camera.aspect);
      destination
        .sub(controls.target)
        .multiplyScalar(fitFactor)
        .add(controls.target);
      if (instant || reduced) camera.position.copy(destination);
      else cameraDestination = destination;
      controls.update();
    };
    resetCamera(true);
    controls.addEventListener("start", () => { cameraDestination = null; });
    const ambient = new THREE.HemisphereLight(0xe7f7ff, 0x8b9e8f, 1.5);
    scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(2, 12, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.normalBias = 0.03;
    sun.shadow.camera.left = -10;
    sun.shadow.camera.right = 10;
    sun.shadow.camera.top = 10;
    sun.shadow.camera.bottom = -10;
    scene.add(sun);
    const rim = new THREE.DirectionalLight(0x93c7da, 1.8);
    rim.position.set(-8, 5, -6);
    scene.add(rim);
    const materials: THREE.Material[] = [];
    const metal = new THREE.MeshStandardMaterial({
      color: 0xa7b3b7,
      roughness: 0.35,
      metalness: 0.8,
    });
    const dark = new THREE.MeshStandardMaterial({
      color: 0x456166,
      roughness: 0.7,
      metalness: 0.25,
    });
    const pipeMat = new THREE.MeshStandardMaterial({
      color: 0x90aeb6,
      metalness: 0.65,
      roughness: 0.3,
    });
    const yellow = new THREE.MeshStandardMaterial({
      color: 0xe7bb58,
      roughness: 0.7,
    });
    materials.push(metal, dark, pipeMat, yellow);
    const solid = (
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      x: number,
      y: number,
      z: number,
      parent: THREE.Object3D = scene,
    ) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x778f87,
      roughness: 1,
    });
    materials.push(floorMat);
    solid(new THREE.BoxGeometry(14, 0.16, 10), floorMat, 0, -0.08, 0);
    const grid = new THREE.GridHelper(14, 28, 0x637d71, 0x7c9589);
    grid.scale.z = 10 / 14;
    grid.position.y = 0.012;
    scene.add(grid);
    const pads = new THREE.MeshStandardMaterial({
      color: 0x78958c,
      roughness: 1,
    });
    materials.push(pads);
    const positions = [
      new THREE.Vector3(-2, 0, -1.5),
      new THREE.Vector3(-2, 0, 1.5),
      new THREE.Vector3(2, 0, -1.5),
      new THREE.Vector3(2, 0, 1.5),
    ];
    const reactors: {
      group: THREE.Group;
      status: THREE.MeshBasicMaterial;
      selection: THREE.MeshBasicMaterial;
      label: HTMLButtonElement;
    }[] = [];
    const pickables: THREE.Object3D[] = [];
    const impellers: THREE.Group[] = [];
    positions.forEach((position, index) => {
      const group = new THREE.Group();
      group.position.copy(position);
      scene.add(group);
      group.userData.id = `RX${index + 1}`;
      solid(new THREE.BoxGeometry(2.25, 0.13, 2.5), pads, 0, 0.06, 0, group);
      for (const x of [-0.48, 0.48])
        for (const z of [-0.45, 0.45])
          solid(
            new THREE.CylinderGeometry(0.065, 0.065, 0.6, 8),
            dark,
            x,
            0.45,
            z,
            group,
          );
      const body = solid(
        new THREE.CylinderGeometry(0.72, 0.72, 1.75, 40),
        metal,
        0,
        1.6,
        0,
        group,
      );
      pickables.push(body);
      solid(
        new THREE.SphereGeometry(0.72, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2),
        metal,
        0,
        2.475,
        0,
        group,
      );
      solid(
        new THREE.CylinderGeometry(0.15, 0.15, 0.3, 16),
        dark,
        0,
        3.25,
        0,
        group,
      );
      const motor = new THREE.Group();
      motor.position.set(0, 3.47, 0);
      group.add(motor);
      solid(new THREE.CylinderGeometry(0.23, 0.23, 0.16, 20), dark, 0, 0, 0, motor);
      for (let blade = 0; blade < 4; blade++) {
        const vane = solid(new THREE.BoxGeometry(0.46, 0.04, 0.1), metal, 0, 0.1, 0, motor);
        vane.rotation.y = blade * Math.PI / 4;
      }
      impellers.push(motor);
      for (const height of [0.92, 2.05]) {
        const band = solid(new THREE.TorusGeometry(0.727, 0.024, 6, 40), pipeMat, 0, height, 0, group);
        band.rotation.x = Math.PI / 2;
      }
      for (let rung = 0; rung < 8; rung++) {
        solid(new THREE.BoxGeometry(0.28, 0.035, 0.06), pipeMat, 0.82, 0.66 + rung * 0.26, 0, group);
      }
      for (const z of [-0.14, 0.14]) solid(new THREE.BoxGeometry(0.035, 2.25, 0.035), pipeMat, 0.82, 1.57, z, group);
      const status = new THREE.MeshBasicMaterial({
        color: STATUS_COLORS.Standby,
      });
      materials.push(status);
      solid(
        new THREE.CylinderGeometry(0.733, 0.733, 0.13, 40),
        status,
        0,
        1.48,
        0,
        group,
      );
      const ring = solid(
        new THREE.TorusGeometry(0.74, 0.025, 6, 40),
        pipeMat,
        0,
        2.28,
        0,
        group,
      );
      ring.rotation.x = Math.PI / 2;
      const selection = new THREE.MeshBasicMaterial({
        color: 0x55e4ba,
        transparent: true,
        opacity: 0.13,
      });
      materials.push(selection);
      const disc = solid(
        new THREE.CylinderGeometry(1.02, 1.02, 0.018, 40),
        selection,
        0,
        0.16,
        0,
        group,
      );
      disc.castShadow = false;
      const label = document.createElement("button");
      label.className = "factory-label";
      label.setAttribute("aria-label", `Inspect reactor RX${index + 1}`);
      label.onclick = () => state.current.onSelect(`RX${index + 1}`);
      container.appendChild(label);
      reactors.push({ group, status, selection, label });
    });
    // Walkway, utility skids and lights are illustrative scene details only.
    solid(new THREE.BoxGeometry(9, 0.15, 0.72), dark, 0, 0.45, -3.45);
    for (let post = 0; post < 13; post++) {
      const x = -4.35 + post * 0.72;
      solid(new THREE.CylinderGeometry(0.024, 0.024, 0.65, 6), yellow, x, 0.85, -3.76);
    }
    solid(new THREE.BoxGeometry(8.8, 0.045, 0.045), yellow, 0, 1.18, -3.76);
    for (const x of [-3.6, 0, 3.6]) {
      solid(new THREE.BoxGeometry(0.7, 0.66, 0.38), dark, x, 0.47, -4.35);
      solid(new THREE.BoxGeometry(0.38, 0.22, 0.025), tankScreenMaterial(), x, 0.6, -4.14);
    }
    function tankScreenMaterial() {
      const material = new THREE.MeshStandardMaterial({ color: 0x63cfb1, emissive: 0x2a9278, emissiveIntensity: 0.6 });
      materials.push(material);
      return material;
    }
    // The model is a schematic process layout, not a reconstruction of company equipment.
    const pipe = (points: THREE.Vector3[]) =>
      solid(
        new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3(points),
          28,
          0.085,
          8,
          false,
        ),
        pipeMat,
        0,
        0,
        0,
      );
    pipe([
      new THREE.Vector3(-5, 1.1, -1),
      new THREE.Vector3(-5, 1.1, 3.2),
      new THREE.Vector3(4, 1.1, 3.2),
    ]);
    positions.forEach((p) =>
      pipe([
        new THREE.Vector3(p.x, 1.1, p.z),
        new THREE.Vector3(p.x + 0.8, 1.1, p.z),
        new THREE.Vector3(p.x + 0.8, 1.1, 3.2),
      ]),
    );
    solid(new THREE.CylinderGeometry(1.02, 1.02, 2.4, 40), metal, -5, 1.35, 2);
    solid(new THREE.CylinderGeometry(1.07, 1.07, 0.16, 40), dark, -5, 2.55, 2);
    const tankMaterial = new THREE.MeshStandardMaterial({
      color: 0x349d9a,
      roughness: 0.5,
    });
    materials.push(tankMaterial);
    const tankLevel = solid(
      new THREE.BoxGeometry(0.13, 1.9, 0.2),
      tankMaterial,
      -4,
      1.25,
      2,
    );
    const palletMat = new THREE.MeshStandardMaterial({
      color: 0xd7b479,
      roughness: 1,
    });
    materials.push(palletMat);
    const productMat = new THREE.MeshStandardMaterial({
      color: 0xe8eee4,
      roughness: 0.85,
    });
    materials.push(productMat);
    const cargo: THREE.Group[] = [];
    for (let i = 0; i < 5; i++) {
      const group = new THREE.Group();
      group.position.set(4.7, 0, -3.2 + i * 1.5);
      scene.add(group);
      solid(new THREE.BoxGeometry(1.1, 0.15, 1), palletMat, 0, 0.18, 0, group);
      for (const x of [-0.27, 0.27])
        for (const z of [-0.23, 0.23])
          solid(
            new THREE.BoxGeometry(0.5, 0.7, 0.4),
            productMat,
            x,
            0.6,
            z,
            group,
          );
      cargo.push(group);
    }
    for (let i = 0; i < 7; i++) {
      const stripe = solid(
        new THREE.BoxGeometry(0.36, 0.015, 0.1),
        yellow,
        -3 + i,
        0.015,
        4.25,
      );
      stripe.rotation.y = -0.5;
    }
    const flowMat = new THREE.MeshBasicMaterial({ color: 0x46dbb5 });
    materials.push(flowMat);
    const flow = Array.from({ length: 8 }, () =>
      solid(new THREE.SphereGeometry(0.09, 10, 8), flowMat, 0, 1.12, 3.2),
    );
    const lampLights: THREE.PointLight[] = [];
    const lampMaterial = new THREE.MeshStandardMaterial({ color: 0xffe6ad, emissive: 0xffd88b, emissiveIntensity: 0.4 });
    materials.push(lampMaterial);
    for (const x of [-6, 6]) {
      for (const z of [-4.5, 4.5]) {
        solid(new THREE.CylinderGeometry(0.035, 0.035, 2.7, 8), dark, x, 1.35, z);
        solid(new THREE.BoxGeometry(0.35, 0.07, 0.3), lampMaterial, x, 2.72, z);
        const light = new THREE.PointLight(0xffda9c, 0, 6);
        light.position.set(x, 2.6, z);
        scene.add(light);
        lampLights.push(light);
      }
    }
    const update = () => {
      const night = state.current.atmosphere === "night";
      ambient.intensity = night ? 0.55 : 1.5;
      sun.intensity = night ? 0.5 : 2;
      rim.intensity = night ? 1.3 : 1.1;
      scene.environmentIntensity = night ? 0.2 : 0.55;
      renderer.toneMappingExposure = night ? 0.85 : 0.95;
      lampMaterial.emissiveIntensity = night ? 3 : 0.4;
      lampLights.forEach(light => { light.intensity = night ? 8 : 0; });
      floorMat.color.set(night ? 0x2d4543 : 0x778f87);
      renderer.domElement.dataset.atmosphere = state.current.atmosphere;
      state.current.reactors.forEach((r, i) => {
        reactors[i].status.color.set(STATUS_COLORS[r.status]);
        reactors[i].selection.opacity =
          state.current.selected === r.id ? 0.5 : 0.1;
        reactors[i].label.textContent = `${r.id} / ${r.status}`;
        reactors[i].label.dataset.status = r.status;
        reactors[i].label.dataset.selected = String(state.current.selected === r.id);
      });
      tankLevel.scale.y = Math.max(0.04, Math.min(1, state.current.raw / 5000));
      tankLevel.position.y = 0.3 + 0.95 * tankLevel.scale.y;
      cargo.forEach((c, i) => {
        c.visible = i < Math.ceil(Math.min(1, state.current.fg / 5000) * 5);
      });
      renderer.domElement.dataset.producing = String(state.current.producing);
    };
    api.current = { update, camera: () => resetCamera() };
    update();
    const raycaster = new THREE.Raycaster();
    let start = { x: 0, y: 0 };
    const down = (e: PointerEvent) => {
      start = { x: e.clientX, y: e.clientY };
    };
    const up = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 5) return;
      const r = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - r.left) / r.width) * 2 - 1,
          (-(e.clientY - r.top) / r.height) * 2 + 1,
        ),
        camera,
      );
      const picked =
        raycaster.intersectObjects(pickables)[0]?.object.parent?.userData.id;
      if (picked) state.current.onSelect(picked);
    };
    renderer.domElement.addEventListener("pointerdown", down);
    renderer.domElement.addEventListener("pointerup", up);
    const resize = new ResizeObserver(() => {
      if (!container.clientWidth || !container.clientHeight) return;
      renderer.setSize(container.clientWidth, container.clientHeight);
      camera.aspect = container.clientWidth / container.clientHeight;
      const nextFit = Math.max(1, 1.15 / camera.aspect);
      if (cameraDestination) cameraDestination.sub(controls.target).multiplyScalar(nextFit / fitFactor).add(controls.target);
      camera.position
        .sub(controls.target)
        .multiplyScalar(nextFit / fitFactor)
        .add(controls.target);
      fitFactor = nextFit;
      controls.update();
      camera.updateProjectionMatrix();
    });
    resize.observe(container);
    let frame = 0;
    let previousTime = 0;
    const animate = (now: number) => {
      const delta = Math.min(0.05, (now - previousTime) / 1000);
      previousTime = now;
      if (cameraDestination) {
        camera.position.lerp(cameraDestination, 1 - Math.exp(-6 * delta));
        if (camera.position.distanceTo(cameraDestination) < 0.02) { camera.position.copy(cameraDestination); cameraDestination = null; }
      }
      controls.autoRotate = state.current.orbit && !reduced && !cameraDestination;
      controls.update();
      impellers.forEach((motor, i) => {
        if (!reduced && state.current.reactors[i]?.status === "Producing") motor.rotation.y += delta * 2.2;
      });
      flow.forEach((bead, i) => {
        bead.visible = state.current.producing > 0;
        bead.position.x = -4.7 + (((reduced ? 0 : now / 2200) + i / 8) % 1) * 9;
      });
      reactors.forEach((r) => {
        const point = r.group.position
          .clone()
          .add(new THREE.Vector3(0, 3.7, 0))
          .project(camera);
        const x = ((point.x + 1) * container.clientWidth) / 2,
          y = ((1 - point.y) * container.clientHeight) / 2;
        r.label.style.display =
          point.z < 1 &&
          x > 5 &&
          x < container.clientWidth - 5 &&
          y > 5 &&
          y < container.clientHeight - 5
            ? "block"
            : "none";
        r.label.style.left = `${x}px`;
        r.label.style.top = `${y}px`;
      });
      renderer.render(scene, camera);
      renderer.domElement.dataset.ready = "true";
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    const lost = (e: Event) => {
      e.preventDefault();
      setFailed(true);
      cancelAnimationFrame(frame);
    };
    renderer.domElement.addEventListener("webglcontextlost", lost);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", down);
      renderer.domElement.removeEventListener("pointerup", up);
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      scene.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      grid.dispose();
      materials.forEach((m) => m.dispose());
      reflections.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      reactors.forEach((r) => r.label.remove());
      api.current = undefined;
    };
  }, []);
  useEffect(() => {
    api.current?.update();
  }, [props.reactors, props.raw, props.fg, props.producing, props.selected, props.atmosphere]);
  useEffect(() => {
    api.current?.camera();
  }, [props.view, props.reset]);
  return (
    <div className="factory-twin" ref={host} data-failed={failed}>
      {failed && (
        <span className="factory-fallback" role="status">
          3D unavailable / reactor state and business metrics remain available
        </span>
      )}
    </div>
  );
}
