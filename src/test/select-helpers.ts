import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect } from "vitest";

export async function chooseOption(trigger: HTMLElement, label: string) {
  await waitFor(() => expect(trigger).toBeEnabled());
  await userEvent.click(trigger);
  await userEvent.click(await screen.findByRole("option", { name: label }));
  await waitFor(() =>
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument(),
  );
}
