import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  readInputImageAttachmentFromPath,
  taskInputToPlainText,
  taskInputToUserMessage,
} from "../packages/shared/src/index.js";

describe("input attachments", () => {
  it("builds a user message with image parts", () => {
    const message = taskInputToUserMessage({
      text: "describe this screenshot",
      attachments: [
        {
          kind: "image",
          mimeType: "image/png",
          data: "aGVsbG8=",
          sourceLabel: "screen.png",
          origin: "local_cli",
        },
      ],
    }, 123);

    expect(message).toEqual({
      role: "user",
      timestamp: 123,
      content: [
        { type: "text", text: "describe this screenshot" },
        { type: "image", mimeType: "image/png", data: "aGVsbG8=" },
      ],
    });
    expect(taskInputToPlainText({
      attachments: [{ kind: "image", mimeType: "image/png", data: "aGVsbG8=" }],
    })).toBe("[image:image/png]");
  });

  it("loads an image attachment from a local path", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "mono-input-"));
    const cwd = join(rootDir, "workspace");
    await mkdir(cwd, { recursive: true });
    const imagePath = join(cwd, "diagram.png");
    await writeFile(imagePath, Buffer.from([0xde, 0xad, 0xbe, 0xef]));

    const attachment = await readInputImageAttachmentFromPath("./diagram.png", {
      cwd,
      origin: "local_tui",
    });

    expect(attachment.kind).toBe("image");
    expect(attachment.mimeType).toBe("image/png");
    expect(attachment.sourceLabel).toBe("diagram.png");
    expect(attachment.origin).toBe("local_tui");
    expect(attachment.data).toBe(Buffer.from([0xde, 0xad, 0xbe, 0xef]).toString("base64"));
  });
});
