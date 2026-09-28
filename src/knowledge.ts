import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "./config";

/** Notas verificadas del ERP (knowledge/erp.md): las leen el guionista y el explorador. */
export function erpNotes(): string {
  const file = path.join(ROOT_DIR, "knowledge/erp.md");
  return existsSync(file) ? readFileSync(file, "utf8").trim() : "";
}

/** Bloque para agregar a un prompt de sistema (vacío si no hay notas). */
export const erpNotesBlock = () => {
  const notes = erpNotes();
  return notes ? `\n\nNotas verificadas del ERP (prevalecen sobre el manual si difieren):\n${notes}` : "";
};
