(function () {
    'use strict';

    function bboxIoU(a, b) {
        const xLeft = Math.max(a.x1, b.x1);
        const yTop = Math.max(a.y1, b.y1);
        const xRight = Math.min(a.x2, b.x2);
        const yBottom = Math.min(a.y2, b.y2);
        const interW = Math.max(0, xRight - xLeft);
        const interH = Math.max(0, yBottom - yTop);
        const interArea = interW * interH;
        if (!interArea) {
            return 0;
        }

        const areaA = Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1);
        const areaB = Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
        const denom = areaA + areaB - interArea;
        return denom > 0 ? interArea / denom : 0;
    }

    function pointInPolygon(point, polygon) {
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const xi = polygon[i][0];
            const yi = polygon[i][1];
            const xj = polygon[j][0];
            const yj = polygon[j][1];

            const intersects = ((yi > point.y) !== (yj > point.y))
                && (point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || 1e-9) + xi);
            if (intersects) {
                inside = !inside;
            }
        }
        return inside;
    }

    function denormalizeSpacePoints(space, frameWidth, frameHeight) {
        return (space.points || []).map(([nx, ny]) => [
            nx * frameWidth,
            ny * frameHeight,
        ]);
    }

    function toBoxFromPolygon(points) {
        const xs = points.map((p) => p[0]);
        const ys = points.map((p) => p[1]);
        return {
            x1: Math.min(...xs),
            y1: Math.min(...ys),
            x2: Math.max(...xs),
            y2: Math.max(...ys),
        };
    }

    function checkOccupancy(yoloBoxes, parkingSpaces, frameWidth, frameHeight) {
        const spaces = (parkingSpaces || []).map((space) => {
            const pointsPx = denormalizeSpacePoints(space, frameWidth, frameHeight);
            if (!pointsPx.length) {
                return { ...space, status: 'empty' };
            }

            const spaceBox = toBoxFromPolygon(pointsPx);
            const occupied = (yoloBoxes || []).some((box) => {
                const iou = bboxIoU(box, spaceBox);
                if (iou > 0.3) {
                    return true;
                }

                const centroid = {
                    x: (box.x1 + box.x2) / 2,
                    y: (box.y1 + box.y2) / 2,
                };
                return pointInPolygon(centroid, pointsPx);
            });

            return {
                ...space,
                status: occupied ? 'occupied' : 'empty',
            };
        });

        const occupied = spaces.filter((s) => s.status === 'occupied').length;
        return {
            spaces,
            stats: {
                total: spaces.length,
                occupied,
                available: spaces.length - occupied,
            },
        };
    }

    function drawPolygon(ctx, points, style) {
        if (!points.length) {
            return;
        }

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(points[0][0], points[0][1]);
        for (let i = 1; i < points.length; i += 1) {
            ctx.lineTo(points[i][0], points[i][1]);
        }
        ctx.closePath();

        ctx.fillStyle = style.fill;
        ctx.strokeStyle = style.stroke;
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }

    function renderDetectionOverlay(options) {
        const {
            ctx,
            frameBitmap,
            yoloBoxes,
            parkingSpaces,
            frameWidth,
            frameHeight,
        } = options;

        ctx.clearRect(0, 0, frameWidth, frameHeight);
        if (frameBitmap) {
            ctx.drawImage(frameBitmap, 0, 0, frameWidth, frameHeight);
        }

        // Draw YOLO vehicle boxes.
        (yoloBoxes || []).forEach((box) => {
            ctx.save();
            ctx.strokeStyle = '#0066ff';
            ctx.lineWidth = 2;
            ctx.strokeRect(box.x1, box.y1, box.x2 - box.x1, box.y2 - box.y1);
            ctx.restore();
        });

        (parkingSpaces || []).forEach((space) => {
            const pointsPx = denormalizeSpacePoints(space, frameWidth, frameHeight);
            const isOccupied = space.status === 'occupied';
            drawPolygon(ctx, pointsPx, {
                fill: isOccupied ? 'rgba(255, 60, 60, 0.25)' : 'rgba(0, 255, 100, 0.2)',
                stroke: isOccupied ? '#ff3c3c' : '#00ff64',
            });

            if (pointsPx.length) {
                const [lx, ly] = pointsPx[0];
                ctx.save();
                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold 15px Arial';
                ctx.fillText(space.id || '', lx + 6, ly - 6 < 14 ? ly + 16 : ly - 6);
                ctx.restore();
            }
        });
    }

    window.checkOccupancy = checkOccupancy;
    window.renderDetectionOverlay = renderDetectionOverlay;
})();
