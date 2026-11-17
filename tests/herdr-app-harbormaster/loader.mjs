// node --import ./loader.mjs: resolves "herdr" to herdr-stub.mjs, "gpui-kit" and "gpui-base" to gpui-stub.mjs.
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === "herdr") return { url: ${JSON.stringify(new URL("./herdr-stub.mjs", import.meta.url).href)}, shortCircuit: true };
  if (spec === "gpui-kit" || spec === "gpui-base") return { url: ${JSON.stringify(new URL("./gpui-stub.mjs", import.meta.url).href)}, shortCircuit: true };
  return next(spec, ctx);
}`));
