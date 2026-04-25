import pc from "picocolors";

export const ui = {
  info: (msg: string) => console.log(pc.cyan("ℹ"), msg),
  success: (msg: string) => console.log(pc.green("✓"), msg),
  warn: (msg: string) => console.log(pc.yellow("⚠"), msg),
  error: (msg: string) => console.error(pc.red("✗"), msg),
  dim: (msg: string) => pc.dim(msg),
  bold: (msg: string) => pc.bold(msg),
};
