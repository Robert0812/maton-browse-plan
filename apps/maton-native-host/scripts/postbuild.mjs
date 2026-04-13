import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeNativeWrappers } from "./write-native-wrappers.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = path.join(root, "dist");
await writeNativeWrappers(dist);
