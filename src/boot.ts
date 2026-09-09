import { bootMotion } from "./boot-motion";
import { bootMarkStrokes } from "./brand";

const ns = "http://www.w3.org/2000/svg";
const arc = (r: number, start: number, sweep: number, x = 960, y = 540) => {
  const point = (a: number) => `${x + Math.cos(a) * r},${y + Math.sin(a) * r}`;
  if (sweep >= Math.PI * 1.999)
    return `M${point(start)}A${r},${r} 0 1 1 ${point(start + Math.PI)}A${r},${r} 0 1 1 ${point(start + Math.PI * 2)}`;
  return `M${point(start)}A${r},${r} 0 ${sweep > Math.PI ? 1 : 0} 1 ${point(start + sweep)}`;
};

export class BootSequence {
  private nodes: Map<string, HTMLElement> = new Map();
  private strokes: SVGPathElement[];
  private letters: SVGTextElement;
  private plus: SVGPathElement;
  private minus: SVGPathElement;
  private brandLines: HTMLElement[];
  private scanPaths: SVGPathElement[];
  private orbitDots: SVGCircleElement[];
  private core: SVGCircleElement;
  private caps: SVGCircleElement[];
  private companyInk: HTMLElement[];
  private poweredHTML: string;
  constructor(private stage: HTMLElement) {
    [
      ".access-text",
      ".boot-logo",
      ".auth-status",
      "#auth-message",
      ".scan",
      ".scan > span",
      ".welcome",
      ".welcome-heading",
      ".welcome-panel",
      ".welcome-company",
      ".welcome-highlight",
      ".welcome-database",
      ".welcome-logo",
      ".brand",
      ".powered",
      "#boot-background",
      ".boot-background svg",
      ".boot-white",
    ].forEach((s) => this.nodes.set(s, stage.querySelector<HTMLElement>(s)!));
    const mark = stage.querySelector<SVGSVGElement>(".boot-logo svg")!;
    const original = mark.querySelector("path")!;
    this.strokes = bootMarkStrokes.map((d) => {
      const path = original.cloneNode() as SVGPathElement;
      path.setAttribute("d", d);
      path.setAttribute("pathLength", "1");
      path.style.strokeDasharray = "1";
      mark.insertBefore(path, original);
      return path;
    });
    original.remove();
    const symbols = mark.querySelector("path:not([pathLength])")!;
    this.plus = document.createElementNS(ns, "path");
    this.plus.setAttribute("d", "M44 70h50M69 45v50");
    this.minus = document.createElementNS(ns, "path");
    this.minus.setAttribute("d", "M219 70h44");
    [this.plus, this.minus].forEach((p) => {
      p.setAttribute("stroke", "currentColor");
      p.setAttribute("stroke-width", "15");
      mark.insertBefore(p, symbols);
    });
    symbols.remove();
    this.letters = mark.querySelector("text")!;
    this.letters.setAttribute("text-anchor", "start");
    this.letters.setAttribute("x", "20");
    this.brandLines = Array.from(
      stage.querySelector(".brand")!.children,
    ) as HTMLElement[];
    this.scanPaths = Array.from(
      stage.querySelectorAll<SVGPathElement>(".scan path"),
    );
    this.orbitDots = Array.from(
      stage.querySelectorAll<SVGCircleElement>(".scan .orbit-dot"),
    );
    this.core = stage.querySelector(".scan .scan-core")!;
    this.caps = ["#080a08", "#fff"].map((fill) => {
      const cap = document.createElementNS(ns, "circle");
      cap.setAttribute("fill", fill);
      cap.setAttribute("stroke", "none");
      this.core.parentElement!.appendChild(cap);
      return cap;
    });
    this.companyInk = Array.from(
      stage.querySelectorAll<HTMLElement>(".welcome-company strong"),
    );
    this.companyInk.forEach((el) => {
      const ink = document.createElement("span");
      ink.textContent = el.textContent;
      el.replaceChildren(ink);
    });
    this.poweredHTML = this.el(".powered").innerHTML;
  }
  private el(selector: string) {
    return this.nodes.get(selector)!;
  }
  private opacity(selector: string, value: number | boolean) {
    this.el(selector).style.opacity = String(Number(value));
  }
  update(time: number) {
    const s = bootMotion(time),
      t = s.t;
    this.stage.dataset.bootFrame = String(s.f);
    this.el(".access-text").textContent = s.access;
    this.opacity(".access-text", s.accessOpacity);
    this.opacity(".boot-logo", s.logoOpacity);
    this.el(".boot-logo").style.transform =
      `translateX(${294 * (1 - s.logoLeft)}px)`;
    this.strokes.forEach(
      (p, i) =>
        (p.style.strokeDashoffset = String(
          1 - [s.drawTop, s.drawLeft, s.drawRight][i],
        )),
    );
    this.letters.textContent = s.logoLetters;
    this.plus.style.opacity = String(s.plus);
    this.minus.style.opacity = String(s.minus);
    this.plus.setAttribute("transform", `rotate(${s.plusAngle} 69 70)`);
    this.opacity(".auth-status", s.authOpacity);
    this.el("#auth-message").textContent = s.auth;
    this.opacity(".brand", 1);
    this.el(".brand").style.transform = "none";
    this.brandLines.forEach((node, i) => {
      node.style.opacity = String(s.brand[i].opacity);
      node.style.transform = `translateX(${s.brand[i].x}px)`;
    });
    this.opacity(".powered", s.poweredLetters > 0);
    this.el(".powered").style.clipPath =
      `inset(0 ${100 * (1 - s.poweredLetters / 19)}% 0 0)`;
    this.opacity(".scan", s.scanVisible);
    if (s.scanVisible) this.renderScan(s);
    this.opacity(".welcome", s.welcomeVisible ? s.welcomeOpacity : 0);
    this.el(".welcome").style.transform = `scale(${s.welcomeScale})`;
    this.el(".welcome").style.filter =
      `blur(${s.exitBlur}px) invert(${s.exit * 0.22}) sepia(${s.exit}) saturate(${1 + s.exit * 5}) hue-rotate(${s.exit * 115}deg)`;
    this.opacity(".welcome-panel", s.welcomePanel);
    this.opacity(".welcome-heading", 1);
    this.el(".welcome-heading").style.color =
      `rgb(${255 * (1 - s.welcomeInk)} ${255 * (1 - s.welcomeInk)} ${255 * (1 - s.welcomeInk)})`;
    this.opacity(".welcome-company", s.companyVisible);
    this.el(".welcome-company").style.opacity = String(
      s.companyVisible ? (s.companyMask ? 0.65 : 1) : 0,
    );
    this.companyInk[1].querySelector("span")!.style.opacity = s.companyMask
      ? ".06"
      : "1";
    this.el(".welcome-highlight").style.clipPath =
      `inset(0 ${100 * (1 - s.highlight)}% 0 0)`;
    this.opacity(".welcome-database", s.databaseOpacity);
    this.opacity(".welcome-logo", s.welcomeLogo);
    this.opacity("#boot-background", s.backgroundOpacity);
    this.opacity(".boot-white", s.white);
    this.el(".boot-background svg").style.transform =
      `translate(${Math.sin(t * 0.16) * 18}px, ${-(t - 6) * 5}px) scale(1.08)`;
    return s;
  }
  private renderScan(s: ReturnType<typeof bootMotion>) {
    const { scan } = s,
      r = scan.radius;
    const group = this.scanPaths[0].parentElement!;
    group.setAttribute(
      "transform",
      `translate(960 540) scale(${s.ringScale}) translate(-960 -540)`,
    );
    group.style.opacity = String(s.ringOpacity);
    group.style.filter = `blur(${s.ringBlur}px)`;
    this.scanPaths[0].setAttribute(
      "d",
      arc(r, scan.outerStart, scan.outerSweep),
    );
    this.scanPaths[0].setAttribute("stroke-width", "2.4");
    this.scanPaths[1].setAttribute(
      "d",
      arc(scan.whiteRadius, scan.whiteStart, scan.whiteSweep),
    );
    this.scanPaths[1].setAttribute("stroke-width", "4");
    const inner = scan.innerStart;
    this.scanPaths[2].setAttribute(
      "d",
      arc(scan.innerRadius, inner, scan.innerSweep),
    );
    this.scanPaths[3].setAttribute(
      "d",
      arc(scan.innerRadius, inner + Math.PI, scan.innerSweep),
    );
    this.scanPaths[4].setAttribute("d", arc(38, -inner, 4.2, 830, 552));
    this.scanPaths[5].setAttribute(
      "d",
      arc(38, Math.PI - inner, 4.2, 1090, 528),
    );
    this.scanPaths
      .slice(4)
      .forEach((path) => (path.style.opacity = s.ornament ? "1" : "0"));
    this.core.style.opacity = s.ornament ? "1" : "0";
    this.core.setAttribute("r", String(s.coreRadius));
    const orbit = scan.orbit;
    this.orbitDots.forEach((dot, i) => {
      dot.setAttribute(
        "cx",
        String(960 + Math.cos(orbit + i * Math.PI) * scan.orbitRadius),
      );
      dot.setAttribute(
        "cy",
        String(540 + Math.sin(orbit + i * Math.PI) * scan.orbitRadius),
      );
      dot.setAttribute("r", String(scan.dotRadius));
    });
    this.caps.forEach((cap, i) => {
      const angle = i ? scan.whiteStart : scan.outerStart + scan.outerSweep;
      const radius = i ? scan.whiteRadius : r;
      cap.setAttribute("cx", String(960 + Math.cos(angle) * radius));
      cap.setAttribute("cy", String(540 + Math.sin(angle) * radius));
      cap.setAttribute("r", String(i ? scan.whiteCap : scan.blackCap));
    });
    this.opacity(".scan > span", s.permissionOpacity);
    this.el(".scan > span").style.letterSpacing = `${s.scanTracking}px`;
    this.el(".scan > span").style.fontSize = `${s.scanFont}px`;
  }
  reset() {
    // Restore shared corner branding when skipping at any intermediate frame.
    [".brand", ".powered"].forEach((key) =>
      this.el(key).removeAttribute("style"),
    );
    this.brandLines.forEach((node) => node.removeAttribute("style"));
    this.el(".powered").innerHTML = this.poweredHTML;
    this.opacity("#boot-background", 0);
  }
}
