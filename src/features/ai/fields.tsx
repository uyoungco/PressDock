import { useRef, useState, type ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function AiField({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-2">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && (
        <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}
export function AiChoice({
  id,
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(
    null,
  );
  return (
    <AiField id={id} label={label}>
      <Select<string>
        items={options}
        value={value}
        onValueChange={(next) => {
          if (next !== null) onChange(next);
        }}
        disabled={disabled}
        onOpenChange={(open) => {
          if (open)
            setPortalContainer(
              trigger.current?.closest<HTMLElement>(
                '[data-slot="dialog-content"]',
              ) ?? null,
            );
        }}
      >
        <SelectTrigger ref={trigger} id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent portalContainer={portalContainer ?? undefined}>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </AiField>
  );
}
