import { createHash, X509Certificate } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";
import { env, requireEnv } from "../../config";
import type { LocatorSpec } from "../../schemas/recording-plan";

export const VIEWPORT = { width: 1920, height: 1080 };
/** Texto que el ERP muestra solo en ambientes de prueba. Sin él, no se ejecuta ninguna acción. */
export const TEST_BANNER = /Ambiente de Prueba/i;

export interface ErpTarget {
  url: URL;
  host: string;
  company: string;
}

/** Verifica que el destino sea el demo permitido. Lanza error ante cualquier duda. */
export function erpTarget(): ErpTarget {
  const raw = requireEnv("ERP_URL", "para explorar y grabar el ERP");
  if (!/^https?:\/\//i.test(raw)) throw new Error(`ERP_URL debe empezar con https:// o http:// (ahora es "${raw}"). Corrígelo en .env.`);
  const url = new URL(raw);
  if (env.ERP_ENV !== "demo") throw new Error('ERP_ENV debe ser "demo" para explorar o grabar el ERP.');
  const prod = (env.ERP_PROD_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (prod.includes(url.host.toLowerCase())) throw new Error(`${url.host} está marcado como producción (ERP_PROD_HOSTS).`);
  const company = requireEnv("ERP_COMPANY", "para elegir la empresa de prueba");
  return { url, host: url.host, company };
}

/** Chrome del contenedor/Playwright + confianza en la CA del proxy corporativo si se indica. */
export async function launchBrowser(): Promise<Browser> {
  const args: string[] = [];
  const ca = process.env.BROWSER_EXTRA_CA_FILE;
  if (ca && existsSync(ca)) {
    // Confía solo en la clave pública de esa CA (proxy TLS del entorno); no desactiva la verificación.
    const cert = new X509Certificate(readFileSync(ca));
    const spki = cert.publicKey.export({ type: "spki", format: "der" });
    args.push(`--ignore-certificate-errors-spki-list=${createHash("sha256").update(spki).digest("base64")}`);
  }
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;
  return chromium.launch({ executablePath, args });
}

/**
 * Allowlist de navegación: el documento principal y las peticiones que modifican datos solo pueden ir al host
 * del ERP. Recursos estáticos de terceros (fuentes, CDN) se permiten solo con GET.
 */
export async function installGuard(context: BrowserContext, target: ErpTarget, onBlocked: (url: string) => void) {
  await context.route("**/*", async (route) => {
    const req = route.request();
    let host = "";
    try {
      host = new URL(req.url()).host;
    } catch {
      return route.continue();
    }
    const scheme = req.url().split(":")[0];
    if (scheme !== "http" && scheme !== "https") return route.continue();
    if (host === target.host) return route.continue();
    if (req.isNavigationRequest() || req.method() !== "GET") {
      onBlocked(req.url());
      return route.abort("blockedbyclient");
    }
    return route.continue();
  });
}

export async function assertTestEnvironment(page: Page) {
  const host = new URL(page.url()).host;
  const target = erpTarget();
  if (host !== target.host) throw new Error(`Se salió del dominio permitido (${host}).`);
  const ok = await page
    .getByText(TEST_BANNER)
    .first()
    .isVisible()
    .catch(() => false);
  if (!ok) throw new Error('No se ve el aviso "Ambiente de Prueba": se detiene por seguridad.');
}

/** Inicia sesión con las credenciales de .env. El agente nunca ve la contraseña. */
export async function login(page: Page, target = erpTarget()) {
  await page.goto(target.url.href, { waitUntil: "networkidle" });
  await page.getByRole("combobox", { name: "Empresa" }).click();
  await page.getByRole("option", { name: target.company, exact: true }).click();
  await page.getByRole("textbox", { name: "Usuario" }).fill(requireEnv("ERP_USER", "para iniciar sesión"));
  await page.getByRole("textbox", { name: "Contraseña" }).fill(requireEnv("ERP_PASSWORD", "para iniciar sesión"));
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await page.waitForLoadState("networkidle");
  const seen = await page
    .getByText(TEST_BANNER)
    .first()
    .waitFor({ timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  if (!seen) {
    if (new URL(page.url()).pathname.startsWith("/login")) {
      throw new Error("No se pudo iniciar sesión en el ERP: revisa ERP_USER, ERP_PASSWORD y ERP_COMPANY en .env (y reinicia el servidor).");
    }
    throw new Error('Se inició sesión pero no aparece el aviso "Ambiente de Prueba": se detiene por seguridad. ¿ERP_URL apunta al demo?');
  }
  await assertTestEnvironment(page);
}

/** Convierte un LocatorSpec en un Locator de Playwright. */
export function resolve(root: Page | Locator, spec: LocatorSpec): Locator {
  const base = spec.within ? resolve(root, spec.within) : root;
  let loc: Locator;
  if (spec.role) {
    loc = base.getByRole(spec.role as Parameters<Page["getByRole"]>[0], spec.name ? { name: spec.name, exact: spec.exact } : undefined);
  } else if (spec.label) loc = base.getByLabel(spec.label, { exact: spec.exact });
  else if (spec.placeholder) loc = base.getByPlaceholder(spec.placeholder, { exact: spec.exact });
  else if (spec.text) loc = base.getByText(spec.text, { exact: spec.exact });
  else if (spec.testId) loc = base.getByTestId(spec.testId);
  else if (spec.css) loc = base.locator(spec.css);
  else throw new Error("Selector vacío");
  return spec.nth !== undefined ? loc.nth(spec.nth) : loc;
}

export const describeSpec = (s: LocatorSpec): string =>
  [
    s.role && `${s.role}${s.name ? ` "${s.name}"` : ""}`,
    s.label && `label "${s.label}"`,
    s.placeholder && `placeholder "${s.placeholder}"`,
    s.text && `texto "${s.text}"`,
    s.testId && `testId ${s.testId}`,
    s.css && `css ${s.css}`,
    s.nth !== undefined && `#${s.nth}`,
    s.within && `dentro de [${describeSpec(s.within)}]`,
  ]
    .filter(Boolean)
    .join(" ");
