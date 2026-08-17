/**
 * Canvas preview of a block model, turnable with the pointer.
 *
 * See model-preview.ts for the projection. This component owns the drawing — loading the
 * texture, mapping it onto each face, shading — and the camera the user is dragging.
 *
 * Rotation is opt-in because the card grids put previews inside buttons, where a drag has
 * to stay a click on the card rather than turning a thumbnail nobody asked to turn.
 */

import { useEffect, useMemo, useRef, useState, type PointerEvent, type KeyboardEvent } from 'react';
import {
  parseModel,
  drawOrder,
  fitScale,
  modelCentre,
  project,
  turn,
  DEFAULT_VIEW,
  FACE_SHADE,
  type ParsedModel,
  type ViewAngles,
} from '../../../shared/model-preview.ts';
import type { EntryPreviewDto } from '../../../shared/ipc.ts';

interface Props {
  preview: EntryPreviewDto | undefined;
  size: number;
  /** Enables drag-to-rotate, and the keyboard equivalent. */
  interactive?: boolean;
  /** Hint shown on hover, and the accessible name of the canvas. */
  label?: string;
}

/** Radians per pixel dragged. A full turn takes a little over half a screen width. */
const DRAG_SPEED = 0.011;

/** Radians per arrow key press: an eighth of a turn, so four presses show the far side. */
const KEY_STEP = Math.PI / 8;

export function ModelPreview({ preview, size, interactive = false, label }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState<ViewAngles>(DEFAULT_VIEW);
  const [texture, setTexture] = useState<HTMLImageElement | null>(null);

  const model = useMemo(() => (preview ? parseModel(preview.model) : null), [preview]);
  // Fitting is view-independent by design, so it survives a rotation without recomputing.
  const scale = useMemo(() => (model ? fitScale(model, size) : 0), [model, size]);

  // A different entry starts from the default angle: the camera belongs to the viewer's
  // inspection of one model, not to the panel.
  useEffect(() => {
    setView(DEFAULT_VIEW);
  }, [preview?.id]);

  // Held as state rather than loaded per draw, so dragging does not re-decode the texture
  // on every pointer move.
  useEffect(() => {
    setTexture(null);

    const uri = preview?.textureDataUri;
    if (!uri) return;

    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (!cancelled) setTexture(image);
    };
    image.src = uri;

    return () => {
      cancelled = true;
    };
  }, [preview?.textureDataUri]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    // Draw at device resolution so the result is crisp on a high-DPI display.
    const ratio = window.devicePixelRatio || 1;
    canvas.width = size * ratio;
    canvas.height = size * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, size, size);

    // The texture may still be loading; the shape is drawn untextured until it arrives.
    if (model) render(context, model, size, scale, view, texture);
  }, [model, size, scale, view, texture]);

  const drag = useRef<{ pointerId: number; x: number; y: number } | null>(null);

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>): void => {
    if (!interactive || !model) return;
    // Stops the drag from also being read as a press on whatever contains the preview.
    event.preventDefault();
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>): void => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;

    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    current.x = event.clientX;
    current.y = event.clientY;

    // Turntable feel: the surface under the pointer follows it, so the camera orbits the
    // other way for yaw, and dragging down tips the top of the model towards the viewer.
    setView((angles) => turn(angles, -dx * DRAG_SPEED, dy * DRAG_SPEED));
  };

  const onPointerEnd = (event: PointerEvent<HTMLCanvasElement>): void => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLCanvasElement>): void => {
    if (!interactive || !model) return;

    // Each key turns the model the way dragging in that direction would.
    const step: Record<string, [number, number]> = {
      ArrowLeft: [KEY_STEP, 0],
      ArrowRight: [-KEY_STEP, 0],
      ArrowUp: [0, -KEY_STEP],
      ArrowDown: [0, KEY_STEP],
    };

    if (event.key === 'Home' || event.key === 'Escape') {
      setView(DEFAULT_VIEW);
    } else if (step[event.key]) {
      const [yaw, pitch] = step[event.key];
      setView((angles) => turn(angles, yaw, pitch));
    } else {
      return;
    }

    // Arrow keys would otherwise scroll the panel out from under the preview.
    event.preventDefault();
  };

  return (
    <canvas
      ref={canvasRef}
      // Unlabelled previews sit inside a card that already names the entry, so announcing
      // them again would only add noise.
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      title={interactive ? label : undefined}
      tabIndex={interactive && model ? 0 : undefined}
      className={interactive ? 'model-preview model-preview-turnable' : 'model-preview'}
      style={{ width: size, height: size, display: 'block' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onDoubleClick={() => interactive && setView(DEFAULT_VIEW)}
      onKeyDown={onKeyDown}
    />
  );
}

function render(
  context: CanvasRenderingContext2D,
  model: ParsedModel,
  size: number,
  scale: number,
  view: ViewAngles,
  image: HTMLImageElement | null,
): void {
  // Centred on the model's own centre rather than on the bounding box of this angle, so
  // rotating spins the model in place instead of sliding it around the canvas.
  const centre = modelCentre(model);
  const [centreX, centreY] = project(centre[0], centre[1], centre[2], scale, view);
  const offsetX = size / 2 - centreX;
  const offsetY = size / 2 - centreY;

  context.imageSmoothingEnabled = false;

  for (const { element, face, geometry } of drawOrder(model, scale, view)) {
    const uv = element.faces[face]?.uv;
    const [u1, v1, u2, v2] = uv && uv.length === 4 ? uv : [0, 0, 16, 16];

    context.save();
    // Maps the unit square onto the face's parallelogram, so the texture region can be
    // drawn as if it were an ordinary rectangle.
    context.transform(
      geometry.edgeU[0], geometry.edgeU[1],
      geometry.edgeV[0], geometry.edgeV[1],
      geometry.origin[0] + offsetX, geometry.origin[1] + offsetY,
    );

    if (image) {
      const sx = (Math.min(u1, u2) / 16) * image.width;
      const sy = (Math.min(v1, v2) / 16) * image.height;
      const sw = (Math.abs(u2 - u1) / 16) * image.width;
      const sh = (Math.abs(v2 - v1) / 16) * image.height;

      // A hair of overdraw hides the seams that appear between adjacent faces when the
      // transform lands on a fractional pixel.
      if (sw > 0 && sh > 0) {
        context.drawImage(image, sx, sy, sw, sh, 0, 0, 1.01, 1.01);
      }
    } else {
      context.fillStyle = '#8a8a99';
      context.fillRect(0, 0, 1.01, 1.01);
    }

    // Vanilla's fixed per-direction face lighting.
    const shade = FACE_SHADE[face];
    if (shade < 1) {
      context.fillStyle = `rgba(0, 0, 0, ${1 - shade})`;
      context.fillRect(0, 0, 1.01, 1.01);
    }

    context.restore();
  }
}
