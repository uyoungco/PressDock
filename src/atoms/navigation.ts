import { atomWithStorage } from "jotai/utils";
export const sidebarOpenAtom = atomWithStorage(
  "pressdock.sidebar",
  true,
  undefined,
  { getOnInit: true },
);
