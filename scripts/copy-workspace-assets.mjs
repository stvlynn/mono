import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();

const copies = [
  {
    from: resolve(root, "packages/prompts/src/templates"),
    to: resolve(root, "packages/prompts/dist/templates")
  },
  {
    from: resolve(root, "packages/seekdb-adapter/scripts"),
    to: resolve(root, "packages/seekdb-adapter/dist/scripts")
  },
  {
    from: resolve(root, "packages/telegram-control/src/locales"),
    to: resolve(root, "packages/telegram-control/dist/locales")
  }
];

for (const entry of copies) {
  await mkdir(entry.to, { recursive: true });
  await cp(entry.from, entry.to, { recursive: true, force: true });
}
