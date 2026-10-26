import { useMemo } from "react";
import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { functionalUpdate, type Updater } from "@tanstack/react-table";

export type TablePreferenceKey =
  "channels" | "dashboard" | "articles" | "publish" | "import";
export interface PreferenceColumn {
  id: string;
  label: string;
  size: number;
  minSize: number;
  maxSize: number;
  enableHiding?: boolean;
}
export interface ColumnPreferences {
  version: 1;
  visibility: Record<string, boolean>;
  sizing: Record<string, number>;
}
const defaults: ColumnPreferences = { version: 1, visibility: {}, sizing: {} };
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const columnStorageKey = (key: TablePreferenceKey) =>
  `pressdock.table.${key}.v1`;

export function normalizeColumnPreferences(
  value: unknown,
  columns: readonly PreferenceColumn[],
): ColumnPreferences {
  if (!record(value) || value.version !== 1) return defaults;
  const visibility: Record<string, boolean> = {};
  const sizing: Record<string, number> = {};
  for (const column of columns) {
    const visible = record(value.visibility)
      ? value.visibility[column.id]
      : undefined;
    if (column.enableHiding !== false && typeof visible === "boolean") {
      visibility[column.id] = visible;
    }
    if (record(value.sizing)) {
      const size = value.sizing[column.id];
      if (typeof size === "number" && Number.isFinite(size))
        sizing[column.id] = Math.round(
          Math.min(column.maxSize, Math.max(column.minSize, size)),
        );
    }
  }
  return { version: 1, visibility, sizing };
}

export function useColumnPreferences(
  key: TablePreferenceKey,
  columns: readonly PreferenceColumn[],
) {
  const preferenceAtom = useMemo(
    () =>
      atomWithStorage<ColumnPreferences>(
        columnStorageKey(key),
        defaults,
        {
          getItem(storageKey, initialValue) {
            try {
              const raw = localStorage.getItem(storageKey);
              return raw === null
                ? initialValue
                : normalizeColumnPreferences(JSON.parse(raw), columns);
            } catch {
              return initialValue;
            }
          },
          setItem(storageKey, value) {
            try {
              localStorage.setItem(
                storageKey,
                JSON.stringify(normalizeColumnPreferences(value, columns)),
              );
            } catch {
              // 存储不可用时，Jotai 中的本次界面状态仍然可用。
            }
          },
          removeItem(storageKey) {
            try {
              localStorage.removeItem(storageKey);
            } catch {
              // 恢复默认仍可作用于本次界面。
            }
          },
        },
        { getOnInit: true },
      ),
    [key, columns],
  );
  const [preferences, setPreferences] = useAtom(preferenceAtom);
  return {
    columns,
    preferences,
    setVisibility(updater: Updater<Record<string, boolean>>) {
      setPreferences((previous) =>
        normalizeColumnPreferences(
          {
            ...previous,
            visibility: functionalUpdate(updater, previous.visibility),
          },
          columns,
        ),
      );
    },
    setSizing(updater: Updater<Record<string, number>>) {
      setPreferences((previous) =>
        normalizeColumnPreferences(
          { ...previous, sizing: functionalUpdate(updater, previous.sizing) },
          columns,
        ),
      );
    },
    reset: () => setPreferences(defaults),
  };
}
export type ColumnPreferencesController = ReturnType<
  typeof useColumnPreferences
>;
