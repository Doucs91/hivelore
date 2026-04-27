import pc from "picocolors";

export const ui = {
  info: (msg: string) => console.log(pc.cyan("ℹ"), msg),
  success: (msg: string) => console.log(pc.green("✓"), msg),
  warn: (msg: string) => console.log(pc.yellow("⚠"), msg),
  error: (msg: string) => console.error(pc.red("✗"), msg),
  dim: (msg: string) => pc.dim(msg),
  bold: (msg: string) => pc.bold(msg),
  green: (msg: string) => pc.green(msg),
  yellow: (msg: string) => pc.yellow(msg),
  red: (msg: string) => pc.red(msg),
  statusBadge: (status: string): string => {
    switch (status) {
      case "validated": return pc.green(status);
      case "proposed": return pc.yellow(status);
      case "stale": return pc.yellow(status);
      case "rejected": return pc.red(status);
      case "deprecated": return pc.dim(status);
      default: return pc.dim(status); // draft
    }
  },
};
