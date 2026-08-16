/**
 * Canvas preview of a block model.
 *
 * See model-preview.ts for the projection. This component owns only the drawing: loading
 * the texture, mapping it onto each face, and shading.
 */

import { useEffect, useRef } from 'react';
import {
  parseModel,
  drawOrder,
  screenBounds,
  FACE_SHADE,
  type ParsedModel,
} from '../../../shared/model-preview.ts';
import type { EntryPreviewDto } from '../../../shared/ipc.ts';

interface Props {
  preview: EntryPreviewDto | undefined;
  size: number;
}

export function ModelPreview({ preview, size }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

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

    const model = preview ? parseModel(preview.model) : null;
    if (!model) return;

    // The texture may still be loading; draw untextured first so the shape appears, then
    // redraw with the image once it is ready.
    render(context, model, size, null);

    if (!preview?.textureDataUri) return;
    const image = new Image();
    image.onload = () => {
      context.clearRect(0, 0, size, size);
      render(context, model, size, image);
    };
    image.src = preview.textureDataUri;
  }, [preview, size]);

  return <canvas ref={canvasRef} style={{ width: size, height: size, display: 'block' }} />;
}

function render(
  context: CanvasRenderingContext2D,
  model: ParsedModel,
  size: number,
  image: HTMLImageElement | null,
): void {
  // Fit the model to the canvas with a small margin, whatever its extents.
  const probe = screenBounds(model, 1);
  const scale = (size * 0.86) / Math.max(probe.width, probe.height, 1);

  const bounds = screenBounds(model, scale);
  const offsetX = size / 2 - (bounds.minX + bounds.maxX) / 2;
  const offsetY = size / 2 - (bounds.minY + bounds.maxY) / 2;

  context.imageSmoothingEnabled = false;

  for (const { element, face, geometry } of drawOrder(model, scale)) {
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

    // Fixed directional shading, standing in for the game's own face lighting.
    const shade = FACE_SHADE[face];
    if (shade < 1) {
      context.fillStyle = `rgba(0, 0, 0, ${1 - shade})`;
      context.fillRect(0, 0, 1.01, 1.01);
    }

    context.restore();
  }
}
