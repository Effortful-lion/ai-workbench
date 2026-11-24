import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../llm/llm.adapter";
import {
  buildToolApiNames,
  safeParseArgs,
  sanitizeToolSequence,
  stableStringify,
} from "./chat-helpers";

describe("stableStringify", () => {
  it("按键名排序，保证幂等", () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
  it("处理数组与原始值", () => {
    expect(stableStringify([3, 1, 2])).toBe("[3,1,2]");
    expect(stableStringify("x")).toBe('"x"');
    expect(stableStringify(null)).toBe("null");
  });
  it("递归嵌套结构", () => {
    expect(stableStringify({ a: { z: 1, y: 2 }, b: [1] })).toBe(
      '{"a":{"y":2,"z":1},"b":[1]}',
    );
  });
});

describe("buildToolApiNames", () => {
  it("点号转下划线并处理命名碰撞", () => {
    const { apiToReal, realToApi } = buildToolApiNames([
      { name: "mail.accounts.list" },
      { name: "a.b" },
      { name: "a_b" },
    ] as never);
    expect(realToApi.get("mail.accounts.list")).toBe("mail_accounts_list");
    expect(realToApi.get("a.b")).toBe("a_b");
    expect(realToApi.get("a_b")).toBe("a_b_");
    expect(apiToReal.get("a_b")).toBe("a.b");
    expect(apiToReal.get("a_b_")).toBe("a_b");
  });
});

describe("safeParseArgs", () => {
  it("解析合法对象 JSON", () => {
    expect(safeParseArgs('{"a":1}')).toEqual({ a: 1 });
  });
  it("非法 / 数组 / 空 一律回退空对象", () => {
    expect(safeParseArgs("nope")).toEqual({});
    expect(safeParseArgs("[]")).toEqual({});
    expect(safeParseArgs(undefined)).toEqual({});
  });
});

describe("sanitizeToolSequence", () => {
  it("把 tool 消息配对到对应 assistant tool_calls", () => {
    const msgs = [
      { role: "assistant", content: "", tool_calls: [{ id: "c1" }] },
      { role: "tool", tool_call_id: "c1", content: "ok" },
    ] as ChatMessage[];
    const out = sanitizeToolSequence(msgs);
    expect(out.map((m) => (m as { role: string }).role)).toEqual(["assistant", "tool"]);
  });

  it("丢弃无 assistant 对应的孤儿 tool 消息", () => {
    const msgs = [
      { role: "user", content: "hi" },
      { role: "tool", tool_call_id: "ghost", content: "x" },
    ] as ChatMessage[];
    const out = sanitizeToolSequence(msgs);
    expect(out).toHaveLength(1);
    expect((out[0] as { role: string }).role).toBe("user");
  });
});
