import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from "@/components/ui/combobox";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SearchableSelectProps {
  options: readonly SelectOption[];
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
  contentClassName?: string;
  wrapLabels?: boolean;
}

/** 搜索只改变选项列表，只有明确选择才通知业务层。 */
export function SearchableSelect({
  options,
  value,
  onValueChange,
  disabled = false,
  id,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  placeholder = "请选择",
  searchPlaceholder = "搜索选项…",
  emptyText = "未找到匹配项",
  className,
  contentClassName,
  wrapLabels = false,
}: SearchableSelectProps) {
  const generatedId = useId();
  const triggerId = id ?? generatedId;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const composing = useRef(false);
  // 已提交的历史筛选值可能已从最新配置中移除，仍需能够回显与重新选择。
  const items = useMemo(
    () =>
      value && !options.some((item) => item.value === value)
        ? [...options, { value, label: value }]
        : [...options],
    [options, value],
  );
  const selected = items.find((item) => item.value === value) ?? null;

  useEffect(() => {
    if (disabled) {
      setOpen(false);
      setQuery("");
      composing.current = false;
    }
  }, [disabled]);

  return (
    <Combobox<SelectOption>
      items={items}
      value={selected}
      isItemEqualToValue={(a, b) => a.value === b.value}
      disabled={disabled}
      open={open && !disabled}
      onOpenChange={(next) => {
        setOpen(next && !disabled);
        if (!next) {
          setQuery("");
          composing.current = false;
        }
      }}
      inputValue={query}
      onInputValueChange={setQuery}
      filter={(item, search) =>
        item.label
          .toLocaleLowerCase()
          .includes(search.trim().toLocaleLowerCase())
      }
      onValueChange={(item) => {
        if (item && !disabled && !composing.current) onValueChange(item.value);
      }}
    >
      <ComboboxTrigger
        id={triggerId}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        className={className}
        wrapLabel={wrapLabels}
      >
        <ComboboxValue placeholder={placeholder} />
      </ComboboxTrigger>
      <ComboboxContent className={contentClassName}>
        <ComboboxInput
          aria-label={searchPlaceholder}
          placeholder={searchPlaceholder}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onKeyDownCapture={(event) => {
            if (
              event.key === "Enter" &&
              (composing.current ||
                event.nativeEvent.isComposing ||
                event.nativeEvent.keyCode === 229)
            ) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.stopPropagation();
            }
          }}
        />
        <ComboboxEmpty>{emptyText}</ComboboxEmpty>
        <ComboboxList>
          {(item: SelectOption) => (
            <ComboboxItem key={item.value} value={item} wrapLabel={wrapLabels}>
              {item.label}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
