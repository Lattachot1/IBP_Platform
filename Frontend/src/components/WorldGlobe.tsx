"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  PORTS,
  Port,
  Shipment,
  port,
  shipmentState,
} from "../lib/logisticsDemo";

type Props = {
  shipments: Shipment[];
  day: number;
  delay: number;
  selected: string;
  rotating: boolean;
  focus: { port: string; revision: number };
  onSelect: (id: string) => void;
};
function vector(p: Port, radius = 1) {
  const lat = THREE.MathUtils.degToRad(p.lat);
  const lon = THREE.MathUtils.degToRad(p.lon);
  return new THREE.Vector3(
    Math.cos(lat) * Math.cos(lon),
    Math.sin(lat),
    -Math.cos(lat) * Math.sin(lon),
  ).multiplyScalar(radius);
}
function arcPoint(a: THREE.Vector3, b: THREE.Vector3, t: number) {
  const angle = a.angleTo(b);
  const point =
    angle < 0.0001
      ? a.clone()
      : a
          .clone()
          .multiplyScalar(Math.sin((1 - t) * angle))
          .addScaledVector(b, Math.sin(t * angle))
          .divideScalar(Math.sin(angle));
  return point
    .normalize()
    .multiplyScalar(1.014 + Math.sin(Math.PI * t) * (0.08 + angle * 0.14));
}
function disposeGroup(group: THREE.Group) {
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    mesh.geometry?.dispose();
    if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose());
    else mesh.material?.dispose();
  });
  group.clear();
}
export default function WorldGlobe(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const api = useRef<{ refresh: () => void; focus: (id: string) => void }>();
  const [status, setStatus] = useState("loading");
  const [hover, setHover] = useState("");
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
      });
    } catch {
      setStatus("unavailable");
      return;
    }
    let disposed = false;
    let texture: THREE.Texture | undefined;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute(
      "aria-label",
      "Interactive logistics globe",
    );
    renderer.domElement.setAttribute("role", "img");
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(39, 1, 0.1, 30);
    camera.position.copy(
      vector({ id: "view", name: "", country: "", lat: 17, lon: 94 }, 3.6),
    );
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 2.35;
    controls.maxDistance = 5.8;
    controls.autoRotateSpeed = 0.3;
    scene.add(new THREE.AmbientLight(0xffffff, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    scene.add(sun);
    const earth = new THREE.Mesh(
      new THREE.SphereGeometry(1, 96, 64),
      new THREE.MeshStandardMaterial({ color: 0xb8e0db, roughness: 1 }),
    );
    scene.add(earth);
    new THREE.TextureLoader().load(
      "/images/earth-day.jpg",
      (loaded) => {
        if (disposed) {
          loaded.dispose();
          return;
        }
        texture = loaded;
        loaded.colorSpace = THREE.SRGBColorSpace;
        earth.material.map = loaded;
        earth.material.color.set(0xffffff);
        earth.material.needsUpdate = true;
        renderer.domElement.dataset.texture = "loaded";
        setStatus("ready");
      },
      undefined,
      () => {
        if (!disposed) setStatus("texture-error");
      },
    );
    const routes = new THREE.Group();
    scene.add(routes);
    const labels = ["origin", "destination"].map(() => {
      const label = document.createElement("span");
      label.className = "globe-port-label";
      label.setAttribute("aria-hidden", "true");
      element.appendChild(label);
      return label;
    });
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let picks: THREE.Object3D[] = [];
    let pulses: THREE.Mesh[] = [];
    const refresh = () => {
      disposeGroup(routes);
      picks = [];
      pulses = [];
      const { shipments, selected, day, delay } = latest.current;
      const endpoints = new Set(
        shipments.flatMap((s) => [s.origin, s.destination]),
      );
      for (const p of PORTS.filter((p) => endpoints.has(p.id))) {
        const marker = new THREE.Mesh(
          new THREE.SphereGeometry(p.id === "th" ? 0.023 : 0.014, 12, 10),
          new THREE.MeshBasicMaterial({
            color: p.id === "th" ? 0xffffff : 0xc8ded9,
          }),
        );
        marker.position.copy(vector(p, 1.015));
        marker.userData = { port: p.id, name: p.name };
        routes.add(marker);
        picks.push(marker);
      }
      // Offset coincident routes slightly so two deliveries remain selectable.
      shipments.forEach((s, index) => {
        const state = shipmentState(s, day, delay);
        const color =
          state.lateDays > 0
            ? 0xff9475
            : s.direction === "inbound"
              ? 0x53e2c4
              : 0x7dcaf1;
        const a = vector(port(s.origin));
        const b = vector(port(s.destination));
        const points = Array.from({ length: 65 }, (_, i) =>
          arcPoint(a, b, i / 64).multiplyScalar(1 + index * 0.002),
        );
        const curve = new THREE.CatmullRomCurve3(points);
        const route = new THREE.Mesh(
          new THREE.TubeGeometry(
            curve,
            64,
            selected === s.id ? 0.0045 : 0.002,
            6,
            false,
          ),
          new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity:
              selected === s.id
                ? 1
                : state.status === "Scheduled"
                  ? 0.38
                  : 0.72,
          }),
        );
        route.userData = {
          id: s.id,
          name: `${s.id} / ${port(s.origin).name} > ${port(s.destination).name}`,
        };
        routes.add(route);
        picks.push(route);
        if (state.status === "In transit") {
          const bead = new THREE.Mesh(
            new THREE.SphereGeometry(selected === s.id ? 0.016 : 0.01, 12, 10),
            new THREE.MeshBasicMaterial({ color }),
          );
          bead.position.copy(curve.getPoint(state.progress));
          bead.userData = route.userData;
          routes.add(bead);
          picks.push(bead);
          pulses.push(bead);
        }
      });
      renderer.domElement.dataset.routes = String(shipments.length);
    };
    const focus = (id: string) => {
      camera.position.copy(vector(port(id), camera.position.length()));
      controls.update();
    };
    api.current = { refresh, focus };
    refresh();
    const hit = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const surface = raycaster.intersectObject(earth)[0]?.distance ?? Infinity;
      return raycaster
        .intersectObjects(picks)
        .find((pick) => pick.distance <= surface + 0.015)?.object;
    };
    let startX = 0,
      startY = 0;
    const down = (e: PointerEvent) => {
      startX = e.clientX;
      startY = e.clientY;
    };
    const move = (e: PointerEvent) => {
      const object = hit(e);
      setHover(object?.userData.name || "");
      renderer.domElement.style.cursor = object ? "pointer" : "grab";
    };
    const leave = () => setHover("");
    const up = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > 5) return;
      const object = hit(e);
      if (object?.userData.id) latest.current.onSelect(object.userData.id);
      else if (object?.userData.port) {
        const connected = latest.current.shipments.find(
          (s) =>
            s.origin === object.userData.port ||
            s.destination === object.userData.port,
        );
        if (connected) latest.current.onSelect(connected.id);
      }
    };
    renderer.domElement.addEventListener("pointerdown", down);
    renderer.domElement.addEventListener("pointermove", move);
    renderer.domElement.addEventListener("pointerleave", leave);
    renderer.domElement.addEventListener("pointerup", up);
    const resize = new ResizeObserver(() => {
      const w = element.clientWidth,
        h = element.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    resize.observe(element);
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    let frame = 0;
    const animate = (now: number) => {
      controls.autoRotate = latest.current.rotating;
      controls.update();
      sun.position.copy(camera.position);
      const selectedRoute = latest.current.shipments.find(
        (s) => s.id === latest.current.selected,
      );
      labels.forEach((label, index) => {
        if (!selectedRoute) {
          label.style.display = "none";
          return;
        }
        const p = port(
          index === 0 ? selectedRoute.origin : selectedRoute.destination,
        );
        const position = vector(p, 1.02);
        const visible =
          position
            .clone()
            .normalize()
            .dot(camera.position.clone().sub(position).normalize()) > 0.06;
        const projected = position.project(camera);
        const x = ((projected.x + 1) * element.clientWidth) / 2;
        const y = ((1 - projected.y) * element.clientHeight) / 2;
        label.style.display =
          visible &&
          x > 0 &&
          x < element.clientWidth &&
          y > 0 &&
          y < element.clientHeight
            ? "block"
            : "none";
        label.textContent = p.name;
        label.style.left = `${Math.max(6, Math.min(element.clientWidth - 135, x + 10))}px`;
        label.style.top = `${y - 22}px`;
      });
      if (!reduced)
        pulses.forEach((p) =>
          p.scale.setScalar(1 + Math.sin(now / 350) * 0.12),
        );
      renderer.render(scene, camera);
      renderer.domElement.dataset.ready = "true";
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    const contextLost = (e: Event) => {
      e.preventDefault();
      setStatus("unavailable");
      cancelAnimationFrame(frame);
    };
    renderer.domElement.addEventListener("webglcontextlost", contextLost);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", down);
      renderer.domElement.removeEventListener("pointermove", move);
      renderer.domElement.removeEventListener("pointerleave", leave);
      renderer.domElement.removeEventListener("pointerup", up);
      renderer.domElement.removeEventListener("webglcontextlost", contextLost);
      disposeGroup(routes);
      earth.geometry.dispose();
      earth.material.dispose();
      texture?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      labels.forEach((label) => label.remove());
      api.current = undefined;
    };
  }, []);
  useEffect(() => {
    api.current?.refresh();
  }, [props.shipments, props.day, props.delay, props.selected]);
  useEffect(() => {
    api.current?.focus(props.focus.port);
  }, [props.focus]);
  return (
    <div className="world-globe" ref={host} data-status={status}>
      {status === "loading" && (
        <span className="globe-status" role="status">
          Loading Earth...
        </span>
      )}
      {(status === "unavailable" || status === "texture-error") && (
        <span className="globe-status" role="status">
          {status === "unavailable"
            ? "3D unavailable / shipment ledger remains available"
            : "Earth texture unavailable / schematic globe"}
        </span>
      )}
      {hover && (
        <span className="globe-hover" role="status">
          {hover}
        </span>
      )}
    </div>
  );
}
