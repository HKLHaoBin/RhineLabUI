import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { damp } from "./motion";

const PARTS = [
  { id: "fasteners", label: "紧固件", en: "FASTENERS", depth: 2.75 },
  { id: "cover", label: "透明盖板", en: "OPTICAL COVER", depth: 1.85 },
  {
    id: "optical-lenses",
    label: "折射环组",
    en: "REFRACTIVE RINGS",
    depth: 0.75,
  },
  { id: "optical-core", label: "光学核心", en: "OPTICAL CORE", depth: -0.15 },
  { id: "substrate", label: "信息基板", en: "SUBSTRATE", depth: -1.1 },
  { id: "carrier", label: "背板与框架", en: "CARRIER", depth: -2.05 },
] as const;

type ModelSource = { model: THREE.Group; dispose: () => void };
export class ModelViewer {
  readonly root: HTMLElement;
  private canvasHost: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.3, 120);
  private controls: OrbitControls;
  private source?: ModelSource;
  private groups = new Map<string, THREE.Group>();
  private spread = { value: 0, velocity: 0 };
  private targetSpread = 0;
  private lastTime = 0;
  private request = 0;
  private reduced = false;
  private loading = false;
  private status = "";
  private opener: HTMLElement | null = null;
  private siblings: { node: HTMLElement; inert: boolean }[] = [];
  private initialCamera = new THREE.Vector3(7.2, 3.8, 12);
  private onClose: () => void;
  private provider?: () => Promise<ModelSource>;
  isOpen = false;

  constructor(parent: HTMLElement, onClose: () => void) {
    this.onClose = onClose;
    this.root = document.createElement("section");
    this.root.className = "model-viewer";
    this.root.hidden = true;
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-modal", "true");
    this.root.setAttribute("aria-labelledby", "viewer-title");
    this.root.innerHTML = `
      <div class="viewer-canvas"></div>
      <div class="scene-atmosphere viewer-atmosphere" aria-hidden="true"></div>
      <header class="viewer-header">
        <button class="viewer-back" data-viewer="close">← <span>返回档案</span><kbd>ESC</kbd></button>
        <div class="viewer-heading"><span>RHINE LAB / OBJECT STUDY</span><h2 id="viewer-title">档案模型</h2><p id="viewer-file"></p></div>
        <span class="viewer-index">360<span>°</span></span>
      </header>
      <aside class="viewer-parts" aria-label="模型装配结构"><div>ASSEMBLY / 装配结构</div>${PARTS.map((p, i) => `<p><span>${String(i + 1).padStart(2, "0")}</span><strong>${p.label}</strong><small>${p.en}</small></p>`).join("")}</aside>
      <div class="viewer-loading" role="status"><span>正在载入模型…</span><button data-viewer="retry" hidden>重新载入 ↗</button></div>
      <footer class="viewer-footer">
        <div class="viewer-help"><span>拖动旋转</span><span>↑ ↓ ← → 平移</span><span>滚轮缩放</span></div>
        <div class="viewer-actions"><button data-viewer="explode" aria-pressed="false"><span>＋</span> 拆解档案</button><button data-viewer="assemble" aria-pressed="true"><span>−</span> 一键重组</button></div>
        <button class="viewer-reset" data-viewer="reset">复位视角 <span>↗</span></button>
      </footer>
      <div class="viewer-state" aria-live="polite">已组装</div>`;
    parent.appendChild(this.root);
    this.canvasHost = this.root.querySelector(".viewer-canvas")!;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute(
      "aria-label",
      "档案三维模型：拖动旋转，方向键平移，滚轮或加减键缩放，Home 复位",
    );
    this.canvasHost.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color("#eae5e1");
    this.scene.fog = new THREE.Fog("#eae5e1", 13.5, 26.5);
    // Render-target textures belong to their WebGL context. Recreate the main
    // scene's light room here so this renderer receives its actual illumination.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.scene.environment = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();
    this.scene.environmentIntensity = 0.48;
    this.scene.add(new THREE.HemisphereLight("#fffaf5", "#b4a18c", 0.65));
    const key = new THREE.DirectionalLight("#fff7ed", 1.4);
    key.position.set(-6, 14, -5);
    const fill = new THREE.DirectionalLight("#ffffff", 0.6);
    fill.position.set(7, 8, -10);
    this.scene.add(key, fill);
    this.camera.position.copy(this.initialCamera);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.085;
    this.controls.rotateSpeed = 0.65;
    this.controls.zoomSpeed = 0.7;
    this.controls.panSpeed = 0.7;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 28;
    this.controls.maxTargetRadius = 5;
    this.controls.screenSpacePanning = true;
    this.controls.enabled = false;
    this.controls.update();
    this.root.addEventListener("click", (event) => {
      const action = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-viewer]",
      )?.dataset.viewer;
      if (action === "close") this.close();
      if (action === "retry") void this.load();
      if (this.loading || !this.source) return;
      if (action === "explode") this.setExploded(true);
      if (action === "assemble") this.setExploded(false);
      if (action === "reset") this.resetView();
    });
    this.root.addEventListener("keydown", (event) => this.keydown(event));
  }

  open(
    id: string,
    title: string,
    provider: () => Promise<ModelSource>,
    reduced: boolean,
  ) {
    if (this.isOpen) return;
    this.isOpen = true;
    this.reduced = reduced;
    this.provider = provider;
    this.opener = document.activeElement as HTMLElement | null;
    this.siblings = [...this.root.parentElement!.children]
      .filter(
        (node): node is HTMLElement =>
          node instanceof HTMLElement && node !== this.root,
      )
      .map((node) => ({ node, inert: node.inert }));
    this.siblings.forEach(({ node }) => (node.inert = true));
    this.root.hidden = false;
    this.root.querySelector("#viewer-title")!.textContent = title;
    this.root.querySelector("#viewer-file")!.textContent =
      "FILE " + id + " / INTERNAL DATABASE";
    this.spread = { value: 0, velocity: 0 };
    this.targetSpread = 0;
    this.lastTime = 0;
    this.root.dataset.exploded = "false";
    this.resetView();
    this.resize();
    this.renderer.domElement.focus({ preventScroll: true });
    void this.load();
  }

  private async load() {
    if (!this.provider || this.loading) return;
    const ticket = ++this.request;
    this.loading = true;
    this.controls.enabled = false;
    const loading = this.root.querySelector<HTMLElement>(".viewer-loading")!;
    loading.hidden = false;
    loading.querySelector("span")!.textContent = "正在载入模型…";
    loading.querySelector<HTMLElement>("button")!.hidden = true;
    this.setButtonsDisabled(true);
    try {
      const source = await this.provider();
      if (!this.isOpen || ticket !== this.request) {
        source.dispose();
        return;
      }
      this.source = source;
      for (const part of PARTS) {
        const group = new THREE.Group();
        group.name = part.id;
        this.groups.set(part.id, group);
      }
      for (const child of [...source.model.children]) {
        const group = this.groups.get(child.userData.assemblyPart ?? "cover");
        group?.add(child);
      }
      for (const group of this.groups.values()) source.model.add(group);
      source.model.position.set(0, -1.85, 0);
      this.scene.add(source.model);
      this.loading = false;
      loading.hidden = true;
      this.controls.enabled = true;
      this.setButtonsDisabled(false);
      this.setExploded(false);
      this.setStatus("已组装");
    } catch (error) {
      if (!this.isOpen || ticket !== this.request) return;
      this.loading = false;
      loading.querySelector("span")!.textContent = "模型载入失败，请重试";
      loading.querySelector<HTMLElement>("button")!.hidden = false;
      console.error("Model viewer failed to load", error);
    }
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.request++;
    this.loading = false;
    this.controls.enabled = false;
    if (this.source) {
      this.scene.remove(this.source.model);
      this.source.dispose();
      this.source = undefined;
    }
    this.groups.clear();
    this.root.hidden = true;
    this.siblings.forEach(({ node, inert }) => (node.inert = inert));
    this.siblings = [];
    this.opener?.focus({ preventScroll: true });
    this.onClose();
  }

  private setButtonsDisabled(disabled: boolean) {
    for (const action of ["explode", "assemble", "reset"]) {
      this.root.querySelector<HTMLButtonElement>(
        `[data-viewer="${action}"]`,
      )!.disabled = disabled;
    }
  }
  private setExploded(value: boolean) {
    this.targetSpread = value ? 1 : 0;
    this.root.dataset.exploded = String(value);
    this.root
      .querySelector('[data-viewer="explode"]')!
      .setAttribute("aria-pressed", String(value));
    this.root
      .querySelector('[data-viewer="assemble"]')!
      .setAttribute("aria-pressed", String(!value));
    this.setStatus(
      value ? "正在拆解" : this.spread.value > 0.001 ? "正在重组" : "已组装",
    );
    if (this.reduced) this.spread = { value: this.targetSpread, velocity: 0 };
  }
  private setStatus(value: string) {
    if (value !== this.status) {
      this.status = value;
      this.root.querySelector(".viewer-state")!.textContent = value;
    }
  }
  private resetView() {
    this.controls.enabled = false;
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.target.set(0, 0, 0);
    this.camera.position.copy(this.initialCamera);
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.enableDamping = !this.reduced;
    this.controls.enabled =
      this.isOpen && !this.loading && Boolean(this.source);
  }
  private keydown(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      this.close();
      return;
    }
    if (event.key === "Tab") {
      const elements = [
        ...this.root.querySelectorAll<HTMLElement>(
          'button:not([disabled]):not([hidden]),canvas[tabindex="0"]',
        ),
      ];
      const first = elements[0],
        last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
      return;
    }
    if (!this.source || this.loading) return;
    if (event.key === "Home") {
      event.preventDefault();
      this.resetView();
      return;
    }
    if (["+", "=", "-"].includes(event.key)) {
      event.preventDefault();
      const distance = this.camera.position.distanceTo(this.controls.target);
      const next = THREE.MathUtils.clamp(
        distance * (event.key === "-" ? 1.12 : 1 / 1.12),
        5,
        28,
      );
      this.camera.position
        .sub(this.controls.target)
        .multiplyScalar(next / distance)
        .add(this.controls.target);
      this.controls.update();
      return;
    }
    if (
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    ) {
      event.preventDefault();
      const right = new THREE.Vector3().setFromMatrixColumn(
        this.camera.matrix,
        0,
      );
      const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
      const delta = new THREE.Vector3();
      const step =
        this.camera.position.distanceTo(this.controls.target) * 0.025;
      if (event.key === "ArrowLeft") delta.addScaledVector(right, -step);
      if (event.key === "ArrowRight") delta.addScaledVector(right, step);
      if (event.key === "ArrowUp") delta.addScaledVector(up, step);
      if (event.key === "ArrowDown") delta.addScaledVector(up, -step);
      this.camera.position.add(delta);
      this.controls.target.add(delta);
      this.controls.update();
    }
  }

  resize() {
    if (!this.isOpen) return;
    const width = this.canvasHost.clientWidth,
      height = this.canvasHost.clientHeight;
    this.renderer.setPixelRatio(
      Math.min(devicePixelRatio, 1.5) *
        Math.min(innerWidth / 1920, innerHeight / 1080),
    );
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  update(time: number) {
    if (!this.isOpen) return;
    const dt = Math.min(this.lastTime ? time - this.lastTime : 1 / 60, 0.05);
    this.lastTime = time;
    if (this.source) {
      damp(this.spread, this.targetSpread, this.reduced ? 45 : 5.5, dt);
      if (
        Math.abs(this.spread.value - this.targetSpread) < 0.0001 &&
        Math.abs(this.spread.velocity) < 0.001
      ) {
        this.spread = { value: this.targetSpread, velocity: 0 };
        this.setStatus(this.targetSpread ? "已拆解" : "已组装");
      }
      for (const part of PARTS) {
        this.groups.get(part.id)!.position.z = part.depth * this.spread.value;
      }
    }
    this.controls.update();
    // Match the detail scene's gentle haze without washing out the object as
    // the user zooms. The assembled model is centered on the world origin.
    const fog = this.scene.fog as THREE.Fog;
    const objectDistance = this.camera.position.length();
    fog.near = Math.max(0, objectDistance - 1);
    fog.far = objectDistance + 12;
    this.renderer.render(this.scene, this.camera);
    this.root.dataset.stats = JSON.stringify({
      ready: Boolean(this.source),
      spread: this.spread.value,
      target: this.targetSpread,
      distance: this.camera.position.distanceTo(this.controls.target),
      targetPosition: this.controls.target.toArray(),
      azimuth: this.controls.getAzimuthalAngle(),
      polar: this.controls.getPolarAngle(),
      parts: [...this.groups].map(([id, group]) => ({
        id,
        z: group.position.z,
        meshes: group.children.length,
      })),
    });
  }
}
