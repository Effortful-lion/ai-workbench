import { useEffect, useState } from "react";
import type { ModelDto } from "@aiwb/shared";
import { api } from "../lib/api";
import PickerChip, { type PickerItem } from "./PickerChip";

interface Props {
  /** 当前模型 id；null = ◎ 自动（服务端挑默认） */
  value: string | null;
  onChange: (modelId: string | null) => void;
  /** 浮层水平对齐：right=芯片右缘 / left=芯片左缘 */
  align?: "left" | "right";
  /** 浮层展开方向：down=向下（默认）/ up=向上（贴底输入区场景） */
  direction?: "up" | "down";
  /** 芯片按钮附加样式（截断/宽度约束） */
  chipClass?: string;
}

const STATUS_DOT: Record<ModelDto["status"], string> = {
  ok: "text-acc",
  untested: "text-warn",
  error: "text-err",
};

/** 终端风模型选择芯片（基于 PickerChip）：仅列 status=ok 的 chat 模型，
 *  首项「◎ 自动」= 服务端默认（芯片与列表同步显示默认模型名）。 */
export default function ModelPicker({ value, onChange, align = "right", direction = "down", chipClass }: Props) {
  const [models, setModels] = useState<ModelDto[] | null>(null);

  useEffect(() => {
    api<ModelDto[]>("/models")
      .then((ms) => setModels(ms.filter((m) => m.kind === "chat" && m.status === "ok")))
      .catch(() => setModels([]));
  }, []);

  const defaultName = models?.find((m) => m.isDefault)?.modelName;
  const items: PickerItem[] = [
    { id: null, name: `自动（${defaultName ?? "服务端挑选"}）`, tag: "跟随全局" },
    ...(models ?? []).map((m) => ({
      id: m.id,
      name: `${m.provider}/${m.modelName}`,
      tag: m.isDefault ? "★默认" : undefined,
      statusText: `●${m.status}`,
      statusClass: STATUS_DOT[m.status],
    })),
  ];

  return (
    <PickerChip
      items={items}
      value={value ?? null}
      onChange={onChange}
      align={align}
      direction={direction}
      head="◇ 选择模型"
      chipClass={chipClass}
    />
  );
}
