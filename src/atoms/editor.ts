import { atom } from "jotai";
export const currentArticleIdAtom = atom<string | null>(null);
export const editorDirtyAtom = atom(false);
export const editorStatusAtom = atom((get) =>
  get(editorDirtyAtom) ? "有未保存修改" : "已保存",
);
