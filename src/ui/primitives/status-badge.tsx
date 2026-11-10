import {
  CircleCheck,
  CircleDashed,
  Clock3,
  Info,
  TriangleAlert,
} from "lucide-react";
import { Badge } from "@/ui/primitives/badge";

const tones = {
  neutral: { icon: CircleDashed, className: "status-neutral" },
  info: { icon: Info, className: "status-info" },
  success: { icon: CircleCheck, className: "status-success" },
  warning: { icon: Clock3, className: "status-warning" },
  danger: { icon: TriangleAlert, className: "status-danger" },
};

export function StatusBadge({
  tone = "neutral",
  children,
}: {
  tone?: keyof typeof tones;
  children: string;
}) {
  const { icon: Icon, className } = tones[tone];
  return (
    <Badge className={className}>
      <Icon aria-hidden="true" />
      {children}
    </Badge>
  );
}
