(function () {
    'use strict';

    class ParkingEditor {
        constructor(firstFrame, hostElement, options = {}) {
            this.frameBitmap = firstFrame.imageBitmap;
            this.frameWidth = firstFrame.width;
            this.frameHeight = firstFrame.height;
            this.hostElement = hostElement;
            this.onStartDetection = options.onStartDetection || (() => {});

            this.mode = 'rectangle';
            this.showGrid = true;
            this.spaces = [];
            this.nextId = 1;
            this.selectedId = null;
            this.hoverId = null;
            this.tempPolygon = [];
            this.pointerPoint = null;
            this.rectDraft = null;
            this.dragState = null;
            this.undoStack = [];
            this.maxUndo = 10;
            this.contextMenuEl = null;
            this.isDestroyed = false;

            this._bindedKeydown = this._onKeyDown.bind(this);
            this._buildUI();
            this._attachEvents();
            this._render();
        }

        _buildUI() {
            this.hostElement.innerHTML = `
                <div class="parking-editor-root">
                    <div class="parking-editor-stage">
                        <div class="parking-editor-banner">📍 Annotation Mode — Draw parking spaces on the frame, then click ▶ Start Detection</div>
                        <canvas class="parking-editor-canvas"></canvas>
                    </div>
                    <div class="parking-editor-sidepanel">
                        <div class="parking-editor-toolbar">
                            <button type="button" class="parking-editor-btn" data-action="rectangle">Rectangle</button>
                            <button type="button" class="parking-editor-btn" data-action="polygon">Polygon</button>
                            <button type="button" class="parking-editor-btn" data-action="select">Select</button>
                            <button type="button" class="parking-editor-btn" data-action="toggle-grid">Grid</button>
                            <button type="button" class="parking-editor-btn" data-action="save">Save Layout</button>
                            <button type="button" class="parking-editor-btn" data-action="load">Load Layout</button>
                            <button type="button" class="parking-editor-btn danger" data-action="clear">Clear All</button>
                        </div>
                        <div class="parking-editor-start-zone">
                            <button type="button" class="parking-editor-btn success start" data-action="start">Start Detection</button>
                        </div>
                    </div>
                </div>
            `;

            this.root = this.hostElement.querySelector('.parking-editor-root');
            this.canvas = this.hostElement.querySelector('.parking-editor-canvas');
            this.ctx = this.canvas.getContext('2d');
            this.canvas.width = this.frameWidth;
            this.canvas.height = this.frameHeight;
            this._updateModeButtons();
            this._setCanvasCursorByMode();
        }

        _attachEvents() {
            this.hostElement.classList.add('active');
            this.hostElement.addEventListener('click', (event) => {
                const btn = event.target.closest('[data-action]');
                if (!btn) {
                    return;
                }
                this._handleToolbarAction(btn.getAttribute('data-action'));
            });

            this.canvas.addEventListener('mousedown', (event) => this._onMouseDown(event));
            this.canvas.addEventListener('mousemove', (event) => this._onMouseMove(event));
            this.canvas.addEventListener('mouseup', (event) => this._onMouseUp(event));
            this.canvas.addEventListener('click', (event) => this._onClick(event));
            this.canvas.addEventListener('dblclick', (event) => this._onDoubleClick(event));
            this.canvas.addEventListener('contextmenu', (event) => this._onContextMenu(event));
            document.addEventListener('keydown', this._bindedKeydown);
            document.addEventListener('click', () => this._removeContextMenu());
        }

        destroy() {
            this.isDestroyed = true;
            document.removeEventListener('keydown', this._bindedKeydown);
            this._removeContextMenu();
            this.hostElement.classList.remove('active');
            this.hostElement.innerHTML = '';
        }

        _onKeyDown(event) {
            if (event.key === 'Escape') {
                this.tempPolygon = [];
                this.rectDraft = null;
                this._render();
                return;
            }

            if (event.key === 'Delete' && this.selectedId) {
                this._pushUndoSnapshot();
                this.spaces = this.spaces.filter((space) => space.id !== this.selectedId);
                this.selectedId = null;
                this._render();
                return;
            }

            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
                event.preventDefault();
                this._undo();
                return;
            }

            if (event.key === 'Enter' && this.mode === 'polygon') {
                this._finalizePolygon();
            }
        }

        _handleToolbarAction(action) {
            if (action === 'rectangle' || action === 'polygon' || action === 'select') {
                this.mode = action;
                this.tempPolygon = [];
                this.rectDraft = null;
                this._updateModeButtons();
                this._setCanvasCursorByMode();
                this._render();
                return;
            }

            if (action === 'toggle-grid') {
                this.showGrid = !this.showGrid;
                this._render();
                return;
            }

            if (action === 'clear') {
                this._pushUndoSnapshot();
                this.spaces = [];
                this.selectedId = null;
                this._render();
                return;
            }

            if (action === 'save') {
                localStorage.setItem('parking_layout', JSON.stringify(this.spaces));
                return;
            }

            if (action === 'load') {
                this._loadLayout();
                return;
            }

            if (action === 'start') {
                this.onStartDetection(this.spaces.map((space) => ({ ...space })));
            }
        }

        _setCanvasCursorByMode() {
            this.canvas.classList.toggle('select-mode', this.mode === 'select');
        }

        _updateModeButtons() {
            const buttons = this.hostElement.querySelectorAll('.parking-editor-btn');
            buttons.forEach((button) => {
                const action = button.getAttribute('data-action');
                button.classList.toggle('active', action === this.mode);
            });
        }

        _loadLayout() {
            try {
                const raw = localStorage.getItem('parking_layout');
                if (!raw) {
                    return;
                }
                const parsed = JSON.parse(raw);
                if (!Array.isArray(parsed)) {
                    return;
                }
                this._pushUndoSnapshot();
                this.spaces = parsed.map((space) => ({
                    id: String(space.id),
                    type: space.type === 'polygon' ? 'polygon' : 'rectangle',
                    points: Array.isArray(space.points) ? space.points : [],
                    status: space.status === 'occupied' ? 'occupied' : 'empty',
                }));
                this.nextId = this._calculateNextId();
                this.selectedId = null;
                this._render();
            } catch (error) {
                console.error('Failed to load parking layout:', error);
            }
        }

        _calculateNextId() {
            let maxNum = 0;
            this.spaces.forEach((space) => {
                const num = Number(String(space.id).replace(/^P/, ''));
                if (!Number.isNaN(num)) {
                    maxNum = Math.max(maxNum, num);
                }
            });
            return maxNum + 1;
        }

        _pushUndoSnapshot() {
            const snapshot = JSON.stringify(this.spaces);
            this.undoStack.push(snapshot);
            if (this.undoStack.length > this.maxUndo) {
                this.undoStack.shift();
            }
        }

        _undo() {
            if (!this.undoStack.length) {
                return;
            }
            const snapshot = this.undoStack.pop();
            try {
                this.spaces = JSON.parse(snapshot);
                this.nextId = this._calculateNextId();
                this.selectedId = null;
                this._render();
            } catch (error) {
                console.error('Failed to undo action:', error);
            }
        }

        _toCanvasPoint(event) {
            const rect = this.canvas.getBoundingClientRect();
            const sx = this.canvas.width / rect.width;
            const sy = this.canvas.height / rect.height;
            return {
                x: (event.clientX - rect.left) * sx,
                y: (event.clientY - rect.top) * sy,
            };
        }

        _toNormalized(point) {
            return [
                Math.min(1, Math.max(0, point.x / this.frameWidth)),
                Math.min(1, Math.max(0, point.y / this.frameHeight)),
            ];
        }

        _fromNormalized(point) {
            return [point[0] * this.frameWidth, point[1] * this.frameHeight];
        }

        _onMouseDown(event) {
            if (event.button !== 0) {
                return;
            }
            const p = this._toCanvasPoint(event);

            if (this.mode === 'rectangle') {
                this.rectDraft = { start: p, end: p };
                return;
            }

            if (this.mode !== 'select') {
                return;
            }

            const handle = this._hitTestHandle(p);
            if (handle) {
                this.dragState = {
                    type: 'handle',
                    id: handle.id,
                    index: handle.index,
                };
                return;
            }

            const hit = this._hitTestSpace(p);
            if (hit) {
                this.selectedId = hit.id;
                this.dragState = {
                    type: 'shape',
                    id: hit.id,
                    anchor: p,
                };
                this._render();
                return;
            }

            this.selectedId = null;
            this._render();
        }

        _onMouseMove(event) {
            const p = this._toCanvasPoint(event);
            this.pointerPoint = p;

            if (this.mode === 'rectangle' && this.rectDraft) {
                this.rectDraft.end = p;
                this._render();
                return;
            }

            if (this.mode === 'polygon') {
                this._render();
                return;
            }

            if (this.mode !== 'select') {
                return;
            }

            if (!this.dragState) {
                const hit = this._hitTestSpace(p);
                this.hoverId = hit ? hit.id : null;
                this._render();
                return;
            }

            if (this.dragState.type === 'shape') {
                const dx = p.x - this.dragState.anchor.x;
                const dy = p.y - this.dragState.anchor.y;
                this.dragState.anchor = p;

                const space = this.spaces.find((s) => s.id === this.dragState.id);
                if (!space) {
                    return;
                }
                space.points = space.points.map(([nx, ny]) => {
                    const px = nx * this.frameWidth + dx;
                    const py = ny * this.frameHeight + dy;
                    return this._toNormalized({ x: px, y: py });
                });
                this._render();
                return;
            }

            if (this.dragState.type === 'handle') {
                const space = this.spaces.find((s) => s.id === this.dragState.id);
                if (!space) {
                    return;
                }
                const updated = [...space.points];
                updated[this.dragState.index] = this._toNormalized(p);
                space.points = updated;
                this._render();
            }
        }

        _onMouseUp() {
            if (this.mode === 'rectangle' && this.rectDraft) {
                const { start, end } = this.rectDraft;
                const width = Math.abs(end.x - start.x);
                const height = Math.abs(end.y - start.y);
                if (width > 4 && height > 4) {
                    this._pushUndoSnapshot();
                    const x1 = Math.min(start.x, end.x);
                    const y1 = Math.min(start.y, end.y);
                    const x2 = Math.max(start.x, end.x);
                    const y2 = Math.max(start.y, end.y);
                    this.spaces.push({
                        id: `P${this.nextId}`,
                        type: 'rectangle',
                        points: [
                            this._toNormalized({ x: x1, y: y1 }),
                            this._toNormalized({ x: x2, y: y1 }),
                            this._toNormalized({ x: x2, y: y2 }),
                            this._toNormalized({ x: x1, y: y2 }),
                        ],
                        status: 'empty',
                    });
                    this.nextId += 1;
                }
                this.rectDraft = null;
                this._render();
            }

            if (this.dragState) {
                this._pushUndoSnapshot();
                this.dragState = null;
            }
        }

        _onClick(event) {
            if (event.button !== 0 || this.mode !== 'polygon') {
                return;
            }
            const p = this._toCanvasPoint(event);
            this.tempPolygon.push(p);
            this._render();
        }

        _onDoubleClick(event) {
            if (this.mode !== 'polygon') {
                return;
            }
            event.preventDefault();
            this._finalizePolygon();
        }

        _finalizePolygon() {
            if (this.tempPolygon.length < 3) {
                this.tempPolygon = [];
                this._render();
                return;
            }
            this._pushUndoSnapshot();
            this.spaces.push({
                id: `P${this.nextId}`,
                type: 'polygon',
                points: this.tempPolygon.map((point) => this._toNormalized(point)),
                status: 'empty',
            });
            this.nextId += 1;
            this.tempPolygon = [];
            this._render();
        }

        _onContextMenu(event) {
            if (this.mode !== 'select') {
                return;
            }
            event.preventDefault();
            const p = this._toCanvasPoint(event);
            const hit = this._hitTestSpace(p);
            if (!hit) {
                this._removeContextMenu();
                return;
            }
            this.selectedId = hit.id;
            this._render();
            this._showContextMenu(event.clientX, event.clientY, hit.id);
        }

        _showContextMenu(clientX, clientY, id) {
            this._removeContextMenu();
            const menu = document.createElement('div');
            menu.className = 'parking-editor-context-menu';
            menu.innerHTML = `
                <button type="button" data-action="rename">Rename</button>
                <button type="button" data-action="delete">Delete</button>
            `;
            menu.style.left = `${clientX}px`;
            menu.style.top = `${clientY}px`;

            menu.addEventListener('click', (event) => {
                const action = event.target.getAttribute('data-action');
                if (action === 'rename') {
                    const space = this.spaces.find((s) => s.id === id);
                    if (!space) {
                        return;
                    }
                    const nextName = window.prompt('Rename parking space:', space.id);
                    if (nextName && nextName.trim()) {
                        this._pushUndoSnapshot();
                        space.id = nextName.trim();
                        this._render();
                    }
                }
                if (action === 'delete') {
                    this._pushUndoSnapshot();
                    this.spaces = this.spaces.filter((s) => s.id !== id);
                    if (this.selectedId === id) {
                        this.selectedId = null;
                    }
                    this._render();
                }
                this._removeContextMenu();
            });

            document.body.appendChild(menu);
            this.contextMenuEl = menu;
        }

        _removeContextMenu() {
            if (this.contextMenuEl && this.contextMenuEl.parentNode) {
                this.contextMenuEl.parentNode.removeChild(this.contextMenuEl);
            }
            this.contextMenuEl = null;
        }

        _hitTestSpace(point) {
            for (let i = this.spaces.length - 1; i >= 0; i -= 1) {
                const space = this.spaces[i];
                const points = space.points.map((n) => this._fromNormalized(n));
                if (this._pointInPolygon(point, points)) {
                    return space;
                }
            }
            return null;
        }

        _hitTestHandle(point) {
            if (!this.selectedId) {
                return null;
            }
            const selected = this.spaces.find((space) => space.id === this.selectedId);
            if (!selected) {
                return null;
            }
            const points = selected.points.map((n) => this._fromNormalized(n));
            for (let i = 0; i < points.length; i += 1) {
                const [hx, hy] = points[i];
                const dx = point.x - hx;
                const dy = point.y - hy;
                if (Math.sqrt(dx * dx + dy * dy) <= 8) {
                    return { id: selected.id, index: i };
                }
            }
            return null;
        }

        _pointInPolygon(point, polygon) {
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

        _drawGrid() {
            if (!this.showGrid) {
                return;
            }
            const step = 40;
            this.ctx.save();
            this.ctx.strokeStyle = 'rgba(255,255,255,0.12)';
            this.ctx.lineWidth = 1;
            for (let x = 0; x <= this.frameWidth; x += step) {
                this.ctx.beginPath();
                this.ctx.moveTo(x, 0);
                this.ctx.lineTo(x, this.frameHeight);
                this.ctx.stroke();
            }
            for (let y = 0; y <= this.frameHeight; y += step) {
                this.ctx.beginPath();
                this.ctx.moveTo(0, y);
                this.ctx.lineTo(this.frameWidth, y);
                this.ctx.stroke();
            }
            this.ctx.restore();
        }

        _drawSpace(space, style) {
            const points = space.points.map((n) => this._fromNormalized(n));
            if (!points.length) {
                return;
            }

            this.ctx.save();
            this.ctx.beginPath();
            this.ctx.moveTo(points[0][0], points[0][1]);
            for (let i = 1; i < points.length; i += 1) {
                this.ctx.lineTo(points[i][0], points[i][1]);
            }
            this.ctx.closePath();

            if (style.dashed) {
                this.ctx.setLineDash([8, 6]);
                this.ctx.lineDashOffset = -(Date.now() / 60);
            } else {
                this.ctx.setLineDash([]);
            }

            this.ctx.fillStyle = style.fill;
            this.ctx.strokeStyle = style.stroke;
            this.ctx.lineWidth = style.lineWidth || 2;
            this.ctx.fill();
            this.ctx.stroke();

            this.ctx.fillStyle = '#ffffff';
            this.ctx.font = 'bold 14px Arial';
            this.ctx.fillText(space.id, points[0][0] + 6, points[0][1] > 18 ? points[0][1] - 6 : points[0][1] + 16);

            this.ctx.restore();

            if (this.selectedId === space.id) {
                this.ctx.save();
                this.ctx.fillStyle = '#ffffff';
                this.ctx.strokeStyle = '#111827';
                points.forEach(([x, y]) => {
                    this.ctx.beginPath();
                    this.ctx.arc(x, y, 5, 0, Math.PI * 2);
                    this.ctx.fill();
                    this.ctx.stroke();
                });
                this.ctx.restore();
            }
        }

        _render() {
            if (this.isDestroyed) {
                return;
            }
            this.ctx.clearRect(0, 0, this.frameWidth, this.frameHeight);
            this.ctx.drawImage(this.frameBitmap, 0, 0, this.frameWidth, this.frameHeight);
            this._drawGrid();

            this.spaces.forEach((space) => {
                const isHovered = this.hoverId === space.id;
                this._drawSpace(space, {
                    fill: 'rgba(0,255,100,0.2)',
                    stroke: isHovered ? '#3b82f6' : '#00ff64',
                    lineWidth: isHovered ? 3 : 2,
                });
            });

            if (this.rectDraft) {
                const { start, end } = this.rectDraft;
                const draftSpace = {
                    id: '',
                    points: [
                        this._toNormalized({ x: start.x, y: start.y }),
                        this._toNormalized({ x: end.x, y: start.y }),
                        this._toNormalized({ x: end.x, y: end.y }),
                        this._toNormalized({ x: start.x, y: end.y }),
                    ],
                };
                this._drawSpace(draftSpace, {
                    fill: 'rgba(255, 215, 0, 0.1)',
                    stroke: '#facc15',
                    dashed: true,
                    lineWidth: 2,
                });
            }

            if (this.tempPolygon.length) {
                this.ctx.save();
                this.ctx.beginPath();
                this.ctx.moveTo(this.tempPolygon[0].x, this.tempPolygon[0].y);
                for (let i = 1; i < this.tempPolygon.length; i += 1) {
                    this.ctx.lineTo(this.tempPolygon[i].x, this.tempPolygon[i].y);
                }
                if (this.pointerPoint) {
                    this.ctx.lineTo(this.pointerPoint.x, this.pointerPoint.y);
                }
                this.ctx.strokeStyle = '#facc15';
                this.ctx.lineWidth = 2;
                this.ctx.setLineDash([8, 6]);
                this.ctx.lineDashOffset = -(Date.now() / 60);
                this.ctx.stroke();

                this.ctx.setLineDash([]);
                this.tempPolygon.forEach((p) => {
                    this.ctx.beginPath();
                    this.ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
                    this.ctx.fillStyle = '#facc15';
                    this.ctx.fill();
                });
                this.ctx.restore();
            }

        }
    }

    window.initParkingEditor = function initParkingEditor(firstFrame, hostElement, options) {
        return new ParkingEditor(firstFrame, hostElement, options);
    };
})();
