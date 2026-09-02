export class InputController {
  private normalizedX = 0;
  private keyDirection = 0;
  private dragging = false;

  constructor(private readonly element: HTMLElement) {
    element.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove, { passive: false });
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  update(dt: number): number {
    if (this.keyDirection !== 0) {
      this.normalizedX = Math.max(-1, Math.min(1, this.normalizedX + this.keyDirection * dt * 1.8));
    }
    return this.normalizedX;
  }

  private onPointerDown = (event: PointerEvent): void => {
    this.dragging = true;
    this.element.setPointerCapture?.(event.pointerId);
    this.readPointer(event);
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.dragging) return;
    event.preventDefault();
    this.readPointer(event);
  };

  private onPointerUp = (): void => {
    this.dragging = false;
  };

  private readPointer(event: PointerEvent): void {
    const rect = this.element.getBoundingClientRect();
    this.normalizedX = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width) * 2 - 1));
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a') this.keyDirection = -1;
    if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'd') this.keyDirection = 1;
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    if (['ArrowLeft', 'ArrowRight', 'a', 'A', 'd', 'D'].includes(event.key)) this.keyDirection = 0;
  };
}
