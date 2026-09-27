import type { Locator, Page } from "playwright";
import { erpTarget, resolve } from "./browser";
import type { Action } from "../../schemas/recording-plan";

/** Cursor visible dentro de la página (la grabación no incluye el cursor del sistema). */
export const CURSOR_SCRIPT = `(() => {
  if (window.__ivsCursor) return;
  window.__ivsCursor = true;
  const install = () => {
    if (!document.body || document.getElementById("__ivs_cursor")) return;
    const c = document.createElement("div");
    c.id = "__ivs_cursor";
    c.innerHTML = '<svg width="30" height="30" viewBox="0 0 24 24"><path d="M4 2 L4 19 L8.5 14.8 L11.6 21.6 L14.4 20.4 L11.3 13.7 L17.5 13.7 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: "fixed", left: "-100px", top: "-100px", zIndex: 2147483647, pointerEvents: "none", transform: "translate(-4px,-2px)", filter: "drop-shadow(0 2px 3px rgba(0,0,0,.35))" });
    document.body.appendChild(c);
    document.addEventListener("mousemove", (e) => { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; }, true);
    document.addEventListener("mousedown", (e) => {
      const r = document.createElement("div");
      Object.assign(r.style, { position: "fixed", left: e.clientX - 22 + "px", top: e.clientY - 22 + "px", width: "44px", height: "44px", borderRadius: "50%", border: "3px solid #009b72", background: "rgba(0,155,114,.18)", zIndex: 2147483646, pointerEvents: "none", transition: "transform .45s ease-out, opacity .45s ease-out", transform: "scale(.4)", opacity: "1" });
      document.body.appendChild(r);
      requestAnimationFrame(() => { r.style.transform = "scale(1.4)"; r.style.opacity = "0"; });
      setTimeout(() => r.remove(), 600);
    }, true);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install); else install();
  new MutationObserver(install).observe(document.documentElement, { childList: true, subtree: true });
})();`;

/** PRNG determinista (mulberry32): mismas pausas de tipeo en cada grabación. */
export function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ExecOptions {
  /** true = modo grabación: cursor animado, tipeo natural, pausas. false = modo exploración (rápido). */
  cinematic: boolean;
  seed?: number;
  onClick?: (x: number, y: number) => void;
  /** Se llama con la caja del elemento con el que se va a interactuar (para que la cámara lo siga). */
  onFocus?: (box: { x: number; y: number; width: number; height: number }) => void;
  /** Resaltado antes del clic clave de un paso: se llama al llegar el cursor, antes de hacer clic. */
  onEmphasis?: (box: { x: number; y: number; width: number; height: number }, start: boolean) => void;
}

/** Duración de la pausa con el elemento resaltado antes del clic clave (segundos). */
export const EMPHASIS_SEC = 1.1;

/** Ejecuta acciones del recording plan. Lo usan el explorador (rápido) y la grabación (cinemático). */
export class Executor {
  private x = 960;
  private y = 540;
  private rand: () => number;

  constructor(
    readonly page: Page,
    readonly opts: ExecOptions,
  ) {
    this.rand = prng(opts.seed ?? 42);
  }

  private async settle() {
    await this.page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
  }

  private async moveTo(loc: Locator) {
    await loc.scrollIntoViewIfNeeded({ timeout: 10000 }).catch(() => undefined);
    const box = await loc.boundingBox();
    if (!box) throw new Error("El elemento no es visible");
    this.opts.onFocus?.(box);
    const tx = box.x + box.width / 2;
    const ty = box.y + Math.min(box.height / 2, 18);
    if (!this.opts.cinematic) {
      this.x = tx;
      this.y = ty;
      return box;
    }
    const dist = Math.hypot(tx - this.x, ty - this.y);
    const duration = Math.min(900, 280 + dist * 0.45);
    const steps = Math.max(8, Math.round(duration / 16));
    const [sx, sy] = [this.x, this.y];
    for (let i = 1; i <= steps; i++) {
      const k = ease(i / steps);
      await this.page.mouse.move(sx + (tx - sx) * k, sy + (ty - sy) * k);
      await sleep(duration / steps);
    }
    this.x = tx;
    this.y = ty;
    await sleep(120);
    return box;
  }

  private async click(loc: Locator, emphasize = false) {
    await loc.waitFor({ state: "visible", timeout: 15000 });
    if (this.opts.cinematic) {
      const box = await this.moveTo(loc);
      if (emphasize) {
        this.opts.onEmphasis?.(box, true);
        await sleep(EMPHASIS_SEC * 1000);
        this.opts.onEmphasis?.(box, false);
      }
      this.opts.onClick?.(this.x, this.y);
      await this.page.mouse.down();
      await sleep(70);
      await this.page.mouse.up();
    } else {
      await this.moveTo(loc).catch(() => undefined);
      await loc.click({ timeout: 15000 });
    }
  }

  /** `emphasize`: resaltar el elemento antes de hacer clic (solo en modo grabación). */
  async run(action: Action, emphasize = false) {
    const page = this.page;
    switch (action.type) {
      case "goto": {
        const url = new URL(action.path, erpTarget().url);
        if (url.host !== erpTarget().host) throw new Error("goto fuera del dominio del ERP");
        await page.goto(url.href, { waitUntil: "networkidle" });
        break;
      }
      case "click":
        await this.click(resolve(page, action.target).first(), emphasize);
        break;
      case "fill": {
        const loc = resolve(page, action.target).first();
        if (this.opts.cinematic) {
          await this.click(loc);
          await page.keyboard.press("Control+A");
          await page.keyboard.press("Backspace");
          for (const ch of action.value) {
            await page.keyboard.type(ch);
            await sleep(55 + this.rand() * 75 + (ch === " " ? 40 : 0));
          }
        } else {
          // Igual que la grabación (tecla por tecla) pero rápido: los buscadores reaccionan igual en ambos modos.
          await loc.waitFor({ state: "visible", timeout: 15000 });
          await loc.fill("");
          await loc.pressSequentially(action.value, { delay: 25 });
        }
        // Buscadores con "debounce": dar tiempo a que salga la petición antes de esperar la red.
        await sleep(700);
        break;
      }
      case "select": {
        const loc = resolve(page, action.target).first();
        const tag = await loc.evaluate((el) => el.tagName).catch(() => "");
        if (tag === "SELECT") {
          await this.click(loc, emphasize);
          await loc.selectOption({ label: action.option });
        } else {
          await this.click(loc, emphasize);
          await sleep(this.opts.cinematic ? 350 : 150);
          await this.click(page.getByRole("option", { name: action.option }).first());
        }
        break;
      }
      case "press":
        if (action.target) {
          const loc = resolve(page, action.target).first();
          // En un combobox, elegir con teclado solo cuando ya hay opciones visibles (igual en exploración y grabación).
          if (action.target.role === "combobox" && ["ArrowDown", "ArrowUp", "Enter"].includes(action.key)) {
            await page.getByRole("option").first().waitFor({ state: "visible", timeout: 10000 }).catch(() => undefined);
            await sleep(200);
          }
          await loc.focus();
        }
        await page.keyboard.press(action.key);
        break;
      case "wait":
        if (action.target) await resolve(page, action.target).first().waitFor({ state: "visible", timeout: action.ms ?? 15000 });
        else await sleep(action.ms ?? 500);
        break;
    }
    await this.settle();
    if (this.opts.cinematic) await sleep(250 + this.rand() * 150);
  }

  /** Caja del elemento (coordenadas del viewport = coordenadas del video). */
  async box(loc: Locator) {
    await loc.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined);
    return (await loc.boundingBox()) ?? undefined;
  }
}
