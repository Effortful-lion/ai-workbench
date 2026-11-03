export interface ParsedArgs {
  positionals: string[];
  /** 值已按 --kebab-case → camelCase 归一 */
  flags: Record<string, string | boolean>;
}

function camel(name: string): string {
  return name.replace(/-(.)/g, (_m, c: string) => c.toUpperCase());
}

/** 极简参数解析：`--key value` / `--key=value` / `--flag` / `--no-flag` */
export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "-h" || token === "--help") {
      flags.help = true;
      continue;
    }
    if (token.startsWith("--")) {
      const body = token.slice(2);
      const eq = body.indexOf("=");
      if (eq !== -1) {
        const name = body.slice(0, eq);
        const value = body.slice(eq + 1);
        flags[camel(name)] = value;
        continue;
      }
      if (body.startsWith("no-")) {
        flags[camel(body.slice(3))] = false;
        continue;
      }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        flags[camel(body)] = next;
        i += 1;
      } else {
        flags[camel(body)] = true;
      }
      continue;
    }
    positionals.push(token);
  }

  return { positionals, flags };
}

export function str(flags: Record<string, string | boolean>, name: string): string | undefined {
  const v = flags[name];
  if (v === undefined) return undefined;
  return v === true ? "true" : v === false ? "false" : v;
}

export function bool(flags: Record<string, string | boolean>, name: string): boolean | undefined {
  const v = flags[name];
  if (v === undefined) return undefined;
  if (typeof v === "boolean") return v;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}
