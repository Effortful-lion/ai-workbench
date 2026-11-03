/** 操作目录 → Agent Tool Schema：CLI 能做的每个接口，AI 也能以工具形式调用。
 *  工具名 = 操作 key（如 mail.messages.list），参数约束直接来自 OperationDef.params。 */
import { OPERATIONS, type OperationDef, type OperationParam } from "./operations.js";
import type { Permission } from "./roles.js";
import type { ToolSchemaDto } from "./tool.js";

/** 不暴露给 AI 的模块：auth 会自建用户 / 换 token，tools 只是工具清单本身 */
const TOOL_EXCLUDED_MODULES = new Set(["auth", "tools"]);

const JSON_TYPE: Record<OperationParam["type"], string> = {
  string: "string",
  number: "number",
  boolean: "boolean",
  json: "object",
};

export function isToolOperation(op: OperationDef): boolean {
  return !TOOL_EXCLUDED_MODULES.has(op.module);
}

/** 单条操作 → 可注入 LLM 的工具描述（handler 由服务端按 key 补上） */
export function operationToToolSchema(op: OperationDef): ToolSchemaDto {
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];
  for (const p of op.params ?? []) {
    const prop: Record<string, unknown> = { type: JSON_TYPE[p.type] };
    if (p.desc) prop.description = p.desc;
    if (p.values?.length) prop.enum = p.values;
    if (p.default !== undefined) prop.default = p.default;
    properties[p.name] = prop;
    if (p.required) required.push(p.name);
  }
  const riskNote = op.risk === "destructive" ? "；⚠ 不可逆操作，执行前先向用户确认" : "";
  return {
    name: op.key,
    description: `${op.summary}${riskNote}（${op.method} /api${op.path}）`,
    permission: (op.permission ?? "tools:read") as Permission,
    argsSchema: {
      type: "object",
      properties,
      ...(required.length ? { required } : {}),
      additionalProperties: false,
    },
  };
}

/** 全量可暴露给 AI 的工具 Schema（按目录顺序） */
export function operationToolSchemas(): ToolSchemaDto[] {
  return OPERATIONS.filter(isToolOperation).map(operationToToolSchema);
}
