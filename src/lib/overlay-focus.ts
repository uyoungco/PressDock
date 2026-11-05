// 焦点留在弹层内，保留 Tab 导航，但不自动选中输入框或唤起软键盘。
export function focusOverlayContent(event: Event) {
  event.preventDefault();
  if (event.currentTarget instanceof HTMLElement) {
    event.currentTarget.focus({ preventScroll: true });
  }
}
