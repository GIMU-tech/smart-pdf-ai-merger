import type { FrameState, Rect } from '../model/types';

function strokeRectWithInset(
  context: CanvasRenderingContext2D,
  rect: Rect,
  inset: number,
) {
  context.strokeRect(
    rect.x + inset,
    rect.y + inset,
    Math.max(0, rect.width - inset * 2),
    Math.max(0, rect.height - inset * 2),
  );
}

/** Draws one complete frame from absolute state; it never depends on a prior frame. */
export function renderPresetFrame(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  canvasWidth: number,
  canvasHeight: number,
  frame: FrameState | null,
) {
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvasWidth, canvasHeight);
  context.globalAlpha = 1;
  context.drawImage(image, 0, 0, canvasWidth, canvasHeight);

  if (!frame) {
    context.restore();
    return;
  }

  const { overlay } = frame;

  if (overlay.kind === 'marker-sweep') {
    context.save();
    context.beginPath();
    context.rect(overlay.clipRect.x, overlay.clipRect.y, overlay.clipRect.width, overlay.clipRect.height);
    context.clip();
    context.globalAlpha = overlay.opacity;
    context.fillStyle = overlay.color;
    context.fillRect(
      overlay.markerRect.x,
      overlay.markerRect.y,
      overlay.markerRect.width,
      overlay.markerRect.height,
    );
    context.restore();
  } else if (overlay.kind === 'spotlight') {
    const { focusRect } = overlay;
    context.fillStyle = `rgba(15, 23, 42, ${overlay.dimOpacity})`;
    context.fillRect(0, 0, canvasWidth, Math.max(0, focusRect.y));
    context.fillRect(0, focusRect.y + focusRect.height, canvasWidth, Math.max(0, canvasHeight - focusRect.y - focusRect.height));
    context.fillRect(0, focusRect.y, Math.max(0, focusRect.x), focusRect.height);
    context.fillRect(focusRect.x + focusRect.width, focusRect.y, Math.max(0, canvasWidth - focusRect.x - focusRect.width), focusRect.height);
    context.globalAlpha = overlay.haloOpacity;
    context.strokeStyle = overlay.color;
    context.lineWidth = overlay.haloWidth;
    strokeRectWithInset(context, focusRect, overlay.haloInset);
  } else if (overlay.kind === 'border-pulse') {
    context.globalAlpha = overlay.opacity;
    context.strokeStyle = overlay.color;
    context.lineWidth = overlay.lineWidth;
    context.shadowColor = overlay.color;
    context.shadowBlur = overlay.lineWidth * 2;
    strokeRectWithInset(context, overlay.borderRect, -overlay.lineWidth * 0.25);
  } else if (overlay.kind === 'fade-pulse') {
    context.globalAlpha = overlay.opacity;
    context.fillStyle = overlay.color;
    context.fillRect(overlay.targetRect.x, overlay.targetRect.y, overlay.targetRect.width, overlay.targetRect.height);
  } else if (overlay.kind === 'light-sweep') {
    context.save();
    context.beginPath();
    context.rect(overlay.clipRect.x, overlay.clipRect.y, overlay.clipRect.width, overlay.clipRect.height);
    context.clip();
    context.globalAlpha = overlay.opacity;
    context.shadowColor = overlay.color;
    context.shadowBlur = overlay.blur;
    const gradient = context.createLinearGradient(
      overlay.direction === 'ltr' ? overlay.sweepRect.x : overlay.sweepRect.x + overlay.sweepRect.width,
      0,
      overlay.direction === 'ltr' ? overlay.sweepRect.x + overlay.sweepRect.width : overlay.sweepRect.x,
      0,
    );
    gradient.addColorStop(0, 'rgba(255,255,255,0)');
    gradient.addColorStop(0.5, overlay.color);
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.fillRect(
      overlay.sweepRect.x,
      overlay.sweepRect.y,
      overlay.sweepRect.width,
      overlay.sweepRect.height,
    );
    context.restore();
  } else if (overlay.kind === 'click-pointer') {
    context.save();
    context.globalAlpha = overlay.ringOpacity;
    context.strokeStyle = overlay.color;
    context.lineWidth = Math.max(2, overlay.size * 0.08);
    context.beginPath();
    context.arc(overlay.clickX, overlay.clickY, overlay.ringRadius, 0, Math.PI * 2);
    context.stroke();

    context.globalAlpha = overlay.opacity;
    context.translate(overlay.x, overlay.y);
    if (overlay.flipX) context.scale(-1, 1);
    context.fillStyle = '#ffffff';
    context.strokeStyle = overlay.color;
    context.lineWidth = Math.max(1.5, overlay.size * 0.07);
    context.shadowColor = 'rgba(15,23,42,0.3)';
    context.shadowBlur = overlay.size * 0.14;
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(overlay.size * 0.15, overlay.size * 0.82);
    context.lineTo(overlay.size * 0.36, overlay.size * 0.59);
    context.lineTo(overlay.size * 0.58, overlay.size);
    context.lineTo(overlay.size * 0.75, overlay.size * 0.9);
    context.lineTo(overlay.size * 0.53, overlay.size * 0.51);
    context.lineTo(overlay.size * 0.84, overlay.size * 0.47);
    context.closePath();
    context.fill();
    context.stroke();
    context.restore();
  } else {
    context.save();
    context.globalAlpha = overlay.opacity;
    context.shadowColor = 'rgba(15,23,42,0.35)';
    context.shadowBlur = overlay.shadowBlur;
    context.drawImage(
      context.canvas,
      overlay.sourceRect.x,
      overlay.sourceRect.y,
      overlay.sourceRect.width,
      overlay.sourceRect.height,
      overlay.destinationRect.x,
      overlay.destinationRect.y,
      overlay.destinationRect.width,
      overlay.destinationRect.height,
    );
    context.shadowBlur = 0;
    context.strokeStyle = overlay.color;
    context.lineWidth = overlay.borderWidth;
    strokeRectWithInset(context, overlay.destinationRect, overlay.borderWidth * 0.5);
    context.restore();
  }

  context.restore();
}
