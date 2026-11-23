import type { ExtensionFactory } from "@rally/coding-agent";
import { Type, type Static } from "typebox";
import { basename, resolve } from "node:path";
import type { ResourceStore } from "../resource-store.ts";
import { MESSAGE_MAX_RESOURCES, resourceRef, type ResourceRef } from "../../shared/resources.ts";

interface ResourceToolsOptions {
  store(): ResourceStore;
  owner: string;
  cwd(): string;
  roots(): string[];
  active(): boolean;
  allowedIds?(): string[];
  publish(toolCallId: string, resources: ResourceRef[]): void;
}

const schema = Type.Object({
  paths: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: MESSAGE_MAX_RESOURCES, description: "Files to snapshot from the working/output directory. Relative paths use cwd." })),
  resourceIds: Type.Optional(Type.Array(Type.String(), { maxItems: MESSAGE_MAX_RESOURCES, description: "Existing resource IDs to show again; do not invent IDs." })),
});

/** Only host-created references reach the UI; arbitrary MCP details cannot forge attachments. */
export function resourceTools(options: ResourceToolsOptions): ExtensionFactory {
  return pi => {
    pi.registerTool({
      name: "resource_publish", label: "展示文件", parameters: schema,
      description: "Publish files as immutable attachments in Rally for preview/download. Supports images, audio, video and ordinary files. This does not send to external recipients. Workers should publish deliverables before task_report; published files accompany their reports.",
      async execute(id, params: Static<typeof schema>, signal) {
        if (!options.active()) throw Error("会话或任务已结束");
        const paths = params.paths ?? []; const ids = params.resourceIds ?? [];
        if (!paths.length && !ids.length || paths.length + ids.length > MESSAGE_MAX_RESOURCES) throw Error("每次可展示 1 到 10 个文件");
        const store = options.store();
        const allowed = options.allowedIds?.();
        const refs = ids.map(id => {
          if (allowed && !allowed.includes(id)) throw Error("该资源不在当前任务的可见范围");
          const resource = store.get(id, allowed ? undefined : options.owner);
          if (resource.state !== "ready") throw Error("资源原件已缺失");
          return resourceRef(resource);
        });
        for (const path of paths) refs.push(resourceRef(await store.importFile(options.owner, resolve(options.cwd(), path), options.roots(), "generated", signal)));
        signal?.throwIfAborted();
        if (!options.active()) throw Error("会话或任务已结束");
        options.publish(id, refs);
        return { content: [{ type: "text", text: `Published resources: ${JSON.stringify(refs)}` }], details: {} };
      },
    });
    pi.on("tool_result", async (event, ctx) => {
      if (event.isError || !options.active() || event.toolName === "resource_publish" || event.toolName === "browser_screenshot") return;
      const images = event.content.filter(part => part.type === "image");
      if (!images.length) return;
      const refs: ResourceRef[] = [];
      const notes: string[] = [];
      const store = options.store();
      // Preserve the exact processed image seen by the model. Originals use resource_publish.
      for (const [index, image] of images.slice(0, MESSAGE_MAX_RESOURCES).entries()) {
        try {
          if (image.data.length > Math.ceil(32 * 1024 * 1024 / 3) * 4) throw Error("图像超过 32 MiB 展示处理上限");
          const suffix = ({ "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/bmp": "bmp" } as Record<string, string>)[image.mimeType] ?? "bin";
          const name = event.toolName === "read" && typeof event.input.path === "string" ? `${basename(event.input.path)}.preview.${suffix}` : `${event.toolName}-${index + 1}.${suffix}`;
          refs.push(resourceRef(await store.importBytes(options.owner, name.slice(-255), Buffer.from(image.data, "base64"), "tool", ctx.signal)));
        } catch (error) { notes.push(`Image preview unavailable: ${error instanceof Error ? error.message : String(error)}`); }
      }
      if (images.length > MESSAGE_MAX_RESOURCES) notes.push("Only the first 10 tool images were registered for display.");
      if (options.active() && !ctx.signal?.aborted && refs.length) {
        options.publish(event.toolCallId, refs);
        if (event.parentToolCallId) options.publish(event.parentToolCallId, refs);
        notes.unshift(`Displayed image resources: ${JSON.stringify(refs)}`);
      }
      return { content: [...event.content, { type: "text", text: notes.join("\n") }], structuredContent: event.structuredContent };
    });
  };
}
