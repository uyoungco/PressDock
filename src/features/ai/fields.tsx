import { useRef, useState, type ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
} from "@/components/ui/select";
import { Field, FieldLabel } from "@/components/ui/field";

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
    <Field className="min-w-0">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {children}
      {hint && (
        <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
      )}
    </Field>
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
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </AiField>
  );
}
