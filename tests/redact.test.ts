import { describe, expect, it, vi } from "vitest";

describe("redact", () => {
  it("oculta valores secretos del entorno", async () => {
    vi.stubEnv("ERP_PASSWORD", "s3cr3t-demo");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-xyz");
    vi.resetModules();
    const { redact } = await import("../src/log");
    expect(redact('login con s3cr3t-demo y {"k":"sk-ant-xyz"}')).toBe('login con «oculto» y {"k":"«oculto»"}');
    vi.unstubAllEnvs();
  });
});
