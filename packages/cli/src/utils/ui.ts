import pc from "picocolors";

// When a command emits machine-readable JSON on stdout, human log lines must not pollute it.
// `setUiJsonMode(true)` routes info/success/warn to stderr so stdout stays a clean JSON channel.
let jsonMode = false;
export function setUiJsonMode(on: boolean): void {
  jsonMode = on;
}
const logHuman = (icon: string, msg: string): void => {
  if (jsonMode) console.error(icon, msg);
  else console.log(icon, msg);
};

export const ui = {
  info: (msg: string) => logHuman(pc.cyan("ℹ"), msg),
  success: (msg: string) => logHuman(pc.green("✓"), msg),
  warn: (msg: string) => logHuman(pc.yellow("⚠"), msg),
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
